from datetime import UTC, datetime, timedelta
from uuid import UUID

from shadowcoach_api.domain.entities import RefreshSession, User
from shadowcoach_api.domain.exceptions import (
    AuthenticationError,
    ConflictError,
    InactiveUserError,
    NotFoundError,
)

from .dto import AuthResult, LoginCommand, RegisterCommand
from .ports import AccessTokenService, PasswordService, RefreshTokenService, UnitOfWorkFactory


def canonical_email(email: str) -> str:
    return email.strip().casefold()


class AuthService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        passwords: PasswordService,
        access_tokens: AccessTokenService,
        refresh_tokens: RefreshTokenService,
        refresh_ttl: timedelta,
    ) -> None:
        self._uow_factory = uow_factory
        self._passwords = passwords
        self._access_tokens = access_tokens
        self._refresh_tokens = refresh_tokens
        self._refresh_ttl = refresh_ttl

    async def register(self, command: RegisterCommand) -> tuple[AuthResult, User]:
        email = canonical_email(command.email)
        async with self._uow_factory() as uow:
            if await uow.users.get_by_email(email):
                raise ConflictError("An account with this email already exists")
            user = User(
                email=email,
                password_hash=self._passwords.hash(command.password),
                display_name=command.display_name.strip(),
            )
            await uow.users.add(user)
            result = await self._issue(uow, user)
            await uow.commit()
            return result, user

    async def login(self, command: LoginCommand) -> tuple[AuthResult, User]:
        email = canonical_email(command.email)
        async with self._uow_factory() as uow:
            user = await uow.users.get_by_email(email)
            if user is None:
                self._passwords.verify_dummy(command.password)
                raise AuthenticationError("Invalid credentials")
            if not self._passwords.verify(command.password, user.password_hash):
                raise AuthenticationError("Invalid credentials")
            if not user.is_active:
                raise InactiveUserError("This account is disabled")
            result = await self._issue(uow, user)
            await uow.commit()
            return result, user

    async def refresh(self, refresh_token: str) -> tuple[AuthResult, User]:
        now = datetime.now(UTC)
        token_hash = self._refresh_tokens.hash(refresh_token)
        async with self._uow_factory() as uow:
            previous = await uow.refresh_sessions.consume(token_hash, now)
            if previous is None:
                raise AuthenticationError("Invalid or expired refresh session")
            user = await uow.users.get_by_id(previous.user_id)
            if user is None or not user.is_active:
                raise AuthenticationError("Invalid or expired refresh session")
            result = await self._issue(uow, user, now=now)
            await uow.commit()
            return result, user

    async def logout(self, refresh_token: str) -> None:
        async with self._uow_factory() as uow:
            await uow.refresh_sessions.revoke_by_hash(
                self._refresh_tokens.hash(refresh_token), datetime.now(UTC)
            )
            await uow.commit()

    async def logout_all(self, user_id: UUID) -> None:
        async with self._uow_factory() as uow:
            await uow.refresh_sessions.revoke_all_for_user(user_id, datetime.now(UTC))
            await uow.commit()

    async def get_user(self, user_id: UUID) -> User:
        async with self._uow_factory() as uow:
            user = await uow.users.get_by_id(user_id)
            if user is None:
                raise NotFoundError("User not found")
            if not user.is_active:
                raise InactiveUserError("This account is disabled")
            return user

    async def _issue(self, uow, user: User, *, now: datetime | None = None) -> AuthResult:
        now = now or datetime.now(UTC)
        access_token, access_expires_in = self._access_tokens.create(user.id, now)
        refresh_token = self._refresh_tokens.create()
        refresh_expires_at = now + self._refresh_ttl
        await uow.refresh_sessions.add(
            RefreshSession(
                user_id=user.id,
                token_hash=self._refresh_tokens.hash(refresh_token),
                expires_at=refresh_expires_at,
            )
        )
        return AuthResult(
            access_token=access_token,
            access_expires_in=access_expires_in,
            refresh_token=refresh_token,
            refresh_expires_at=refresh_expires_at,
            user_id=user.id,
        )
