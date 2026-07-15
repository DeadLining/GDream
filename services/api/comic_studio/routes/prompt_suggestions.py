from fastapi import APIRouter, HTTPException, Request

from comic_studio.prompt_suggestions import (
    MediaPromptSuggestion,
    MediaPromptSuggestionRequest,
)
from comic_studio.providers.base import ProviderError
from comic_studio.services.prompt_suggestions import PromptSuggestionService


router = APIRouter(tags=["prompt-suggestions"])


@router.post(
    "/api/shots/{shot_id}/prompt-suggestion",
    response_model=MediaPromptSuggestion,
)
async def create_prompt_suggestion(
    shot_id: str, data: MediaPromptSuggestionRequest, request: Request
) -> MediaPromptSuggestion:
    with request.app.state.session_factory() as session:
        try:
            provider = request.app.state.provider_factory.create_llm()
            return await PromptSuggestionService(session, provider).create(
                shot_id, data.mode
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Shot not found") from exc
        except ProviderError as exc:
            raise HTTPException(
                status_code=502, detail="Prompt suggestion failed"
            ) from exc
