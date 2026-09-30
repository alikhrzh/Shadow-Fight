from httpx import AsyncClient

from .conftest import register


async def test_register_login_refresh_and_logout(client: AsyncClient) -> None:
    anonymous = await client.get("/api/v1/auth/session")
    assert anonymous.status_code == 200
    assert anonymous.json() == {"refresh_cookie_present": False}

    registered = await register(client)
    assert registered["user"]["email"] == "boxer@example.com"
    assert registered["token_type"] == "bearer"
    assert "shadowcoach_refresh" in client.cookies
    assert (await client.get("/api/v1/auth/session")).json() == {
        "refresh_cookie_present": True
    }

    me = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {registered['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["display_name"] == "Test Boxer"

    old_refresh = client.cookies.get("shadowcoach_refresh")
    refreshed = await client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"] != registered["access_token"]
    assert client.cookies.get("shadowcoach_refresh") != old_refresh

    client.cookies.clear()
    client.cookies.set("shadowcoach_refresh", old_refresh, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401

    client.cookies.clear()
    logged_in = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "boxer@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    assert logged_in.status_code == 200
    logout = await client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    assert "shadowcoach_refresh" not in client.cookies
    assert (await client.get("/api/v1/auth/session")).json() == {
        "refresh_cookie_present": False
    }
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401


async def test_duplicate_and_invalid_login_are_safe(client: AsyncClient) -> None:
    await register(client)
    duplicate = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "BOXER@example.com",
            "password": "another-long-password",
            "display_name": "Other",
        },
    )
    assert duplicate.status_code == 409

    invalid = await client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "wrong-password"},
    )
    assert invalid.status_code == 401
    assert "email" not in invalid.json()["detail"].lower()
