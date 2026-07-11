import asyncio
import io
import wave

from comic_studio import models
from comic_studio.services.speech import SpeechService


def wav_fixture() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\x00\x00" * 8000)
    return buffer.getvalue()


class FakeTTS:
    model = "Qwen3-TTS-12Hz-1.7B-CustomVoice"

    def __init__(self):
        self.request = None

    async def synthesize(self, text, speaker, language, instruction):
        self.request = {
            "text": text,
            "speaker": speaker,
            "language": language,
            "instruction": instruction,
        }
        return wav_fixture()


def seed_dialogue(session):
    project = models.Project(
        title="霓虹夜行",
        logline="侦探寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
        aspect_ratio="9:16",
    )
    character = models.Character(
        project=project,
        name="林默",
        role="protagonist",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="保持银色左眼",
        voice_speaker="Dylan",
        voice_instruction="冷静、低声",
    )
    episode = models.Episode(
        project=project, title="雨夜", premise="寻找芯片", target_duration_seconds=60
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="巷道",
        summary="发现线索",
        estimated_duration_seconds=5,
    )
    shot = models.Shot(
        scene=scene,
        position=1,
        shot_type="close_up",
        duration_seconds=5,
        composition="芯片特写",
    )
    session.add(character)
    session.flush()
    line = models.DialogueLine(
        shot=shot,
        character_id=character.id,
        position=1,
        text="别回头。",
        subtitle_text="别回头。",
        emotion="nervous",
        performance_instruction="紧张、快速",
    )
    session.add(line)
    session.commit()
    return project, line


def test_speech_uses_character_voice_and_persists_duration(db_session, tmp_path):
    project, line = seed_dialogue(db_session)
    provider = FakeTTS()

    asset = asyncio.run(
        SpeechService(db_session, tmp_path, provider).synthesize_dialogue(line.id)
    )

    db_session.refresh(line)
    assert provider.request["speaker"] == "Dylan"
    assert provider.request["instruction"] == "冷静、低声；紧张、快速"
    assert line.audio_asset_id == asset.id
    assert 0.49 <= line.duration_seconds <= 0.51
    assert (tmp_path / asset.local_path).read_bytes().startswith(b"RIFF")
