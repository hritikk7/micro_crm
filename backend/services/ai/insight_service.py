"""Per-company AI relationship insight — brief + blocker + next action.

Separate from the urgency/ranking model (TRD v1.1 §3.5): this is a real AI
feature, it just has nothing to do with the dashboard's sort order — that's
plain user-set data now (see data_service.get_all_with_scores). No cache:
a company's interaction history can change on every log, and company_scores
no longer has anywhere to cache AI text into, so this regenerates fresh on
every request rather than risk serving something stale.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from langchain_core.messages import AIMessageChunk, HumanMessage
from langchain_openai import ChatOpenAI

from config.settings import settings
from db.models import Company

logger = logging.getLogger(__name__)

INSIGHT_PROMPT_TEMPLATE = """
You are a relationship intelligence assistant. Analyse this single company relationship and provide:

1. ai_brief: 2-3 sentences on where the relationship stands right now.
   Be specific — reference real names, dates, and what was said.

2. blocker: The single most important thing preventing progress.
   One sentence. Be specific.

3. next_action: A specific, concrete next step — not "follow up soon."

Respond in exactly this format, nothing else:
---BRIEF---
<ai_brief>
---BLOCKER---
<blocker>
---NEXT_ACTION---
<next_action>

COMPANY CONTEXT:
{company_context}
""".strip()


DRAFT_PROMPT_TEMPLATE = """
You are a relationship intelligence assistant. Write a ready-to-send follow-up message for this
company relationship, based on the interaction history below. Be specific — reference real names,
dates, and what was actually said, so the message reads like it comes from someone who was there.

Respond in exactly this format, nothing else — no preamble, no markdown, no extra commentary:
Subject: <subject line>

<message body>

COMPANY CONTEXT:
{company_context}
""".strip()


def _build_llm(*, temperature: float = 0.3, timeout: int | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        temperature=temperature,
        timeout=timeout or settings.llm_timeout_insight_seconds,
        max_retries=1,
        default_headers={
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Micro CRM",
        },
    )


def build_company_context(company: Company) -> str:
    """Serialises a company + its full interaction history into a
    deterministic, prompt-ready string. Call this with an active session —
    company.interactions/.contacts are lazy="selectin" and must already be
    loaded before the session closes.
    """
    interactions_text = (
        "\n".join(
            f"  [{i.date}] {i.type.upper()} with {i.contact_name or 'unknown'}: {i.notes}"
            for i in company.interactions  # relationship is ordered date DESC
        )
        or "  (no interactions yet)"
    )

    contacts_text = (
        ", ".join(f"{c.name} ({c.role or 'unknown role'})" for c in company.contacts)
        or "no contacts on file"
    )

    if company.interactions:
        days = (datetime.now(UTC).date() - company.interactions[0].date).days
        last_contact = f"{days} days ago"
    else:
        last_contact = "never"

    return f"""
COMPANY: {company.name}
  ID:       {company.id}
  Status:   {company.status}
  Industry: {company.industry or "unknown"}
  Size:     {company.size or "unknown"} employees
  Contacts: {contacts_text}
  Last contact: {last_contact}
  Interaction history (most recent first):
{interactions_text}
""".strip()


async def stream_company_insight(company_context: str) -> AsyncIterator[dict]:
    """Yields SSE envelope dicts: {type, content}. Caller does SSE framing.
    No cache — regenerated on every call. Takes a pre-built context string
    (not an ORM object) so the caller's DB session can close before the LLM
    call starts, rather than holding a connection idle for the stream.
    """
    prompt = INSIGHT_PROMPT_TEMPLATE.format(company_context=company_context)
    llm = _build_llm()

    try:
        async with asyncio.timeout(settings.llm_timeout_insight_seconds):
            async for chunk in llm.astream([HumanMessage(content=prompt)]):
                if isinstance(chunk, AIMessageChunk) and chunk.text:
                    yield {"type": "token", "content": str(chunk.text)}
    except TimeoutError:
        logger.warning("Insight generation timed out")
        yield {"type": "error", "content": "Insight unavailable — try again"}
    except Exception:
        logger.exception("Insight generation failed")
        yield {"type": "error", "content": "Insight unavailable — try again"}
    finally:
        yield {"type": "done", "content": None}


async def stream_draft_message(company_context: str) -> AsyncIterator[dict]:
    """Yields SSE envelope dicts: {type, content} for a ready-to-send follow-up
    message. Caller does SSE framing. No cache — per TRD §6.5, a stale draft is
    worse than the latency of regenerating one. Takes a pre-built context string
    (not an ORM object) so the caller's DB session can close before the LLM call
    starts, same reasoning as stream_company_insight.
    """
    prompt = DRAFT_PROMPT_TEMPLATE.format(company_context=company_context)
    llm = _build_llm(temperature=0.5, timeout=settings.llm_timeout_draft_seconds)

    try:
        async with asyncio.timeout(settings.llm_timeout_draft_seconds):
            async for chunk in llm.astream([HumanMessage(content=prompt)]):
                if isinstance(chunk, AIMessageChunk) and chunk.text:
                    yield {"type": "token", "content": str(chunk.text)}
    except TimeoutError:
        logger.warning("Draft generation timed out")
        yield {"type": "error", "content": "Draft unavailable — try again"}
    except Exception:
        logger.exception("Draft generation failed")
        yield {"type": "error", "content": "Draft unavailable — try again"}
    finally:
        yield {"type": "done", "content": None}
