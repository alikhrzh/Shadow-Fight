from enum import StrEnum


class Move(StrEnum):
    JAB = "jab"
    CROSS = "cross"
    HOOK = "hook"


class Stance(StrEnum):
    ORTHODOX = "orthodox"
    SOUTHPAW = "southpaw"


class AttemptStatus(StrEnum):
    COMPLETED = "completed"
    UNRELIABLE = "unreliable"
    NO_ATTEMPT = "no_attempt"
