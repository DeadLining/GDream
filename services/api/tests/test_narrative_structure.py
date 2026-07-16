def _project(client, title: str):
    response = client.post(
        "/api/projects",
        json={
            "title": title,
            "logline": "跨集故事",
            "story_bible": "角色与伏笔需要稳定追踪。",
            "visual_style": "clean comic",
            "aspect_ratio": "9:16",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_volumes_keep_stable_episode_order(client):
    project = _project(client, "裂缝纪事")
    volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "海底异变", "summary": "异常首次出现", "position": 1},
    )
    assert volume.status_code == 201
    volume = volume.json()

    second = client.post(
        f"/api/volumes/{volume['id']}/episodes",
        json={
            "title": "裂缝扩大",
            "premise": "冲突升级",
            "target_duration_seconds": 60,
            "position": 2,
        },
    )
    first = client.post(
        f"/api/volumes/{volume['id']}/episodes",
        json={
            "title": "海螺异动",
            "premise": "伏笔出现",
            "target_duration_seconds": 60,
            "position": 1,
        },
    )
    assert second.status_code == 201
    assert first.status_code == 201

    response = client.get(f"/api/projects/{project['id']}/volumes")

    assert response.status_code == 200
    payload = response.json()
    assert [episode["title"] for episode in payload[0]["episodes"]] == [
        "海螺异动",
        "裂缝扩大",
    ]
    assert [episode["position"] for episode in payload[0]["episodes"]] == [1, 2]


def test_volume_rejects_duplicate_position(client):
    project = _project(client, "稳定排序")
    body = {"title": "第一卷", "summary": "", "position": 1}
    assert client.post(f"/api/projects/{project['id']}/volumes", json=body).status_code == 201

    response = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "重复卷", "summary": "", "position": 1},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Volume position already exists"


def test_episode_can_move_between_volumes_and_back_to_unassigned(client):
    project = _project(client, "跨卷调度")
    first_volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "第一卷", "summary": "", "position": 1},
    ).json()
    second_volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "第二卷", "summary": "", "position": 2},
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "游离剧集", "premise": "等待归卷", "target_duration_seconds": 60},
    ).json()

    assigned = client.put(
        f"/api/episodes/{episode['id']}/volume",
        json={"volume_id": first_volume["id"]},
    )
    moved = client.put(
        f"/api/episodes/{episode['id']}/volume",
        json={"volume_id": second_volume["id"]},
    )
    unassigned = client.put(
        f"/api/episodes/{episode['id']}/volume",
        json={"volume_id": None},
    )

    assert assigned.status_code == 200
    assert assigned.json()["volume_id"] == first_volume["id"]
    assert assigned.json()["position"] == 1
    assert moved.status_code == 200
    assert moved.json()["volume_id"] == second_volume["id"]
    assert moved.json()["position"] == 1
    assert unassigned.status_code == 200
    assert unassigned.json()["volume_id"] is None
    assert unassigned.json()["position"] == 1
    volumes = client.get(f"/api/projects/{project['id']}/volumes").json()
    assert [volume["episodes"] for volume in volumes] == [[], []]


def test_episode_move_rejects_volume_from_another_project(client):
    owner = _project(client, "剧集所属作品")
    other = _project(client, "其他作品")
    episode = client.post(
        f"/api/projects/{owner['id']}/episodes",
        json={"title": "本作品剧集", "premise": "不能越界", "target_duration_seconds": 60},
    ).json()
    foreign_volume = client.post(
        f"/api/projects/{other['id']}/volumes",
        json={"title": "外部卷", "summary": "", "position": 1},
    ).json()

    response = client.put(
        f"/api/episodes/{episode['id']}/volume",
        json={"volume_id": foreign_volume["id"]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Volume must belong to the episode project"


def test_deleting_volume_returns_episodes_to_unassigned_in_stable_order(client):
    project = _project(client, "删除篇章")
    existing = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "原未归卷", "premise": "保留首位", "target_duration_seconds": 60},
    ).json()
    volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "待删除卷", "summary": "", "position": 1},
    ).json()
    for position, title in ((1, "卷内第一集"), (2, "卷内第二集")):
        response = client.post(
            f"/api/volumes/{volume['id']}/episodes",
            json={
                "title": title,
                "premise": "删除后回归",
                "target_duration_seconds": 60,
                "position": position,
            },
        )
        assert response.status_code == 201

    deleted = client.delete(f"/api/volumes/{volume['id']}")

    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project['id']}/volumes").json() == []
    loaded = client.get(f"/api/projects/{project['id']}").json()
    assert [(item["title"], item["position"]) for item in loaded["episodes"]] == [
        (existing["title"], 1),
        ("卷内第一集", 2),
        ("卷内第二集", 3),
    ]


def test_storyline_tracks_events_across_episodes(client):
    project = _project(client, "跨集伏笔")
    episode_ids = []
    for title in ("第一集", "第三集"):
        response = client.post(
            f"/api/projects/{project['id']}/episodes",
            json={"title": title, "premise": "事件", "target_duration_seconds": 60},
        )
        assert response.status_code == 201
        episode_ids.append(response.json()["id"])

    storyline = client.post(
        f"/api/projects/{project['id']}/storylines",
        json={
            "title": "时间裂缝",
            "kind": "foreshadowing",
            "color": "#B9473E",
            "description": "跨集追踪裂缝来源",
        },
    )
    assert storyline.status_code == 201
    storyline = storyline.json()

    setup = client.post(
        f"/api/storylines/{storyline['id']}/events",
        json={
            "episode_id": episode_ids[0],
            "position": 1,
            "stage": "setup",
            "title": "金属海螺异动",
            "description": "首次出现异常",
        },
    )
    assert setup.status_code == 201
    setup = setup.json()
    payoff = client.post(
        f"/api/storylines/{storyline['id']}/events",
        json={
            "episode_id": episode_ids[1],
            "position": 2,
            "stage": "development",
            "title": "首次稳定裂缝",
            "description": "伏笔升级",
            "setup_event_id": setup["id"],
        },
    )
    assert payoff.status_code == 201

    response = client.get(f"/api/projects/{project['id']}/storylines")

    assert response.status_code == 200
    events = response.json()[0]["events"]
    assert [event["episode_id"] for event in events] == episode_ids
    assert events[1]["setup_event_id"] == setup["id"]


def test_storyline_rejects_cross_project_episode(client):
    owner = _project(client, "故事线所属作品")
    other = _project(client, "其他作品")
    episode = client.post(
        f"/api/projects/{other['id']}/episodes",
        json={"title": "外部集", "premise": "不应关联", "target_duration_seconds": 60},
    ).json()
    storyline = client.post(
        f"/api/projects/{owner['id']}/storylines",
        json={
            "title": "角色成长",
            "kind": "character_arc",
            "color": "#285F69",
            "description": "仅属于当前作品",
        },
    ).json()

    response = client.post(
        f"/api/storylines/{storyline['id']}/events",
        json={
            "episode_id": episode["id"],
            "position": 1,
            "stage": "setup",
            "title": "错误关联",
            "description": "跨作品",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Episode must belong to the storyline project"


def test_volume_and_storyline_can_be_updated(client):
    project = _project(client, "可编辑叙事")
    first = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "旧卷名", "summary": "旧简介", "position": 1},
    ).json()
    client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"title": "第二卷", "summary": "", "position": 2},
    )
    updated = client.patch(
        f"/api/volumes/{first['id']}",
        json={"title": "裂缝初现", "summary": "新简介"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "裂缝初现"
    assert updated.json()["summary"] == "新简介"
    conflict = client.patch(f"/api/volumes/{first['id']}", json={"position": 2})
    assert conflict.status_code == 409

    storyline = client.post(
        f"/api/projects/{project['id']}/storylines",
        json={"title": "旧故事线", "kind": "mystery", "color": "#285F69", "description": ""},
    ).json()
    changed = client.patch(
        f"/api/storylines/{storyline['id']}",
        json={"title": "林默成长", "kind": "character_arc", "color": "#B9473E"},
    )
    assert changed.status_code == 200
    assert changed.json()["title"] == "林默成长"
    assert changed.json()["kind"] == "character_arc"


def test_storyline_event_can_be_updated_and_deleted(client):
    project = _project(client, "事件维护")
    episodes = [
        client.post(
            f"/api/projects/{project['id']}/episodes",
            json={"title": title, "premise": "事件", "target_duration_seconds": 60},
        ).json()
        for title in ("第一集", "第二集")
    ]
    storyline = client.post(
        f"/api/projects/{project['id']}/storylines",
        json={"title": "冲突", "kind": "conflict", "color": "#B9473E", "description": ""},
    ).json()
    event = client.post(
        f"/api/storylines/{storyline['id']}/events",
        json={"episode_id": episodes[0]["id"], "position": 1, "stage": "setup", "title": "误会", "description": ""},
    ).json()

    updated = client.patch(
        f"/api/storyline-events/{event['id']}",
        json={"episode_id": episodes[1]["id"], "stage": "escalation", "title": "冲突升级"},
    )
    assert updated.status_code == 200
    assert updated.json()["episode_id"] == episodes[1]["id"]
    assert updated.json()["stage"] == "escalation"
    assert updated.json()["title"] == "冲突升级"

    deleted = client.delete(f"/api/storyline-events/{event['id']}")
    assert deleted.status_code == 204
    loaded = client.get(f"/api/projects/{project['id']}/storylines").json()
    assert loaded[0]["events"] == []


def test_storyline_can_be_deleted_with_its_events(client):
    project = _project(client, "删除故事线")
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "事件", "target_duration_seconds": 60},
    ).json()
    storyline = client.post(
        f"/api/projects/{project['id']}/storylines",
        json={"title": "待删除", "kind": "conflict", "color": "#B9473E", "description": ""},
    ).json()
    client.post(
        f"/api/storylines/{storyline['id']}/events",
        json={"episode_id": episode["id"], "position": 1, "stage": "setup", "title": "冲突", "description": ""},
    )

    deleted = client.delete(f"/api/storylines/{storyline['id']}")

    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project['id']}/storylines").json() == []
    assert client.delete(f"/api/storylines/{storyline['id']}").status_code == 404
