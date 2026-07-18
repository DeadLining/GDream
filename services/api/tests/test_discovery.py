from datetime import datetime, timezone

from comic_studio import models
from comic_studio.services.discovery import updated_on_workspace_today
from comic_studio.services.shot_inputs import ShotInputCompiler


def _project(client, title="发现页作品"):
    return client.post(
        "/api/projects",
        json={
            "title": title,
            "logline": "雨夜追踪失踪线索",
            "story_bible": "三卷悬疑结构",
            "visual_style": "cinematic anime",
            "aspect_ratio": "16:9",
        },
    ).json()


def test_workspace_today_uses_shanghai_calendar_boundary():
    now = datetime(2026, 7, 18, 0, 30, tzinfo=timezone.utc)
    updated = datetime(2026, 7, 17, 16, 45, tzinfo=timezone.utc)

    assert updated_on_workspace_today(updated, now=now) is True


def test_workspace_summary_uses_real_project_task_and_review_counts(client):
    project = _project(client)
    volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "第一卷", "summary": "暗潮", "position": 1},
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "雨夜抉择", "premise": "寻找线索", "target_duration_seconds": 60, "volume_id": volume["id"], "position": 1},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(episode_id=episode["id"], position=1, location="珊瑚营地", time_of_day="night", summary="雨夜追踪", continuity_state={}, estimated_duration_seconds=12)
        session.add(scene); session.flush()
        shot = models.Shot(scene_id=scene.id, position=1, shot_type="close_up", duration_seconds=4, composition="林默查看左臂伤势", camera_motion="static", character_state={}, image_prompt="rain injury", negative_prompt="", review_status="draft")
        session.add(shot); session.commit()
    client.post(
        f"/api/projects/{project['id']}/tasks",
        json={"title":"补齐环境音","description":"雨声层次","priority":"medium","episode_id":episode["id"],"scene_id":scene.id,"shot_id":shot.id,"review_thread_id":None,"due_at":None,"checklist":[]},
    )

    response = client.get("/api/workspace/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_project_count"] == 1
    assert payload["active_task_count"] == 1
    assert payload["pending_review_count"] == 1
    row = payload["projects"][0]
    assert row == {
        **row,
        "project_id": project["id"],
        "volume_count": 1,
        "episode_count": 1,
        "scene_count": 1,
        "shot_count": 1,
        "open_task_count": 1,
        "pending_review_count": 1,
        "completion_percent": 0,
        "current_stage": "画面制作",
        "latest_task_titles": ["补齐环境音"],
    }


def test_workspace_progress_includes_panel_and_video_readiness(client):
    project = _project(client, "真实进度")
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "寻找线索", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"],
            position=1,
            location="旧城",
            time_of_day="night",
            summary="追踪",
            continuity_state={},
            estimated_duration_seconds=12,
        )
        session.add(scene)
        session.flush()
        shot = models.Shot(
            scene_id=scene.id,
            position=1,
            shot_type="close_up",
            duration_seconds=4,
            composition="查看怀表",
            camera_motion="static",
            character_state={},
            image_prompt="watch",
            negative_prompt="",
            review_status="approved",
        )
        session.add(shot)
        session.flush()
        panel = models.Asset(
            project_id=project["id"],
            kind=f"panel:{shot.id}",
            local_path="panel.png",
            media_type="image/png",
            provider="test",
            model="test",
            checksum="0" * 64,
        )
        session.add(panel)
        session.flush()
        compiled = ShotInputCompiler(session).compile(
            shot.id, usage_kinds={"panel", "reference"}
        )
        panel.request_metadata = {
            "input_snapshot": compiled.snapshot,
            "input_snapshot_hash": compiled.snapshot_hash,
        }
        shot.active_panel_asset_id = panel.id
        session.commit()

    row = client.get("/api/workspace/summary").json()["projects"][0]

    assert row["completion_percent"] == 67
    assert row["current_stage"] == "视频制作"

    with client.app.state.session_factory() as session:
        shot = session.get(models.Shot, shot.id)
        video = models.Asset(
            project_id=project["id"],
            kind=f"video:{shot.id}",
            local_path="video.mp4",
            media_type="video/mp4",
            provider="test",
            model="test",
            checksum="1" * 64,
            duration_seconds=4,
            parent_asset_id=shot.active_panel_asset_id,
        )
        session.add(video)
        session.flush()
        shot.active_video_asset_id = video.id
        session.commit()

    row = client.get("/api/workspace/summary").json()["projects"][0]

    assert row["completion_percent"] == 100
    assert row["current_stage"] == "素材就绪"


def test_project_search_returns_navigable_results_across_real_resources(client):
    project = _project(client, "雨夜长安")
    character = client.post(
        f"/api/projects/{project['id']}/characters",
        json={"name":"林默","role":"主角","appearance_bible":"黑发少年","personality":"克制","continuity_rules":"左臂伤势连续","voice_speaker":"speaker"},
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title":"雨夜抉择","premise":"寻找失踪同伴","target_duration_seconds":60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(episode_id=episode["id"],position=1,location="珊瑚营地",time_of_day="night",summary="雨夜追踪",continuity_state={},estimated_duration_seconds=12)
        session.add(scene);session.flush()
        shot = models.Shot(scene_id=scene.id,position=7,shot_type="close_up",duration_seconds=4,composition="林默左臂擦伤特写",camera_motion="static",character_state={},image_prompt="injured arm",negative_prompt="")
        session.add(shot);session.commit();shot_id=shot.id
    master = client.post(f"/api/characters/{character['id']}/variants",json={"kind":"master","label":"作品主设定","inherited_fields":[],"overrides":{}}).json()
    variant = client.post(f"/api/characters/{character['id']}/variants",json={"kind":"episode","label":"雨夜造型","episode_id":episode["id"],"parent_variant_id":master["id"],"inherited_fields":["identity"],"overrides":{}}).json()
    state = client.post(f"/api/asset-variants/{variant['id']}/states",json={"kind":"injury","label":"左臂擦伤","overrides":{}}).json()
    client.post(f"/api/asset-variants/{variant['id']}/usages",json={"state_id":state["id"],"shot_id":shot_id,"usage_kind":"panel"})
    library_asset = client.post(
        f"/api/projects/{project['id']}/library-assets",
        json={
            "kind": "prop",
            "name": "左臂护具",
            "description": "雨夜行动使用",
            "tags": ["伤势", "道具"],
            "metadata": {},
        },
    ).json()
    client.post(f"/api/projects/{project['id']}/tasks",json={"title":"修正左臂伤势","description":"保持连续性","priority":"high","episode_id":episode["id"],"scene_id":scene.id,"shot_id":shot_id,"review_thread_id":None,"due_at":None,"checklist":[]})

    response = client.get(f"/api/projects/{project['id']}/search", params={"q":"左臂"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "左臂"
    kinds = {item["kind"] for item in payload["results"]}
    assert {"asset_state", "library_asset", "shot", "task"}.issubset(kinds)
    asset = next(item for item in payload["results"] if item["kind"] == "asset_state")
    assert asset["state_id"] == state["id"]
    assert asset["character_id"] == character["id"]
    assert asset["reference_count"] == 1
    assert asset["hierarchy"] == ["作品主设定", "雨夜造型", "左臂擦伤"]
    shot_result = next(item for item in payload["results"] if item["kind"] == "shot")
    assert shot_result["shot_id"] == shot_id
    assert shot_result["episode_id"] == episode["id"]
    library_result = next(
        item for item in payload["results"] if item["kind"] == "library_asset"
    )
    assert library_result["library_asset_id"] == library_asset["id"]
    assert library_result["library_asset_kind"] == "prop"
    assert library_result["hierarchy"] == ["雨夜长安", "道具资产", "左臂护具"]


def test_project_search_rejects_blank_and_caps_result_count(client):
    project = _project(client)
    blank = client.get(f"/api/projects/{project['id']}/search", params={"q":"   "})
    missing = client.get("/api/projects/missing/search", params={"q":"雨夜"})
    assert blank.status_code == 422
    assert missing.status_code == 404
