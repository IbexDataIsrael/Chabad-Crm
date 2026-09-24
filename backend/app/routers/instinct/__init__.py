"""Instinct API (docs/system_api.md phase 1, docs/system_api_part2.md phase 2).

Every endpoint lives under `/api/instinct/` and is guarded by the shared-key
`check_key` dependency (`X-Instinct-Key` == env `INSTINCT_API_KEY`) —
test-grade only; production needs per-user tokens. With no user identity the
target org comes from env `INSTINCT_ORG_ID` (default 1).

Split into a package once phase 2 took it past ~400 lines (spec §9): one
module per resource, all sharing `common.py`.
"""
from fastapi import APIRouter

from . import apartments, contacts, stats, visits
from .common import check_key

router = APIRouter(prefix="/api/instinct", tags=["instinct"])
for _module in (contacts, visits, apartments, stats):
    router.include_router(_module.router)

__all__ = ["router", "check_key"]
