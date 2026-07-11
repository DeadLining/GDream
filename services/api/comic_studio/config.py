from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


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
    qwen_tts_base_url: str = Field(
        default="http://192.168.18.94:18080",
        validation_alias=AliasChoices("QWEN_TTS_BASE_URL", "AI_COMIC_QWEN_TTS_BASE_URL"),
    )
    qwen_tts_model: str = Field(
        default="Qwen3-TTS-12Hz-1.7B-CustomVoice",
        validation_alias=AliasChoices("QWEN_TTS_MODEL", "AI_COMIC_QWEN_TTS_MODEL"),
    )
    compositor_root: Path = Field(
        default=Path("packages/compositor"),
        validation_alias=AliasChoices("COMPOSITOR_ROOT", "AI_COMIC_COMPOSITOR_ROOT"),
    )

    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE,
        env_prefix="AI_COMIC_",
        extra="ignore",
    )

    @model_validator(mode="after")
    def resolve_repository_paths(self):
        repository_root = ROOT_ENV_FILE.parent
        if not self.data_root.is_absolute():
            self.data_root = (repository_root / self.data_root).resolve()
        if not self.compositor_root.is_absolute():
            self.compositor_root = (repository_root / self.compositor_root).resolve()
        sqlite_relative = "sqlite:///./"
        if self.database_url.startswith(sqlite_relative):
            database_path = (
                repository_root / self.database_url[len(sqlite_relative) :]
            ).resolve()
            self.database_url = f"sqlite:///{database_path}"
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
