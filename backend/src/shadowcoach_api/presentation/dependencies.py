from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shadowcoach_api.application.attempts import AttemptService
from shadowcoach_api.application.auth import AuthService
from shadowcoach_api.application.progress import ProgressService
from shadowcoach_api.domain.entities import User
from shadowcoach_api.domain.exceptions import AuthenticationError

bearer = HTTPBearer(auto_error=False)


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


def get_attempt_service(request: Request) -> AttemptService:
    return request.app.state.attempt_service


def get_progress_service(request: Request) -> ProgressService:
    return request.app.state.progress_service


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise AuthenticationError("Authentication required")
    user_id = request.app.state.access_tokens.decode(credentials.credentials)
    return await auth.get_user(user_id)


CurrentUser = Annotated[User, Depends(get_current_user)]
Auth = Annotated[AuthService, Depends(get_auth_service)]
Attempts = Annotated[AttemptService, Depends(get_attempt_service)]
Progress = Annotated[ProgressService, Depends(get_progress_service)]
