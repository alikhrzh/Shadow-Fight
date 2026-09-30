class DomainError(Exception):
    """Base class for errors safe to translate into an API response."""


class ConflictError(DomainError):
    pass


class AuthenticationError(DomainError):
    pass


class NotFoundError(DomainError):
    pass


class InactiveUserError(AuthenticationError):
    pass


class ValidationError(DomainError):
    pass
