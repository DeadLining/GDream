"""M2.2 — Supervision layer of the three-tier agent contract.

After a run finishes (or stalls), the supervisor produces a structured summary
that combines execution state with downstream review signals (render review,
slideshow risk). It is **strictly read-only** — it never transitions items,
never retries failures, never mutates runs. Other layers / operators consume
the summary to decide next steps.

Contract rules enforced:
- Supervisor never calls provider APIs.
- Supervisor never transitions run/item status.
- Supervisor only reads existing rows and assembles a summary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.production import ProductionStore


@dataclass(frozen=True)
class RunSummary:
    run_id: str
    episode_id: str
    status: str
    scope_type: str
    shot_ids: list[str] | None
    progress: dict[str, int]
    """Item counts keyed by status: queued/running/succeeded/failed/skipped/total."""
    failed_items: list[dict[str, Any]]
    """Compact view of failed items: stage, target_type, target_id, error."""
    render_reviews: list[dict[str, Any]]
    """Latest render review summaries for the episode (overall_pass + risk level)."""
    suggestions: list[str] = field(default_factory=list)
    """Human-readable next-step suggestions. Advisory only."""


class ProductionSupervisorService:
    """Read-only summarizer. Never mutates state."""

    def __init__(self, session: Session):
        self.session = session

    def summarize_run(self, run_id: str) -> RunSummary | None:
        store = ProductionStore(self.session)
        run = store.get_run(run_id)
        if run is None:
            return None
        items = store.list_items(run_id)
        progress = {
            "queued": 0,
            "running": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "total": len(items),
        }
        failed_items: list[dict[str, Any]] = []
        for item in items:
            progress[item.status] = progress.get(item.status, 0) + 1
            if item.status == "failed":
                failed_items.append(
                    {
                        "item_id": item.id,
                        "stage": item.stage,
                        "target_type": item.target_type,
                        "target_id": item.target_id,
                        "error": item.error,
                    }
                )

        render_reviews = self._latest_render_reviews(run.episode_id)
        suggestions = self._build_suggestions(progress, failed_items, render_reviews)
        return RunSummary(
            run_id=run.id,
            episode_id=run.episode_id,
            status=run.status,
            scope_type=run.scope_type,
            shot_ids=list(run.shot_ids) if run.shot_ids else None,
            progress=progress,
            failed_items=failed_items,
            render_reviews=render_reviews,
            suggestions=suggestions,
        )

    # --- Helpers (read-only) ---------------------------------------------

    def _latest_render_reviews(self, episode_id: str) -> list[dict[str, Any]]:
        rows = list(
            self.session.scalars(
                select(models.RenderReviewRecord)
                .where(models.RenderReviewRecord.episode_id == episode_id)
                .order_by(models.RenderReviewRecord.created_at.desc())
                .limit(5)
            )
        )
        summaries: list[dict[str, Any]] = []
        for row in rows:
            risk = row.slideshow_risk or {}
            summaries.append(
                {
                    "id": row.id,
                    "overall_pass": row.overall_pass,
                    "slideshow_risk_level": risk.get("level") if isinstance(risk, dict) else None,
                    "slideshow_risk_score": risk.get("score") if isinstance(risk, dict) else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return summaries

    def _build_suggestions(
        self,
        progress: dict[str, int],
        failed_items: list[dict[str, Any]],
        render_reviews: list[dict[str, Any]],
    ) -> list[str]:
        suggestions: list[str] = []
        if progress.get("failed", 0) > 0:
            suggestions.append(
                f"{progress['failed']} item(s) failed — operator may retry via /retry."
            )
        # Surface any render review that failed overall or has critical slideshow risk.
        for review in render_reviews:
            if not review.get("overall_pass", True):
                suggestions.append(
                    f"Render review {review['id']} did not pass self-check."
                )
                break
        for review in render_reviews:
            if review.get("slideshow_risk_level") == "critical":
                suggestions.append(
                    f"Render review {review['id']} flagged as slideshow-critical — consider re-rendering with more motion."
                )
                break
        return suggestions


__all__ = ("ProductionSupervisorService", "RunSummary")
