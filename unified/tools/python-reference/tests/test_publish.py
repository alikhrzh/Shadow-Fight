import pytest

from shadowcoach.errors import ShadowCoachError
from shadowcoach.output.publish import publish_output


def prepared(tmp_path):
    staging = tmp_path / "staging"
    staging.mkdir()
    (staging / "annotated.mp4").write_bytes(b"test artifact")
    (staging / "report.json").write_text('{"status":"test"}')
    debug = staging / "debug"
    debug.mkdir()
    (debug / "frame.jpg").write_bytes(b"test frame")
    return staging


def test_publish_copies_without_renaming_and_survives_source_removal(tmp_path):
    staging = prepared(tmp_path)
    output = tmp_path / "result"
    publish_output(staging, output)
    assert staging.is_dir()
    (staging / "report.json").unlink()
    assert (output / "report.json").read_text() == '{"status":"test"}'
    assert (output / "debug/frame.jpg").read_bytes() == b"test frame"
    assert not (output / ".incomplete").exists()


def test_publish_never_overwrites_existing_result(tmp_path):
    staging = prepared(tmp_path)
    output = tmp_path / "result"
    output.mkdir()
    (output / "report.json").write_text("user-owned")
    with pytest.raises(ShadowCoachError, match="не пуста"):
        publish_output(staging, output)
    assert (output / "report.json").read_text() == "user-owned"


def test_partial_copy_is_not_a_finished_report(tmp_path, monkeypatch):
    staging = prepared(tmp_path)
    output = tmp_path / "result"

    def fail_copy(*_):
        raise OSError("simulated full disk")

    monkeypatch.setattr("shadowcoach.output.publish.shutil.copyfileobj", fail_copy)
    with pytest.raises(ShadowCoachError, match="Экспорт не завершён"):
        publish_output(staging, output)
    assert (output / ".incomplete").is_file()
    assert not (output / "report.json").exists()
    with pytest.raises(ShadowCoachError, match="не пуста"):
        publish_output(staging, output)
