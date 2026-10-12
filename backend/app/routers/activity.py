"""fixes102: page views for the per-org activity log. Data changes are
recorded by the request middleware (main.py); reading the log is on the
superadmin's Logs page (/api/logs/activity)."""
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field
from fastapi.concurrency import run_in_threadpool

from app import models
from app.core import activity_log
from app.core.error_log import client_ip
from app.deps import get_current_user

router = APIRouter(prefix="/api/activity", tags=["activity"])


class PageViewIn(BaseModel):
    page: str = Field(..., min_length=1, max_length=500)


@router.post("/page-view", status_code=status.HTTP_204_NO_CONTENT)
async def page_view(
    payload: PageViewIn,
    request: Request,
    user: models.User = Depends(get_current_user),
) -> Response:
    """Recorded only if the user's org has the log on; a no-op otherwise
    (the frontend only calls this when the org's flag is on anyway)."""
    org_id = await run_in_threadpool(activity_log.enabled_org_for_user, user.id)
    if org_id is not None:
        await run_in_threadpool(
            activity_log.write,
            organization_id=org_id,
            user_id=user.id,
            kind="page_view",
            action="page_view",
            page=payload.page,
            ip=client_ip(request),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
