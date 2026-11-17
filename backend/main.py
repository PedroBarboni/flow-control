from __future__ import annotations

import concurrent.futures
import os
import re
import threading
import unicodedata
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.settings import load_local_environment

load_local_environment()

from backend.control_database import (
    count_movements,
    ensure_control_schema,
    list_movements,
    list_opening_inventory,
    list_production_lots,
    record_movements,
    save_opening_inventory,
    sync_material_lots,
)
from backend.database import query_process_events, query_process_totals, query_process_totals_by_product
from backend.totvs import query_totvs_material
from backend.control_calendar import control_schedule, current_cycle_range, inventory_date, system_start_date, traceability_range
from backend.traceability_service import build_traceability_snapshot
from backend.traceability_service import _process as _tb_process
from backend.traceability_routes import build_route_aliases


app = FastAPI(
    title="Central de Controle do Fluxo Produtivo",
    description="API da Central Flow para rastreabilidade do setor produtivo.",
    version="0.1.0",
)


DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://192.168.0.18:5173",
]


def cors_origins() -> list[str]:
    """Combina as origens de desenvolvimento com as origens locais configuradas.

    Curingas são descartados: credenciais nunca podem ser liberadas para qualquer
    origem. A variável aceita uma lista separada por vírgulas para ambientes de
    desenvolvimento que utilizem outro endereço privado.
    """
    configured = os.environ.get("FLOW_CORS_ORIGINS", "")
    optional = [origin.strip() for origin in configured.split(",") if origin.strip() and origin.strip() != "*"]
    return list(dict.fromkeys([*DEFAULT_CORS_ORIGINS, *optional]))


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


CONTROL_START = system_start_date()
INVENTORY_DATE = inventory_date()
INVENTORY_LOCKED = os.environ.get("FLOW_INVENTORY_LOCKED", "true").strip().lower() not in {"0", "false", "no"}
MATERIAL_CONSUMPTION_LOCKED_FROM = datetime.fromisoformat(
    os.environ.get("FLOW_MATERIAL_CONSUMPTION_LOCKED_FROM", "2026-09-02T00:00:00-03:00")
)


class OpeningInventoryInput(BaseModel):
    process: str = Field(min_length=1, max_length=120)
    position_status: str = Field(default="waiting", pattern="^(waiting|in_process|completed)$")
    piece_quantity: float = Field(ge=0)
    rod_kg_in_process: float | None = Field(default=None, ge=0)
    operator_name: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=1000)


class ClientErrorInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    stack: str = Field(default="", max_length=8000)
    url: str = Field(default="", max_length=2000)


CLIENT_ERRORS: list[dict[str, str]] = []


@app.post("/api/client-errors", status_code=204)
def record_client_error(payload: ClientErrorInput) -> None:
    CLIENT_ERRORS.append({
        **payload.model_dump(),
        "recorded_at": datetime.now().isoformat(timespec="seconds"),
    })
    del CLIENT_ERRORS[:-20]


@app.get("/api/client-errors/latest")
def latest_client_error() -> dict[str, str] | None:
    return CLIENT_ERRORS[-1] if CLIENT_ERRORS else None


PRODUCTS: dict[str, dict[str, Any]] = {}


def catalog_product(product_id: str, name: str, code: str, database_name: str, stages: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "id": product_id,
        "name": name,
        "code": code,
        "database_name": database_name,
        "rod": "Matéria-prima ainda não vinculada ao TOTVS",
        "lots": [],
        "wallet": 0,
        "finished": 0,
        "warehouse_kg": 0,
        "required_kg": 0,
        "transferred_kg": 0,
        "consumed_kg": 0,
        "estimated_pieces": 0,
        "actual_pieces": 0,
        "estimated_scrap_kg": 0,
        "actual_scrap_kg": 0,
        "wip": 0,
        "prefinished": 0,
        "yield_percent": 0,
        "stages": [
            {"name": stage, "machine": machine, "reported": 0, "loss": 0, "waiting": 0, "status": "empty"}
            for stage, machine in stages
        ],
    }


STANDARD_CLAMP_STAGES = [
    ("Corte", "Serra"),
    ("Forja", "Forja"),
    ("Rebarba", "Prensa hidráulica"),
    ("Usinagem", "CNC"),
    ("Solda", "Solda"),
]
STANDARD_CABLE_GLAND_STAGES = [
    ("Corte", "Serra"),
    ("Rebaixo", "Torno / CNC"),
    ("Forja", "Forja"),
    ("Rebarba", "Prensa hidráulica"),
    ("Furo", "CNC"),
    ("Laminacao", "Laminadora"),
]

PRODUCTS.update({
    "conector-at": catalog_product("conector-at", "Conector AT", "CNAT", "CONECTOR AT", STANDARD_CABLE_GLAND_STAGES),
    "conector-bt-160": catalog_product("conector-bt-160", "Conector BT 160", "CNBT-160", "CONECTOR BT 160", STANDARD_CABLE_GLAND_STAGES),
    "suporte-160": catalog_product("suporte-160", "Suporte 160", "SU-160", "SUPORTE 160", STANDARD_CLAMP_STAGES),
    "suporte-400": catalog_product("suporte-400", "Suporte 400", "SU-400", "SUPORTE 400", STANDARD_CLAMP_STAGES),
    "eixo-160": catalog_product("eixo-160", "Eixo 160", "EX-160", "EIXO 160", [("Corte", "Serra"), ("Laminacao", "Laminadora")]),
    "eixo-400": catalog_product("eixo-400", "Eixo 400", "EX-400", "EIXO 400", [("Corte", "Serra"), ("Laminacao", "Laminadora")]),
    "eixo-800": catalog_product("eixo-800", "Eixo 800", "EX-800", "EIXO 800", [("Corte", "Serra"), ("Laminacao", "Laminadora")]),
    "pino-guia": catalog_product("pino-guia", "Pino guia", "PGUIA", "PINO GUIA", [("Corte", "Serra"), ("Rebaixo", "Torno / CNC"), ("Forja", "Forja"), ("Rebarba", "Prensa hidráulica"), ("Laminacao", "Laminadora")]),
    "conector-bt-400": catalog_product("conector-bt-400", "Conector BT 400", "CNBT-400", "CONECTOR BT 400", STANDARD_CABLE_GLAND_STAGES),
    "placa-160": catalog_product("placa-160", "Placa 160", "PL-160", "PLACA 160", STANDARD_CLAMP_STAGES),
    "placa-400": catalog_product("placa-400", "Placa 400", "PL-400", "PLACA 400", STANDARD_CLAMP_STAGES),
    "placa-800": catalog_product("placa-800", "Placa 800", "PL-800", "PLACA 800", STANDARD_CLAMP_STAGES),
    "bucha-at": catalog_product("bucha-at", "Bucha at", "BU-AT", "BUCHA AT", [("Corte", "Serra"), ("Forja", "Forja"), ("Rebarba", "Prensa hidráulica"), ("Usinagem", "CNC")]),
})


BRASS_RODS = {
    "15.880": "VERGALHAO LATAO 15,880",
    "25.400": "VERGALHAO LATAO 25,400",
    "28.570": "VERGALHAO LATAO 28,570",
    "38.100": "VERGALHAO LATAO 38,100",
    "50.800": "VERGALHAO LATAO 50,800",
    "53.970": "VERGALHAO LATAO 53,970",
}
COPPER_RODS = {
    "8.800": "VERGALHAO COBRE 8,80 DURO",
    "14.500": "VERGALHAO COBRE 14,50 DURO",
    "21.800": "VERGALHAO COBRE 21,800 DURO",
}
PRODUCT_ROD_DIAMETERS = {
    "SUPORTE 160": "28.570",
    "PLACA 160": "38.100",
    "SUPORTE 400": "38.100",
    "PLACA 400": "50.800",
    "PLACA 800": "53.970",
    "BUCHA AT": "25.400",
    "PINO GUIA": "15.880",
    "CONECTOR AT": "15.880",
    "CONECTOR BT 160": "25.400",
    "CONECTOR BT 400": "25.400",
    "EIXO 160": "8.800",
    "EIXO 400": "14.500",
    "EIXO 800": "21.800",
}
TOTVS_DESTINATION_NAMES = {
    "SUPORTE 160": "160 SUPORTE",
    "PLACA 160": "160 PLACA",
    "SUPORTE 400": "400 SUPORTE",
    "PLACA 400": "400 PLACA",
    "PLACA 800": "800 PLACA",
    "PINO GUIA": "PINO GUIA",
    "CONECTOR AT": "CONECTOR AT",
    "CONECTOR BT 160": "CONECTOR BT 160",
    "CONECTOR BT 400": "CONECTOR BT 400",
    "EIXO 160": "EIXO 160",
    "EIXO 400": "EIXO 400",
    "EIXO 800": "EIXO 800",
    "BUCHA AT": "BUCHA AT",
}
def tracking_stage(code: str, stage: str, process: str, weight_kg: float, machine: str | None = None) -> dict[str, Any]:
    return {"code": code, "stage": stage, "process": process, "weight_kg": weight_kg, "machine": machine}


TRACKING_STAGE_DATA = {
    "PLACA 160": [tracking_stage("5119", "BLANK", "Corte", .323, "PP 110"), tracking_stage("125120", "FORJA", "Forja", .323, "FORJA 3"), tracking_stage("135120", "REBARBA", "Rebarba", .256, "PH 1"), tracking_stage("145120", "USINAGEM", "Usinagem", .214, "CNC 2"), tracking_stage("5121", "PRE-ACABADO", "Pré-acabado", .292, "SOLDA 2")],
    "PLACA 400": [tracking_stage("5160", "BLANK", "Corte", .804), tracking_stage("125161", "FORJA", "Forja", .804), tracking_stage("135161", "REBARBA", "Rebarba", .700, "CNC 5"), tracking_stage("145161", "USINAGEM", "Usinagem", .599, "SOLDA 1"), tracking_stage("5162", "PRE-ACABADO", "Pré-acabado", .854)],
    "PLACA 800": [tracking_stage("5856", "BLANK", "Corte", 2.254), tracking_stage("125857", "FORJA", "Forja", 2.254), tracking_stage("135857", "REBARBA", "Rebarba", 1.941), tracking_stage("145857", "USINAGEM", "Usinagem", 1.530), tracking_stage("5858", "PRE-ACABADO", "Pré-acabado", 2.366)],
    "SUPORTE 160": [tracking_stage("5177", "BLANK", "Corte", .270), tracking_stage("125178", "FORJA", "Forja", .270), tracking_stage("135178", "REBARBA", "Rebarba", .216), tracking_stage("145178", "USINAGEM", "Usinagem", .175, "SOLDA 1"), tracking_stage("5179", "PRE-ACABADO", "Pré-acabado", .253)],
    "SUPORTE 400": [tracking_stage("5497", "BLANK", "Corte", .596), tracking_stage("125498", "FORJA", "Forja", .596), tracking_stage("135498", "REBARBA", "Rebarba", .481), tracking_stage("145498", "USINAGEM", "Usinagem", .376), tracking_stage("5502", "PRE-ACABADO", "Pré-acabado", .637)],
    "EIXO 160": [tracking_stage("115118", "BLANK", "Corte", .076), tracking_stage("165118", "LAMINAÇÃO", "Laminacao", .076, "LAMI. 1")],
    "EIXO 400": [tracking_stage("115159", "BLANK", "Corte", .259), tracking_stage("165159", "LAMINAÇÃO", "Laminacao", .259)],
    "EIXO 800": [tracking_stage("115377", "BLANK", "Corte", .796), tracking_stage("165377", "LAMINAÇÃO", "Laminacao", .796)],
    "CONECTOR AT": [tracking_stage("5205", "BLANK", "Corte", .141, "TORNO"), tracking_stage("125205", "REBAIXO", "Rebaixo", .107, "CNC 3"), tracking_stage("135205", "FORJA", "Forja", .107, "FORJA 1"), tracking_stage("145205", "REBARBA", "Rebarba", .098), tracking_stage("155205", "FURO", "Furo", .085, "CNC 1"), tracking_stage("5206", "LAMINAÇÃO", "Laminacao", .085)],
    "CONECTOR BT 160": [tracking_stage("5180", "BLANK", "Corte", .262), tracking_stage("125180", "REBAIXO", "Rebaixo", .156), tracking_stage("135180", "FORJA", "Forja", .156), tracking_stage("145180", "REBARBA", "Rebarba", .124), tracking_stage("155180", "FURO", "Furo", .093), tracking_stage("5181", "LAMINAÇÃO", "Laminacao", .093)],
    "CONECTOR BT 400": [tracking_stage("5494", "BLANK", "Corte", .470), tracking_stage("135494", "REBAIXO", "Rebaixo", .325), tracking_stage("145494", "FORJA", "Forja", .325), tracking_stage("155494", "REBARBA", "Rebarba", .219), tracking_stage("165494", "FURO", "Furo", .221), tracking_stage("5495", "LAMINAÇÃO", "Laminacao", .221)],
    "BUCHA AT": [tracking_stage("5189", "BLANK", "Corte", .415), tracking_stage("125189", "FORJA", "Forja", .415, "FORJA 2"), tracking_stage("135189", "REBARBA", "Rebarba", .365), tracking_stage("5190", "USINAGEM", "Usinagem", .282, "CNC 4")],
    "PINO GUIA": [tracking_stage("5218", "BLANK", "Corte", .120), tracking_stage("125218", "REBAIXO", "Rebaixo", .082, "FORJA 2"), tracking_stage("135218", "FORJA", "Forja", .082), tracking_stage("145218", "REBARBA", "Rebarba", .063), tracking_stage("5219", "LAMINAÇÃO", "Laminacao", .063)],
}
TOTVS_DESTINATION_CODES = {
    product_name: {item["code"]: item["stage"] for item in stages}
    for product_name, stages in TRACKING_STAGE_DATA.items()
}

# "Pré-acabado" é a peça pronta para o acabamento final, e a operação que a
# entrega muda por família: Laminação nos conectors e no Pino guia,
# Usinagem no Bucha at, Solda nos Placas e Suportes. Em todas elas isso já é
# a última etapa da rota cadastrada.
#
# A Eixo é a exceção e não cabe nessa conta: ela NÃO vira pré-acabada. Sai da
# Laminação como componente e vai para a Solda ser unida ao Placa.
COMPONENT_PRODUCTS = {"EIXO 160", "EIXO 400", "EIXO 800"}

for product in PRODUCTS.values():
    product["route_output"] = (
        "componente" if product["database_name"] in COMPONENT_PRODUCTS else "pre_acabado"
    )
    diameter = PRODUCT_ROD_DIAMETERS.get(product["database_name"])
    if not diameter:
        product["rod"] = "Matéria-prima ainda não mapeada"
        product["rod_diameter_mm"] = None
        product["rod_available"] = None
        product["rod_material"] = None
        continue
    is_copper = product["database_name"].startswith("EIXO ")
    material_catalog = COPPER_RODS if is_copper else BRASS_RODS
    material_name = "COBRE 110 1/2 DURO" if is_copper else "LATÃO 377 1/2 DURO"
    material_prefix = "VERGALHAO COBRE" if is_copper else "VERGALHAO LATAO"
    available_label = material_catalog.get(diameter)
    product["rod"] = available_label or f'{material_prefix} {diameter.replace(".", ",")} · não disponível'
    product["rod_diameter_mm"] = diameter
    product["rod_available"] = bool(available_label)
    product["rod_material"] = material_name
    product["totvs_destination_name"] = TOTVS_DESTINATION_NAMES.get(product["database_name"], product["database_name"])
    product["totvs_destination_code_stages"] = TOTVS_DESTINATION_CODES.get(product["database_name"], {})
    product["totvs_destination_codes"] = list(product["totvs_destination_code_stages"])
    if product["totvs_destination_codes"]:
        product["code"] = product["totvs_destination_codes"][0]
    stage_specs = deepcopy(TRACKING_STAGE_DATA.get(product["database_name"], []))
    for index, spec in enumerate(stage_specs):
        next_weight = stage_specs[index + 1]["weight_kg"] if index + 1 < len(stage_specs) else spec["weight_kg"]
        spec["scrap_to_next_kg_per_piece"] = round(max(spec["weight_kg"] - next_weight, 0), 6)
        if index < len(product["stages"]):
            product["stages"][index]["tracking_name"] = spec["process"]
            product["stages"][index]["totvs_stage"] = spec["stage"]
            product["stages"][index]["totvs_code"] = spec["code"]
            product["stages"][index]["unit_weight_kg"] = spec["weight_kg"]
            product["stages"][index]["scrap_to_next_kg_per_piece"] = spec["scrap_to_next_kg_per_piece"]
            product["stages"][index]["machine"] = spec["machine"] or "Não informado"
    product["tracking_stages"] = stage_specs
    product["blank_weight_kg"] = stage_specs[0]["weight_kg"] if stage_specs else None
    product["pieces_per_kg"] = round(1 / product["blank_weight_kg"], 3) if product["blank_weight_kg"] else None
    product.update({
        "lots": [], "wallet": 0, "finished": 0, "warehouse_kg": 0,
        "required_kg": 0, "transferred_kg": 0, "consumed_kg": 0,
        "estimated_pieces": 0, "actual_pieces": 0, "estimated_scrap_kg": 0,
        "actual_scrap_kg": 0, "wip": 0, "prefinished": 0, "yield_percent": 0,
        "planning_connected": False, "consumption_connected": False,
    })
    for stage in product["stages"]:
        stage.update({"reported": 0, "loss": 0, "waiting": 0, "status": "empty"})


def product_summary(product: dict[str, Any]) -> dict[str, Any]:
    shortage = max(product["required_kg"] - product["warehouse_kg"], 0)
    uncovered = max(product["wallet"] - product["finished"] - product["wip"], 0)
    coverage = min((product["finished"] + product["wip"]) / product["wallet"] * 100, 100) if product["wallet"] else 0
    return {
        **product,
        "shortage_kg": shortage,
        "uncovered_wallet": uncovered,
        "coverage_percent": round(coverage, 1),
    }


def format_number_br(value: float | int, decimals: int = 0) -> str:
    formatted = f"{value:,.{decimals}f}"
    return formatted.replace(",", "_").replace(".", ",").replace("_", ".")


def _apply_live_production(
    result: dict[str, Any],
    totals_by_process: dict[str, dict[str, Any]],
    open_lots: list[dict[str, Any]],
    date_from: str | None,
    date_to: str | None,
) -> dict[str, Any]:
    """Projeta apontamentos e lotes abertos sobre a peça.

    Regra única de cálculo do WIP e das perdas por etapa: a Central e o
    controle da peça usam exatamente esta função, mudando apenas a origem dos
    totais (consulta individual ou consulta em lote).
    """
    latest_dates: list[str] = []

    for stage in result["stages"]:
        live = totals_by_process.get(stage["name"].upper())
        if live:
            stage["reported"] = live["quantity"]
            stage["loss"] = live["loss"]
            stage["last_date"] = live["last_date"]
            if live["last_date"]:
                latest_dates.append(live["last_date"])
        else:
            stage["reported"] = 0
            stage["loss"] = 0
            stage["last_date"] = None
        process_names = {stage["name"], stage.get("tracking_name", stage["name"])}
        stage_lots = [lot for lot in open_lots if lot["current_process"] in process_names]
        stage["awaiting_pieces"] = sum(
            lot["quantity_pieces"] for lot in stage_lots
            if lot["status"] in {"waiting", "awaiting_next"}
        )
        stage["guarded_pieces"] = sum(lot["quantity_pieces"] for lot in stage_lots if lot["status"] == "guarded")
        stage["in_process_pieces"] = sum(lot["quantity_pieces"] for lot in stage_lots if lot["status"] == "in_process")
        stage["waiting"] = stage["awaiting_pieces"]
        total = stage["reported"] + stage["loss"]
        unit_weight = float(stage.get("unit_weight_kg") or 0)
        process_reduction = float(stage.get("scrap_to_next_kg_per_piece") or 0)
        stage["rejection_scrap_kg"] = round(stage["loss"] * unit_weight, 3)
        stage["process_scrap_kg"] = round(stage["reported"] * process_reduction, 3)
        stage["total_scrap_kg"] = round(stage["rejection_scrap_kg"] + stage["process_scrap_kg"], 3)
        loss_rate = stage["loss"] / total * 100 if total else 0
        stage["status"] = "empty" if not total else "critical" if loss_rate >= 5 else "attention" if loss_rate >= 2 else "normal"

    unidentified_lots: list[dict[str, Any]] = []
    for index in range(1, len(result["stages"])):
        previous_stage = result["stages"][index - 1]
        current_stage = result["stages"][index]
        transition_balance = max(
            previous_stage["reported"] - current_stage["reported"] - current_stage["loss"],
            0,
        )
        identified_at_process = (
            current_stage["awaiting_pieces"]
            + current_stage["guarded_pieces"]
            + current_stage["in_process_pieces"]
        )
        unidentified = max(transition_balance - identified_at_process, 0)
        current_stage["unidentified_waiting_pieces"] = unidentified
        current_stage["awaiting_pieces_total"] = current_stage["awaiting_pieces"] + unidentified
        if unidentified:
            unidentified_lots.append({
                "lot_id": "LOTE INDEFINIDO",
                "position_key": f'UNDEFINED:{result["id"]}:{index}',
                "product_id": result["id"],
                "product_name": result["name"],
                "material_lot_id": "",
                "previous_process": previous_stage.get("tracking_name", previous_stage["name"]),
                "current_process": current_stage.get("tracking_name", current_stage["name"]),
                "quantity_pieces": unidentified,
                "rod_kg": None,
                "status": "awaiting_next",
                "hold_reason": "Saldo calculado entre operações; lote ainda não identificado.",
                "unidentified": True,
            })

    if result["stages"]:
        result["stages"][0]["unidentified_waiting_pieces"] = 0
        result["stages"][0]["awaiting_pieces_total"] = result["stages"][0]["awaiting_pieces"]

    last_stage = result["stages"][-1] if result["stages"] else None
    result["actual_pieces"] = last_stage["reported"] if last_stage else 0
    result["prefinished"] = result["actual_pieces"]
    result["wip"] = sum(lot["quantity_pieces"] for lot in open_lots)
    result["unidentified_wip"] = sum(lot["quantity_pieces"] for lot in unidentified_lots)
    result["visible_wip"] = result["wip"] + result["unidentified_wip"]
    result["unidentified_lots"] = unidentified_lots
    all_reported = sum(stage["reported"] for stage in result["stages"])
    all_losses = sum(stage["loss"] for stage in result["stages"])
    result["actual_scrap_kg"] = round(sum(stage.get("total_scrap_kg", 0) for stage in result["stages"]), 3)
    result["yield_percent"] = round(all_reported / (all_reported + all_losses) * 100, 1) if all_reported + all_losses else 0
    result["production_source"] = "PostgreSQL / Apontamentos"
    result["production_period"] = {"from": date_from, "to": date_to}
    result["last_production_date"] = max(latest_dates) if latest_dates else None
    return result


def product_with_live_production(product: dict[str, Any], date_from: str | None, date_to: str | None) -> dict[str, Any]:
    result = deepcopy(product)
    rows = query_process_totals(result["database_name"], date_from, date_to)
    totals_by_process = {row["process"]: row for row in rows}
    try:
        open_lots = [lot for lot in list_production_lots(result["id"]) if lot["status"] != "completed"]
    except Exception:
        open_lots = []
    return _apply_live_production(result, totals_by_process, open_lots, date_from, date_to)


def _product_control_start(product_id: str, requested_from: str | None) -> str:
    historical_products = {"placa-160", "conector-at"}
    return system_start_date().isoformat() if product_id in historical_products else (requested_from or INVENTORY_DATE.isoformat())


def _traceability_history_start(product_id: str, effective_from: str) -> str:
    return (
        system_start_date().isoformat()
        if product_id in {"placa-160", "conector-at"}
        else max(effective_from, INVENTORY_DATE.isoformat())
    )


def _opening_inventory_snapshot(
    product: dict[str, Any], rows: list[dict[str, Any]], reference_date: str
) -> dict[str, Any]:
    """Projeta somente as posições físicas informadas no inventário atual."""
    result = deepcopy(product)
    positions = [row for row in rows if row.get("product_id") == result["id"]]
    total_wip = 0.0
    total_completed = 0.0
    for stage in result["stages"]:
        names = {str(stage.get("name") or "").casefold(), str(stage.get("tracking_name") or "").casefold()}
        stage_positions = [row for row in positions if str(row.get("process") or "").casefold() in names]
        awaiting = sum(float(row.get("piece_quantity") or 0) for row in stage_positions if row.get("position_status") == "waiting")
        in_process = sum(float(row.get("piece_quantity") or 0) for row in stage_positions if row.get("position_status") == "in_process")
        completed = sum(float(row.get("piece_quantity") or 0) for row in stage_positions if row.get("position_status") == "completed")
        quantity = awaiting + in_process
        total_wip += quantity
        total_completed += completed
        stage.update({
            "reported": completed, "loss": 0, "last_date": reference_date if completed else None,
            "awaiting_pieces": awaiting, "guarded_pieces": 0, "in_process_pieces": in_process,
            "waiting": awaiting, "unidentified_waiting_pieces": 0, "awaiting_pieces_total": awaiting,
            "rejection_scrap_kg": 0, "process_scrap_kg": 0, "total_scrap_kg": 0,
            "status": "normal" if quantity else "empty",
        })
    result.update({
        "actual_pieces": total_completed, "prefinished": total_completed, "wip": total_wip, "visible_wip": total_wip,
        "unidentified_wip": 0, "unidentified_lots": [], "actual_scrap_kg": 0,
        "yield_percent": 0, "production_source": "Inventário de Abertura",
        "production_period": {"from": reference_date, "to": reference_date},
        "last_production_date": None,
    })
    return result


def _conector_at_torno_snapshot(
    product: dict[str, Any],
    opening_rows: list[dict[str, Any]],
    events: list[Any],
    material_lots: list[dict[str, Any]],
    reference_date: str,
) -> dict[str, Any]:
    """Sobrepõe no inventário apenas o Rebaixo/Torno coberto por transferência."""
    result = _opening_inventory_snapshot(product, opening_rows, reference_date)
    transfer_dates = []
    for lot in material_lots:
        raw_date = str(lot.get("date") or "")
        try:
            transfer_dates.append(datetime.strptime(raw_date, "%d/%m/%Y").date())
        except ValueError:
            continue
    if not transfer_dates:
        return result

    first_transfer = min(transfer_dates)
    valid_events = [
        event for event in events
        if str(event.process).strip().upper() == "REBAIXO"
        and str(event.machine).strip().upper().startswith("TORNO")
        and event.occurred_at.date() >= first_transfer
    ]
    if not valid_events:
        return result

    stage = next(
        (
            row for row in result["stages"]
            if str(row.get("name") or "").casefold() == "rebaixo"
            or str(row.get("tracking_name") or "").casefold() == "rebaixo"
        ),
        None,
    )
    if stage is None:
        return result

    opening_wip = result["wip"]
    stage.update({
        "reported": sum(float(event.good_pieces) for event in valid_events),
        "loss": sum(float(event.loss_pieces) for event in valid_events),
        "last_date": max(event.occurred_at.date() for event in valid_events).isoformat(),
        "machine": "TORNO",
        "status": "normal",
    })
    torno_pieces = stage["reported"]
    stage.update({
        "awaiting_pieces": torno_pieces,
        "waiting": torno_pieces,
        "awaiting_pieces_total": torno_pieces,
    })
    result.update({
        "wip": opening_wip if opening_wip > 0 else torno_pieces,
        "visible_wip": opening_wip if opening_wip > 0 else torno_pieces,
        "last_production_date": stage["last_date"],
    })
    return result


def _controlled_product(product_id: str, date_from: str | None, date_to: str | None) -> dict[str, Any]:
    if product_id == "placa-160":
        return product_with_live_production(PRODUCTS[product_id], _product_control_start(product_id, date_from), date_to)
    try:
        opening_rows = list_opening_inventory(INVENTORY_DATE)
    except Exception:
        opening_rows = []
    if product_id == "conector-at":
        try:
            totvs = query_totvs_material(PRODUCTS[product_id])
            events = query_process_events(
                PRODUCTS[product_id]["database_name"],
                _product_control_start(product_id, date_from),
                date_to,
            )
            return _conector_at_torno_snapshot(
                PRODUCTS[product_id],
                opening_rows,
                events,
                list(totvs.get("lots") or []),
                INVENTORY_DATE.isoformat(),
            )
        except Exception:
            pass
    return _opening_inventory_snapshot(PRODUCTS[product_id], opening_rows, INVENTORY_DATE.isoformat())


def _apply_traceability_to_stages(
    product: dict[str, Any],
    snapshot: dict[str, Any],
    events: list[Any],
) -> dict[str, Any]:
    """Projeta peças produzidas e saldo entre etapas a partir do mesmo motor
    de rastreabilidade por lote de vergalhão usado na aba "Balanço do
    vergalhão", em vez do inventário de abertura congelado
    (`_opening_inventory_snapshot`), que nunca soube de apontamento novo.

    `snapshot["stages"][i]["available_pieces"]` já resolve, por etapa,
    quantas peças estão aguardando ali (abertura + lote identificado) e
    `unmatched_pieces` já isola o que a própria rastreabilidade não conseguiu
    conciliar — não há mais necessidade do cálculo por diferença de totais.
    """
    result = deepcopy(product)
    stage_positions = {row["process"]: row for row in snapshot.get("stages", [])}

    # O chão de fábrica aponta pelo nome que usa (ex.: "Solda"); a rota conhece
    # a operação por outro ("Pré-acabado"). Sem traduzir, a produção apontada
    # não aparece na etapa.
    aliases = build_route_aliases(result)

    totals_by_process: dict[str, dict[str, Any]] = {}
    for event in events:
        key = _tb_process(event.process)
        key = aliases.get(key, key)
        bucket = totals_by_process.setdefault(key, {"quantity": 0.0, "loss": 0.0, "last_date": None})
        bucket["quantity"] += float(event.good_pieces)
        bucket["loss"] += float(event.loss_pieces)
        event_date = event.occurred_at.date().isoformat()
        if not bucket["last_date"] or event_date > bucket["last_date"]:
            bucket["last_date"] = event_date

    try:
        open_lots = [lot for lot in list_production_lots(result["id"]) if lot["status"] != "completed"]
    except Exception:
        open_lots = []

    unidentified_lots: list[dict[str, Any]] = []
    latest_dates: list[str] = []
    # A fila é guardada pelo motor com a chave da operação que VAI consumi-la:
    # a fila "FORJA" é peça cortada esperando forja. Na tela, porém, essa pilha
    # pertence a quem a PRODUZIU — ela está fisicamente na saída do Corte, e é
    # no cartão do Corte que o operador procura por ela. Por isso cada etapa
    # exibe a fila da etapa SEGUINTE.
    stage_keys = [
        _tb_process(row.get("tracking_name") or row["name"]) for row in result["stages"]
    ]
    for index, stage in enumerate(result["stages"]):
        process_key = stage_keys[index]
        live = totals_by_process.get(process_key)
        if live:
            stage["reported"] = live["quantity"]
            stage["loss"] = live["loss"]
            stage["last_date"] = live["last_date"]
            if live["last_date"]:
                latest_dates.append(live["last_date"])
        else:
            stage["reported"] = 0
            stage["loss"] = 0
            stage["last_date"] = None

        process_names = {stage["name"], stage.get("tracking_name", stage["name"])}
        stage_lots = [lot for lot in open_lots if lot["current_process"] in process_names]
        stage["guarded_pieces"] = sum(lot["quantity_pieces"] for lot in stage_lots if lot["status"] == "guarded")
        stage["in_process_pieces"] = sum(lot["quantity_pieces"] for lot in stage_lots if lot["status"] == "in_process")

        next_key = stage_keys[index + 1] if index + 1 < len(stage_keys) else None
        is_final_step = next_key is None
        queue_position = stage_positions.get(next_key) if next_key else None
        own_position = stage_positions.get(process_key)
        # Peça sem conciliação continua no cartão de quem a apontou: ela não
        # está na fila, foi produzida ali e seguiu sem origem rastreável.
        available = float(queue_position["available_pieces"]) if queue_position else 0.0
        unmatched = float(own_position["unmatched_pieces"]) if own_position else 0.0
        stage["awaiting_pieces"] = available
        stage["waiting"] = available
        stage["awaiting_for_process"] = next_key if available > 0 else None
        stage["unidentified_waiting_pieces"] = unmatched
        # A soma junta duas posições diferentes de propósito: `available` é a
        # fila que espera ANTES desta etapa e `unmatched` são peças apontadas
        # aqui que já passaram por ela sem origem rastreável. As duas estão no
        # chão de fábrica, e o painel da rota mostra o total — decisão do
        # usuário (04/09/2026), não descuido. O cartão nomeia cada parcela na
        # nota, então o número grande continua auditável.
        #
        # A ÚLTIMA operação é a exceção: ali (a Solda, apontada como
        # Pré-acabado) o apontamento é peça PRONTA, já contada em
        # `actual_pieces`. Somá-la ao chão de fábrica contaria a mesma peça
        # duas vezes — como produzida e como parada. Ela continua aparecendo
        # em Divergências, que é onde a falta de lote é tratada.
        stage["awaiting_pieces_total"] = available if is_final_step else available + unmatched

        total = stage["reported"] + stage["loss"]
        unit_weight = float(stage.get("unit_weight_kg") or 0)
        process_reduction = float(stage.get("scrap_to_next_kg_per_piece") or 0)
        stage["rejection_scrap_kg"] = round(stage["loss"] * unit_weight, 3)
        stage["process_scrap_kg"] = round(stage["reported"] * process_reduction, 3)
        stage["total_scrap_kg"] = round(stage["rejection_scrap_kg"] + stage["process_scrap_kg"], 3)
        loss_rate = stage["loss"] / total * 100 if total else 0
        stage["status"] = "empty" if not total else "critical" if loss_rate >= 5 else "attention" if loss_rate >= 2 else "normal"

        if unmatched and not is_final_step:
            unidentified_lots.append({
                "lot_id": "LOTE INDEFINIDO",
                "position_key": f'UNDEFINED:{result["id"]}:{process_key}',
                "product_id": result["id"],
                "product_name": result["name"],
                "material_lot_id": "",
                "previous_process": "",
                "current_process": stage.get("tracking_name", stage["name"]),
                "quantity_pieces": unmatched,
                "rod_kg": None,
                "status": "awaiting_next",
                "hold_reason": "Rastreabilidade não conseguiu conciliar com nenhum lote de vergalhão.",
                "unidentified": True,
            })

    last_stage = result["stages"][-1] if result["stages"] else None
    result["actual_pieces"] = last_stage["reported"] if last_stage else 0
    result["prefinished"] = result["actual_pieces"]
    result["wip"] = sum(
        stage["awaiting_pieces"] + stage["guarded_pieces"] + stage["in_process_pieces"]
        for stage in result["stages"]
    )
    result["unidentified_wip"] = sum(lot["quantity_pieces"] for lot in unidentified_lots)
    result["visible_wip"] = result["wip"] + result["unidentified_wip"]
    result["unidentified_lots"] = unidentified_lots
    all_reported = sum(stage["reported"] for stage in result["stages"])
    all_losses = sum(stage["loss"] for stage in result["stages"])
    result["actual_scrap_kg"] = round(sum(stage.get("total_scrap_kg", 0) for stage in result["stages"]), 3)
    result["yield_percent"] = round(all_reported / (all_reported + all_losses) * 100, 1) if all_reported + all_losses else 0
    result["production_source"] = "Rastreabilidade por lote (TOTVS + Apontamentos)"
    result["production_period"] = snapshot.get("period", {})
    result["last_production_date"] = max(latest_dates) if latest_dates else None
    return result


def _controlled_product_detail(product_id: str, date_from: str | None, date_to: str | None) -> dict[str, Any]:
    """Como `_controlled_product`, mas para a tela de uma única peça.

    Aqui vale pagar o custo de uma consulta ao TOTVS para unificar a Rota de
    Produção com a mesma rastreabilidade por lote já usada na aba de
    vergalhão -- diferente da Central (`_controlled_product`, usada nas 13
    peças de uma vez), onde isso seria uma consulta TOTVS por peça a cada
    carregamento do painel.
    """
    try:
        snapshot, events = _build_traceability_snapshot(product_id, date_from, date_to)
        return _apply_traceability_to_stages(PRODUCTS[product_id], snapshot, events)
    except Exception:
        try:
            opening_rows = list_opening_inventory(INVENTORY_DATE)
        except Exception:
            opening_rows = []
        return _opening_inventory_snapshot(PRODUCTS[product_id], opening_rows, INVENTORY_DATE.isoformat())


UNMATCHED_REASON_CAUSES: dict[str, list[str]] = {
    "Saldo de vergalhão insuficiente": [
        "Lote de vergalhão foi consumido integralmente antes de todas as peças apontadas serem processadas.",
        "Peso do blank cadastrado não confere com o peso real do vergalhão usado no corte.",
        "Transferência de vergalhão para esta peça no TOTVS ainda não foi lançada ou está incompleta.",
    ],
    "Sem saldo do mesmo lote na etapa anterior": [
        "Contagem do inventário de abertura ficou abaixo do que havia de fato parado nessa posição.",
        "Operação anterior executada e ainda não apontada, ou apontada com data posterior à do serviço.",
        "Apontamento de produto ou etapa errada por engano na digitação.",
    ],
    "Consumo de vergalhão temporariamente bloqueado": [
        "Bloqueio temporário de consumo (variável FLOW_MATERIAL_CONSUMPTION_LOCKED_FROM) ainda ativo para apontamentos deste período.",
    ],
    "Processo não pertence à rota cadastrada": [
        "Apontamento lançado com o nome do processo escrito de forma diferente da rota cadastrada (ex.: \"Solda\" em vez de \"Pré-acabado\").",
        "Etapa nova ou temporária no chão de fábrica que ainda não foi cadastrada na rota do produto.",
        "Apontamento de outro produto ou linha, lançado por engano nesta peça.",
    ],
    "Máquina ausente ou desconhecida para a rota da Conector AT": [
        "Campo de máquina do apontamento veio vazio ou com nome não reconhecido (esperado algo iniciado por SERRA ou TORNO).",
        "Apontamento de Corte/Rebaixo da Conector AT lançado sem informar a máquina, impedindo decidir se é Corte (serra) ou Rebaixo direto no torno.",
    ],
}
DEFAULT_UNMATCHED_CAUSES = ["Causa não mapeada; revisar o apontamento e o lote de vergalhão manualmente."]

SEM_SALDO_VERGALHAO = "Saldo de vergalhão insuficiente"
SEM_SALDO_ETAPA_ANTERIOR = "Sem saldo do mesmo lote na etapa anterior"

# As chaves acima são internas do motor e não mudam — outras partes do sistema
# dependem delas. Na tela, porém, "sem saldo do mesmo lote na etapa anterior"
# não diz nada a quem está no chão de fábrica.
REASON_HEADLINE = {
    SEM_SALDO_ETAPA_ANTERIOR: "Apontou mais peça do que a etapa anterior entregou",
    SEM_SALDO_VERGALHAO: "Cortou mais peça do que o vergalhão transferido dá",
}

# Peça produzida antes de existir transferência de vergalhão não tem lote a
# atribuir — é a condição de origem do controle, não uma falha operacional.
ORIGIN_CAUSES_CUT = [
    "A peça foi cortada antes de existir transferência de vergalhão para ela no TOTVS: não há lote a atribuir.",
    "Assim que a transferência passar a ser lançada com o Número de Série preenchido, as peças novas nascem com lote.",
]
ORIGIN_CAUSES_DOWNSTREAM = [
    "Consequência do corte sem lote: as operações seguintes consomem peças que nunca tiveram lote de origem.",
    "Some junto quando o corte da peça passar a ter transferência lançada.",
]


# Operações que o motor cria e a rota não cadastra: na Conector AT o torno faz
# corte e rebaixo numa passada só, e o passo combinado não tem nome no TOTVS.
SYNTHETIC_STEP_LABELS = {"CORTE_REBAIXO": "Corte + Rebaixo (torno)"}


def _route_labels(product: dict[str, Any]) -> tuple[list[str], dict[str, str]]:
    """Sequência da rota normalizada e o nome de cada etapa como ela se chama."""
    stages = product.get("tracking_stages") or []
    steps = [_tb_process(str(row.get("process") or "")) for row in stages]
    labels = {
        _tb_process(str(row.get("process") or "")): str(row.get("process") or "")
        for row in stages
    }
    return steps, labels


def _floor_label(product: dict[str, Any], step: str) -> str:
    """Nome da operação como o chão de fábrica a chama.

    A rota registra "Pré-acabado" e quem está na máquina chama de "Solda".
    O diagnóstico é uma ordem de serviço: tem que falar a língua de quem vai
    executá-la, não a do cadastro.
    """
    for stage in product.get("stages") or []:
        tracking = _tb_process(str(stage.get("tracking_name") or stage.get("name") or ""))
        if tracking == step:
            return str(stage.get("name") or "") or _step_label(product, step)
    return _step_label(product, step)


def _both_labels(product: dict[str, Any], step: str) -> str:
    """"Solda (Pré-acabado)" quando os dois nomes diferem; só um quando não."""
    floor = _floor_label(product, step)
    route = _step_label(product, step)
    return floor if floor == route else f"{floor} ({route})"


def _step_label(product: dict[str, Any], step: str) -> str:
    """Nome legível de uma etapa; nunca devolve a chave crua do motor."""
    _steps, labels = _route_labels(product)
    if step in labels:
        return labels[step]
    if step in SYNTHETIC_STEP_LABELS:
        return SYNTHETIC_STEP_LABELS[step]
    return step.replace("_", " ").capitalize()


def _daily_reported(events: list[Any], aliases: dict[str, str]) -> dict[tuple[str, str], float]:
    """(etapa, dia) -> peças boas apontadas. Base de todo diagnóstico por data."""
    totals: dict[tuple[str, str], float] = {}
    for event in events:
        step = _tb_process(event.process)
        step = aliases.get(step, step)
        day = event.occurred_at.date().isoformat()
        totals[(step, day)] = totals.get((step, day), 0.0) + float(event.good_pieces)
    return totals


def _day_label(iso_day: str) -> str:
    return f"{iso_day[8:10]}/{iso_day[5:7]}"


def _shortfall_by_day(
    rows: list[tuple[str, float]],
    events_by_key: dict[str, Any],
) -> dict[str, float]:
    """Quanto faltou em cada dia, a partir dos apontamentos que não conciliaram."""
    by_day: dict[str, float] = {}
    for source_key, pieces in rows:
        event = events_by_key.get(source_key)
        if event is None:
            continue
        day = event.occurred_at.date().isoformat()
        by_day[day] = by_day.get(day, 0.0) + pieces
    return by_day


def _diagnose_previous_stage(
    product: dict[str, Any],
    process: str,
    rows: list[tuple[str, float]],
    events_by_key: dict[str, Any],
    daily: dict[tuple[str, float], float],
    snapshot: dict[str, Any],
) -> list[str]:
    """Diz em que dia a etapa apontou mais do que a anterior entregou.

    Uma causa possível genérica ("apontamento fora de ordem") não diz a
    ninguém o que fazer. O que resolve é a data, os dois números lado a lado
    e onde as peças estão paradas — isso vira ordem de serviço.
    """
    steps, labels = _route_labels(product)
    if process not in steps:
        return []
    index = steps.index(process)
    if index == 0:
        return []
    previous = steps[index - 1]
    previous_label = _floor_label(product, previous)

    lines: list[str] = []
    consumo: dict[str, dict[str, float]] = snapshot.get("consumption") or {}
    by_day = _shortfall_by_day(rows, events_by_key)
    for posicao, day in enumerate(sorted(by_day)[:5]):
        apontado = daily.get((process, day), 0.0)
        entregue = daily.get((previous, day), 0.0)
        falta = by_day[day]
        # Sem isso a conta não fecha na cabeça de quem lê: "apontou 2.135 e
        # 1.572 ficaram sem origem" deixa 563 sem explicação nenhuma.
        cobertas = max(apontado - falta, 0.0)
        # Só a primeira linha carrega os dois nomes da operação; repetir
        # "Solda (Pré-acabado)" em toda linha vira ruído.
        label = _both_labels(product, process) if posicao == 0 else _floor_label(product, process)
        # Sem artigo antes do nome da operação, e "a etapa X" onde o artigo é
        # inevitável: "o Corte" e "a Forja" mudam de gênero, e um mapa de
        # gênero por etapa quebraria na primeira operação nova.
        entrega = (
            f"{previous_label} não apontou nenhuma"
            if entregue <= 0
            else f"{previous_label} apontou {format_number_br(entregue)}"
        )
        if cobertas > 0:
            # A ORIGEM do que a fila cobriu — e origem aqui acompanha a peça
            # pela rota inteira: peça contada no inventário de abertura segue
            # sendo "de abertura" mesmo depois de passar pela etapa anterior.
            # Por isso "com origem no", e não "vinda do": o texto descreve de
            # onde a peça nasceu no controle, não onde ela foi pega.
            origem = consumo.get(f"{process}|{day}") or {}
            da_abertura = float(origem.get("abertura") or 0)
            do_lote = float(origem.get("lote") or 0)
            if da_abertura > 0 and do_lote > 0:
                detalhe = (
                    f" ({format_number_br(da_abertura)} com origem no inventário"
                    f" de abertura e {format_number_br(do_lote)} rastreadas até"
                    f" lote de vergalhão)"
                )
            elif da_abertura > 0:
                detalhe = " (todas com origem no inventário de abertura)"
            elif do_lote > 0:
                detalhe = " (todas rastreadas até lote de vergalhão)"
            else:
                detalhe = ""
            fecho = (
                f" A fila cobriu {format_number_br(cobertas)}{detalhe};"
                f" as outras {format_number_br(falta)} não tinham peça para consumir."
            )
        else:
            fecho = (
                f" Nenhuma das {format_number_br(falta)} tinha peça na fila"
                f" para consumir."
            )
        lines.append(
            f"{_day_label(day)}: {label} apontou {format_number_br(apontado)} peças;"
            f" {entrega}.{fecho}"
        )
    if len(by_day) > 5:
        lines.append(f"… e mais {len(by_day) - 5} dia(s) com a mesma falta.")

    total_previous = sum(
        pieces for (step, _day), pieces in daily.items() if step == previous
    )
    if total_previous <= 0:
        lines.append(
            f"A etapa {previous_label} não apontou nenhuma peça no período inteiro:"
            f" pelo sistema, essas peças nunca passaram por ela."
        )

    # A etapa anterior não é a única fonte da fila: o inventário de abertura
    # também abastece. Comparar só apontamento com apontamento faz parecer que
    # os dois números tinham que bater sempre — e não tinham, porque parte da
    # peça já estava contada na abertura. Dizer quanto sobrou dali fecha o
    # raciocínio de quem lê.
    fila = next(
        (row for row in snapshot.get("stages", []) if row.get("process") == process),
        None,
    )
    abertura = float(fila.get("opening_pieces") or 0) if fila else 0.0
    if abertura > 0:
        lines.append(
            f"Nessa fila ainda há {format_number_br(abertura)} peças vindas do"
            f" inventário de abertura de {INVENTORY_DATE.strftime('%d/%m/%Y')}."
        )
    else:
        lines.append(
            f"O que o inventário de abertura de {INVENTORY_DATE.strftime('%d/%m/%Y')}"
            f" tinha nessa fila já foi todo consumido — não sobrou nada de lá"
            f" para cobrir a diferença."
        )

    parada = next(
        (row for row in snapshot.get("stages", []) if row.get("process") == previous),
        None,
    )
    disponivel = float(parada.get("available_pieces") or 0) if parada else 0.0
    if disponivel > 0:
        lines.append(
            f"Hoje há {format_number_br(disponivel)} peças esperando a etapa {previous_label}."
            f" Apontar essa operação faz elas andarem e a conta fechar."
        )
    return lines


def _diagnose_origin_downstream(
    product: dict[str, Any],
    process: str,
    first_transfer: datetime | None,
) -> list[str]:
    """Etapa que herdou a falta de lote do corte.

    Aqui NÃO cabe a comparação dia a dia: a peça não faltou naquele dia, ela
    nunca teve lote desde o corte. Mostrar "apontou 3.022 e a anterior
    entregou 4.012" faria procurar um problema de apontamento que não existe.
    """
    label = _step_label(product, process)
    if first_transfer is None:
        return [
            "Não há transferência de vergalhão lançada para esta peça no TOTVS:"
            f" nenhuma etapa tem lote a atribuir, {label} inclusive.",
        ]
    return [
        "O corte desta peça é anterior à primeira transferência de vergalhão,"
        f" em {first_transfer.date().strftime('%d/%m')}:"
        f" {label} está consumindo peça que nunca teve lote de origem.",
    ]


def _diagnose_rod_shortfall(
    product: dict[str, Any],
    process: str,
    rows: list[tuple[str, float]],
    events_by_key: dict[str, Any],
    first_transfer: datetime | None,
) -> list[str]:
    """Diz por que o corte não achou vergalhão: sem transferência, ou antes dela."""
    label = _step_label(product, process)
    lines: list[str] = []

    try:
        totvs = query_totvs_material(product)
    except Exception:
        totvs = {}
    stock_kg = float((totvs.get("stock") or {}).get("total_kg") or 0)
    transferred_kg = float(totvs.get("transferred_kg") or 0)

    if first_transfer is None:
        lines.append(f"Nenhuma transferência de vergalhão lançada para esta peça no TOTVS.")
        if stock_kg > 0:
            lines.append(
                f"Há {format_number_br(stock_kg, 3)} kg do vergalhão em estoque, mas sem"
                f" transferência com o Número de Série preenchido — sem ela não existe"
                f" lote para o {label} consumir."
            )
        return lines

    by_day = _shortfall_by_day(rows, events_by_key)
    anteriores = [day for day in sorted(by_day) if date.fromisoformat(day) < first_transfer.date()]
    if anteriores:
        dias = ", ".join(_day_label(day) for day in anteriores[:5])
        lines.append(
            f"{label} de {dias} é anterior à primeira transferência desta peça,"
            f" em {first_transfer.date().strftime('%d/%m')}: não havia lote a atribuir."
        )
    if transferred_kg > 0:
        lines.append(
            f"Transferido até agora: {format_number_br(transferred_kg, 3)} kg."
            f" O que foi cortado antes disso não tem como ser rastreado."
        )
    return lines


def _first_transfer_at(product: dict[str, Any]) -> datetime | None:
    """Data da transferência de vergalhão mais antiga desta peça, se existir."""
    try:
        totvs = query_totvs_material(product)
    except Exception:
        return None
    if totvs.get("status") == "offline":
        return None
    momentos: list[datetime] = []
    for lot in totvs.get("lots") or []:
        raw = str(lot.get("date") or "")
        try:
            momentos.append(datetime.strptime(raw, "%d/%m/%Y").replace(tzinfo=timezone.utc))
        except ValueError:
            continue
    return min(momentos) if momentos else None


def _divergences_for_product(product_id: str) -> list[dict[str, Any]]:
    """Confere saldo negativo, inconsistência de soma e peças sem conciliação
    para uma peça, com possíveis motivos para cada tipo de divergência.

    Separa o que pede ação do que é condição de origem: onde não houve
    transferência de vergalhão, a peça nunca vai achar lote, e insistir nisso
    como alarme só esconde a divergência que de fato precisa de alguém.
    """
    product = PRODUCTS[product_id]
    try:
        snapshot, events = _build_traceability_snapshot(product_id)
    except Exception as error:
        return [{
            "product_id": product_id,
            "product_name": product["name"],
            "kind": "fonte_indisponivel",
            "classe": "acao",
            "severity": "attention",
            "reference": "TOTVS / Apontamentos",
            "quantity": None,
            "unit": None,
            "reason": str(error)[:200],
            "diagnosis": [],
            "possible_causes": [
                "TOTVS fora do ar ou a consulta expirou.",
                "Configuração local do TOTVS não encontrada nesta máquina.",
                "Banco de apontamentos (Postgres) temporariamente indisponível.",
            ],
        }]

    items: list[dict[str, Any]] = []
    material = snapshot.get("material", {})
    lots = material.get("lots", [])
    remaining_kg = float(material.get("remaining_kg") or 0)
    sum_balance = sum(float(lot["balance_kg"]) for lot in lots)

    for lot in lots:
        balance = float(lot["balance_kg"])
        if balance < -0.001:
            items.append({
                "product_id": product_id,
                "product_name": product["name"],
                "kind": "saldo_negativo",
                "classe": "acao",
                "severity": "critical",
                "reference": f'Lote {lot["lot_id"]}',
                "quantity": round(balance, 3),
                "unit": "kg",
                "reason": "Saldo do lote de vergalhão ficou negativo.",
                "diagnosis": [],
                "possible_causes": [
                    "Consumo lançado maior que o saldo transferido para o lote.",
                    "Erro de digitação numa transferência do TOTVS.",
                    "O mesmo lote sendo consumido por mais de uma peça ao mesmo tempo.",
                ],
            })

    if abs(remaining_kg - sum_balance) > 0.01:
        items.append({
            "product_id": product_id,
            "product_name": product["name"],
            "kind": "saldo_inconsistente",
            "classe": "acao",
            "severity": "critical",
            "reference": "Balanço do vergalhão",
            "quantity": round(remaining_kg - sum_balance, 3),
            "unit": "kg",
            "reason": "Saldo total do vergalhão não bate com a soma dos lotes.",
            "diagnosis": [],
            "possible_causes": ["Erro interno de cálculo na rastreabilidade; reportar ao suporte."],
        })

    # ------- peças sem conciliação, separadas por causa real -------
    events_by_key = {event.source_key: event for event in events}
    first_transfer = _first_transfer_at(product)

    def corte_sem_lote_por_origem(source_key: str) -> bool:
        """O corte aconteceu antes de existir transferência para a peça?"""
        if first_transfer is None:
            return True
        event = events_by_key.get(source_key)
        return event is None or event.occurred_at < first_transfer

    # O corte é a porta de entrada do lote: se ele não tinha transferência, o
    # que vem depois na rota herda a falta de lote em vez de ser problema novo.
    corte_por_origem = any(
        str(row.get("reason") or "") == SEM_SALDO_VERGALHAO
        and float(row.get("pieces") or 0) > 0
        and corte_sem_lote_por_origem(str(row.get("source_key") or ""))
        for row in snapshot.get("unmatched", [])
    )

    # Guarda os apontamentos de cada grupo, não só a soma: é deles que sai a
    # data e o número que transformam o alerta em ordem de serviço.
    grouped_unmatched: dict[tuple[str, str, str], list[tuple[str, float]]] = {}
    for row in snapshot.get("unmatched", []):
        pieces = float(row.get("pieces") or 0)
        if pieces <= 0:
            continue
        reason = str(row.get("reason") or "")
        if reason == SEM_SALDO_VERGALHAO:
            classe = "origem" if corte_sem_lote_por_origem(str(row.get("source_key") or "")) else "acao"
        elif reason == SEM_SALDO_ETAPA_ANTERIOR:
            classe = "origem" if corte_por_origem else "acao"
        else:
            classe = "acao"
        key = (str(row.get("process") or ""), reason, classe)
        grouped_unmatched.setdefault(key, []).append(
            (str(row.get("source_key") or ""), pieces)
        )

    # O chão aponta "Solda"; a rota registra "Pré-acabado". Sem a ponte, o
    # diagnóstico diria que o Pré-acabado não apontou nada.
    aliases = build_route_aliases(product)
    daily = _daily_reported(events, aliases)

    for (process, reason, classe), rows in grouped_unmatched.items():
        pieces = sum(quantity for _key, quantity in rows)
        try:
            if reason == SEM_SALDO_ETAPA_ANTERIOR and classe == "origem":
                diagnosis = _diagnose_origin_downstream(product, process, first_transfer)
            elif reason == SEM_SALDO_ETAPA_ANTERIOR:
                diagnosis = _diagnose_previous_stage(
                    product, process, rows, events_by_key, daily, snapshot
                )
            elif reason == SEM_SALDO_VERGALHAO:
                diagnosis = _diagnose_rod_shortfall(
                    product, process, rows, events_by_key, first_transfer
                )
            else:
                diagnosis = []
        except Exception:
            # Um diagnóstico que falha não pode derrubar o alerta: a
            # divergência continua sendo mostrada, só sem o detalhe.
            diagnosis = []

        if classe == "origem":
            causes = ORIGIN_CAUSES_CUT if reason == SEM_SALDO_VERGALHAO else ORIGIN_CAUSES_DOWNSTREAM
        else:
            causes = UNMATCHED_REASON_CAUSES.get(reason, DEFAULT_UNMATCHED_CAUSES)
        items.append({
            "product_id": product_id,
            "product_name": product["name"],
            "kind": "pecas_sem_lote",
            "classe": classe,
            "severity": "attention",
            # Nome da etapa, não a chave interna ("PRE_ACABADO", "CORTE_REBAIXO").
            "reference": _step_label(product, process),
            "quantity": int(round(pieces)),
            "unit": "peças",
            "reason": REASON_HEADLINE.get(
                reason, reason or "Rastreabilidade não conseguiu conciliar com nenhum lote."
            ),
            # O que foi apurado nesta peça, com data e número. Vazio quando não
            # dá para apurar — aí valem só as hipóteses genéricas.
            "diagnosis": diagnosis,
            "possible_causes": causes,
        })

    return items


@app.get("/api/divergences")
def divergences() -> dict[str, Any]:
    """Varre as 13 peças em paralelo (cada uma paga sua própria consulta ao
    TOTVS) e devolve toda divergência real encontrada: saldo negativo, saldo
    que não bate com a soma dos lotes, e peças que a rastreabilidade não
    conseguiu conciliar com nenhum lote de vergalhão -- sempre com motivos
    possíveis, nunca só o número.
    """
    items: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for result in executor.map(_divergences_for_product, PRODUCTS.keys()):
            items.extend(result)
    severity_order = {"critical": 0, "attention": 1}
    classe_order = {"acao": 0, "origem": 1}
    items.sort(key=lambda item: (
        classe_order.get(item.get("classe", "acao"), 0),
        severity_order.get(item["severity"], 2),
        item["product_name"],
        item["kind"],
    ))
    acao = [item for item in items if item.get("classe", "acao") == "acao"]
    origem = [item for item in items if item.get("classe") == "origem"]
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "items": items,
        # Os contadores de alarme somam só o que pede ação: peça produzida
        # antes de existir transferência não tem o que ser feito a respeito.
        "critical_count": sum(1 for item in acao if item["severity"] == "critical"),
        "attention_count": sum(1 for item in acao if item["severity"] == "attention"),
        "action_count": len(acao),
        "origin_count": len(origem),
        "origin_pieces": int(round(sum(float(item.get("quantity") or 0) for item in origem))),
    }


def _material_lots_for_product(product_id: str) -> list[dict[str, Any]]:
    """Lotes de vergalhão desta peça, com o estado real de consumo.

    Reaproveita o mesmo snapshot da rastreabilidade usado no Balanço do
    Vergalhão -- nenhum novo cálculo de FIFO, só a leitura já pronta.
    """
    product = PRODUCTS[product_id]
    try:
        snapshot, _events = _build_traceability_snapshot(product_id)
    except Exception:
        return []

    try:
        totvs = query_totvs_material(product)
        raw_by_lot_id = {lot["id"]: lot for lot in (totvs.get("lots") or [])}
    except Exception:
        raw_by_lot_id = {}

    blank_weight_kg = float(product.get("blank_weight_kg") or 0) or None

    items: list[dict[str, Any]] = []
    for lot in snapshot["material"].get("lots", []):
        balance = float(lot["balance_kg"])
        consumed = float(lot["consumed_kg"])
        # O estado vem do CONSUMO, não da posição na fila. Antes o primeiro
        # lote com saldo era marcado "em processo" só por ser o próximo do
        # FIFO — um lote recém-transferido, com kg recebido igual ao kg
        # restante, aparecia como se já estivesse na produção.
        if consumed <= 0.001:
            status = "fechado"
        elif balance <= 0.001:
            status = "consumido"
        else:
            status = "em_processo"
        raw = raw_by_lot_id.get(lot["lot_id"])
        items.append({
            "product_id": product_id,
            "product_name": product["name"],
            "lot_id": lot["lot_id"],
            "status": status,
            "initial_kg": round(float(lot["initial_kg"]), 3),
            "balance_kg": round(balance, 3),
            "consumed_kg": round(float(lot["consumed_kg"]), 3),
            "produced_pieces": int(round(float(lot["finished_pieces"]))),
            "loss_pieces": int(round(float(lot["route_loss_pieces"]))),
            "blank_weight_kg": blank_weight_kg,
            "document": raw.get("document") if raw else None,
            "date": raw.get("date") if raw else None,
        })
    return items


@app.get("/api/material-lots")
def material_lots() -> dict[str, Any]:
    """Lotes de vergalhão das 13 peças.

    fechado      nada consumido ainda, mesmo sendo o próximo do FIFO
    em processo  já teve consumo e ainda tem saldo
    consumido    saldo zerado
    """
    items: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for result in executor.map(_material_lots_for_product, PRODUCTS.keys()):
            items.extend(result)
    status_order = {"em_processo": 0, "fechado": 1, "consumido": 2}
    items.sort(key=lambda item: (status_order.get(item["status"], 3), item["product_name"], item["lot_id"]))
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "items": items,
        "counts": {
            "fechado": sum(1 for item in items if item["status"] == "fechado"),
            "em_processo": sum(1 for item in items if item["status"] == "em_processo"),
            "consumido": sum(1 for item in items if item["status"] == "consumido"),
        },
    }


def _process_events_for_control(
    product_id: str,
    database_name: str,
    date_from: str,
    date_to: str,
    query: Any = query_process_events,
) -> list[dict[str, Any]]:
    """Consulta apontamentos dentro do início operacional definido por produto."""
    return query(database_name, date_from, date_to)


def _events_after_inventory(
    product_id: str,
    opening_rows: list[dict[str, Any]],
    events: list[Any],
) -> list[Any]:
    if product_id in {"placa-160", "conector-at"}:
        return events
    saved_at = [
        datetime.fromisoformat(str(row["updated_at"]))
        for row in opening_rows
        if row.get("updated_at")
    ]
    if not saved_at:
        return events
    cutoff = max(saved_at)
    return [event for event in events if event.occurred_at > cutoff]


def _operational_key(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]+", "", ascii_text.upper())


def _inventory_process_valid(
    product: dict[str, Any], process: str, *, completed: bool = False
) -> bool:
    stages = product.get("stages") or []
    if not stages:
        return False
    process_key = _operational_key(process)
    allowed = {
        _operational_key(name)
        for stage in stages
        for name in (stage.get("name"), stage.get("tracking_name"))
        if name
    }
    if process_key not in allowed:
        return False
    if not completed:
        return True
    last = stages[-1]
    return process_key in {
        _operational_key(last.get("name")),
        _operational_key(last.get("tracking_name")),
    }


def _completed_pieces_from_last_process(
    product: dict[str, Any], totals: list[dict[str, Any]]
) -> float:
    if not product.get("stages"):
        return 0
    last_stage = product["stages"][-1]
    tracking_last = (product.get("tracking_stages") or [{}])[-1]
    aliases = {
        _operational_key(last_stage.get("name")),
        _operational_key(last_stage.get("tracking_name")),
        _operational_key(tracking_last.get("process")),
        _operational_key(tracking_last.get("stage")),
    }
    return sum(
        float(row.get("quantity") or 0)
        for row in totals
        if _operational_key(row.get("process")) in aliases
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "updated_at": datetime.now().isoformat(timespec="seconds")}


@app.get("/api/products")
def list_products() -> list[dict[str, Any]]:
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "code": p["code"],
            "lots": p["lots"],
            "rod": p["rod"],
            "rod_diameter_mm": p["rod_diameter_mm"],
            "rod_available": p["rod_available"],
            "rod_material": p["rod_material"],
            "stages": [stage.get("tracking_name", stage["name"]) for stage in p["stages"]],
            "totvs_destination_codes": p["totvs_destination_codes"],
            "totvs_destination_code_stages": p["totvs_destination_code_stages"],
            "tracking_stages": p["tracking_stages"],
            "blank_weight_kg": p["blank_weight_kg"],
            "pieces_per_kg": p["pieces_per_kg"],
            "route_output": p["route_output"],
            "status": "active",
        }
        for p in PRODUCTS.values()
    ]


@app.get("/api/catalog/production")
def catalog_production(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    """Produzido e em processo de todas as peças em uma única leitura.

    A Central precisa dos dois números por peça. Sem esta rota a tela faria
    treze consultas equivalentes. Quando a fonte não responde, `available` fica
    falso e nenhum valor é convertido em zero na interface.
    """
    _, cycle_end = current_cycle_range()
    # Decisão operacional: a Central acompanha somente o Placa 160 desde o
    # início oficial do lote, em 28/08/2026. Os demais cards permanecem zerados.
    effective_from = system_start_date().isoformat()
    effective_to = date_to or cycle_end.isoformat()
    period = {"from": effective_from, "to": effective_to}

    try:
        product_names = [product["database_name"] for product in PRODUCTS.values()]
        totals = query_process_totals_by_product(
            product_names,
            INVENTORY_DATE.isoformat(),
            effective_to,
        )
        historical_names = [
            PRODUCTS[product_id]["database_name"]
            for product_id in ("placa-160", "conector-at")
        ]
        totals.update(query_process_totals_by_product(
            historical_names,
            effective_from,
            effective_to,
        ))
    except Exception as error:
        return {
            "period": period,
            "source": "PostgreSQL / Apontamentos",
            "available": False,
            "message": f"Apontamentos indisponíveis: {str(error)[:160]}",
            "rows": [],
        }

    try:
        all_lots = list_production_lots(None)
    except Exception:
        all_lots = []
    try:
        opening_rows = list_opening_inventory(INVENTORY_DATE)
    except Exception:
        opening_rows = []

    rows: list[dict[str, Any]] = []
    for product in PRODUCTS.values():
        if product["id"] != "placa-160":
            opening_snapshot = _controlled_product(product["id"], effective_from, effective_to)
            traceability = None
            if product["id"] == "conector-at" and opening_snapshot["visible_wip"] > 0:
                try:
                    traceability = _traceability_for_product(product["id"], effective_from, effective_to)
                except Exception:
                    traceability = None
            lot_identity = _catalog_lot_identity(
                opening_snapshot["visible_wip"],
                opening_snapshot["unidentified_wip"],
                traceability,
            )
            rows.append({
                "product_id": product["id"],
                "produced_pieces": max(
                    opening_snapshot["actual_pieces"],
                    _completed_pieces_from_last_process(
                        product, totals.get(product["database_name"], [])
                    ),
                ),
                "in_process_pieces": opening_snapshot["visible_wip"],
                "identified_in_process_pieces": lot_identity["identified_in_process_pieces"],
                "unidentified_in_process_pieces": lot_identity["unidentified_in_process_pieces"],
                "material_lot_id": lot_identity["material_lot_id"],
                "production_lot_id": lot_identity["production_lot_id"],
                "last_production_date": opening_snapshot.get("last_production_date"),
                "attention": False,
                "critical": False,
            })
            continue
        product_lots = [
            lot for lot in all_lots
            if lot["product_id"] == product["id"] and lot["status"] != "completed"
        ]
        totals_by_process = {row["process"]: row for row in totals.get(product["database_name"], [])}
        snapshot = _apply_live_production(
            deepcopy(product), totals_by_process, product_lots, effective_from, effective_to
        )
        stages = snapshot["stages"]
        traceability = None
        if snapshot["unidentified_wip"] > 0:
            try:
                traceability = _traceability_for_product(product["id"], effective_from, effective_to)
            except Exception:
                # A Central continua disponível com o saldo não conciliado se
                # TOTVS ou rastreabilidade estiverem temporariamente offline.
                traceability = None
        lot_identity = _catalog_lot_identity(
            snapshot["visible_wip"], snapshot["unidentified_wip"], traceability
        )
        rows.append({
            "product_id": product["id"],
            "produced_pieces": _completed_pieces_from_last_process(
                product, totals.get(product["database_name"], [])
            ),
            "in_process_pieces": snapshot["visible_wip"],
            "identified_in_process_pieces": lot_identity["identified_in_process_pieces"],
            "unidentified_in_process_pieces": lot_identity["unidentified_in_process_pieces"],
            "material_lot_id": lot_identity["material_lot_id"],
            "production_lot_id": lot_identity["production_lot_id"],
            "last_production_date": snapshot["last_production_date"],
            "attention": any(stage["status"] == "attention" for stage in stages),
            "critical": any(stage["status"] == "critical" for stage in stages),
        })

    return {
        "period": period,
        "source": "PostgreSQL / Apontamentos + lotes do controle",
        "available": True,
        "message": "Produção consultada no período",
        "rows": rows,
    }


def _catalog_lot_identity(
    visible_wip: int,
    unidentified_wip: int,
    traceability: dict[str, Any] | None,
) -> dict[str, Any]:
    """Concilia o saldo do período sem trocar seu recorte temporal.

    A rastreabilidade pode carregar o histórico completo do lote, enquanto a
    Central mostra apenas o período selecionado. Por isso ela identifica o
    saldo de `visible_wip`, mas não substitui esse valor pelo acumulado do lote.
    """
    traced_lots = [
        lot
        for stage in (traceability or {}).get("stages", [])
        for lot in stage.get("lots", [])
        if lot.get("material_lot_id")
    ]
    material = (traceability or {}).get("material", {})
    active_material_lot = material.get("active_lot_id")
    consumed_lot = next(
        (
            lot for lot in material.get("lots", [])
            if lot.get("lot_id") == active_material_lot
            and float(lot.get("consumed_kg") or 0) > 0
            and float(lot.get("transformed_pieces") or 0) >= visible_wip
        ),
        None,
    )
    if consumed_lot:
        production_lot = next(
            (lot for lot in traced_lots if lot.get("material_lot_id") == active_material_lot),
            None,
        )
        return {
            "identified_in_process_pieces": visible_wip,
            "unidentified_in_process_pieces": 0,
            "material_lot_id": active_material_lot,
            "production_lot_id": production_lot.get("lot_id") if production_lot else None,
        }

    reconciled = bool(traced_lots) and (traceability or {}).get("unmatched_pieces") == 0
    if not reconciled:
        return {
            "identified_in_process_pieces": max(visible_wip - unidentified_wip, 0),
            "unidentified_in_process_pieces": unidentified_wip,
            "material_lot_id": None,
            "production_lot_id": None,
        }

    active_lot = next(
        (lot for lot in traced_lots if lot.get("material_lot_id") == active_material_lot),
        traced_lots[0],
    )
    return {
        "identified_in_process_pieces": visible_wip,
        "unidentified_in_process_pieces": 0,
        "material_lot_id": active_lot.get("material_lot_id"),
        "production_lot_id": active_lot.get("lot_id"),
    }


@app.get("/api/materials")
def materials() -> dict[str, Any]:
    return {
        "available_rods": [
            *[{"material": "LATÃO 377 1/2 DURO", "diameter_mm": diameter, "description": description} for diameter, description in BRASS_RODS.items()],
            *[{"material": "COBRE 110 1/2 DURO", "diameter_mm": diameter, "description": description} for diameter, description in COPPER_RODS.items()],
        ],
        "product_mapping": [
            {
                "product": product,
                "material": "COBRE 110 1/2 DURO" if product.startswith("EIXO ") else "LATÃO 377 1/2 DURO",
                "diameter_mm": diameter,
            }
            for product, diameter in PRODUCT_ROD_DIAMETERS.items()
        ],
        "unavailable_mappings": [
            {"product": product, "diameter_mm": diameter}
            for product, diameter in PRODUCT_ROD_DIAMETERS.items()
            if diameter not in (COPPER_RODS if product.startswith("EIXO ") else BRASS_RODS)
        ],
    }


@app.get("/api/totvs/{product_id}")
def totvs_product_material(product_id: str) -> dict[str, Any]:
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    return query_totvs_material(PRODUCTS[product_id])


@app.post("/api/totvs/{product_id}/sync")
def sync_totvs_product_material(product_id: str, preview: bool = Query(default=False)) -> dict[str, Any]:
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    payload = query_totvs_material(PRODUCTS[product_id])
    if payload["status"] == "offline":
        raise HTTPException(status_code=503, detail=payload["message"])
    operational = payload.get("control", {}).get("operational", False)
    if not operational and not preview:
        return {**payload, "sync": {"status": "scheduled", "inserted": 0, "message": f'Controle inicia em {payload["control"]["starts_at_label"]}.'}}
    inserted = 0 if preview else sync_material_lots(product_id, payload.get("lots", []))
    return {**payload, "sync": {"status": "preview" if preview else "complete", "inserted": inserted}}


@app.get("/api/inventory/opening")
def opening_inventory(reference_date: date = Query(default=INVENTORY_DATE)) -> dict[str, Any]:
    try:
        rows = list_opening_inventory(reference_date)
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Banco do controle indisponível: {str(error)[:180]}") from error
    # Um produto pode ter várias posições. O inventário só está pronto quando
    # cada produto tem ao menos uma posição com os registros obrigatórios.
    recorded_ids = {
        row["product_id"]
        for row in rows
        if str(row.get("process") or "").strip() and str(row.get("operator_name") or "").strip()
    }
    pending_ids = [product_id for product_id in PRODUCTS if product_id not in recorded_ids]
    return {
        "reference_date": reference_date.isoformat(),
        "reference_date_label": reference_date.strftime("%d/%m/%Y"),
        "rows": rows,
        "recorded_positions": len(rows),
        "recorded_products": len(recorded_ids),
        "total_products": len(PRODUCTS),
        "pending_product_ids": pending_ids,
        "ready": not pending_ids,
        "locked": INVENTORY_LOCKED,
        "lock_message": "Inventário temporariamente bloqueado para alterações." if INVENTORY_LOCKED else "",
    }


@app.put("/api/inventory/opening/{product_id}")
def update_opening_inventory(product_id: str, payload: OpeningInventoryInput) -> dict[str, Any]:
    if INVENTORY_LOCKED:
        raise HTTPException(status_code=423, detail="Inventário temporariamente bloqueado para alterações")
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    if not _inventory_process_valid(
        PRODUCTS[product_id], payload.process, completed=payload.position_status == "completed"
    ):
        detail = (
            "Somente a última operação da rota pode ser marcada como concluída"
            if payload.position_status == "completed"
            else "Processo não pertence à rota cadastrada da peça"
        )
        raise HTTPException(status_code=422, detail=detail)
    try:
        return save_opening_inventory(INVENTORY_DATE, PRODUCTS[product_id], payload.model_dump())
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Não foi possível salvar o inventário: {str(error)[:180]}") from error


@app.get("/api/production-lots")
def production_lots(product_id: str | None = Query(default=None)) -> dict[str, Any]:
    try:
        rows = list_production_lots(product_id)
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Controle de lotes indisponível: {str(error)[:180]}") from error
    return {
        "rows": rows,
        "summary": {
            "in_process": sum(row["status"] == "in_process" for row in rows),
            "guarded": sum(row["status"] == "guarded" for row in rows),
            "awaiting_next": sum(row["status"] == "awaiting_next" for row in rows),
            "waiting": sum(row["status"] == "waiting" for row in rows),
            "completed": sum(row["status"] == "completed" for row in rows),
        },
    }


@app.get("/api/readiness")
def readiness() -> dict[str, Any]:
    checks = {"control_database": "pending", "totvs_config": "pending", "totvs_query": "pending", "activation": "scheduled"}
    errors: list[str] = []
    try:
        ensure_control_schema()
        checks["control_database"] = "ready"
    except Exception as error:
        checks["control_database"] = "error"
        errors.append(str(error)[:180])
    totvs_config = Path(os.environ.get("TOTVS_CONFIG_PATH", r"C:\Users\pedro.barboni\Desktop\ALMOXARIFADO\Flow-Movimentacoes\configuracao_sql.json"))
    checks["totvs_config"] = "ready" if totvs_config.is_file() else "error"
    if checks["totvs_config"] == "ready":
        sample = query_totvs_material(PRODUCTS["conector-at"])
        checks["totvs_query"] = "ready" if sample["status"] == "online" else "error"
        if checks["totvs_query"] == "error":
            errors.append(sample["message"])
    else:
        checks["totvs_query"] = "error"
    if date.today() >= CONTROL_START:
        checks["activation"] = "active"
    schedule = control_schedule()
    return {"ready": not errors and all(check != "error" for check in checks.values()), **schedule, "checks": checks, "errors": errors}


# Chaves de apontamento já gravadas por ESTE processo. O banco continua sendo
# a verdade — a memória só evita ir até ele quando nada mudou desde a última
# gravação, que é o caso da esmagadora maioria das consultas.
_MOVEMENT_MEMO: dict[str, set[str]] = {}
_MOVEMENT_MEMO_LOCK = threading.Lock()


def _persist_movements(product_id: str, movements: list[dict[str, Any]]) -> int:
    """Acrescenta ao histórico imutável, sem nunca atrapalhar a leitura.

    O histórico é registro paralelo à projeção: se o banco de controle estiver
    fora, a produção continua sendo calculada e exibida — só não é arquivada.
    O contrário (derrubar a tela porque o arquivo falhou) seria pior.
    """
    if not movements:
        return 0
    keys = {str(row.get("source_key")) for row in movements}
    with _MOVEMENT_MEMO_LOCK:
        known = _MOVEMENT_MEMO.get(product_id)
        if known is not None and keys <= known:
            return 0
    try:
        written = record_movements(product_id, movements)
    except Exception:
        return 0
    with _MOVEMENT_MEMO_LOCK:
        _MOVEMENT_MEMO.setdefault(product_id, set()).update(keys)
    return written


def _build_traceability_snapshot(
    product_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[dict[str, Any], list[Any]]:
    """Monta o snapshot de rastreabilidade e devolve `(snapshot, events)` já
    filtrados. Lança a exceção original (TOTVS offline, apontamentos
    indisponíveis etc.) sem embrulhar em HTTPException -- quem chama decide
    se aborta a requisição ou cai num cálculo de reserva.
    """
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    product = PRODUCTS[product_id]
    cycle_start, cycle_end = current_cycle_range()
    effective_from = _product_control_start(product_id, date_from or cycle_start.isoformat())
    effective_to = date_to or cycle_end.isoformat()
    history_from, history_to = traceability_range(effective_from, effective_to)
    history_from = date.fromisoformat(_traceability_history_start(product_id, effective_from))
    totvs = query_totvs_material(product)
    if totvs.get("status") == "offline":
        raise RuntimeError(totvs.get("message") or "TOTVS indisponível")
    events = _process_events_for_control(
        product_id,
        product["database_name"],
        history_from.isoformat(),
        history_to.isoformat(),
    )
    try:
        opening_rows = [
            row for row in list_opening_inventory(INVENTORY_DATE)
            if row["product_id"] == product_id
        ]
    except Exception:
        opening_rows = []
    filtered_events = _events_after_inventory(product_id, opening_rows, events)
    snapshot = build_traceability_snapshot(
        product,
        totvs,
        opening_rows,
        filtered_events,
        consumption_locked_from=MATERIAL_CONSUMPTION_LOCKED_FROM,
    )
    snapshot["period"] = {"from": effective_from, "to": effective_to}
    snapshot["history_period"] = {
        "from": history_from.isoformat(),
        "to": history_to.isoformat(),
    }
    snapshot["updated_at"] = datetime.now().isoformat(timespec="seconds")
    # `movements` carrega Decimal e datetime: serve para gravar, não para
    # responder. Sai do snapshot aqui, antes de chegar a qualquer rota.
    _persist_movements(product_id, snapshot.pop("movements", []))
    return snapshot, filtered_events


def _traceability_for_product(
    product_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    try:
        snapshot, _events = _build_traceability_snapshot(product_id, date_from, date_to)
        return snapshot
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Rastreabilidade indisponível: {str(error)[:180]}") from error


@app.get("/api/movements/{product_id}")
def movements(
    product_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    before_id: int | None = Query(default=None),
) -> dict[str, Any]:
    """Histórico imutável das movimentações desta peça, do mais novo ao mais antigo.

    Reconstrói o snapshot antes de responder para que o histórico esteja em dia
    — quem abre a tela de histórico de uma peça nunca consultada antes veria
    lista vazia, e concluiria que o sistema não guarda nada.

    Se a reconstrução falhar (TOTVS fora), o que já foi arquivado continua
    sendo devolvido: histórico gravado não depende de fonte online.
    """
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")

    stale_reason = ""
    try:
        _build_traceability_snapshot(product_id)
    except Exception as error:
        stale_reason = f"Histórico pode estar desatualizado: {str(error)[:160]}"

    try:
        items = list_movements(product_id, limit=limit, before_id=before_id)
        summary = count_movements(product_id)
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Histórico indisponível: {str(error)[:180]}",
        ) from error

    return {
        "product_id": product_id,
        "product_name": PRODUCTS[product_id]["name"],
        "items": items,
        "summary": summary,
        "next_before_id": items[-1]["id"] if len(items) == limit else None,
        "stale_reason": stale_reason,
    }


@app.get("/api/traceability/{product_id}/summary")
def traceability_summary(
    product_id: str,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    return _traceability_for_product(product_id, date_from, date_to)


@app.get("/api/traceability/{product_id}/stages/{process}")
def traceability_stage(
    product_id: str,
    process: str,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    snapshot = _traceability_for_product(product_id, date_from, date_to)
    normalized = process.strip().upper().replace("-", "_").replace(" ", "_")
    stage = next((row for row in snapshot["stages"] if row["process"] == normalized), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Operacao nao encontrada na rastreabilidade")
    unmatched = [row for row in snapshot["unmatched"] if str(row["process"]).upper() == normalized]
    return {
        "product_id": product_id,
        "process": normalized,
        "summary": {key: value for key, value in stage.items() if key != "lots"},
        "lots": stage["lots"],
        "unmatched": unmatched,
        "period": snapshot["period"],
        "updated_at": snapshot["updated_at"],
    }


@app.get("/api/overview")
def overview(
    product_id: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    if product_id and product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    totals = {
        "wallet": sum(p["wallet"] for p in PRODUCTS.values()),
        "finished": sum(p["finished"] for p in PRODUCTS.values()),
        "wip": sum(p["wip"] for p in PRODUCTS.values()),
        "warehouse_kg": sum(p["warehouse_kg"] for p in PRODUCTS.values()),
        "critical_alerts": 0,
    }
    return {
        "system_name": "Central de Controle",
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "integrations": [
            {"name": "TOTVS", "status": "online", "latency": "sob demanda"},
            {"name": "Apontamentos", "status": "online", "latency": "tempo real"},
        ],
        "totals": totals,
        "product": product_summary(_controlled_product_detail(product_id, date_from, date_to)) if product_id else None,
    }


@app.get("/api/details/{topic}")
def details(
    topic: str,
    product_id: str = Query(default="conector-at"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    product = product_summary(_controlled_product_detail(product_id, date_from, date_to))
    totvs = query_totvs_material(PRODUCTS[product_id])
    topics = {
        "warehouse": {"title": "Estoque no Armazém 1", "source": "TOTVS / SB2010", "rows": [["Saldo físico", f'{format_number_br(totvs["stock"]["total_kg"], 3)} kg'], ["Material", totvs.get("material", {}).get("description", product["rod"])], ["Código TOTVS", ", ".join(totvs.get("material", {}).get("codes", [])) or "Não localizado"], ["Situação", totvs["message"]]]},
        "transfer": {"title": "Lotes transferidos para a peça", "source": "TOTVS / SD3010 · Número de Série", "rows": [["Transferido", f'{format_number_br(totvs.get("transferred_kg", 0), 3)} kg'], ["Lotes criados", format_number_br(totvs.get("lot_count", 0))], ["Destino", totvs.get("destination", {}).get("requested_name", product["name"])], *[[f'{lot["id"]} · {lot["date"]}', f'{format_number_br(lot["initial_kg"], 3)} kg'] for lot in totvs.get("lots", [])[:8]]]},
        "estimate": {"title": "Memória de cálculo", "source": "Pesos informados por etapa + saldo SB2010", "rows": [["Peso do Blank", f'{format_number_br(product["blank_weight_kg"], 3)} kg' if product.get("blank_weight_kg") else "Não informado"], ["Peças por kg", format_number_br(product["pieces_per_kg"], 3) if product.get("pieces_per_kg") else "Não informado"], ["Capacidade pelo saldo atual", f'{format_number_br(totvs.get("stock", {}).get("estimated_pieces", 0))} peças'], ["Carteira PCP", "Não conectada"]]},
        "wip": {"title": "Distribuição do WIP", "source": "Lotes identificados + saldo estimado entre apontamentos", "rows": [[s.get("tracking_name", s["name"]), f'{format_number_br(s.get("in_process_pieces", 0))} em processo · {format_number_br(s.get("awaiting_pieces", 0))} aguardando com lote · {format_number_br(s.get("unidentified_waiting_pieces", 0))} com lote indefinido · {format_number_br(s.get("guarded_pieces", 0))} resguardadas'] for s in product["stages"]]},
        "reconciliation": {"title": "Conciliação do lote", "source": "TOTVS + Apontamentos", "rows": [["Peças realizadas", format_number_br(product["actual_pieces"])], ["Sucata calculada", f'{format_number_br(product["actual_scrap_kg"], 3)} kg'], ["Rendimento dos apontamentos", f'{format_number_br(product["yield_percent"], 1)}%'], ["Consumo por lote", "Aguardando vínculo operacional"]]},
    }
    if topic.startswith("stage-"):
        stage_name = topic.removeprefix("stage-").replace("-", " ")
        stage = next((s for s in product["stages"] if s["name"].lower() == stage_name.lower()), None)
        if not stage:
            raise HTTPException(status_code=404, detail="Operacao nao encontrada")
        last_date = stage.get("last_date")
        last_date_label = datetime.strptime(last_date[:10], "%Y-%m-%d").strftime("%d/%m/%Y") if last_date else "Sem apontamentos no período"
        status_label = {"empty": "Sem dados", "normal": "Normal", "attention": "Atenção", "critical": "Crítico"}.get(stage["status"], stage["status"])
        return {"title": stage.get("tracking_name", stage["name"]), "source": product["production_source"], "rows": [["Código da peça", stage.get("totvs_code") or "Não informado"], ["Peso unitário", f'{format_number_br(stage.get("unit_weight_kg", 0), 3)} kg'], ["Quantidade produzida", f'{format_number_br(stage["reported"])} peças'], ["Em processo identificado", f'{format_number_br(stage.get("in_process_pieces", 0))} peças'], ["Aguardando com lote", f'{format_number_br(stage.get("awaiting_pieces", 0))} peças'], ["Aguardando com lote indefinido", f'{format_number_br(stage.get("unidentified_waiting_pieces", 0))} peças'], ["Resguardadas nesta etapa", f'{format_number_br(stage.get("guarded_pieces", 0))} peças'], ["Perda apontada", f'{format_number_br(stage["loss"])} peças'], ["Sucata por rejeição", f'{format_number_br(stage.get("rejection_scrap_kg", 0), 3)} kg'], ["Redução de peso do processo", f'{format_number_br(stage.get("process_scrap_kg", 0), 3)} kg'], ["Sucata total calculada", f'{format_number_br(stage.get("total_scrap_kg", 0), 3)} kg'], ["Último apontamento", last_date_label], ["Status", status_label]]}
    if topic not in topics:
        raise HTTPException(status_code=404, detail="Detalhe nao encontrado")
    return topics[topic]


FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        candidate = FRONTEND_DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    @app.get("/{path:path}", include_in_schema=False)
    def frontend_build_missing(path: str):
        raise HTTPException(
            status_code=503,
            detail="Interface indisponível: build do frontend não foi gerado.",
        )
