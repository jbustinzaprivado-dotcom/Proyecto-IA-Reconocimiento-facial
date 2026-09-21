import csv
import io
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Persona, RecognitionLog
from app.schemas.analysis_schema import AnalysisOut
from app.services.recognition_service import label_of

WARNING = "AVISO: este archivo contiene nombres de personas. No lo compartas sin autorización."
NO_CANDIDATE = "Sin candidato"
# A cell that starts with one of these is run as a formula by Excel and LibreOffice
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")

HISTORY_HEADER = [
    "fecha",
    "persona",
    "similitud",
    "distancia",
    "umbral",
    "resultado",
    "modelo",
    "etiqueta",
]
ANALYSIS_HEADER = [
    "modelo",
    "umbral",
    "coincidencias",
    "verdaderos_positivos",
    "falsos_positivos",
    "falsos_negativos",
    "verdaderos_negativos",
    "tasa_falsos_positivos",
    "tasa_falsos_negativos",
]


def safe_cell(value: str) -> str:
    """Text typed by a person (a name) must never become a formula when the file is opened."""
    return "'" + value if value.startswith(FORMULA_STARTS) else value


def _to_bytes(rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows(rows)
    # With the byte order mark Excel reads the accents as UTF-8
    return buffer.getvalue().encode("utf-8-sig")


def _number(value: float | None) -> str:
    return "" if value is None else f"{value:.4f}"


def history_csv(db: Session, model: str | None = None) -> bytes:
    """Every attempt, newest first (not only the 200 of the screen). No vectors, no photos."""
    query = (
        select(RecognitionLog, Persona.nombre)
        .outerjoin(Persona, RecognitionLog.persona_id == Persona.id)
        .order_by(RecognitionLog.created_at.desc(), RecognitionLog.id.desc())
    )
    if model is not None:
        query = query.where(RecognitionLog.modelo == model)

    rows = [[WARNING], HISTORY_HEADER]
    for log, nombre in db.execute(query):
        label = label_of(log.esperado, log.esperado_persona_id, log.coincide, log.persona_id)
        rows.append(
            [
                log.created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                safe_cell(nombre) if nombre else NO_CANDIDATE,
                _number(log.similitud),
                _number(log.distancia),
                _number(log.umbral),
                "Coincide" if log.coincide else "No coincide",
                log.modelo,
                label or "",
            ]
        )
    return _to_bytes(rows)


def analysis_csv(analysis: AnalysisOut) -> bytes:
    """The threshold curve of one model: what each threshold would have given."""
    rows = [ANALYSIS_HEADER]
    for point in analysis.curva:
        rows.append(
            [
                analysis.modelo or "",
                f"{point.umbral:.2f}",
                str(point.coincidencias),
                str(point.verdaderos_positivos),
                str(point.falsos_positivos),
                str(point.falsos_negativos),
                str(point.verdaderos_negativos),
                _number(point.tasa_falsos_positivos),
                _number(point.tasa_falsos_negativos),
            ]
        )
    return _to_bytes(rows)


def file_name(prefix: str, now: datetime | None = None) -> str:
    return f"{prefix}_{(now or datetime.now(UTC)):%Y-%m-%d}.csv"
