from fastapi import APIRouter, HTTPException, Request

from comic_studio.schemas import MockSshHostRead, MockSshStart, MockSshStatusRead


router = APIRouter(prefix="/api/mock-ssh", tags=["mock-ssh"])


def _manager_error(error: Exception, *, operation: str) -> HTTPException:
    if isinstance(error, ValueError):
        return HTTPException(status_code=422, detail="Invalid mock SSH configuration")
    if isinstance(error, FileNotFoundError):
        return HTTPException(status_code=503, detail="HostBridge is not available")
    if isinstance(error, TimeoutError):
        return HTTPException(status_code=504, detail=f"Mock SSH {operation} timed out")
    if isinstance(error, OSError):
        return HTTPException(status_code=503, detail="HostBridge is not available")
    if isinstance(error, RuntimeError) and operation == "list mock SSH hosts":
        return HTTPException(
            status_code=503,
            detail="Unable to list HostBridge hosts",
        )
    return HTTPException(status_code=500, detail=f"Unable to {operation}")


@router.get("/hosts", response_model=list[MockSshHostRead])
def list_hosts(request: Request) -> list[MockSshHostRead]:
    try:
        return request.app.state.mock_ssh_manager.list_hosts()
    except Exception as error:
        raise _manager_error(error, operation="list mock SSH hosts") from error


@router.get("/status", response_model=MockSshStatusRead)
def get_status(request: Request) -> MockSshStatusRead:
    try:
        return request.app.state.mock_ssh_manager.status()
    except Exception as error:
        raise _manager_error(error, operation="read mock SSH status") from error


@router.post("/start", response_model=MockSshStatusRead)
def start_mock_ssh(data: MockSshStart, request: Request) -> MockSshStatusRead:
    try:
        return request.app.state.mock_ssh_manager.start(data.host_id, data.alias)
    except Exception as error:
        raise _manager_error(error, operation="start mock SSH") from error


@router.post("/stop", response_model=MockSshStatusRead)
def stop_mock_ssh(request: Request) -> MockSshStatusRead:
    try:
        return request.app.state.mock_ssh_manager.stop()
    except Exception as error:
        raise _manager_error(error, operation="stop mock SSH") from error
