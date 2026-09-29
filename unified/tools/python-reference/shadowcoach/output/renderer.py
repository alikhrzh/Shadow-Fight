from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from shadowcoach.analysis.geometry import angle_degrees
from shadowcoach.analysis.normalization import NormalizedFrame
from shadowcoach.analysis.segmentation import Segmentation
from shadowcoach.config import Config
from shadowcoach.domain.enums import LANDMARK_NAMES, POSE_CONNECTIONS, Phase, Status, expected_hand
from shadowcoach.domain.results import Report
from shadowcoach.errors import ShadowCoachError
from shadowcoach.pose.quality import visible

GREEN, YELLOW, RED, GRAY = (70, 210, 110), (40, 200, 240), (70, 70, 235), (150, 150, 150)


def load_font(path: str | None, size: int) -> ImageFont.FreeTypeFont:
    candidates = (
        [path]
        if path
        else [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "DejaVuSans.ttf",
        ]
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(str(candidate), size)
        except OSError:
            continue
    raise ShadowCoachError(
        "Не найден шрифт для русских подсказок. Укажите render.font_path в YAML (TTF)."
    )


def _wrap(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int
) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=font) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def render_video(
    video: Path,
    output: Path,
    frames: list[NormalizedFrame],
    attempt: Segmentation,
    report: Report,
    cfg: Config,
    *,
    mirror: bool = False,
    save_frames: bool = False,
) -> list[str]:
    assert report.video_info is not None
    info = report.video_info
    width = max(info.width, 640)
    width += width % 2
    image_height = round(info.height * width / info.width)
    image_height += image_height % 2
    font = load_font(cfg.render.font_path, max(16, min(26, width // 40)))
    line_height = font.size + 6
    measure = ImageDraw.Draw(Image.new("RGB", (width, 1)))
    feedback_lines = _wrap(measure, report.main_feedback, font, width - 32)
    panel_height = max(cfg.render.panel_height, (len(feedback_lines) + 4) * line_height + 24)
    panel_height += panel_height % 2
    size = (width, image_height + panel_height)
    writer = None
    selected_codec = None
    target = output / "annotated.mp4"
    for codec in cfg.render.codecs:
        candidate = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*codec), info.fps, size)
        if candidate.isOpened():
            writer, selected_codec = candidate, codec
            break
        candidate.release()
    if writer is None:
        raise ShadowCoachError("OpenCV не смог открыть ни один кодек MP4. Проверьте render.codecs.")
    warnings = []
    if selected_codec != "avc1":
        warnings.append(
            f"Видео сохранено кодеком {selected_codec}; H.264 недоступен или не выбран."
        )
    warnings.append(
        "Размеченное видео сохранено без звука. Зеркальность затрагивает только изображение."
    )
    cap = cv2.VideoCapture(str(video))
    hand = attempt.active_hand or expected_hand(report.expected_move, report.stance)
    if save_frames:
        (output / "debug").mkdir()
    written = 0
    try:
        for f, state in zip(frames, attempt.states, strict=True):
            ok, bgr = cap.read()
            if not ok:
                raise ShadowCoachError("Не удалось повторно прочитать видео для разметки.")
            canvas = cv2.resize(bgr, (width, image_height))
            base_color = (
                GRAY
                if report.status != Status.COMPLETED
                else (GREEN if state in (Phase.GUARD, Phase.COMPLETE) else YELLOW)
            )
            highlighted = set()
            for v in report.violations:
                if v.frame is not None and abs(
                    frames[v.frame].raw.timestamp_ms - f.raw.timestamp_ms
                ) <= (cfg.render.highlight_window_ms):
                    highlighted.update(v.related_joints)
            points = f.raw.landmarks
            for a, b in POSE_CONNECTIONS:
                na, nb = LANDMARK_NAMES[a], LANDMARK_NAMES[b]
                pa, pb = points.get(na), points.get(nb)
                if visible(pa, cfg.pose) and visible(pb, cfg.pose):
                    assert pa is not None and pb is not None
                    color = RED if na in highlighted or nb in highlighted else base_color
                    cv2.line(
                        canvas,
                        (round(pa.x * width), round(pa.y * image_height)),
                        (round(pb.x * width), round(pb.y * image_height)),
                        color,
                        2,
                        cv2.LINE_AA,
                    )
            for name, point in points.items():
                if 0 <= point.x <= 1 and 0 <= point.y <= 1:
                    color = (
                        RED
                        if name in highlighted
                        else base_color
                        if visible(point, cfg.pose)
                        else GRAY
                    )
                    cv2.circle(
                        canvas,
                        (round(point.x * width), round(point.y * image_height)),
                        6 if name in highlighted else 3,
                        color,
                        -1,
                        cv2.LINE_AA,
                    )
            if mirror:
                canvas = cv2.flip(canvas, 1)
            panel = np.full((panel_height, width, 3), (26, 22, 18), dtype=np.uint8)
            full = np.vstack((canvas, panel))
            image = Image.fromarray(cv2.cvtColor(full, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(image)
            angle_space = (
                f.world
                if report.metrics and (report.metrics.angle_coordinate_space == "world_3d")
                else f.image
            )
            arm = [f"{hand}_{j}" for j in ("shoulder", "elbow", "wrist")]
            values = [
                angle_space[j] if angle_space is f.world else angle_space[j][:2]
                for j in arm
                if j in angle_space
            ]
            angle = angle_degrees(*values) if len(values) == 3 else None
            angle_label = f"{angle:.0f}°" if angle is not None else "—"
            vis = min((points[j].visibility for j in arm if j in points), default=0)
            score = str(report.score) if report.score is not None else "—"
            lines = [
                f"ShadowCoach | {report.expected_move.value} | {report.stance.value}",
                f"Фаза: {state.value}   Кадр: {f.raw.frame}   Локоть: {angle_label}",
                f"Visibility: {vis:.2f}   Итог: {score}/100   {report.status.value}",
            ]
            y = image_height + 12
            for line in lines:
                draw.text((16, y), line, font=font, fill=(235, 239, 245))
                y += line_height
            for line in feedback_lines:
                draw.text((16, y), line, font=font, fill=(255, 213, 100))
                y += line_height
            if f.raw.frame == report.phases.peak_frame:
                draw.rounded_rectangle(
                    (12, 12, 175, 12 + line_height + 12), radius=8, fill=(245, 190, 35)
                )
                draw.text((24, 18), "ПИК УДАРА", font=font, fill=(15, 20, 25))
            rendered = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
            writer.write(rendered)
            written += 1
            if save_frames and (
                f.raw.frame % cfg.render.debug_stride == 0
                or f.raw.frame == report.phases.peak_frame
            ):
                if not cv2.imwrite(
                    str(output / "debug" / f"frame_{f.raw.frame:06d}.jpg"), rendered
                ):
                    raise ShadowCoachError("Не удалось сохранить отладочный кадр.")
    finally:
        cap.release()
        writer.release()
    probe = cv2.VideoCapture(str(target))
    try:
        ok, _ = probe.read()
        count = round(probe.get(cv2.CAP_PROP_FRAME_COUNT))
        if not ok or count != written:
            raise ShadowCoachError(
                "Проверка записанного MP4 не пройдена. Попробуйте render.codecs: [mp4v]."
            )
    finally:
        probe.release()
    return warnings
