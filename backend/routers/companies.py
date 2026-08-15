from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from schemas.api import CompaniesResponse, CompanyCreate, CompanyCreatedResponse
from services import data_service

router = APIRouter(prefix="/api", tags=["companies"])


@router.post("/companies", response_model=CompanyCreatedResponse, status_code=201)
async def create_company(
    body: CompanyCreate, db: AsyncSession = Depends(get_db)
) -> CompanyCreatedResponse:
    """Adds a new company and seeds a default company_scores row
    (urgency='stale') so it shows on the dashboard immediately."""
    company = await data_service.create_company_with_default_score(db, body)
    return CompanyCreatedResponse(company_id=company.id, name=company.name)


@router.get("/companies", response_model=CompaniesResponse)
async def get_companies(db: AsyncSession = Depends(get_db)) -> CompaniesResponse:
    """Raw company + contact data, no scores. Used for the quick-log dropdown."""
    return await data_service.get_all_companies_with_contacts(db)
