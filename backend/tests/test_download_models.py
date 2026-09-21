import hashlib
import ssl
import urllib.error
import zipfile
from pathlib import Path

import pytest

from app.core.config import Settings
from app.scripts import download_models as dm

CONTENT = b"pesos de prueba" * 100


def asset(tmp_path: Path, name: str = "modelo.onnx", size: int | None = None, data=CONTENT):
    source = tmp_path / "origen" / name
    source.parent.mkdir(exist_ok=True)
    source.write_bytes(data)
    return dm.Asset(engine="sface", filename=name, url=source.as_uri(), target="destino", size=size)


def make_zip(path: Path, files: dict[str, bytes]) -> bytes:
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return path.read_bytes()


class TestAssets:
    def test_all_lists_the_three_files_with_their_origin_and_size(self):
        assets = dm.assets_for("all")
        assert [(a.engine, a.filename, a.size) for a in assets] == [
            ("insightface", "buffalo_l.zip", 288_621_354),
            ("sface", "face_recognition_sface_2021dec.onnx", 38_696_353),
            ("sface", "face_detection_yunet_2023mar.onnx", 232_589),
        ]
        assert assets[0].url == (
            "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip"
        )
        assert assets[1].url.startswith("https://github.com/opencv/opencv_zoo/raw/main/models/")

    def test_one_engine_lists_only_its_files(self):
        assert {a.engine for a in dm.assets_for("sface")} == {"sface"}
        assert [a.filename for a in dm.assets_for("insightface")] == ["buffalo_l.zip"]

    def test_another_insightface_pack_gets_its_own_url_and_folder(self):
        (small,) = dm.assets_for("insightface", "buffalo_s")
        assert small.url.endswith("/model-zoo/buffalo_s.zip")
        assert small.target == "insightface/buffalo_s"
        assert small.size == 127_607_557

    def test_an_unknown_pack_has_no_expected_size(self):
        (other,) = dm.assets_for("insightface", "otro_paquete")
        assert other.size is None

    def test_the_files_end_where_the_engines_look_for_them(self):
        from app.services.face_engines import sface_engine

        sface_names = {a.filename for a in dm.assets_for("sface")}
        assert sface_names == {sface_engine.DETECTOR_FILE, sface_engine.RECOGNIZER_FILE}
        assert {a.target for a in dm.assets_for("sface")} == {"sface"}


class TestIsInstalled:
    def test_a_plain_file_is_installed_when_it_exists(self, tmp_path):
        a = dm.assets_for("sface")[0]
        assert not dm.is_installed(a, tmp_path)
        (tmp_path / "sface").mkdir()
        (tmp_path / "sface" / a.filename).write_bytes(b"x")
        assert dm.is_installed(a, tmp_path)

    def test_a_pack_is_installed_when_its_folder_holds_models(self, tmp_path):
        (pack,) = dm.assets_for("insightface")
        (tmp_path / "insightface" / "buffalo_l").mkdir(parents=True)
        assert not dm.is_installed(pack, tmp_path)
        (tmp_path / "insightface" / "buffalo_l" / "det.onnx").write_bytes(b"x")
        assert dm.is_installed(pack, tmp_path)


class TestDownload:
    def test_a_file_is_saved_and_its_hash_is_returned(self, tmp_path):
        models = tmp_path / "modelos"
        a = asset(tmp_path, size=len(CONTENT))
        sha = dm.download(a, models, log=lambda _: None)
        assert (models / "destino" / "modelo.onnx").read_bytes() == CONTENT
        assert sha == hashlib.sha256(CONTENT).hexdigest()

    def test_no_temporary_file_is_left_behind(self, tmp_path):
        models = tmp_path / "modelos"
        dm.download(asset(tmp_path, size=len(CONTENT)), models, log=lambda _: None)
        assert sorted(p.name for p in (models / "destino").iterdir()) == ["modelo.onnx"]

    def test_a_wrong_size_is_an_error_and_nothing_is_kept(self, tmp_path):
        models = tmp_path / "modelos"
        with pytest.raises(dm.DownloadError, match="se esperaban"):
            dm.download(asset(tmp_path, size=len(CONTENT) + 1), models, log=lambda _: None)
        assert list((models / "destino").iterdir()) == []

    def test_an_empty_download_is_an_error(self, tmp_path):
        with pytest.raises(dm.DownloadError, match="vacía"):
            dm.download(asset(tmp_path, data=b""), tmp_path / "modelos", log=lambda _: None)

    def test_an_unreachable_origin_is_an_error_with_the_file_name(self, tmp_path):
        missing = dm.Asset("sface", "no_existe.onnx", (tmp_path / "no_existe.onnx").as_uri(), "d")
        with pytest.raises(dm.DownloadError, match="no_existe.onnx"):
            dm.download(missing, tmp_path / "modelos", log=lambda _: None)

    def test_a_zip_is_extracted_flat_keeping_only_the_models(self, tmp_path):
        archive = tmp_path / "origen" / "pack.zip"
        archive.parent.mkdir()
        data = make_zip(
            archive, {"a.onnx": b"A", "carpeta/b.onnx": b"B", "LEEME.txt": b"no", "carpeta/": b""}
        )
        a = dm.Asset("insightface", "pack.zip", archive.as_uri(), "insightface/pack", len(data))
        models = tmp_path / "modelos"
        dm.download(a, models, log=lambda _: None)
        pack = models / "insightface" / "pack"
        assert sorted(p.name for p in pack.iterdir()) == ["a.onnx", "b.onnx"]
        assert (pack / "b.onnx").read_bytes() == b"B"

    def test_the_zip_itself_is_deleted_after_extracting_it(self, tmp_path):
        archive = tmp_path / "origen" / "pack.zip"
        archive.parent.mkdir()
        data = make_zip(archive, {"a.onnx": b"A"})
        a = dm.Asset("insightface", "pack.zip", archive.as_uri(), "p", len(data))
        dm.download(a, tmp_path / "modelos", log=lambda _: None)
        assert not list((tmp_path / "modelos").rglob("*.zip*"))

    def test_a_path_that_climbs_out_of_the_folder_cannot_write_outside_of_it(self, tmp_path):
        archive = tmp_path / "origen" / "pack.zip"
        archive.parent.mkdir()
        data = make_zip(archive, {"../../fuera.onnx": b"malo"})
        a = dm.Asset("insightface", "pack.zip", archive.as_uri(), "insightface/pack", len(data))
        models = tmp_path / "modelos"
        dm.download(a, models, log=lambda _: None)
        assert not (tmp_path / "fuera.onnx").exists()
        assert not (models / "fuera.onnx").exists()
        assert (models / "insightface" / "pack" / "fuera.onnx").read_bytes() == b"malo"

    def test_a_zip_without_models_is_an_error(self, tmp_path):
        archive = tmp_path / "origen" / "pack.zip"
        archive.parent.mkdir()
        data = make_zip(archive, {"LEEME.txt": b"nada"})
        a = dm.Asset("insightface", "pack.zip", archive.as_uri(), "p", len(data))
        with pytest.raises(dm.DownloadError, match="ningún modelo"):
            dm.download(a, tmp_path / "modelos", log=lambda _: None)

    def test_something_that_is_not_a_zip_is_an_error(self, tmp_path):
        a = asset(tmp_path, name="pack.zip", data=b"esto no es un zip")
        with pytest.raises(dm.DownloadError, match="pack.zip"):
            dm.download(a, tmp_path / "modelos", log=lambda _: None)

    def test_the_progress_is_reported_at_every_step(self, tmp_path, monkeypatch):
        monkeypatch.setattr(dm, "CHUNK_BYTES", 10)
        monkeypatch.setattr(dm, "REPORT_EVERY_BYTES", 500)
        messages: list[str] = []
        dm.download(asset(tmp_path, size=len(CONTENT)), tmp_path / "m", log=messages.append)
        assert len(messages) == len(CONTENT) // 500


class TestCertificateFallback:
    def fake_open(self, monkeypatch, first_error: Exception):
        calls = []

        def urlopen(request, timeout=None, context=None):
            calls.append(context)
            if len(calls) == 1 and first_error is not None:
                raise first_error
            return "respuesta"

        monkeypatch.setattr(dm.urllib.request, "urlopen", urlopen)
        return calls

    def cert_error(self, message: str) -> urllib.error.URLError:
        return urllib.error.URLError(ssl.SSLCertVerificationError(1, message))

    def test_a_normal_connection_is_opened_once_with_full_checks(self, monkeypatch):
        calls = self.fake_open(monkeypatch, first_error=None)
        assert dm.open_url(dm.urllib.request.Request("https://x"), lambda _: None) == "respuesta"
        assert calls == [None]

    def test_the_antivirus_certificate_case_retries_without_the_strict_check_and_says_so(
        self, monkeypatch
    ):
        calls = self.fake_open(
            monkeypatch, self.cert_error("Basic Constraints of CA cert not marked critical")
        )
        messages: list[str] = []
        assert dm.open_url(dm.urllib.request.Request("https://x"), messages.append) == "respuesta"
        assert len(calls) == 2
        retry = calls[1]
        assert not retry.verify_flags & ssl.VERIFY_X509_STRICT
        # Everything else stays verified: the chain and the host name
        assert retry.verify_mode == ssl.CERT_REQUIRED
        assert retry.check_hostname is True
        assert any("antivirus" in message for message in messages)

    def test_any_other_certificate_problem_is_not_worked_around(self, monkeypatch):
        calls = self.fake_open(monkeypatch, self.cert_error("certificate has expired"))
        with pytest.raises(urllib.error.URLError):
            dm.open_url(dm.urllib.request.Request("https://x"), lambda _: None)
        assert len(calls) == 1

    def test_a_network_failure_is_not_retried(self, monkeypatch):
        calls = self.fake_open(monkeypatch, urllib.error.URLError(ConnectionRefusedError()))
        with pytest.raises(urllib.error.URLError):
            dm.open_url(dm.urllib.request.Request("https://x"), lambda _: None)
        assert len(calls) == 1


class TestRun:
    def settings(self, tmp_path: Path) -> Settings:
        return Settings(_env_file=None, models_dir=tmp_path / "modelos")

    def record_downloads(self, monkeypatch) -> list[str]:
        done: list[str] = []
        monkeypatch.setattr(dm, "download", lambda a, models, log: done.append(a.filename) or "0")
        return done

    def test_it_shows_every_file_with_its_origin_before_asking(self, tmp_path, monkeypatch):
        self.record_downloads(monkeypatch)
        lines: list[str] = []
        dm.run("sface", self.settings(tmp_path), ask=lambda _: "n", log=lines.append)
        text = "\n".join(lines)
        assert "face_recognition_sface_2021dec.onnx" in text
        assert "https://github.com/opencv/opencv_zoo" in text
        assert "36.9 MB" in text

    def test_answering_no_downloads_nothing(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        assert dm.run("all", self.settings(tmp_path), ask=lambda _: "n", log=lambda _: None) == 1
        assert done == []

    def test_an_empty_answer_counts_as_no(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        assert dm.run("all", self.settings(tmp_path), ask=lambda _: "", log=lambda _: None) == 1
        assert done == []

    def test_answering_yes_downloads_every_missing_file(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        assert dm.run("all", self.settings(tmp_path), ask=lambda _: "s", log=lambda _: None) == 0
        assert done == [
            "buffalo_l.zip",
            "face_recognition_sface_2021dec.onnx",
            "face_detection_yunet_2023mar.onnx",
        ]

    def test_assume_yes_does_not_ask(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)

        def refuse(_):
            raise AssertionError("no debía preguntar")

        assert dm.run("sface", self.settings(tmp_path), assume_yes=True, ask=refuse) == 0
        assert len(done) == 2

    def test_what_is_already_there_is_not_downloaded_again(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        settings = self.settings(tmp_path)
        (settings.models_dir / "sface").mkdir(parents=True)
        (settings.models_dir / "sface" / "face_recognition_sface_2021dec.onnx").write_bytes(b"x")
        dm.run("sface", settings, assume_yes=True, log=lambda _: None)
        assert done == ["face_detection_yunet_2023mar.onnx"]

    def test_with_nothing_missing_it_says_so_and_asks_nothing(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        settings = self.settings(tmp_path)
        (settings.models_dir / "sface").mkdir(parents=True)
        for name in ("face_recognition_sface_2021dec.onnx", "face_detection_yunet_2023mar.onnx"):
            (settings.models_dir / "sface" / name).write_bytes(b"x")
        lines: list[str] = []

        def refuse(_):
            raise AssertionError("no debía preguntar")

        assert dm.run("sface", settings, ask=refuse, log=lines.append) == 0
        assert "No hay nada que descargar." in lines
        assert done == []

    def test_force_downloads_again_what_is_already_there(self, tmp_path, monkeypatch):
        done = self.record_downloads(monkeypatch)
        settings = self.settings(tmp_path)
        (settings.models_dir / "sface").mkdir(parents=True)
        for name in ("face_recognition_sface_2021dec.onnx", "face_detection_yunet_2023mar.onnx"):
            (settings.models_dir / "sface" / name).write_bytes(b"x")
        dm.run("sface", settings, assume_yes=True, force=True, log=lambda _: None)
        assert len(done) == 2

    def test_a_failed_download_stops_with_exit_code_2_and_the_reason(self, tmp_path, monkeypatch):
        def fail(a, models, log):
            raise dm.DownloadError(f"{a.filename}: sin conexión")

        monkeypatch.setattr(dm, "download", fail)
        lines: list[str] = []
        code = dm.run("sface", self.settings(tmp_path), assume_yes=True, log=lines.append)
        assert code == 2
        assert any("sin conexión" in line for line in lines)

    def test_the_command_line_takes_the_engine_and_the_yes_flag(self, monkeypatch):
        received = {}

        def fake_run(engine, settings, assume_yes=False, force=False, **_):
            received.update(engine=engine, assume_yes=assume_yes, force=force)
            return 0

        monkeypatch.setattr(dm, "run", fake_run)
        assert dm.main(["--engine", "sface", "--yes", "--force"]) == 0
        assert received == {"engine": "sface", "assume_yes": True, "force": True}
        dm.main([])
        assert received == {"engine": "all", "assume_yes": False, "force": False}
