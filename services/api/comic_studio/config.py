from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "ai-comic-studio"
    database_url: str = "sqlite:///./data/studio.db"
    data_root: Path = Path("./data")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_COMIC_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
