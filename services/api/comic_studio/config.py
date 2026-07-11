from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "ai-comic-studio"
    database_url: str = "sqlite:///./data/studio.db"
    data_root: Path = Path("./data")
    minimax_base_url: str = Field(
        default="https://api.minimaxi.com/anthropic/",
        validation_alias=AliasChoices("MINIMAX_BASE_URL", "AI_COMIC_MINIMAX_BASE_URL"),
    )
    minimax_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MINIMAX_API_KEY", "AI_COMIC_MINIMAX_API_KEY"),
    )
    minimax_model: str = Field(
        default="MiniMax-M3",
        validation_alias=AliasChoices("MINIMAX_MODEL", "AI_COMIC_MINIMAX_MODEL"),
    )
    gpt_image_base_url: str = Field(
        default="http://192.168.18.80:14000",
        validation_alias=AliasChoices("GPT_IMAGE_BASE_URL", "AI_COMIC_GPT_IMAGE_BASE_URL"),
    )
    gpt_image_key: str = Field(
        default="",
        validation_alias=AliasChoices("GPT_IMAGE_KEY", "AI_COMIC_GPT_IMAGE_KEY"),
    )
    gpt_image_model: str = Field(
        default="gpt-image-2",
        validation_alias=AliasChoices("GPT_IMAGE_MODEL", "AI_COMIC_GPT_IMAGE_MODEL"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_COMIC_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
