"""Create accounts, refresh sessions, and training attempts.

Revision ID: 0001
Revises:
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_sessions")),
    )
    op.create_index(
        op.f("ix_refresh_sessions_expires_at"), "refresh_sessions", ["expires_at"], unique=False
    )
    op.create_index(
        op.f("ix_refresh_sessions_token_hash"),
        "refresh_sessions",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        op.f("ix_refresh_sessions_user_id"), "refresh_sessions", ["user_id"], unique=False
    )

    op.create_table(
        "training_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_attempt_id", sa.Uuid(), nullable=False),
        sa.Column("move", sa.String(length=16), nullable=False),
        sa.Column("stance", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("violations", sa.JSON(), nullable=False),
        sa.Column("quality_issues", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("score_components", sa.JSON(), nullable=False),
        sa.Column("main_feedback", sa.Text(), nullable=False),
        sa.Column("confidence_mode", sa.String(length=32), nullable=True),
        sa.Column("analyzer_version", sa.String(length=40), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 100)",
            name=op.f("ck_training_attempts_score_range"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_training_attempts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_training_attempts")),
        sa.UniqueConstraint(
            "user_id",
            "client_attempt_id",
            name=op.f("uq_training_attempts_user_id"),
        ),
    )
    op.create_index(
        op.f("ix_training_attempts_occurred_at"),
        "training_attempts",
        ["occurred_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_training_attempts_user_id"), "training_attempts", ["user_id"], unique=False
    )
    op.create_index(
        "ix_training_attempts_user_move", "training_attempts", ["user_id", "move"], unique=False
    )
    op.create_index(
        "ix_training_attempts_user_occurred",
        "training_attempts",
        ["user_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("training_attempts")
    op.drop_table("refresh_sessions")
    op.drop_table("users")
