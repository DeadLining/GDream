from copy import deepcopy
from io import BytesIO
import json
import zipfile

from comic_studio import models


def _project_episode_shot(client, title="运营作品"):
    project = client.post(
        "/api/projects",
        json={
            "title": title,
            "logline": "个人创作流程",
            "story_bible": "三卷结构",
            "visual_style": "cinematic comic",
            "aspect_ratio": "16:9",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "雨夜抉择", "premise": "追踪失踪案", "target_duration_seconds": 480},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="雨夜营地",
            time_of_day="night",
            summary="追踪",
            continuity_state={},
            estimated_duration_seconds=30,
        )
        session.add(scene)
        session.flush()
        shot = models.Shot(
            scene_id=scene.id,
            position=1,
            shot_type="wide",
            duration_seconds=3,
            composition="进入营地",
            camera_motion="push_in",
            character_state={"injury": "left_arm"},
            image_prompt="rain camp",
            negative_prompt="",
        )
        session.add(shot)
        session.commit()
        return project, episode, scene.id, shot.id


def test_personal_app_does_not_publish_project_member_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]

    assert not any("members" in path for path in paths)
    assert not any("project-members" in path for path in paths)


def test_tasks_validate_linked_hierarchy_and_support_updates(client):
    project, episode, scene_id, shot_id = _project_episode_shot(client, "任务作品")
    created = client.post(
        f"/api/projects/{project['id']}/tasks",
        json={
            "title": "修正角色左臂伤势",
            "description": "保持前后镜头连续",
            "priority": "high",
            "episode_id": episode["id"],
            "scene_id": scene_id,
            "shot_id": shot_id,
            "checklist": [{"label": "核对主设定", "done": True}],
        },
    )
    assert created.status_code == 201
    task = created.json()
    assert task["status"] == "todo"
    assert "assignee" not in task

    rejected_team_field = client.post(
        f"/api/projects/{project['id']}/tasks",
        json={"title": "不应分配给成员", "assignee": "陈舟"},
    )
    assert rejected_team_field.status_code == 422

    updated = client.patch(
        f"/api/production-tasks/{task['id']}",
        json={"status": "completed", "checklist": [{"label": "核对主设定", "done": True}]},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "completed"

    _other_project, _other_episode, _other_scene, other_shot = _project_episode_shot(client, "其他任务作品")
    invalid = client.post(
        f"/api/projects/{project['id']}/tasks",
        json={"title": "越权任务", "priority": "medium", "shot_id": other_shot},
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "Task links must belong to the project and hierarchy"

    deleted = client.delete(f"/api/production-tasks/{task['id']}")
    assert deleted.status_code == 204
    assert client.patch(
        f"/api/production-tasks/{task['id']}", json={"status": "todo"}
    ).status_code == 404


def test_episode_versions_restore_business_data_with_automatic_backup(client):
    _project, episode, scene_id, shot_id = _project_episode_shot(client, "版本作品")
    with client.app.state.session_factory() as session:
        session.add(models.DialogueLine(
            shot_id=shot_id, position=1, character_id=None, text="原始对白",
            subtitle_text="原始对白", emotion="neutral",
            performance_instruction="平静", start_seconds=0, duration_seconds=1,
        ))
        session.commit()
    v1 = client.post(
        f"/api/episodes/{episode['id']}/versions",
        json={"label": "审核前", "source": "manual"},
    )
    assert v1.status_code == 201
    assert v1.json()["version"] == 1
    assert v1.json()["author"] == "本人"
    assert v1.json()["snapshot"]["episode"]["title"] == "雨夜抉择"

    rejected_author = client.post(
        f"/api/episodes/{episode['id']}/versions",
        json={"label": "不应指定创建者", "source": "manual", "author": "张伟"},
    )
    assert rejected_author.status_code == 422

    with client.app.state.session_factory() as session:
        current_episode = session.get(models.Episode, episode["id"])
        scene = session.get(models.Scene, scene_id)
        shot = session.get(models.Shot, shot_id)
        line = shot.dialogue[0]
        current_episode.title = "雨夜抉择·修订"
        scene.location = "修订后的营地"
        shot.composition = "修订后的构图"
        line.text = "修订对白"
        extra_scene = models.Scene(
            episode_id=episode["id"], position=2, location="新增场景",
            time_of_day="day", summary="不应保留", continuity_state={},
            estimated_duration_seconds=10,
        )
        session.add(extra_scene)
        session.flush()
        session.add(models.Shot(
            scene_id=extra_scene.id, position=1, shot_type="close_up",
            duration_seconds=2, composition="新增镜头", camera_motion="static",
            character_state={}, image_prompt="", negative_prompt="",
        ))
        session.commit()
    v2 = client.post(
        f"/api/episodes/{episode['id']}/versions",
        json={"label": "当前版", "source": "manual"},
    ).json()
    restored = client.post(f"/api/episode-versions/{v1.json()['id']}/restore")
    assert restored.status_code == 201
    restored = restored.json()
    assert restored["version"] == 4
    assert restored["source"] == "restore"
    assert restored["restored_from_id"] == v1.json()["id"]
    assert restored["snapshot"] == v1.json()["snapshot"]
    assert restored["id"] != v2["id"]

    current = client.get(f"/api/episodes/{episode['id']}").json()
    assert current["title"] == "雨夜抉择"
    assert [scene["location"] for scene in current["scenes"]] == ["雨夜营地"]
    assert current["scenes"][0]["shots"][0]["composition"] == "进入营地"
    assert current["scenes"][0]["shots"][0]["dialogue"][0]["text"] == "原始对白"
    versions = client.get(f"/api/episodes/{episode['id']}/versions").json()
    assert [item["version"] for item in versions] == [4, 3, 2, 1]
    assert versions[1]["label"] == "恢复 V1 前自动备份"
    assert versions[1]["snapshot"]["episode"]["title"] == "雨夜抉择·修订"


def test_episode_version_restore_rejects_active_production(client):
    _project, episode, _scene_id, _shot_id = _project_episode_shot(client, "恢复冲突作品")
    version = client.post(
        f"/api/episodes/{episode['id']}/versions",
        json={"label": "生产前", "source": "manual"},
    ).json()
    with client.app.state.session_factory() as session:
        session.add(models.ProductionRun(episode_id=episode["id"], status="running", stages=["panels"]))
        session.commit()

    restored = client.post(f"/api/episode-versions/{version['id']}/restore")

    assert restored.status_code == 409
    assert restored.json()["detail"] == "Cannot restore an episode while production is active"


def test_episode_version_restore_rolls_back_backup_and_business_changes_on_invalid_snapshot(client):
    _project, episode, _scene_id, _shot_id = _project_episode_shot(client, "原子恢复作品")
    version = client.post(
        f"/api/episodes/{episode['id']}/versions",
        json={"label": "损坏快照", "source": "manual"},
    ).json()
    with client.app.state.session_factory() as session:
        current_episode = session.get(models.Episode, episode["id"])
        current_episode.title = "必须保留的当前标题"
        stored_version = session.get(models.EpisodeVersion, version["id"])
        invalid_snapshot = deepcopy(stored_version.snapshot)
        invalid_snapshot["episode"]["title"] = "不得落库的快照标题"
        invalid_snapshot["scenes"][0].pop("position")
        stored_version.snapshot = invalid_snapshot
        session.commit()

    restored = client.post(f"/api/episode-versions/{version['id']}/restore")

    assert restored.status_code == 422
    assert restored.json()["detail"] == "Invalid scene fields in version snapshot"
    current = client.get(f"/api/episodes/{episode['id']}").json()
    assert current["title"] == "必须保留的当前标题"
    versions = client.get(f"/api/episodes/{episode['id']}/versions").json()
    assert [item["version"] for item in versions] == [1]


def test_delivery_packages_require_approved_release_candidate(client):
    project, episode, _scene_id, shot_id = _project_episode_shot(client, "交付作品")
    render_relative = f"projects/{project['id']}/episodes/{episode['id']}/renders/final.mp4"
    render_path = client.app.state.settings.data_root / render_relative
    render_path.parent.mkdir(parents=True, exist_ok=True)
    render_path.write_bytes(b"real-render")
    with client.app.state.session_factory() as session:
        row = models.ReleaseCandidate(
            episode_id=episode["id"],
            version="V1",
            render_path=render_relative,
            qc_snapshot={"overall_pass": True},
            status="draft",
        )
        session.add(row)
        session.add(
            models.DialogueLine(
                shot_id=shot_id,
                position=1,
                character_id=None,
                text="立即离开这里",
                subtitle_text="立即离开这里",
                emotion="urgent",
                performance_instruction="压低声音",
                start_seconds=0.5,
                duration_seconds=1.5,
            )
        )
        session.commit()
        candidate_id = row.id
    body = {
        "release_candidate_id": candidate_id,
        "preset_name": "平台标准包",
        "outputs": [
            {"kind": "landscape_video", "format": "MP4 / H.264", "enabled": True},
            {"kind": "subtitles", "format": "SRT / UTF-8", "enabled": True},
            {"kind": "asset_manifest", "format": "JSON / UTF-8", "enabled": True},
        ],
    }
    blocked = client.post(f"/api/episodes/{episode['id']}/delivery-packages", json=body)
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Delivery package requires an approved release candidate"

    with client.app.state.session_factory() as session:
        row = session.get(models.ReleaseCandidate, candidate_id)
        row.status = "approved"
        session.commit()

    created = client.post(f"/api/episodes/{episode['id']}/delivery-packages", json=body)
    assert created.status_code == 201
    package = created.json()
    assert package["status"] == "completed"
    assert package["checks"] == {
        "release_candidate_approved": True,
        "render_complete": True,
        "archive_created": True,
    }
    assert "asset_license" not in package["checks"]
    assert package["artifact_path"].endswith(".zip")
    assert package["project_id"] == project["id"]

    downloaded = client.get(f"/api/delivery-packages/{package['id']}/download")
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(BytesIO(downloaded.content)) as archive:
        assert set(archive.namelist()) == {
            "video/final.mp4",
            "subtitles/subtitles.srt",
            "manifest.json",
        }
        assert archive.read("video/final.mp4") == b"real-render"
        assert "立即离开这里" in archive.read("subtitles/subtitles.srt").decode()
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["episode"]["id"] == episode["id"]

    (client.app.state.settings.data_root / package["artifact_path"]).unlink()
    packages = client.get(f"/api/episodes/{episode['id']}/delivery-packages")
    assert packages.status_code == 200
    missing = packages.json()[0]
    assert missing["status"] == "failed"
    assert missing["artifact_path"] == ""
    assert missing["checks"]["archive_created"] is False
