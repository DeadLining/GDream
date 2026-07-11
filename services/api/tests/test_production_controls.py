from comic_studio import models
from comic_studio.production import ProductionStore


def failed_run(client):
    with client.app.state.session_factory() as session:
        project=models.Project(title="p",logline="l",story_bible="b",visual_style="v")
        episode=models.Episode(project=project,title="e",premise="p",target_duration_seconds=60)
        session.add(episode);session.commit();store=ProductionStore(session)
        run=store.create_run(episode.id,stages=["panels"],concurrency=1)
        one=store.add_item(run.id,"panel","shot","s1",position=1)
        two=store.add_item(run.id,"panel","shot","s2",position=2)
        for item in [one,two]: store.transition_item(item.id,"running");store.transition_item(item.id,"failed",error="x")
        store.transition_run(run.id,"running");store.transition_run(run.id,"completed_with_failures");store.refresh_counters(run.id)
        return run.id,one.id,two.id


def test_pause_continue_and_selected_retry_routes(client):
    run_id,one_id,two_id=failed_run(client)
    retried=client.post(f"/api/production-runs/{run_id}/retry",json={"item_ids":[one_id]})
    assert retried.status_code==202
    items=client.get(f"/api/production-runs/{run_id}/items").json()
    assert next(x for x in items if x["id"]==one_id)["status"]=="queued"
    assert next(x for x in items if x["id"]==two_id)["status"]=="failed"

    paused=client.post(f"/api/production-runs/{run_id}/pause")
    assert paused.status_code==200
    continued=client.post(f"/api/production-runs/{run_id}/continue")
    assert continued.status_code==202


def test_startup_recovery_pauses_interrupted_runs(client):
    with client.app.state.session_factory() as session:
        project=models.Project(title="p",logline="l",story_bible="b",visual_style="v")
        episode=models.Episode(project=project,title="e",premise="p",target_duration_seconds=60)
        session.add(episode);session.commit();store=ProductionStore(session)
        run=store.create_run(episode.id,stages=["panels"],concurrency=1)
        item=store.add_item(run.id,"panel","shot","s1",position=1)
        store.transition_run(run.id,"running");store.transition_item(item.id,"running")
        run_id=run.id

    recovered=client.app.state.recover_production_runs()
    assert run_id in recovered
    assert client.get(f"/api/production-runs/{run_id}").json()["status"]=="paused"
