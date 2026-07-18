from comic_studio import models
from comic_studio.director import DirectorObjectCreate, ShotCameraPatch
from comic_studio.services.director_blocking import character_blocking_transform
from comic_studio.services.director_stages import DirectorStageService


def _scene(session, shot_count: int = 3):
    project = models.Project(
        title="镜头站位",
        logline="保持人物空间连续性",
        story_bible="人物位置跨镜头延续",
        visual_style="漫画",
    )
    episode = models.Episode(
        project=project,
        title="第一集",
        premise="两人对话",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="客厅",
        summary="人物在客厅交谈",
        estimated_duration_seconds=12,
    )
    scene.shots.extend(
        models.Shot(
            position=index,
            shot_type="medium",
            duration_seconds=4,
            composition=f"镜头 {index}",
        )
        for index in range(1, shot_count + 1)
    )
    session.add(project)
    session.commit()
    return scene


def test_character_blocking_templates_are_stable_and_stagger_depth():
    assert character_blocking_transform(0, 1)["position"] == [0.0, 0.0, 0.0]
    assert [
        character_blocking_transform(index, 2)["position"]
        for index in range(2)
    ] == [[-0.8, 0.0, 0.0], [0.8, 0.0, 0.0]]
    assert [
        character_blocking_transform(index, 3)["position"]
        for index in range(3)
    ] == [
        [-1.0, 0.0, 0.0],
        [0.0, 0.0, -0.6],
        [1.0, 0.0, 0.0],
    ]
    assert character_blocking_transform(0, 3)["rotation"] == [0.0, 0.0, 0.0]
    assert character_blocking_transform(0, 3)["scale"] == [1.0, 1.0, 1.0]


def test_inherit_blocking_copies_previous_effective_positions_as_snapshot(db_session):
    scene = _scene(db_session)
    service = DirectorStageService(db_session)
    stage = service.get_or_create_stage(scene.id)
    character = service.create_object(
        stage.id,
        stage.version,
        DirectorObjectCreate(
            kind="character",
            source_type="placeholder",
            label="张三",
        ),
    )
    stage = service.get_stage(stage.id)
    first, second, _third = stage.shot_cameras
    first = service.update_camera(
        stage.id,
        first.shot_id,
        first.version,
        ShotCameraPatch(
            object_overrides={
                character.id: {
                    "transform": {
                        "position": [2, 0, -1],
                        "rotation": [0, 0.5, 0],
                        "scale": [1, 1, 1],
                    },
                    "visible": True,
                }
            }
        ),
    )

    inherited = service.inherit_blocking(
        stage.id, second.shot_id, second.version
    )

    assert inherited.initialized_from_shot_id == first.shot_id
    assert inherited.object_overrides[character.id]["transform"]["position"] == [
        2.0,
        0.0,
        -1.0,
    ]
    assert inherited.object_overrides[character.id]["transform"]["rotation"] == [
        0.0,
        0.5,
        0.0,
    ]

    service.update_camera(
        stage.id,
        first.shot_id,
        first.version,
        ShotCameraPatch(
            object_overrides={
                character.id: {
                    "transform": {
                        "position": [4, 0, 0],
                        "rotation": [0, 0, 0],
                        "scale": [1, 1, 1],
                    }
                }
            }
        ),
    )
    unchanged = service.get_stage(stage.id).shot_cameras[1]
    assert unchanged.object_overrides[character.id]["transform"]["position"] == [
        2.0,
        0.0,
        -1.0,
    ]


def test_inherit_blocking_rejects_first_shot(db_session):
    scene = _scene(db_session, shot_count=2)
    service = DirectorStageService(db_session)
    stage = service.get_or_create_stage(scene.id)
    first = stage.shot_cameras[0]

    try:
        service.inherit_blocking(stage.id, first.shot_id, first.version)
    except ValueError as exc:
        assert str(exc) == "previous_shot_missing"
    else:
        raise AssertionError("first shot must not inherit blocking")


def test_asset_sync_initializes_later_shots_from_previous_snapshot(db_session):
    scene = _scene(db_session)
    service = DirectorStageService(db_session)
    stage = service.get_or_create_stage(scene.id)
    character = service.create_object(
        stage.id,
        stage.version,
        DirectorObjectCreate(
            kind="character",
            source_type="placeholder",
            label="张三",
        ),
    )
    stage = service.get_stage(stage.id)

    synced = service.sync_assets(stage.id, stage.version, [])

    first, second, third = synced.shot_cameras
    assert first.initialized_from_shot_id is None
    assert second.initialized_from_shot_id == first.shot_id
    assert third.initialized_from_shot_id == second.shot_id
    assert second.object_overrides[character.id]["transform"]["position"] == [
        0.0,
        0.0,
        0.0,
    ]
    assert third.object_overrides[character.id]["transform"]["position"] == [
        0.0,
        0.0,
        0.0,
    ]


def test_unchanged_asset_sync_repairs_missing_camera_inheritance(db_session):
    scene = _scene(db_session)
    service = DirectorStageService(db_session)
    stage = service.get_or_create_stage(scene.id)
    character = service.create_object(
        stage.id,
        stage.version,
        DirectorObjectCreate(
            kind="character",
            source_type="placeholder",
            label="张三",
        ),
    )
    synced = service.sync_assets(stage.id, service.get_stage(stage.id).version, [])
    second = synced.shot_cameras[1]
    second.initialized_from_shot_id = None
    second.object_overrides = {}
    db_session.commit()

    repaired = service.sync_assets(synced.id, synced.version, [])

    repaired_second = repaired.shot_cameras[1]
    assert repaired_second.initialized_from_shot_id == repaired.shot_cameras[0].shot_id
    assert repaired_second.object_overrides[character.id]["transform"]["position"] == [
        0.0,
        0.0,
        0.0,
    ]
