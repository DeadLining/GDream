import re
from typing import Any


SECRET_KEYS = {
    "api_key",
    "authorization",
    "token",
    "secret",
    "password",
    "access_token",
    "refreshtoken",
    "refresh_token",
    "client_secret",
    "proxyauthorization",
    "proxy_authorization",
}
SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]+")
BEARER_PATTERN = re.compile(r"(?i)(Bearer\s+)[^\s,;}\]]+")
SECRET_FIELD = (
    r"api_key|token|secret|password|access_token|refresh_?token|"
    r"client_secret|proxy_?authorization|authorization"
)
STRUCTURED_SECRET_PATTERN = re.compile(
    rf'(?i)(["\']?(?:{SECRET_FIELD})["\']?\s*[:=]\s*)'
    r'(["\'])(.*?)(\2)'
)
UNQUOTED_SECRET_PATTERN = re.compile(
    rf"(?i)(\b(?:{SECRET_FIELD})\b\s*[:=]\s*)(?!Bearer\b)"
    r"[^\s,;}\]]+"
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
        redacted = BEARER_PATTERN.sub(r"\1[REDACTED]", value)
        redacted = SECRET_PATTERN.sub("[REDACTED]", redacted)
        redacted = STRUCTURED_SECRET_PATTERN.sub(
            lambda match: f'{match.group(1)}{match.group(2)}[REDACTED]{match.group(4)}',
            redacted,
        )
        return UNQUOTED_SECRET_PATTERN.sub(r"\1[REDACTED]", redacted)
    return value
