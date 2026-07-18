from pathlib import Path

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.episode_ai_stage_handlers import EpisodeAIStageHandlers
from comic_studio.services.rendering import RenderingService
from comic_studio.services.shot_inputs import ShotInputCompiler


def _ready_episode(client, *, video_ready=True):
    project=client.post("/api/projects",json={"title":"终审作品","logline":"发布","story_bible":"一致性","visual_style":"comic","aspect_ratio":"9:16"}).json()
    episode=client.post(f"/api/projects/{project['id']}/episodes",json={"title":"第一集","premise":"完成制作","target_duration_seconds":60}).json()
    with client.app.state.session_factory() as session:
        scene=models.Scene(episode_id=episode["id"],position=1,location="主街",time_of_day="day",summary="完成",continuity_state={},estimated_duration_seconds=8)
        session.add(scene);session.flush()
        shot=models.Shot(scene_id=scene.id,position=1,shot_type="wide",duration_seconds=8,composition="完成镜头",camera_motion="static",character_state={},image_prompt="done",negative_prompt="",review_status="approved",render_status="completed")
        session.add(shot);session.flush()
        asset=models.Asset(project_id=project["id"],kind=f"panel:{shot.id}",local_path="panel.png",media_type="image/png",provider="test",model="test",request_metadata={},checksum="panel",review_status="approved")
        video=models.Asset(project_id=project["id"],kind=f"video:{shot.id}",local_path="video.mp4",media_type="video/mp4",provider="test",model="test",request_metadata={},checksum="video",review_status="approved")
        session.add_all([asset,video]);session.flush()
        data_root=client.app.state.settings.data_root
        (data_root/asset.local_path).write_bytes(b"panel")
        (data_root/video.local_path).write_bytes(b"\x00\x00\x00\x18ftypmp42video")
        video.parent_asset_id=asset.id
        video.duration_seconds=8
        shot.active_panel_asset_id=asset.id
        shot.active_video_asset_id=video.id if video_ready else None
        compiled=ShotInputCompiler(session).compile(shot.id,usage_kinds={"panel","reference"})
        asset.request_metadata={"input_snapshot":compiled.snapshot,"input_snapshot_hash":compiled.snapshot_hash}
        session.commit()
        return project,episode,shot.id


def _register_render(client, project_id, episode_id, *, overall_pass=True, name="final"):
    relative_path=f"projects/{project_id}/episodes/{episode_id}/renders/{name}.mp4"
    output=Path(client.app.state.settings.data_root)/relative_path
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(b"render")
    with client.app.state.session_factory() as session:
        input_snapshot_hash=RenderingService(
            session,
            client.app.state.settings.data_root,
            client.app.state.settings.data_root,
        ).input_snapshot_hash(episode_id)
        job=models.Job(operation="render_episode",target_type="episode",target_id=episode_id,status="succeeded",progress=100,request_payload={},result_metadata={"episode_id":episode_id,"output_path":relative_path,"input_snapshot_hash":input_snapshot_hash})
        session.add(job);session.flush()
        session.add(models.RenderReviewRecord(episode_id=episode_id,job_id=job.id,render_path=str(output),ffprobe_json={},black_frame_positions=[] if overall_pass else [1.0],silence_ranges=[],subtitle_present=True,overall_pass=overall_pass,findings=[] if overall_pass else [{"code":"black_frames","severity":"critical"}]))
        session.commit()
    return relative_path


def test_publish_gate_ignores_retired_review_threads_and_is_idempotent(client):
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
    render_path=_register_render(client,_project["id"],episode["id"])
    candidate=client.post(
        f"/api/episodes/{episode['id']}/release-candidates",
        json={"version":"V1","render_path":render_path,"qc_snapshot":{"black_frames":0}},
    )
    assert candidate.status_code==201
    candidate=candidate.json()

    gate=client.get(f"/api/release-candidates/{candidate['id']}/gate").json()
    assert gate["ready"] is True
    assert gate["open_critical_threads"]==[]

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
    project,episode,_shot_id=_ready_episode(client)
    for version in ("V2","V1"):
        render_path=_register_render(client,project["id"],episode["id"],name=version)
        response=client.post(
            f"/api/episodes/{episode['id']}/release-candidates",
            json={"version":version,"render_path":render_path,"qc_snapshot":{}},
        )
        assert response.status_code==201

    response=client.get(f"/api/episodes/{episode['id']}/release-candidates")

    assert response.status_code==200
    assert [item["version"] for item in response.json()]==["V1","V2"]


def test_release_candidate_list_rejects_unknown_episode(client):
    response=client.get("/api/episodes/missing/release-candidates")

    assert response.status_code==404
    assert response.json()["detail"]=="Episode not found"


def test_release_candidate_rejects_a_path_without_successful_render_provenance(client):
    project,episode,_shot_id=_ready_episode(client)
    relative_path=f"projects/{project['id']}/episodes/{episode['id']}/renders/unproven.mp4"
    output=Path(client.app.state.settings.data_root)/relative_path
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(b"not produced by a render job")

    response=client.post(f"/api/episodes/{episode['id']}/release-candidates",json={"version":"V1","render_path":relative_path,"qc_snapshot":{}})

    assert response.status_code==422
    assert response.json()["detail"]=="Render path must come from a successful episode render"


def test_release_gate_uses_server_qc_and_blocks_failed_render_review(client):
    project,episode,_shot_id=_ready_episode(client)
    render_path=_register_render(client,project["id"],episode["id"],overall_pass=False)

    response=client.post(f"/api/episodes/{episode['id']}/release-candidates",json={"version":"V1","render_path":render_path,"qc_snapshot":{"overall_pass":True}})

    assert response.status_code==201
    candidate=response.json()
    assert candidate["qc_snapshot"]["overall_pass"] is False
    assert client.get(f"/api/release-candidates/{candidate['id']}/gate").json()["ready"] is False
    assert client.post(f"/api/release-candidates/{candidate['id']}/approve").status_code==409


def test_release_gate_requires_active_videos_for_every_shot(client):
    project,episode,_shot_id=_ready_episode(client,video_ready=False)
    render_path=_register_render(client,project["id"],episode["id"])
    candidate=client.post(f"/api/episodes/{episode['id']}/release-candidates",json={"version":"V1","render_path":render_path,"qc_snapshot":{}}).json()

    gate=client.get(f"/api/release-candidates/{candidate['id']}/gate").json()

    assert gate["ready"] is False
    assert gate["production_ready"] is False
    assert gate["production_blockers"]["missing_videos"]


def test_release_gate_rejects_candidate_after_render_inputs_change(client):
    project,episode,shot_id=_ready_episode(client)
    data_root=client.app.state.settings.data_root
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        panel=session.get(models.Asset,shot.active_panel_asset_id)
        video=session.get(models.Asset,shot.active_video_asset_id)
        (data_root/panel.local_path).write_bytes(b"panel")
        (data_root/video.local_path).write_bytes(b"\x00\x00\x00\x18ftypmp42video")
        video.parent_asset_id=panel.id
        video.duration_seconds=8
        session.commit()
    handlers=EpisodeAIStageHandlers(
        client.app.state.session_factory,
        data_root,
        client.app.state.model_runtime,
    )
    original_hash=handlers._render_input_snapshot_hash(episode["id"])
    render_path=_register_render(client,project["id"],episode["id"])
    with client.app.state.session_factory() as session:
        job=session.query(models.Job).filter(
            models.Job.operation=="render_episode",
            models.Job.target_id==episode["id"],
        ).order_by(models.Job.created_at.desc()).first()
        job.result_metadata={**job.result_metadata,"input_snapshot_hash":original_hash}
        session.commit()
    candidate=client.post(
        f"/api/episodes/{episode['id']}/release-candidates",
        json={"version":"V1","render_path":render_path,"qc_snapshot":{}},
    ).json()
    with client.app.state.session_factory() as session:
        stored_candidate=session.get(models.ReleaseCandidate,candidate["id"])
        stored_job=session.get(models.Job,stored_candidate.qc_snapshot["job_id"])
        current_hash=RenderingService(session,data_root,data_root).input_snapshot_hash(
            episode["id"]
        )
        assert stored_job.result_metadata["input_snapshot_hash"]==current_hash
        assert stored_candidate.qc_snapshot["overall_pass"] is True
    initial_gate=client.get(f"/api/release-candidates/{candidate['id']}/gate").json()
    assert initial_gate["ready"] is True, initial_gate
    assert client.post(f"/api/release-candidates/{candidate['id']}/approve").status_code==200

    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        replacement=AssetStore(session,data_root).register_video(
            project_id=project["id"],
            shot_id=shot.id,
            source_panel_id=shot.active_panel_asset_id,
            content=b"\x00\x00\x00\x18ftypmp42replacement",
            provider="test",
            model="video-test",
            request_metadata={"prompt":"new motion"},
            duration_seconds=8,
            activate=True,
        )

    gate=client.get(f"/api/release-candidates/{candidate['id']}/gate").json()

    assert gate["production_ready"] is True
    assert gate["ready"] is False
    publish=client.post(
        f"/api/release-candidates/{candidate['id']}/publish",
        json={"platform":"internal_master","idempotency_key":"stale-render"},
    )
    assert publish.status_code==409
    assert publish.json()["detail"]=="Release candidate is blocked"
    with client.app.state.session_factory() as session:
        assert session.get(models.Shot,shot_id).active_video_asset_id==replacement.id
