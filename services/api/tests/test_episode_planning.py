import asyncio

from comic_studio import models, schemas
from comic_studio.services.planning import PlanningService


class FakePlanner:
    async def plan_episode(self, context):
        return schemas.EpisodePlan(
            scenes=[
                schemas.PlannedScene(
                    location="雨夜巷道",
                    time_of_day="night",
                    summary="林默发现线索",
                    continuity_state={"weather": "rain"},
                    estimated_duration_seconds=8,
                    shots=[
                        schemas.PlannedShot(
                            shot_type="close_up",
                            duration_seconds=5,
                            composition="芯片映出林默的眼睛",
                            image_prompt="Chinese noir close-up",
                            dialogue=[
                                schemas.PlannedDialogue(
                                    character_id=None,
                                    text="这段记忆不对。",
                                    subtitle_text="这段记忆不对。",
                                    emotion="suspicious",
                                    performance_instruction="低声",
                                )
                            ],
                        )
                    ],
                )
            ]
        )


def test_planning_persists_a_complete_ordered_graph(db_session):
    project = models.Project(
        title="霓虹夜行",
        logline="失忆侦探寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
        aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project,
        title="失窃的雨夜",
        premise="林默寻找芯片",
        target_duration_seconds=60,
    )
    db_session.add(episode)
    db_session.commit()

    planned = asyncio.run(
        PlanningService(db_session, FakePlanner()).plan_episode(episode.id)
    )

    assert planned.status == "planned"
    assert len(planned.scenes) == 1
    assert planned.scenes[0].position == 1
    assert planned.scenes[0].shots[0].position == 1
    assert planned.scenes[0].shots[0].dialogue[0].position == 1
