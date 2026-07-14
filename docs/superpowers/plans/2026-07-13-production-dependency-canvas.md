# Production Dependency Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the list-first production page with an episode-level React Flow dependency canvas while preserving existing production execution behavior and reusing proven graph algorithms from `LocalMiniDrama-main`.

**Architecture:** Add a framework-independent graph model, a backend aggregation endpoint, and per-episode layout persistence. Render that model through `@xyflow/react`, keep existing production commands behind canvas nodes and a secondary task drawer, and expose a versioned ComfyUI workflow binding without implementing the ComfyUI executor in this plan.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@xyflow/react`, ELK.js, FastAPI, SQLAlchemy, Alembic, Vitest, pytest, Playwright

**Execution Constraint:** Do not create commits unless the user explicitly requests them. Replace every commit checkpoint with `git diff --check` and a scoped diff review.

**Combined Architecture:** This is Project 1 of `docs/superpowers/specs/2026-07-13-production-canvas-combined-architecture-design.md`. It delivers the authoritative episode main canvas only. Agent mutation, the conversational image subcanvas, and ComfyUI execution are isolated in Projects 2-4.

---

## Scope Boundary

This plan delivers the production canvas and a stable workflow-binding contract. A separate plan will implement ComfyUI prompt submission, websocket progress, history retrieval, output ingestion, and cancellation. Existing image and video providers remain operational throughout this migration.

## File Structure

### Frontend files to create

- `apps/web/lib/production-canvas.ts` — graph DTO normalization, stable IDs, edge derivation, semantic expansion, layout merge.
- `apps/web/components/production-canvas/ProductionCanvas.tsx` — React Flow composition root.
- `apps/web/components/production-canvas/ProductionCanvasToolbar.tsx` — selection, fit, layout, zoom, task drawer controls.
- `apps/web/components/production-canvas/ProductionCanvasInspector.tsx` — selected-node detail and production commands.
- `apps/web/components/production-canvas/ProductionTaskDrawer.tsx` — existing queue filters and retry selection.
- `apps/web/components/production-canvas/nodes/AssetNode.tsx` — character/state/prop/scene asset presentation.
- `apps/web/components/production-canvas/nodes/SceneGroupNode.tsx` — scene grouping frame.
- `apps/web/components/production-canvas/nodes/ShotNode.tsx` — peer shot node and four-stage indicator.
- `apps/web/components/production-canvas/nodes/MediaNode.tsx` — panel, speech, video, and review node presentation.
- `apps/web/tests/production-canvas-model.test.ts` — pure graph contract tests.
- `apps/web/tests/production-canvas.test.tsx` — canvas component behavior.
- `apps/web/e2e/production-canvas.spec.ts` — real-browser geometry and interaction checks.

### Frontend files to modify

- `apps/web/package.json` — add React Flow and ELK.
- `apps/web/lib/api.ts` — graph and layout endpoints.
- `apps/web/lib/types.ts` — API DTOs for graph and layout.
- `apps/web/components/ProductionPanel.tsx` — retain orchestration state and render the new canvas.
- `apps/web/components/ProductionItemRow.tsx` — reuse inside task drawer without changing semantics.
- `apps/web/app/globals.css` — canvas shell, inspector, drawer, node, handle, and responsive styles.
- `apps/web/tests/production-panel.test.tsx` — preserve run/pause/retry payload contracts.

### Backend files to create

- `services/api/alembic/versions/20260713_14_production_canvas.py` — layout and workflow-binding persistence; follows the existing `20260713_13_drop_audit_events.py` revision.
- `services/api/comic_studio/services/production_canvas.py` — graph aggregation and layout persistence.
- `services/api/comic_studio/routes/production_canvas.py` — graph/layout HTTP endpoints.
- `services/api/tests/test_production_canvas.py` — aggregation, authorization scope, layout, and binding tests.

### Backend files to modify

- `services/api/comic_studio/models.py` — `ProductionCanvasLayout` and `ProductionWorkflowBinding`.
- `services/api/comic_studio/schemas.py` — graph, layout, and workflow-binding schemas.
- `services/api/comic_studio/main.py` — router registration.
- `services/api/tests/test_migrations.py` — migration table coverage.

### Attribution

- `docs/third-party/local-mini-drama-canvas.md` — source paths, MIT attribution, and adapted concepts.
- `docs/third-party/toonflow-production-reference.md` — Apache-2.0 reference notice for episode aggregation and asset fan-out concepts; no compiled frontend code is copied.

---

### Task 1: Add Canvas Dependencies and Attribution

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json`
- Create: `docs/third-party/local-mini-drama-canvas.md`
- Create: `docs/third-party/toonflow-production-reference.md`

- [ ] **Step 1: Record the exact third-party source and license**

Create the attribution document with:

```markdown
# LocalMiniDrama Canvas Attribution

Canvas algorithms and interaction concepts were adapted from LocalMiniDrama,
Copyright (c) 2026 xuanyustudio, licensed under the MIT License.

Source examined:
- `frontweb/src/views/DramaCanvas.vue`
- `frontweb/src/utils/dramaCanvasAdapter.js`
- `frontweb/src/utils/canvasLayout.js`
- `frontweb/src/utils/canvasWorkflow.js`
- `frontweb/src/composables/useCanvasWorkflowRunner.js`

The original project uses Vue Flow. This project reimplements the component
layer with React Flow while retaining the required MIT notice.
```

Create the Toonflow reference document with:

```markdown
# Toonflow Production Reference

Episode aggregation, derived-asset presentation, asset-to-shot fan-out, and
local image-workflow concepts were studied from Toonflow-app, Copyright HBAI-Ltd,
licensed under Apache License 2.0. No compiled frontend artifact is copied.

Reference paths:
- `src/routes/production/getFlowData.ts`
- `src/agents/productionAgent/tools.ts`
- `src/routes/production/editImage/saveImageFlow.ts`
```

- [ ] **Step 2: Install the proven canvas and layout libraries**

Run:

```bash
cd apps/web
npm install @xyflow/react elkjs
```

Expected: `package.json` and `package-lock.json` include both dependencies, with no unrelated dependency changes.

- [ ] **Step 3: Verify the dependency baseline**

Run:

```bash
cd apps/web
npm test -- --run tests/production-panel.test.tsx
npm run build
```

Expected: existing production tests and the production build pass before canvas code is introduced.

- [ ] **Step 4: Review the scoped diff**

Run:

```bash
git diff --check
git diff -- apps/web/package.json apps/web/package-lock.json docs/third-party/local-mini-drama-canvas.md
```

Expected: only dependency and attribution changes.

---

### Task 2: Define Backend Canvas Persistence

**Files:**
- Create: `services/api/alembic/versions/20260713_14_production_canvas.py`
- Modify: `services/api/comic_studio/models.py`
- Modify: `services/api/comic_studio/schemas.py`
- Modify: `services/api/tests/test_migrations.py`
- Test: `services/api/tests/test_production_canvas.py`

- [ ] **Step 1: Write failing model and migration tests**

Add tests that require one layout per episode, plus workflow bindings per project and capability. The application intentionally has no user domain.

```python
def test_production_canvas_layout_is_unique_per_episode(db_session, seeded_episode):
    first = models.ProductionCanvasLayout(
        episode_id=seeded_episode.id,
        version=1,
        layout={"version": 1, "viewport": {"x": 0, "y": 0, "zoom": 0.75}, "nodes": {}},
    )
    db_session.add(first)
    db_session.commit()
    duplicate = models.ProductionCanvasLayout(
        episode_id=seeded_episode.id,
        version=1,
        layout={},
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_production_workflow_binding_is_versioned(db_session, seeded_project):
    binding = models.ProductionWorkflowBinding(
        project_id=seeded_project.id,
        capability="panel",
        name="动漫竖屏画面",
        workflow_id="workflow-panel-v3",
        workflow_version=3,
        input_mapping_version=1,
        enabled=True,
    )
    db_session.add(binding)
    db_session.commit()
    assert binding.workflow_version == 3
```

Update `test_migrations.py` to require `production_canvas_layouts` and `production_workflow_bindings`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd services/api
pytest -q tests/test_production_canvas.py tests/test_migrations.py
```

Expected: failures because the models and tables do not exist.

- [ ] **Step 3: Add the persistence models**

Add models with these contracts:

```python
class ProductionCanvasLayout(Base):
    __tablename__ = "production_canvas_layouts"
    __table_args__ = (
        UniqueConstraint("episode_id", name="uq_production_canvas_episode"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class ProductionWorkflowBinding(Base):
    __tablename__ = "production_workflow_bindings"
    __table_args__ = (
        UniqueConstraint("project_id", "capability", "name", name="uq_production_workflow_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    capability: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    workflow_id: Mapped[str] = mapped_column(String(200))
    workflow_version: Mapped[int] = mapped_column(Integer, default=1)
    input_mapping_version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
```

- [ ] **Step 4: Add strict schemas**

Add:

```python
class ProductionCanvasLayoutPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    viewport: dict[str, float]
    nodes: dict[str, dict[str, float]]
    expanded_shots: list[str] = []
    pinned_shots: list[str] = []


class ProductionCanvasLayoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    episode_id: str
    version: int
    layout: ProductionCanvasLayoutPayload
    updated_at: datetime


class ProductionWorkflowBindingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    capability: Literal["panel", "video"]
    name: str
    workflow_id: str
    workflow_version: int
    input_mapping_version: int
    enabled: bool
```

- [ ] **Step 5: Add and run the Alembic migration**

The migration must create both tables, both unique constraints, indexes on foreign keys/user/capability, and cascade episode/project deletion.

Run:

```bash
cd services/api
pytest -q tests/test_production_canvas.py tests/test_migrations.py
```

Expected: model and migration tests pass.

- [ ] **Step 6: Review the scoped diff**

Run `git diff --check` and inspect only the migration, models, schemas, and tests.

---

### Task 3: Add the Production Graph Aggregation Service

**Files:**
- Create: `services/api/comic_studio/services/production_canvas.py`
- Create: `services/api/comic_studio/routes/production_canvas.py`
- Modify: `services/api/comic_studio/main.py`
- Modify: `services/api/comic_studio/schemas.py`
- Test: `services/api/tests/test_production_canvas.py`

- [ ] **Step 1: Write failing graph endpoint tests**

Create a fixture with two scenes, multiple shots, a shared asset variant usage, active panel/video assets, production items, and review state. Assert:

```python
def test_episode_production_graph_returns_peer_shots_and_real_dependencies(client, seeded_production_graph):
    response = client.get(f"/api/episodes/{seeded_production_graph.episode_id}/production-graph")
    assert response.status_code == 200
    payload = response.json()
    assert [scene["id"] for scene in payload["scenes"]] == seeded_production_graph.scene_ids
    assert {shot["id"] for shot in payload["shots"]} == set(seeded_production_graph.shot_ids)
    shared = next(item for item in payload["assets"] if item["id"] == seeded_production_graph.variant_id)
    assert set(shared["shot_ids"]) == set(seeded_production_graph.variant_shot_ids)
    assert all(edge["source_shot_id"] == edge["target_shot_id"] for edge in payload["media_dependencies"])


def test_production_graph_never_connects_panel_history_to_another_shot(client, seeded_production_graph):
    payload = client.get(
        f"/api/episodes/{seeded_production_graph.episode_id}/production-graph"
    ).json()
    assert not any(
        edge["source_shot_id"] != edge["target_shot_id"]
        for edge in payload["media_dependencies"]
    )
```

- [ ] **Step 2: Run the endpoint tests to verify RED**

Run:

```bash
cd services/api
pytest -q tests/test_production_canvas.py -k production_graph
```

Expected: 404 because the route does not exist.

- [ ] **Step 3: Define graph read schemas**

Use explicit DTOs rather than returning ORM models:

```python
class ProductionGraphSceneRead(BaseModel):
    id: str
    position: int
    location: str
    summary: str


class ProductionGraphShotRead(BaseModel):
    id: str
    scene_id: str
    position: int
    shot_type: str
    duration_seconds: float
    composition: str
    review_status: str
    active_panel_asset_id: str | None
    active_video_asset_id: str | None


class ProductionGraphAssetRead(BaseModel):
    id: str
    kind: Literal["variant", "state", "asset"]
    label: str
    media_url: str | None
    version: int
    status: str
    shot_ids: list[str]


class EpisodeProductionGraphRead(BaseModel):
    episode_id: str
    project_id: str
    scenes: list[ProductionGraphSceneRead]
    shots: list[ProductionGraphShotRead]
    assets: list[ProductionGraphAssetRead]
    production_items: list[ProductionItemRead]
    media_dependencies: list[dict]
    workflow_bindings: list[ProductionWorkflowBindingRead]
```

- [ ] **Step 4: Implement aggregation with eager loading**

`ProductionCanvasService.graph(episode_id)` must:

1. Load episode, scenes, shots, active assets, asset variant usages, latest production run/items, and workflow bindings.
2. Exclude soft-deleted variants and states.
3. Emit asset fan-out through `shot_ids`.
4. Emit media dependencies only within the same shot.
5. Return stable ordering by scene and shot position.

- [ ] **Step 5: Add and register the route**

```python
@router.get(
    "/api/episodes/{episode_id}/production-graph",
    response_model=schemas.EpisodeProductionGraphRead,
)
def get_production_graph(episode_id: str, session: SessionDependency):
    try:
        return ProductionCanvasService(session).graph(episode_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="episode_not_found")
```

- [ ] **Step 6: Run graph tests**

Run:

```bash
cd services/api
pytest -q tests/test_production_canvas.py -k production_graph
```

Expected: graph tests pass without SQLAlchemy lazy-load errors.

---

### Task 4: Add Layout and Workflow-Binding Endpoints

**Files:**
- Modify: `services/api/comic_studio/services/production_canvas.py`
- Modify: `services/api/comic_studio/routes/production_canvas.py`
- Test: `services/api/tests/test_production_canvas.py`

- [ ] **Step 1: Write failing endpoint tests**

```python
def test_canvas_layout_round_trips_for_user(client, seeded_episode):
    payload = {
        "version": 1,
        "viewport": {"x": 10, "y": -20, "zoom": 0.8},
        "nodes": {"shot:one": {"x": 300, "y": 120}},
        "expanded_shots": ["one"],
        "pinned_shots": [],
    }
    saved = client.put(
        f"/api/episodes/{seeded_episode.id}/production-canvas-layout",
        json=payload,
    )
    assert saved.status_code == 200
    loaded = client.get(
        f"/api/episodes/{seeded_episode.id}/production-canvas-layout"
    )
    assert loaded.json()["layout"] == payload


def test_canvas_layout_rejects_unknown_fields(client, seeded_episode):
    response = client.put(
        f"/api/episodes/{seeded_episode.id}/production-canvas-layout",
        json={"version": 1, "viewport": {}, "nodes": {}, "unknown": True},
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify RED**

Expected: 404 for missing endpoints.

- [ ] **Step 3: Implement layout upsert and read**

The service must increment row version, replace only the validated layout payload, and return an empty version-1 layout when no row exists.

- [ ] **Step 4: Implement workflow-binding read and update**

Expose project-scoped endpoints:

```text
GET /api/projects/{project_id}/production-workflows
PUT /api/projects/{project_id}/production-workflows/{capability}/{name}
```

Reject capabilities outside `panel` and `video`; require positive workflow and mapping versions.

- [ ] **Step 5: Run all backend canvas tests**

Run:

```bash
cd services/api
pytest -q tests/test_production_canvas.py tests/test_migrations.py
```

Expected: all production canvas and migration tests pass.

---

### Task 5: Port the Framework-Independent Graph Model

**Files:**
- Create: `apps/web/lib/production-canvas.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/tests/production-canvas-model.test.ts`

- [ ] **Step 1: Add frontend DTOs and API functions**

Define:

```typescript
export type ProductionCanvasLayout = {
  version: 1;
  viewport: {x: number; y: number; zoom: number};
  nodes: Record<string, {x: number; y: number}>;
  expanded_shots: string[];
  pinned_shots: string[];
};

export type EpisodeProductionGraph = {
  episode_id: string;
  project_id: string;
  scenes: ProductionGraphScene[];
  shots: ProductionGraphShot[];
  assets: ProductionGraphAsset[];
  production_items: ProductionItem[];
  media_dependencies: ProductionMediaDependency[];
  workflow_bindings: ProductionWorkflowBinding[];
};
```

Add `getEpisodeProductionGraph`, `getProductionCanvasLayout`, and `putProductionCanvasLayout` to `api.ts`.

- [ ] **Step 2: Write failing pure graph tests**

```typescript
it('keeps all shots as peer nodes and scenes as parent frames', () => {
  const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
  expect(graph.nodes.filter(node=>node.type==='shot').map(node=>node.id)).toEqual([
    'shot:shot-1','shot:shot-2','shot:shot-3',
  ]);
  expect(graph.nodes.find(node=>node.id==='shot:shot-2')?.parentId).toBe('scene:scene-1');
});

it('expands media nodes only for the selected shot', () => {
  const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
  expect(graph.nodes.some(node=>node.id.startsWith('panel:shot-2:'))).toBe(true);
  expect(graph.nodes.some(node=>node.id.startsWith('panel:shot-1:'))).toBe(false);
});

it('fans a shared asset out to every real shot usage', () => {
  const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
  expect(graph.edges.filter(edge=>edge.source==='asset-variant:variant-1').map(edge=>edge.target).sort()).toEqual([
    'shot:shot-1','shot:shot-2',
  ]);
});

it('never links a historical panel version to another shot', () => {
  const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
  expect(graph.edges.every(edge=>!edge.id.includes('cross-shot'))).toBe(true);
});

it('uses solid dependency edges and dashed inheritance and shot-order edges', () => {
  const graph=buildProductionCanvasGraph(fixture,{selectedShotId:'shot-2'});
  expect(graph.edges.find(edge=>edge.type==='dependency')?.data.lineStyle).toBe('solid');
  expect(graph.edges.find(edge=>edge.type==='inheritance')?.data.lineStyle).toBe('dashed');
  expect(graph.edges.find(edge=>edge.type==='shot-order')?.data.lineStyle).toBe('dashed');
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd apps/web
npm test -- --run tests/production-canvas-model.test.ts
```

Expected: import failure because the module does not exist.

- [ ] **Step 4: Implement stable IDs and graph building**

Export these functions:

```typescript
export const productionNodeId={
  scene:(id:string)=>`scene:${id}`,
  shot:(id:string)=>`shot:${id}`,
  variant:(id:string)=>`asset-variant:${id}`,
  state:(id:string)=>`asset-state:${id}`,
  panel:(shotId:string,assetId:string|null)=>`panel:${shotId}:${assetId??'pending'}`,
  speech:(shotId:string)=>`speech:${shotId}`,
  video:(shotId:string)=>`video:${shotId}`,
  review:(shotId:string)=>`review:${shotId}`,
};

export function buildProductionCanvasGraph(
  source:EpisodeProductionGraph,
  options:{selectedShotId:string|null;expandedShotIds?:string[]},
):{nodes:ProductionCanvasNode[];edges:ProductionCanvasEdge[]} {
  // Build scene frames first, peer shot nodes second, shared assets third,
  // and downstream nodes only for selected/expanded shots.
}
```

Adapt node ID, layout merge, workflow group normalization, and status mapping concepts from LocalMiniDrama into typed pure functions. Do not import Vue code.

Derive only authoritative business edges. Use `dependency`, `selected-dependency`, `inheritance`, `shot-order`, `blocked`, and `stale` edge types. Dependency edges are solid; inheritance and shot-order edges are dashed. Missing required inputs must produce a blocked handle/state on the affected node rather than an invented cross-shot edge.

- [ ] **Step 5: Implement layout merge behavior**

```typescript
export function mergeSavedProductionLayout(
  nodes:ProductionCanvasNode[],
  saved:ProductionCanvasLayout|null,
):ProductionCanvasNode[] {
  return nodes.map(node=>{
    const position=saved?.nodes[node.id];
    return position?{...node,position}:node;
  });
}
```

New nodes retain auto-layout positions; removed node IDs remain harmless in saved JSON until the next save compacts them.

- [ ] **Step 6: Run the pure model tests**

Expected: every graph, fan-out, expansion, and layout test passes.

---

### Task 6: Build the Read-Only React Flow Canvas

**Files:**
- Create: `apps/web/components/production-canvas/ProductionCanvas.tsx`
- Create: `apps/web/components/production-canvas/nodes/SceneGroupNode.tsx`
- Create: `apps/web/components/production-canvas/nodes/AssetNode.tsx`
- Create: `apps/web/components/production-canvas/nodes/ShotNode.tsx`
- Create: `apps/web/components/production-canvas/nodes/MediaNode.tsx`
- Create: `apps/web/tests/production-canvas.test.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Write failing component tests**

Mock React Flow only at the rendering boundary and assert the product node contracts:

```tsx
it('renders scene groups, peer shots, shared assets, and the selected shot chain', async()=>{
  render(<ProductionCanvas graph={fixture} selectedShotId="shot-2" onSelectShot={vi.fn()}/>);
  expect(screen.getByRole('group',{name:'场景 01'})).toBeVisible();
  expect(screen.getByRole('button',{name:/镜头 01/})).toBeVisible();
  expect(screen.getByRole('button',{name:/镜头 02/})).toBeVisible();
  expect(screen.getByRole('button',{name:'唐代造型'})).toBeVisible();
  expect(screen.getByRole('button',{name:/画面 v/})).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify RED**

Expected: missing `ProductionCanvas` module.

- [ ] **Step 3: Implement custom node components**

Each node receives a narrow typed `data` object. `ShotNode` must render:

```tsx
<button className="production-shot-node" aria-label={`镜头 ${data.position}：${data.statusLabel}`}>
  <Handle type="target" position={Position.Left}/>
  <img src={data.thumbnailUrl} alt=""/>
  <strong>镜头 {String(data.position).padStart(2,'0')}</strong>
  <span>{data.durationSeconds}s · {data.shotType}</span>
  <StageIndicator stages={data.stages}/>
  <Handle type="source" position={Position.Right}/>
</button>
```

Use `NodeResizer` only for scene group frames, not individual content cards.

- [ ] **Step 4: Implement the canvas shell**

`ProductionCanvas` must register custom node types, use `fitView`, render `Background`, `Controls`, and `MiniMap`, and expose selection callbacks. Business edge creation remains disabled:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  nodesConnectable={false}
  elementsSelectable
  selectionOnDrag
  panOnDrag={[1,2]}
  onNodeClick={(_,node)=>onSelectNode(node.id)}
  fitView
>
  <Background gap={16} size={1}/>
  <Controls/>
  <MiniMap pannable zoomable/>
</ReactFlow>
```

- [ ] **Step 5: Add scoped visual styles**

Use existing design tokens. Keep cards at `6px` radius, stable dimensions, explicit thumbnail aspect ratios, and no nested decorative cards.

- [ ] **Step 6: Run component tests and build**

Run:

```bash
cd apps/web
npm test -- --run tests/production-canvas.test.tsx tests/production-canvas-model.test.ts
npm run build
```

Expected: tests and TypeScript build pass.

---

### Task 7: Add Selection, Highlighting, and Inspector

**Files:**
- Create: `apps/web/components/production-canvas/ProductionCanvasInspector.tsx`
- Modify: `apps/web/components/production-canvas/ProductionCanvas.tsx`
- Modify: `apps/web/lib/production-canvas.ts`
- Modify: `apps/web/tests/production-canvas.test.tsx`

- [ ] **Step 1: Write failing selection tests**

```tsx
it('selecting a shot expands only its local production chain', async()=>{
  const user=userEvent.setup();
  render(<ProductionCanvas graph={fixture} selectedShotId={null} onSelectShot={vi.fn()}/>);
  await user.click(screen.getByRole('button',{name:/镜头 02/}));
  expect(screen.getByRole('complementary',{name:'生产节点检查器'})).toHaveTextContent('镜头 02');
  expect(screen.getByRole('button',{name:/画面/})).toBeVisible();
  expect(screen.queryByRole('button',{name:/镜头 01 画面/})).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify RED**

Expected: no inspector and no local expansion.

- [ ] **Step 3: Implement upstream/downstream highlighting**

Add a pure function:

```typescript
export function highlightProductionGraph(
  nodes:ProductionCanvasNode[],
  edges:ProductionCanvasEdge[],
  selectedNodeId:string|null,
) {
  const connected=new Set<string>(selectedNodeId?[selectedNodeId]:[]);
  const queue=selectedNodeId?[selectedNodeId]:[];
  while(queue.length){
    const current=queue.shift()!;
    for(const edge of edges){
      if(edge.source!==current&&edge.target!==current) continue;
      const next=edge.source===current?edge.target:edge.source;
      if(!connected.has(next)){connected.add(next);queue.push(next);}
    }
  }
  return {
    nodes:nodes.map(node=>({...node,data:{...node.data,dimmed:Boolean(selectedNodeId&&!connected.has(node.id))}})),
    edges:edges.map(edge=>({...edge,animated:connected.has(edge.source)&&connected.has(edge.target)})),
  };
}
```

- [ ] **Step 4: Implement the inspector sections**

Render status, inputs, effective overrides, downstream impact, workflow binding, errors, and version history only when present. Commands must be passed as callbacks; the inspector must not call API modules directly.

- [ ] **Step 5: Run selection tests**

Expected: selected node expands, connected edges highlight, inspector content is correct.

---

### Task 8: Add ELK Auto-Layout and Persistence

**Files:**
- Create: `apps/web/components/production-canvas/ProductionCanvasToolbar.tsx`
- Modify: `apps/web/lib/production-canvas.ts`
- Modify: `apps/web/components/production-canvas/ProductionCanvas.tsx`
- Modify: `apps/web/tests/production-canvas-model.test.ts`
- Modify: `apps/web/tests/production-canvas.test.tsx`

- [ ] **Step 1: Write failing auto-layout and persistence tests**

Require scene group compound layout, stable manual positions, new-node placement, and one-step auto-layout undo:

```typescript
it('preserves saved shot positions while auto-placing a new shot', async()=>{
  const laidOut=await layoutProductionGraph(graph,{saved:{
    version:1,viewport:{x:0,y:0,zoom:.75},nodes:{'shot:shot-1':{x:420,y:160}},expanded_shots:[],pinned_shots:[],
  }});
  expect(laidOut.find(node=>node.id==='shot:shot-1')?.position).toEqual({x:420,y:160});
  expect(laidOut.find(node=>node.id==='shot:shot-2')?.position.x).toBeGreaterThan(0);
});

it('restores the pre-layout positions before persistence', async()=>{
  const history=createLayoutHistory(graph.nodes);
  const laidOut=await layoutProductionGraph(graph,{saved:null});
  history.push(laidOut);
  expect(history.undo()).toEqual(graph.nodes);
});
```

- [ ] **Step 2: Run to verify RED**

Expected: `layoutProductionGraph` is missing.

- [ ] **Step 3: Implement ELK compound layout**

Use scene groups as ELK parent nodes. Layout shared assets in a left column, scene groups in episode order, peer shots inside each scene, and expanded downstream nodes to the right of their shot.

Use fixed node sizes from node definitions so edge handles remain stable.

Capture the current node positions and viewport before applying auto-layout. Expose one-step undo until the debounced save succeeds; undo restores both positions and viewport and cancels the pending layout save.

- [ ] **Step 4: Implement debounced save**

Persist on node drag stop, viewport change end, expansion change, pin change, and accepted auto-layout. Debounce 500 ms and discard stale episode requests with a generation counter or abort controller. Do not persist an auto-layout while its undo window is active.

- [ ] **Step 5: Add toolbar commands**

Provide selection, pan hint, box selection, auto-layout, undo layout, zoom controls, fit episode, fit selected scene, fit selected shot, minimap toggle, and task drawer toggle. Use Lucide icons and tooltips.

Add semantic zoom thresholds to the canvas composition: low zoom shows scene labels and compact shot summaries; normal zoom shows thumbnails and four stage indicators; expanded downstream nodes remain visible for selected, pinned, running, failed, or blocked shots.

- [ ] **Step 6: Run layout tests and build**

Expected: saved positions survive, new nodes auto-place, auto-layout can be undone before persistence, semantic zoom does not resize node bounds, and build passes.

---

### Task 9: Preserve Production Commands in Nodes and Task Drawer

**Files:**
- Create: `apps/web/components/production-canvas/ProductionTaskDrawer.tsx`
- Modify: `apps/web/components/ProductionPanel.tsx`
- Modify: `apps/web/components/ProductionItemRow.tsx`
- Modify: `apps/web/components/production-canvas/ProductionCanvasInspector.tsx`
- Modify: `apps/web/tests/production-panel.test.tsx`
- Modify: `apps/web/tests/production-canvas.test.tsx`

- [ ] **Step 1: Add failing regression tests for existing commands**

Keep payload assertions for:

```typescript
expect(createProductionRun).toHaveBeenCalledWith('episode-1',{
  stages:['panels','speech'],
  concurrency:2,
  regenerate_panels:false,
  regenerate_speech:false,
  regenerate_videos:false,
});
```

Also assert pause, continue, failed-item selection, retry, and episode-switch cancellation still behave exactly as before.

- [ ] **Step 2: Run to verify the new canvas composition is not wired**

Expected: new task drawer and inspector command tests fail.

- [ ] **Step 3: Refactor `ProductionPanel` into orchestration plus canvas**

Keep existing effects and command functions. Replace the old JSX with:

```tsx
return <main className="production-workbench">
  <ProductionCanvas
    graph={graph}
    layout={layout}
    run={displayedRun}
    items={displayedItems}
    selectedShotId={selectedShotId}
    onSelectShot={onSelectTarget}
    onStart={start}
    onPause={pause}
    onResume={resume}
    onRetry={retry}
  />
  <ProductionTaskDrawer
    open={taskDrawerOpen}
    run={displayedRun}
    items={visible}
    selected={selected}
    filter={filter}
    onFilter={setFilter}
    onSelect={setSelected}
    onOpenTarget={onSelectTarget}
  />
</main>;
```

- [ ] **Step 4: Move production configuration into inspector/toolbar**

Stages, concurrency, and regenerate toggles stay feature-complete. They appear in a compact run configuration popover opened by the primary production command, not as a permanent page section.

- [ ] **Step 5: Run production regression tests**

Expected: existing payload, polling, pause, retry, and stale-request tests pass with the new UI.

---

### Task 10: Add Workflow Binding Presentation

**Files:**
- Modify: `apps/web/components/production-canvas/ProductionCanvasInspector.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/tests/production-canvas.test.tsx`

- [ ] **Step 1: Write failing workflow-binding tests**

```tsx
it('shows the versioned workflow bound to a panel node',()=>{
  render(<ProductionCanvasInspector node={panelNodeWithWorkflow} />);
  expect(screen.getByText('动漫竖屏画面')).toBeVisible();
  expect(screen.getByText('工作流 v3 · 输入映射 v1')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify RED**

Expected: workflow metadata is not rendered.

- [ ] **Step 3: Render bindings without executing ComfyUI**

Panel and video inspectors display workflow name, workflow version, mapping version, enabled state, and an `编辑工作流` command callback. If no binding exists, show `未绑定工作流` and disable execution that specifically requires ComfyUI.

- [ ] **Step 4: Preserve current providers**

Do not reroute existing `PanelService` or `VideoService` in this task. The binding is metadata and UI contract only.

- [ ] **Step 5: Run component tests**

Expected: binding display and missing-binding states pass.

---

### Task 11: Browser Geometry and Responsive Verification

**Files:**
- Create: `apps/web/e2e/production-canvas.spec.ts`
- Modify: `apps/web/playwright.config.ts` only if the existing configuration cannot reuse the running app.
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Write failing browser tests**

Test desktop and tablet:

```typescript
test('edges stay attached to handles after drag and resize',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'单集制作'}).click();
  await page.getByRole('tab',{name:'生产'}).click();
  const source=page.locator('[data-handleid="shot-output"]').first();
  const target=page.locator('[data-handleid="panel-input"]').first();
  const before=await Promise.all([source.boundingBox(),target.boundingBox()]);
  await page.getByRole('button',{name:/镜头 02/}).dragTo(page.locator('.react-flow__pane'),{targetPosition:{x:620,y:260}});
  const edge=page.locator('.react-flow__edge.selected-dependency path').first();
  await expect(edge).toBeVisible();
  expect(before[0]).not.toBeNull();
});
```

Also test nonblank canvas pixels, no page-level horizontal overflow, fit-view, inspector drawer, minimap toggle, and tablet read/write behavior.

- [ ] **Step 2: Run to verify RED**

Run:

```bash
cd apps/web
npm run test:e2e -- production-canvas.spec.ts
```

Expected: failures until the final selectors and geometry are available.

- [ ] **Step 3: Fix layout constraints, not test thresholds**

Set stable canvas dimensions, inspector widths, node sizes, and internal overflow. The page shell must never become wider than the viewport.

- [ ] **Step 4: Run browser tests at 1440x1000, 1024x768, and 480x900**

At 480px the canvas is read-only, inspector is a drawer, and node dragging is disabled. Pan, zoom, selection, and focus remain available.

---

### Task 12: Full Verification and Old Layout Removal

**Files:**
- Modify: `apps/web/components/ProductionPanel.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `docs/codegraph-architecture.md`

- [ ] **Step 1: Remove obsolete permanent form/list layout markup**

Delete old `production-config`, permanent `production-options`, permanent `production-queue`, and page-level filter layout only after the task drawer and run configuration popover cover every command.

- [ ] **Step 2: Remove orphaned CSS selectors**

Run:

```bash
rg -n "production-config|production-options|production-queue|production-filters" apps/web
```

Expected: only intentional compatibility references remain; delete unused selectors.

- [ ] **Step 3: Run all Web verification**

```bash
cd apps/web
npm test
npm run build
npm run test:e2e -- production-canvas.spec.ts
```

Expected: all unit/component tests, production build, and canvas browser tests pass.

- [ ] **Step 4: Run all API verification**

```bash
cd services/api
pytest -q
```

Expected: the complete API suite passes with no new warnings beyond the existing Starlette/httpx warning.

- [ ] **Step 5: Run repository checks**

```bash
cd /Users/shengzhoukong/Documents/AI漫剧/ai-comic-studio
git diff --check
codegraph sync .
codegraph status .
```

Expected: clean whitespace check and an up-to-date CodeGraph index.

- [ ] **Step 6: Review the final diff without committing**

Inspect all changed paths, verify the LocalMiniDrama attribution remains present, confirm no unrelated user changes were modified, and hand the result to the user for browser acceptance.

---

## Follow-Up Plan Required

After this canvas is accepted, create a separate ComfyUI execution plan covering:

- Workflow JSON storage and validation.
- Input mapping from character references, asset variants, director previews, prompts, masks, and dimensions.
- `/prompt` submission and websocket progress.
- Queue/history/cancel support.
- Output file ingestion into the existing `Asset` and version systems.
- Sanitized failure mapping into `ModelRuntimeError`.
- Workflow editor isolation and permissions.

This separation keeps the canvas deliverable independently usable with current providers.
