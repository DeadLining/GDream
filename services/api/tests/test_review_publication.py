from comic_studio import models


def _ready_episode(client):
    project=client.post("/api/projects",json={"title":"终审作品","logline":"发布","story_bible":"一致性","visual_style":"comic","aspect_ratio":"9:16"}).json()
    episode=client.post(f"/api/projects/{project['id']}/episodes",json={"title":"第一集","premise":"完成制作","target_duration_seconds":60}).json()
    with client.app.state.session_factory() as session:
        scene=models.Scene(episode_id=episode["id"],position=1,location="主街",time_of_day="day",summary="完成",continuity_state={},estimated_duration_seconds=8)
        session.add(scene);session.flush()
        asset=models.Asset(project_id=project["id"],kind="panel",local_path="panel.png",media_type="image/png",provider="test",model="test",request_metadata={},checksum="panel",review_status="approved")
        session.add(asset);session.flush()
        shot=models.Shot(scene_id=scene.id,position=1,shot_type="wide",duration_seconds=8,composition="完成镜头",camera_motion="static",character_state={},image_prompt="done",negative_prompt="",active_panel_asset_id=asset.id,review_status="approved",render_status="completed")
        session.add(shot);session.commit()
        return project,episode,shot.id


def test_publish_gate_requires_resolved_critical_threads_and_is_idempotent(client):
    _project,episode,shot_id=_ready_episode(client)
    thread=client.post(
        f"/api/episodes/{episode['id']}/review-threads",
        json={"shot_id":shot_id,"timecode_seconds":4.25,"severity":"critical","title":"角色脸型漂移"},
    )
    assert thread.status_code==201
    thread=thread.json()
    message=client.post(
        f"/api/review-threads/{thread['id']}/messages",
        json={"author_kind":"user","content":"请恢复主设定脸型。"},
    )
    assert message.status_code==201
    candidate=client.post(
        f"/api/episodes/{episode['id']}/release-candidates",
        json={"version":"V1","render_path":"projects/p/episodes/e/renders/final.mp4","qc_snapshot":{"black_frames":0}},
    )
    assert candidate.status_code==201
    candidate=candidate.json()

    blocked=client.post(f"/api/release-candidates/{candidate['id']}/approve")
    assert blocked.status_code==409
    assert blocked.json()["detail"]=="Release candidate is blocked"
    gate=client.get(f"/api/release-candidates/{candidate['id']}/gate").json()
    assert gate["ready"] is False
    assert gate["open_critical_threads"]==[thread["id"]]

    resolved=client.patch(f"/api/review-threads/{thread['id']}",json={"status":"resolved"})
    assert resolved.status_code==200
    approved=client.post(f"/api/release-candidates/{candidate['id']}/approve")
    assert approved.status_code==200
    assert approved.json()["status"]=="approved"

    body={"platform":"internal_master","idempotency_key":"release-v1-internal"}
    first=client.post(f"/api/release-candidates/{candidate['id']}/publish",json=body)
    second=client.post(f"/api/release-candidates/{candidate['id']}/publish",json=body)
    assert first.status_code==201
    assert second.status_code==200
    assert second.json()["id"]==first.json()["id"]


def test_review_thread_rejects_shot_from_another_episode(client):
    _project,episode,_shot_id=_ready_episode(client)
    _other_project,_other_episode,other_shot_id=_ready_episode(client)

    response=client.post(
        f"/api/episodes/{episode['id']}/review-threads",
        json={"shot_id":other_shot_id,"timecode_seconds":1,"severity":"major","title":"错误镜头"},
    )

    assert response.status_code==422
    assert response.json()["detail"]=="Shot must belong to the review episode"


def test_release_candidates_can_be_listed_in_version_order(client):
    _project,episode,_shot_id=_ready_episode(client)
    for version in ("V2","V1"):
        response=client.post(
            f"/api/episodes/{episode['id']}/release-candidates",
            json={"version":version,"render_path":f"projects/p/{version}.mp4","qc_snapshot":{}},
        )
        assert response.status_code==201

    response=client.get(f"/api/episodes/{episode['id']}/release-candidates")

    assert response.status_code==200
    assert [item["version"] for item in response.json()]==["V1","V2"]


def test_release_candidate_list_rejects_unknown_episode(client):
    response=client.get("/api/episodes/missing/release-candidates")

    assert response.status_code==404
    assert response.json()["detail"]=="Episode not found"
