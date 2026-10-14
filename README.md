# DataBNB

**Multiple sources. One workspace.** DataBNB is a local-first workspace for importing and exploring spreadsheets. CSV and Excel data is stored in a local DuckDB database; search, filters, sorting, and pagination run against the full dataset in the backend.

## What works today

- Preview CSV and `.xlsx` uploads, select workbook sheets, detect common encodings, normalize duplicate headers, and infer column types.
- Persist datasets, metadata, and reusable configurations in DuckDB.
- Search, sort, filter with AND/OR conditions, and paginate on the server.
- Save filters, table views (visible columns, order, and sort), and record detail layouts independently.
- Add, edit, and delete records; inspect and customize record fields.
- Export the full dataset or the current filtered result to CSV or XLSX.
- Use a local React/TypeScript interface and FastAPI API without Docker or a remote service.

This first version imports local copies of spreadsheets. It does not connect to live databases or APIs, implement joins, or offer multi-user access.

## Architecture

- `backend/app/api`: FastAPI routes and request validation.
- `backend/app/connectors`: spreadsheet readers.
- `backend/app/services`: import, query, record, configuration, and export behavior.
- `backend/app/core`: DuckDB location, connections, and metadata initialization.
- `frontend/src`: React workspace, API client, types, and styling.
- DuckDB stores application metadata in `_datasets` and `_configurations`; each imported dataset uses a generated internal table name and stable record IDs. Filter values are parameterized and user-supplied identifiers are checked against dataset schemas.

Metadata tables are initialized with `CREATE TABLE IF NOT EXISTS`. They carry a configuration schema version; configuration evolution should use explicit versioned migrations rather than silently discarding incompatible settings.

## Prerequisites

- Python 3.10 or newer.
- Node.js 20.19+ (or 22.12+) and npm.
- Windows PowerShell, macOS, or Linux.

## Windows PowerShell setup

From the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
npm --prefix frontend install
```

If PowerShell blocks activation, allow it for the current terminal with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate again.

Start the backend in one PowerShell window:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --app-dir backend --reload
```

Start the frontend in another PowerShell window:

```powershell
npm --prefix frontend run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The API is available at `http://localhost:8000/api`; interactive API documentation is at `http://localhost:8000/docs`.

## Development and verification

Run backend tests from the repository root:

```powershell
python -m pytest backend\tests
```

Check frontend lint and build:

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```

Set `DATABNB_DATA_DIR` to move the DuckDB file from the repository's `data` folder. To override the API URL in Vite, create `frontend/.env.local` and set `VITE_API_URL=http://localhost:8000/api`.

## Storage, backup, and security

The default database file is `data/databnb.duckdb`. Imported source files are read in memory and are not copied to an uploads folder. Back up the database while the application is stopped by copying the database file to a secure location; restoring that copy restores imported data and saved configurations. Generated data files and local environment files are excluded from Git.

This is a local, single-user application, not a multi-user transactional server. Run one backend process against the database; DuckDB is not presented as a concurrent multi-user write service. The API currently has no authentication and should only be exposed on a trusted local machine. Uploads are limited to 25 MB, accepted only as CSV/XLSX, and are never executed. Do not import confidential or sensitive records into an unsecured workstation.

## Current limitations and roadmap

This MVP establishes the spreadsheet import/query workflow and separate saved filter, table, and detail configurations. It does not yet provide live database/API connectors, dataset joins, bulk selection, multi-level visual filter groups, configuration rename/duplicate management, or migrations between released versions. Additional connectors can implement the same import/preview/query boundary without changing dataset identity or the workspace model.
