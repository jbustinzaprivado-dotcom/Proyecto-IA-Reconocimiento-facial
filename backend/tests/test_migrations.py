import io

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, get_settings
from app.database.connection import make_engine
from app.database.types import utcnow
from app.models import FaceEmbedding, Persona, RecognitionLog

EXPECTED_COLUMNS = {
    "personas": {
        "id",
        "nombre",
        "email",
        "activo",
        "created_at",
        "consentimiento_at",
        "consentimiento_version",
    },
    "face_embeddings": {"id", "persona_id", "embedding", "modelo", "created_at"},
    "recognition_logs": {
        "id",
        "persona_id",
        "similitud",
        "distancia",
        "umbral",
        "coincide",
        "modelo",
        "probabilidad_calibrada",
        "created_at",
        "nitidez",
        "brillo",
        "tamano_rostro",
        "confianza_deteccion",
        "esperado",
        "esperado_persona_id",
        "candidato_correcto",
    },
    "usuarios": {
        "id",
        "email",
        "nombre",
        "password_hash",
        "rol",
        "activo",
        "created_at",
        "last_login_at",
        "failed_attempts",
        "locked_until",
        "tokens_validos_desde",
    },
    "auditoria": {
        "id",
        "created_at",
        "usuario_id",
        "usuario_email",
        "accion",
        "recurso",
        "recurso_id",
        "resultado",
        "detalle",
        "ip",
    },
    "ml_training_records": {
        "id",
        "recognition_log_id",
        "modelo",
        "similitud",
        "calidad_imagen",
        "iluminacion",
        "resultado_real",
        "grupo",
        "created_at",
    },
}


def alembic_config(sql_output: io.StringIO | None = None) -> Config:
    # sql_output receives the SQL in offline mode; stdout only carries Alembic's own messages
    config = Config(
        str(BACKEND_DIR / "alembic.ini"), output_buffer=sql_output, stdout=io.StringIO()
    )
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


@pytest.fixture
def database_url(tmp_path, monkeypatch) -> str:
    """A throwaway SQLite file, so the developer's dev.db is never touched."""
    url = "sqlite:///" + (tmp_path / "migraciones.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    yield url
    get_settings.cache_clear()


def tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_there_is_a_single_migration_head():
    heads = ScriptDirectory.from_config(alembic_config()).get_heads()
    assert len(heads) == 1


def test_upgrade_creates_the_six_tables_with_their_columns(database_url):
    command.upgrade(alembic_config(), "head")
    assert tables(database_url) == set(EXPECTED_COLUMNS) | {"alembic_version"}

    engine = create_engine(database_url)
    try:
        for table, columns in EXPECTED_COLUMNS.items():
            found = {column["name"] for column in inspect(engine).get_columns(table)}
            assert found == columns, table
    finally:
        engine.dispose()


def test_the_migrated_schema_matches_the_models(database_url):
    """Fails when a model changes and its migration was forgotten."""
    command.upgrade(alembic_config(), "head")
    command.check(alembic_config())


def test_the_email_is_unique_and_the_foreign_keys_cascade(database_url):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        unique = [c["column_names"] for c in inspector.get_unique_constraints("personas")]
        assert ["email"] in unique
        embeddings_fk = inspector.get_foreign_keys("face_embeddings")[0]
        logs_fk = inspector.get_foreign_keys("recognition_logs")[0]
        assert embeddings_fk["options"]["ondelete"] == "CASCADE"
        assert logs_fk["options"]["ondelete"] == "SET NULL"
    finally:
        engine.dispose()


def test_upgrade_can_run_twice_and_downgrade_removes_everything(database_url):
    command.upgrade(alembic_config(), "head")
    command.upgrade(alembic_config(), "head")
    command.downgrade(alembic_config(), "base")
    assert tables(database_url) == {"alembic_version"}


def test_the_migration_compiles_for_postgres(monkeypatch):
    """Runs the migration offline against the Postgres dialect: no server needed."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.upgrade(alembic_config(output), "head", sql=True)
    finally:
        get_settings.cache_clear()

    sql = output.getvalue()
    assert "CREATE TABLE personas" in sql
    assert "activo BOOLEAN DEFAULT true NOT NULL" in sql
    assert "embedding BYTEA NOT NULL" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql
    assert "ON DELETE CASCADE" in sql
    assert "ON DELETE SET NULL" in sql
    # The model that made each comparison; old rows count as simulated
    assert "modelo VARCHAR(50) DEFAULT 'simulated' NOT NULL" in sql
    assert "DEFAULT 1" not in sql


def test_upgrade_keeps_the_data_and_downgrade_works_with_data_inside(database_url):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            ana = Persona(
                nombre="Ana Torres",
                email="ana@example.com",
                consentimiento_at=utcnow(),
                consentimiento_version="v0-provisional",
                embeddings=[FaceEmbedding(embedding=b"\x00" * 8, modelo="simulated")],
            )
            session.add(ana)
            session.flush()
            session.add(
                RecognitionLog(
                    persona_id=ana.id,
                    similitud=0.9,
                    distancia=0.2,
                    umbral=0.75,
                    coincide=True,
                    probabilidad_calibrada=None,
                )
            )
            session.commit()

        # Running the migrations again on a database that already holds data changes nothing
        command.upgrade(alembic_config(), "head")
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Persona)) == 1
            assert session.scalar(select(func.count()).select_from(FaceEmbedding)) == 1
            assert session.scalar(select(func.count()).select_from(RecognitionLog)) == 1

        # Going back removes the tables and coming forward again gives empty tables that work.
        # SQLite does not enforce the drop order here: the Postgres test below checks it
        command.downgrade(alembic_config(), "base")
        assert tables(database_url) == {"alembic_version"}
        command.upgrade(alembic_config(), "head")
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Persona)) == 0
            session.add(
                Persona(
                    nombre="Luis Ramírez",
                    email="luis@example.com",
                    consentimiento_at=utcnow(),
                    consentimiento_version="v0-provisional",
                )
            )
            session.commit()
    finally:
        engine.dispose()


def columns_of(url: str, table: str) -> set[str]:
    engine = create_engine(url)
    try:
        return {column["name"] for column in inspect(engine).get_columns(table)}
    finally:
        engine.dispose()


def test_old_history_rows_get_the_simulated_model_when_the_column_is_added(database_url):
    command.upgrade(alembic_config(), "9bebc294fe81")
    assert "modelo" not in columns_of(database_url, "recognition_logs")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO recognition_logs "
                "(similitud, distancia, umbral, coincide, created_at) "
                "VALUES (0.9, 0.2, 0.75, 1, '2026-09-20 00:00:00')"
            )
        command.upgrade(alembic_config(), "head")
        with engine.connect() as connection:
            rows = connection.exec_driver_sql("SELECT modelo FROM recognition_logs").all()
        assert rows == [("simulated",)]
    finally:
        engine.dispose()


def test_going_back_to_the_first_migration_removes_the_model_column_and_keeps_the_rows(
    database_url,
):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO recognition_logs "
                "(similitud, distancia, umbral, coincide, modelo, created_at) "
                "VALUES (0.9, 0.2, 0.75, 1, 'sface-2021dec', '2026-09-20 00:00:00')"
            )
        command.downgrade(alembic_config(), "9bebc294fe81")
        assert "modelo" not in columns_of(database_url, "recognition_logs")
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT count(*) FROM recognition_logs").scalar() == 1
        command.upgrade(alembic_config(), "head")
        assert "modelo" in columns_of(database_url, "recognition_logs")
    finally:
        engine.dispose()


NEW_COLUMNS = {
    "nitidez",
    "brillo",
    "tamano_rostro",
    "confianza_deteccion",
    "esperado",
    "esperado_persona_id",
    "candidato_correcto",
}


def test_old_attempts_get_empty_quality_and_label_columns(database_url):
    command.upgrade(alembic_config(), "43d8f5f41e85")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO recognition_logs "
                "(similitud, distancia, umbral, coincide, modelo, created_at) "
                "VALUES (0.9, 0.2, 0.75, 1, 'sface-2021dec', '2026-09-20 00:00:00')"
            )
        command.upgrade(alembic_config(), "head")
        with engine.connect() as connection:
            row = connection.exec_driver_sql(
                "SELECT nitidez, brillo, tamano_rostro, confianza_deteccion, esperado, "
                "esperado_persona_id, candidato_correcto, modelo FROM recognition_logs"
            ).one()
        assert tuple(row) == (None, None, None, None, None, None, None, "sface-2021dec")
    finally:
        engine.dispose()


def test_going_back_one_step_removes_only_the_quality_and_label_columns(database_url):
    command.upgrade(alembic_config(), "ef304d279997")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO recognition_logs "
                "(similitud, distancia, umbral, coincide, modelo, created_at, nitidez, esperado) "
                "VALUES (0.9, 0.2, 0.75, 1, 'sface-2021dec', '2026-09-20 00:00:00', "
                "0.5, 'desconocido')"
            )
        command.downgrade(alembic_config(), "43d8f5f41e85")
        found = columns_of(database_url, "recognition_logs")
        assert not NEW_COLUMNS & found
        assert "modelo" in found
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT modelo FROM recognition_logs").all() == [
                ("sface-2021dec",)
            ]
        command.upgrade(alembic_config(), "head")
        assert NEW_COLUMNS <= columns_of(database_url, "recognition_logs")
    finally:
        engine.dispose()


def test_the_expected_person_is_cleared_and_not_the_attempt_when_the_person_goes_away(
    database_url,
):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        foreign_keys = {
            tuple(fk["constrained_columns"]): fk["options"].get("ondelete")
            for fk in inspect(engine).get_foreign_keys("recognition_logs")
        }
        assert foreign_keys[("esperado_persona_id",)] == "SET NULL"
        assert foreign_keys[("persona_id",)] == "SET NULL"
    finally:
        engine.dispose()


def test_the_new_migration_compiles_for_postgres_with_a_named_constraint(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.upgrade(alembic_config(output), "43d8f5f41e85:head", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    assert "ADD COLUMN nitidez FLOAT" in sql
    assert "ADD COLUMN candidato_correcto BOOLEAN" in sql
    assert "CONSTRAINT fk_recognition_logs_esperado_persona_id FOREIGN KEY" in sql
    assert "ON DELETE SET NULL" in sql


def test_the_downgrade_drops_the_tables_in_an_order_postgres_accepts(monkeypatch):
    """Postgres refuses to drop a table another one still points to; SQLite would not notice."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.downgrade(alembic_config(output), "head:base", sql=True)
    finally:
        get_settings.cache_clear()

    sql = output.getvalue()
    dropped = [
        line.split()[-1].rstrip(";") for line in sql.splitlines() if line.startswith("DROP TABLE")
    ]
    assert dropped.index("recognition_logs") < dropped.index("personas")
    assert dropped.index("face_embeddings") < dropped.index("personas")


def insert_log(connection) -> int:
    connection.exec_driver_sql(
        "INSERT INTO recognition_logs (similitud, distancia, umbral, coincide, modelo, created_at) "
        "VALUES (0.9, 0.2, 0.4, 1, 'simulated', '2026-09-20 00:00:00')"
    )
    return connection.exec_driver_sql("SELECT max(id) FROM recognition_logs").scalar()


def insert_example(connection, log_id) -> None:
    connection.exec_driver_sql(
        "INSERT INTO ml_training_records (recognition_log_id, modelo, similitud, calidad_imagen, "
        "iluminacion, resultado_real, grupo, created_at) "
        f"VALUES ({log_id if log_id is not None else 'NULL'}, 'simulated', 0.9, 0.5, 0.5, 1, 3, "
        "'2026-09-20 00:00:00')"
    )


def test_an_attempt_cannot_be_turned_into_two_examples(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            log_id = insert_log(connection)
            insert_example(connection, log_id)
        with pytest.raises(IntegrityError), engine.begin() as connection:
            insert_example(connection, log_id)
    finally:
        engine.dispose()


def test_examples_survive_the_attempt_they_came_from_and_may_have_no_attempt_at_all(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            log_id = insert_log(connection)
            insert_example(connection, log_id)
            insert_example(connection, None)
            insert_example(connection, None)
            connection.exec_driver_sql("DELETE FROM recognition_logs")
            rows = connection.exec_driver_sql(
                "SELECT recognition_log_id FROM ml_training_records"
            ).all()
        assert rows == [(None,), (None,), (None,)]
    finally:
        engine.dispose()


def test_going_back_one_step_removes_only_the_training_table(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            insert_log(connection)
        command.downgrade(alembic_config(), "ef304d279997")
        assert "ml_training_records" not in tables(database_url)
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT count(*) FROM recognition_logs").scalar() == 1
        command.upgrade(alembic_config(), "head")
        assert "ml_training_records" in tables(database_url)
    finally:
        engine.dispose()


def test_the_training_table_compiles_for_postgres_with_its_constraints(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.upgrade(alembic_config(output), "ef304d279997:head", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    assert "CREATE TABLE ml_training_records" in sql
    assert (
        "FOREIGN KEY(recognition_log_id) REFERENCES recognition_logs (id) ON DELETE SET NULL" in sql
    )
    assert "UNIQUE (recognition_log_id)" in sql
    assert "CREATE INDEX ix_ml_training_records_modelo ON ml_training_records (modelo)" in sql


def test_the_training_table_is_dropped_before_the_table_it_points_to(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.downgrade(alembic_config(output), "head:base", sql=True)
    finally:
        get_settings.cache_clear()
    dropped = [
        line.split()[-1].rstrip(";")
        for line in output.getvalue().splitlines()
        if line.startswith("DROP TABLE")
    ]
    assert dropped.index("ml_training_records") < dropped.index("recognition_logs")


def insert_user(connection, email: str = "ana@example.com", role: str = "operador") -> int:
    connection.exec_driver_sql(
        "INSERT INTO usuarios "
        "(email, nombre, password_hash, rol, created_at, tokens_validos_desde) "
        f"VALUES ('{email}', 'Ana', 'hash', '{role}', "
        "'2026-09-20 00:00:00', '2026-09-20 00:00:00')"
    )
    return connection.exec_driver_sql(f"SELECT id FROM usuarios WHERE email = '{email}'").scalar()


def insert_audit(connection, user_id: int | None, email: str | None) -> None:
    connection.exec_driver_sql(
        "INSERT INTO auditoria (created_at, usuario_id, usuario_email, accion, resultado) VALUES "
        f"('2026-09-20 00:00:00', {'NULL' if user_id is None else user_id}, "
        f"{'NULL' if email is None else repr(email)}, 'login', 'ok')"
    )


def test_a_user_gets_its_defaults_from_the_database_itself(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            insert_user(connection)
            row = connection.exec_driver_sql(
                "SELECT activo, failed_attempts, last_login_at, locked_until FROM usuarios"
            ).one()
        assert tuple(row) == (1, 0, None, None)
    finally:
        engine.dispose()


def test_only_the_three_roles_are_accepted_by_the_database(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        for role in ("administrador", "operador", "consulta"):
            with engine.begin() as connection:
                insert_user(connection, f"{role}@example.com", role)
        for role in ("Administrador", "root", ""):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                insert_user(connection, "otro@example.com", role)
    finally:
        engine.dispose()


def test_the_database_refuses_two_users_with_the_same_address(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            insert_user(connection)
        with pytest.raises(IntegrityError), engine.begin() as connection:
            insert_user(connection)
    finally:
        engine.dispose()


def test_the_audit_log_outlives_the_user_it_speaks_of(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        foreign_keys = {
            tuple(fk["constrained_columns"]): fk["options"].get("ondelete")
            for fk in inspect(engine).get_foreign_keys("auditoria")
        }
        assert foreign_keys == {("usuario_id",): "SET NULL"}
        with engine.begin() as connection:
            user_id = insert_user(connection)
            insert_audit(connection, user_id, "ana@example.com")
            insert_audit(connection, None, None)
            connection.exec_driver_sql("DELETE FROM usuarios")
            rows = connection.exec_driver_sql(
                "SELECT usuario_id, usuario_email FROM auditoria ORDER BY id"
            ).all()
        assert rows == [(None, "ana@example.com"), (None, None)]
    finally:
        engine.dispose()


def test_the_audit_log_is_indexed_for_what_it_is_searched_by(database_url):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        indexed = {
            tuple(index["column_names"]) for index in inspect(engine).get_indexes("auditoria")
        }
        assert indexed == {("accion",), ("created_at",), ("usuario_id",)}
    finally:
        engine.dispose()


def test_going_back_one_step_removes_only_the_users_and_the_audit_log(database_url):
    command.upgrade(alembic_config(), "head")
    engine = make_engine(database_url)
    try:
        with engine.begin() as connection:
            insert_log(connection)
            user_id = insert_user(connection)
            insert_audit(connection, user_id, "ana@example.com")
        command.downgrade(alembic_config(), "803f3c0384e4")
        found = tables(database_url)
        assert not {"usuarios", "auditoria"} & found
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT count(*) FROM recognition_logs").scalar() == 1
        command.upgrade(alembic_config(), "head")
        assert {"usuarios", "auditoria"} <= tables(database_url)
    finally:
        engine.dispose()


def test_the_users_migration_compiles_for_postgres_with_its_defaults_and_constraints(
    monkeypatch,
):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.upgrade(alembic_config(output), "803f3c0384e4:head", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    assert "CREATE TABLE usuarios" in sql
    assert "activo BOOLEAN DEFAULT true NOT NULL" in sql
    assert "failed_attempts INTEGER DEFAULT '0' NOT NULL" in sql
    assert (
        "CONSTRAINT ck_usuarios_rol CHECK (rol IN ('administrador', 'operador', 'consulta'))"
        in (sql)
    )
    assert "UNIQUE (email)" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql
    assert "CREATE TABLE auditoria" in sql
    assert "FOREIGN KEY(usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL" in sql
    for column in ("accion", "created_at", "usuario_id"):
        assert f"CREATE INDEX ix_auditoria_{column} ON auditoria ({column})" in sql
    # A boolean written as 1 or 0 is refused by Postgres
    assert "DEFAULT 1" not in sql


def test_the_audit_log_is_dropped_before_the_users_it_points_to(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.downgrade(alembic_config(output), "head:base", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    dropped = [
        line.split()[-1].rstrip(";") for line in sql.splitlines() if line.startswith("DROP TABLE")
    ]
    assert dropped.index("auditoria") < dropped.index("usuarios")
    # The indexes go before the table they are on
    assert sql.index("DROP INDEX ix_auditoria_usuario_id") < sql.index("DROP TABLE auditoria")


APP_TABLES = (
    "personas",
    "face_embeddings",
    "recognition_logs",
    "ml_training_records",
    "usuarios",
    "auditoria",
    "alembic_version",
)


def test_row_level_security_is_switched_on_for_every_table_in_postgres(monkeypatch):
    """Supabase publishes by HTTP the tables that have it off: there is biometric data here."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.upgrade(alembic_config(output), "3601eda36a2e:head", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    for table in APP_TABLES:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;" in sql, table
    # No policy is created: with none, nobody but the owner of the tables can read them
    assert "CREATE POLICY" not in sql


def test_going_back_switches_it_off_again_in_postgres(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://usuario:clave@servidor:5432/base")
    get_settings.cache_clear()
    try:
        output = io.StringIO()
        command.downgrade(alembic_config(output), "head:3601eda36a2e", sql=True)
    finally:
        get_settings.cache_clear()
    sql = output.getvalue()
    for table in APP_TABLES:
        assert f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;" in sql, table


def test_sqlite_has_no_row_level_security_and_the_migration_does_nothing_there(database_url):
    command.upgrade(alembic_config(), "head")
    engine = create_engine(database_url)
    try:
        assert set(inspect(engine).get_table_names()) == set(EXPECTED_COLUMNS) | {"alembic_version"}
    finally:
        engine.dispose()
    command.downgrade(alembic_config(), "3601eda36a2e")
    assert tables(database_url) >= set(EXPECTED_COLUMNS)


def test_the_head_is_the_row_level_security_migration_after_users_and_audit():
    script = ScriptDirectory.from_config(alembic_config())
    head = script.get_revision(script.get_current_head())
    assert head.revision == "bf41ea862b7e"
    assert head.down_revision == "3601eda36a2e"
