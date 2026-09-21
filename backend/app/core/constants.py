"""Fixed rules of the API. What may change per environment lives in config.py instead."""

# Versions of the consent text the frontend can show (D45: only the provisional one exists).
# When the final text is approved, add "v1" here and in the frontend together
CONSENT_VERSIONS = frozenset({"v0-provisional"})

NAME_MIN_LENGTH = 2
NAME_MAX_LENGTH = 100
EMAIL_MAX_LENGTH = 254

# The history grows with every attempt: only the most recent ones are returned
HISTORY_LIMIT = 200

# Default margin: a match is "alta" when the similarity clears the threshold by at least this much
HIGH_CONFIDENCE_MARGIN = 0.10

# Detections weaker than this are never returned by an engine. The minimum confidence to accept a
# face (MIN_DETECTION_SCORE) may not go below this floor, so that a doubtful detection can be told
# apart from no detection at all
DETECTION_FLOOR = 0.3

# A small PNG can expand into a huge bitmap: refuse images beyond this before decoding them
MAX_IMAGE_PIXELS = 25_000_000

# Machine learning (Phase 4). The rules of what is enough data are practical rules of thumb, not
# statistics: they are here so that they are easy to find and to change
ML_MIN_EXAMPLES = 50
ML_MIN_PER_CLASS = 15
ML_MIN_PEOPLE = 3
ML_MAX_FOLDS = 5
ML_CALIBRATION_FOLDS = 3
ML_SEED = 42
# The probability from which a comparison counts as "correct" when the metrics are worked out
ML_DECISION_CUT = 0.5

# How the two 0 to 1 scores are made from what was measured on the face. They are fixed on purpose:
# unlike the quality limits of the .env, they must not move under records that already exist
ILLUMINATION_CENTER = 130.0
ILLUMINATION_HALF_RANGE = 90.0
SHARPNESS_GOOD = 0.10
FACE_SIZE_GOOD = 200

# Access (Phase 5). Three roles: the administrator can do everything, the operator registers and
# recognizes people, and the viewer only looks
ROLE_ADMIN = "administrador"
ROLE_OPERATOR = "operador"
ROLE_VIEWER = "consulta"
ROLES = (ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER)

PASSWORD_MIN_LENGTH = 10
# An upper bound so that a huge "password" cannot be used to make the server work hard
PASSWORD_MAX_LENGTH = 128

JWT_ALGORITHM = "HS256"
JWT_SECRET_MIN_LENGTH = 32

# After this many wrong passwords in a row the account is locked for a while
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_MINUTES = 15

AUDIT_PAGE_DEFAULT = 100
AUDIT_PAGE_MAX = 200
AUDIT_DETAIL_MAX_LENGTH = 500
