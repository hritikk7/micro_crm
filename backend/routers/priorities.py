from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from schemas.api import PrioritiesResponse
from services import data_service

router = APIRouter(prefix="/api", tags=["priorities"])


@router.get("/priorities", response_model=PrioritiesResponse)
async def get_priorities(db: AsyncSession = Depends(get_db)) -> PrioritiesResponse:
    """Returns all companies ranked by urgency_rank. Pure DB read — no AI calls."""
    return await data_service.get_all_with_scores(db)
