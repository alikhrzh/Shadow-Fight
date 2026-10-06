from datetime import UTC, datetime
from uuid import uuid4

from httpx import AsyncClient

from .conftest import register


def completed_attempt(client_attempt_id: str | None = None) -> dict:
    return {
        "client_attempt_id": client_attempt_id or str(uuid4()),
        "move": "jab",
        "stance": "orthodox",
        "status": "completed",
        "score": 82,
        "violations": [
            {
                "code": "guard_dropped",
                "severity": 0.4,
                "related_joints": ["right_wrist"],
            }
        ],
        "quality_issues": [],
        "metrics": {
            "duration_ms": 620,
            "wrist_displacement": 0.61,
            "active_hand": "left",
            "expected_hand": "left",
            "returned_to_guard": True,
        },
        "score_components": {"completion": 1, "guard": 0.72, "return": 1},
        "main_feedback": "Держите свободную руку ближе к подбородку.",
        "confidence_mode": "visibility_only_web",
        "analyzer_version": "web-0.2.0",
        "occurred_at": datetime.now(UTC).isoformat(),
    }


async def test_attempt_history_idempotency_and_progress(client: AsyncClient) -> None:
    auth = await register(client)
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    payload = completed_attempt()

    created = await client.post("/api/v1/attempts", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    assert created.json()["created"] is True

    repeated = await client.post("/api/v1/attempts", json=payload, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["created"] is False
    assert repeated.json()["attempt"]["id"] == created.json()["attempt"]["id"]

    history = await client.get("/api/v1/attempts", headers=headers)
    assert history.status_code == 200
    assert history.json()["total"] == 1

    summary = await client.get("/api/v1/progress/summary", headers=headers)
    assert summary.status_code == 200
    jab = next(item for item in summary.json()["moves"] if item["move"] == "jab")
    assert jab["count"] == 1
    assert jab["last_score"] == 82
    assert jab["best_score"] == 82
    assert jab["average_score"] == 82.0
    assert jab["common_violations"] == ["guard_dropped"]

    timeline = await client.get("/api/v1/progress/timeline?move=jab", headers=headers)
    assert timeline.status_code == 200
    assert [point["score"] for point in timeline.json()] == [82]


async def test_report_schema_rejects_private_or_inconsistent_data(client: AsyncClient) -> None:
    auth = await register(client)
    headers = {"Authorization": f"Bearer {auth['access_token']}"}

    with_landmarks = completed_attempt()
    with_landmarks["metrics"]["landmarks"] = [1, 2, 3]
    assert (
        await client.post("/api/v1/attempts", json=with_landmarks, headers=headers)
    ).status_code == 422

    invalid_hand = completed_attempt()
    invalid_hand["metrics"]["active_hand"] = "front"
    assert (
        await client.post("/api/v1/attempts", json=invalid_hand, headers=headers)
    ).status_code == 422

    unreliable_score = completed_attempt()
    unreliable_score["status"] = "unreliable"
    assert (
        await client.post("/api/v1/attempts", json=unreliable_score, headers=headers)
    ).status_code == 422

    unknown_field = completed_attempt()
    unknown_field["video"] = "not allowed"
    assert (
        await client.post("/api/v1/attempts", json=unknown_field, headers=headers)
    ).status_code == 422


async def test_users_cannot_read_each_others_attempts(client: AsyncClient) -> None:
    first = await register(client, "first@example.com")
    first_headers = {"Authorization": f"Bearer {first['access_token']}"}
    created = await client.post("/api/v1/attempts", json=completed_attempt(), headers=first_headers)
    attempt_id = created.json()["attempt"]["id"]

    second = await register(client, "second@example.com")
    second_headers = {"Authorization": f"Bearer {second['access_token']}"}
    hidden = await client.get(f"/api/v1/attempts/{attempt_id}", headers=second_headers)
    assert hidden.status_code == 404
