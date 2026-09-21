from collections.abc import Callable, Iterator

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  (registers the tables in Base.metadata)
from app.api.deps import ENGINE_NOT_LOADED
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.constants import ROLE_ADMIN
from app.core.security import create_token, hash_password
from app.database.connection import Base, get_db, make_engine
from app.database.types import utcnow
from app.main import app
from app.models import Usuario
from app.services.face_engines import SimulatedEngine

CONSENT = "v0-provisional"
PASSWORD = "clave-de-prueba-123"
ADMIN_EMAIL = "admin@example.com"
# Hashing is slow on purpose: it is done once, and every test user shares it
PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture(scope="session", autouse=True)
def the_real_folder_of_the_models_stays_untouched() -> Iterator[None]:
    """No test may train or save a probability model where the API would really look for it."""
    folder = BACKEND_DIR / "models" / "ml"

    def listing() -> list[str] | None:
        return sorted(path.name for path in folder.iterdir()) if folder.exists() else None

    before = listing()
    yield
    assert listing() == before, (
        "Una prueba escribió en la carpeta real de modelos (backend/models/ml)"
    )


@pytest.fixture
def db() -> Iterator[Session]:
    engine = make_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        yield session
    engine.dispose()


def make_user(
    db: Session,
    role: str = ROLE_ADMIN,
    email: str | None = None,
    name: str | None = None,
    active: bool = True,
) -> Usuario:
    """A user with the password PASSWORD, saved in the database of the test."""
    email = email or f"{role}@example.com"
    user = Usuario(
        email=email,
        nombre=name or role.capitalize(),
        rol=role,
        password_hash=PASSWORD_HASH,
        activo=active,
    )
    db.add(user)
    db.commit()
    return user


def token_of(user: Usuario, minutes: int = 60) -> str:
    """A valid token for this user, as the API would have given it after the sign-in."""
    return create_token(user.id, user.rol, Settings(_env_file=None).signing_key, minutes, utcnow())


def authorization(user: Usuario) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_of(user)}"}


@pytest.fixture
def client(db: Session, tmp_path) -> Iterator[TestClient]:
    """The API with an empty in-memory database and the simulated engine already loaded, called by
    an administrator who has signed in (most tests are not about who is calling).

    It does not use `with TestClient(...)` on purpose: that would run the start-up and load the
    engine chosen in .env (real weights included) for every test.
    """
    app.dependency_overrides[get_db] = lambda: db
    # The developer's own .env must not change what the tests see, and nothing a test does may end
    # up in the real folder of the models
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, models_dir=tmp_path / "models"
    )
    app.state.rate_limiter.reset()
    app.state.face_engine = SimulatedEngine()
    app.state.face_engine_error = None
    admin = make_user(db, ROLE_ADMIN, ADMIN_EMAIL, "Administrador")
    yield TestClient(app, headers=authorization(admin))
    app.dependency_overrides.clear()
    app.state.face_engine = None
    app.state.face_engine_error = ENGINE_NOT_LOADED


@pytest.fixture
def use_settings(client: TestClient, tmp_path) -> Callable[..., Settings]:
    """Change what the API reads from the environment, for this test only. Everything else stays as
    the `client` fixture left it (no .env, and a folder of its own for the models)."""

    def factory(**changes) -> Settings:
        values = {"_env_file": None, "models_dir": tmp_path / "models", **changes}
        settings = Settings(**values)
        app.dependency_overrides[get_settings] = lambda: settings
        return settings

    return factory


@pytest.fixture
def anonymous(client: TestClient) -> TestClient:
    """The same API called by someone who has not signed in."""
    return TestClient(app)


@pytest.fixture
def client_as(db: Session, client: TestClient) -> Callable[..., TestClient]:
    """The same API called by a user of this role, who has signed in."""

    def factory(role: str) -> TestClient:
        user = db.query(Usuario).filter_by(rol=role).first() or make_user(db, role)
        return TestClient(app, headers=authorization(user))

    return factory


@pytest.fixture
def make_image() -> Callable[..., bytes]:
    """An encoded image of random noise: the same seed always gives the same picture, and two
    seeds give pictures that have nothing in common. Big enough to pass the quality checks."""

    def factory(seed: int = 0, ext: str = ".png", size: tuple[int, int] = (160, 160)) -> bytes:
        pixels = np.random.default_rng(seed).integers(0, 256, (*size, 3), dtype=np.uint8)
        ok, encoded = cv2.imencode(ext, pixels)
        assert ok
        return encoded.tobytes()

    return factory


@pytest.fixture
def register(client: TestClient, make_image) -> Callable[..., dict]:
    """Register a person through the API, with one face per seed, and return the stored person."""

    def factory(nombre: str, email: str, seeds: tuple[int, ...] = ()) -> dict:
        created = client.post(
            "/api/personas",
            json={"nombre": nombre, "email": email, "consentimiento_version": CONSENT},
        )
        assert created.status_code == 201, created.text
        persona = created.json()["resultado"]
        if seeds:
            files = [("imagenes", (f"{seed}.png", make_image(seed), "image/png")) for seed in seeds]
            saved = client.post(f"/api/personas/{persona['id']}/rostro", files=files)
            assert saved.status_code == 200, saved.text
        return persona

    return factory
