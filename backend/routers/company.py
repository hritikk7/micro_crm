import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from db.database import session_scope
from services import data_service
from services.ai import insight_service

router = APIRouter(prefix="/api", tags=["company"])


@router.get("/company/{company_id}/insight")
async def stream_company_insight(company_id: str) -> EventSourceResponse:
    """SSE stream: AI brief + blocker + next action for one company.

    Deliberately no `Depends(get_db)` — the DB session only needs to live
    long enough to fetch the company and build the prompt context; it's
    closed before the LLM streaming call starts, same reasoning as
    routers/chat.py.
    """
    async with session_scope() as db:
        company = await data_service.get_company(db, company_id)
        if company is None:
            raise HTTPException(status_code=404, detail=f"No company with id '{company_id}'.")
        context = insight_service.build_company_context(company)

    async def event_generator() -> AsyncIterator[dict]:
        async for event in insight_service.stream_company_insight(context):
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_generator(), sep="\n", ping=15)


@router.get("/company/{company_id}/draft")
async def stream_draft_message(company_id: str) -> EventSourceResponse:
    """SSE stream: ready-to-send follow-up message for one company.

    Same session-scoping rationale as stream_company_insight — the DB session
    only needs to live long enough to fetch the company and build the prompt
    context, and is closed before the LLM streaming call starts.
    """
    async with session_scope() as db:
        company = await data_service.get_company(db, company_id)
        if company is None:
            raise HTTPException(status_code=404, detail=f"No company with id '{company_id}'.")
        context = insight_service.build_company_context(company)

    async def event_generator() -> AsyncIterator[dict]:
        async for event in insight_service.stream_draft_message(context):
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_generator(), sep="\n", ping=15)
