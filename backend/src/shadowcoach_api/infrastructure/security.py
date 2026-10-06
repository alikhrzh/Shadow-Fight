import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

from shadowcoach_api.domain.exceptions import AuthenticationError


class ArgonPasswordService:
    def __init__(self) -> None:
        self._password_hash = PasswordHash.recommended()
        self._dummy_hash = self._password_hash.hash("dummy-password-that-is-never-valid")

    def hash(self, password: str) -> str:
        return self._password_hash.hash(password)

    def verify(self, password: str, password_hash: str) -> bool:
        return self._password_hash.verify(password, password_hash)

    def verify_dummy(self, password: str) -> None:
        self._password_hash.verify(password, self._dummy_hash)


class JwtAccessTokenService:
    def __init__(
        self,
        secret: str,
        issuer: str,
        audience: str,
        lifetime: timedelta,
    ) -> None:
        self._secret = secret
        self._issuer = issuer
        self._audience = audience
        self._lifetime = lifetime

    def create(self, user_id: UUID, now: datetime) -> tuple[str, int]:
        expires_at = now + self._lifetime
        expires_in = int(self._lifetime.total_seconds())
        token = jwt.encode(
            {
                "sub": str(user_id),
                "typ": "access",
                "jti": str(uuid4()),
                "iat": now,
                "exp": expires_at,
                "iss": self._issuer,
                "aud": self._audience,
            },
            self._secret,
            algorithm="HS256",
        )
        return token, expires_in

    def decode(self, token: str) -> UUID:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=self._issuer,
                audience=self._audience,
                options={"require": ["sub", "typ", "jti", "iat", "exp", "iss", "aud"]},
            )
            if payload["typ"] != "access":
                raise AuthenticationError("Invalid access token")
            return UUID(payload["sub"])
        except (InvalidTokenError, KeyError, TypeError, ValueError) as exc:
            raise AuthenticationError("Invalid or expired access token") from exc


class OpaqueRefreshTokenService:
    def create(self) -> str:
        return secrets.token_urlsafe(48)

    def hash(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(UTC)
