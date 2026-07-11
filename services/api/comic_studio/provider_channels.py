import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Literal

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    TypeAdapter,
    field_validator,
    model_validator,
)

from comic_studio.config import Settings


_HTTP_URL = TypeAdapter(AnyHttpUrl)


class ProviderChannel(BaseModel):
    name: str
    enabled: bool
    base_url: str
    model: str
    api_key: str | None = None
    ssh_host: str | None = None

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @field_validator("name", "base_url", "model", "api_key", "ssh_host")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        if value:
            _HTTP_URL.validate_python(value)
        return value

    @model_validator(mode="after")
    def validate_enabled_connection(self):
        if self.enabled:
            missing = [
                field
                for field in ("name", "base_url", "model")
                if not getattr(self, field)
            ]
            if missing:
                raise ValueError(
                    f"Enabled channel requires: {', '.join(missing)}"
                )
        return self


class ProviderChannels(BaseModel):
    version: Literal[1] = 1
    llm: ProviderChannel
    image: ProviderChannel
    tts: ProviderChannel

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @model_validator(mode="after")
    def validate_channel_semantics(self):
        for channel_name in ("llm", "image"):
            channel = getattr(self, channel_name)
            if channel.ssh_host is not None:
                raise ValueError("ssh_host is only valid for the tts channel")
            if channel.enabled and not channel.api_key:
                raise ValueError(
                    f"Enabled {channel_name} channel requires an api_key"
                )
        return self


def provider_channel_defaults(settings: Settings) -> ProviderChannels:
    return ProviderChannels(
        llm=ProviderChannel(
            name="MiniMax",
            enabled=bool(settings.minimax_api_key),
            base_url=settings.minimax_base_url,
            model=settings.minimax_model,
            api_key=settings.minimax_api_key,
        ),
        image=ProviderChannel(
            name="GPT Image",
            enabled=bool(settings.gpt_image_key),
            base_url=settings.gpt_image_base_url,
            model=settings.gpt_image_model,
            api_key=settings.gpt_image_key,
        ),
        tts=ProviderChannel(
            name="Qwen TTS",
            enabled=True,
            base_url=settings.qwen_tts_base_url,
            model=settings.qwen_tts_model,
            ssh_host=settings.qwen_tts_ssh_host,
        ),
    )


class ProviderChannelStore:
    def __init__(self, path: Path, defaults: ProviderChannels):
        self._path = Path(path)
        self._lock = threading.RLock()
        self._defaults = defaults.model_copy(deep=True)
        self._snapshot = self._defaults.model_copy(deep=True)

    def load(self) -> ProviderChannels:
        with self._lock:
            if not self._path.exists():
                loaded = self._defaults.model_copy(deep=True)
            else:
                try:
                    payload = json.loads(self._path.read_text(encoding="utf-8"))
                    loaded = ProviderChannels.model_validate(payload)
                except (
                    OSError,
                    UnicodeError,
                    json.JSONDecodeError,
                    ValueError,
                ) as exc:
                    raise ValueError(
                        f"Invalid provider channel configuration: {self._path}"
                    ) from exc
            self._snapshot = loaded.model_copy(deep=True)
            return loaded.model_copy(deep=True)

    @property
    def snapshot(self) -> ProviderChannels:
        with self._lock:
            return self._snapshot.model_copy(deep=True)

    def save(self, channels: ProviderChannels) -> ProviderChannels:
        validated = ProviderChannels.model_validate(
            channels.model_dump(mode="python")
        )
        serialized = json.dumps(
            validated.model_dump(mode="json"),
            ensure_ascii=True,
            indent=2,
        ).encode("utf-8") + b"\n"

        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    dir=self._path.parent,
                    prefix=f"{self._path.name}.",
                    suffix=".tmp",
                    delete=False,
                ) as temporary_file:
                    temporary_path = Path(temporary_file.name)
                    os.fchmod(temporary_file.fileno(), 0o600)
                    temporary_file.write(serialized)
                    temporary_file.flush()
                    os.fsync(temporary_file.fileno())

                os.replace(temporary_path, self._path)
                temporary_path = None
                self._fsync_parent()
                self._snapshot = validated.model_copy(deep=True)
                return self._snapshot.model_copy(deep=True)
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

    def _fsync_parent(self) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        try:
            directory_fd = os.open(self._path.parent, flags)
        except OSError:
            return
        try:
            try:
                os.fsync(directory_fd)
            except OSError:
                pass
        finally:
            os.close(directory_fd)
