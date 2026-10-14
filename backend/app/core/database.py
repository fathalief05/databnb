import json
import os
import threading
from pathlib import Path

import duckdb

ROOT_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("DATABNB_DATA_DIR", ROOT_DIR / "data"))
DATABASE_PATH = DATA_DIR / "databnb.duckdb"
DB_LOCK = threading.RLock()


def connect() -> duckdb.DuckDBPyConnection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(DATABASE_PATH))


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def initialize_database() -> None:
    with DB_LOCK:
        connection = connect()
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS _datasets (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    description VARCHAR NOT NULL,
                    source_type VARCHAR NOT NULL,
                    source_filename VARCHAR NOT NULL,
                    table_name VARCHAR NOT NULL UNIQUE,
                    schema_json VARCHAR NOT NULL,
                    row_count BIGINT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
                    updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS _configurations (
                    id VARCHAR PRIMARY KEY,
                    dataset_id VARCHAR NOT NULL,
                    kind VARCHAR NOT NULL,
                    name VARCHAR NOT NULL,
                    description VARCHAR NOT NULL,
                    config_json VARCHAR NOT NULL,
                    schema_version INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
                    updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
                )
                """
            )
        finally:
            connection.close()


def decode_json(value: str):
    return json.loads(value)
