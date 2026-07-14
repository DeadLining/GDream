from comic_studio import models


def _graph(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "视觉审阅",
            "logline": "圈点修改",
            "story_bible": "角色一致性",
            "visual_style": "comic",
            "aspect_ratio": "9:16",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "发现线索", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        scene = models.Scene(
            episode_id=episode["id"], position=1, location="巷道",
            time_of_day="night", summary="发现线索", continuity_state={},
            estimated_duration_seconds=8,
        )
        session.add(scene);session.flush()
        shot = models.Shot(
            scene_id=scene.id, position=1, shot_type="close_up",
            duration_seconds=8, composition="角色表情特写",
            camera_motion="static", character_state={}, image_prompt="face",
            negative_prompt="",
        )
        session.add(shot);session.flush()
        source = models.Asset(
            project_id=project["id"], kind="panel", local_path="source.png",
            media_type="image/png", provider="test", model="test",
            request_metadata={}, checksum="source", review_status="draft",
        )
        candidate = models.Asset(
            project_id=project["id"], kind="panel", local_path="candidate.png",
            media_type="image/png", provider="test", model="test",
            request_metadata={}, parent_asset_id=source.id, checksum="candidate",
            review_status="draft",
        )
        session.add_all([source,candidate]);session.commit()
        return project,shot.id,source.id,candidate.id


def test_visual_review_persists_annotation_conversation_and_candidate(client):
    _project,shot_id,source_id,candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"表情不符合情绪","modification_scope":"shot"},
    )
    assert thread.status_code==201
    thread=thread.json()
    annotation=client.post(
        f"/api/visual-review-threads/{thread['id']}/annotations",
        json={"kind":"circle","geometry":{"cx":0.42,"cy":0.31,"rx":0.12,"ry":0.08},"color":"#B9473E","label":"脸部"},
    )
    assert annotation.status_code==201
    message=client.post(
        f"/api/visual-review-threads/{thread['id']}/messages",
        json={"author_kind":"user","content":"降低惊恐感，但不要改变脸型。"},
    )
    assert message.status_code==201
    scope=client.patch(
        f"/api/visual-review-threads/{thread['id']}",
        json={"modification_scope":"episode"},
    )
    assert scope.status_code==200
    assert scope.json()["modification_scope"]=="episode"
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{"locked":["identity","outfit"]}},
    )
    assert candidate.status_code==201

    response=client.get(f"/api/shots/{shot_id}/visual-review-threads")

    assert response.status_code==200
    loaded=response.json()[0]
    assert loaded["annotations"][0]["geometry"]["cx"]==0.42
    assert loaded["messages"][0]["content"]=="降低惊恐感，但不要改变脸型。"
    assert loaded["candidates"][0]["asset_id"]==candidate_id

    accepted=client.post(f"/api/visual-review-candidates/{candidate.json()['id']}/accept")
    assert accepted.status_code==200
    assert accepted.json()["status"]=="accepted"
    assert client.get(f"/api/episodes/{loaded['episode_id']}").json()["scenes"][0]["shots"][0]["active_panel_asset_id"]==candidate_id


def test_visual_annotation_rejects_geometry_outside_normalized_canvas(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"越界圈点","modification_scope":"shot"},
    ).json()

    response=client.post(
        f"/api/visual-review-threads/{thread['id']}/annotations",
        json={"kind":"circle","geometry":{"cx":1.2,"cy":0.3,"rx":0.1,"ry":0.1},"color":"#B9473E","label":"错误"},
    )

    assert response.status_code==422


def test_visual_review_rejects_asset_from_another_project(client):
    _project,shot_id,_source_id,_candidate_id=_graph(client)
    other=client.post(
        "/api/projects",
        json={"title":"其他","logline":"x","story_bible":"x","visual_style":"comic","aspect_ratio":"9:16"},
    ).json()
    with client.app.state.session_factory() as session:
        asset=models.Asset(
            project_id=other["id"],kind="panel",local_path="other.png",
            media_type="image/png",provider="test",model="test",request_metadata={},
            checksum="other",review_status="draft",
        )
        session.add(asset);session.commit();asset_id=asset.id

    response=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":asset_id,"title":"错误来源","modification_scope":"shot"},
    )

    assert response.status_code==422
    assert response.json()["detail"]=="Source asset must belong to the shot project"


def test_visual_review_candidate_can_be_rejected(client):
    _project,shot_id,source_id,candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"服装不连续","modification_scope":"shot"},
    ).json()
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{}},
    ).json()

    rejected=client.post(f"/api/visual-review-candidates/{candidate['id']}/reject")

    assert rejected.status_code==200
    assert rejected.json()["status"]=="rejected"
    accepted=client.post(f"/api/visual-review-candidates/{candidate['id']}/accept")
    assert accepted.status_code==409
    assert accepted.json()["detail"]=="Candidate is not ready for acceptance"


def test_visual_annotation_can_be_updated_and_deleted_without_removing_thread(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"脸部圈点","modification_scope":"shot"},
    ).json()
    annotation=client.post(
        f"/api/visual-review-threads/{thread['id']}/annotations",
        json={"kind":"circle","geometry":{"cx":0.42,"cy":0.31,"rx":0.12,"ry":0.08},"color":"#B9473E","label":"脸部"},
    ).json()

    updated=client.patch(
        f"/api/visual-annotations/{annotation['id']}",
        json={"label":"眉眼区域","geometry":{"cx":0.46,"cy":0.29,"rx":0.1,"ry":0.07}},
    )
    deleted=client.delete(f"/api/visual-annotations/{annotation['id']}")
    loaded=client.get(f"/api/shots/{shot_id}/visual-review-threads")

    assert updated.status_code==200
    assert updated.json()["label"]=="眉眼区域"
    assert updated.json()["geometry"]["cx"]==0.46
    assert deleted.status_code==204
    assert loaded.status_code==200
    assert loaded.json()[0]["id"]==thread["id"]
    assert loaded.json()[0]["annotations"]==[]


def test_visual_annotation_patch_revalidates_merged_geometry(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"脸部圈点","modification_scope":"shot"},
    ).json()
    annotation=client.post(
        f"/api/visual-review-threads/{thread['id']}/annotations",
        json={"kind":"circle","geometry":{"cx":0.42,"cy":0.31,"rx":0.12,"ry":0.08},"color":"#B9473E","label":"脸部"},
    ).json()

    response=client.patch(
        f"/api/visual-annotations/{annotation['id']}",
        json={"geometry":{"cx":0.99,"cy":0.31,"rx":0.12,"ry":0.08}},
    )

    assert response.status_code==422
