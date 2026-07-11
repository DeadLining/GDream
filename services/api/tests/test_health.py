from fastapi.testclient import TestClient

from comic_studio.main import create_app


def test_health_reports_service_name():
    response = TestClient(create_app()).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-comic-studio"}
