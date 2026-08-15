"""Seeds the database from data/crm_data.json.

Run from backend/: uv run python -m db.seed

Truncates companies/contacts/interactions/company_scores (cascade) and
reinserts from the JSON fixture. Does NOT seed company_scores — that
table is populated by priority_service in slice 2.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

from sqlalchemy import text

from db.database import session_scope
from db.models import Company, Contact, Interaction

DATA_PATH = Path(__file__).parent.parent / "data" / "crm_data.json"


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
            )
            for i in data["interactions"]
        )

        await db.commit()

    print(
        f"Seeded {len(data['companies'])} companies, "
        f"{len(data['contacts'])} contacts, "
        f"{len(data['interactions'])} interactions."
    )


if __name__ == "__main__":
    asyncio.run(seed())
