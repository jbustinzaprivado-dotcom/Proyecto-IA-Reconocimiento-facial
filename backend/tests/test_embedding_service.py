import numpy as np
import pytest

from app.services import embedding_service as embeddings


def test_a_vector_survives_being_saved_and_read_back():
    vector = np.random.default_rng(1).standard_normal(512).astype(np.float32)
    data = embeddings.to_bytes(vector)
    assert len(data) == 512 * 4
    assert np.array_equal(embeddings.from_bytes(data), vector)


def test_the_saved_format_is_little_endian_float32_whatever_the_machine():
    # 1.0 as little-endian float32 is 00 00 80 3F
    assert embeddings.to_bytes(np.array([1.0])) == bytes([0x00, 0x00, 0x80, 0x3F])


def test_saving_converts_float64_vectors_to_float32():
    assert len(embeddings.to_bytes(np.ones(10, dtype=np.float64))) == 40


def test_the_closest_stored_vector_wins_and_its_owner_is_returned():
    candidates = [
        (10, np.array([1.0, 0.0, 0.0])),
        (20, np.array([0.0, 1.0, 0.0])),
        (30, np.array([0.6, 0.8, 0.0])),
    ]
    persona_id, similarity = embeddings.best_match(np.array([0.0, 1.0, 0.0]), candidates)
    assert persona_id == 20
    assert similarity == pytest.approx(1.0)


def test_similarity_is_the_cosine_so_the_length_of_the_vectors_does_not_matter():
    persona_id, similarity = embeddings.best_match(
        np.array([3.0, 4.0]), [(7, np.array([0.6, 0.8]) * 100)]
    )
    assert persona_id == 7
    assert similarity == pytest.approx(1.0)


def test_the_query_does_not_have_to_be_a_unit_vector():
    # cos = 0.7071 however long the query is
    _, similarity = embeddings.best_match(np.array([2.0, 0.0]), [(1, np.array([1.0, 1.0]))])
    assert similarity == pytest.approx(2**-0.5)


def test_the_cosine_is_computed_not_assumed():
    # 45 degrees apart: cos = 0.7071
    _, similarity = embeddings.best_match(np.array([1.0, 0.0]), [(1, np.array([1.0, 1.0]))])
    assert similarity == pytest.approx(2**-0.5)


def test_opposite_vectors_give_zero_not_a_negative_similarity():
    _, similarity = embeddings.best_match(np.array([1.0, 0.0]), [(1, np.array([-1.0, 0.0]))])
    assert similarity == 0.0


def test_a_person_with_several_vectors_is_represented_by_the_closest_one():
    candidates = [
        (1, np.array([1.0, 0.0])),
        (1, np.array([0.0, 1.0])),
        (2, np.array([0.8, 0.6])),
    ]
    persona_id, similarity = embeddings.best_match(np.array([0.0, 1.0]), candidates)
    assert persona_id == 1
    assert similarity == pytest.approx(1.0)


def test_similarity_never_exceeds_one_because_of_rounding():
    vector = np.random.default_rng(2).standard_normal(512).astype(np.float32)
    _, similarity = embeddings.best_match(vector, [(1, vector.copy())])
    assert similarity <= 1.0


def test_a_zero_vector_matches_nothing_instead_of_failing():
    _, similarity = embeddings.best_match(np.array([1.0, 0.0]), [(1, np.zeros(2))])
    assert similarity == 0.0


def test_there_must_be_something_to_compare_with():
    with pytest.raises(ValueError):
        embeddings.best_match(np.array([1.0]), [])
