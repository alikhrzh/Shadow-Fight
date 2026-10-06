import json
from pathlib import Path

from shadowcoach.domain.results import Report


def write_report(output: Path, report: Report) -> None:
    (output / "report.json").write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    metrics = {
        "status": report.status.value,
        "features": report.metrics.model_dump(mode="json") if report.metrics else None,
        "score_components": report.score_components,
        "effective_weights": report.effective_weights,
        "units": {
            "distances": "baseline shoulder widths",
            "speed": "shoulder widths / second",
            "angles": "degrees",
            "time": "milliseconds",
            "frames": "zero-based",
        },
    }
    (output / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8"
    )
    score = f"{report.score}/100" if report.score is not None else "нет оценки"
    lines = [
        f"ShadowCoach — {report.expected_move.value} / {report.stance.value}",
        f"Статус: {report.status.value}",
        f"Оценка: {score}",
        report.main_feedback,
        "",
    ]
    lines.extend(f"• {v.message}" for v in report.violations)
    lines.extend(f"Примечание: {w}" for w in report.warnings)
    (output / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
