from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    vault_id: str = "default"
    vault_bucket: str
    vault_prefix: str = ""
    vault_region: str = "us-east-1"

    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_endpoint_url: str | None = None  # for local MinIO / moto

    database_url: str = "postgresql+asyncpg://vaultmark:vaultmark@localhost:5432/vaultmark"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
