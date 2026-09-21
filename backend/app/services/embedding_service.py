import numpy as np

# Little-endian float32 on every machine, so a vector saved on one can be read on another
STORAGE_DTYPE = np.dtype("<f4")


def to_bytes(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=STORAGE_DTYPE).tobytes()


def from_bytes(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=STORAGE_DTYPE)


def _unit_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    # A zero vector stays zero (similarity 0 with everything) instead of dividing by zero
    return matrix / np.where(norms == 0, 1, norms)


def best_match(query: np.ndarray, candidates: list[tuple[int, np.ndarray]]) -> tuple[int, float]:
    """Compare a vector with every stored vector (1:N) and return (persona_id, similarity).

    The similarity is the cosine, kept between 0 and 1. A person with several vectors is
    represented by the one closest to the query.
    """
    if not candidates:
        raise ValueError("No hay vectores con los que comparar")
    matrix = _unit_rows(np.stack([vector for _, vector in candidates]).astype(np.float32))
    scores = matrix @ _unit_rows(np.asarray(query, dtype=np.float32))
    best = int(np.argmax(scores))
    return candidates[best][0], float(np.clip(scores[best], 0.0, 1.0))
