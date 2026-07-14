"""Art style catalog API for M3.3.

Lists discovered art styles and exposes their positive/negative prompt fragments.
No write endpoint is needed; styles are authored as Markdown files under
``data/art_styles/`` and hot-reloaded by ``ArtStyleLoader``.
"""

from fastapi import APIRouter, HTTPException, Request

from comic_studio.services.art_style_loader import get_art_style_loader

router = APIRouter(tags=["art_styles"])


@router.get("/api/art-styles")
def list_art_styles(request: Request):
    loader = request.app.state.art_style_loader
    return {
        "items": [
            {
                "id": style.id,
                "name": style.name,
                "description": style.description,
                "prefix": style.prefix,
                "negative": style.negative,
            }
            for style in loader.list_styles()
        ]
    }


@router.get("/api/art-styles/{style_id}")
def get_art_style(request: Request, style_id: str):
    loader = request.app.state.art_style_loader
    try:
        style = loader.get(style_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Style not found") from exc
    return {
        "id": style.id,
        "name": style.name,
        "description": style.description,
        "prefix": style.prefix,
        "negative": style.negative,
    }
