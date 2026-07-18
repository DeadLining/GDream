from datetime import timedelta

from comic_studio import models


def _project_with_episode(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "待删除作品",
            "logline": "验证完整删除",
            "story_bible": "个人作品数据",
            "visual_style": "comic",
            "aspect_ratio": "9:16",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={
            "title": "第一集",
            "premise": "删除测试",
            "target_duration_seconds": 60,
        },
    ).json()
    return project, episode


def test_project_deletion_removes_database_graph_and_project_directory(client):
    project, episode = _project_with_episode(client)
    data_root = client.app.state.settings.data_root
    project_root = data_root / "projects" / project["id"]
    asset_relative = f"projects/{project['id']}/library-assets/reference.png"
    delivery_relative = (
        f"projects/{project['id']}/episodes/{episode['id']}/delivery/package.zip"
    )

    with client.app.state.session_factory() as session:
        asset = models.Asset(
            project_id=project["id"],
            kind="library-asset-media",
            local_path=asset_relative,
            media_type="image/png",
            provider="test",
            model="test",
            request_metadata={},
            checksum="asset",
            review_status="approved",
        )
        candidate = models.ReleaseCandidate(
            episode_id=episode["id"],
            version="V1",
            render_path=(
                f"projects/{project['id']}/episodes/{episode['id']}/renders/final.mp4"
            ),
            qc_snapshot={"overall_pass": True},
            status="published",
        )
        session.add_all([asset, candidate])
        session.flush()
        package = models.DeliveryPackage(
            project_id=project["id"],
            episode_id=episode["id"],
            release_candidate_id=candidate.id,
            preset_name="个人交付包",
            outputs=[],
            checks={"archive_created": True},
            status="completed",
            artifact_path=delivery_relative,
        )
        task = models.ProductionTask(
            project_id=project["id"],
            title="项目任务",
            description="",
            priority="medium",
            status="todo",
            checklist=[],
        )
        trash = models.TrashItem(
            project_id=project["id"],
            resource_type="asset_variant",
            resource_id="deleted-resource",
            name="已删除资产",
            original_location=["已删除资产"],
            lineage=["已删除资产"],
            deleted_by="本人",
            expires_at=models.utc_now() + timedelta(days=30),
        )
        workflow = models.ProductionWorkflowBinding(
            project_id=project["id"],
            capability="image",
            name="default",
            workflow_id="workflow-1",
            workflow_version=1,
            input_mapping_version=1,
            enabled=True,
        )
        job = models.Job(
            operation="project_export",
            target_type="project",
            target_id=project["id"],
        )
        invocation = models.ModelInvocation(
            capability="image",
            provider="test",
            model="test",
            target_type="project",
            target_id=project["id"],
            job_id=job.id,
            status="succeeded",
        )
        session.add_all([package, task, trash, workflow, job, invocation])
        session.commit()
        ids = {
            "asset": asset.id,
            "package": package.id,
            "task": task.id,
            "trash": trash.id,
            "workflow": workflow.id,
            "job": job.id,
            "invocation": invocation.id,
        }

    asset_path = data_root / asset_relative
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    asset_path.write_bytes(b"asset")
    delivery_path = data_root / delivery_relative
    delivery_path.parent.mkdir(parents=True, exist_ok=True)
    delivery_path.write_bytes(b"delivery")

    preview = client.get(f"/api/projects/{project['id']}/deletion-preview")

    assert preview.status_code == 200
    assert preview.json() == {
        "project_id": project["id"],
        "title": "待删除作品",
        "deleted": {"episodes": 1, "characters": 0, "assets": 1},
    }

    response = client.delete(f"/api/projects/{project['id']}")

    assert response.status_code == 200
    assert response.json() == {
        **preview.json(),
        "deleted_project_id": project["id"],
        "cleanup_warnings": [],
    }
    assert not project_root.exists()
    with client.app.state.session_factory() as session:
        assert session.get(models.Project, project["id"]) is None
        assert session.get(models.Episode, episode["id"]) is None
        assert session.get(models.Asset, ids["asset"]) is None
        assert session.get(models.DeliveryPackage, ids["package"]) is None
        assert session.get(models.ProductionTask, ids["task"]) is None
        assert session.get(models.TrashItem, ids["trash"]) is None
        assert session.get(models.ProductionWorkflowBinding, ids["workflow"]) is None
        assert session.get(models.Job, ids["job"]) is None
        assert session.get(models.ModelInvocation, ids["invocation"]) is None


def test_project_deletion_routes_return_404_for_unknown_project(client):
    assert client.get("/api/projects/missing/deletion-preview").status_code == 404
    assert client.delete("/api/projects/missing").status_code == 404
