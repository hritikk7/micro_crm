from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_history: list[ChatMessage] = Field(default_factory=list)


class SSEEvent(BaseModel):
    """Documents the SSE envelope shape emitted by agent_service.run_agent.
    Not used for validation on the wire — the router serialises dicts
    directly — but kept as the canonical reference for the contract.
    """

    type: Literal["token", "tool_call", "tool_result", "done", "error"]
    content: str | dict | None = None
