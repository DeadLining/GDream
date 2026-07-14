"""M2.1 — Skill API tests."""

from __future__ import annotations

from comic_studio.services import skill_loader


def test_list_skills_returns_known_names(client):
    skill_loader.reset_skill_loader()
    response = client.get("/api/skills")
    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert names == set(skill_loader.SKILL_NAMES)


def test_get_skill_returns_default_when_no_file(client):
    skill_loader.reset_skill_loader()
    response = client.get("/api/skills/panel_prompt")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "panel_prompt"
    assert body["source"] in {"disk", "default"}
    assert "{visual_style}" in body["body"]


def test_get_unknown_skill_404(client):
    response = client.get("/api/skills/definitely_not_a_skill")
    assert response.status_code == 404


def test_put_skill_writes_and_returns_disk_source(client, tmp_path, monkeypatch):
    # Point the singleton loader at a temp skills dir so we don't touch repo files.
    monkeypatch.setattr(
        skill_loader,
        "_loader_singleton",
        skill_loader.SkillLoader(skills_dir=tmp_path / "skills"),
    )
    response = client.put(
        "/api/skills/panel_prompt",
        json={"body": "custom body {visual_style}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "disk"
    assert body["body"] == "custom body {visual_style}"
    # Follow-up GET reads from disk.
    got = client.get("/api/skills/panel_prompt").json()
    assert got["body"] == "custom body {visual_style}"


def test_put_unknown_skill_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(
        skill_loader,
        "_loader_singleton",
        skill_loader.SkillLoader(skills_dir=tmp_path / "skills"),
    )
    response = client.put("/api/skills/bogus", json={"body": "x"})
    assert response.status_code == 404
