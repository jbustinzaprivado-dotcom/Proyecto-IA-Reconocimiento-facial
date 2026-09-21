from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.constants import ROLE_ADMIN
from app.core.errors import ApiException
from app.core.security import check_password_policy, hash_password
from app.database.types import utcnow
from app.models import Usuario
from app.schemas.user_schema import UsuarioCreate, UsuarioUpdate

LAST_ADMIN = "Debe quedar al menos un administrador activo."


def create_user(db: Session, data: UsuarioCreate) -> Usuario:
    check_password_policy(data.clave, data.email)
    user = Usuario(
        email=data.email,
        nombre=data.nombre,
        rol=data.rol,
        password_hash=hash_password(data.clave),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique constraint decides, so two simultaneous requests cannot both succeed
        db.rollback()
        raise ApiException(409, "Ya existe un usuario con ese correo.") from None
    return user


def list_users(db: Session) -> list[Usuario]:
    return list(db.scalars(select(Usuario).order_by(func.lower(Usuario.nombre), Usuario.id)).all())


def get_user(db: Session, user_id: int) -> Usuario:
    user = db.get(Usuario, user_id)
    if user is None:
        raise ApiException(404, "El usuario no existe.")
    return user


def count_active_admins(db: Session) -> int:
    return (
        db.scalar(select(func.count()).where(Usuario.rol == ROLE_ADMIN, Usuario.activo.is_(True)))
        or 0
    )


def update_user(
    db: Session, user_id: int, data: UsuarioUpdate, actor: Usuario
) -> tuple[Usuario, list[str]]:
    """Change what was sent, and say what changed in words (for the audit log, with no password)."""
    user = get_user(db, user_id)
    changes: list[str] = []

    if data.activo is False and user.id == actor.id:
        raise ApiException(409, "No puedes desactivar tu propia cuenta.")
    leaves_administration = (
        user.rol == ROLE_ADMIN
        and user.activo
        and (data.activo is False or (data.rol is not None and data.rol != ROLE_ADMIN))
    )
    if leaves_administration and count_active_admins(db) <= 1:
        raise ApiException(409, LAST_ADMIN)

    if data.nombre is not None and data.nombre != user.nombre:
        user.nombre = data.nombre
        changes.append("nombre cambiado")
    if data.rol is not None and data.rol != user.rol:
        changes.append(f"rol: {user.rol} → {data.rol}")
        user.rol = data.rol
    if data.activo is not None and data.activo != user.activo:
        user.activo = data.activo
        changes.append("cuenta activada" if data.activo else "cuenta desactivada")
    if data.clave is not None:
        check_password_policy(data.clave, user.email)
        user.password_hash = hash_password(data.clave)
        # The old sessions end, and whoever was locked out by mistyping can sign in again
        user.tokens_validos_desde = utcnow()
        user.failed_attempts = 0
        user.locked_until = None
        changes.append("contraseña restablecida")

    if not changes:
        db.rollback()
        raise ApiException(422, "No hay nada que cambiar.")
    db.commit()
    return user, changes
