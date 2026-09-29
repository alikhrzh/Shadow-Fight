from shadowcoach.domain.enums import Move
from shadowcoach.validators.cross import CrossValidator
from shadowcoach.validators.hook import HookValidator
from shadowcoach.validators.jab import JabValidator

VALIDATORS = {Move.JAB: JabValidator, Move.CROSS: CrossValidator, Move.HOOK: HookValidator}
