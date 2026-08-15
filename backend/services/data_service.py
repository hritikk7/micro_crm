"""Plain async data access — no AI, no SQL-safety concerns (all queries here
are app-authored, not agent-authored). Used by the agent's write tools.
"""

import re
from datetime import UTC, date, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Company, CompanyScore, Contact, Interaction

_ID_SUFFIX_RE = re.compile(r"^[A-Z](\d+)$")


async def find_companies_by_name(db: AsyncSession, name: str, limit: int = 5) -> list[Company]:
    stmt = select(Company).where(Company.name.ilike(f"%{name}%")).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_company(db: AsyncSession, company_id: str) -> Company | None:
    return await db.get(Company, company_id)


async def _next_id(db: AsyncSession, model, prefix: str, width: int = 3) -> str:
    stmt = select(model.id).where(model.id.like(f"{prefix}%")).order_by(model.id.desc()).limit(1)
    result = await db.execute(stmt)
    last_id = result.scalar_one_or_none()
    if last_id is None:
        return f"{prefix}{1:0{width}d}"
    match = _ID_SUFFIX_RE.match(last_id)
    n = int(match.group(1)) + 1 if match else 1
    return f"{prefix}{n:0{width}d}"


async def next_company_id(db: AsyncSession) -> str:
    return await _next_id(db, Company, "C")


async def next_contact_id(db: AsyncSession) -> str:
    return await _next_id(db, Contact, "P")


async def resolve_contact_id(db: AsyncSession, company_id: str, contact_name: str) -> str | None:
    """Best-effort match of a free-text contact name to a contact within the company."""
    stmt = (
        select(Contact.id)
        .where(Contact.company_id == company_id, Contact.name.ilike(f"%{contact_name}%"))
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_interaction(
    db: AsyncSession,
    *,
    company_id: str,
    contact_name: str | None,
    contact_id: str | None,
    interaction_date: date,
    type_: str,
    notes: str,
) -> Interaction:
    interaction = Interaction(
        company_id=company_id,
        contact_name=contact_name,
        contact_id=contact_id,
        date=interaction_date,
        type=type_,
        notes=notes,
    )
    db.add(interaction)
    await db.flush()
    await db.refresh(interaction)
    return interaction


async def create_company(
    db: AsyncSession,
    *,
    name: str,
    industry: str | None,
    status: str,
    size: int | None,
) -> Company:
    new_id = await next_company_id(db)
    company = Company(id=new_id, name=name, industry=industry, status=status, size=size)
    db.add(company)
    await db.flush()
    await db.refresh(company)
    return company


async def create_contact(
    db: AsyncSession,
    *,
    company_id: str,
    name: str,
    role: str | None,
    email: str | None,
) -> Contact:
    new_id = await next_contact_id(db)
    contact = Contact(id=new_id, company_id=company_id, name=name, role=role, email=email)
    db.add(contact)
    await db.flush()
    await db.refresh(contact)
    return contact


async def invalidate_score(db: AsyncSession, company_id: str) -> None:
    """No-op if no score row exists yet (expected in slice 1 — company_scores
    isn't seeded until priority_service exists)."""
    stmt = (
        update(CompanyScore)
        .where(CompanyScore.company_id == company_id)
        .values(invalidated_at=datetime.now(UTC))
    )
    await db.execute(stmt)
