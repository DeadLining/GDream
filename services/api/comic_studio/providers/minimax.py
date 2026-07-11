import json
from typing import Any

import httpx
from json_repair import repair_json
from pydantic import ValidationError

from comic_studio.providers.base import ProviderError
from comic_studio.schemas import EpisodePlan


SYSTEM_PROMPT = """You are the planning engine for a serialized Chinese dynamic comic.
Return one JSON object only. It must contain a non-empty scenes array. Each scene must
contain location, time_of_day, summary, continuity_state,
estimated_duration_seconds, and a non-empty shots array. Each shot must contain
shot_type, duration_seconds, composition, camera_motion, character_state,
image_prompt, negative_prompt, and dialogue. Dialogue entries contain character_id,
text, subtitle_text, emotion, and performance_instruction. Preserve the supplied
character IDs exactly. Do not use Markdown fences."""


def _extract_text(payload: dict[str, Any]) -> str:
    for item in payload.get("content", []):
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            return item["text"]
    raise ProviderError("MiniMax returned no text content")


def _strip_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def _episode_plan_payload(value: Any) -> Any:
    if isinstance(value, dict):
        if isinstance(value.get("scenes"), list):
            return value
        for nested in value.values():
            candidate = _episode_plan_payload(nested)
            if candidate is not None:
                return candidate
    return None


class MiniMaxProvider:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = "MiniMax-M3",
        client: httpx.AsyncClient | None = None,
        base_url: str = "https://api.minimaxi.com/anthropic/",
    ):
        self.api_key = api_key
        self.model = model
        self._client = client
        self.base_url = base_url.rstrip("/") + "/"

    async def plan_episode(self, context: dict[str, Any]) -> EpisodePlan:
        messages = [
            {
                "role": "user",
                "content": "Plan this episode using the required JSON schema:\n"
                + json.dumps(context, ensure_ascii=False),
            }
        ]
        validation_feedback = ""
        for attempt in range(2):
            if validation_feedback:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "The prior response failed JSON schema validation. "
                            f"Validation details: {validation_feedback}. Return corrected JSON only."
                        ),
                    }
                )
            try:
                text = await self._request(messages)
                repaired = repair_json(_strip_fences(text), return_objects=True)
                return EpisodePlan.model_validate(
                    _episode_plan_payload(repaired) or repaired
                )
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                validation_feedback = str(exc)[:1500]
                if attempt == 1:
                    raise ProviderError(
                        f"MiniMax returned an invalid episode plan: {validation_feedback}"
                    ) from exc
        raise ProviderError("MiniMax planning failed")

    async def _request(self, messages: list[dict[str, str]]) -> str:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=90)
        try:
            response = await client.post(
                "v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": 8192,
                    "temperature": 0.4,
                    "system": SYSTEM_PROMPT,
                    "messages": messages,
                },
            )
            response.raise_for_status()
            return _extract_text(response.json())
        except httpx.HTTPError as exc:
            raise ProviderError(f"MiniMax request failed: {type(exc).__name__}") from exc
        finally:
            if owns_client:
                await client.aclose()
