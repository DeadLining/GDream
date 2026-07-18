import asyncio
from io import BytesIO

from PIL import Image
from sqlalchemy import select
from comic_studio import models
from comic_studio.model_runtime.contracts import Capability
from comic_studio.providers.gpt_image import ImageResult
from comic_studio.services.shot_inputs import ShotInputCompiler
from comic_studio.services.visual_review import VisualReviewService


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
            project_id=project["id"], kind=f"panel:{shot.id}", local_path="source.png",
            media_type="image/png", provider="test", model="test",
            request_metadata={}, checksum="source", review_status="draft",
        )
        candidate = models.Asset(
            project_id=project["id"], kind=f"panel:{shot.id}", local_path="candidate.png",
            media_type="image/png", provider="test", model="test",
            request_metadata={}, parent_asset_id=source.id, checksum="candidate",
            review_status="draft",
        )
        session.add_all([source,candidate]);session.flush()
        compiled=ShotInputCompiler(session).compile(
            shot.id,usage_kinds={"panel","reference"}
        )
        provenance={
            "input_snapshot":compiled.snapshot,
            "input_snapshot_hash":compiled.snapshot_hash,
        }
        source.request_metadata=provenance
        candidate.request_metadata=provenance
        session.commit()
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
    accepted_shot=client.get(f"/api/episodes/{loaded['episode_id']}").json()["scenes"][0]["shots"][0]
    assert accepted_shot["active_panel_asset_id"]==candidate_id
    assert accepted_shot["review_status"]=="approved"
    production_shot=client.get(f"/api/episodes/{loaded['episode_id']}/production-graph").json()["shots"][0]
    assert production_shot["active_panel_asset_id"]==candidate_id
    assert production_shot["review_status"]=="approved"


def test_visual_review_generation_uses_thread_feedback_and_registers_candidate(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    source_path=client.app.state.settings.data_root/"source.png"
    source_path.parent.mkdir(parents=True,exist_ok=True)
    source_image=Image.new("RGB",(320,240),"white")
    source_buffer=BytesIO()
    source_image.save(source_buffer,format="PNG")
    source_content=source_buffer.getvalue()
    source_path.write_bytes(source_content)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        shot.previous_shot_tail_asset_id=source_id
        session.commit()
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"表情调整","modification_scope":"episode"},
    ).json()
    client.post(
        f"/api/visual-review-threads/{thread['id']}/annotations",
        json={"kind":"circle","geometry":{"cx":0.42,"cy":0.31,"rx":0.12,"ry":0.08},"color":"#B9473E","label":"眉眼区域"},
    )
    client.post(
        f"/api/visual-review-threads/{thread['id']}/messages",
        json={"author_kind":"user","content":"降低惊恐感，但不要改变脸型。"},
    )

    class Provider:
        model="review-image"
        prompt=""
        references=[]

        async def edit(self,prompt,references,size="1024x1536",quality="auto"):
            self.prompt=prompt
            self.references=references
            return ImageResult(b"candidate-image",media_type="image/png")

        async def generate(self,*_args,**_kwargs):
            raise AssertionError("review generation must use the source asset")

    provider=Provider()
    with client.app.state.session_factory() as session:
        candidate=asyncio.run(
            VisualReviewService(session).generate_candidate(
                thread["id"],client.app.state.settings.data_root,provider
            )
        )
        assert candidate is not None
        candidate_id=candidate.id
        asset_id=candidate.asset_id

    assert "降低惊恐感，但不要改变脸型" in provider.prompt
    assert "眉眼区域" in provider.prompt
    assert '\"cx\": 0.42' in provider.prompt
    assert "episode" in provider.prompt
    assert len(provider.references)==1
    annotated_content,annotated_media_type,max_dimension=provider.references[0]
    assert annotated_media_type=="image/png"
    assert max_dimension==1024
    assert annotated_content!=source_content
    with Image.open(BytesIO(annotated_content)) as annotated:
        annotated.load()
        assert annotated.size==(320,240)
        assert any(red>180 and green<120 and blue<120 for red,green,blue in annotated.convert("RGB").getdata())
    with client.app.state.session_factory() as session:
        candidate=session.get(models.VisualReviewCandidate,candidate_id)
        asset=session.get(models.Asset,asset_id)
        assert candidate.thread_id==thread["id"]
        assert asset.kind==f"panel:{shot_id}"
        assert asset.request_metadata["visual_review"]["source_asset_id"]==source_id
        assert asset.request_metadata["visual_review"]["modification_scope"]=="episode"
        assert asset.request_metadata["visual_review"]["annotated_reference"] is True


def test_visual_review_generate_endpoint_creates_thread_scoped_image_job(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"定向修改","modification_scope":"shot"},
    ).json()

    class Job:
        id="job-review"
        status="queued"

    class Runtime:
        created=None

        def create_media_job(self,capability,target_type,target_id,payload):
            self.created=(capability,target_type,target_id,payload)
            return Job()

        async def run_media_job(self,_job_id):
            return None

    runtime=Runtime()
    client.app.state.model_runtime=runtime

    response=client.post(f"/api/visual-review-threads/{thread['id']}/generate")

    assert response.status_code==202
    assert response.json()=={"job_id":"job-review","capability":"image","status":"queued"}
    assert runtime.created==(Capability.IMAGE,"visual_review",thread["id"],{"activate":False})


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


def test_visual_review_rejects_candidate_generated_for_another_shot(client):
    _project,shot_id,source_id,_candidate_id=_graph(client)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        other_shot=models.Shot(
            scene_id=shot.scene_id,position=2,shot_type="wide",duration_seconds=4,
            composition="另一个镜头",camera_motion="static",character_state={},
            image_prompt="other",negative_prompt="",
        )
        session.add(other_shot);session.flush()
        other_asset=models.Asset(
            project_id=shot.scene.episode.project_id,kind=f"panel:{other_shot.id}",
            local_path="other-shot.png",media_type="image/png",provider="test",
            model="test",request_metadata={},checksum="other-shot",review_status="draft",
        )
        session.add(other_asset);session.commit();other_asset_id=other_asset.id
    wrong_source=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":other_asset_id,"title":"错误镜头来源","modification_scope":"shot"},
    )
    assert wrong_source.status_code==422
    assert wrong_source.json()["detail"]=="Source asset must be a panel for the review shot"
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"错误镜头候选","modification_scope":"shot"},
    ).json()

    response=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":other_asset_id,"generation_metadata":{}},
    )

    assert response.status_code==422
    assert response.json()["detail"]=="Candidate asset must be a panel for the review shot"


def test_visual_review_cannot_accept_candidate_after_director_input_changes(client):
    _project,shot_id,source_id,candidate_id=_graph(client)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        stage=models.DirectorStage(scene_id=shot.scene_id,environment={})
        session.add(stage);session.flush()
        camera=models.ShotCamera(
            stage_id=stage.id,
            shot_id=shot.id,
            position=[0,1.6,5],
            target=[0,1.2,0],
        )
        session.add(camera);session.flush()
        compiled=ShotInputCompiler(session).compile(
            shot.id,usage_kinds={"panel","reference"}
        )
        candidate_asset=session.get(models.Asset,candidate_id)
        candidate_asset.request_metadata={
            "input_snapshot":compiled.snapshot,
            "input_snapshot_hash":compiled.snapshot_hash,
        }
        session.commit()

    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"导演调整前候选","modification_scope":"shot"},
    ).json()
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{}},
    ).json()

    with client.app.state.session_factory() as session:
        camera=session.scalar(
            select(models.ShotCamera).where(models.ShotCamera.shot_id==shot_id)
        )
        camera.position=[2,1.6,4]
        camera.version+=1
        session.commit()

    accepted=client.post(f"/api/visual-review-candidates/{candidate['id']}/accept")

    assert accepted.status_code==409
    assert accepted.json()["detail"]=="Candidate panel is stale"
    with client.app.state.session_factory() as session:
        stored_candidate=session.get(models.VisualReviewCandidate,candidate['id'])
        shot=session.get(models.Shot,shot_id)
        assert stored_candidate.status=="ready"
        assert shot.active_panel_asset_id is None
        assert shot.review_status=="draft"


def test_episode_scope_acceptance_creates_episode_variant_and_records_impact(client):
    project,shot_id,source_id,candidate_id=_graph(client)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        character=models.Character(
            project_id=project["id"],name="林夏",role="主角",appearance_bible="短发",
            personality="冷静",continuity_rules="保持脸型",negative_constraints="",
            voice_speaker="v1",
        )
        session.add(character);session.flush()
        shot.character_state={character.id:{}}
        other_shot=models.Shot(
            scene_id=shot.scene_id,position=2,shot_type="medium",duration_seconds=4,
            composition="林夏继续调查",camera_motion="static",
            character_state={character.id:{}},image_prompt="investigate",negative_prompt="",
        )
        session.add(other_shot);session.commit();other_shot_id=other_shot.id
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"降低惊恐感","modification_scope":"episode"},
    ).json()
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{}},
    ).json()

    accepted=client.post(f"/api/visual-review-candidates/{candidate['id']}/accept")

    assert accepted.status_code==200
    metadata=accepted.json()["generation_metadata"]["acceptance"]
    assert metadata["scope"]=="episode"
    assert set(metadata["affected_shot_ids"])=={shot_id,other_shot_id}
    assert len(metadata["variant_ids"])==1
    with client.app.state.session_factory() as session:
        from comic_studio.services.shot_inputs import ShotInputCompiler

        variant=session.get(models.AssetVariant,metadata["variant_ids"][0])
        assert variant.kind=="episode"
        assert variant.episode_id==thread["episode_id"]
        assert {usage.shot_id for usage in variant.usages}=={shot_id,other_shot_id}
        assert {usage.usage_kind for usage in variant.usages}=={"reference"}
        assert {usage.asset_id for usage in variant.usages}=={None}
        compiled=ShotInputCompiler(session).compile(
            other_shot_id,usage_kinds={"panel","reference"}
        )
        assert candidate_id not in compiled.reference_asset_ids
        assert compiled.snapshot["asset_bindings"][0]["variant_id"]==variant.id
        assert "降低惊恐感" in compiled.snapshot["asset_bindings"][0][
            "resolved_overrides"
        ]["visual_review_instruction"]


def test_episode_scope_acceptance_targets_one_character_in_multi_character_shot(client):
    project,shot_id,source_id,candidate_id=_graph(client)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        target=models.Character(
            project_id=project["id"],name="林夏",role="主角",appearance_bible="短发",
            personality="冷静",continuity_rules="保持脸型",negative_constraints="",
            voice_speaker="v1",
        )
        other=models.Character(
            project_id=project["id"],name="顾川",role="搭档",appearance_bible="卷发",
            personality="谨慎",continuity_rules="保持发型",negative_constraints="",
            voice_speaker="v2",
        )
        session.add_all([target,other]);session.flush()
        shot.character_state={target.id:{},other.id:{}}
        session.commit();target_id=target.id;other_id=other.id
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"林夏降低惊恐感","modification_scope":"episode"},
    ).json()
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{}},
    ).json()

    missing_target=client.post(f"/api/visual-review-candidates/{candidate['id']}/accept")

    assert missing_target.status_code==409
    assert missing_target.json()["detail"]=="Target character is required for multi-character review scope"

    accepted=client.post(
        f"/api/visual-review-candidates/{candidate['id']}/accept",
        json={"target_character_id":target_id},
    )

    assert accepted.status_code==200
    metadata=accepted.json()["generation_metadata"]["acceptance"]
    assert len(metadata["variant_ids"])==1
    with client.app.state.session_factory() as session:
        variant=session.get(models.AssetVariant,metadata["variant_ids"][0])
        assert variant.character_id==target_id
        assert session.scalar(
            select(models.AssetVariant).where(models.AssetVariant.character_id==other_id)
        ) is None


def test_master_scope_acceptance_creates_new_master_version_and_impact(client):
    project,shot_id,source_id,candidate_id=_graph(client)
    with client.app.state.session_factory() as session:
        shot=session.get(models.Shot,shot_id)
        character=models.Character(
            project_id=project["id"],name="林夏",role="主角",appearance_bible="短发",
            personality="冷静",continuity_rules="保持脸型",negative_constraints="",
            voice_speaker="v1",
        )
        session.add(character);session.flush()
        shot.character_state={character.id:{}}
        existing=models.AssetVariant(
            character_id=character.id,kind="master",label="林夏主设定 V1",
            inherited_fields=[],overrides={},version=1,review_status="approved",
        )
        session.add(existing);session.commit()
    thread=client.post(
        f"/api/shots/{shot_id}/visual-review-threads",
        json={"source_asset_id":source_id,"title":"更新主设定表情","modification_scope":"master"},
    ).json()
    candidate=client.post(
        f"/api/visual-review-threads/{thread['id']}/candidates",
        json={"asset_id":candidate_id,"generation_metadata":{}},
    ).json()

    accepted=client.post(f"/api/visual-review-candidates/{candidate['id']}/accept")

    assert accepted.status_code==200
    metadata=accepted.json()["generation_metadata"]["acceptance"]
    assert metadata["scope"]=="master"
    assert metadata["affected_episode_ids"]==[thread["episode_id"]]
    with client.app.state.session_factory() as session:
        revision=session.get(models.AssetVariant,metadata["variant_ids"][0])
        assert revision.kind=="master"
        assert revision.version==2
        assert revision.id!=existing.id
        assert revision.parent_variant_id==existing.id
        assert "更新主设定表情" in revision.overrides["visual_review_instruction"]


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
