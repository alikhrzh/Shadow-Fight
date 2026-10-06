# ShadowCoach API

FastAPI service for accounts, authentication, privacy-safe training history, and
progress. The browser remains responsible for camera processing and scoring. This
service deliberately rejects video, images, frames, landmarks, and arbitrary report
fields.

## Architecture

```text
presentation (FastAPI routers and schemas)
        ↓
application (auth, attempts, progress use cases and ports)
        ↓
domain (entities, enums, repository contracts, errors)
        ↑
infrastructure (SQLAlchemy, PostgreSQL/SQLite, JWT, Argon2)
```

Dependencies point inward. Domain and application code know nothing about FastAPI or
SQLAlchemy. `main.py` is the composition root.

## Features

- Registration and login with Argon2 password hashing.
- 15-minute signed access JWTs with issuer, audience, type, expiry, and token ID.
- Opaque 30-day refresh tokens, stored as SHA-256 hashes and rotated on every refresh.
- HttpOnly, SameSite refresh cookie; access tokens are returned for in-memory use.
- Logout for one session or all refresh sessions.
- Idempotent training-attempt ingestion using the browser `attemptId`.
- Per-user history, deletion, filtering, pagination, summaries, and score timelines.
- Strict allowlists matching the browser analyzer's metrics, components, and issue codes.
- PostgreSQL production storage, Alembic migrations, and SQLite test/local support.
- Liveness/readiness endpoints and OpenAPI documentation.

Only `completed` attempts with a score contribute to progress. Unreliable and
no-attempt reports can be retained for the user's history, but never distort averages.

## Local start

With Docker:

```sh
cd backend
docker compose up --build
```

The API is available at `http://127.0.0.1:8000`; Swagger UI is at `/docs`.

Without Docker:

```sh
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
alembic upgrade head
uvicorn shadowcoach_api.main:app --reload --port 8000
```

For a zero-setup local database, set:

```dotenv
SHADOWCOACH_DATABASE_URL=sqlite+aiosqlite:///./shadowcoach.db
```

Run checks with:

```sh
pytest
ruff check src tests alembic
```

## Browser contract

The web app implements this contract. It keeps the access token in memory, checks
`GET /api/v1/auth/session` on startup, calls `POST /api/v1/auth/refresh` with
`credentials: "include"` when a refresh cookie exists or after a 401, and never puts
the refresh token in JavaScript storage. Vite proxies `/api/v1` during development so
the refresh cookie remains same-origin. Cross-origin deployments must use an explicitly
configured origin and compatible cookie policy.

After a local report is produced, the web app maps it to `POST /api/v1/attempts`. The
existing `crypto.randomUUID()` attempt ID becomes `client_attempt_id`; retrying the same
upload is safe. Failed privacy-safe uploads are kept in a small per-user local outbox and
retried when connectivity returns.

Important: scores originate on the client and are suitable for personal progress, not
competitive leaderboards or rewards. Any competitive feature would require trusted
server-side verification of the movement data.

## Production requirements

- Generate a unique secret, for example with `openssl rand -hex 32`.
- Use `SHADOWCOACH_ENVIRONMENT=production`, PostgreSQL, HTTPS, and secure cookies.
- Run migrations as a release step rather than from every replica simultaneously.
- Put the API behind ingress-level request/rate limits and database backups.
- Use the same site for web and API when possible; otherwise review cookie and CSRF policy.
- Add email verification and password reset before opening registration publicly.

## Recommended product roadmap

1. Add weekly goals, consistency streaks, personal-best events, and per-error trends.
   Reward practice quality and consistency rather than turning an unverified client score
   into a global leaderboard.
2. Add account verification, password reset, session/device management, and optional
   Google/Apple OpenID Connect login.
3. Add an explicit coach-sharing workflow: users select individual attempts or a date
   range, grant time-limited access, and can revoke it. Never share video implicitly.
4. Version analyzer configurations with every report and show progress discontinuities
   when scoring thresholds materially change.
5. At higher volume, maintain progress rollups transactionally instead of scanning a
   user's completed score records for every summary request.
