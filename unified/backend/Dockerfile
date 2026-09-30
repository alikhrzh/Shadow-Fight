FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY pyproject.toml README.md ./
COPY src ./src
COPY alembic.ini ./
COPY alembic ./alembic

RUN pip install --upgrade pip && pip install .

USER app
EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn shadowcoach_api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
