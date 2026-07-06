"""AI chat with a "digital twin" — answers questions about the user's career.

The twin's knowledge lives in `backend/career.md` (editable markdown, injected
into the system prompt on every call). Completion is done via OpenRouter with
the model configured in settings (`openai/gpt-oss-120b:free` by default).
"""
import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from app import models
from app.config import settings
from app.deps import get_current_user
from app.schemas import AiChatRequest, AiChatResponse

logger = logging.getLogger("app.ai")

router = APIRouter(prefix="/api/ai", tags=["ai"])

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# The client resends the whole conversation each turn; cap what we forward.
MAX_HISTORY_MESSAGES = 20
REQUEST_TIMEOUT_SECONDS = 60

_CAREER_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "career.md"
)


def _career_profile() -> str:
    """The career markdown, re-read per request so edits apply without restart."""
    try:
        with open(_CAREER_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _system_prompt() -> str:
    profile = _career_profile()
    base = (
        "You are a 'digital twin' assistant: you speak in first person as the "
        "person described in the career profile below, answering questions about "
        "their career, experience, skills, and projects. Be accurate and concise; "
        "if the profile doesn't contain the answer, say so honestly instead of "
        "inventing details. Answer in the language the question was asked in "
        "(Hebrew or English)."
    )
    if not profile:
        return base + (
            "\n\nNo career profile has been provided yet. Tell the user that the "
            "profile file (backend/career.md) is empty and should be filled in."
        )
    return f"{base}\n\n--- CAREER PROFILE ---\n{profile}"


@router.post("/chat", response_model=AiChatResponse)
def chat(
    payload: AiChatRequest,
    current_user: models.User = Depends(get_current_user),
):
    if not settings.openrouter_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI chat is not configured (OPENROUTER_API_KEY is missing)",
        )
    history = [
        {"role": m.role, "content": m.content}
        for m in payload.messages[-MAX_HISTORY_MESSAGES:]
        if m.role in ("user", "assistant") and m.content.strip()
    ]
    if not history:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No messages")

    try:
        response = httpx.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openrouter_model,
                "messages": [{"role": "system", "content": _system_prompt()}] + history,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        logger.warning("OpenRouter request failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI service is unreachable")

    if response.status_code != 200:
        logger.warning(
            "OpenRouter error %s: %s", response.status_code, response.text[:500]
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"AI service returned an error ({response.status_code})",
        )

    data = response.json()
    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.warning("Unexpected OpenRouter response shape: %s", str(data)[:500])
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unexpected AI response")
    return AiChatResponse(reply=reply or "")
