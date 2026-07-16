from functools import lru_cache
import getpass
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    service_name: str = "ai-comic-studio"
    database_url: str = "sqlite:///./data/studio.db"
    data_root: Path = Path("./data")
    mock_ssh_state_path: Path = Field(
        default=Path("mock-ssh.json"),
        validation_alias=AliasChoices(
            "mock_ssh_state_path",
            "MOCK_SSH_STATE_PATH",
            "AI_COMIC_MOCK_SSH_STATE_PATH",
        ),
    )
    mock_ssh_log_path: Path = Field(
        default=Path("mock-ssh.log"),
        validation_alias=AliasChoices(
            "mock_ssh_log_path", "MOCK_SSH_LOG_PATH", "AI_COMIC_MOCK_SSH_LOG_PATH"
        ),
    )
    hostbridge_executable: str = Field(
        default="hostbridge",
        validation_alias=AliasChoices(
            "hostbridge_executable",
            "HOSTBRIDGE_EXECUTABLE",
            "AI_COMIC_HOSTBRIDGE_EXECUTABLE",
        ),
    )
    hostbridge_daemon_socket: Path = Field(
        default_factory=lambda: Path(
            f"/private/tmp/hostbridge-{getpass.getuser()}/daemon.sock"
        ),
        validation_alias=AliasChoices(
            "hostbridge_daemon_socket",
            "HOSTBRIDGE_DAEMON_SOCKET",
            "AI_COMIC_HOSTBRIDGE_DAEMON_SOCKET",
        ),
    )
    provider_channels_path: Path = Field(
        default=Path("data/provider-channels.json"),
        validation_alias=AliasChoices(
            "PROVIDER_CHANNELS_PATH", "AI_COMIC_PROVIDER_CHANNELS_PATH"
        ),
    )
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
    minimax_video_base_url: str = Field(
        default="https://api.minimaxi.com",
        validation_alias=AliasChoices(
            "MINIMAX_VIDEO_BASE_URL", "AI_COMIC_MINIMAX_VIDEO_BASE_URL"
        ),
    )
    minimax_video_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "MINIMAX_VIDEO_API_KEY", "AI_COMIC_MINIMAX_VIDEO_API_KEY"
        ),
    )
    minimax_video_model: str = Field(
        default="MiniMax-Hailuo-02",
        validation_alias=AliasChoices(
            "MINIMAX_VIDEO_MODEL", "AI_COMIC_MINIMAX_VIDEO_MODEL"
        ),
    )
    gpt_image_base_url: str = Field(
        default="http://192.168.18.80:14000",
        validation_alias=AliasChoices(
            "GPT_IMAGE_BASE_URL", "AI_COMIC_GPT_IMAGE_BASE_URL"
        ),
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
        validation_alias=AliasChoices(
            "QWEN_TTS_BASE_URL", "AI_COMIC_QWEN_TTS_BASE_URL"
        ),
    )
    qwen_tts_model: str = Field(
        default="Qwen3-TTS-12Hz-1.7B-CustomVoice",
        validation_alias=AliasChoices("QWEN_TTS_MODEL", "AI_COMIC_QWEN_TTS_MODEL"),
    )
    qwen_tts_ssh_host: str = Field(
        default="ai-comic-tts",
        validation_alias=AliasChoices(
            "QWEN_TTS_SSH_HOST", "AI_COMIC_QWEN_TTS_SSH_HOST"
        ),
    )
    qwen_tts_narrator_speaker: str = Field(
        default="dylan",
        min_length=1,
        validation_alias=AliasChoices(
            "QWEN_TTS_NARRATOR_SPEAKER",
            "AI_COMIC_QWEN_TTS_NARRATOR_SPEAKER",
        ),
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
        if not self.mock_ssh_state_path.is_absolute():
            self.mock_ssh_state_path = (
                self.data_root / self.mock_ssh_state_path
            ).resolve()
        if not self.mock_ssh_log_path.is_absolute():
            self.mock_ssh_log_path = (self.data_root / self.mock_ssh_log_path).resolve()
        self.hostbridge_daemon_socket = (
            self.hostbridge_daemon_socket.expanduser().resolve()
        )
        if not self.provider_channels_path.is_absolute():
            self.provider_channels_path = (
                repository_root / self.provider_channels_path
            ).resolve()
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
