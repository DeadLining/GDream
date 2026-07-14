from comic_studio import models


def _seed_structure(client):
    with client.app.state.session_factory() as session:
        project = models.Project(
            title="结构编辑",
            logline="编辑后定向补跑",
            story_bible="保持连续性",
            visual_style="comic",
            aspect_ratio="9:16",
        )
        episode = models.Episode(
            project=project,
            title="第一集",
            premise="发现线索",
            target_duration_seconds=60,
        )
        first = models.Scene(
            episode=episode,
            position=1,
            location="旧巷",
            time_of_day="night",
            summary="雨夜追踪",
            continuity_state={"weather": "rain"},
            estimated_duration_seconds=12,
        )
        second = models.Scene(
            episode=episode,
            position=2,
            location="仓库",
            time_of_day="night",
            summary="找到线索",
            continuity_state={},
            estimated_duration_seconds=8,
        )
        shot_a = models.Shot(
            scene=first,
            position=1,
            shot_type="wide",
            duration_seconds=5,
            composition="角色进入旧巷",
            camera_motion="push_in",
            character_state={},
            image_prompt="rainy alley",
            negative_prompt="",
            review_status="approved",
            render_status="completed",
            video_render_status="completed",
        )
        shot_b = models.Shot(
            scene=first,
            position=2,
            shot_type="close_up",
            duration_seconds=4,
            composition="角色发现脚印",
            camera_motion="static",
            character_state={},
            image_prompt="footprint close-up",
            negative_prompt="",
            review_status="approved",
            render_status="completed",
            video_render_status="completed",
        )
        shot_c = models.Shot(
            scene=second,
            position=1,
            shot_type="medium",
            duration_seconds=4,
            composition="角色进入仓库",
            camera_motion="static",
            character_state={},
            image_prompt="warehouse",
            negative_prompt="",
            review_status="approved",
            render_status="completed",
            video_render_status="completed",
        )
        session.add_all([shot_a, shot_b, shot_c])
        session.flush()
        for shot in (shot_a, shot_b, shot_c):
            panel = models.Asset(
                project_id=project.id,
                kind=f"panel:{shot.id}",
                local_path=f"{shot.id}-panel.png",
                media_type="image/png",
                provider="test",
                model="test",
                request_metadata={},
                checksum=f"panel-{shot.id}",
                review_status="approved",
            )
            video = models.Asset(
                project_id=project.id,
                kind=f"video:{shot.id}",
                local_path=f"{shot.id}-video.mp4",
                media_type="video/mp4",
                provider="test",
                model="test",
                request_metadata={},
                checksum=f"video-{shot.id}",
                review_status="approved",
            )
            session.add_all([panel, video])
            session.flush()
            shot.active_panel_asset_id = panel.id
            shot.active_video_asset_id = video.id
        session.commit()
        return episode.id, first.id, second.id, shot_a.id, shot_b.id, shot_c.id


def test_scene_update_invalidates_all_scene_shots_but_preserves_panel_history(client):
    episode_id, scene_id, _second_id, shot_a, shot_b, shot_c = _seed_structure(client)

    response = client.patch(
        f"/api/scenes/{scene_id}",
        json={"location": "霓虹旧巷", "time_of_day": "dawn"},
    )

    assert response.status_code == 200
    assert set(response.json()["affected_shot_ids"]) == {shot_a, shot_b}
    assert response.json()["invalidated_stages"] == ["panels", "videos"]
    episode = client.get(f"/api/episodes/{episode_id}").json()
    shots = {shot["id"]: shot for scene in episode["scenes"] for shot in scene["shots"]}
    assert shots[shot_a]["active_panel_asset_id"] is not None
    assert shots[shot_a]["active_video_asset_id"] is None
    assert shots[shot_a]["review_status"] == "draft"
    assert shots[shot_b]["render_status"] == "pending"
    assert shots[shot_c]["review_status"] == "approved"


def test_shot_update_invalidates_only_that_shot(client):
    _episode_id, _scene_id, _second_id, shot_a, shot_b, _shot_c = _seed_structure(client)

    response = client.patch(
        f"/api/shots/{shot_a}",
        json={"composition": "角色停在霓虹灯下", "image_prompt": "neon alley"},
    )

    assert response.status_code == 200
    assert response.json()["active_panel_asset_id"] is not None
    assert response.json()["active_video_asset_id"] is None
    assert response.json()["review_status"] == "draft"
    with client.app.state.session_factory() as session:
        untouched = session.get(models.Shot, shot_b)
        assert untouched.review_status == "approved"
        assert untouched.active_video_asset_id is not None


def test_scene_structure_supports_create_reorder_and_delete(client):
    episode_id, scene_a, scene_b, shot_a, shot_b, _shot_c = _seed_structure(client)
    created_scene = client.post(
        f"/api/episodes/{episode_id}/scenes",
        json={
            "location": "天台",
            "time_of_day": "dawn",
            "summary": "追踪结束",
            "continuity_state": {},
            "estimated_duration_seconds": 6,
        },
    )
    assert created_scene.status_code == 201
    scene_c = created_scene.json()["resource_id"]

    created_shot = client.post(
        f"/api/scenes/{scene_c}/shots",
        json={
            "shot_type": "wide",
            "duration_seconds": 4,
            "composition": "角色站在天台边缘",
            "camera_motion": "push_in",
            "character_state": {},
            "image_prompt": "rooftop dawn",
            "negative_prompt": "",
        },
    )
    assert created_shot.status_code == 201
    assert created_shot.json()["affected_shot_ids"] == [created_shot.json()["resource_id"]]

    reordered = client.put(
        f"/api/episodes/{episode_id}/scene-order",
        json={"ids": [scene_c, scene_a, scene_b]},
    )
    assert reordered.status_code == 200
    assert [scene["id"] for scene in client.get(f"/api/episodes/{episode_id}").json()["scenes"]] == [scene_c, scene_a, scene_b]

    invalid_order = client.put(
        f"/api/scenes/{scene_a}/shot-order",
        json={"ids": [shot_a]},
    )
    assert invalid_order.status_code == 422
    assert invalid_order.json()["detail"] == "Shot order must contain every shot in the scene exactly once"

    cross_scene = client.put(
        f"/api/scenes/{scene_a}/shot-order",
        json={"ids": [shot_a, created_shot.json()["resource_id"]]},
    )
    assert cross_scene.status_code == 422

    deleted = client.delete(f"/api/shots/{shot_b}")
    assert deleted.status_code == 200
    assert shot_b not in {
        shot["id"]
        for scene in client.get(f"/api/episodes/{episode_id}").json()["scenes"]
        for shot in scene["shots"]
    }
