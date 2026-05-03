from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import vaults

app = FastAPI(title="Vaultmark API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(vaults.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
