from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

from comic_studio.services.image_proxy_cache import ImageProxyCacheService


router = APIRouter(tags=["image-proxy"])


def _validate_url(url: str) -> str:
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    lowered = url.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        # Reject non-http schemes so a malicious ``file://``/``data://`` value
        # can never be turned into a local-file read.
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
    return url


@router.get("/api/image-proxy")
async def get_image_proxy(
    request: Request,
    url: str = Query(..., description="Remote image URL to cache and serve."),
    ttl_hours: int | None = Query(default=None, ge=0, le=24 * 365),
):
    normalized = _validate_url(url)
    settings = request.app.state.settings
    with request.app.state.session_factory() as session:
        service = ImageProxyCacheService(session, settings.data_root)
        try:
            result = await service.get(normalized, ttl_hours=ttl_hours)
        except Exception as exc:  # noqa: BLE001 - surface any fetch failure as 502
            raise HTTPException(
                status_code=502, detail=f"Failed to fetch remote image: {exc}"
            ) from exc
        file_path = settings.data_root / result.local_path
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Cached image is missing on disk")
    filename = PurePosixPath(result.local_path).name
    return FileResponse(file_path, media_type=result.media_type, filename=filename)
