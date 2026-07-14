from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas


class ProductionCanvasService:
    def __init__(self, session: Session):
        self.session = session

    def graph(self, episode_id: str) -> schemas.EpisodeProductionGraphRead:
        episode = self.session.scalar(
            select(models.Episode)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue)
            )
            .where(models.Episode.id == episode_id)
        )
        if episode is None:
            raise KeyError(episode_id)

        scenes = sorted(episode.scenes, key=lambda item: (item.position, item.id))
        shots = [
            shot
            for scene in scenes
            for shot in sorted(scene.shots, key=lambda item: (item.position, item.id))
        ]
        shot_ids = [shot.id for shot in shots]
        active_asset_ids = {
            asset_id
            for shot in shots
            for asset_id in (shot.active_panel_asset_id, shot.active_video_asset_id)
            if asset_id
        }
        active_assets = {
            asset.id: asset
            for asset in self.session.scalars(
                select(models.Asset).where(models.Asset.id.in_(active_asset_ids))
            )
        } if active_asset_ids else {}
        variants = list(
            self.session.scalars(
                select(models.AssetVariant)
                .join(models.AssetVariantUsage)
                .where(
                    models.AssetVariantUsage.shot_id.in_(shot_ids),
                    models.AssetVariant.deleted_at.is_(None),
                )
                .options(selectinload(models.AssetVariant.usages))
                .distinct()
                .order_by(models.AssetVariant.created_at, models.AssetVariant.id)
            ).all()
        ) if shot_ids else []
        latest_run = self.session.scalar(
            select(models.ProductionRun)
            .options(selectinload(models.ProductionRun.items))
            .where(models.ProductionRun.episode_id == episode.id)
            .order_by(models.ProductionRun.created_at.desc(), models.ProductionRun.id.desc())
        )
        bindings = list(
            self.session.scalars(
                select(models.ProductionWorkflowBinding)
                .where(models.ProductionWorkflowBinding.project_id == episode.project_id)
                .order_by(
                    models.ProductionWorkflowBinding.capability,
                    models.ProductionWorkflowBinding.name,
                )
            ).all()
        )
        media_dependencies = []
        for shot in shots:
            if shot.active_panel_asset_id and shot.active_video_asset_id:
                media_dependencies.append(
                    schemas.ProductionMediaDependencyRead(
                        source_shot_id=shot.id,
                        target_shot_id=shot.id,
                        source_kind="panel",
                        target_kind="video",
                    )
                )

        return schemas.EpisodeProductionGraphRead(
            episode_id=episode.id,
            project_id=episode.project_id,
            scenes=[
                schemas.ProductionGraphSceneRead(
                    id=scene.id,
                    position=scene.position,
                    location=scene.location,
                    summary=scene.summary,
                )
                for scene in scenes
            ],
            shots=[
                schemas.ProductionGraphShotRead(
                    id=shot.id,
                    scene_id=shot.scene_id,
                    position=shot.position,
                    shot_type=shot.shot_type,
                    duration_seconds=shot.duration_seconds,
                    composition=shot.composition,
                    review_status=shot.review_status,
                    render_status=shot.render_status,
                    video_render_status=shot.video_render_status,
                    active_panel_asset_id=shot.active_panel_asset_id,
                    active_panel_media_url=(
                        f"/media/{active_assets[shot.active_panel_asset_id].local_path}"
                        if shot.active_panel_asset_id in active_assets
                        else None
                    ),
                    active_video_asset_id=shot.active_video_asset_id,
                    active_video_media_url=(
                        f"/media/{active_assets[shot.active_video_asset_id].local_path}"
                        if shot.active_video_asset_id in active_assets
                        else None
                    ),
                    dialogue_ids=[line.id for line in shot.dialogue],
                    dialogue_count=len(shot.dialogue),
                    speech_ready_count=sum(
                        1 for line in shot.dialogue if line.audio_asset_id
                    ),
                )
                for shot in shots
            ],
            assets=[
                schemas.ProductionGraphAssetRead(
                    id=variant.id,
                    kind="variant",
                    label=variant.label,
                    version=variant.version,
                    status=variant.review_status,
                    shot_ids=sorted(
                        usage.shot_id
                        for usage in variant.usages
                        if usage.shot_id in shot_ids
                    ),
                )
                for variant in variants
            ],
            production_items=list(latest_run.items) if latest_run else [],
            media_dependencies=media_dependencies,
            workflow_bindings=bindings,
        )

    def read_layout(self, episode_id: str) -> schemas.ProductionCanvasLayoutRead:
        if self.session.get(models.Episode, episode_id) is None:
            raise KeyError(episode_id)
        layout = self.session.scalar(
            select(models.ProductionCanvasLayout).where(
                models.ProductionCanvasLayout.episode_id == episode_id
            )
        )
        if layout is not None:
            return schemas.ProductionCanvasLayoutRead.model_validate(layout)
        return schemas.ProductionCanvasLayoutRead(
            episode_id=episode_id,
            version=1,
            layout=schemas.ProductionCanvasLayoutPayload(
                version=3,
                viewport={"x": 0, "y": 0, "zoom": 0.75},
                nodes={},
                expanded_shots=[],
                pinned_shots=[],
                collapsed_scene_ids=[],
            ),
            updated_at=models.utc_now(),
        )

    def save_layout(
        self, episode_id: str, payload: schemas.ProductionCanvasLayoutPayload
    ) -> schemas.ProductionCanvasLayoutRead:
        if self.session.get(models.Episode, episode_id) is None:
            raise KeyError(episode_id)
        layout = self.session.scalar(
            select(models.ProductionCanvasLayout).where(
                models.ProductionCanvasLayout.episode_id == episode_id
            )
        )
        if layout is None:
            layout = models.ProductionCanvasLayout(
                episode_id=episode_id,
                version=1,
                layout=payload.model_dump(),
            )
            self.session.add(layout)
        else:
            layout.version += 1
            layout.layout = payload.model_dump()
        self.session.commit()
        self.session.refresh(layout)
        return schemas.ProductionCanvasLayoutRead.model_validate(layout)

    def list_workflow_bindings(
        self, project_id: str
    ) -> list[models.ProductionWorkflowBinding]:
        if self.session.get(models.Project, project_id) is None:
            raise KeyError(project_id)
        return list(
            self.session.scalars(
                select(models.ProductionWorkflowBinding)
                .where(models.ProductionWorkflowBinding.project_id == project_id)
                .order_by(
                    models.ProductionWorkflowBinding.capability,
                    models.ProductionWorkflowBinding.name,
                )
            ).all()
        )

    def save_workflow_binding(
        self,
        project_id: str,
        capability: str,
        name: str,
        payload: schemas.ProductionWorkflowBindingUpdate,
    ) -> models.ProductionWorkflowBinding:
        if self.session.get(models.Project, project_id) is None:
            raise KeyError(project_id)
        binding = self.session.scalar(
            select(models.ProductionWorkflowBinding).where(
                models.ProductionWorkflowBinding.project_id == project_id,
                models.ProductionWorkflowBinding.capability == capability,
                models.ProductionWorkflowBinding.name == name,
            )
        )
        values = payload.model_dump()
        if binding is None:
            binding = models.ProductionWorkflowBinding(
                project_id=project_id,
                capability=capability,
                name=name,
                **values,
            )
            self.session.add(binding)
        else:
            for key, value in values.items():
                setattr(binding, key, value)
        self.session.commit()
        self.session.refresh(binding)
        return binding
