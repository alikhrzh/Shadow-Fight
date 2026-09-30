from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "development-only-change-before-production-64-byte-secret-value"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="SHADOWCOACH_",
        case_sensitive=False,
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+aiosqlite:///./shadowcoach.db"
    jwt_secret: str = DEV_SECRET
    jwt_issuer: str = "shadowcoach-api"
    jwt_audience: str = "shadowcoach-web"
    access_token_minutes: int = Field(default=15, ge=5, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    refresh_cookie_name: str = "shadowcoach_refresh"
    cookie_secure: bool = False
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    docs_enabled: bool = True

    @model_validator(mode="after")
    def production_safety(self) -> "Settings":
        if self.environment == "production":
            if self.jwt_secret == DEV_SECRET or len(self.jwt_secret) < 32:
                raise ValueError(
                    "Production requires a unique JWT secret of at least 32 characters"
                )
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise ValueError("Production requires a postgresql+asyncpg database URL")
            if not self.cookie_secure:
                raise ValueError("Production refresh cookies must be Secure")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
