import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("uvicorn.error")

root = Path(__file__).parent.parent
site_path = root / "site"
static_path = root / "static"

if not site_path.exists() or not static_path.exists():
    logger.warning("Site dir or static dir does not exist")

app = FastAPI()

# Mounting the public dir
app.mount("/static", StaticFiles(directory=static_path), name="static")
logger.info("Mounted static dir")

# Setting up middlewares so browser knows to use gzip and to send json json objects
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root_get() -> FileResponse:
    return FileResponse(site_path / "index.html")
