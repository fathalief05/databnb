import csv
import io

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.core import database
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATA_DIR", tmp_path)
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "test.duckdb")
    with TestClient(app) as test_client:
        yield test_client


def import_csv(client):
    content = (
        "Name,Amount,Region,Active,Name\n"
        "Aster,120,East,true,Second\n"
        "Birch,80,West,false,Other\n"
        "Cedar,240,East,true,Last\n"
        "Dune,,West,false,Blank\n"
    )
    response = client.post(
        "/api/imports",
        files={"file": ("sample.csv", content.encode(), "text/csv")},
        data={"name": "Sample"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_csv_import_infers_duplicate_headers_and_persists(client):
    dataset = import_csv(client)
    assert dataset["row_count"] == 4
    assert dataset["schema"] == [
        {"name": "Name", "type": "text"},
        {"name": "Amount", "type": "integer"},
        {"name": "Region", "type": "text"},
        {"name": "Active", "type": "boolean"},
        {"name": "Name_2", "type": "text"},
    ]
    assert client.get("/api/datasets").json()[0]["id"] == dataset["id"]
    assert client.get(f"/api/datasets/{dataset['id']}/records").json()["total"] == 4
    with TestClient(app) as restarted:
        assert restarted.get("/api/datasets").json()[0]["id"] == dataset["id"]


def test_search_sort_and_nested_filters_run_against_dataset(client):
    dataset = import_csv(client)
    definition = {
        "type": "group",
        "logic": "and",
        "conditions": [
            {"column": "Region", "operator": "equals", "value": "East"},
            {
                "type": "group",
                "logic": "or",
                "conditions": [
                    {"column": "Amount", "operator": "greater_than", "value": 200},
                    {"column": "Name", "operator": "equals", "value": "Aster"},
                ],
            },
        ],
    }
    response = client.get(
        f"/api/datasets/{dataset['id']}/records",
        params={"filters": __import__("json").dumps(definition), "sort_by": "Amount", "sort_dir": "desc"},
    )
    assert response.status_code == 200, response.text
    assert [row["Name"] for row in response.json()["items"]] == ["Cedar", "Aster"]
    assert client.get(
        f"/api/datasets/{dataset['id']}/records",
        params={"search": "%' OR 1=1 --", "page_size": 10},
    ).json()["total"] == 0


def test_record_crud_saved_configurations_and_exports(client):
    dataset = import_csv(client)
    dataset_id = dataset["id"]
    created = client.post(
        f"/api/datasets/{dataset_id}/records",
        json={"values": {"Name": "Elm", "Amount": 500, "Region": "North", "Active": True, "Name_2": "New"}},
    )
    assert created.status_code == 200, created.text
    record_id = created.json()["_record_id"]
    updated = client.put(
        f"/api/datasets/{dataset_id}/records/{record_id}",
        json={"values": {"Amount": 600}},
    )
    assert updated.status_code == 200
    assert updated.json()["Amount"] == 600

    config = client.post(
        f"/api/datasets/{dataset_id}/configurations",
        json={"kind": "filter", "name": "Big amounts", "config": {"filter": {"type": "group", "logic": "and", "conditions": []}}},
    )
    assert config.status_code == 200
    config_id = config.json()["id"]
    assert client.put(
        f"/api/datasets/{dataset_id}/configurations/{config_id}",
        json={"kind": "filter", "name": "Renamed", "config": {"filter": None}},
    ).json()["name"] == "Renamed"
    assert client.post(
        f"/api/datasets/{dataset_id}/configurations",
        json={"kind": "table", "name": "Invalid type change", "config": {}},
    ).status_code == 200
    assert client.delete(f"/api/datasets/{dataset_id}/configurations/{config_id}").json() == {"deleted": True}

    filters = __import__("json").dumps({
        "type": "group",
        "logic": "and",
        "conditions": [{"column": "Region", "operator": "equals", "value": "East"}],
    })
    exported = client.get(
        f"/api/datasets/{dataset_id}/export",
        params={"format": "csv", "scope": "filtered", "filters": filters, "columns": "Name,Amount"},
    )
    assert exported.status_code == 200
    rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert rows == [["Name", "Amount"], ["Aster", "120"], ["Cedar", "240"]]
    workbook = client.get(f"/api/datasets/{dataset_id}/export", params={"format": "xlsx"})
    assert workbook.status_code == 200
    assert workbook.headers["content-type"].startswith("application/vnd.openxmlformats")

    assert client.delete(f"/api/datasets/{dataset_id}/records/{record_id}").json() == {"deleted": True}


def test_excel_preview_selects_worksheet_and_rejects_bad_filters(client):
    workbook = Workbook()
    first = workbook.active
    first.title = "Summary"
    first.append(["Code", "Value"])
    first.append(["A", 10])
    other = workbook.create_sheet("Archive")
    other.append(["Code", "Value"])
    other.append(["B", 20])
    stream = io.BytesIO()
    workbook.save(stream)
    preview = client.post(
        "/api/imports/preview",
        files={"file": ("sheets.xlsx", stream.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"worksheet": "Archive"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["worksheets"] == ["Summary", "Archive"]
    assert preview.json()["rows"] == [["B", 20]]

    dataset = import_csv(client)
    invalid = client.get(
        f"/api/datasets/{dataset['id']}/records",
        params={"filters": '{"column":"Amount","operator":"contains","value":"1"}'},
    )
    assert invalid.status_code == 422
    missing = client.get(f"/api/datasets/{dataset['id']}/records", params={"sort_by": "Amount; DROP TABLE _datasets"})
    assert missing.status_code == 422


def test_uploaded_file_validation(client):
    unsupported = client.post(
        "/api/imports/preview",
        files={"file": ("file.json", b'{"safe": true}', "application/json")},
    )
    assert unsupported.status_code == 415
    malformed = client.post(
        "/api/imports/preview",
        files={"file": ("bad.csv", b'a,b\n"unclosed,value', "text/csv")},
    )
    assert malformed.status_code == 400
