"""Natural-language query router (`/api/ai/query`) — never raw SQL.

The LLM only ever returns a constrained JSON intent (`{"table", "filters"}`);
`app.crm_manifest.run_query` is the sole place that intent is validated
against an explicit allowlist and turned into a scoped SQLAlchemy query. This
router is plumbing only: auth, the Anthropic call, and mapping
`crm_manifest.ManifestError` to an HTTP response.
"""
import json
import logging
import re

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

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_intent(text: str) -> object:
    """The system prompt tells the model to return bare JSON, but models
    sometimes wrap structured output in a markdown code fence (```json ...```)
    or add a stray leading/trailing sentence anyway — strip that before
    parsing, then fall back to pulling out the first {...} block. Raises
    json.JSONDecodeError (caught by the caller) if nothing usable is found."""
    stripped = _CODE_FENCE_RE.sub("", text.strip()).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    match = _JSON_OBJECT_RE.search(stripped)
    if not match:
        raise json.JSONDecodeError("no JSON object found in AI response", stripped, 0)
    return json.loads(match.group(0))


def _extract_text(response) -> str:
    """`.content` is a list of content blocks. claude-sonnet-5 runs adaptive
    thinking by default when `thinking` is omitted, which would put a
    ThinkingBlock (no `.text`) first — we disable thinking below since this is
    a plain classification call, but stay defensive and scan for the actual
    text block rather than assuming position 0."""
    for block in response.content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            return text
    raise AttributeError("no text block in response.content")


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

    system_prompt = crm_manifest.build_system_prompt(db, current_user)
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=MAX_TOKENS,
            # This is a plain classification call (NL -> fixed JSON schema, no
            # tools) — no reasoning benefit from thinking, and claude-sonnet-5
            # runs adaptive thinking by default when this is omitted, which
            # would put a non-text ThinkingBlock first in response.content.
            thinking={"type": "disabled"},
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as exc:
        logger.warning("Anthropic request failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"AI service returned an error: {exc}"
        )

    try:
        text = _extract_text(response)
    except AttributeError:
        logger.warning("Unexpected Anthropic response shape: %s", response)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Unexpected AI response shape: {response!r:.200}",
        )

    try:
        intent = _parse_intent(text)
    except json.JSONDecodeError:
        logger.warning("Non-JSON AI response: %s", text[:300])
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Unexpected AI response (not valid JSON): {text[:200]!r}",
        )

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
