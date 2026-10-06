from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from shadowcoach_api.infrastructure.database.base import Base
from shadowcoach_api.infrastructure.settings import Settings
from shadowcoach_api.main import create_app


@pytest_asyncio.fixture
async def client(tmp_path) -> AsyncIterator[AsyncClient]:
    database = tmp_path / "api-test.db"
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{database}",
        jwt_secret="test-secret-value-longer-than-thirty-two-characters",
        cookie_secure=False,
        cors_origins=["http://testserver"],
        allowed_hosts=["testserver"],
    )
    app = create_app(settings)
    async with app.state.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://testserver",
        follow_redirects=False,
    ) as test_client:
        yield test_client
    await app.state.engine.dispose()


async def register(client: AsyncClient, email: str = "boxer@example.com") -> dict:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery-staple",
            "display_name": "Test Boxer",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()
