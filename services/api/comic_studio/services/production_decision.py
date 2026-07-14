"""M2.2 — Decision layer of the three-tier agent contract.

Decision layer validates *intent* before the execution layer creates any run.
It is intentionally lightweight: it does not read shot/scene/dialogue rows,
does not call providers, and never mutates state. Its outputs are:

- ``scope_type``: ``episode`` or ``shot_group`` based on whether shot_ids were supplied.
- ``shot_ids``: normalized list (or None for episode scope).
- ``rejection``: a short code explaining why the request must be rejected, if any.

The execution layer (``ProductionRunService``) keeps its existing behavior but
delegates conflict/active-run validation here so the policy lives in one place.

Contract rules enforced:
- Decision layer never opens workspace reads (scenes, shots, dialogue, assets).
- Decision layer never raises — failures are returned as ``rejection`` codes so
  callers can map them to HTTP status uniformly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models, schemas


ACTIVE_RUN_STATUSES = {"queued", "running", "paused"}
ScopeType = Literal["episode", "shot_group"]


@dataclass(frozen=True)
class DecisionOutcome:
    scope_type: ScopeType
    shot_ids: list[str] | None
    """A short rejection code, or None if the request is admissible.

    Possible codes:
    - ``active_run``: an episode-scope run is already active for this episode.
    - ``shot_overlap``: one of the requested shots is already running in
      another active shot-group run.
    - ``empty_shot_ids``: shot_group scope was requested but no shot ids were
      supplied.
    """
    rejection: str | None


class ProductionDecisionService:
    """Pure validation layer. Reads only ``production_runs`` rows."""

    def __init__(self, session: Session):
        self.session = session

    # --- Read-only helpers (the only DB touches allowed) -----------------

    def _active_episode_run(self, episode_id: str) -> models.ProductionRun | None:
        return self.session.scalar(
            select(models.ProductionRun)
            .where(
                models.ProductionRun.episode_id == episode_id,
                models.ProductionRun.scope_type == "episode",
                models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES),
            )
            .order_by(models.ProductionRun.created_at.desc())
        )

    def _active_shot_group_runs(self, episode_id: str) -> list[models.ProductionRun]:
        return list(
            self.session.scalars(
                select(models.ProductionRun)
                .where(
                    models.ProductionRun.episode_id == episode_id,
                    models.ProductionRun.scope_type == "shot_group",
                    models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES),
                )
                .order_by(models.ProductionRun.created_at.desc())
            )
        )

    def _shot_overlap_conflict(self, episode_id: str, shot_ids: list[str]) -> str | None:
        if not shot_ids:
            return None
        requested = set(shot_ids)
        for run in self._active_shot_group_runs(episode_id):
            existing = set(run.shot_ids or [])
            if existing & requested:
                return run.id
        return None

    # --- Public API -------------------------------------------------------

    def validate_create(
        self,
        episode_id: str,
        data: schemas.ProductionRunCreate,
    ) -> DecisionOutcome:
        shot_ids = list(data.shot_ids) if data.shot_ids else None
        # shot_group scope requires at least one shot id.
        if shot_ids is not None and len(shot_ids) == 0:
            return DecisionOutcome(
                scope_type="shot_group",
                shot_ids=shot_ids,
                rejection="empty_shot_ids",
            )
        scope_type: ScopeType = "shot_group" if shot_ids else "episode"

        if scope_type == "episode" and self._active_episode_run(episode_id) is not None:
            return DecisionOutcome(
                scope_type=scope_type,
                shot_ids=shot_ids,
                rejection="active_run",
            )
        if scope_type == "shot_group":
            conflict = self._shot_overlap_conflict(episode_id, shot_ids or [])
            if conflict is not None:
                return DecisionOutcome(
                    scope_type=scope_type,
                    shot_ids=shot_ids,
                    rejection="shot_overlap",
                )
        return DecisionOutcome(
            scope_type=scope_type,
            shot_ids=shot_ids,
            rejection=None,
        )


__all__ = (
    "ACTIVE_RUN_STATUSES",
    "DecisionOutcome",
    "ProductionDecisionService",
    "ScopeType",
)
