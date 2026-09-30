from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from shadowcoach_api.domain.enums import AttemptStatus, Move

from ..dependencies import Attempts, CurrentUser
from ..schemas import (
    AttemptCreatedResponse,
    AttemptCreateRequest,
    AttemptPageResponse,
    AttemptResponse,
)

router = APIRouter(prefix="/attempts", tags=["training attempts"])


@router.post("", response_model=AttemptCreatedResponse)
async def create_attempt(
    payload: AttemptCreateRequest,
    response: Response,
    attempts: Attempts,
    user: CurrentUser,
) -> AttemptCreatedResponse:
    result = await attempts.create(user.id, payload.to_command())
    attempt = await attempts.get(user.id, result.attempt_id)
    response.status_code = status.HTTP_201_CREATED if result.created else status.HTTP_200_OK
    return AttemptCreatedResponse(
        created=result.created,
        attempt=AttemptResponse.from_domain(attempt),
    )


@router.get("", response_model=AttemptPageResponse)
async def list_attempts(
    attempts: Attempts,
    user: CurrentUser,
    move: Move | None = None,
    attempt_status: Annotated[AttemptStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> AttemptPageResponse:
    items, total = await attempts.list(
        user.id, move=move, status=attempt_status, limit=limit, offset=offset
    )
    return AttemptPageResponse(
        items=[AttemptResponse.from_domain(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{attempt_id}", response_model=AttemptResponse)
async def get_attempt(attempt_id: UUID, attempts: Attempts, user: CurrentUser) -> AttemptResponse:
    return AttemptResponse.from_domain(await attempts.get(user.id, attempt_id))


@router.delete("/{attempt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attempt(attempt_id: UUID, attempts: Attempts, user: CurrentUser) -> Response:
    await attempts.delete(user.id, attempt_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
