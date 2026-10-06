from fastapi import APIRouter, Request, Response, status

from shadowcoach_api.application.dto import LoginCommand, RegisterCommand

from ..dependencies import Auth, CurrentUser
from ..schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    SessionStatusResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def _set_refresh_cookie(request: Request, response: Response, token: str, expires) -> None:
    settings = request.app.state.settings
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        expires=expires,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(request: Request, response: Response) -> None:
    settings = request.app.state.settings
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/v1/auth",
    )


@router.get("/session", response_model=SessionStatusResponse)
async def session_status(request: Request) -> SessionStatusResponse:
    settings = request.app.state.settings
    return SessionStatusResponse(
        refresh_cookie_present=bool(request.cookies.get(settings.refresh_cookie_name))
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, request: Request, response: Response, auth: Auth
) -> AuthResponse:
    result, user = await auth.register(
        RegisterCommand(
            email=str(payload.email),
            password=payload.password,
            display_name=payload.display_name,
        )
    )
    _set_refresh_cookie(request, response, result.refresh_token, result.refresh_expires_at)
    return AuthResponse(
        access_token=result.access_token,
        expires_in=result.access_expires_in,
        user=UserResponse.from_domain(user),
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest, request: Request, response: Response, auth: Auth
) -> AuthResponse:
    result, user = await auth.login(
        LoginCommand(email=str(payload.email), password=payload.password)
    )
    _set_refresh_cookie(request, response, result.refresh_token, result.refresh_expires_at)
    return AuthResponse(
        access_token=result.access_token,
        expires_in=result.access_expires_in,
        user=UserResponse.from_domain(user),
    )


@router.post("/refresh", response_model=AuthResponse)
async def refresh(request: Request, response: Response, auth: Auth) -> AuthResponse:
    settings = request.app.state.settings
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        from shadowcoach_api.domain.exceptions import AuthenticationError

        raise AuthenticationError("Refresh session is missing")
    result, user = await auth.refresh(token)
    _set_refresh_cookie(request, response, result.refresh_token, result.refresh_expires_at)
    return AuthResponse(
        access_token=result.access_token,
        expires_in=result.access_expires_in,
        user=UserResponse.from_domain(user),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, auth: Auth) -> Response:
    settings = request.app.state.settings
    token = request.cookies.get(settings.refresh_cookie_name)
    if token:
        await auth.logout(token)
    _clear_refresh_cookie(request, response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    request: Request, response: Response, auth: Auth, user: CurrentUser
) -> Response:
    await auth.logout_all(user.id)
    _clear_refresh_cookie(request, response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
