import re
from typing import Any


SENSITIVE_FIELDS = {
    "apikey",
    "authorization",
    "credential",
    "credentials",
    "key",
    "token",
    "secret",
    "password",
}
SENSITIVE_SUFFIXES = (
    "apikey",
    "authorization",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
)
SECRET_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]+")
BEARER_PATTERN = re.compile(r"(?i)(Bearer\s+)[^\s,;}\]]+")
FIELD_PREFIX = (
    r'(?<![A-Za-z0-9_-])'
    r'(?P<prefix>["\']?(?P<field>[A-Za-z][A-Za-z0-9_-]*)["\']?\s*[:=]\s*)'
)
STRUCTURED_SECRET_PATTERN = re.compile(
    FIELD_PREFIX + r'(?P<quote>["\'])(?P<value>.*?)(?P=quote)'
)
UNQUOTED_SECRET_PATTERN = re.compile(
    FIELD_PREFIX + r"(?!Bearer\b)(?P<value>[^\s,;}\]\"']+)"
)


def normalize_field_name(value: str) -> str:
    return value.casefold().replace("_", "").replace("-", "")


def is_sensitive_key(value: str) -> bool:
    normalized = normalize_field_name(value)
    return normalized in SENSITIVE_FIELDS or normalized.endswith(
        SENSITIVE_SUFFIXES
    )


def _redact_quoted_field(match: re.Match) -> str:
    if not is_sensitive_key(match.group("field")):
        return match.group(0)
    quote = match.group("quote")
    return f'{match.group("prefix")}{quote}[REDACTED]{quote}'


def _redact_unquoted_field(match: re.Match) -> str:
    if not is_sensitive_key(match.group("field")):
        return match.group(0)
    return f'{match.group("prefix")}[REDACTED]'


def _redact_sensitive_matches(
    value: str,
    pattern: re.Pattern,
    replacement,
) -> str:
    result: list[str] = []
    position = 0
    while match := pattern.search(value, position):
        if is_sensitive_key(match.group("field")):
            result.append(value[position : match.start()])
            result.append(replacement(match))
            position = match.end()
        else:
            next_position = match.start() + 1
            result.append(value[position:next_position])
            position = next_position
    result.append(value[position:])
    return "".join(result)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (
                "[REDACTED]"
                if isinstance(key, str) and is_sensitive_key(key)
                else redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact(item) for item in value)
    if isinstance(value, str):
        redacted = BEARER_PATTERN.sub(r"\1[REDACTED]", value)
        redacted = SECRET_PATTERN.sub("[REDACTED]", redacted)
        redacted = _redact_sensitive_matches(
            redacted,
            STRUCTURED_SECRET_PATTERN,
            _redact_quoted_field,
        )
        return _redact_sensitive_matches(
            redacted,
            UNQUOTED_SECRET_PATTERN,
            _redact_unquoted_field,
        )
    return value
