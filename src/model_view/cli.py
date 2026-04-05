import uvicorn


def dev() -> None:
    uvicorn.run(
        "model_view.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


def prod() -> None:
    uvicorn.run(
        "model_view.main:app",
        host="0.0.0.0",
        port=80,
        workers=1,  # single core
    )
