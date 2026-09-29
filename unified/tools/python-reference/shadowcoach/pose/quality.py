from collections.abc import Sequence

from shadowcoach.config import PoseConfig
from shadowcoach.domain.enums import KEY_JOINTS
from shadowcoach.domain.models import FrameLandmarks, Landmark, PoseQuality, QualityIssue

MESSAGES = {
    "person_not_detected": "Человек не найден. Проверьте свет и расположение камеры.",
    "multiple_people": "В кадре несколько людей. Запишите попытку с одним человеком.",
    "wrist_not_visible": "Кисть плохо видна. Измените ракурс и освещение.",
    "body_out_of_frame": "Нужные суставы выходят за границы кадра. Отойдите от камеры.",
    "video_too_short": "Видео слишком короткое. Запишите защиту, удар и возврат руки.",
    "low_pose_quality": "Недостаточно надёжных точек тела для оценки техники.",
    "no_attempt_detected": "Удар не обнаружен. Начните с неподвижной защиты и выполните один удар.",
    "guard_not_found": "Не найдена исходная защита. Стойте неподвижно 0,5–1 секунду в начале.",
    "hook_peak_ambiguous": "Не удалось надёжно отделить ударную фазу бокового от замаха. "
    "Проверьте ракурс и сохраните движение целиком.",
    "multiple_attempts": "Найдено несколько движений. Оставьте в видео только один удар.",
}


def issue(code: str, joints: Sequence[str] = (), frame: int | None = None) -> QualityIssue:
    return QualityIssue(code=code, message=MESSAGES[code], frame=frame, related_joints=list(joints))


def visible(point: Landmark | None, cfg: PoseConfig, *, image: bool = True) -> bool:
    return (
        point is not None
        and point.visibility >= cfg.min_visibility
        and (point.presence >= cfg.min_presence)
        and (not image or (0 <= point.x <= 1 and 0 <= point.y <= 1))
    )


def check_quality(
    frames: Sequence[FrameLandmarks],
    cfg: PoseConfig,
    *,
    check_duration: bool = True,
    min_coverage: float | None = None,
) -> PoseQuality:
    if not frames:
        return PoseQuality(level="poor", issues=[issue("person_not_detected")])
    coverage = {
        name: sum(f.pose_count == 1 and visible(f.landmarks.get(name), cfg) for f in frames)
        / len(frames)
        for name in KEY_JOINTS
    }
    issues: list[QualityIssue] = []
    duration = frames[-1].timestamp_ms - frames[0].timestamp_ms
    if check_duration and (
        len(frames) < cfg.min_video_frames or duration < cfg.min_video_duration_ms
    ):
        issues.append(issue("video_too_short"))
    if not any(f.pose_count > 0 for f in frames):
        issues.append(issue("person_not_detected"))
    multi = [f for f in frames if f.pose_count > 1]
    if len(multi) >= cfg.multiple_people_frames:
        issues.append(issue("multiple_people", frame=multi[0].frame))
    threshold = min_coverage if min_coverage is not None else cfg.min_keypoint_coverage
    missing = [name for name, fraction in coverage.items() if fraction < threshold]
    if missing and not any(i.code in {"person_not_detected", "multiple_people"} for i in issues):
        cropped = [
            name
            for name in missing
            if sum(
                name in f.landmarks
                and not (0 <= f.landmarks[name].x <= 1 and 0 <= f.landmarks[name].y <= 1)
                for f in frames
            )
            / len(frames)
            > 1 - threshold
        ]
        if cropped:
            issues.append(issue("body_out_of_frame", cropped))
        wrists = [name for name in missing if name.endswith("wrist") and name not in cropped]
        if wrists:
            issues.append(issue("wrist_not_visible", wrists))
        remaining = [name for name in missing if name not in cropped and name not in wrists]
        if remaining:
            issues.append(issue("low_pose_quality", remaining))
    return PoseQuality(
        level="poor" if issues else "good", keypoint_coverage=coverage, issues=issues
    )
