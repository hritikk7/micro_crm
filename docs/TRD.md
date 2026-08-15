# Technical Design Document
## AI-Powered Micro-CRM

---

**Version:** 1.1  
**Status:** Draft  
**Author:** Ritik  
**Last Updated:** August 2026  
**Companion Document:** PRD v1.2  
**Changes from v1.0:** Sections 1.2, 1.3, 2.1–2.4, 3, 4.3, 5.1–5.3, 6, Appendices A/B/C — the AI priority-scoring engine (`priority_service`, batch/single LLM scoring, 24h TTL invalidation) is removed. Urgency is now a label the user picks (Hot/Watch/Stable/Stale) when logging an interaction via the Quick Log Form; it's written straight to the DB and the dashboard just reads and sorts. `insight_service` (per-company AI brief + draft message) is unchanged in spirit but no longer caches into `company_scores`, since that table no longer carries AI-generated fields — it regenerates on every request instead. `POST /api/companies`, `GET /api/companies`, and `POST /api/interactions` are confirmed in-scope as plain REST endpoints (Quick Log Form needs a non-chat way to write).

---

## Table of Contents

1. [[System Architecture & Component Interaction](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#1-system-architecture--component-interaction)](#1-system-architecture--component-interaction)
2. [[Database Schema & Data Models](https://claude.ai/chat/16b3c988-ecfe-4db7-a9c5-cc5b5e60874c#2-database-schema--data-models)](#2-database-schema--data-models)
3. [Urgency Model](#3-urgency-model)
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
│  │      insight_service      agent_service      data_service     │ │
│  └──────────────────────────────┬─────────────────────────────┘  │
│                                  │                                 │
│  ┌───────────────────────────────▼───────────────────────────┐   │
│  │                      AI Layer                              │   │
│  │  LangChain (Insight + Draft)          LangGraph (Agent)   │   │
│  │  ─────────────────────────            ─────────────────   │   │
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
| insight_service | Streams per-company AI brief + draft via LangChain | Urgency, ranking |
| agent_service | Runs LangGraph SQL agent loop, handles write tools | Urgency, ranking |
| data_service | Raw DB queries (no AI), used by all services — including the urgency read/write path | AI calls |

> **Note:** `priority_service` is removed. There is no AI scoring engine. Urgency is a value the user picks when logging an interaction (§3), stored directly, and read straight off `company_scores` for the dashboard — zero LLM calls in that path.

### 1.3 Data Flow — Primary User Flows

#### Flow A: Dashboard Load

```
Browser
  1. GET /api/priorities
        → data_service: fetch all companies JOIN company_scores
        → ORDER BY urgency_rank ASC (hot=1, watch=2, stable=3, stale=4)
        → return ranked CompanyWithScore[]
        → zero AI calls — pure DB read
  2. GET /api/companies (parallel)
        → data_service: fetch all companies + contacts
        → return Company[] with Contact[]
```

#### Flow B: Card Expand → Insight Streaming

```
Browser (user clicks card)
  1. GET /api/company/{id}/insight  (SSE)
        → data_service: fetch company + all interactions + contacts
        → insight_service: LangChain streaming call (no cache)
            → builds per-company prompt context
            → streams ai_brief + blocker + next_action tokens via SSE
        → nothing persisted — regenerated on every expand
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
  1. User fills Quick Log Form: Contact, Type, Notes, Urgency (Hot/Watch/Stable/Stale)
  2. POST /api/interactions  { company_id, contact_name, contact_id, type, notes, date, urgency }
        → data_service: INSERT into interactions (urgency included)
        → data_service: UPSERT company_scores
              SET urgency = body.urgency,
                  urgency_rank = URGENCY_RANK[body.urgency],
                  updated_at = NOW()
              WHERE company_id = body.company_id
        → return { success: true, interaction_id }
        → zero AI calls — the user's own selection IS the score
  3. Frontend re-fetches /api/priorities → dashboard re-sorts immediately
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
                → node: call insert tool → DB write only
                → interactions logged via chat leave urgency = NULL and do NOT
                  touch company_scores — urgency is set only through the Quick
                  Log Form (Flow D). Chat is for logging/asking, not ranking.
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
    urgency         TEXT        CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
                                -- user-selected on the Quick Log Form; NULL for
                                -- interactions logged via chat (chat doesn't set urgency)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queries: all interactions for a company (dashboard + agent)
CREATE INDEX idx_interactions_company     ON interactions(company_id);
-- Queries: most recent interaction per company (recency)
CREATE INDEX idx_interactions_company_date ON interactions(company_id, date DESC);
-- Agent queries: search interactions by contact
CREATE INDEX idx_interactions_contact     ON interactions(contact_id);

-- ─────────────────────────────────────────────
-- company_scores
-- Stores the current urgency state per company, as picked by the user.
-- Written whenever a Quick Log Form submission includes an urgency label.
-- Read by the dashboard — no AI calls at read time.
-- ─────────────────────────────────────────────
CREATE TABLE company_scores (
    id           BIGSERIAL   PRIMARY KEY,
    company_id   TEXT        NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    urgency      TEXT        NOT NULL
                 CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
    urgency_rank INTEGER     NOT NULL,   -- hot=1, watch=2, stable=3, stale=4
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard primary query: all scores ranked
CREATE INDEX idx_company_scores_rank  ON company_scores(urgency_rank ASC);
-- Upsert-on-log query
CREATE INDEX idx_company_scores_co_id ON company_scores(company_id);
```

> **Design note:** `urgency` is stored on `interactions` (historical record of what the user picked at that moment, nullable) and separately on `company_scores` (current dashboard state, always set). Every company gets a default `company_scores` row (`urgency='stale'`) at seed time / company-creation time so the dashboard always has something to show, even before any interaction is logged.

### 2.2 TypeScript Data Models

```typescript
// ─── Shared enums ───────────────────────────────────────────────────────────

export type CompanyStatus   = 'prospect' | 'customer';
export type UrgencyLevel    = 'hot' | 'watch' | 'stable' | 'stale';
export type InteractionType = 'meeting' | 'email' | 'call' | 'demo' | 'support_call';

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  hot: 1, watch: 2, stable: 3, stale: 4,
};

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
  urgency:      UrgencyLevel | null;  // null for chat-logged interactions
  created_at:   string;
}

export interface CompanyScoreRow {
  id:           number;
  company_id:   string;
  urgency:      UrgencyLevel;
  urgency_rank: number;
  updated_at:   string;
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
  urgency:     UrgencyLevel | null;
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
  urgency:     UrgencyLevel;
  urgencyRank: number;
  updatedAt:   string;
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
from pydantic import BaseModel, Field, validator
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
    urgency      = Column(String, nullable=True)   # null for chat-logged interactions
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

class CompanyScoreORM(Base):
    __tablename__ = "company_scores"
    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id   = Column(String, ForeignKey("companies.id"), unique=True, nullable=False)
    urgency      = Column(String, nullable=False)
    urgency_rank = Column(Integer, nullable=False)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now())

# ─── Pydantic request / response schemas ─────────────────────────────────────

class InteractionCreate(BaseModel):
    company_id:   str
    contact_name: Optional[str] = None
    contact_id:   Optional[str] = None
    date:         date
    type:         InteractionType
    notes:        str = Field(..., min_length=1, max_length=2000)
    urgency:      UrgencyLevel     # required on the Quick Log Form path

    @validator("date")
    def date_not_in_future(cls, v):
        if v > date.today():
            raise ValueError("Interaction date cannot be in the future")
        return v

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

# ─── AI structured output schemas — insight + draft only (scoring removed) ────

class CompanyInsightOutput(BaseModel):
    """Structured output for per-company deep insight (non-streaming alternative)."""
    ai_brief:    str = Field(..., description="2-3 sentences on where the relationship stands.")
    blocker:     str = Field(..., description="The single thing blocking progress.")
    next_action: str = Field(..., description="Specific action with full context.")
```

### 2.4 Indexes & Query Optimisation

| Query | Index Used | Estimated cost |
|---|---|---|
| Dashboard: all scores ranked | `idx_company_scores_rank` | Sequential scan (8 rows, trivial) |
| Urgency upsert on interaction log | `idx_company_scores_co_id` (unique) | Index seek |
| Context builder: all interactions for a company | `idx_interactions_company` | Index range scan |
| Last-contact date per company | `idx_interactions_company_date` | Index range scan, LIMIT 1 |
| Agent: interactions for a contact name | `idx_interactions_contact` | Index scan |
| Company contacts for quick-log dropdown | `idx_contacts_company` | Index scan |

---

## 3. Urgency Model

### 3.1 How Urgency Works

Urgency is **user-set**, not AI-inferred. When logging an interaction via the
Quick Log Form, the user picks one of four labels. That label is written to
both `interactions` (historical record of what was picked, nullable) and
`company_scores` (current dashboard state, always set).

The dashboard reads `company_scores` directly and sorts by `urgency_rank`.
No LLM call is involved in this path at all.

```
User fills Quick Log Form (Contact, Type, Notes, Urgency)
  → INSERT into interactions (urgency included)
  → UPSERT into company_scores (urgency + urgency_rank)
  → Dashboard GET /api/priorities reads company_scores
  → Sorts by urgency_rank ASC
  → Done
```

Interactions logged through the **chat agent** do not set urgency — the
agent's `insert_interaction` tool has no urgency argument, the DB column is
nullable, and `company_scores` is left untouched. Chat is for logging and
asking, not for ranking; urgency only ever changes through the form.

### 3.2 Urgency Rank Mapping

| Label | Rank | Meaning |
|---|---|---|
| 🔴 Hot | 1 | Time-sensitive commitment, deal going quiet |
| 🟡 Watch | 2 | Open question, slow response, competitor risk |
| 🟢 Stable | 3 | Clear next step, known timeline |
| ⚫ Stale | 4 | No meaningful contact in 60+ days |

### 3.3 Seed-Time / Company-Creation Default

Every company gets an initial `company_scores` row the moment it exists —
at seed time, and again whenever `insert_company`/`POST /api/companies`
creates a new one — with `urgency='stale'`, `urgency_rank=4`. This
guarantees the dashboard always has something to show, even before the
first interaction is logged.

```python
# db/seed.py

def seed_default_scores(session, companies):
    for company in companies:
        session.add(CompanyScoreORM(
            company_id=company.id, urgency="stale", urgency_rank=4
        ))
    session.commit()
```

### 3.4 Write Path (data_service)

```python
# services/data_service.py

URGENCY_RANK = {"hot": 1, "watch": 2, "stable": 3, "stale": 4}

async def log_interaction_and_update_score(
    body: InteractionCreate,
    db: AsyncSession
) -> InteractionORM:
    # 1. Insert interaction (urgency required by InteractionCreate)
    interaction = InteractionORM(
        company_id=body.company_id,
        contact_name=body.contact_name,
        contact_id=body.contact_id,
        date=body.date,
        type=body.type,
        notes=body.notes,
        urgency=body.urgency,
    )
    db.add(interaction)

    # 2. Upsert company_scores — this IS the "scoring" step, no LLM involved
    await db.execute(
        """
        INSERT INTO company_scores (company_id, urgency, urgency_rank, updated_at)
        VALUES (:company_id, :urgency, :urgency_rank, NOW())
        ON CONFLICT (company_id) DO UPDATE
            SET urgency      = EXCLUDED.urgency,
                urgency_rank = EXCLUDED.urgency_rank,
                updated_at   = NOW()
        """,
        {
            "company_id":   body.company_id,
            "urgency":      body.urgency,
            "urgency_rank": URGENCY_RANK[body.urgency],
        }
    )

    await db.commit()
    await db.refresh(interaction)
    return interaction
```

### 3.5 Insight Streaming (Per-Company) — separate AI feature, unrelated to ranking

`insight_service` is still an AI feature — it just has nothing to do with
urgency or ranking. It's triggered when the user expands a company card
(Flow B) or asks for a draft message (Flow C), and it doesn't cache into
`company_scores` (that table no longer has AI-generated columns) — it
regenerates on every request.

```python
# services/ai/insight_service.py

INSIGHT_PROMPT_TEMPLATE = """
You are a relationship intelligence assistant. Analyse this single company relationship and provide:

1. ai_brief: 2-3 sentences on where the relationship stands right now.
   Be specific — reference real names, dates, and what was said.

2. blocker: The single most important thing preventing progress.
   One sentence. Be specific.

3. next_action: A specific, concrete next step — not "follow up soon."

Respond in this exact format:
---BRIEF---
[your ai_brief here]
---BLOCKER---
[your blocker here]
---NEXT_ACTION---
[your next_action here]

COMPANY CONTEXT:
{company_context}
"""

async def stream_company_insight(
    company: CompanyORM,
    db: AsyncSession
) -> AsyncIterator[dict]:
    """Yields SSE dicts. Caller is responsible for SSE framing. No cache — regenerated every call."""
    prompt = INSIGHT_PROMPT_TEMPLATE.format(
        company_context=build_company_context(company)
    )
    async for chunk in streaming_llm.astream(prompt):
        yield {"type": "token", "content": chunk.content}
    yield {"type": "done", "content": None}
```

`build_company_context` (name, status, industry, size, contacts, last-contact
recency, full interaction history) is unchanged from the original design —
it's just no longer fed into a scoring prompt, only the insight/draft ones.

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
               date DATE, type TEXT, notes TEXT, urgency TEXT, created_at TIMESTAMPTZ)
    type values: 'meeting', 'email', 'call', 'demo', 'support_call'
    urgency: user-set on the Quick Log Form; NULL for interactions logged via chat

  company_scores(company_id TEXT UK FK, urgency TEXT, urgency_rank INTEGER, updated_at TIMESTAMPTZ)
    urgency values: 'hot', 'watch', 'stable', 'stale' — user-set, not AI-scored.
    This tool cannot change it; only the Quick Log Form (POST /api/interactions) can.

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
    This tool does NOT set urgency — urgency is only ever set by the user via
    the Quick Log Form, never inferred by the agent.

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
            notes=notes,
            urgency=None,   # chat never sets urgency; company_scores is untouched
        )
        session.add(new_interaction)
        session.commit()
        session.refresh(new_interaction)

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
        score   = CompanyScoreORM(company_id=new_id, urgency="stale", urgency_rank=4)
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
// Returns all companies ranked by urgency_rank. Pure DB read — no AI calls.

interface PrioritiesResponse {
  companies: CompanyWithScore[];
  stats: {
    total:         number;
    prospects:     number;
    customers:     number;
    needAttention: number;    // count of 'hot' + 'watch'
  };
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
  urgency:     UrgencyLevel;    // user-selected: hot | watch | stable | stale
}

interface InteractionCreatedResponse {
  success:       true;
  interactionId: number;
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
    Returns all companies ranked by urgency_rank.
    Pure DB read — no AI calls.
    """
    return await data_service.get_all_with_scores(db)


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
    db: AsyncSession = Depends(get_db)
):
    """
    Logs a new interaction and upserts company_scores with the user-set
    urgency. No AI calls — pure DB write.
    """
    interaction = await data_service.log_interaction_and_update_score(body, db)
    return InteractionCreatedResponse(success=True, interaction_id=interaction.id)


# routers/companies.py

@router.post("/companies", response_model=CompanyCreatedResponse, status_code=201)
async def create_company(
    body: CompanyCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Adds a new company and seeds a default company_scores row
    (urgency='stale') so it shows on the dashboard immediately.
    """
    company = await data_service.create_company_with_default_score(body, db)
    return CompanyCreatedResponse(success=True, company_id=company.id, name=company.name)


@router.get("/companies", response_model=CompaniesResponse)
async def get_companies(db: AsyncSession = Depends(get_db)):
    """Raw company + contact data, no scores. Used for the quick-log dropdown."""
    return await data_service.get_all_companies_with_contacts(db)


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

LLM_TIMEOUT_INSIGHT_SECONDS = 25    # single company insight
LLM_TIMEOUT_DRAFT_SECONDS   = 20    # draft message
LLM_TIMEOUT_AGENT_SECONDS   = 60    # agent (multi-step, more slack)

# services/ai/insight_service.py

async def stream_company_insight(...):
    try:
        async for chunk in asyncio.wait_for(
            streaming_llm.astream(prompt), timeout=LLM_TIMEOUT_INSIGHT_SECONDS
        ):
            yield {"type": "token", "content": chunk.content}

    except asyncio.TimeoutError:
        logger.warning("Insight generation timed out")
        yield {"type": "error", "content": "Insight unavailable — try again"}
```

`GET /api/priorities` has no LLM timeout concern at all — it's a plain DB read.

### 6.2 Fallback States

| Failure Mode | Behaviour | UX |
|---|---|---|
| Priorities DB read fails | Standard 500 — no AI involved, so no "stale/fallback score" concept needed | Dashboard shows a retry banner |
| Insight LLM timeout | SSE emits `{type: "error", content: "Insight unavailable — try again"}` | Card shows error state with retry button |
| Draft LLM timeout | SSE emits `{type: "error", content: "Draft unavailable — try again"}` | Draft area shows retry button |
| Agent timeout | SSE emits `{type: "error", content: "..."}` | Chat shows error message, user can retry |
| Agent SQL syntax error | Tool returns the error string as its result; the model sees it and retries, bounded by `agent_recursion_limit` | Transparent to user unless retries exhaust |
| Agent write tool failure | Tool returns `"ERROR: ..."` string instead of raising | Agent responds: "I couldn't log that — [reason]" |
| Quick Log Form validation failure | `InteractionCreate` Pydantic validation (e.g. missing urgency, future date) → 422 | Form shows inline field error |

```typescript
// components/dashboard/CompanyCard.tsx

function UrgencyBadge({ score }: { score: CompanyScore } ) {
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
| Company with zero interactions | `company_scores` seeded with `urgency='stale'` at creation time — nothing to compute |
| Agent fuzzy company name match | Tool prompt instructs `ILIKE '%name%'` — agent disambiguates by asking user if multiple matches |
| Interaction date in the future | `InteractionCreate` Pydantic validator rejects `date > today` |
| Duplicate company insert (same name) | `insert_company` tool / `POST /api/companies` checks `companies WHERE name ILIKE ?` before inserting — returns existing company if found |
| Agent session context too long | Backend truncates `session_history` to last 10 turns before building agent state |
| Concurrent Quick Log Form submissions for the same company | `ON CONFLICT (company_id) DO UPDATE` on the `company_scores` upsert — last write wins, no duplicate rows |
| Agent recursion / tool-call loop | `agent_recursion_limit` bounds total steps; if exceeded, the stream emits a `GraphRecursionError`-derived error event asking the user to rephrase |

### 6.5 Cost Optimisation

| Strategy | Mechanism | Saving |
|---|---|---|
| No scoring LLM calls at all | Urgency is user-set, `/api/priorities` is a pure DB read | Eliminates the single largest LLM cost driver in the original design |
| Insight: no cache, generated on demand only | Only called when a user actually expands a card | No background/batch cost — cost scales with real usage |
| Draft: no cache | Always generated fresh — draft quality degrades if stale | Intentional: stale drafts are worse than latency |
| Agent: narrow scope SQL | System prompt instructs agent to filter by company_id when possible | Smaller result sets → smaller context |
| Session history capped | Last 10 turns only — older context rarely useful for pipeline questions | Prevents unbounded token growth |

---

## Appendix A — Environment Variables

```env
# Backend (.env)
OPENROUTER_API_KEY=sk-or-...
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/crm
LLM_MODEL=openai/gpt-4o-mini
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
│   │   ├── companies.py
│   │   ├── company.py
│   │   ├── interactions.py
│   │   └── chat.py
│   ├── services/
│   │   ├── ai/
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
| Score refresh: timer or user action? | User action only — picked directly on the Quick Log Form, no timer, no LLM | v1.1: superseded the original "AI rescore on a timer/invalidation" question entirely — there's no score to refresh, only a label to re-pick next time the user logs an interaction. |

---

*End of Document — TDD v1.1*