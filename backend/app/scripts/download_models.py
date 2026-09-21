"""Download the model weights the face engines need. The API never downloads anything by itself.

    python -m app.scripts.download_models                      # every engine
    python -m app.scripts.download_models --engine sface       # only SFace and YuNet
    python -m app.scripts.download_models --engine insightface

It shows what will be downloaded (file, origin and size) and asks before starting.
"""

import argparse
import hashlib
import shutil
import ssl
import sys
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings, get_settings

CHUNK_BYTES = 1024 * 1024
REPORT_EVERY_BYTES = 32 * CHUNK_BYTES
REQUEST_TIMEOUT_SECONDS = 60
INSIGHTFACE_ORIGIN = "https://github.com/deepinsight/insightface/releases/download/model-zoo/"
OPENCV_ZOO_ORIGIN = "https://github.com/opencv/opencv_zoo/raw/main/models/"
# Sizes measured before the first download: a truncated file or a Git LFS pointer will not match
INSIGHTFACE_PACK_SIZES = {"buffalo_l": 288_621_354, "buffalo_s": 127_607_557}


@dataclass(frozen=True)
class Asset:
    engine: str
    filename: str
    url: str
    # Folder inside the models folder where it ends up (a zip is extracted there)
    target: str
    # Expected size in bytes, when it is known
    size: int | None = None

    @property
    def is_zip(self) -> bool:
        return self.filename.endswith(".zip")


def assets_for(engine: str, insightface_model: str = "buffalo_l") -> list[Asset]:
    chosen = {"insightface", "sface"} if engine == "all" else {engine}
    assets = []
    if "insightface" in chosen:
        assets.append(
            Asset(
                engine="insightface",
                filename=f"{insightface_model}.zip",
                url=f"{INSIGHTFACE_ORIGIN}{insightface_model}.zip",
                target=f"insightface/{insightface_model}",
                size=INSIGHTFACE_PACK_SIZES.get(insightface_model),
            )
        )
    if "sface" in chosen:
        for folder, filename, size in (
            ("face_recognition_sface", "face_recognition_sface_2021dec.onnx", 38_696_353),
            ("face_detection_yunet", "face_detection_yunet_2023mar.onnx", 232_589),
        ):
            assets.append(
                Asset(
                    engine="sface",
                    filename=filename,
                    url=f"{OPENCV_ZOO_ORIGIN}{folder}/{filename}",
                    target="sface",
                    size=size,
                )
            )
    return assets


def is_installed(asset: Asset, models_dir: Path) -> bool:
    target = models_dir / asset.target
    if asset.is_zip:
        return target.is_dir() and any(target.glob("*.onnx"))
    return (target / asset.filename).is_file()


def megabytes(size: int | None) -> str:
    return "tamaño desconocido" if size is None else f"{size / (1024 * 1024):.1f} MB"


class DownloadError(Exception):
    pass


def open_url(request: urllib.request.Request, log: Callable[[str], None]):
    """Open the URL with normal certificate checks.

    Some antivirus programs (Avast Web/Mail Shield, for one) inspect HTTPS with their own root
    certificate, which Windows trusts but Python 3.13 rejects for a formatting detail: "Basic
    Constraints of CA cert not marked critical". Only for that exact failure it tries again
    without the strict X.509 conformance check. The certificate chain and the host name are still
    verified, and the size of the download is checked afterwards.
    """
    try:
        return urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS)
    except urllib.error.URLError as error:
        reason = error.reason
        if not (
            isinstance(reason, ssl.SSLCertVerificationError)
            and "not marked critical" in str(reason)
        ):
            raise
        log(
            "  Aviso: un certificado de la conexión (probablemente de tu antivirus) no cumple la "
            "comprobación estricta de Python 3.13. Se reintenta sin esa comprobación; la cadena "
            "de certificados y el nombre del servidor siguen verificándose."
        )
        context = ssl.create_default_context()
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
        return urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS, context=context)


def download(
    asset: Asset,
    models_dir: Path,
    log: Callable[[str], None] = print,
) -> str:
    """Download one asset into the models folder and return the SHA-256 of what was downloaded.

    The file is written under a temporary name and moved only when its size is the expected one,
    so an interrupted download never leaves a broken file that looks complete.
    """
    target = models_dir / asset.target
    target.mkdir(parents=True, exist_ok=True)
    partial = target / (asset.filename + ".part")
    digest = hashlib.sha256()
    received = 0
    next_report = REPORT_EVERY_BYTES
    request = urllib.request.Request(asset.url, headers={"User-Agent": "reconocimiento-facial"})
    try:
        with open_url(request, log) as response:
            with partial.open("wb") as out:
                while chunk := response.read(CHUNK_BYTES):
                    out.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
                    if received >= next_report:
                        log(f"  {megabytes(received)} de {megabytes(asset.size)}")
                        next_report += REPORT_EVERY_BYTES
        if asset.size is not None and received != asset.size:
            raise DownloadError(
                f"{asset.filename}: se esperaban {asset.size} bytes y llegaron {received}"
            )
        if received == 0:
            raise DownloadError(f"{asset.filename}: la descarga llegó vacía")
        if asset.is_zip:
            extract_zip(partial, target)
            partial.unlink()
        else:
            partial.replace(target / asset.filename)
    except (OSError, zipfile.BadZipFile) as error:
        raise DownloadError(f"{asset.filename}: {error}") from error
    finally:
        partial.unlink(missing_ok=True)
    return digest.hexdigest()


def extract_zip(archive: Path, target: Path) -> None:
    """Extract only .onnx files that stay inside the target folder."""
    with zipfile.ZipFile(archive) as zf:
        members = [
            name for name in zf.namelist() if name.endswith(".onnx") and not name.endswith("/")
        ]
        if not members:
            raise DownloadError(f"{archive.name}: no contiene ningún modelo .onnx")
        for name in members:
            destination = (target / Path(name).name).resolve()
            if target.resolve() not in destination.parents:
                raise DownloadError(f"{archive.name}: ruta no permitida dentro del archivo")
            with zf.open(name) as source, destination.open("wb") as out:
                shutil.copyfileobj(source, out)


def run(
    engine: str,
    settings: Settings,
    assume_yes: bool = False,
    force: bool = False,
    ask: Callable[[str], str] = input,
    log: Callable[[str], None] = print,
) -> int:
    assets = assets_for(engine, settings.insightface_model)
    pending = [a for a in assets if force or not is_installed(a, settings.models_dir)]
    log(f"Carpeta de modelos: {settings.models_dir}")
    for asset in assets:
        state = "ya está" if asset not in pending else "se descargará"
        log(f"- {asset.filename} ({megabytes(asset.size)}) desde {asset.url}: {state}")
    if not pending:
        log("No hay nada que descargar.")
        return 0
    if not assume_yes and ask("¿Descargar ahora? [s/N] ").strip().lower() not in {"s", "si", "sí"}:
        log("Cancelado. No se descargó nada.")
        return 1
    for asset in pending:
        log(f"Descargando {asset.filename}…")
        try:
            sha256 = download(asset, settings.models_dir, log)
        except DownloadError as error:
            log(f"Error: {error}")
            return 2
        log(f"  listo. SHA-256 de lo descargado: {sha256}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Descarga los pesos de los motores faciales.")
    parser.add_argument("--engine", choices=["all", "insightface", "sface"], default="all")
    parser.add_argument("--yes", action="store_true", help="no preguntar antes de descargar")
    parser.add_argument("--force", action="store_true", help="descargar aunque ya estén")
    args = parser.parse_args(argv)
    return run(args.engine, get_settings(), assume_yes=args.yes, force=args.force)


if __name__ == "__main__":
    sys.exit(main())
