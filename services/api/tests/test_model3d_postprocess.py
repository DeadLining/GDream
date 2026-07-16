import json
from io import BytesIO
from pathlib import Path
import subprocess

from PIL import Image
import pytest

from comic_studio.services.model_3d_postprocess import (
    Model3DPostProcessError,
    Model3DPostProcessor,
)
from tests.test_character_3d_representations import _glb


def _thumbnail_source() -> bytes:
    output = BytesIO()
    Image.new("RGB", (80, 160), (30, 90, 180)).save(output, format="PNG")
    return output.getvalue()


def test_postprocessor_runs_pinned_tool_and_builds_a_square_thumbnail(tmp_path):
    commands = []
    optimized = _glb({"asset": {"version": "2.0", "generator": "optimized"}})

    def runner(command, **kwargs):
        commands.append((command, kwargs))
        Path(command[3]).write_bytes(optimized)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(
                {
                    "tool": "gltf-transform",
                    "version": "4.4.1",
                    "protected_rig": False,
                    "steps": [
                        "dedup",
                        "prune",
                        "weld",
                        "simplify",
                        "texture_compress",
                    ],
                }
            ),
            stderr="",
        )

    processor = Model3DPostProcessor(
        tmp_path,
        node_executable="/usr/bin/node",
        script_path=tmp_path / "model3d-postprocess.mjs",
        runner=runner,
    )

    result = processor.process(_glb(), _thumbnail_source())

    assert result.content == optimized
    assert result.metadata == {
        "tool": "gltf-transform",
        "version": "4.4.1",
        "protected_rig": False,
        "steps": ["dedup", "prune", "weld", "simplify", "texture_compress"],
        "source_bytes": len(_glb()),
        "output_bytes": len(optimized),
        "thumbnail_width": 512,
        "thumbnail_height": 512,
    }
    with Image.open(BytesIO(result.thumbnail)) as thumbnail:
        assert thumbnail.size == (512, 512)
        assert thumbnail.mode == "RGB"
        assert thumbnail.getpixel((256, 256)) == (30, 90, 180)
    command, kwargs = commands[0]
    assert command[:2] == ["/usr/bin/node", str(tmp_path / "model3d-postprocess.mjs")]
    assert command[2].endswith("input.glb")
    assert command[3].endswith("output.glb")
    assert kwargs == {
        "capture_output": True,
        "check": False,
        "text": True,
        "timeout": 120,
    }


def test_postprocessor_rejects_failed_or_missing_tools_without_leaking_stderr(tmp_path):
    def failed_runner(command, **_kwargs):
        return subprocess.CompletedProcess(
            command,
            1,
            stdout="",
            stderr="secret-provider-token internal stack",
        )

    processor = Model3DPostProcessor(
        tmp_path,
        script_path=tmp_path / "model3d-postprocess.mjs",
        runner=failed_runner,
    )

    with pytest.raises(Model3DPostProcessError) as captured:
        processor.process(_glb(), _thumbnail_source())

    assert str(captured.value) == "model3d_postprocess_failed"
    assert "secret-provider-token" not in str(captured.value)


def test_postprocessor_rejects_invalid_tool_metadata(tmp_path):
    def invalid_runner(command, **_kwargs):
        Path(command[3]).write_bytes(_glb())
        return subprocess.CompletedProcess(command, 0, stdout="not-json", stderr="")

    processor = Model3DPostProcessor(
        tmp_path,
        script_path=tmp_path / "model3d-postprocess.mjs",
        runner=invalid_runner,
    )

    with pytest.raises(Model3DPostProcessError, match="invalid_model3d_postprocess_result"):
        processor.process(_glb(), _thumbnail_source())
