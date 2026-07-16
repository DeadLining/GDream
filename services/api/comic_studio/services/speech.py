import json
import subprocess
from pathlib import Path
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.assets import AssetStore


class SpeechProvider(Protocol):
    model: str

    async def synthesize(
        self, text: str, speaker: str, language: str, instruction: str
    ) -> bytes: ...


class SpeechService:
    def __init__(
        self,
        session: Session,
        data_root: Path,
        provider: SpeechProvider,
        *,
        narrator_speaker: str = "dylan",
    ):
        self.session = session
        self.data_root = data_root.resolve()
        self.assets = AssetStore(session, self.data_root)
        self.provider = provider
        self.narrator_speaker = narrator_speaker.strip()
        if not self.narrator_speaker:
            raise ValueError("Narrator speaker must not be empty")

    async def synthesize_dialogue(self, dialogue_id: str) -> models.Asset:
        statement = (
            select(models.DialogueLine)
            .options(
                selectinload(models.DialogueLine.shot)
                .selectinload(models.Shot.scene)
                .selectinload(models.Scene.episode)
            )
            .where(models.DialogueLine.id == dialogue_id)
        )
        line = self.session.scalar(statement)
        if line is None:
            raise KeyError(dialogue_id)
        character = (
            self.session.get(models.Character, line.character_id)
            if line.character_id is not None
            else None
        )
        if line.character_id is not None and character is None:
            raise ValueError("Dialogue character does not exist")

        instructions = [
            value.strip()
            for value in (
                character.voice_instruction if character is not None else "",
                line.performance_instruction,
            )
            if value.strip()
        ]
        instruction = "；".join(instructions)
        speaker = (
            character.voice_speaker
            if character is not None
            else self.narrator_speaker
        )
        audio = await self.provider.synthesize(
            line.text, speaker, "Chinese", instruction
        )
        project_id = line.shot.scene.episode.project_id
        asset = self.assets.register_dialogue_audio(
            project_id=project_id,
            dialogue_id=line.id,
            content=audio,
            provider="qwen3-tts",
            model=self.provider.model,
            request_metadata={
                "speaker": speaker,
                "language": "Chinese",
                "instruction": instruction,
                "text": line.text,
            },
        )
        duration = self._probe_duration(self.data_root / asset.local_path)
        line.duration_seconds = duration
        asset.duration_seconds = duration
        self.session.commit()
        self.session.refresh(asset)
        return asset

    @staticmethod
    def _probe_duration(path: Path) -> float:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return float(json.loads(result.stdout)["format"]["duration"])
