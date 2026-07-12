from __future__ import annotations

from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.services.script_files import ScriptFileStore


class ScriptRevisionConflict(RuntimeError):
    def __init__(self, latest_checksum: str):
        super().__init__("revision_conflict")
        self.latest_checksum = latest_checksum


class ScriptDocumentHasEpisodes(RuntimeError):
    def __init__(self, episodes: list[tuple[str, str]]):
        super().__init__("script_has_episodes")
        self.episodes = episodes


def _checksum(content: str) -> str:
    return sha256(content.encode()).hexdigest()


class ScriptDocumentService:
    def __init__(
        self, session: Session, file_store: ScriptFileStore | None = None
    ):
        self.session = session
        self.file_store = file_store

    def _load(self, document_id: str) -> models.ScriptDocument:
        document = self.session.scalar(
            select(models.ScriptDocument)
            .options(selectinload(models.ScriptDocument.revisions))
            .where(models.ScriptDocument.id == document_id)
            .execution_options(populate_existing=True)
        )
        if document is None:
            raise KeyError(document_id)
        return document

    @staticmethod
    def _current(document: models.ScriptDocument) -> models.ScriptRevision:
        revision = next(
            (
                item
                for item in document.revisions
                if item.id == document.current_revision_id
            ),
            None,
        )
        if revision is None:
            raise RuntimeError("current_revision_missing")
        return revision

    def create(
        self,
        project_id: str,
        title: str,
        source_type: str,
        content: str,
        creation_method: str,
    ) -> models.ScriptDocument:
        if self.session.get(models.Project, project_id) is None:
            raise KeyError(project_id)
        document = models.ScriptDocument(
            project_id=project_id,
            title=title.strip() or "未命名剧本",
            source_type=source_type,
        )
        self.session.add(document)
        self.session.flush()
        revision = models.ScriptRevision(
            document_id=document.id,
            revision_number=1,
            status="working",
            content=content,
            checksum=_checksum(content),
            creation_method=creation_method,
        )
        self.session.add(revision)
        self.session.flush()
        document.current_revision_id = revision.id
        self.session.commit()
        return self._load(document.id)

    def list_for_project(self, project_id: str) -> list[models.ScriptDocument]:
        return list(
            self.session.scalars(
                select(models.ScriptDocument)
                .options(selectinload(models.ScriptDocument.revisions))
                .where(models.ScriptDocument.project_id == project_id)
                .order_by(
                    models.ScriptDocument.updated_at.desc(),
                    models.ScriptDocument.created_at.desc(),
                )
            ).all()
        )

    def get(self, document_id: str) -> models.ScriptDocument:
        return self._load(document_id)

    def rename(self, document_id: str, title: str) -> models.ScriptDocument:
        document = self._load(document_id)
        normalized = title.strip()
        if not normalized:
            raise ValueError("script_title_required")
        document.title = normalized
        self.session.commit()
        self.session.refresh(document)
        return document

    def save(
        self,
        document_id: str,
        content: str,
        expected_checksum: str,
    ) -> models.ScriptRevision:
        document = self._load(document_id)
        current = self._current(document)
        if current.checksum != expected_checksum:
            raise ScriptRevisionConflict(current.checksum)
        if current.status == "finalized":
            current = models.ScriptRevision(
                document_id=document.id,
                revision_number=max(item.revision_number for item in document.revisions) + 1,
                status="working",
                content=content,
                checksum=_checksum(content),
                creation_method="edit",
            )
            self.session.add(current)
            self.session.flush()
            document.current_revision_id = current.id
        else:
            current.content = content
            current.checksum = _checksum(content)
        self.session.commit()
        self.session.refresh(current)
        return current

    def finalize(self, document_id: str) -> models.ScriptRevision:
        document = self._load(document_id)
        current = self._current(document)
        if current.status == "working":
            current.status = "finalized"
            document.status = "ready"
            self.session.commit()
            self.session.refresh(current)
        return current

    def restore(
        self, document_id: str, revision_id: str
    ) -> models.ScriptRevision:
        document = self._load(document_id)
        source = next(
            (item for item in document.revisions if item.id == revision_id), None
        )
        if source is None:
            raise KeyError(revision_id)
        current = self._current(document)
        if current.status == "working":
            current.status = "finalized"
        restored = models.ScriptRevision(
            document_id=document.id,
            revision_number=max(item.revision_number for item in document.revisions) + 1,
            status="finalized",
            content=source.content,
            checksum=source.checksum,
            creation_method="restore",
            original_filename=source.original_filename,
            source_file_path=source.source_file_path,
            source_media_type=source.source_media_type,
            generation_brief=source.generation_brief,
            generation_metadata=source.generation_metadata,
        )
        self.session.add(restored)
        self.session.flush()
        document.current_revision_id = restored.id
        document.status = "ready"
        self.session.commit()
        self.session.refresh(restored)
        return restored

    def delete(self, document_id: str) -> None:
        document = self._load(document_id)
        episodes = list(
            self.session.execute(
                select(models.Episode.id, models.Episode.title)
                .join(
                    models.ScriptImportEpisode,
                    models.ScriptImportEpisode.episode_id == models.Episode.id,
                )
                .join(
                    models.ScriptImport,
                    models.ScriptImport.id
                    == models.ScriptImportEpisode.script_import_id,
                )
                .join(
                    models.ScriptRevision,
                    models.ScriptRevision.id == models.ScriptImport.script_revision_id,
                )
                .where(models.ScriptRevision.document_id == document.id)
                .order_by(models.Episode.created_at)
            ).all()
        )
        if episodes:
            raise ScriptDocumentHasEpisodes(
                [(episode_id, title) for episode_id, title in episodes]
            )
        file_paths = [
            revision.source_file_path
            for revision in document.revisions
            if revision.source_file_path
        ]
        self.session.delete(document)
        self.session.commit()
        if self.file_store is not None:
            for path in set(file_paths):
                self.file_store.remove(path)
