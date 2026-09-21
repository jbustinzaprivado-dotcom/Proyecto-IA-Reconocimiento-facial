from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401  (registers the tables in Base.metadata)
from app.core.config import get_settings
from app.database.connection import Base
from app.database.types import UTCDateTime

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# The URL always comes from the settings (DATABASE_URL); "%" must be doubled for the ini parser
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))

target_metadata = Base.metadata


def render_item(type_: str, obj: object, autogen_context) -> str | bool:
    """Write plain SQLAlchemy types in migrations: they must not import application code."""
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False


def run_migrations_offline() -> None:
    """Emit the SQL without connecting to the database."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=True,
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # A test (or a script) that already holds the only connection there is, such as a test server
    # that accepts one, hands it over: `config.attributes["connection"] = connection`
    connection = config.attributes.get("connection")
    if connection is not None:
        migrate(connection)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as own_connection:
        migrate(own_connection)


def migrate(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        # SQLite cannot alter most columns in place: batch mode recreates the table instead
        render_as_batch=True,
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
