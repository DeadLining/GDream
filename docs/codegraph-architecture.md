# AI Comic Studio Architecture Index

This document records the current module boundaries discovered with CodeGraph. It is an orientation map, not a rewrite plan.

## Product hierarchy

The shared domain hierarchy is:

`Project -> Volume/Chapter -> Episode -> Scene -> Shot`

Storylines are cross-episode tracking relationships. Asset lineage is:

`Project master -> Episode variant -> State -> Shot/video usage`

## Frontend boundaries

| Area | Ownership |
|---|---|
| `apps/web/app/` | Next.js entry points, global styles, design tokens |
| `apps/web/components/Workspace.tsx` | Application composition and loaded project/episode state |
| `apps/web/components/canvas/` | Storyline and asset-lineage canvas views |
| `apps/web/components/director/` | 3D director workspace and scene manipulation |
| `apps/web/components/*Workspace.tsx` | Feature-level page composition |
| `apps/web/lib/api.ts` | HTTP transport functions |
| `apps/web/lib/navigation.ts` | Shared page, section, and work-area navigation model |
| `apps/web/lib/types.ts` | API and domain transport types |
| `apps/web/tests/` | Component and pure-module regression tests |

`Workspace.tsx` remains the main composition root. New feature behavior should live in a feature component or hook; only cross-feature selection and navigation state should be added to the composition root.

## API boundaries

| Area | Ownership |
|---|---|
| `services/api/comic_studio/main.py` | Application assembly and router registration |
| `services/api/comic_studio/routes/` | HTTP validation, status codes, and service delegation |
| `services/api/comic_studio/services/` | Narrative, asset, review, publication, and operations workflows |
| `services/api/comic_studio/model_runtime/` | Provider invocation, persisted jobs, health, and retry orchestration |
| `services/api/comic_studio/providers/` | External model-provider adapters |
| `services/api/comic_studio/models.py` | SQLAlchemy persistence models |
| `services/api/comic_studio/schemas.py` | Shared API schemas |
| `services/api/alembic/versions/` | Ordered database migrations |
| `services/api/tests/` | Route, service, provider, and migration regression tests |

Routes should not implement domain mutations directly. Services may coordinate repositories and providers, while provider-specific request and response handling stays inside provider adapters.

## Dependency direction

```text
React page/component -> lib/api -> HTTP route -> domain service -> model/repository
                                                   |
                                                   +-> model_runtime -> provider adapter
```

UI navigation types are independent of React components. Provider adapters must not import route modules. Domain services must not depend on frontend transport types.

## Current hotspots

1. `Workspace.tsx` owns loading, selection, navigation, deletion dialogs, planning, and page composition. Extract behavior only in tested slices; navigation literals are now centralized in `lib/navigation.ts`.
2. `model_runtime/service.py` combines invocation tracking, media jobs, channel settings, health, and retry behavior. A later refactor should split media execution, channel administration, and health reporting behind the existing service facade.
3. `lib/api.ts`, `models.py`, and `schemas.py` are broad shared files. Split them by domain only after imports and public names are protected by contract tests.

## Safe cleanup order

1. Extract pure constants, types, serializers, and selectors with focused tests.
2. Extract feature hooks or services while preserving the current public component/API facade.
3. Move domain-specific schemas and API functions in mechanical batches.
4. Re-run Web tests/build and API tests after each boundary change.
5. Refresh the CodeGraph index after file moves so dependency queries remain accurate.
