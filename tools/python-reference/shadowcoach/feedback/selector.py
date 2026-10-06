from shadowcoach.config import FeedbackConfig
from shadowcoach.domain.models import Violation
from shadowcoach.feedback.catalog import GOOD_FEEDBACK


def select_feedback(
    violations: list[Violation], cfg: FeedbackConfig
) -> tuple[str, list[Violation]]:
    rank = {code: i for i, code in enumerate(cfg.priority)}
    ordered = sorted(violations, key=lambda v: (rank.get(v.code, len(rank)), -v.severity))
    return (
        ordered[0].message if ordered else GOOD_FEEDBACK,
        ordered[: cfg.max_violations_in_report],
    )
