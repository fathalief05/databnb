from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.database import initialize_database


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="DataBNB API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
