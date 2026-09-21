from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.main import app
from app.models import FaceEmbedding, Persona
from tests.fakes import FakeEngine, face

VALID = {
    "nombre": "Ana Torres",
    "email": "ana.torres@example.com",
    "consentimiento_version": "v0-provisional",
}


def test_creating_a_person_answers_201_with_the_person_in_the_envelope(client: TestClient):
    response = client.post("/api/personas", json=VALID)
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    persona = body["resultado"]
    assert persona["id"] == 1
    assert persona["nombre"] == "Ana Torres"
    assert persona["email"] == "ana.torres@example.com"
    assert persona["activo"] is True
    assert persona["consentimiento_version"] == "v0-provisional"
    assert set(persona) == {
        "id",
        "nombre",
        "email",
        "activo",
        "created_at",
        "consentimiento_at",
        "consentimiento_version",
        "rostros",
    }
    assert persona["rostros"] == 0


def test_the_server_sets_the_consent_date_in_utc(client: TestClient):
    before = datetime.now(UTC) - timedelta(seconds=1)
    persona = client.post("/api/personas", json=VALID).json()["resultado"]
    after = datetime.now(UTC) + timedelta(seconds=1)

    consent = datetime.fromisoformat(persona["consentimiento_at"])
    assert consent.utcoffset() == timedelta(0)
    assert before <= consent <= after
    assert persona["consentimiento_at"].endswith("Z")


def test_a_consent_date_sent_by_the_client_is_ignored(client: TestClient):
    persona = client.post(
        "/api/personas", json={**VALID, "consentimiento_at": "2000-01-01T00:00:00Z"}
    ).json()["resultado"]
    assert not persona["consentimiento_at"].startswith("2000")


def test_the_person_is_really_saved(client: TestClient, db: Session):
    client.post("/api/personas", json=VALID)
    saved = db.scalars(select(Persona)).one()
    assert (saved.nombre, saved.email, saved.consentimiento_version) == (
        "Ana Torres",
        "ana.torres@example.com",
        "v0-provisional",
    )


def test_the_name_is_trimmed_and_repeated_spaces_are_collapsed_but_case_and_accents_stay(
    client: TestClient,
):
    persona = client.post(
        "/api/personas", json={**VALID, "nombre": "  María   José\tPérez  "}
    ).json()["resultado"]
    assert persona["nombre"] == "María José Pérez"


def test_the_email_is_saved_lowercase_and_without_surrounding_spaces(client: TestClient):
    persona = client.post(
        "/api/personas", json={**VALID, "email": "  Ana.Torres@Example.COM "}
    ).json()["resultado"]
    assert persona["email"] == "ana.torres@example.com"


def test_the_same_mailbox_with_other_case_is_a_duplicate(client: TestClient, register):
    register("Ana Torres", "ana.torres@example.com", seeds=(1,))
    response = client.post(
        "/api/personas", json={**VALID, "nombre": "Otra", "email": " ANA.TORRES@example.com"}
    )
    assert response.status_code == 409
    assert response.json() == {
        "success": False,
        "error": "Ya existe una persona registrada con ese correo.",
    }


def test_a_duplicate_does_not_create_a_second_person_and_the_next_one_still_works(
    client: TestClient, db: Session, register
):
    register("Ana Torres", "ana.torres@example.com", seeds=(1,))
    assert client.post("/api/personas", json=VALID).status_code == 409
    other = client.post("/api/personas", json={**VALID, "email": "luis@example.com"})
    assert other.status_code == 201
    assert len(db.scalars(select(Persona)).all()) == 2


def test_the_name_needs_2_to_100_characters(client: TestClient):
    limits = {"A": 422, "Al": 201, "A" * 100: 201, "A" * 101: 422, "   ": 422, "": 422}
    for index, (nombre, status) in enumerate(limits.items()):
        response = client.post(
            "/api/personas", json={**VALID, "nombre": nombre, "email": f"p{index}@example.com"}
        )
        assert response.status_code == status, f"{len(nombre)} caracteres"
        if status == 422:
            assert response.json()["error"] == "El nombre debe tener entre 2 y 100 caracteres."


def test_the_length_of_the_name_is_measured_after_trimming(client: TestClient):
    response = client.post("/api/personas", json={**VALID, "nombre": " A "})
    assert response.status_code == 422


def test_email_formats_are_checked_with_the_same_rule_as_the_frontend(client: TestClient):
    accepted = ["a@b.co", "nombre+etiqueta@dominio.com.pe", "a.b@c.d"]
    refused = ["", "sin-arroba.com", "@b.co", "a@b", "a@.co", "a b@c.co", "a@b@c.co"]
    for email in accepted:
        assert client.post("/api/personas", json={**VALID, "email": email}).status_code == 201, (
            email
        )
    for email in refused:
        response = client.post("/api/personas", json={**VALID, "email": email})
        assert response.status_code == 422, email
        assert response.json()["error"] == "El correo no tiene un formato válido."


def test_an_email_over_254_characters_is_refused(client: TestClient):
    long_email = "a" * 246 + "@example.com"
    assert len(long_email) == 258
    assert client.post("/api/personas", json={**VALID, "email": long_email}).status_code == 422
    at_limit = "a" * 242 + "@example.com"
    assert len(at_limit) == 254
    assert client.post("/api/personas", json={**VALID, "email": at_limit}).status_code == 201


def test_only_known_consent_versions_are_accepted(client: TestClient):
    for version in ["v1", "v2", "", "V0-PROVISIONAL", " v0-provisional", "cualquier cosa"]:
        response = client.post("/api/personas", json={**VALID, "consentimiento_version": version})
        assert response.status_code == 422, version
        assert response.json()["error"] == "Versión de consentimiento no válida."


def test_the_list_is_empty_at_the_start(client: TestClient):
    response = client.get("/api/personas")
    assert response.status_code == 200
    assert response.json() == {"success": True, "resultado": []}


def test_the_list_is_alphabetical_ignoring_case_and_accents(client: TestClient, register):
    for nombre, email in [
        ("Zoe Vega", "zoe@example.com"),
        ("Álvaro Díaz", "alvaro@example.com"),
        ("carlos ruiz", "carlos@example.com"),
        ("Beatriz Luna", "beatriz@example.com"),
        ("Alzira Mena", "alzira@example.com"),
    ]:
        register(nombre, email)
    names = [p["nombre"] for p in client.get("/api/personas").json()["resultado"]]
    assert names == ["Álvaro Díaz", "Alzira Mena", "Beatriz Luna", "carlos ruiz", "Zoe Vega"]


def test_people_with_the_same_name_are_listed_in_order_of_registration(
    client: TestClient, register
):
    first = register("Ana Torres", "una@example.com")
    second = register("Ana Torres", "otra@example.com")
    ids = [p["id"] for p in client.get("/api/personas").json()["resultado"]]
    assert ids == [first["id"], second["id"]]


def test_the_list_includes_people_without_faces(client: TestClient, register):
    register("Sin Rostro", "sin@example.com")
    assert len(client.get("/api/personas").json()["resultado"]) == 1


def test_no_biometric_data_ever_leaves_in_a_person_or_the_list(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1, 2))
    created = client.post("/api/personas", json={**VALID, "email": "otra@example.com"})
    listed = client.get("/api/personas")
    for response in (created, listed):
        assert "embedding" not in response.text
        assert "modelo" not in response.text


class TestCompletingARegistrationWithoutFaces:
    """A registration that failed at the photos leaves a person with no face. Registering again
    with the same address completes that person instead of refusing it forever."""

    def first_try(self, client: TestClient) -> dict:
        response = client.post("/api/personas", json=VALID)
        assert response.status_code == 201
        return response.json()["resultado"]

    def test_the_same_person_comes_back_with_the_same_id_and_no_second_row(
        self, client: TestClient, db: Session
    ):
        first = self.first_try(client)
        again = client.post("/api/personas", json=VALID)
        assert again.status_code == 201
        assert again.json()["resultado"]["id"] == first["id"]
        assert len(db.scalars(select(Persona)).all()) == 1

    def test_what_was_refreshed_is_really_saved_and_not_only_answered(
        self, client: TestClient, db: Session
    ):
        first = self.first_try(client)
        client.post("/api/personas", json={**VALID, "nombre": "Ana María Torres"})
        # A change that was never committed would vanish here, as it does when the request ends
        db.rollback()
        db.expire_all()
        assert db.get(Persona, first["id"]).nombre == "Ana María Torres"

    def test_the_name_and_the_consent_are_refreshed_but_not_the_creation_date(
        self, client: TestClient
    ):
        first = self.first_try(client)
        again = client.post("/api/personas", json={**VALID, "nombre": "Ana María Torres"}).json()[
            "resultado"
        ]
        assert again["nombre"] == "Ana María Torres"
        assert again["created_at"] == first["created_at"]
        assert again["consentimiento_at"] > first["consentimiento_at"]

    def test_the_mailbox_is_matched_ignoring_case_and_spaces(self, client: TestClient):
        first = self.first_try(client)
        again = client.post("/api/personas", json={**VALID, "email": "  ANA.TORRES@Example.com "})
        assert again.status_code == 201
        assert again.json()["resultado"]["id"] == first["id"]

    def test_a_person_who_has_faces_is_never_touched(
        self, client: TestClient, db: Session, register
    ):
        first = register("Ana Torres", "ana.torres@example.com", seeds=(1,))
        response = client.post("/api/personas", json={**VALID, "nombre": "Otra Persona"})
        assert response.status_code == 409
        db.expire_all()
        saved = db.get(Persona, first["id"])
        assert saved.nombre == "Ana Torres"

    def test_it_counts_as_having_faces_whatever_the_model_that_made_them(
        self, client: TestClient, db: Session, register
    ):
        first = register("Ana Torres", "ana.torres@example.com", seeds=(1,))
        for row in db.scalars(select(FaceEmbedding)):
            row.modelo = "insightface-buffalo_l"
        db.commit()
        assert client.post("/api/personas", json=VALID).status_code == 409
        assert db.get(Persona, first["id"]).nombre == "Ana Torres"

    def test_once_it_gets_its_faces_the_address_is_taken_again(
        self, client: TestClient, make_image
    ):
        first = self.first_try(client)
        again = client.post("/api/personas", json=VALID).json()["resultado"]
        saved = client.post(
            f"/api/personas/{again['id']}/rostro",
            files=[("imagenes", ("a.png", make_image(1), "image/png"))],
        )
        assert saved.status_code == 200
        assert client.post("/api/personas", json=VALID).status_code == 409
        assert again["id"] == first["id"]

    def test_a_new_mailbox_is_still_a_new_person(self, client: TestClient):
        first = self.first_try(client)
        other = client.post("/api/personas", json={**VALID, "email": "otra@example.com"})
        assert other.json()["resultado"]["id"] != first["id"]

    def test_the_whole_story_a_bad_photo_and_then_a_good_one(
        self, client: TestClient, db: Session, make_image
    ):
        # First try: the person is created, then the photo is refused (two faces in it)
        first = self.first_try(client)
        app.state.face_engine = FakeEngine([face(at=(0, 0)), face(at=(200, 0))])
        refused = client.post(
            f"/api/personas/{first['id']}/rostro",
            files=[("imagenes", ("blob", make_image(1), "image/png"))],
        )
        assert refused.status_code == 422
        assert db.scalars(select(FaceEmbedding)).all() == []

        # Second try with the same address and a good photo: the same person is completed
        app.state.face_engine = FakeEngine([face()])
        again = client.post("/api/personas", json=VALID).json()["resultado"]
        assert again["id"] == first["id"]
        saved = client.post(
            f"/api/personas/{again['id']}/rostro",
            files=[("imagenes", ("blob", make_image(2), "image/png"))],
        )
        assert saved.status_code == 200
        assert len(db.scalars(select(Persona)).all()) == 1
        assert len(db.scalars(select(FaceEmbedding)).all()) == 1
