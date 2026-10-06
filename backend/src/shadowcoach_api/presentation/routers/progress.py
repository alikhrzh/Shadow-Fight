from typing import Annotated

from fastapi import APIRouter, Query

from shadowcoach_api.domain.enums import Move

from ..dependencies import CurrentUser, Progress
from ..schemas import MoveProgressResponse, ProgressPointResponse, ProgressSummaryResponse

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("/summary", response_model=ProgressSummaryResponse)
async def summary(progress: Progress, user: CurrentUser) -> ProgressSummaryResponse:
    moves = await progress.summary(user.id)
    return ProgressSummaryResponse(
        reliable_attempts=sum(item.count for item in moves),
        moves=[MoveProgressResponse.from_domain(item) for item in moves],
    )


@router.get("/timeline", response_model=list[ProgressPointResponse])
async def timeline(
    progress: Progress,
    user: CurrentUser,
    move: Move | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 30,
) -> list[ProgressPointResponse]:
    points = await progress.timeline(user.id, move, limit)
    return [ProgressPointResponse.from_domain(point) for point in points]
