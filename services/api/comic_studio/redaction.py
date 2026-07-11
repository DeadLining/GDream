import re
from typing import Any


SECRET_KEYS = {"api_key", "authorization", "token", "secret", "password"}
SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]+")
BEARER_PATTERN = re.compile(r"(?i)(Bearer\s+)[^\s;,]+")
STRUCTURED_SECRET_PATTERN = re.compile(
    r'(?i)(["\']?(?:api_key|authorization|token|secret|password)["\']?\s*[:=]\s*)'
    r'(["\'])(.*?)(\2)'
)


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
        redacted = SECRET_PATTERN.sub("[REDACTED]", value)
        redacted = BEARER_PATTERN.sub(r"\1[REDACTED]", redacted)
        return STRUCTURED_SECRET_PATTERN.sub(
            lambda match: f'{match.group(1)}{match.group(2)}[REDACTED]{match.group(4)}',
            redacted,
        )
    return value
