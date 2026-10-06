from shadowcoach.config import MoveConfig
from shadowcoach.domain.models import AttemptFeatures, Phases, Violation
from shadowcoach.validators.base import BaseValidator


class CrossValidator(BaseValidator):
    def validate(self, f: AttemptFeatures, phases: Phases, cfg: MoveConfig) -> list[Violation]:
        return (
            super().validate(f, phases, cfg)
            + self.extension(f, phases, cfg)
            + self.rotation(f, phases, cfg)
        )
