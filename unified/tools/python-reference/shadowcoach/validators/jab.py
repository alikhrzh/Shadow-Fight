from shadowcoach.config import MoveConfig
from shadowcoach.domain.models import AttemptFeatures, Phases, Violation
from shadowcoach.validators.base import BaseValidator, violation


class JabValidator(BaseValidator):
    def validate(self, f: AttemptFeatures, phases: Phases, cfg: MoveConfig) -> list[Violation]:
        result = super().validate(f, phases, cfg) + self.extension(f, phases, cfg)
        if (
            cfg.min_trajectory_straightness is not None
            and f.trajectory_straightness is not None
            and (f.trajectory_straightness < cfg.min_trajectory_straightness)
        ):
            result.append(
                violation(
                    "trajectory_not_straight",
                    1 - f.trajectory_straightness / cfg.min_trajectory_straightness,
                    phases.peak_frame,
                    f"{f.active_hand}_wrist",
                )
            )
        return result
