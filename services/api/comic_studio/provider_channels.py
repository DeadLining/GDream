import errno
import json
import os
import stat
import tempfile
import threading
from pathlib import Path
from typing import ClassVar, Literal

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    SecretStr,
    TypeAdapter,
    field_validator,
    model_validator,
)

from comic_studio.config import Settings


_HTTP_URL = TypeAdapter(AnyHttpUrl)
_UNSUPPORTED_ERRNOS = {
    errno_value
    for errno_value in (
        getattr(errno, "EINVAL", None),
        getattr(errno, "ENOSYS", None),
        getattr(errno, "ENOTSUP", None),
        getattr(errno, "EOPNOTSUPP", None),
    )
    if errno_value is not None
}


class ProviderChannel(BaseModel):
    name: str
    enabled: bool
    base_url: str
    model: str
    api_key: SecretStr | None = None
    ssh_host: str | None = None

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        hide_input_in_errors=True,
    )

    @field_validator("name", "base_url", "model", "ssh_host")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("api_key", mode="before")
    @classmethod
    def strip_api_key(cls, value: str | SecretStr | None):
        if isinstance(value, str):
            return value.strip()
        return value

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

    @property
    def api_key_value(self) -> str | None:
        if self.api_key is None:
            return None
        return self.api_key.get_secret_value()


class ProviderChannels(BaseModel):
    version: Literal[1] = 1
    llm: ProviderChannel
    image: ProviderChannel
    tts: ProviderChannel

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        hide_input_in_errors=True,
    )

    @model_validator(mode="after")
    def validate_channel_semantics(self):
        for channel_name in ("llm", "image"):
            channel = getattr(self, channel_name)
            if channel.ssh_host is not None:
                raise ValueError("ssh_host is only valid for the tts channel")
            if channel.enabled and not channel.api_key_value:
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
    """Thread-safe local store; cross-process coordination is unsupported."""

    _locks_guard: ClassVar[threading.Lock] = threading.Lock()
    _path_locks: ClassVar[dict[Path, threading.RLock]] = {}

    def __init__(self, path: Path, defaults: ProviderChannels):
        self._path = Path(path).expanduser().resolve()
        with self._locks_guard:
            self._lock = self._path_locks.setdefault(
                self._path,
                threading.RLock(),
            )
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
            self._persistence_payload(validated),
            ensure_ascii=True,
            indent=2,
        ).encode("utf-8") + b"\n"

        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            previous_bytes = (
                self._path.read_bytes() if self._path.exists() else None
            )
            previous_mode = (
                stat.S_IMODE(self._path.stat().st_mode)
                if previous_bytes is not None
                else 0o600
            )
            temporary_path: Path | None = None
            replaced = False
            try:
                temporary_path = self._write_temporary_file(serialized, 0o600)
                os.replace(temporary_path, self._path)
                temporary_path = None
                replaced = True
                self._fsync_parent()
                self._snapshot = validated.model_copy(deep=True)
                return self._snapshot.model_copy(deep=True)
            except Exception as save_error:
                if replaced:
                    try:
                        self._rollback_file(previous_bytes, previous_mode)
                    except Exception as rollback_error:
                        raise ExceptionGroup(
                            "Provider channel save and rollback both failed",
                            [save_error, rollback_error],
                        ) from rollback_error
                raise
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

    def _write_temporary_file(self, payload: bytes, mode: int) -> Path:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=self._path.parent,
                prefix=f"{self._path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                self._set_file_mode(
                    temporary_file.fileno(),
                    temporary_path,
                    mode,
                )
                temporary_file.write(payload)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            return temporary_path
        except Exception:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _persistence_payload(channels: ProviderChannels) -> dict:
        payload = channels.model_dump(mode="json")
        for channel_name in ("llm", "image", "tts"):
            channel = getattr(channels, channel_name)
            payload[channel_name]["api_key"] = channel.api_key_value
        return payload

    @staticmethod
    def _is_unsupported_capability(error: BaseException) -> bool:
        if isinstance(error, (AttributeError, NotImplementedError)):
            return True
        if not isinstance(error, OSError):
            return False
        if error.errno in _UNSUPPORTED_ERRNOS:
            return True
        return os.name == "nt" and error.errno in {
            getattr(errno, "EACCES", None),
            getattr(errno, "EPERM", None),
        }

    def _set_file_mode(self, file_descriptor: int, path: Path, mode: int) -> None:
        fchmod = getattr(os, "fchmod", None)
        if fchmod is not None:
            try:
                fchmod(file_descriptor, mode)
                return
            except Exception as error:
                if not self._is_unsupported_capability(error):
                    raise

        try:
            os.chmod(path, mode)
        except Exception as error:
            if not self._is_unsupported_capability(error):
                raise

    def _rollback_file(self, previous_bytes: bytes | None, previous_mode: int) -> None:
        if previous_bytes is None:
            self._path.unlink(missing_ok=True)
        else:
            rollback_path = self._write_temporary_file(
                previous_bytes,
                previous_mode,
            )
            try:
                os.replace(rollback_path, self._path)
            finally:
                rollback_path.unlink(missing_ok=True)

        try:
            self._fsync_parent()
        except OSError:
            # The original directory durability failure is already propagated.
            pass

    def _fsync_parent(self) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        try:
            directory_fd = os.open(self._path.parent, flags)
        except Exception as error:
            if self._is_unsupported_capability(error):
                return
            raise
        try:
            try:
                os.fsync(directory_fd)
            except Exception as error:
                if not self._is_unsupported_capability(error):
                    raise
        finally:
            os.close(directory_fd)
