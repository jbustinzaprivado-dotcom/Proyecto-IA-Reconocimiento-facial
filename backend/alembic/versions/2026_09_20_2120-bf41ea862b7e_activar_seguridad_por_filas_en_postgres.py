"""activar seguridad por filas en postgres

Supabase (y cualquier Postgres con PostgREST) publica por HTTP las tablas del esquema public que
no tienen la seguridad por filas (RLS) activada, y la clave "anon" de un proyecto no es secreta.
Aquí hay datos biométricos y cuentas: se activa RLS en todas las tablas y no se crea ninguna
política, así que esa vía no devuelve nada. La API se conecta con el rol dueño de las tablas
(en Supabase, `postgres`), que no queda sujeto a RLS. En SQLite no hace nada.

Revision ID: bf41ea862b7e
Revises: 3601eda36a2e
Create Date: 2026-09-20 21:20:27.601352

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'bf41ea862b7e'
down_revision: Union[str, Sequence[str], None] = '3601eda36a2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Todas las tablas de la aplicación, más la de Alembic, que también queda en public
TABLES = (
    'personas',
    'face_embeddings',
    'recognition_logs',
    'ml_training_records',
    'usuarios',
    'auditoria',
    'alembic_version',
)


def upgrade() -> None:
    """Upgrade schema."""
    if op.get_context().dialect.name != 'postgresql':
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    if op.get_context().dialect.name != 'postgresql':
        return
    for table in reversed(TABLES):
        op.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY')
