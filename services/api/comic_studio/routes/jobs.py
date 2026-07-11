from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.jobs import JobStore


router = APIRouter(prefix="/api/jobs", tags=["jobs"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/{job_id}", response_model=schemas.JobRead)
def get_job(job_id: str, session: SessionDependency):
    job = JobStore(session).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
