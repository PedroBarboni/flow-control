from __future__ import annotations

import json
import os
import subprocess
import sys
import unicodedata
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from backend.traceability_types import ProcessEvent


_EVENT_COLUMN_ALIASES = {
    "id": ("id", "apontamento_id", "codigo"),
    "product": ("produto",),
    "process": ("processo",),
    "machine": ("maquina", "equipamento"),
    "date": ("data", "data_apontamento"),
    "quantity": ("quantidade", "quantidade_boa"),
    "loss": ("perda", "quantidade_perda"),
    "operator": ("operador",),
    "shift": ("turno",),
}


def _resolve_event_columns(columns: set[str]) -> dict[str, str | None]:
    resolved: dict[str, str | None] = {}
    required = {"id", "product", "process", "machine", "date", "quantity", "loss"}
    for logical, aliases in _EVENT_COLUMN_ALIASES.items():
        resolved[logical] = next((name for name in aliases if name in columns), None)
        if logical in required and not resolved[logical]:
            raise RuntimeError(f"Coluna obrigatória de apontamentos não encontrada: {logical}")
    return resolved


def _event_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, timezone.utc)
    parsed = datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _normalize_process(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return normalized.strip().upper()


def _query_native(product_name: str, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não configurada")

    try:
        import psycopg  # type: ignore

        connect = psycopg.connect
    except ImportError:
        import psycopg2  # type: ignore

        connect = psycopg2.connect

    filters = ["(produto = %s OR produto LIKE %s)"]
    params: list[Any] = [product_name, f"{product_name} (%)"]
    if date_from:
        filters.append("data >= %s")
        params.append(date_from)
    if date_to:
        filters.append("data <= %s")
        params.append(date_to)

    sql = f"""
        SELECT processo,
               COALESCE(SUM(quantidade), 0) AS quantidade,
               COALESCE(SUM(perda), 0) AS perda,
               MAX(data) AS ultima_data
        FROM public.apontamentos
        WHERE {' AND '.join(filters)}
        GROUP BY processo
        ORDER BY processo
    """

    connection = connect(database_url, connect_timeout=10, sslmode="require")
    try:
        if hasattr(connection, "set_session"):
            connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
    finally:
        connection.close()

    return [
        {
            "process": _normalize_process(row[0]),
            "quantity": int(row[1] or 0),
            "loss": int(row[2] or 0),
            "last_date": row[3],
        }
        for row in rows
    ]


def query_process_totals(product_name: str, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    try:
        return _query_native(product_name, date_from, date_to)
    except ImportError:
        python_command = os.environ.get("FLOW_DATABASE_PYTHON", "py")
        command = [python_command]
        if python_command.lower() == "py":
            command.append("-3.14")
        command.extend(["-m", "backend.database", "--query", product_name, date_from or "", date_to or ""])
        child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=child_env,
            timeout=20,
            cwd=str(Path(__file__).resolve().parents[1]),
        )
        return json.loads(result.stdout)


def _query_totals_by_product_native(
    product_names: list[str],
    date_from: str | None,
    date_to: str | None,
) -> dict[str, list[dict[str, Any]]]:
    """Totais por produto e processo em uma única leitura de `public.apontamentos`.

    A Central precisa do produzido e do em processo das 13 peças. Uma consulta
    agrupada evita treze idas ao banco a cada abertura da tela; a origem, os
    filtros e a semântica são os mesmos da consulta individual.
    """
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não configurada")

    try:
        import psycopg  # type: ignore

        connect = psycopg.connect
    except ImportError:
        import psycopg2  # type: ignore

        connect = psycopg2.connect

    # Mesmo recorte da consulta individual: nome exato ou nome com a etapa
    # anexada, por exemplo "CONECTOR AT (BLANK)".
    exact = list(product_names)
    prefixed = [f"{name} (%" for name in product_names]
    filters: list[str] = ["(produto = ANY(%s) OR produto LIKE ANY(%s))"]
    params: list[Any] = [exact, prefixed]
    if date_from:
        filters.append("data >= %s")
        params.append(date_from)
    if date_to:
        filters.append("data <= %s")
        params.append(date_to)

    where = f"WHERE {' AND '.join(filters)}"
    sql = f"""
        SELECT produto,
               processo,
               COALESCE(SUM(quantidade), 0) AS quantidade,
               COALESCE(SUM(perda), 0) AS perda,
               MAX(data) AS ultima_data
        FROM public.apontamentos
        {where}
        GROUP BY produto, processo
    """

    connection = connect(database_url, connect_timeout=10, sslmode="require")
    try:
        if hasattr(connection, "set_session"):
            connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
    finally:
        connection.close()

    grouped: dict[str, list[dict[str, Any]]] = {name: [] for name in product_names}
    for raw_product, process, quantity, loss, last_date in rows:
        label = str(raw_product or "").strip()
        # O banco pode anexar a etapa ao produto, por exemplo "CONECTOR AT (BLANK)".
        base = label.split(" (", 1)[0].strip()
        target = base if base in grouped else label if label in grouped else None
        if target is None:
            continue
        grouped[target].append({
            "process": _normalize_process(process),
            "quantity": int(quantity or 0),
            "loss": int(loss or 0),
            "last_date": last_date,
        })
    return grouped


def query_process_totals_by_product(
    product_names: list[str],
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    try:
        return _query_totals_by_product_native(product_names, date_from, date_to)
    except ImportError:
        return {
            name: query_process_totals(name, date_from, date_to)
            for name in product_names
        }


def _query_process_events_native(product_name: str, date_from: str | None, date_to: str | None) -> list[ProcessEvent]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL não configurada")
    try:
        import psycopg  # type: ignore
        connect = psycopg.connect
    except ImportError:
        import psycopg2  # type: ignore
        connect = psycopg2.connect

    connection = connect(database_url, connect_timeout=10, sslmode="require")
    try:
        if hasattr(connection, "set_session"):
            connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'apontamentos'
            """)
            column_map = _resolve_event_columns({row[0] for row in cursor.fetchall()})
            selected = [column_map[key] or "NULL" for key in (
                "id", "product", "process", "machine", "date", "quantity", "loss", "operator", "shift",
            )]
            filters = [f'({column_map["product"]} = %s OR {column_map["product"]} LIKE %s)']
            params: list[Any] = [product_name, f"{product_name} (%)"]
            if date_from:
                filters.append(f'{column_map["date"]} >= %s')
                params.append(date_from)
            if date_to:
                filters.append(f'{column_map["date"]} <= %s')
                params.append(date_to)
            cursor.execute(
                f'SELECT {", ".join(selected)} FROM public.apontamentos '
                f'WHERE {" AND ".join(filters)} ORDER BY {column_map["date"]}, {column_map["id"]}',
                params,
            )
            rows = cursor.fetchall()
    finally:
        connection.close()

    return [
        ProcessEvent(
            source_key=f"APONTAMENTOS:{row[0]}",
            # Keep the canonical selected product. The database may append the
            # current stage, e.g. "CONECTOR AT (BLANK)", but routing is defined
            # for the product family selected by the user.
            product_name=product_name,
            process=_normalize_process(str(row[2] or "")),
            machine=str(row[3] or ""),
            occurred_at=_event_datetime(row[4]),
            good_pieces=Decimal(str(row[5] or 0)),
            loss_pieces=Decimal(str(row[6] or 0)),
            operator=str(row[7] or ""),
            shift=str(row[8] or ""),
        )
        for row in rows
    ]


def query_process_events(product_name: str, date_from: str | None = None, date_to: str | None = None) -> list[ProcessEvent]:
    try:
        return _query_process_events_native(product_name, date_from, date_to)
    except ImportError:
        python_command = os.environ.get("FLOW_DATABASE_PYTHON", "py")
        command = [python_command]
        if python_command.lower() == "py":
            command.append("-3.14")
        command.extend([
            "-m", "backend.database", "--query-events", product_name,
            date_from or "", date_to or "",
        ])
        child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=child_env,
            timeout=30,
            cwd=str(Path(__file__).resolve().parents[1]),
        )
        return [_event_from_payload(item) for item in json.loads(result.stdout)]


def _event_to_payload(event: ProcessEvent) -> dict[str, Any]:
    return {
        "source_key": event.source_key,
        "product_name": event.product_name,
        "process": event.process,
        "machine": event.machine,
        "occurred_at": event.occurred_at.isoformat(),
        "good_pieces": str(event.good_pieces),
        "loss_pieces": str(event.loss_pieces),
        "operator": event.operator,
        "shift": event.shift,
    }


def _event_from_payload(payload: dict[str, Any]) -> ProcessEvent:
    return ProcessEvent(
        source_key=str(payload["source_key"]),
        product_name=str(payload["product_name"]),
        process=str(payload["process"]),
        machine=str(payload["machine"]),
        occurred_at=_event_datetime(payload["occurred_at"]),
        good_pieces=Decimal(str(payload["good_pieces"])),
        loss_pieces=Decimal(str(payload["loss_pieces"])),
        operator=str(payload.get("operator") or ""),
        shift=str(payload.get("shift") or ""),
    )


if __name__ == "__main__" and len(sys.argv) >= 3:
    if sys.argv[1] == "--query":
        payload = _query_native(sys.argv[2], sys.argv[3] or None, sys.argv[4] or None)
        print(json.dumps(payload, ensure_ascii=False))
    elif sys.argv[1] == "--query-events":
        events = _query_process_events_native(sys.argv[2], sys.argv[3] or None, sys.argv[4] or None)
        print(json.dumps([_event_to_payload(event) for event in events], ensure_ascii=False))
