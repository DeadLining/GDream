from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Callable

from PIL import Image, ImageOps, UnidentifiedImageError

from comic_studio.services.character_3d import Character3DRepresentationService


class Model3DPostProcessError(ValueError):
    pass


@dataclass(frozen=True)
class ProcessedModel3D:
    content: bytes
    thumbnail: bytes
    metadata: dict[str, Any]


class Model3DPostProcessor:
    TIMEOUT_SECONDS = 120
    THUMBNAIL_SIZE = (512, 512)

    def __init__(
        self,
        data_root: Path,
        *,
        node_executable: str = "node",
        script_path: Path | None = None,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ):
        self.data_root = Path(data_root).resolve()
        self.node_executable = node_executable
        self.script_path = (
            Path(script_path).resolve()
            if script_path is not None
            else Path(__file__).resolve().parents[4]
            / "scripts"
            / "model3d-postprocess.mjs"
        )
        self.runner = runner

    def process(
        self, model_content: bytes, thumbnail_source: bytes
    ) -> ProcessedModel3D:
        Character3DRepresentationService.inspect_glb(model_content)
        temporary_root = self.data_root / ".model3d-postprocess"
        temporary_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
                input_path = Path(directory) / "input.glb"
                output_path = Path(directory) / "output.glb"
                input_path.write_bytes(model_content)
                try:
                    completed = self.runner(
                        [
                            self.node_executable,
                            str(self.script_path),
                            str(input_path),
                            str(output_path),
                        ],
                        capture_output=True,
                        check=False,
                        text=True,
                        timeout=self.TIMEOUT_SECONDS,
                    )
                except FileNotFoundError as exc:
                    raise Model3DPostProcessError(
                        "model3d_postprocessor_unavailable"
                    ) from exc
                except subprocess.TimeoutExpired as exc:
                    raise Model3DPostProcessError(
                        "model3d_postprocess_timeout"
                    ) from exc
                if completed.returncode != 0:
                    raise Model3DPostProcessError("model3d_postprocess_failed")
                metadata = self._metadata(completed.stdout)
                try:
                    optimized = output_path.read_bytes()
                    Character3DRepresentationService.inspect_glb(optimized)
                except (OSError, ValueError) as exc:
                    raise Model3DPostProcessError(
                        "invalid_model3d_postprocess_result"
                    ) from exc
        except Model3DPostProcessError:
            raise
        except OSError as exc:
            raise Model3DPostProcessError("model3d_postprocess_failed") from exc

        thumbnail = self._thumbnail(thumbnail_source)
        return ProcessedModel3D(
            content=optimized,
            thumbnail=thumbnail,
            metadata={
                **metadata,
                "source_bytes": len(model_content),
                "output_bytes": len(optimized),
                "thumbnail_width": self.THUMBNAIL_SIZE[0],
                "thumbnail_height": self.THUMBNAIL_SIZE[1],
            },
        )

    @staticmethod
    def _metadata(stdout: str) -> dict[str, Any]:
        try:
            metadata = json.loads(stdout)
        except (TypeError, json.JSONDecodeError) as exc:
            raise Model3DPostProcessError("invalid_model3d_postprocess_result") from exc
        if (
            not isinstance(metadata, dict)
            or metadata.get("tool") != "gltf-transform"
            or metadata.get("version") != "4.4.1"
            or not isinstance(metadata.get("protected_rig"), bool)
            or not isinstance(metadata.get("steps"), list)
            or not all(isinstance(step, str) for step in metadata["steps"])
        ):
            raise Model3DPostProcessError("invalid_model3d_postprocess_result")
        return metadata

    @classmethod
    def _thumbnail(cls, source: bytes) -> bytes:
        try:
            with Image.open(BytesIO(source)) as image:
                thumbnail = ImageOps.pad(
                    image.convert("RGB"),
                    cls.THUMBNAIL_SIZE,
                    method=Image.Resampling.LANCZOS,
                    color="white",
                )
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise Model3DPostProcessError("model3d_thumbnail_source_invalid") from exc
        output = BytesIO()
        thumbnail.save(output, format="PNG", optimize=False, compress_level=9)
        return output.getvalue()
