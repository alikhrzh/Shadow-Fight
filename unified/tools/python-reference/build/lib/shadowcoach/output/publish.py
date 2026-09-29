"""Publish completed artifacts without moving a temporary directory into place."""

import os
import shutil
from pathlib import Path

from shadowcoach.errors import ShadowCoachError


def publish_output(staging: Path, output: Path) -> None:
    """Copy exclusively into an empty destination, report last, and mark failures.

    An explicit copy avoids relying on a temporary-directory rename surviving
    filesystem synchronization. Consumers must ignore an .incomplete result.
    Never overwrite an existing file; keep partial files on failure for diagnosis.
    """
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ShadowCoachError(f"Папка результата не пуста: {output}")
    marker = output / ".incomplete"
    try:
        with marker.open("x", encoding="utf-8") as stream:
            stream.write("Экспорт ещё не завершён. Не используйте эту папку для оценки.\n")
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError as exc:
        raise ShadowCoachError(f"Папка уже занята другим экспортом: {output}") from exc
    try:
        files = sorted(
            (p for p in staging.rglob("*") if p.is_file()),
            key=lambda p: (p.name == "report.json", str(p)),
        )
        for source in files:
            target = output / source.relative_to(staging)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open("rb") as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
            if source.stat().st_size != target.stat().st_size:
                raise OSError(f"Размер сохранённого файла не совпадает: {target.name}")
        if not (output / "report.json").is_file():
            raise OSError("В результате отсутствует report.json")
        marker.unlink()
    except OSError as exc:
        raise ShadowCoachError(
            f"Экспорт не завершён: {output}. Частичные файлы сохранены с меткой .incomplete. "
            "Для повтора укажите новую папку."
        ) from exc
