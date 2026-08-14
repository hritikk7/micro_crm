# Technical Design Document
## AI-Powered Micro-CRM

---

**Version:** 1.0  
**Status:** Draft  
**Author:** Ritik  
**Last Updated:** August 2026  
**Companion Document:** PRD v1.2  

---

## Table of Contents

1. [[System Architecture & Component Interaction](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#1-system-architecture--component-interaction)](#1-system-architecture--component-interaction)
2. [[Database Schema & Data Models](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#2-database-schema--data-models)](#2-database-schema--data-models)
3. [[AI Scoring Engine & Invalidation Strategy](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#3-ai-scoring-engine--invalidation-strategy)](#3-ai-scoring-engine--invalidation-strategy)
4. [[Pipeline Chat Agent & Tooling](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#4-pipeline-chat-agent--tooling)](#4-pipeline-chat-agent--tooling)
5. [[API Contracts & Server Action Signatures](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#5-api-contracts--server-action-signatures)](#5-api-contracts--server-action-signatures)
6. [[Error Handling & Edge Cases](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#6-error-handling--edge-cases)](#6-error-handling--edge-cases)

---

## 1. System Architecture & Component Interaction

### 1.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Next.js 14 Frontend                           │
│                                                                    │
│  ┌──────────────────────┐     ┌────────────────────────────────┐  │
│  │  Priority Dashboard   │     │       Pipeline Chat            │  │
│  │  ─────────────────   │     │  ─────────────────────────     │  │
│  │  PipelineStats        │     │  PipelineChat (SSE reader)     │  │
│  │  CompanyCard          │     │  MessageList                   │  │
│  │   └─ QuickLogForm     │     │  ChatInput                     │  │
│  │   └─ ExpandedDetail   │     └────────────────────────────────┘  │
│  │      └─ DraftMessage  │                                          │
│  └──────────────────────┘                                          │
└──────────────────────────────────┬───────────────────────────────┘
                                   │  HTTP / SSE
                                   │
┌──────────────────────────────────▼───────────────────────────────┐
│                      FastAPI Backend                               │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────┐  │
│  │ /priorities │  │ /company/{id}│  │    /chat   │  │/interact│  │
│  │             │  │  /insight    │  │            │  │  ions   │  │
│  │             │  │  /draft      │  │            │  │/companie│  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────┬────┘  │
│         │                │                 │               │       │
│  ┌──────▼────────────────▼─────────────────▼───────────────▼────┐ │
│  │                     Service Layer                              │ │
│  │  priority_service  insight_service  agent_service  data_svc   │ │
│  └──────────────────────────────┬─────────────────────────────┘  │
│                                  │                                 │
│  ┌───────────────────────────────▼───────────────────────────┐   │
│  │                      AI Layer                              │   │
│  │  LangChain (Scorer + Insight + Draft)  LangGraph (Agent)  │   │
│  │  ─────────────────────────────────    ─────────────────   │   │
│  │  ChatOpenAI → OpenRouter → Gemini      SQL Agent Graph     │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬───────────────────────────────┘
                                   │ SQLAlchemy (async)
                                   │
┌──────────────────────────────────▼───────────────────────────────┐
│                    Supabase (PostgreSQL)                            │
│                                                                    │
│  companies   contacts   interactions   company_scores              │
└───────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Responsibilities

| Component | Responsibility | Does NOT do |
|---|---|---|
| Next.js Dashboard | Renders cards, manages expand/collapse state, streams SSE, triggers re-fetches | Business logic, AI calls |
| Next.js Chat | Manages conversation history in React state, streams SSE chunks | SQL generation, DB access |
| FastAPI Routers | HTTP validation, request parsing, SSE scaffolding | AI logic, DB queries |
| Services Layer | Orchestrates AI + DB calls, maps DB rows → response shapes | HTTP concerns |
| priority_service | Batch scores all companies via LangChain structured output | Streaming |
| insight_service | Streams per-company AI brief + draft via LangChain | Scoring |
| agent_service | Runs LangGraph SQL agent loop, handles write tools | Score caching |
| data_service | Raw DB queries (no AI), used by all services | AI calls |

### 1.3 Data Flow — Primary User Flows

#### Flow A: Dashboard Load

```
Browser
  1. GET /api/priorities
        → data_service: fetch all companies + last interaction per company
        → priority_service: check company_scores cache
            → cache HIT: return cached scores (scored_at < 24h, not invalidated)
            → cache MISS: call LangChain batch scorer
                → builds prompt context from all companies + interactions
                → LLM returns structured JSON array
                → upsert into company_scores
                → return scored array
        → return ranked CompanyWithScore[]
  2. GET /api/companies (parallel)
        → data_service: fetch all companies + contacts
        → return Company[] with Contact[]
```

#### Flow B: Card Expand → Insight Streaming

```
Browser (user clicks card)
  1. GET /api/company/{id}/insight  (SSE)
        → data_service: fetch company + all interactions + contacts
        → insight_service: check if cached ai_brief/blocker/next_action in company_scores
            → cache HIT (scored_at < 1h): stream from cache
            → cache MISS: LangChain streaming call
                → builds per-company prompt context
                → streams tokens via SSE
                → accumulates + stores full insight in company_scores
```

#### Flow C: Draft Message Streaming

```
Browser (user clicks "Draft Message")
  1. GET /api/company/{id}/draft  (SSE)
        → data_service: fetch company + recent interactions + contact names
        → insight_service.draft: no cache (always generate fresh)
            → LangChain streaming call
            → streams via SSE
```

#### Flow D: Log Interaction (Quick Form)

```
Browser
  1. POST /api/interactions  { company_id, contact_name, type, notes, date }
        → data_service: INSERT into interactions
        → priority_service.invalidate(company_id)
            → UPDATE company_scores SET invalidated_at = NOW() WHERE company_id = ?
        → priority_service.rescore_single(company_id)
            → fetch company + all interactions
            → LangChain structured output call (single company)
            → UPSERT company_scores
        → return { success: true, updated_score: CompanyScore }
  2. Frontend re-fetches /api/priorities or applies optimistic update
```

#### Flow E: Pipeline Chat

```
Browser
  1. POST /api/chat  { message, session_history[] }
        → agent_service: build LangGraph state
            → node: understand_intent
            → node: get_schema (if needed)
            → node: write_sql
            → node: execute_query
            → node: evaluate_result (retry if needed, max 3)
            → node: formulate_answer
            → WRITE PATH: if intent = insert
                → node: call insert tool → DB write → rescore_single
        → SSE stream agent reasoning tokens
        → final text response
  2. Frontend appends to session_history (React state only — no DB)
```

### 1.4 Communication Protocols

| Path | Protocol | Format |
|---|---|---|
| Dashboard load | HTTP GET | JSON |
| Insight stream | SSE (GET) | `data: {type, content}\n\n` |
| Draft stream | SSE (GET) | `data: {type, content}\n\n` |
| Chat | SSE (POST) | `data: {type, content}\n\n` |
| Log interaction | HTTP POST | JSON |
| Add company (chat) | via agent tool | (agent handles) |

### 1.5 SSE Envelope Format

Every streaming endpoint emits newline-delimited SSE events using this consistent envelope:

```
data: {"type": "token", "content": "UrbanFleet "}\n\n
data: {"type": "token", "content": "is currently in..."}\n\n
data: {"type": "done", "content": null}\n\n
data: {"type": "error", "content": "LLM timeout"}\n\n
```

SSE event types:

| `type` | When | `content` |
|---|---|---|
| `token` | Streaming chunk | string fragment |
| `tool_call` | Agent called a tool | `{ tool_name, input }` |
| `tool_result` | Tool returned | `{ tool_name, result }` |
| `done` | Stream complete | null |
| `error` | Unrecoverable error | error message string |

---

## 2. Database Schema & Data Models

### 2.1 PostgreSQL Schema (Supabase)

```sql
-- ─────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────
CREATE TABLE companies (
    id          TEXT        PRIMARY KEY,        -- e.g. "C001"
    name        TEXT        NOT NULL,
    industry    TEXT,
    status      TEXT        NOT NULL            -- 'prospect' | 'customer'
                CHECK (status IN ('prospect', 'customer')),
    size        INTEGER,                        -- employee count
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- contacts
-- ─────────────────────────────────────────────
CREATE TABLE contacts (
    id          TEXT        PRIMARY KEY,        -- e.g. "P001"
    company_id  TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    role        TEXT,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);

-- ─────────────────────────────────────────────
-- interactions
-- ─────────────────────────────────────────────
CREATE TABLE interactions (
    id              BIGSERIAL   PRIMARY KEY,
    company_id      TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_name    TEXT,                       -- denormalised for agent legibility
    contact_id      TEXT        REFERENCES contacts(id) ON DELETE SET NULL,
    date            DATE        NOT NULL,       -- structured date (not free text)
    type            TEXT        NOT NULL        -- 'meeting'|'email'|'call'|'demo'|'support_call'
                    CHECK (type IN ('meeting', 'email', 'call', 'demo', 'support_call')),
    notes           TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queries: all interactions for a company (dashboard + agent)
CREATE INDEX idx_interactions_company     ON interactions(company_id);
-- Queries: most recent interaction per company (recency scoring)
CREATE INDEX idx_interactions_company_date ON interactions(company_id, date DESC);
-- Agent queries: search interactions by contact
CREATE INDEX idx_interactions_contact     ON interactions(contact_id);

-- ─────────────────────────────────────────────
-- company_scores  (AI output cache)
-- ─────────────────────────────────────────────
CREATE TABLE company_scores (
    id                  BIGSERIAL   PRIMARY KEY,
    company_id          TEXT        NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    urgency             TEXT        NOT NULL
                        CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
    reason              TEXT        NOT NULL,   -- one-line AI reason
    recommended_action  TEXT        NOT NULL,   -- specific next step
    ai_brief            TEXT,                   -- 2-3 sentence relationship brief (populated on expand)
    blocker             TEXT,                   -- single blocker (populated on expand)
    priority_rank       INTEGER     NOT NULL DEFAULT 0,
    scored_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    insight_scored_at   TIMESTAMPTZ,            -- separate timestamp for deeper insight
    invalidated_at      TIMESTAMPTZ,            -- set when a new interaction is logged
    interaction_count   INTEGER     NOT NULL DEFAULT 0  -- snapshot at score time (cheap staleness check)
);

-- Dashboard primary query: all scores ranked
CREATE INDEX idx_company_scores_rank   ON company_scores(priority_rank ASC);
-- Invalidation query
CREATE INDEX idx_company_scores_co_id  ON company_scores(company_id);
```

### 2.2 TypeScript Data Models

```typescript
// ─── Shared enums ───────────────────────────────────────────────────────────

export type CompanyStatus = 'prospect' | 'customer';
export type UrgencyLevel  = 'hot' | 'watch' | 'stable' | 'stale';
export type InteractionType = 'meeting' | 'email' | 'call' | 'demo' | 'support_call';

// ─── Database row types (raw, from Supabase) ────────────────────────────────

export interface CompanyRow {
  id:         string;
  name:       string;
  industry:   string | null;
  status:     CompanyStatus;
  size:       number | null;
  created_at: string;
}

export interface ContactRow {
  id:         string;
  company_id: string;
  name:       string;
  role:       string | null;
  email:      string | null;
  created_at: string;
}

export interface InteractionRow {
  id:           number;
  company_id:   string;
  contact_name: string | null;
  contact_id:   string | null;
  date:         string;         // ISO date: "2026-08-05"
  type:         InteractionType;
  notes:        string;
  created_at:   string;
}

export interface CompanyScoreRow {
  id:                 number;
  company_id:         string;
  urgency:            UrgencyLevel;
  reason:             string;
  recommended_action: string;
  ai_brief:           string | null;
  blocker:            string | null;
  priority_rank:      number;
  scored_at:          string;
  insight_scored_at:  string | null;
  invalidated_at:     string | null;
  interaction_count:  number;
}

// ─── Application-level domain types ─────────────────────────────────────────

export interface Contact {
  id:    string;
  name:  string;
  role:  string | null;
  email: string | null;
}

export interface Interaction {
  id:          number;
  contactName: string | null;
  contactId:   string | null;
  date:        string;
  type:        InteractionType;
  notes:       string;
  createdAt:   string;
}

export interface Company {
  id:       string;
  name:     string;
  industry: string | null;
  status:   CompanyStatus;
  size:     number | null;
  contacts: Contact[];
}

export interface CompanyScore {
  urgency:           UrgencyLevel;
  reason:            string;
  recommendedAction: string;
  aiBrief:           string | null;
  blocker:           string | null;
  priorityRank:      number;
  scoredAt:          string;
  isStale:           boolean;   // invalidated_at IS NOT NULL
}

// The combined shape served to the dashboard
export interface CompanyWithScore extends Company {
  score:           CompanyScore;
  lastInteraction: Interaction | null;
  lastContactDate: string | null;
}

// Expanded card detail (lazy-loaded on expand)
export interface CompanyDetail extends CompanyWithScore {
  interactions: Interaction[];
  aiBrief:      string;         // guaranteed non-null after insight fetch
  blocker:      string;
}
```

### 2.3 Python / Pydantic Models (Backend)

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import date, datetime

UrgencyLevel    = Literal["hot", "watch", "stable", "stale"]
InteractionType = Literal["meeting", "email", "call", "demo", "support_call"]
CompanyStatus   = Literal["prospect", "customer"]

# ─── DB ORM models (SQLAlchemy) ──────────────────────────────────────────────

class CompanyORM(Base):
    __tablename__ = "companies"
    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False)
    industry   = Column(String)
    status     = Column(String, nullable=False)
    size       = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    contacts     = relationship("ContactORM", back_populates="company")
    interactions = relationship("InteractionORM", back_populates="company",
                                order_by="InteractionORM.date.desc()")

class ContactORM(Base):
    __tablename__ = "contacts"
    id         = Column(String, primary_key=True)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False)
    name       = Column(String, nullable=False)
    role       = Column(String)
    email      = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class InteractionORM(Base):
    __tablename__ = "interactions"
    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id   = Column(String, ForeignKey("companies.id"), nullable=False)
    contact_name = Column(String)
    contact_id   = Column(String, ForeignKey("contacts.id"))
    date         = Column(Date, nullable=False)
    type         = Column(String, nullable=False)
    notes        = Column(Text, nullable=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

class CompanyScoreORM(Base):
    __tablename__ = "company_scores"
    id                 = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id         = Column(String, ForeignKey("companies.id"), unique=True, nullable=False)
    urgency            = Column(String, nullable=False)
    reason             = Column(Text, nullable=False)
    recommended_action = Column(Text, nullable=False)
    ai_brief           = Column(Text)
    blocker            = Column(Text)
    priority_rank      = Column(Integer, nullable=False, default=0)
    scored_at          = Column(DateTime(timezone=True), server_default=func.now())
    insight_scored_at  = Column(DateTime(timezone=True))
    invalidated_at     = Column(DateTime(timezone=True))
    interaction_count  = Column(Integer, nullable=False, default=0)

# ─── Pydantic request / response schemas ─────────────────────────────────────

class InteractionCreate(BaseModel):
    company_id:   str
    contact_name: Optional[str] = None
    contact_id:   Optional[str] = None
    date:         date
    type:         InteractionType
    notes:        str = Field(..., min_length=1, max_length=2000)

class CompanyCreate(BaseModel):
    id:       Optional[str] = None     # auto-assigned if omitted
    name:     str = Field(..., min_length=1, max_length=200)
    industry: Optional[str] = None
    status:   CompanyStatus = "prospect"
    size:     Optional[int] = Field(None, ge=1)

class ContactCreate(BaseModel):
    company_id: str
    name:       str = Field(..., min_length=1)
    role:       Optional[str] = None
    email:      Optional[str] = None

# ─── AI structured output schemas (LangChain withStructuredOutput) ────────────

class CompanyScoringResult(BaseModel):
    """Structured output from the batch priority scorer."""
    company_id:         str
    urgency:            UrgencyLevel
    reason:             str  = Field(..., description="One sentence. Why this urgency now?")
    recommended_action: str  = Field(..., description="One specific next step the user should take.")
    priority_rank:      int  = Field(..., ge=1, description="1 = most urgent")

class BatchScoringOutput(BaseModel):
    """Full output of a batch scoring call."""
    scores: list[CompanyScoringResult]

class CompanyInsightOutput(BaseModel):
    """Structured output for per-company deep insight (non-streaming alternative)."""
    ai_brief: str = Field(..., description="2-3 sentences on where the relationship stands.")
    blocker:  str = Field(..., description="The single thing blocking progress.")
    next_action: str = Field(..., description="Specific action with full context.")
```

### 2.4 Indexes & Query Optimisation

| Query | Index Used | Estimated cost |
|---|---|---|
| Dashboard: all scores ranked | `idx_company_scores_rank` | Sequential scan (8 rows, trivial) |
| Rescore invalidation: find score by company | `idx_company_scores_co_id` (unique) | Index seek |
| Context builder: all interactions for a company | `idx_interactions_company` | Index range scan |
| Last-contact date per company | `idx_interactions_company_date` | Index range scan, LIMIT 1 |
| Agent: interactions for a contact name | `idx_interactions_contact` | Index scan |
| Company contacts for quick-log dropdown | `idx_contacts_company` | Index scan |

---

## 3. AI Scoring Engine & Invalidation Strategy

### 3.1 Scoring Service Architecture

The scoring engine has two modes:

| Mode | Trigger | Scope | LangChain Pattern |
|---|---|---|---|
| **Batch** | Dashboard load (cache miss) | All companies | Structured output, one call |
| **Single** | After interaction logged | One company | Structured output, one call |

Both modes share the same prompt template and output schema — only the number of companies in the context differs.

### 3.2 Prompt Context Construction

```python
# services/ai/priority_service.py

def build_company_context(company: CompanyORM) -> str:
    """
    Serialises a single company and its full interaction history
    into a deterministic, token-efficient string for the prompt.
    """
    interactions_text = "\n".join([
        f"  [{i.date}] {i.type.upper()} with {i.contact_name or 'unknown'}: {i.notes}"
        for i in company.interactions   # already ordered by date DESC via ORM
    ]) or "  (no interactions yet)"

    contacts_text = ", ".join([
        f"{c.name} ({c.role or 'unknown role'})"
        for c in company.contacts
    ]) or "no contacts on file"

    last_interaction_days = _days_since(company.interactions[0].date) \
                            if company.interactions else None
    last_contact_str = (
        f"{last_interaction_days} days ago"
        if last_interaction_days is not None else "never"
    )

    return f"""
COMPANY: {company.name}
  ID:       {company.id}
  Status:   {company.status}
  Industry: {company.industry or "unknown"}
  Size:     {company.size or "unknown"} employees
  Contacts: {contacts_text}
  Last contact: {last_contact_str}
  Interaction history (most recent first):
{interactions_text}
""".strip()

def build_batch_prompt(companies: list[CompanyORM], today: date) -> str:
    company_blocks = "\n\n---\n\n".join(
        build_company_context(c) for c in companies
    )
    return BATCH_SCORING_PROMPT_TEMPLATE.format(
        today=today.isoformat(),
        company_blocks=company_blocks
    )
```

### 3.3 Prompt Template — Batch Priority Scorer

```
BATCH_SCORING_PROMPT_TEMPLATE = """
You are a relationship intelligence engine for a small business CRM.
Today is {today}.

Analyse the following customer and prospect relationships. For each company:
1. Assign an urgency level using EXACTLY these definitions:
   - hot:    A time-sensitive commitment was made and not acted on, OR a large deal (100+ employees) is going quiet after recent engagement
   - watch:  An unanswered question sits open, a competitor risk is mentioned, or a follow-up is overdue but not critical
   - stable: A clear next step exists with a known timeline; no immediate action needed
   - stale:  No meaningful contact in 60+ days; relationship at risk of dying

2. Write a reason — one specific sentence explaining WHY this urgency level applies NOW.
   Reference the actual notes. Be specific: name the person, the date, the commitment.
   BAD:  "Follow up soon."
   GOOD: "Tom said reconnect next week (Aug 5) — 9 days have passed with no IT intro."

3. Write a recommended_action — one concrete, specific next step the user should take.
   BAD:  "Send a follow-up email."
   GOOD: "Email Tom referencing the IT intro he promised — confirm Aug 20 as the review date."

4. Assign priority_rank — 1 = most urgent, no ties.

Return ONLY valid JSON conforming to the BatchScoringOutput schema.
Do not explain yourself. Do not include markdown. Output raw JSON only.

RELATIONSHIPS TO ANALYSE:

{company_blocks}
"""
```

### 3.4 LangChain Scoring Call

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import PromptTemplate
from schemas.ai import BatchScoringOutput, CompanyScoringResult

llm = ChatOpenAI(
    model="google/gemini-flash-1.5",
    openai_api_base="https://openrouter.ai/api/v1",
    openai_api_key=settings.OPENROUTER_API_KEY,
    temperature=0.2,       # low temp for deterministic scoring
    max_tokens=2048,
    timeout=30,
)

structured_llm = llm.with_structured_output(BatchScoringOutput)

async def score_companies_batch(
    companies: list[CompanyORM],
    db: AsyncSession
) -> list[CompanyScoringResult]:
    today  = date.today()
    prompt = build_batch_prompt(companies, today)
    output: BatchScoringOutput = await structured_llm.ainvoke(prompt)

    # Upsert scores into DB
    for score in output.scores:
        await upsert_company_score(db, score, interaction_count=_count_interactions(companies, score.company_id))

    return sorted(output.scores, key=lambda s: s.priority_rank)
```

### 3.5 Insight Streaming (Per-Company)

```python
# services/ai/insight_service.py

INSIGHT_PROMPT_TEMPLATE = """
You are a relationship intelligence assistant. Analyse this single company relationship and provide:

1. ai_brief: 2-3 sentences on where the relationship stands right now.
   Be specific — reference real names, dates, and what was said.

2. blocker: The single most important thing preventing progress.
   One sentence. Be specific.

3. draft_message: A ready-to-send follow-up message the user can copy.
   Include a subject line on the first line (format: "Subject: ...").
   Then a blank line, then the message body.
   Keep the body to 3-5 sentences. Warm, professional, specific.

Respond in this exact format:
---BRIEF---
[your ai_brief here]
---BLOCKER---
[your blocker here]
---DRAFT---
[subject line and message here]

COMPANY CONTEXT:
{company_context}
"""

async def stream_company_insight(
    company: CompanyORM,
    db: AsyncSession
) -> AsyncIterator[dict]:
    """Yields SSE dicts. Caller is responsible for SSE framing."""
    prompt  = INSIGHT_PROMPT_TEMPLATE.format(
        company_context=build_company_context(company)
    )
    buffer  = ""
    section = "brief"

    async for chunk in streaming_llm.astream(prompt):
        token    = chunk.content
        buffer  += token
        yield {"type": "token", "content": token}

    # Parse sections from buffer and persist to cache
    parsed = _parse_insight_sections(buffer)
    await _update_insight_cache(db, company.id, parsed)
    yield {"type": "done", "content": None}
```

### 3.6 Invalidation Strategy

The invalidation lifecycle for `company_scores`:

```
State A: Valid score
  company_scores.invalidated_at = NULL
  company_scores.scored_at < 24h ago
  interaction_count matches current count
  → Serve from cache

State B: Soft-invalidated (new interaction logged)
  company_scores.invalidated_at = NOW()
  → Trigger async rescore of that single company
  → Dashboard optimistically shows old score with "Updating..." badge
  → Score replaces on rescore completion

State C: Time-invalidated (no new interactions, but score > 24h old)
  company_scores.scored_at > 24h ago
  → Full batch rescore on next dashboard load (cache miss path)
  → 24h TTL chosen because: relationships don't move that fast; cost control

State D: Count-invalidated (lightweight staleness check, no TTL)
  current interaction count for company ≠ company_scores.interaction_count
  → Always rescore, regardless of TTL
  → Catches edge cases where invalidated_at was missed
```

```python
# services/ai/priority_service.py

SCORE_TTL_HOURS  = 24
INSIGHT_TTL_HOURS = 1   # insight brief expires faster (more token-heavy)

async def get_or_score_all(db: AsyncSession) -> list[CompanyScoringResult]:
    companies = await data_service.get_all_companies_with_interactions(db)

    # Cheap staleness check before LLM call
    cached = await data_service.get_all_scores(db)
    cached_map = {s.company_id: s for s in cached}

    stale_ids = []
    for company in companies:
        score = cached_map.get(company.id)
        if (
            score is None
            or score.invalidated_at is not None
            or _hours_since(score.scored_at) > SCORE_TTL_HOURS
            or score.interaction_count != len(company.interactions)
        ):
            stale_ids.append(company.id)

    if not stale_ids:
        # All cache hits — return sorted cached scores
        return _sort_cached(cached)

    # Rescore only stale companies (cost optimisation)
    stale_companies = [c for c in companies if c.id in set(stale_ids)]
    new_scores      = await score_companies_batch(stale_companies, db)

    # Merge with still-valid cached scores
    return _merge_and_sort(cached_map, new_scores, stale_ids)

async def invalidate_and_rescore(company_id: str, db: AsyncSession) -> CompanyScoringResult:
    """Called immediately after a new interaction is logged."""
    await data_service.invalidate_score(company_id, db)
    company = await data_service.get_company_with_interactions(company_id, db)
    scores  = await score_companies_batch([company], db)
    return scores[0]
```

---

## 4. Pipeline Chat Agent & Tooling

### 4.1 LangGraph Agent Overview

The pipeline chat uses a LangGraph `StateGraph` — a directed graph that loops until the agent decides it has a sufficient answer. This pattern is necessary because answering user questions requires a variable number of tool calls (schema lookup, SQL execution, optional retries).

```
┌─────────────────────────────────────────────────────────┐
│                  LangGraph State Machine                  │
│                                                           │
│  [START]                                                  │
│     │                                                     │
│     ▼                                                     │
│  [understand_intent]  ← classifies: read / insert        │
│     │                                                     │
│     ├── READ PATH ──────────────────────────────┐        │
│     │   ▼                                        │        │
│     │  [get_schema]   (if first call)            │        │
│     │   │                                        │        │
│     │   ▼                                        │        │
│     │  [write_sql]    LLM writes a SQL query     │        │
│     │   │                                        │        │
│     │   ▼                                        │        │
│     │  [execute_query]  runs via SQLAlchemy      │        │
│     │   │                                        │        │
│     │   ▼                                        │        │
│     │  [evaluate_result]                         │        │
│     │   │                                        │        │
│     │   ├── sufficient ──────────────────────┐   │        │
│     │   └── needs_retry (max 3) ─────────────┘   │        │
│     │          │                              │   │        │
│     │          └──── back to [write_sql] ─┘  │   │        │
│     │                                        ▼   ▼        │
│     │                               [formulate_answer]    │
│     │                                        │            │
│     ├── INSERT PATH ──────────────┐          │            │
│     │   ▼                         │          │            │
│     │  [call_write_tool]           │          │            │
│     │   │                         │          │            │
│     │   ▼                         │          │            │
│     │  [trigger_rescore]           │          │            │
│     │   │                         │          │            │
│     │   └─────────────────────────┘          │            │
│     │                                        ▼            │
│     │                                      [END]          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 LangGraph State Definition

```python
# services/ai/agent_service.py

from langgraph.graph import StateGraph, END
from typing import TypedDict, Optional, Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
    # Conversation history (accumulated across turns within session)
    messages:         Annotated[list[BaseMessage], add_messages]
    # Classified intent
    intent:           Optional[str]         # "read" | "insert_interaction" | "insert_company"
    # Schema string (fetched once, reused within session)
    schema_context:   Optional[str]
    # SQL written by LLM
    generated_sql:    Optional[str]
    # Raw query results
    query_results:    Optional[list[dict]]
    # Number of SQL retry attempts
    retry_count:      int
    # If insert, which company was affected (for rescore trigger)
    affected_company: Optional[str]
    # Final text answer for the user
    final_answer:     Optional[str]
```

### 4.3 Tool Schemas

#### Read Tools

```python
from langchain_core.tools import tool

@tool
def get_db_schema() -> str:
    """
    Returns the full database schema as a string.
    Call this before writing any SQL query you haven't written for this session yet.
    """
    return """
TABLES:
  companies(id TEXT PK, name TEXT, industry TEXT, status TEXT, size INTEGER)
    status values: 'prospect', 'customer'

  contacts(id TEXT PK, company_id TEXT FK, name TEXT, role TEXT, email TEXT)

  interactions(id BIGINT PK, company_id TEXT FK, contact_name TEXT,
               date DATE, type TEXT, notes TEXT, created_at TIMESTAMPTZ)
    type values: 'meeting', 'email', 'call', 'demo', 'support_call'

  company_scores(company_id TEXT UK FK, urgency TEXT, reason TEXT,
                 recommended_action TEXT, priority_rank INTEGER, scored_at TIMESTAMPTZ)
    urgency values: 'hot', 'watch', 'stable', 'stale'

IMPORTANT CONSTRAINTS:
  - You may only use SELECT statements in query_database.
  - To check recency: use DATE column, compare to CURRENT_DATE.
  - Company names and contact names may not match exactly — use ILIKE for fuzzy matching.
    Example: WHERE companies.name ILIKE '%UrbanFleet%'
"""

@tool
def query_database(sql: str) -> list[dict]:
    """
    Executes a READ-ONLY SQL SELECT query against the CRM database.
    Returns rows as a list of dicts.
    Raises an error if the query contains INSERT, UPDATE, DELETE, DROP, or ALTER.

    Args:
        sql: A valid PostgreSQL SELECT statement.
    """
    # Safety enforcement — belt AND suspenders
    normalized = sql.strip().upper()
    forbidden  = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE"]
    for keyword in forbidden:
        if keyword in normalized:
            raise ValueError(f"SAFETY VIOLATION: query_database only permits SELECT. Found: {keyword}")

    with get_db_session() as session:
        result = session.execute(text(sql))
        return [dict(row._mapping) for row in result.fetchall()]
```

TypeScript equivalent (for documentation and frontend type expectations):

```typescript
// types/agent-tools.ts

export interface GetSchemaToolInput {}
export interface GetSchemaToolOutput { schema: string }

export interface QueryDatabaseToolInput {
  sql: string;
}
export interface QueryDatabaseToolOutput {
  rows:  Record<string, unknown>[];
  count: number;
}
```

#### Write Tools

```python
@tool
def insert_interaction(
    company_id:   str,
    contact_name: str,
    date:         str,    # ISO date string "YYYY-MM-DD"
    type:         str,    # 'meeting'|'email'|'call'|'demo'|'support_call'
    notes:        str
) -> dict:
    """
    Logs a new interaction for a company. Use this when the user says they
    just spoke with, emailed, or met with someone. Do NOT modify existing records.

    Args:
        company_id:   The company's ID (e.g. "C001"). Look it up via query_database if unsure.
        contact_name: Name of the person the user spoke with.
        date:         Date of the interaction (ISO format, e.g. "2026-08-14"). Default to today if not stated.
        type:         Type of interaction (meeting/email/call/demo/support_call).
        notes:        Summary of what was discussed or decided.

    Returns:
        dict with { success: bool, interaction_id: int, company_id: str }
    """
    with get_db_session() as session:
        new_interaction = InteractionORM(
            company_id=company_id,
            contact_name=contact_name,
            date=date,
            type=type,
            notes=notes
        )
        session.add(new_interaction)
        session.commit()
        session.refresh(new_interaction)

    # Trigger rescore (async background task)
    background_tasks.add_task(priority_service.invalidate_and_rescore, company_id)

    return {
        "success":        True,
        "interaction_id": new_interaction.id,
        "company_id":     company_id
    }

@tool
def insert_company(
    name:     str,
    industry: str = None,
    status:   str = "prospect",
    size:     int = None
) -> dict:
    """
    Adds a new company to the CRM. Use when the user asks to add or create
    a new prospect or customer. The company will appear as Stale (no interactions yet).

    Args:
        name:     Company name.
        industry: Industry/sector (optional).
        status:   'prospect' or 'customer'. Defaults to 'prospect'.
        size:     Number of employees (optional).

    Returns:
        dict with { success: bool, company_id: str, name: str }
    """
    with get_db_session() as session:
        new_id  = _generate_company_id(session)
        company = CompanyORM(id=new_id, name=name, industry=industry,
                             status=status, size=size)
        # Seed a default Stale score so it appears on dashboard immediately
        score   = CompanyScoreORM(
            company_id=new_id, urgency="stale",
            reason="No interactions yet — newly added company.",
            recommended_action="Schedule an initial outreach or discovery call.",
            priority_rank=999
        )
        session.add_all([company, score])
        session.commit()

    return {"success": True, "company_id": new_id, "name": name}

@tool
def insert_contact(
    company_id: str,
    name:       str,
    role:       str = None,
    email:      str = None
) -> dict:
    """
    Adds a new contact to an existing company. Use when the user mentions
    a new person at a company they haven't logged before.

    Args:
        company_id: ID of the company this person works at.
        name:       Contact's full name.
        role:       Job title or role (optional).
        email:      Email address (optional).
    """
    with get_db_session() as session:
        new_id  = _generate_contact_id(session)
        contact = ContactORM(id=new_id, company_id=company_id,
                             name=name, role=role, email=email)
        session.add(contact)
        session.commit()

    return {"success": True, "contact_id": new_id, "name": name, "company_id": company_id}
```

### 4.4 Agent System Prompt

```python
AGENT_SYSTEM_PROMPT = """
You are a pipeline intelligence agent for a small business CRM.

Your job is to:
1. Answer questions about the user's customer and prospect relationships — accurately, grounded in real data.
2. Log new interactions when the user describes what happened ("just spoke with Tom...").
3. Add new companies and contacts when the user asks.

RULES:
- You ONLY call query_database with SELECT statements. Never modify or delete data via that tool.
- For writes, use ONLY insert_interaction, insert_company, or insert_contact.
- If you are unsure of a company_id, query the companies table first (use ILIKE for fuzzy name matching).
- If a date is not explicitly stated for a new interaction, use today ({today}).
- After inserting an interaction, tell the user: "Logged. [Company name] will be re-analysed shortly."
- If a query returns no results, say so plainly. Do NOT hallucinate data.
- Scope your SQL query to the minimum needed. If the user asks about one company, filter by company_id.

Today's date: {today}
"""
```

### 4.5 Session Handling

Chat history is maintained in **React state only** — no persistence to the database. This is an explicit architectural decision:

- Prevents session data from polluting the CRM database
- No cleanup required on session end
- Stateless backend — each POST `/api/chat` is independent at the HTTP level
- Frontend sends the full `session_history` on every message (context window management is the backend's responsibility)

```typescript
// components/chat/PipelineChat.tsx

interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

// State (React only — not persisted)
const [sessionHistory, setSessionHistory] = useState<ChatMessage[]>([]);

// On send
const handleSend = async (message: string) => {
  const userMessage: ChatMessage = { role: 'user', content: message };

  setSessionHistory(prev => [...prev, userMessage]);
  setStreamingContent('');

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      session_history: sessionHistory   // full history sent each time
    })
  });

  // Read SSE stream
  const reader = response.body!.getReader();
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const events = parseSSEChunk(value);
    for (const event of events) {
      if (event.type === 'token') {
        fullResponse += event.content;
        setStreamingContent(fullResponse);
      }
      if (event.type === 'done') {
        setSessionHistory(prev => [...prev, { role: 'assistant', content: fullResponse }]);
        setStreamingContent('');
      }
    }
  }
};
```

---

## 5. API Contracts & Server Action Signatures

### 5.1 Endpoint Overview

| Method | Path | Auth | Response | Streaming |
|---|---|---|---|---|
| GET | `/api/priorities` | — | `PrioritiesResponse` | No |
| GET | `/api/companies` | — | `CompaniesResponse` | No |
| GET | `/api/company/{id}/insight` | — | SSE stream | Yes |
| GET | `/api/company/{id}/draft` | — | SSE stream | Yes |
| POST | `/api/interactions` | — | `InteractionCreatedResponse` | No |
| POST | `/api/companies` | — | `CompanyCreatedResponse` | No |
| POST | `/api/chat` | — | SSE stream | Yes |

### 5.2 TypeScript Request / Response Types

```typescript
// ─── GET /api/priorities ──────────────────────────────────────────────────────
// Returns all companies ranked by urgency, with their scores.
// Scores come from company_scores cache. Cache misses trigger rescore.

interface PrioritiesResponse {
  companies:   CompanyWithScore[];
  stats: {
    total:         number;
    prospects:     number;
    customers:     number;
    needAttention: number;    // count of 'hot' + 'watch'
  };
  scoredAt:    string;        // ISO timestamp of oldest score in result
  fromCache:   boolean;
}

// ─── GET /api/companies ───────────────────────────────────────────────────────
// Returns raw company + contact data (no scores). Used for the quick-log dropdown.

interface CompaniesResponse {
  companies: (Company & { contacts: Contact[] })[];
}

// ─── GET /api/company/:id/insight  (SSE) ─────────────────────────────────────
// Streams the full insight for a single company.
// SSE events follow the standard SSEEvent envelope.

interface InsightSSEData {
  type:    'token' | 'section_start' | 'done' | 'error';
  content: string | null;
  // section_start signals which section is beginning
  section?: 'brief' | 'blocker' | 'draft';
}

// ─── GET /api/company/:id/draft  (SSE) ───────────────────────────────────────
// Streams a draft follow-up message for a single company.

interface DraftSSEData {
  type:    'token' | 'done' | 'error';
  content: string | null;
}

// ─── POST /api/interactions ───────────────────────────────────────────────────

interface CreateInteractionRequest {
  companyId:   string;
  contactName: string | null;
  contactId:   string | null;
  date:        string;          // ISO date "YYYY-MM-DD"
  type:        InteractionType;
  notes:       string;
}

interface InteractionCreatedResponse {
  success:       true;
  interactionId: number;
  // Updated score — available immediately because rescore is synchronous
  updatedScore:  CompanyScore;
}

// ─── POST /api/companies ──────────────────────────────────────────────────────

interface CreateCompanyRequest {
  name:     string;
  industry: string | null;
  status:   CompanyStatus;
  size:     number | null;
}

interface CompanyCreatedResponse {
  success:   true;
  companyId: string;
  name:      string;
}

// ─── POST /api/chat  (SSE) ───────────────────────────────────────────────────

interface ChatRequest {
  message:        string;
  session_history: Array<{
    role:    'user' | 'assistant';
    content: string;
  }>;
}

interface ChatSSEData {
  type:     'token' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content:  string | null;
  // Only present for tool_call / tool_result events
  toolName?: string;
  toolInput?:  Record<string, unknown>;
  toolOutput?: unknown;
}

// ─── Shared error response ────────────────────────────────────────────────────

interface ErrorResponse {
  error:   string;
  code:    'llm_timeout' | 'db_error' | 'invalid_input' | 'agent_error' | 'internal';
  detail?: string;
}
```

### 5.3 FastAPI Endpoint Signatures

```python
# routers/priorities.py

@router.get("/priorities", response_model=PrioritiesResponse)
async def get_priorities(db: AsyncSession = Depends(get_db)):
    """
    Returns all companies ranked by urgency score.
    Serves from cache where valid; triggers rescore where stale.
    """
    return await priority_service.get_or_score_all(db)


# routers/company.py

@router.get("/company/{company_id}/insight")
async def stream_company_insight(
    company_id: str,
    db: AsyncSession = Depends(get_db)
):
    """SSE stream: AI brief + blocker + recommended action for one company."""
    company = await data_service.get_company_with_interactions(company_id, db)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    async def event_generator():
        async for event in insight_service.stream_company_insight(company, db):
            yield f"data: {json.dumps(event)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'content': None})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/company/{company_id}/draft")
async def stream_draft_message(
    company_id: str,
    db: AsyncSession = Depends(get_db)
):
    """SSE stream: ready-to-send draft follow-up message."""
    company = await data_service.get_company_with_interactions(company_id, db)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    async def event_generator():
        async for event in insight_service.stream_draft_message(company):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# routers/interactions.py

@router.post("/interactions", response_model=InteractionCreatedResponse, status_code=201)
async def create_interaction(
    body: InteractionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Logs a new interaction. Synchronously invalidates the company score,
    then runs rescore as a background task (non-blocking).
    Returns the new score immediately from cache invalidation response.
    """
    interaction = await data_service.insert_interaction(body, db)
    await priority_service.invalidate_score(body.company_id, db)
    background_tasks.add_task(priority_service.invalidate_and_rescore, body.company_id)
    updated_score = await data_service.get_company_score(body.company_id, db)

    return InteractionCreatedResponse(
        success=True,
        interaction_id=interaction.id,
        updated_score=_map_score(updated_score)
    )


# routers/chat.py

@router.post("/chat")
async def pipeline_chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    """SSE stream: LangGraph SQL agent responds to user's pipeline question."""
    async def event_generator():
        async for event in agent_service.run_agent(
            message=body.message,
            session_history=body.session_history,
            db=db
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

### 5.4 Frontend Fetch Utility

```typescript
// lib/api.ts

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export async function fetchPriorities(): Promise<PrioritiesResponse> {
  const res = await fetch(`${BASE_URL}/api/priorities`);
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

export async function createInteraction(
  payload: CreateInteractionRequest
): Promise<InteractionCreatedResponse> {
  const res = await fetch(`${BASE_URL}/api/interactions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new APIError(await res.json());
  return res.json();
}

export async function* streamInsight(
  companyId: string
): AsyncGenerator<InsightSSEData> {
  const res = await fetch(`${BASE_URL}/api/company/${companyId}/insight`);
  yield* readSSEStream<InsightSSEData>(res.body!);
}

export async function* streamDraft(
  companyId: string
): AsyncGenerator<DraftSSEData> {
  const res = await fetch(`${BASE_URL}/api/company/${companyId}/draft`);
  yield* readSSEStream<DraftSSEData>(res.body!);
}

export async function* streamChat(
  payload: ChatRequest
): AsyncGenerator<ChatSSEData> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  yield* readSSEStream<ChatSSEData>(res.body!);
}

// ─── SSE stream reader (generic) ─────────────────────────────────────────────

async function* readSSEStream<T>(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<T> {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const json = line.slice(6).trim();
        if (json && json !== '[DONE]') {
          yield JSON.parse(json) as T;
        }
      }
    }
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class APIError extends Error {
  code:   string;
  detail: string | undefined;
  constructor(body: ErrorResponse) {
    super(body.error);
    this.code   = body.code;
    this.detail = body.detail;
  }
}
```

---

## 6. Error Handling & Edge Cases

### 6.1 LLM Timeout Strategy

```python
# config/settings.py

LLM_TIMEOUT_BATCH_SECONDS   = 30    # batch scoring (all companies)
LLM_TIMEOUT_INSIGHT_SECONDS = 25    # single company insight
LLM_TIMEOUT_DRAFT_SECONDS   = 20    # draft message
LLM_TIMEOUT_AGENT_SECONDS   = 60    # agent (multi-step, more slack)

# services/ai/priority_service.py

async def score_companies_batch(...):
    try:
        output = await asyncio.wait_for(
            structured_llm.ainvoke(prompt),
            timeout=LLM_TIMEOUT_BATCH_SECONDS
        )
        return _process_output(output)

    except asyncio.TimeoutError:
        logger.warning("Batch scoring timed out — serving stale/fallback scores")
        return await _serve_fallback_scores(companies, db)

    except Exception as exc:
        logger.error(f"Batch scoring failed: {exc}")
        raise HTTPException(status_code=503, detail="AI scoring temporarily unavailable")
```

### 6.2 Fallback States

| Failure Mode | Behaviour | UX |
|---|---|---|
| Batch score LLM timeout | Serve stale cached scores (even if invalidated) | Dashboard loads with a "Scores may be outdated" banner |
| No cached score at all | Return companies with urgency = `null`, reason = "Score pending" | Card shows spinner badge, retries after 5s |
| Insight LLM timeout | SSE emits `{type: "error", content: "Insight unavailable — try again"}` | Card shows error state with retry button |
| Draft LLM timeout | SSE emits `{type: "error", content: "Draft unavailable — try again"}` | Draft area shows retry button |
| Agent timeout | SSE emits `{type: "error", content: "..."}` | Chat shows error message, user can retry |
| Agent SQL syntax error | `evaluate_result` node detects error → retries with `[SQL ERROR: ...]` appended to context | Transparent to user unless all retries fail |
| Agent write tool failure | Tool returns `{success: false, error: "..."}` | Agent responds: "I couldn't log that — [reason]" |

```typescript
// components/dashboard/CompanyCard.tsx

function UrgencyBadge({ score }: { score: CompanyScore | null }) {
  if (!score) return <Badge variant="outline">Analysing...</Badge>;
  if (score.isStale) return <Badge variant="secondary">{score.urgency} (refreshing)</Badge>;
  return <Badge variant={URGENCY_VARIANT[score.urgency]}>{score.urgency.toUpperCase()}</Badge>;
}
```

### 6.3 Agent SQL Safety — Belt and Suspenders

Two layers of protection prevent the agent from mutating existing data:

**Layer 1 — Tool-level guard (Python, always runs):**
```python
# In query_database tool
FORBIDDEN_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE"]
for keyword in FORBIDDEN_KEYWORDS:
    if keyword in sql.strip().upper():
        raise ValueError(f"SAFETY VIOLATION: only SELECT permitted in query_database")
```

**Layer 2 — Database user permissions (Supabase):**
```sql
-- Create a read-only role for the agent's query tool
CREATE ROLE crm_agent_readonly;
GRANT CONNECT ON DATABASE postgres TO crm_agent_readonly;
GRANT USAGE ON SCHEMA public TO crm_agent_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_agent_readonly;

-- The write tools use the full crm_app role (INSERT only, no UPDATE/DELETE)
CREATE ROLE crm_app;
GRANT INSERT ON companies, contacts, interactions TO crm_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
-- Deliberately NOT granting UPDATE or DELETE to crm_app
```

### 6.4 Edge Cases & Guards

| Edge Case | Guard |
|---|---|
| Company with zero interactions | `build_company_context` returns `"(no interactions yet)"` — scorer assigns `stale`, action = "Schedule initial outreach" |
| Agent fuzzy company name match | Tool prompt instructs `ILIKE '%name%'` — agent disambiguates by asking user if multiple matches |
| Interaction date in the future | `InteractionCreate` Pydantic validator rejects `date > today` |
| Duplicate company insert (same name) | `insert_company` tool checks `companies WHERE name ILIKE ?` before inserting — returns existing company if found |
| Agent session context too long | Backend truncates `session_history` to last 10 turns before building agent state |
| Score TTL drift (many interactions logged quickly) | `invalidate_and_rescore` is idempotent — if called concurrently, DB upsert with `ON CONFLICT (company_id) DO UPDATE` prevents duplicates |
| LangGraph infinite loop | `retry_count` field in state enforces max 3 SQL retries; if exceeded, `formulate_answer` node responds: "I couldn't retrieve that data — please rephrase your question." |

### 6.5 Cost Optimisation

| Strategy | Mechanism | Saving |
|---|---|---|
| Score cache (24h TTL) | `company_scores` table; batch rescore only on miss | ~90% of dashboard loads served from cache |
| Partial batch rescore | Only stale company IDs are rescored, not all | Proportional to churn rate |
| Low temperature for scoring | `temperature=0.2` — less sampling, more consistent, cheaper to cache | Reduces token variance |
| Insight cache (1h TTL) | `ai_brief` + `blocker` stored in `company_scores` after first expand | Most card expands served from cache |
| Draft: no cache | Always generated fresh — draft quality degrades if stale | Intentional: stale drafts are worse than latency |
| Agent: narrow scope SQL | System prompt instructs agent to filter by company_id when possible | Smaller result sets → smaller context |
| Session history capped | Last 10 turns only — older context rarely useful for pipeline questions | Prevents unbounded token growth |

---

## Appendix A — Environment Variables

```env
# Backend (.env)
OPENROUTER_API_KEY=sk-or-...
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/crm
SCORE_TTL_HOURS=24
INSIGHT_TTL_HOURS=1
LLM_MODEL=google/gemini-flash-1.5
LOG_LEVEL=INFO

# Frontend (.env.local)
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Appendix B — Directory Structure

```
micro-crm/
├── backend/
│   ├── main.py
│   ├── config/
│   │   └── settings.py
│   ├── routers/
│   │   ├── priorities.py
│   │   ├── company.py
│   │   ├── interactions.py
│   │   └── chat.py
│   ├── services/
│   │   ├── ai/
│   │   │   ├── priority_service.py
│   │   │   ├── insight_service.py
│   │   │   └── agent_service.py
│   │   └── data_service.py
│   ├── db/
│   │   ├── database.py
│   │   ├── models.py
│   │   └── seed.py
│   ├── schemas/
│   │   ├── api.py
│   │   └── ai.py
│   └── data/
│       └── crm_data.json
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   └── layout.tsx
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── PriorityDashboard.tsx
│   │   │   ├── PipelineStats.tsx
│   │   │   ├── CompanyCard.tsx
│   │   │   ├── ExpandedCardDetail.tsx
│   │   │   ├── QuickLogForm.tsx
│   │   │   └── DraftMessagePanel.tsx
│   │   └── chat/
│   │       ├── PipelineChat.tsx
│   │       ├── MessageList.tsx
│   │       └── ChatInput.tsx
│   ├── lib/
│   │   └── api.ts
│   ├── types/
│   │   └── index.ts
│   └── hooks/
│       ├── usePriorities.ts
│       └── useCompanyInsight.ts
│
└── README.md
```

## Appendix C — Open Questions Resolution

The three open questions from PRD v1.2 are resolved as follows:

| Question | Decision | Rationale |
|---|---|---|
| Draft message format: subject line or plain? | Include subject line (`Subject: ...` on first line, blank line, then body) | More useful — user can copy-paste directly into email client without editing. |
| Chat history: within-session or independent? | Within-session (React state, max 10 turns) | Agent needs context to follow up ("what about the second one?"). No DB persistence — keeps data model clean. |
| Score refresh: timer or after interaction? | After interaction logged only (no auto-timer) | Auto-timer would waste LLM calls without new data. Manual refresh button available as escape hatch. Relationships don't move minute-to-minute. |

---

*End of Document — TDD v1.0*