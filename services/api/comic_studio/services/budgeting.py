"""M4.1 — Production-run budget governance.

Tracks estimated spend against a per-run budget cap and decides whether a
run should be paused. Costs are estimates by stage until provider invoices are
available; this keeps the run-level guardrail independent of asynchronous
billing reconciliation.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models


# Estimated USD cost per successful production item by stage. These constants
# are intentionally conservative placeholders; they can be overridden by
# provider-specific reconciliation once real invoices are available.
ESTIMATED_COST_USD: dict[str, float] = {
    "panel": 0.01,
    "speech": 0.005,
    "video": 0.05,
}


class BudgetingService:
    """Run-level budget cap / warn / observe logic."""

    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def estimate_item_cost(stage: str) -> float:
        """Return the estimated cost for one successful item."""
        return ESTIMATED_COST_USD.get(stage, 0.0)

    def estimate_run_cost(self, run_id: str) -> float:
        """Sum the estimated cost of all queued items in a run."""
        items = list(
            self.session.scalars(
                select(models.ProductionItem).where(
                    models.ProductionItem.run_id == run_id,
                    models.ProductionItem.status == "queued",
                )
            )
        )
        return sum(self.estimate_item_cost(item.stage) for item in items)

    def record_item_cost(self, run_id: str, stage: str, cost_usd: float | None = None) -> None:
        """Add a completed item's cost to the run's spent total."""
        run = self.session.get(models.ProductionRun, run_id)
        if run is None:
            raise KeyError(run_id)
        cost = cost_usd if cost_usd is not None else self.estimate_item_cost(stage)
        run.spent_usd = float(run.spent_usd) + cost
        self.session.commit()
        self.session.refresh(run)

    def should_pause_run(self, run_id: str) -> bool:
        """Return True when the run's cap mode is 'cap' and the next item
        would push the spend over the budget.

        Uses the most expensive remaining queued item as the worst-case
        projection so the pause decision is safe.
        """
        run = self.session.get(models.ProductionRun, run_id)
        if run is None or run.budget_mode != "cap" or run.budget_cap_usd is None:
            return False
        queued = list(
            self.session.scalars(
                select(models.ProductionItem).where(
                    models.ProductionItem.run_id == run_id,
                    models.ProductionItem.status == "queued",
                )
            )
        )
        if not queued:
            return False
        max_next_cost = max(self.estimate_item_cost(item.stage) for item in queued)
        return float(run.spent_usd) + max_next_cost > float(run.budget_cap_usd)

    def reconcile_invocation(self, invocation_id: str, cost_usd: float | None = None) -> None:
        """Record the actual cost of a ModelInvocation for future analysis.

        Currently stores the cost on the invocation itself; a future billing
        reconciliation step can aggregate these into run spend.
        """
        invocation = self.session.get(models.ModelInvocation, invocation_id)
        if invocation is None:
            raise KeyError(invocation_id)
        invocation.cost_usd = cost_usd if cost_usd is not None else self.estimate_item_cost(
            invocation.capability
        )
        self.session.commit()
        self.session.refresh(invocation)
