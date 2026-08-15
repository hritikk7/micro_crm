"""Tools exposed to the pipeline chat agent.

Two hard rules every tool here follows (see plan doc for why):
  1. Return a `str`, always — never a dict/list. ToolMessage.content must be
     a string anyway, and json.dumps() reads better to the model than
     Python's repr() of a dict.
  2. Catch every exception and return "ERROR: ..." instead of raising.
     create_agent's ToolNode re-raises by default, which would kill the
     whole SSE stream on the agent's first SQL typo. Returning the error as
     a tool result is what lets the model see the failure and self-correct
     on its next turn.
"""

import json
import logging
import re
from datetime import UTC, datetime
from datetime import date as date_cls

from langchain_core.tools import tool
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from config.settings import settings
from db.database import session_scope
from services import data_service

logger = logging.getLogger(__name__)

VALID_INTERACTION_TYPES = {"meeting", "email", "call", "demo", "support_call"}
VALID_STATUSES = {"prospect", "customer"}

_DB_SCHEMA = """
TABLES:
  companies(id TEXT PK, name TEXT, industry TEXT, status TEXT, size INTEGER, created_at TIMESTAMPTZ)
    status values: 'prospect', 'customer'

  contacts(id TEXT PK, company_id TEXT FK, name TEXT, role TEXT, email TEXT, created_at TIMESTAMPTZ)

  interactions(id BIGINT PK, company_id TEXT FK, contact_name TEXT, contact_id TEXT FK,
               date DATE, type TEXT, notes TEXT, created_at TIMESTAMPTZ)
    type values: 'meeting', 'email', 'call', 'demo', 'support_call'

  company_scores(company_id TEXT UK FK, urgency TEXT, reason TEXT,
                 recommended_action TEXT, priority_rank INTEGER, scored_at TIMESTAMPTZ,
                 invalidated_at TIMESTAMPTZ)
    urgency values: 'hot', 'watch', 'stable', 'stale'
    NOTE: this table may be EMPTY or missing rows for some/all companies in
    this build. Do not assume every company has a score row.

IMPORTANT CONSTRAINTS:
  - You may only use SELECT (or a read-only WITH ... SELECT) statements in query_database.
  - To check recency: use the DATE column, compare to CURRENT_DATE.
  - Company and contact names may not match exactly — use ILIKE for fuzzy matching.
    Example: WHERE companies.name ILIKE '%urbanfleet%'
""".strip()


@tool
def get_db_schema() -> str:
    """
    Returns the full database schema as a string.
    Call this once before writing your first SQL query in a session.
    """
    return _DB_SCHEMA


# ── query_database SQL safety guard ─────────────────────────────────────────
#
# Layer 1 (this function): structural checks that reject statement stacking,
# non-SELECT statement types, and SELECT ... INTO — without doing substring
# matching on the query body, which would false-positive on ordinary column
# names (e.g. "CREATE" inside "created_at", "DELETE" inside a note that
# mentions the word).
#
# Layer 2 (in query_database): the actual guarantee — the query runs inside
# a Postgres read-only transaction, so any write is rejected by the database
# itself regardless of how it's spelled or nested.
#
# Layer 3 (in query_database): result rows are capped after fetch.

_COMMENT_LINE_RE = re.compile(r"--[^\n]*")
_COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_LEADING_SELECT_WITH_RE = re.compile(r"^(select|with)\b", re.IGNORECASE)
_INTO_RE = re.compile(r"\binto\b", re.IGNORECASE)


def _validate_sql_structure(sql: str) -> str | None:
    """Returns an error message if the SQL fails structural checks, else None."""
    stripped = _COMMENT_BLOCK_RE.sub(" ", sql)
    stripped = _COMMENT_LINE_RE.sub(" ", stripped)
    stripped = stripped.strip()
    if stripped.endswith(";"):
        stripped = stripped[:-1].strip()

    if not stripped:
        return "Empty query."
    if ";" in stripped:
        return "Only a single statement is permitted (no ';' inside the query)."
    if not _LEADING_SELECT_WITH_RE.match(stripped):
        return "query_database only permits SELECT (or WITH ... SELECT) statements."
    if _INTO_RE.search(stripped):
        return "SELECT ... INTO is not permitted."
    return None


@tool
async def query_database(sql: str) -> str:
    """
    Executes a READ-ONLY SQL SELECT query against the CRM database and
    returns the rows as JSON. The query runs inside a database-level
    read-only transaction, so any write statement will be rejected by
    Postgres regardless of how it's written.

    Args:
        sql: A single valid PostgreSQL SELECT (or WITH ... SELECT) statement.
    """
    structural_error = _validate_sql_structure(sql)
    if structural_error:
        return f"ERROR: {structural_error}"

    try:
        async with session_scope() as db:
            conn = await db.connection(execution_options={"postgresql_readonly": True})
            result = await conn.execute(text(sql))
            rows = [dict(row._mapping) for row in result.fetchall()]
            await db.rollback()
    except DBAPIError as exc:
        logger.info("query_database rejected/failed: %s", exc)
        return f"ERROR: {exc.orig if exc.orig else exc}"
    except Exception as exc:
        logger.exception("query_database failed")
        return f"ERROR: {exc}"

    truncated = len(rows) > settings.query_row_limit
    rows = rows[: settings.query_row_limit]
    return json.dumps({"row_count": len(rows), "truncated": truncated, "rows": rows}, default=str)


@tool
async def insert_interaction(
    company_id: str,
    contact_name: str,
    date: str,
    type: str,
    notes: str,
) -> str:
    """
    Logs a new interaction for a company. Use this when the user says they
    just spoke with, emailed, or met with someone. Do NOT modify existing
    records — this only inserts.

    Args:
        company_id: The company's ID (e.g. "C001"). Look it up via
            query_database first if you're not sure (use ILIKE on name).
        contact_name: Name of the person the user spoke with.
        date: Date of the interaction, ISO format "YYYY-MM-DD". Default to
            today if the user doesn't state one.
        type: One of: meeting, email, call, demo, support_call.
        notes: Summary of what was discussed or decided.
    """
    if type not in VALID_INTERACTION_TYPES:
        return f"ERROR: type must be one of {sorted(VALID_INTERACTION_TYPES)}, got '{type}'."

    try:
        parsed_date = date_cls.fromisoformat(date)
    except ValueError:
        return f"ERROR: date must be ISO format YYYY-MM-DD, got '{date}'."

    if parsed_date > datetime.now(UTC).date():
        return f"ERROR: date '{date}' is in the future."

    try:
        async with session_scope() as db:
            company = await data_service.get_company(db, company_id)
            if company is None:
                return f"ERROR: no company with id '{company_id}'. Look it up via query_database first."

            contact_id = await data_service.resolve_contact_id(db, company_id, contact_name)

            interaction = await data_service.create_interaction(
                db,
                company_id=company_id,
                contact_name=contact_name,
                contact_id=contact_id,
                interaction_date=parsed_date,
                type_=type,
                notes=notes,
            )
            await data_service.invalidate_score(db, company_id)
            await db.commit()
    except Exception as exc:
        logger.exception("insert_interaction failed")
        return f"ERROR: {exc}"

    return json.dumps(
        {"success": True, "interaction_id": interaction.id, "company_id": company_id}
    )


@tool
async def insert_company(
    name: str,
    industry: str | None = None,
    status: str = "prospect",
    size: int | None = None,
) -> str:
    """
    Adds a new company to the CRM. Use when the user asks to add or create a
    new prospect or customer.

    Args:
        name: Company name.
        industry: Industry/sector (optional).
        status: 'prospect' or 'customer'. Defaults to 'prospect'.
        size: Number of employees (optional).
    """
    if status not in VALID_STATUSES:
        return f"ERROR: status must be one of {sorted(VALID_STATUSES)}, got '{status}'."

    try:
        async with session_scope() as db:
            existing = await data_service.find_companies_by_name(db, name, limit=1)
            if existing:
                match = existing[0]
                return json.dumps(
                    {
                        "success": True,
                        "already_exists": True,
                        "company_id": match.id,
                        "name": match.name,
                    }
                )

            company = await data_service.create_company(
                db, name=name, industry=industry, status=status, size=size
            )
            await db.commit()
    except Exception as exc:
        logger.exception("insert_company failed")
        return f"ERROR: {exc}"

    return json.dumps({"success": True, "already_exists": False, "company_id": company.id, "name": company.name})


@tool
async def insert_contact(
    company_id: str,
    name: str,
    role: str | None = None,
    email: str | None = None,
) -> str:
    """
    Adds a new contact to an existing company. Use when the user mentions a
    new person at a company they haven't logged before.

    Args:
        company_id: ID of the company this person works at.
        name: Contact's full name.
        role: Job title or role (optional).
        email: Email address (optional).
    """
    try:
        async with session_scope() as db:
            company = await data_service.get_company(db, company_id)
            if company is None:
                return f"ERROR: no company with id '{company_id}'. Look it up via query_database first."

            contact = await data_service.create_contact(
                db, company_id=company_id, name=name, role=role, email=email
            )
            await db.commit()
    except Exception as exc:
        logger.exception("insert_contact failed")
        return f"ERROR: {exc}"

    return json.dumps(
        {"success": True, "contact_id": contact.id, "name": contact.name, "company_id": company_id}
    )


ALL_TOOLS = [get_db_schema, query_database, insert_interaction, insert_company, insert_contact]
