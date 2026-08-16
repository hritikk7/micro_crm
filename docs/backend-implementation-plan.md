# Backend Implementation Plan

**Companion docs:** `PRD.md`, `TRD.md`, `data.md`, and the settled scope decisions in `/.claude/plans/can-you-plan-this-smooth-meadow.md` (referred to below as "Slice 1 plan").

**Priority for this build:** the agent/chat backend is the core of the product and is being built first. The dashboard-scoring backend and all frontend work come after. This doc reflects that ordering — Stage 0 is done, Stage 1 hardens what's already shipped, and dashboard/insight work is pushed to the end.

---

## Stage 0 — Done: DB layer + Pipeline Chat Agent (Slice 1)

Verified against the current tree (`backend/config`, `db`, `routers`, `schemas`, `services` all populated, `pyproject.toml` has langchain/langgraph/asyncpg/sse-starlette, `.env` exists, `data/crm_data.json` present).

| Piece | File | Status |
|---|---|---|
| Settings | `config/settings.py` | Done — `.env.example` documents the asyncpg scheme/sslmode/pooler gotchas |
| Schema DDL | `db/schema.sql` (pasted into Supabase) | Assumed done — `.env` is filled in and `/health/db` exists to verify |
| ORM models | `db/models.py` | Done |
| Async engine/session | `db/database.py` | Done — `get_db()` + `session_scope()` |
| Seed data | `data/crm_data.json`, `db/seed.py` | Done — needs a one-time run + row-count check (8/12/33) if not already done |
| Data access | `services/data_service.py` | Done |
| Agent tools | `services/ai/tools.py` | Done — 282 lines, covers the 5 tools + SQL guard |
| Agent | `services/ai/agent_service.py` | Done — `create_agent` ReAct loop, SSE envelope generator |
| API | `schemas/api.py`, `routers/chat.py` | Done — `POST /api/chat` via `EventSourceResponse` |
| App wiring | `main.py` | Done — CORS, lifespan engine disposal, `/health`, `/health/db` |

**Not yet done from Slice 1 itself:**
- No automated tests exist (`find . -iname "test*"` is empty). The Slice 1 plan's verification section (A–F: read question, fuzzy name, insert interaction, insert company, negatives/guardrails, SSE format) has presumably been run manually but isn't captured as a repeatable test.
- Unconfirmed whether the seed script has actually been executed against the live Supabase DB and whether the manual verification checklist (Slice 1 plan §Verification, tests A–F) has been fully run end-to-end.

---

## Stage 1 — Harden the agent slice before building on top of it

Do this before adding new endpoints, so regressions in the agent are caught by tests rather than manual curl sessions.

1. **Confirm the DB is live and seeded.** Run `uv run python -m db.seed`, hit `/health/db`, confirm row counts (8 companies / 12 contacts / 33 interactions).
2. **Run the Slice 1 plan's verification checklist (A–F) manually once**, if not already done, to confirm the agent is genuinely working end-to-end (fuzzy match, multi-hop, insert + invalidation, duplicate-company guard, SQL guardrail negatives, SSE framing).
3. **Add automated tests** (`pytest` + `pytest-asyncio`, already in `[dependency-groups] dev`):
   - `services/ai/tools.py` — direct `await tool.ainvoke(...)` tests, no LLM: SQL guard rejects writes/semicolons/non-SELECT, `query_database` respects `query_row_limit`, `insert_interaction`/`insert_company` resolve IDs and dedupe correctly.
   - `services/data_service.py` — CRUD + `invalidate_score` against a test DB or transaction-rolled-back fixture.
   - A smoke test hitting `/api/chat` and asserting the SSE stream terminates with a `done` event (skip/mark-slow if it requires a live LLM key).
4. **Fix anything the checklist or tests surface** — this is the point where regressions in tool docstrings, the SQL guard, or invalidation logic get caught cheaply.

---

## Stage 2 — Priority Scoring Service (`priority_service`)

Everything downstream (dashboard, insight, draft) depends on `company_scores` being populated, so this is the next real slice. Follows TRD §3.

1. **Schemas** — `schemas/ai.py`: `CompanyScoringResult`, `BatchScoringOutput`, `CompanyInsightOutput` (TRD §2.3), using `llm.with_structured_output(...)`.
2. **Prompt + context builder** — `services/ai/priority_service.py`: `build_company_context()`, `build_batch_prompt()` (TRD §3.2–3.3). Reuse `data_service` for fetching companies + interactions — don't duplicate query logic.
3. **Batch scoring call** — `score_companies_batch()` using the same `_build_llm()` pattern already established in `agent_service.py` (same OpenRouter client config, just with `.with_structured_output()` and a lower/zero temperature per TRD §3.4).
4. **Cache/invalidation logic** — `get_or_score_all()` implementing the four-state invalidation model from TRD §3.6 (valid / soft-invalidated / time-invalidated / count-invalidated). Reuse the `invalidate_score` already in `data_service.py` from Slice 1 — don't re-implement it.
5. **Single-company rescore** — `invalidate_and_rescore(company_id)`, called after any interaction insert. **Wire this into the existing `insert_interaction` agent tool** in `services/ai/tools.py` (it currently only invalidates — see Slice 1 plan's "Rescore on insert: Invalidate only" decision, which was explicitly deferred to this stage) and into the future `POST /api/interactions` endpoint (Stage 4).
6. **Timeout + fallback handling** — `asyncio.wait_for` per TRD §6.1/6.2 (serve stale scores on timeout rather than failing the request).
7. **Tests** — structured-output parsing, invalidation-state matrix, timeout fallback path.

**Exit criteria:** a script or test that seeds a fresh DB, runs `get_or_score_all()`, and gets back 8 scored companies with valid urgency/rank values.

---

## Stage 3 — Insight & Draft Streaming (`insight_service`)

Depends on Stage 2 for the score cache and shares its LLM client setup.

1. `services/ai/insight_service.py` — `build_company_context()` reuse (don't duplicate what Stage 2 built), `INSIGHT_PROMPT_TEMPLATE` (TRD §3.5), section-delimited streaming parser (`---BRIEF---` / `---BLOCKER---` / `---DRAFT---`).
2. `stream_company_insight()` — SSE generator yielding tokens, persists `ai_brief`/`blocker` to `company_scores` on completion, respects the 1h insight TTL cache.
3. `stream_draft_message()` — always-fresh (no cache, per TRD §6.5 rationale), reuses the draft section of the same prompt or a dedicated one.
4. Reuse the SSE envelope + streaming plumbing already proven in `agent_service.run_agent()` — same `stream_mode`/token-yielding pattern, same error-catching discipline (every tool/LLM call wrapped so the stream doesn't die mid-flight, per Slice 1's biggest verified risk).
5. Tests: parser correctness on malformed/partial section markers; cache hit/miss paths.

---

## Stage 4 — Dashboard & CRUD Endpoints

Thin routers over Stage 2/3 services plus two new write endpoints. Low risk, mostly wiring — do this after the AI-heavy stages so the endpoints have real data to serve.

1. `routers/priorities.py` — `GET /api/priorities` → `priority_service.get_or_score_all()`, shaped per TRD §5.2 `PrioritiesResponse` (stats: total/prospects/customers/needAttention).
2. `routers/companies.py` — `GET /api/companies` (companies + contacts, no scores — for the quick-log dropdown) and `POST /api/companies` (mirrors the agent's `insert_company` tool but as a direct REST call — reuse `data_service.create_company`, don't duplicate).
3. `routers/company.py` — `GET /api/company/{id}/insight` and `GET /api/company/{id}/draft`, both SSE, wired to Stage 3.
4. `routers/interactions.py` — `POST /api/interactions` (TRD §5.3): insert → invalidate → background-task rescore → return updated score. This is the "Quick Log Form" backend (PRD Feature 2) and the non-chat half of PRD Flow 3.
5. Update `main.py` to include the new routers.
6. **Note on session pattern:** these are non-streaming (except insight/draft) — use `Depends(get_db)` per request as TRD §5.3 shows. This is the opposite of the deliberate per-tool-session pattern in `agent_service`/`tools.py`, and that divergence is intentional (see Slice 1 plan's session-lifecycle rationale) — don't "fix" one to match the other.
7. Tests: endpoint-level integration tests for each route, including the 404 case for unknown `company_id` and the "no cached score yet" fallback state (TRD §6.2).

**Exit criteria:** every endpoint in TRD §5.1 except the chat one (already done in Stage 0) responds correctly against the seeded DB.

---

## Stage 5 — Error Handling, Edge Cases, Polish

Sweep pass once all endpoints exist — do this last so it's informed by what actually broke during Stages 2–4 rather than speculative hardening.

1. Consistent `ErrorResponse` shape (TRD §5.2) across all routers; map exceptions to `llm_timeout` / `db_error` / `invalid_input` / `agent_error` / `internal`.
2. Edge cases from TRD §6.4 not already covered: future-dated interactions rejected by Pydantic validator, zero-interaction companies scored as `stale` with a sensible default action, session-history truncation for very long chats (`AGENT_MAX_HISTORY_TURNS` is already a setting — confirm `agent_service.py` actually applies it).
3. Structured logging around LLM calls (latency, token errors) — `LOG_LEVEL` is already wired in `main.py`; extend it with per-request context.
4. Re-run the full Slice 1 verification checklist plus new Stage 2–4 tests as a single regression pass before handing off to frontend integration.

---

## Explicitly out of scope for backend (per PRD §7 Future Scope)

Company detail page, editing/deleting interactions, contact management UI, email sending, auth, revenue tracking, notifications, mobile. None of these need backend work in this build.

---

## Summary: dependency order

```
Stage 0 (done) — DB + chat agent
   │
Stage 1 — tests + verification for Stage 0
   │
Stage 2 — priority_service (scoring + cache/invalidation)
   │
   ├──> Stage 3 — insight_service (brief/blocker/draft streaming)
   │
   └──> Stage 4 — dashboard/CRUD routers (needs both 2 and 3)
              │
Stage 5 — error handling + polish sweep
```

Frontend work begins after Stage 4 has enough surface area (`/api/priorities`, `/api/companies`) for the dashboard to render against; Stage 5 can run in parallel with early frontend work.
