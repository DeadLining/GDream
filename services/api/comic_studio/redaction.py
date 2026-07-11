import re
from typing import Any


SECRET_KEYS = {"api_key", "authorization", "token", "secret", "password"}
SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]+")


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in SECRET_KEYS else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact(item) for item in value)
    if isinstance(value, str):
        return SECRET_PATTERN.sub("[REDACTED]", value)
    return value
