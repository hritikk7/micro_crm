import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from schemas.api import ChatRequest
from services.ai import agent_service

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def pipeline_chat(body: ChatRequest) -> EventSourceResponse:
    """SSE stream: LangGraph agent responds to the user's pipeline question,
    or logs an interaction / adds a company if that's what the message asks for.

    Deliberately takes no `db` dependency — see agent tools, which each open
    their own short-lived session rather than sharing one across the whole
    (potentially 10-60s) streamed turn.
    """

    async def event_generator() -> AsyncIterator[dict]:
        async for event in agent_service.run_agent(body.message, body.session_history):
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_generator(), sep="\n", ping=15)
