"""Natural-language query router (`/api/ai/query`) — never raw SQL.

The LLM only ever returns a constrained JSON intent (`{"table", "filters"}`);
`app.crm_manifest.run_query` is the sole place that intent is validated
against an explicit allowlist and turned into a scoped SQLAlchemy query. This
router is plumbing only: auth, the Anthropic call, and mapping
`crm_manifest.ManifestError` to an HTTP response.
"""
import json
import logging

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crm_manifest, models
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.schemas import AiQueryRequest, AiQueryResponse

logger = logging.getLogger("app.ai_query")

router = APIRouter(prefix="/api/ai", tags=["ai"])

MAX_TOKENS = 1024


@router.post("/query", response_model=AiQueryResponse)
def query(
    payload: AiQueryRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI query is not configured (ANTHROPIC_API_KEY is missing)",
        )
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty prompt")

    system_prompt = crm_manifest.build_system_prompt(current_user.role)
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as exc:
        logger.warning("Anthropic request failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "AI service returned an error"
        )

    # NOTE: .content[0].text — .content is a list of content blocks, not a
    # string. (.content.text raises AttributeError; don't "fix" this back.)
    try:
        text = response.content[0].text
    except (IndexError, AttributeError):
        logger.warning("Unexpected Anthropic response shape: %s", response)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unexpected AI response")

    try:
        intent = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Non-JSON AI response: %s", text[:300])
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unexpected AI response")

    try:
        result = crm_manifest.run_query(db, current_user, intent)
    except crm_manifest.ManifestError as exc:
        raise HTTPException(exc.status_code, exc.message)

    return AiQueryResponse(
        table_title=result.table_title,
        columns=result.columns,
        rows=result.rows,
        row_count=result.row_count,
        truncated=result.truncated,
    )
