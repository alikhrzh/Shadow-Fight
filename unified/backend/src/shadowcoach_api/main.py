from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from shadowcoach_api.application.attempts import AttemptService
from shadowcoach_api.application.auth import AuthService
from shadowcoach_api.application.progress import ProgressService
from shadowcoach_api.domain.exceptions import (
    AuthenticationError,
    ConflictError,
    DomainError,
    NotFoundError,
    ValidationError,
)
from shadowcoach_api.infrastructure.database.session import create_database
from shadowcoach_api.infrastructure.database.uow import SqlAlchemyUnitOfWorkFactory
from shadowcoach_api.infrastructure.security import (
    ArgonPasswordService,
    JwtAccessTokenService,
    OpaqueRefreshTokenService,
)
from shadowcoach_api.infrastructure.settings import Settings, get_settings
from shadowcoach_api.presentation.routers import attempts, auth, health, progress, users


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine, session_factory = create_database(settings.database_url)
    uow_factory = SqlAlchemyUnitOfWorkFactory(session_factory)
    access_tokens = JwtAccessTokenService(
        secret=settings.jwt_secret,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        lifetime=timedelta(minutes=settings.access_token_minutes),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await engine.dispose()

    app = FastAPI(
        title="ShadowCoach API",
        version="0.1.0",
        description=(
            "Accounts, privacy-safe training history, and progress for ShadowCoach. "
            "This API never accepts video frames or pose landmarks."
        ),
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.access_tokens = access_tokens
    app.state.auth_service = AuthService(
        uow_factory=uow_factory,
        passwords=ArgonPasswordService(),
        access_tokens=access_tokens,
        refresh_tokens=OpaqueRefreshTokenService(),
        refresh_ttl=timedelta(days=settings.refresh_token_days),
    )
    app.state.attempt_service = AttemptService(uow_factory)
    app.state.progress_service = ProgressService(uow_factory)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > 32_768:
            return JSONResponse(status_code=413, content={"detail": "request body too large"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(DomainError)
    async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        status_code = 400
        headers = None
        if isinstance(exc, AuthenticationError):
            status_code = 401
            headers = {"WWW-Authenticate": "Bearer"}
        elif isinstance(exc, ConflictError):
            status_code = 409
        elif isinstance(exc, NotFoundError):
            status_code = 404
        elif isinstance(exc, ValidationError):
            status_code = 422
        return JSONResponse(
            status_code=status_code,
            content={"detail": str(exc)},
            headers=headers,
        )

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")
    app.include_router(attempts.router, prefix="/api/v1")
    app.include_router(progress.router, prefix="/api/v1")

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"service": "shadowcoach-api", "version": "0.1.0"}

    return app


app = create_app()
