import asyncio
from datetime import UTC, datetime
from time import perf_counter
from urllib.parse import urlsplit

from sqlalchemy import func, select

from comic_studio import models
from comic_studio.jobs import JobStore
from comic_studio.model_runtime.adapters import ProviderRegistry
from comic_studio.model_runtime.contracts import Capability, TextStreamRequest
from comic_studio.model_runtime.errors import classify_provider_error
from comic_studio.model_runtime.repository import InvocationRepository
from comic_studio.provider_channels import ProviderChannel, ProviderChannels
from comic_studio.schemas import ProviderChannelUpdate
from comic_studio.redaction import redact
from comic_studio.services.provider_channel_testing import (
    ProviderChannelTestingService,
    default_client_factory,
)
from comic_studio.services.provider_selector import Candidate, ProviderSelector
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.character_reference_sets import (
    CharacterReferenceSetError,
    CharacterReferenceSetService,
)
from comic_studio.services.panels import PanelService
from comic_studio.services.library_assets import LibraryAssetService
from comic_studio.services.speech import SpeechService
from comic_studio.services.videos import VideoService
from comic_studio.services.visual_review import VisualReviewService
from comic_studio.services.model_3d import Model3DGenerationService
from comic_studio.services.model_3d_postprocess import Model3DPostProcessor


provider_testing_client_factory = default_client_factory
provider_testing_total_timeout_seconds = 8
provider_testing_tts_timeout_seconds = 60
provider_testing_video_timeout_seconds = 30
sanitize_provider_error = ProviderChannelTestingService._sanitize_error


class ModelRuntimeService:
    _channel_names = {
        Capability.TEXT: "llm",
        Capability.IMAGE: "image",
        Capability.SPEECH: "tts",
        Capability.VIDEO: "video",
        Capability.MODEL_3D: "model3d",
    }

    def __init__(
        self,
        channel_store,
        session_factory,
        data_root,
        adapters,
        *,
        mock_ssh_manager=None,
        narrator_speaker: str = "dylan",
        model3d_postprocessor_factory=Model3DPostProcessor,
    ):
        self.channel_store = channel_store
        self.session_factory = session_factory
        self.data_root = data_root
        self.adapters = adapters
        self.mock_ssh_manager = mock_ssh_manager
        self.narrator_speaker = narrator_speaker
        self.model3d_postprocessor_factory = model3d_postprocessor_factory

    @staticmethod
    def _adapter_identity(adapter) -> tuple[str, str]:
        provider = adapter.__class__.__name__.removesuffix("Provider").casefold()
        return provider, str(getattr(adapter, "model", ""))

    def _safe_channel(self, capability: Capability) -> ProviderChannel | None:
        """Look up the configured channel for ``capability``; None if unavailable.

        Defensively returns None when ``channel_store`` is absent (e.g. in some
        unit tests) so decision-log construction never breaks the request path.
        """
        if self.channel_store is None:
            return None
        try:
            return getattr(self.channel_store.snapshot, self._channel_names[capability])
        except (AttributeError, KeyError):
            return None

    def _build_decision_log(
        self,
        capability: Capability,
        adapter,
        channel: ProviderChannel | None = None,
    ) -> dict:
        """Provenance record explaining why a particular provider was chosen.

        When more than one candidate is registered for a capability, the
        ``ProviderSelector`` scores each candidate using recent invocation
        history and the winner is recorded as ``selected``. The score breakdown
        is persisted so operators can audit the choice.
        """
        selected_provider, selected_model = self._adapter_identity(adapter)
        candidates: list[dict] = []
        registry: ProviderRegistry | None = getattr(
            getattr(self.adapters, "provider_factory", None),
            "_registry",
            None,
        )
        if isinstance(registry, ProviderRegistry) and capability in registry:
            for registration in registry.registrations():
                if registration.capability != capability:
                    continue
                provider_class = registration.provider_class
                provider_name = provider_class.__name__.removesuffix("Provider").casefold()
                candidates.append(
                    {
                        "provider": provider_name,
                        "module": registration.module_name,
                        "selected": provider_name == selected_provider,
                    }
                )

        channel_payload: dict | None = None
        if channel is not None:
            channel_payload = {
                "name": channel.name,
                "model": channel.model,
                "base_url": channel.base_url,
            }

        # M4.2: score candidates when multiple providers are available.
        if len(candidates) > 1 and self.session_factory is not None and channel_payload is not None:
            selector_candidates = [
                Candidate(
                    provider=c["provider"],
                    model=channel_payload["model"],
                    module=c["module"],
                    channel=channel_payload,
                    selected=c["selected"],
                )
                for c in candidates
            ]
            with self.session_factory() as session:
                result = ProviderSelector(session).select(capability, selector_candidates)
            selected = {
                "provider": result.selected.provider,
                "model": result.selected.model,
            }
            reason = result.reason
            scores = result.scores
            totals = result.totals
            candidates = [
                {
                    "provider": c.provider,
                    "module": c.module,
                    "selected": c.selected,
                }
                for c in selector_candidates
            ]
        else:
            selected = {"provider": selected_provider, "model": selected_model}
            reason = "single-registered-provider"
            scores = {}
            totals = {}

        return {
            "selected": selected,
            "candidates": candidates,
            "reason": reason,
            "scores": scores,
            "totals": totals,
            "channel": channel_payload,
            "decided_at": datetime.now(UTC).isoformat(),
        }

    async def stream_text(self, request: TextStreamRequest):
        adapter = self.adapters.create(Capability.TEXT)
        provider, model = self._adapter_identity(adapter)
        channel = self._safe_channel(Capability.TEXT)
        decision_log = self._build_decision_log(Capability.TEXT, adapter, channel)
        with self.session_factory() as session:
            invocation = InvocationRepository(session).start(
                Capability.TEXT, provider, model, decision_log=decision_log
            )
        started = perf_counter()
        try:
            async for chunk in adapter.stream_script(request.context):
                yield chunk
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="succeeded",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                )
        except Exception as error:
            runtime_error = classify_provider_error(
                error, Capability.TEXT, provider
            )
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="failed",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                    error_code=runtime_error.code.value,
                    retryable=runtime_error.retryable,
                )
            raise runtime_error from error

    async def plan_episode(self, context: dict):
        return await self.adapters.create(Capability.TEXT).plan_episode(context)

    async def suggest_asset_variant(self, context: dict):
        adapter = self.adapters.create(Capability.TEXT)
        provider, model = self._adapter_identity(adapter)
        channel = self._safe_channel(Capability.TEXT)
        decision_log = self._build_decision_log(Capability.TEXT, adapter, channel)
        with self.session_factory() as session:
            invocation = InvocationRepository(session).start(
                Capability.TEXT,
                provider,
                model,
                target_type="character",
                target_id=str(context.get("character_id", "")),
                decision_log=decision_log,
            )
        started = perf_counter()
        try:
            result = await adapter.suggest_asset_variant(context)
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="succeeded",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                )
            return result
        except Exception as error:
            runtime_error = classify_provider_error(error, Capability.TEXT, provider)
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="failed",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                    error_code=runtime_error.code.value,
                    retryable=runtime_error.retryable,
                )
            raise runtime_error from error

    async def parse_script_import(self, context: dict):
        return await self.adapters.create(Capability.TEXT).parse_script_import(context)

    async def extract_chapter_events(self, context: dict):
        adapter = self.adapters.create(Capability.TEXT)
        provider, model = self._adapter_identity(adapter)
        channel = self._safe_channel(Capability.TEXT)
        decision_log = self._build_decision_log(Capability.TEXT, adapter, channel)
        with self.session_factory() as session:
            invocation = InvocationRepository(session).start(
                Capability.TEXT,
                provider,
                model,
                target_type="script_chapter",
                target_id=str(context.get("chapter_id", "")),
                decision_log=decision_log,
            )
        started = perf_counter()
        try:
            result = await adapter.extract_chapter_events(context)
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="succeeded",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                )
            return result
        except Exception as error:
            runtime_error = classify_provider_error(error, Capability.TEXT, provider)
            with self.session_factory() as session:
                InvocationRepository(session).finish(
                    invocation.id,
                    status="failed",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                    error_code=runtime_error.code.value,
                    retryable=runtime_error.retryable,
                )
            raise runtime_error from error

    async def execute_image(
        self,
        target_type: str,
        target_id: str,
        request_payload: dict,
        *,
        on_progress=None,
        resume: dict | None = None,
    ):
        provider = self.adapters.create(Capability.IMAGE)
        with self.session_factory() as session:
            if target_type == "visual_review":
                candidate = await VisualReviewService(session).generate_candidate(
                    target_id, self.data_root, provider
                )
                if candidate is None:
                    raise KeyError(target_id)
                asset = session.get(models.Asset, candidate.asset_id)
                return {
                    "capability": Capability.IMAGE.value,
                    "asset_id": asset.id,
                    "candidate_id": candidate.id,
                    "thread_id": candidate.thread_id,
                    "media_url": f"/media/{asset.local_path}",
                }
            if target_type == "shot":
                return await PanelService(
                    session, self.data_root, provider
                ).generate_panel(
                    target_id,
                    activate=bool(request_payload.get("activate", True)),
                )
            if target_type == "grid_panel":
                shot_ids = [sid for sid in target_id.split(",") if sid]
                return await PanelService(
                    session, self.data_root, provider
                ).generate_grid_panels(
                    shot_ids,
                    activate=bool(request_payload.get("activate", True)),
                )
            if target_type == "library_asset":
                library_asset = session.get(models.LibraryAsset, target_id)
                if library_asset is None:
                    raise KeyError(target_id)
                if library_asset.kind != "scene":
                    raise ValueError("library_asset_image_requires_scene")
                project = session.get(models.Project, library_asset.project_id)
                prompt = (
                    "Create a canonical wide establishing reference image for an AI comic production scene.\n"
                    f"Project visual style: {project.visual_style}.\n"
                    f"Scene name: {library_asset.name}.\n"
                    f"Scene description: {library_asset.description or 'Use the scene name as the core setting.'}.\n"
                    f"Tags: {', '.join(library_asset.tags) or 'none'}.\n"
                    "Show the environment, architecture, lighting, weather, spatial layout, and reusable continuity landmarks. "
                    "Do not add captions, typography, watermarks, UI, contact sheets, or character close-ups."
                )
                result = await provider.generate(prompt, "1536x1024")
                stored = LibraryAssetService(session).upload_media(
                    library_asset.id,
                    result.content,
                    filename="ai-scene-reference.png",
                    data_root=self.data_root,
                    provider="gpt-image",
                    model=provider.model,
                    request_metadata={"prompt": prompt, "size": "1536x1024"},
                )
                media = stored.media_asset
                return {
                    "capability": Capability.IMAGE.value,
                    "library_asset_id": stored.id,
                    "asset_id": media.id,
                    "media_url": f"/media/{media.local_path}",
                    "media_type": media.media_type,
                }
            if request_payload.get("mode") == "reference_set":
                if on_progress is None:
                    raise ValueError("reference_set progress callback is required")
                return await CharacterReferenceSetService(
                    session, self.data_root
                ).generate(
                    target_id,
                    provider,
                    on_progress=on_progress,
                    resume=resume or {},
                )
            return await CharacterReferenceService(
                session, self.data_root
            ).generate(
                target_id,
                str(request_payload.get("reference_type", "primary")),
                str(request_payload.get("label", "")),
                provider,
            )

    async def execute_speech(self, dialogue_id: str):
        with self.session_factory() as session:
            return await SpeechService(
                session,
                self.data_root,
                self.adapters.create(Capability.SPEECH),
                narrator_speaker=self.narrator_speaker,
            ).synthesize_dialogue(dialogue_id)

    async def execute_video(self, shot_id: str, activate: bool):
        with self.session_factory() as session:
            return await VideoService(
                session,
                self.data_root,
                self.adapters.create(Capability.VIDEO),
            ).generate(shot_id, activate=activate)

    async def execute_model3d(
        self,
        target_type: str,
        target_id: str,
        reference_asset_id: str | None,
        variant_id: str | None = None,
        state_id: str | None = None,
        reference_asset_ids: list[str] | None = None,
    ):
        with self.session_factory() as session:
            return await Model3DGenerationService(
                session,
                self.data_root,
                self.adapters.create(Capability.MODEL_3D),
                self.model3d_postprocessor_factory(self.data_root),
            ).generate(
                target_type,
                target_id,
                reference_asset_id,
                variant_id,
                state_id,
                reference_asset_ids,
            )

    def create_media_job(
        self,
        capability: Capability,
        target_type: str,
        target_id: str,
        request_payload: dict,
    ):
        self.adapters.create(capability)
        with self.session_factory() as session:
            return JobStore(session).create(
                f"runtime_{capability.value}",
                target_type,
                target_id,
                {"capability": capability.value, **request_payload},
            )

    @staticmethod
    def _result_metadata(capability: Capability, result) -> dict:
        if isinstance(result, dict):
            return result
        asset = result[1] if isinstance(result, tuple) else result
        metadata = {
            "capability": capability.value,
            "asset_id": asset.id,
            "media_url": f"/media/{asset.local_path}",
        }
        return metadata

    async def run_media_job(self, job_id: str) -> None:
        with self.session_factory() as session:
            store = JobStore(session)
            job = store.transition(job_id, "running", progress=5)
            capability = Capability(job.request_payload["capability"])
            adapter = self.adapters.create(capability)
            provider, model = self._adapter_identity(adapter)
            channel = self._safe_channel(capability)
            decision_log = self._build_decision_log(capability, adapter, channel)
            invocation = InvocationRepository(session).start(
                capability,
                provider,
                model,
                job.target_type,
                job.target_id,
                job.id,
                decision_log=decision_log,
            )
        started = perf_counter()
        try:
            if capability is Capability.IMAGE:
                async def update_image_progress(metadata: dict) -> None:
                    current = int(metadata.get("current_index", 0))
                    total = max(1, int(metadata.get("total", 1)))
                    with self.session_factory() as progress_session:
                        JobStore(progress_session).update_progress(
                            job.id,
                            progress=round(current / total * 100),
                            result_metadata=metadata,
                        )

                result = await self.execute_image(
                    job.target_type,
                    job.target_id,
                    job.request_payload,
                    on_progress=update_image_progress,
                    resume=job.result_metadata,
                )
            elif capability is Capability.SPEECH:
                result = await self.execute_speech(job.target_id)
            elif capability is Capability.MODEL_3D:
                result = await self.execute_model3d(
                    job.target_type,
                    job.target_id,
                    job.request_payload.get("reference_asset_id"),
                    job.request_payload.get("variant_id"),
                    job.request_payload.get("state_id"),
                    job.request_payload.get("reference_asset_ids"),
                )
            else:
                result = await self.execute_video(
                    job.target_id,
                    bool(job.request_payload.get("activate", True)),
                )
            with self.session_factory() as session:
                JobStore(session).transition(
                    job.id,
                    "succeeded",
                    result_metadata=self._result_metadata(capability, result),
                )
                InvocationRepository(session).finish(
                    invocation.id,
                    status="succeeded",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                )
        except Exception as error:
            batch_metadata = {}
            classified_error = error
            if isinstance(error, CharacterReferenceSetError):
                batch_metadata = {
                    **error.metadata,
                    "provider_error": str(redact(str(error.__cause__ or error)))[:1000],
                }
                classified_error = error.__cause__ or error
            runtime_error = classify_provider_error(
                classified_error, capability, provider
            )
            with self.session_factory() as session:
                JobStore(session).transition(
                    job.id,
                    "failed",
                    error=runtime_error.message,
                    result_metadata={
                        **batch_metadata,
                        "capability": capability.value,
                        "error_code": runtime_error.code.value,
                        "retryable": runtime_error.retryable,
                    },
                )
                InvocationRepository(session).finish(
                    invocation.id,
                    status="failed",
                    elapsed_ms=round((perf_counter() - started) * 1000),
                    error_code=runtime_error.code.value,
                    retryable=runtime_error.retryable,
                )

    def list_invocations(self, limit: int = 50) -> list[models.ModelInvocation]:
        with self.session_factory() as session:
            return InvocationRepository(session).list_recent(limit)

    @staticmethod
    def _masked_key(value: str | None) -> str:
        if not value:
            return ""
        return "*" * len(value) if len(value) <= 8 else f"{value[:3]}****{value[-4:]}"

    def _channel_read(self, channel: ProviderChannel) -> dict:
        api_key = channel.api_key_value
        return {
            "name": channel.name,
            "enabled": channel.enabled,
            "base_url": channel.base_url,
            "model": channel.model,
            "ssh_host": channel.ssh_host or "",
            "api_key_configured": bool(api_key),
            "api_key_masked": self._masked_key(api_key),
        }

    def _read_channel_state(self, state) -> dict:
        result = {
            capability.value: self._channel_read(
                getattr(state.channels, channel_name)
            )
            for capability, channel_name in self._channel_names.items()
        }
        result["persistence"] = {
            "status": "saved" if state.persisted else "defaults"
        }
        result["reloaded_at"] = state.reloaded_at
        return result

    def read_channels(self) -> dict:
        return self._read_channel_state(self.channel_store.state)

    def update_channel(
        self, capability: Capability, update: ProviderChannelUpdate
    ) -> dict:
        channel_name = self._channel_names[capability]

        def merge(snapshot: ProviderChannels) -> ProviderChannels:
            current = getattr(snapshot, channel_name)
            replacement_key = update.api_key.get_secret_value()
            effective_key = (
                None
                if update.clear_api_key
                else replacement_key or current.api_key_value
            )
            if capability in {Capability.TEXT, Capability.IMAGE, Capability.MODEL_3D} and update.enabled and not effective_key:
                raise ValueError(f"Enabled {capability.value} channel requires an api_key")
            if capability not in {Capability.SPEECH, Capability.VIDEO} and update.ssh_host:
                raise ValueError("ssh_host is only valid for speech and video")
            channel = ProviderChannel(
                name=update.name,
                enabled=update.enabled,
                base_url=update.base_url,
                model=update.model,
                api_key=effective_key,
                ssh_host=(update.ssh_host or None)
                if capability in {Capability.SPEECH, Capability.VIDEO}
                else None,
            )
            return ProviderChannels.model_validate(
                snapshot.model_copy(
                    update={channel_name: channel}
                ).model_dump(mode="python")
            )

        committed = self.channel_store.update(merge)
        return self._read_channel_state(committed)

    async def test_channel(
        self, capability: Capability, update: ProviderChannelUpdate
    ) -> dict:
        kind = self._channel_names[capability]
        service = ProviderChannelTestingService(
            stored_channel=lambda name: getattr(self.channel_store.snapshot, name),
            client_factory=provider_testing_client_factory,
            prefer_ssh_for_host=lambda alias: bool(
                self.mock_ssh_manager
                and getattr(self.mock_ssh_manager, "owns_running_alias", lambda _alias: False)(alias)
            ),
            total_timeout_seconds=(
                provider_testing_tts_timeout_seconds
                if capability is Capability.SPEECH
                else provider_testing_video_timeout_seconds
                if capability is Capability.VIDEO
                else provider_testing_total_timeout_seconds
            ),
        )
        channel = service.resolve_candidate(kind, update)
        service.validate_channel(kind, channel)
        result = await service.test(kind, channel)
        return result.model_dump(mode="json") if hasattr(result, "model_dump") else result

    def _last_invocation_ms(self, capability: Capability) -> int | None:
        with self.session_factory() as session:
            statement = (
                select(models.ModelInvocation.elapsed_ms)
                .where(
                    models.ModelInvocation.capability == capability.value,
                    models.ModelInvocation.status == "succeeded",
                )
                .order_by(models.ModelInvocation.created_at.desc())
                .limit(1)
            )
            return session.scalar(statement)

    async def _capability_health(self, capability: Capability, snapshot: ProviderChannels) -> dict:
        channel_name = self._channel_names[capability]
        channel = getattr(snapshot, channel_name)
        base = {
            "model": channel.model,
            "host": urlsplit(channel.base_url).hostname or "local",
            "last_invocation_elapsed_ms": self._last_invocation_ms(capability),
        }
        if not channel.enabled:
            return {**base, "status": "disabled", "elapsed_ms": 0, "error": None}
        prefer_ssh = False
        if capability in {Capability.SPEECH, Capability.VIDEO} and channel.ssh_host:
            lookup = getattr(self.mock_ssh_manager, "owns_running_alias", None)
            if lookup:
                try:
                    prefer_ssh = bool(await asyncio.to_thread(lookup, channel.ssh_host))
                except Exception:
                    prefer_ssh = False
        try:
            service = ProviderChannelTestingService(
                stored_channel=lambda name: getattr(snapshot, name),
                client_factory=provider_testing_client_factory,
                prefer_ssh_for_host=lambda _alias: prefer_ssh,
                total_timeout_seconds=(
                    provider_testing_tts_timeout_seconds
                    if capability is Capability.SPEECH
                    else provider_testing_video_timeout_seconds
                    if capability is Capability.VIDEO
                    else provider_testing_total_timeout_seconds
                ),
            )
            result = await service.test(channel_name, channel)
            return {**base, "status": "healthy" if result.status == "ok" else "unavailable", "elapsed_ms": result.elapsed_ms, "error": result.error}
        except Exception as error:
            return {**base, "status": "unavailable", "elapsed_ms": 0, "error": sanitize_provider_error(error)}

    def _infrastructure(self) -> dict:
        mock_status = self.mock_ssh_manager.status() if self.mock_ssh_manager else None
        if hasattr(mock_status, "model_dump"):
            mock_payload = mock_status.model_dump(mode="json")
        else:
            mock_payload = {
                "state": "failed",
                "error": "Mock SSH manager is unavailable",
            }
        with self.session_factory() as session:
            rows = dict(
                session.execute(
                    select(models.Job.status, func.count(models.Job.id))
                    .where(models.Job.operation.like("runtime_%"))
                    .group_by(models.Job.status)
                ).all()
            )
        return {
            "api": {"status": "healthy"},
            "mock_ssh": mock_payload,
            "queue": {
                "queued": int(rows.get("queued", 0)),
                "running": int(rows.get("running", 0)),
            },
            "persistence": self.read_channels()["persistence"],
        }

    async def health(self) -> dict:
        capabilities = list(Capability)
        snapshot = self.channel_store.snapshot
        results = await asyncio.gather(
            *(self._capability_health(capability, snapshot) for capability in capabilities)
        )
        return {
            "capabilities": {
                capability.value: result
                for capability, result in zip(capabilities, results, strict=True)
            },
            "infrastructure": self._infrastructure(),
            "checked_at": datetime.now(UTC).isoformat(),
        }

    def get_job(self, job_id: str):
        with self.session_factory() as session:
            job = JobStore(session).get(job_id)
            if job is None:
                raise KeyError(job_id)
            session.expunge(job)
            return job

    def latest_model3d_job(
        self,
        target_type: str,
        target_id: str,
        variant_id: str | None = None,
        state_id: str | None = None,
    ):
        with self.session_factory() as session:
            jobs = list(
                session.scalars(
                    select(models.Job)
                    .where(
                        models.Job.operation == "runtime_model3d",
                        models.Job.target_type == target_type,
                        models.Job.target_id == target_id,
                    )
                    .order_by(models.Job.created_at.desc(), models.Job.id.desc())
                )
            )
            job = next(
                (
                    item
                    for item in jobs
                    if item.request_payload.get("variant_id") == variant_id
                    and item.request_payload.get("state_id") == state_id
                ),
                None,
            )
            if job is not None:
                session.expunge(job)
            return job

    def retry_job(self, job_id: str):
        with self.session_factory() as session:
            store = JobStore(session)
            job = store.get(job_id)
            if job is None:
                raise KeyError(job_id)
            preserve = (
                job.operation == "runtime_image"
                and job.request_payload.get("mode") == "reference_set"
            )
            retried = store.requeue(
                job.id, preserve_result_metadata=preserve
            )
            session.expunge(retried)
            return retried

    def approve_model3d_job(self, job_id: str) -> dict:
        with self.session_factory() as session:
            job = JobStore(session).get(job_id)
            if job is None:
                raise KeyError(job_id)
            if (
                job.operation != "runtime_model3d"
                or job.request_payload.get("capability") != Capability.MODEL_3D.value
            ):
                raise ValueError("job_is_not_model3d")
            if job.status != "succeeded":
                raise ValueError("model3d_candidate_not_ready")
            approved = Model3DGenerationService.approve(
                session,
                job.target_type,
                job.target_id,
                job.result_metadata,
            )
            job.result_metadata = approved
            session.commit()
            return approved

    def recover_interrupted_jobs(self) -> list[str]:
        with self.session_factory() as session:
            return InvocationRepository(session).recover_running_jobs()
