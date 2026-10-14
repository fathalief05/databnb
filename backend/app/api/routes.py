import json
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

import re

from app.connectors.spreadsheets import infer_schema, read_spreadsheet
from app.core.database import DB_LOCK, connect
from app.services.workspace import (
    delete_configuration,
    delete_record,
    export_records,
    get_record,
    import_dataset,
    list_configurations,
    list_datasets,
    query_records,
    save_configuration,
    save_record,
)

router = APIRouter(prefix="/api")


class RecordInput(BaseModel):
    values: dict[str, Any] = Field(min_length=1)


class ConfigurationInput(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    config: dict[str, Any]


def _decode_filters(value: str | None):
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="Filters must be valid JSON.") from error
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="Filters must be an object.")
    return parsed


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/datasets")
def datasets():
    return list_datasets()


@router.post("/imports/preview")
async def preview_import(file: UploadFile = File(...), worksheet: str | None = Form(default=None)):
    data = await file.read(25 * 1024 * 1024 + 1)
    headers, rows, worksheets = read_spreadsheet(file.filename or "upload.csv", data, worksheet)
    return {
        "headers": headers,
        "schema": infer_schema(headers, rows),
        "rows": rows[:25],
        "row_count": len(rows),
        "worksheets": worksheets,
    }


@router.post("/imports")
async def create_import(
    file: UploadFile = File(...),
    name: str = Form(min_length=1, max_length=120),
    description: str = Form(default="", max_length=1000),
    worksheet: str | None = Form(default=None),
):
    data = await file.read(25 * 1024 * 1024 + 1)
    headers, rows, _ = read_spreadsheet(file.filename or "upload.csv", data, worksheet)
    return import_dataset(
        name,
        description,
        file.filename or "upload.csv",
        headers,
        rows,
        "spreadsheet",
    )


@router.get("/datasets/{dataset_id}/records")
def records(
    dataset_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str = "",
    sort_by: str | None = None,
    sort_dir: str = "asc",
    filters: str | None = None,
):
    return query_records(dataset_id, page, page_size, search, sort_by, sort_dir, _decode_filters(filters))


@router.get("/datasets/{dataset_id}/records/{record_id}")
def record(dataset_id: str, record_id: str):
    return get_record(dataset_id, record_id)


@router.post("/datasets/{dataset_id}/records")
def create_record(dataset_id: str, payload: RecordInput):
    return save_record(dataset_id, payload.values)


@router.put("/datasets/{dataset_id}/records/{record_id}")
def update_record(dataset_id: str, record_id: str, payload: RecordInput):
    return save_record(dataset_id, payload.values, record_id)


@router.delete("/datasets/{dataset_id}/records/{record_id}")
def remove_record(dataset_id: str, record_id: str):
    return delete_record(dataset_id, record_id)


@router.get("/datasets/{dataset_id}/configurations")
def configurations(dataset_id: str, kind: str | None = None):
    return list_configurations(dataset_id, kind)


@router.post("/datasets/{dataset_id}/configurations")
def create_configuration(dataset_id: str, payload: ConfigurationInput):
    return save_configuration(dataset_id, payload.kind, payload.name, payload.description, payload.config)


@router.put("/datasets/{dataset_id}/configurations/{configuration_id}")
def update_configuration(dataset_id: str, configuration_id: str, payload: ConfigurationInput):
    return save_configuration(
        dataset_id,
        payload.kind,
        payload.name,
        payload.description,
        payload.config,
        configuration_id,
    )


@router.delete("/datasets/{dataset_id}/configurations/{configuration_id}")
def remove_configuration(dataset_id: str, configuration_id: str):
    return delete_configuration(dataset_id, configuration_id)


@router.get("/datasets/{dataset_id}/export")
def export(
    dataset_id: str,
    format: str = "csv",
    scope: str = "all",
    search: str = "",
    filters: str | None = None,
    columns: str | None = None,
):
    if format not in {"csv", "xlsx"}:
        raise HTTPException(status_code=422, detail="Export format must be csv or xlsx.")
    if scope not in {"all", "filtered"}:
        raise HTTPException(status_code=422, detail="Export scope must be all or filtered.")
    selected_columns = [column for column in columns.split(",") if column] if columns else None
    body, media_type, extension = export_records(
        dataset_id,
        search,
        _decode_filters(filters),
        selected_columns,
        scope,
        format,
    )
    with DB_LOCK:
        connection = connect()
        try:
            name = connection.execute("SELECT name FROM _datasets WHERE id = ?", [dataset_id]).fetchone()
        finally:
            connection.close()
    if name is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    filename = re.sub(r"[^A-Za-z0-9_-]+", "-", name[0]).strip("-") or "dataset"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename + extension)}"},
    )
