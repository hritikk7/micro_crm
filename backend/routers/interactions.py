from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from schemas.api import InteractionCreate, InteractionCreatedResponse
from services import data_service

router = APIRouter(prefix="/api", tags=["interactions"])


@router.post("/interactions", response_model=InteractionCreatedResponse, status_code=201)
async def create_interaction(
    body: InteractionCreate, db: AsyncSession = Depends(get_db)
) -> InteractionCreatedResponse:
    """Logs a new interaction and upserts company_scores with the user-set
    urgency. No AI calls — pure DB write."""
    try:
        interaction = await data_service.log_interaction_and_update_score(db, body)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=404, detail=f"No company with id '{body.company_id}'."
        ) from None

    return InteractionCreatedResponse(interaction_id=interaction.id)
