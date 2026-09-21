"""Rules for a name and an address, shared by the people and by the users so that both accept
exactly the same values (and the same as the frontend)."""

import re

from app.core.constants import EMAIL_MAX_LENGTH, NAME_MAX_LENGTH, NAME_MIN_LENGTH
from app.core.errors import ValidationMessage

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def clean_name(value: str) -> str:
    # Trim the ends and collapse repeated spaces; case and accents are kept
    name = " ".join(value.split())
    if not NAME_MIN_LENGTH <= len(name) <= NAME_MAX_LENGTH:
        raise ValidationMessage(
            f"El nombre debe tener entre {NAME_MIN_LENGTH} y {NAME_MAX_LENGTH} caracteres."
        )
    return name


def clean_email(value: str) -> str:
    # Lowercase so that Ana@x.com and ana@x.com are the same mailbox
    email = value.strip().lower()
    if len(email) > EMAIL_MAX_LENGTH or not EMAIL_PATTERN.match(email):
        raise ValidationMessage("El correo no tiene un formato válido.")
    return email
