from fastapi import APIRouter

from ..dependencies import CurrentUser
from ..schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse.from_domain(user)
