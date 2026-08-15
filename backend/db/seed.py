"""Seeds the database from data/crm_data.json.

Run from backend/: uv run python -m db.seed

Truncates companies/contacts/interactions/company_scores (cascade) and
reinserts from the JSON fixture. company_scores is seeded from each
company's most recent interaction's urgency (falling back to "stale" for a
company with none) — this mirrors the real write path exactly (§3.4 of the
TRD): seeding is just replaying the log through the same upsert logic a
live Quick Log Form submission would trigger.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

from sqlalchemy import text

from db.database import session_scope
from db.models import Company, CompanyScore, Contact, Interaction

DATA_PATH = Path(__file__).parent.parent / "data" / "crm_data.json"
URGENCY_RANK = {"hot": 1, "watch": 2, "stable": 3, "stale": 4}


def _load() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


async def seed(*, truncate: bool = True) -> None:
    data = _load()

    async with session_scope() as db:
        if truncate:
            await db.execute(
                text(
                    "TRUNCATE companies, contacts, interactions, company_scores "
                    "RESTART IDENTITY CASCADE"
                )
            )

        db.add_all(
            Company(
                id=c["id"],
                name=c["name"],
                industry=c["industry"],
                status=c["status"],
                size=c["size"],
            )
            for c in data["companies"]
        )
        await db.flush()

        db.add_all(
            Contact(
                id=c["id"],
                company_id=c["company_id"],
                name=c["name"],
                role=c["role"],
                email=c["email"],
            )
            for c in data["contacts"]
        )
        await db.flush()

        db.add_all(
            Interaction(
                company_id=i["company_id"],
                contact_id=i["contact_id"],
                contact_name=i["contact_name"],
                date=date.fromisoformat(i["date"]),
                type=i["type"],
                notes=i["notes"],
                urgency=i["urgency"],
            )
            for i in data["interactions"]
        )
        await db.flush()

        # company_scores: one row per company, urgency taken from that
        # company's most recent interaction (fallback "stale" if it has none).
        latest_urgency: dict[str, str] = {}
        for i in sorted(data["interactions"], key=lambda i: i["date"]):
            latest_urgency[i["company_id"]] = i["urgency"]

        db.add_all(
            CompanyScore(
                company_id=c["id"],
                urgency=latest_urgency.get(c["id"], "stale"),
                urgency_rank=URGENCY_RANK[latest_urgency.get(c["id"], "stale")],
            )
            for c in data["companies"]
        )

        await db.commit()

    print(
        f"Seeded {len(data['companies'])} companies, "
        f"{len(data['contacts'])} contacts, "
        f"{len(data['interactions'])} interactions, "
        f"{len(data['companies'])} company_scores."
    )


if __name__ == "__main__":
    asyncio.run(seed())
