"""Plain async data access — no AI, no SQL-safety concerns (all queries here
are app-authored, not agent-authored). Used by the agent's write tools and
by the REST routers (priorities/companies/interactions).
"""

import re
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Company, CompanyScore, Contact, Interaction
from schemas.api import (
    URGENCY_RANK,
    CompaniesResponse,
    CompanyCreate,
    CompanyOut,
    CompanyScoreOut,
    CompanyWithScore,
    ContactOut,
    InteractionCreate,
    InteractionOut,
    PrioritiesResponse,
    PrioritiesStats,
)

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
    urgency: str | None = None,
) -> Interaction:
    interaction = Interaction(
        company_id=company_id,
        contact_name=contact_name,
        contact_id=contact_id,
        date=interaction_date,
        type=type_,
        notes=notes,
        urgency=urgency,
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


async def log_interaction_and_update_score(
    db: AsyncSession, body: InteractionCreate
) -> Interaction:
    """Inserts the interaction, then upserts company_scores with the
    user-set urgency. No AI calls — pure DB write (TRD v1.1 §3.4)."""
    interaction = await create_interaction(
        db,
        company_id=body.company_id,
        contact_name=body.contact_name,
        contact_id=body.contact_id,
        interaction_date=body.date,
        type_=body.type,
        notes=body.notes,
        urgency=body.urgency,
    )

    stmt = pg_insert(CompanyScore).values(
        company_id=body.company_id,
        urgency=body.urgency,
        urgency_rank=URGENCY_RANK[body.urgency],
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[CompanyScore.company_id],
        set_={
            "urgency": stmt.excluded.urgency,
            "urgency_rank": stmt.excluded.urgency_rank,
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)

    await db.commit()
    await db.refresh(interaction)
    return interaction


async def create_company_with_default_score(db: AsyncSession, body: CompanyCreate) -> Company:
    """Adds a new company and seeds a default company_scores row
    (urgency='stale') so it appears on the dashboard immediately."""
    company = await create_company(
        db, name=body.name, industry=body.industry, status=body.status, size=body.size
    )
    db.add(CompanyScore(company_id=company.id, urgency="stale", urgency_rank=4))
    await db.commit()
    await db.refresh(company)
    return company


async def get_all_companies_with_contacts(db: AsyncSession) -> CompaniesResponse:
    """Raw company + contact data, no scores. Used for the quick-log dropdown."""
    result = await db.execute(select(Company))
    companies = result.scalars().all()
    return CompaniesResponse(
        companies=[
            CompanyOut(
                id=c.id,
                name=c.name,
                industry=c.industry,
                status=c.status,
                size=c.size,
                contacts=[
                    ContactOut(id=ct.id, name=ct.name, role=ct.role, email=ct.email)
                    for ct in c.contacts
                ],
            )
            for c in companies
        ]
    )


async def get_all_with_scores(db: AsyncSession) -> PrioritiesResponse:
    """All companies ranked by urgency_rank. Pure DB read — no AI calls.

    Company.score / .interactions are lazy="selectin" (see db/models.py) —
    already loaded, no extra query needed here. A company can be missing a
    score row only if seed/creation was bypassed; falls back to stale/4
    rather than silently dropping it from the response.
    """
    result = await db.execute(select(Company))
    companies = result.scalars().all()

    items: list[CompanyWithScore] = []
    for c in companies:
        score = c.score
        score_out = (
            CompanyScoreOut(
                urgency=score.urgency, urgency_rank=score.urgency_rank, updated_at=score.updated_at
            )
            if score is not None
            else CompanyScoreOut(urgency="stale", urgency_rank=4, updated_at=c.created_at)
        )

        last = c.interactions[0] if c.interactions else None
        last_out = (
            InteractionOut(
                id=last.id,
                contact_name=last.contact_name,
                contact_id=last.contact_id,
                date=last.date,
                type=last.type,
                notes=last.notes,
                urgency=last.urgency,
                created_at=last.created_at,
            )
            if last is not None
            else None
        )

        items.append(
            CompanyWithScore(
                id=c.id,
                name=c.name,
                industry=c.industry,
                status=c.status,
                size=c.size,
                contacts=[
                    ContactOut(id=ct.id, name=ct.name, role=ct.role, email=ct.email)
                    for ct in c.contacts
                ],
                score=score_out,
                last_interaction=last_out,
                last_contact_date=last.date if last is not None else None,
            )
        )

    items.sort(key=lambda item: item.score.urgency_rank)

    stats = PrioritiesStats(
        total=len(items),
        prospects=sum(1 for c in companies if c.status == "prospect"),
        customers=sum(1 for c in companies if c.status == "customer"),
        need_attention=sum(1 for item in items if item.score.urgency in ("hot", "watch")),
    )
    return PrioritiesResponse(companies=items, stats=stats)
