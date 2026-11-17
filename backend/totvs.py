from __future__ import annotations

import json
import math
import os
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.control_calendar import control_schedule, system_start_date


ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = Path(r"C:\Users\pedro.barboni\Desktop\ALMOXARIFADO\Flow-Movimentacoes\configuracao_sql.json")

# Cada consulta abre um processo PowerShell e uma conexão nova ao SQL Server
# do TOTVS (~3s). Abrir uma peça sozinha já dispara essa consulta 3 vezes
# (rota de produção, rastreabilidade, balanço do vergalhão) para o mesmo
# produto -- um cache curto colapsa essas chamadas repetidas sem esconder uma
# mudança real de estoque por mais que alguns segundos. Só resultados online
# são guardados: uma falha de rede não deve "grudar" pelo tempo do cache.
_TOTVS_CACHE_TTL_SECONDS = 20.0
_totvs_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_totvs_cache_lock = threading.Lock()


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _date(value: str | None) -> str | None:
    if not value or len(value) != 8:
        return value or None
    return f"{value[6:8]}/{value[4:6]}/{value[:4]}"


def _lot_id(row: dict[str, Any]) -> str:
    destination = str(row.get("destino") or "").strip()
    normalized_destination = destination.lstrip("0") or destination
    try:
        sequence = int(row.get("lotSequence") or 0)
    except (TypeError, ValueError):
        sequence = 0
    if normalized_destination and sequence > 0:
        return f"LT-{normalized_destination}-{sequence:03d}"
    document = str(row.get("documento") or "SEM-DOC").lstrip("0") or "0"
    suffix = row.get("registro") or row.get("item") or "1"
    return f"LT-{document}-{suffix}"


def _destination_codes(product: dict[str, Any]) -> list[str]:
    codes: list[str] = []
    for raw_code in product.get("totvs_destination_codes", []):
        code = str(raw_code).strip()
        if code and code not in codes:
            codes.append(code)
        padded = code.zfill(6) if code.isdigit() and len(code) < 6 else code
        if padded and padded not in codes:
            codes.append(padded)
    return codes


def _destination_stage(product: dict[str, Any], code: Any) -> str | None:
    normalized = str(code or "").strip().lstrip("0") or "0"
    for candidate, stage in product.get("totvs_destination_code_stages", {}).items():
        if (str(candidate).strip().lstrip("0") or "0") == normalized:
            return stage
    return None


def query_totvs_material(product: dict[str, Any]) -> dict[str, Any]:
    cache_key = product["id"]
    now = time.monotonic()
    with _totvs_cache_lock:
        cached = _totvs_cache.get(cache_key)
        if cached is not None and now - cached[0] < _TOTVS_CACHE_TTL_SECONDS:
            return cached[1]

    result = _query_totvs_material_uncached(product)

    if result.get("status") != "offline":
        with _totvs_cache_lock:
            _totvs_cache[cache_key] = (now, result)
    return result


def _query_totvs_material_uncached(product: dict[str, Any]) -> dict[str, Any]:
    control_start = system_start_date()
    control = control_schedule()
    config_path = Path(os.environ.get("TOTVS_CONFIG_PATH", str(DEFAULT_CONFIG)))
    if not config_path.is_file():
        return {
            "status": "offline",
            "message": "Configuração local do TOTVS não encontrada.",
            "stock": {"warehouse": "01", "total_kg": 0, "balances": []},
            "lots": [],
            "movements": [],
            "control": control,
        }

    material = "COBRE" if product.get("rod_material", "").startswith("COBRE") else "LATAO"
    diameter_label = str(product.get("rod_diameter_mm") or "")
    diameter = {"8.800": "880", "14.500": "1450"}.get(diameter_label, diameter_label.replace(".", ""))
    stock_warehouse = os.environ.get("TOTVS_STOCK_WAREHOUSE", "01")
    production_warehouse = os.environ.get("TOTVS_PRODUCTION_WAREHOUSE", "04")
    destination_name = product.get("totvs_destination_name") or product["database_name"]
    destination_codes = _destination_codes(product)
    command = [
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(ROOT / "totvs-query.ps1"),
        "-ConfigPath", str(config_path),
        "-Material", material,
        "-Diameter", diameter,
        "-DestinationCode", ",".join(destination_codes),
        "-DestinationName", destination_name,
        "-StockWarehouse", stock_warehouse,
        "-ProductionWarehouse", production_warehouse,
        "-StartDate", control_start.strftime("%Y%m%d"),
        "-Limit", "30",
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8-sig",
            timeout=25,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = json.loads(completed.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        return {
            "status": "offline",
            "message": f"Consulta TOTVS indisponível: {str(error)[:160]}",
            "stock": {"warehouse": stock_warehouse, "total_kg": 0, "balances": []},
            "lots": [],
            "movements": [],
            "control": control,
        }

    balances = raw.get("balances") or []
    movements = raw.get("movements") or []
    lots = []
    for movement in movements:
        weight = _number(movement.get("quantidade"))
        lots.append({
            "id": _lot_id(movement),
            "material_code": movement.get("codigo"),
            "initial_kg": weight,
            "balance_kg": weight,
            "status": "closed",
            "date": _date(movement.get("dataMovimento")),
            "document": movement.get("documento") or "—",
            "destination": movement.get("destino") or destination_name,
            "destination_stage": _destination_stage(product, movement.get("destino")),
            "production_order": movement.get("ordemProducao") or "—",
            "user": movement.get("usuario") or "—",
            "source_record": movement.get("registro"),
            "external_control_lot": movement.get("loteControle") or "",
            "external_batch": movement.get("numeroLote") or "",
            "source": "TOTVS SD3010",
        })

    products = raw.get("products") or []
    destinations = raw.get("destinations") or []
    total_stock = sum(_number(item.get("saldoAtual")) for item in balances)
    blank_weight = _number(product.get("blank_weight_kg"))
    total_transferred = sum(item["initial_kg"] for item in lots)
    status = "online" if products else "attention"
    message = (
        "Dados atualizados diretamente do TOTVS."
        if products
        else "Nenhum código de vergalhão correspondente foi localizado no SB1010."
    )
    if products and not lots:
        message = "Saldo localizado; ainda não há transferência com a peça preenchida em Número de Série."

    return {
        "status": status,
        "message": message,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "control": control,
        "material": {
            "codes": [item.get("codigo") for item in products],
            "description": products[0].get("descricao") if products else product.get("rod"),
            "unit": products[0].get("unidade") if products else "KG",
            "diameter_mm": product.get("rod_diameter_mm"),
        },
        "destination": {
            "requested_code": destination_codes[0] if destination_codes else None,
            "requested_codes": destination_codes,
            "requested_name": destination_name,
            "code_stages": product.get("totvs_destination_code_stages", {}),
            "resolved_codes": [item.get("codigo") for item in destinations],
            "field": "D3_NUMSERI",
        },
        "stock": {
            "warehouse": stock_warehouse,
            "total_kg": total_stock,
            "balances": balances,
            "blank_weight_kg": blank_weight,
            "estimated_pieces": math.floor(total_stock / blank_weight) if blank_weight else 0,
        },
        "production_warehouse": production_warehouse,
        "transferred_kg": total_transferred,
        "lot_count": len(lots),
        "lots": lots,
        "movements": movements,
    }
