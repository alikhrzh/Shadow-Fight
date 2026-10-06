import argparse
import sys
from pathlib import Path

from shadowcoach import __version__
from shadowcoach.domain.enums import Move, Stance, Status
from shadowcoach.errors import ShadowCoachError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="shadowcoach", description="Офлайн-анализ боксерского удара"
    )
    parser.add_argument("--version", action="version", version=f"ShadowCoach {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="Проверить одну попытку на видео")
    analyze.add_argument(
        "--video", type=Path, required=True, help="MP4, MOV или AVI с одним ударом"
    )
    analyze.add_argument("--move", type=Move, choices=list(Move), required=True)
    analyze.add_argument("--stance", type=Stance, choices=list(Stance), required=True)
    analyze.add_argument(
        "--model", type=Path, help="Локальная .task модель; по умолчанию model.path из YAML"
    )
    analyze.add_argument(
        "--output", type=Path, required=True, help="Новая или пустая папка результата"
    )
    analyze.add_argument("--config", type=Path, help="YAML с переопределениями порогов")
    analyze.add_argument(
        "--mirror", action="store_true", help="Зеркалить только итоговое изображение"
    )
    analyze.add_argument(
        "--save-frames", action="store_true", help="Сохранить отладочные JPG в debug/"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        from shadowcoach.config import load_config
        from shadowcoach.pipeline import run_analysis

        cfg = load_config(args.config)
        report = run_analysis(
            args.video,
            args.model or Path(cfg.model.path),
            args.output,
            args.move,
            args.stance,
            cfg,
            mirror=args.mirror,
            save_frames=args.save_frames,
            progress=lambda text: print(text, file=sys.stderr),
        )
        print(report.main_feedback)
        print(
            f"Оценка: {report.score}/100" if report.score is not None else "Оценка не выставлена."
        )
        print(f"Результаты: {args.output.resolve()}")
        return 0 if report.status == Status.COMPLETED else 3
    except (ShadowCoachError, OSError, ValueError, RuntimeError, ImportError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Анализ прерван пользователем.", file=sys.stderr)
        return 130
