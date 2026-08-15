from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

UrgencyLevel = Literal["hot", "watch", "stable", "stale"]
InteractionType = Literal["meeting", "email", "call", "demo", "support_call"]
CompanyStatus = Literal["prospect", "customer"]

URGENCY_RANK: dict[UrgencyLevel, int] = {"hot": 1, "watch": 2, "stable": 3, "stale": 4}


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


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


# ─── POST /api/interactions ─────────────────────────────────────────────────


class InteractionCreate(CamelModel):
    company_id: str
    contact_name: str | None = None
    contact_id: str | None = None
    date: date
    type: InteractionType
    notes: str = Field(min_length=1, max_length=2000)
    urgency: UrgencyLevel

    @field_validator("date")
    @classmethod
    def date_not_in_future(cls, v: date) -> date:
        if v > datetime.now(UTC).date():
            raise ValueError("Interaction date cannot be in the future")
        return v


class InteractionCreatedResponse(CamelModel):
    success: Literal[True] = True
    interaction_id: int


# ─── POST /api/companies, GET /api/companies ────────────────────────────────


class CompanyCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    industry: str | None = None
    status: CompanyStatus = "prospect"
    size: int | None = Field(default=None, ge=1)


class CompanyCreatedResponse(CamelModel):
    success: Literal[True] = True
    company_id: str
    name: str


class ContactOut(CamelModel):
    id: str
    name: str
    role: str | None
    email: str | None


class CompanyOut(CamelModel):
    id: str
    name: str
    industry: str | None
    status: CompanyStatus
    size: int | None
    contacts: list[ContactOut]


class CompaniesResponse(CamelModel):
    companies: list[CompanyOut]


# ─── GET /api/priorities ─────────────────────────────────────────────────────


class CompanyScoreOut(CamelModel):
    urgency: UrgencyLevel
    urgency_rank: int
    updated_at: datetime


class InteractionOut(CamelModel):
    id: int
    contact_name: str | None
    contact_id: str | None
    date: date
    type: InteractionType
    notes: str
    urgency: UrgencyLevel | None
    created_at: datetime


class CompanyWithScore(CamelModel):
    id: str
    name: str
    industry: str | None
    status: CompanyStatus
    size: int | None
    score: CompanyScoreOut
    last_interaction: InteractionOut | None
    last_contact_date: date | None


class PrioritiesStats(CamelModel):
    total: int
    prospects: int
    customers: int
    need_attention: int  # count of hot + watch


class PrioritiesResponse(CamelModel):
    companies: list[CompanyWithScore]
    stats: PrioritiesStats
