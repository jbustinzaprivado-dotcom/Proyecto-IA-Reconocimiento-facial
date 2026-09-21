"""Create the first administrator, or set a new password for an account that cannot sign in.

    python -m app.scripts.create_admin
    python -m app.scripts.create_admin --restablecer correo@example.com

The password is asked for twice and never shown. For a server with no keyboard (a hosting shell),
`--desde-entorno` reads ADMIN_EMAIL, ADMIN_NOMBRE and ADMIN_PASSWORD (or just ADMIN_PASSWORD with
`--restablecer`). Every use is written to the audit log.
"""

import argparse
import getpass
import os
import sys
from collections.abc import Callable

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import ROLE_ADMIN
from app.core.errors import ApiException, ValidationMessage
from app.core.security import check_password_policy, hash_password
from app.database.types import utcnow
from app.models import Usuario
from app.schemas.fields import clean_email
from app.schemas.user_schema import UsuarioCreate
from app.services import audit_service, user_service


def create_admin(db: Session, email: str, name: str, password: str) -> Usuario:
    """The new administrator. Raises ApiException with the reason if something is not acceptable."""
    try:
        data = UsuarioCreate(email=email, nombre=name, rol=ROLE_ADMIN, clave=password)
    except ValidationError as error:
        # The messages of the fields are already written for the user
        raise ApiException(
            422, "; ".join(e["msg"].removeprefix("Value error, ") for e in error.errors())
        ) from None
    user = user_service.create_user(db, data)
    audit_service.log_system(db, "admin_crear_comando", detail=f"administrador {user.email}")
    return user


def reset_password(db: Session, email: str, password: str) -> Usuario:
    """A new password for an account, which is also activated and unlocked."""
    try:
        address = clean_email(email)
    except ValidationMessage as error:
        raise ApiException(422, str(error)) from None
    user = db.scalar(select(Usuario).where(Usuario.email == address))
    if user is None:
        raise ApiException(404, "El usuario no existe.")
    check_password_policy(password, user.email)
    user.password_hash = hash_password(password)
    user.activo = True
    user.failed_attempts = 0
    user.locked_until = None
    user.tokens_validos_desde = utcnow()
    db.commit()
    audit_service.log_system(db, "clave_restablecida_comando", detail=f"cuenta {user.email}")
    return user


def ask_password(ask: Callable[[str], str]) -> str:
    first = ask("Contraseña (no se muestra): ")
    if first != ask("Repite la contraseña: "):
        raise ApiException(422, "Las contraseñas no coinciden.")
    return first


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crea el primer administrador.")
    parser.add_argument("--email", help="correo del administrador")
    parser.add_argument("--nombre", help="nombre del administrador")
    parser.add_argument(
        "--restablecer", metavar="CORREO", help="pone una contraseña nueva a esa cuenta"
    )
    parser.add_argument(
        "--desde-entorno",
        action="store_true",
        help="lee ADMIN_EMAIL, ADMIN_NOMBRE y ADMIN_PASSWORD",
    )
    args = parser.parse_args(argv)

    from app.database.connection import SessionLocal  # the database is only opened when it is used

    try:
        with SessionLocal() as db:
            if args.restablecer:
                password = (
                    os.environ.get("ADMIN_PASSWORD", "")
                    if args.desde_entorno
                    else ask_password(getpass.getpass)
                )
                user = reset_password(db, args.restablecer, password)
                print(f"Listo: la cuenta {user.email} tiene contraseña nueva y está activa.")
            else:
                if args.desde_entorno:
                    email = os.environ.get("ADMIN_EMAIL", "")
                    name = os.environ.get("ADMIN_NOMBRE", "Administrador")
                    password = os.environ.get("ADMIN_PASSWORD", "")
                else:
                    email = args.email or input("Correo del administrador: ")
                    name = args.nombre or input("Nombre: ")
                    password = ask_password(getpass.getpass)
                user = create_admin(db, email, name, password)
                print(f"Listo: administrador {user.email} creado.")
    except ApiException as error:
        print(f"No se pudo: {error.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
