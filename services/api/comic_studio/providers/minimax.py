import json
from typing import Any

import httpx
from json_repair import repair_json
from pydantic import ValidationError

from comic_studio.providers.base import ProviderError
from comic_studio.director import DirectorSuggestionPatch
from comic_studio.schemas import EpisodePlan
from comic_studio.script_imports import ScriptImportDraft


SYSTEM_PROMPT = """You are the planning engine for a serialized Chinese dynamic comic.
Return one JSON object only. It must contain a non-empty scenes array. Each scene must
contain location, time_of_day, summary, continuity_state,
estimated_duration_seconds, and a non-empty shots array. Each shot must contain
shot_type, duration_seconds, composition, camera_motion, character_state,
image_prompt, negative_prompt, and dialogue. Dialogue entries contain character_id,
text, subtitle_text, emotion, and performance_instruction. Preserve the supplied
character IDs exactly. Do not use Markdown fences."""

SCRIPT_IMPORT_SYSTEM_PROMPT = """You are the script import engine for a Chinese dynamic comic studio.
Return one JSON object only using the supplied strict schema. Convert prose into ordered episodes,
scenes, shots, and dialogue when needed. Give every draft character and episode a stable draft_id.
Dialogue must reference a supplied character draft_id or be explicitly marked as narration. Preserve
story meaning, expose uncertainty through warnings, and do not use Markdown fences."""

SCRIPT_GENERATION_SYSTEM_PROMPT = """You are the lead writer and storyboard planner for a serialized
Chinese dynamic comic studio. Return one JSON object only using the supplied strict import schema.
Create coherent new episodes, scenes, shots, and dialogue from the complete project canon. Preserve
established character constraints and continuity, and avoid duplicating existing episodes. Give every
draft character and episode a stable draft_id. Dialogue must reference a supplied character draft_id
or be explicitly marked as narration. Expose uncertainty through warnings and do not use Markdown fences."""

READABLE_SCRIPT_SYSTEM_PROMPT = """You are the lead writer for a Chinese dynamic-comic studio.
Write a readable Chinese dynamic-comic script, not JSON. Use clear episode, scene, action, speaker,
and dialogue headings. Preserve all supplied character and continuity constraints, avoid duplicating
existing episodes, and make the result easy for a later structured parser to understand. Continue
from an existing partial draft without repeating it when one is supplied."""

DIRECTOR_SYSTEM_PROMPT = """You are a 3D staging and cinematography assistant for a Chinese
dynamic-comic studio. Return one JSON object only using the supplied strict schema. Reference only
the supplied object identifiers. Return transforms and camera parameters, never executable code.
Treat the result as a reviewable suggestion and do not use Markdown fences."""


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


def _normalize_import_warnings(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    root_warnings = list(value.get("warnings", []))

    def normalize(item: Any, *, root: bool = False) -> Any:
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if not isinstance(item, dict):
            return item
        normalized = {}
        for key, child in item.items():
            if key == "warnings" and not root:
                if isinstance(child, list):
                    root_warnings.extend(
                        warning for warning in child if isinstance(warning, dict)
                    )
                continue
            normalized[key] = normalize(child)
        return normalized

    normalized = normalize(value, root=True)
    normalized["warnings"] = root_warnings
    return normalized


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

    async def suggest_director(
        self, context: dict[str, Any]
    ) -> DirectorSuggestionPatch:
        messages = [
            {
                "role": "user",
                "content": (
                    "Suggest a director layout or shot composition using this JSON schema:\n"
                    + json.dumps(
                        DirectorSuggestionPatch.model_json_schema(), ensure_ascii=False
                    )
                    + "\nTrusted project and stage context:\n"
                    + json.dumps(context, ensure_ascii=False)
                ),
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
                text = await self._request(messages, system=DIRECTOR_SYSTEM_PROMPT)
                repaired = repair_json(_strip_fences(text), return_objects=True)
                return DirectorSuggestionPatch.model_validate(repaired)
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                validation_feedback = str(exc)[:1500]
                if attempt == 1:
                    raise ProviderError(
                        "MiniMax returned an invalid director suggestion"
                    ) from exc
        raise ProviderError("MiniMax director suggestion failed")

    async def parse_script_import(self, context: dict[str, Any]) -> ScriptImportDraft:
        generating = context.get("mode") == "generate"
        instruction = (
            "Create a new script and storyboard draft using the required import JSON schema:\n"
            if generating
            else "Structure this script using the required import JSON schema:\n"
        )
        messages = [
            {
                "role": "user",
                "content": (
                    instruction
                    + "Return only fields allowed by this JSON schema:\n"
                    + json.dumps(
                        ScriptImportDraft.model_json_schema(),
                        ensure_ascii=False,
                    )
                    + "\nProject and source context:\n"
                    + json.dumps(context, ensure_ascii=False)
                ),
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
                text = await self._request(
                    messages,
                    system=(
                        SCRIPT_GENERATION_SYSTEM_PROMPT
                        if generating
                        else SCRIPT_IMPORT_SYSTEM_PROMPT
                    ),
                    timeout_seconds=240,
                )
                repaired = repair_json(_strip_fences(text), return_objects=True)
                return ScriptImportDraft.model_validate(
                    _normalize_import_warnings(repaired)
                )
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                validation_feedback = str(exc)[:1500]
                if attempt == 1:
                    raise ProviderError(
                        f"MiniMax returned an invalid script import draft: {validation_feedback}"
                    ) from exc
        raise ProviderError("MiniMax script import parsing failed")

    async def stream_script(self, context: dict[str, Any]):
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(240, connect=10),
        )
        try:
            async with client.stream(
                "POST",
                "v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": 8192,
                    "temperature": 0.7,
                    "stream": True,
                    "system": READABLE_SCRIPT_SYSTEM_PROMPT,
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                "Create or continue the readable script from this context:\n"
                                + json.dumps(context, ensure_ascii=False)
                            ),
                        }
                    ],
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line.removeprefix("data:").strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") != "content_block_delta":
                        continue
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield str(delta["text"])
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"MiniMax streaming request failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def _request(
        self,
        messages: list[dict[str, str]],
        *,
        system: str = SYSTEM_PROMPT,
        timeout_seconds: float = 90,
    ) -> str:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout_seconds,
        )
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
                    "system": system,
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
