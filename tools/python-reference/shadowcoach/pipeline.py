from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory

from shadowcoach.analysis.features import extract_features
from shadowcoach.analysis.normalization import NormalizedFrame, normalize_frames
from shadowcoach.analysis.scoring import score_attempt
from shadowcoach.analysis.segmentation import Segmentation, segment
from shadowcoach.config import Config
from shadowcoach.domain.enums import KEY_JOINTS, Move, Phase, Stance, Status, expected_hand
from shadowcoach.domain.models import FrameLandmarks, Phases, PoseQuality, VideoInfo
from shadowcoach.domain.results import Report
from shadowcoach.errors import ShadowCoachError
from shadowcoach.feedback.selector import select_feedback
from shadowcoach.pose.quality import check_quality, issue
from shadowcoach.pose.smoothing import smooth_frames
from shadowcoach.validators import VALIDATORS


def analyze_landmarks(
    frames: list[FrameLandmarks],
    info: VideoInfo,
    move: Move,
    stance: Stance,
    cfg: Config,
    video_name: str = "landmarks",
) -> tuple[Report, list[NormalizedFrame], Segmentation]:
    if any(f.frame != i for i, f in enumerate(frames)) or any(
        a.timestamp_ms >= b.timestamp_ms for a, b in zip(frames, frames[1:], strict=False)
    ):
        raise ShadowCoachError(
            "Landmarks должны иметь последовательные кадры и возрастающие timestamps."
        )
    quality = check_quality(frames, cfg.pose)
    normalized = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    expected = expected_hand(move, stance)
    attempt = Segmentation(Phases(), [Phase.UNKNOWN] * len(frames))

    def unavailable(status: Status, quality: PoseQuality) -> Report:
        return Report(
            video=video_name,
            expected_move=move,
            stance=stance,
            status=status,
            pose_quality=quality.level,
            quality=quality,
            phases=attempt.phases,
            attempt_detected=attempt.detected,
            peak_method=attempt.peak_method,
            main_feedback=quality.issues[0].message,
            video_info=info,
            configuration=cfg.model_dump(mode="json"),
        )

    if not quality.reliable:
        return unavailable(Status.UNRELIABLE, quality), normalized, attempt
    normalized_coverage = sum(bool(f.image) for f in normalized) / len(normalized)
    if normalized_coverage < cfg.pose.min_keypoint_coverage:
        quality.level = "poor"
        quality.issues.append(issue("low_pose_quality", ("left_shoulder", "right_shoulder")))
        return unavailable(Status.UNRELIABLE, quality), normalized, attempt
    attempt = segment(normalized, expected, move, cfg)
    if not attempt.detected:
        reason = attempt.reason or "no_attempt_detected"
        quality.issues.append(issue(reason))
        ambiguous = reason in {"guard_not_found", "hook_peak_ambiguous"}
        quality.level = "poor" if ambiguous else "good"
        status = Status.UNRELIABLE if ambiguous else Status.NO_ATTEMPT
        return unavailable(status, quality), normalized, attempt
    p = attempt.phases
    assert (
        p.movement_start_frame is not None and p.peak_frame is not None and p.end_frame is not None
    )
    peak_ms = frames[p.peak_frame].timestamp_ms
    window = frames[p.movement_start_frame : p.end_frame + 1]
    local_quality = check_quality(window, cfg.pose, check_duration=False)
    # Do not bridge a long occlusion and mistake missing motion for bad technique.
    for joint in KEY_JOINTS:
        missing_since = None
        for f in normalized[p.movement_start_frame : p.end_frame + 1]:
            if joint not in f.image:
                if missing_since is None:
                    missing_since = f.raw.timestamp_ms
                if f.raw.timestamp_ms - missing_since >= cfg.pose.max_gap_ms:
                    local_quality.issues.append(issue("low_pose_quality", (joint,), f.raw.frame))
                    break
            else:
                missing_since = None
    peak_quality = check_quality(
        [f for f in window if abs(f.timestamp_ms - peak_ms) <= cfg.pose.peak_window_ms],
        cfg.pose,
        check_duration=False,
        min_coverage=cfg.pose.min_peak_coverage,
    )
    # Global coverage can hide occlusion of the few most important frames.
    normalized_peak = normalized[p.peak_frame]
    if not all(
        j in normalized_peak.image
        for j in (
            "nose",
            "left_shoulder",
            "right_shoulder",
            "left_elbow",
            "right_elbow",
            "left_wrist",
            "right_wrist",
        )
    ):
        peak_quality.issues.append(issue("low_pose_quality", frame=p.peak_frame))
    if f"{attempt.active_hand}_wrist" not in normalized[p.end_frame].image:
        local_quality.issues.append(issue("wrist_not_visible", frame=p.end_frame))
    if not local_quality.reliable or not peak_quality.reliable:
        quality.level = "poor"
        quality.issues.extend(local_quality.issues + peak_quality.issues)
        return unavailable(Status.UNRELIABLE, quality), normalized, attempt
    features = extract_features(normalized, attempt, expected, cfg)
    if features.elbow_angle_peak is None:
        quality.level = "poor"
        quality.issues.append(
            issue("low_pose_quality", (f"{attempt.active_hand}_elbow",), p.peak_frame)
        )
        return unavailable(Status.UNRELIABLE, quality), normalized, attempt
    violations = VALIDATORS[move]().validate(features, p, cfg.for_move(move))
    feedback, violations = select_feedback(violations, cfg.feedback)
    score, components, weights = score_attempt(features, move, cfg)
    warnings = ["Пороговая оценка прототипа: значения требуют настройки по размеченным видео."]
    if features.angle_coordinate_space == "image_2d":
        warnings.append("Углы оценены в 2D; ракурс камеры влияет на результат.")
    else:
        warnings.append(
            "World-углы — оценка модели по одной камере, не точное 3D-измерение. "
            "Замечания о разгибании нужно проверять с тренером."
        )
    if features.shoulder_rotation is None and move != Move.JAB:
        warnings.append(
            "Поворот плеч недоступен: проверка пропущена, веса доступных метрик пересчитаны."
        )
    if p.return_frame is None:
        warnings.append("Возврат не подтверждён. Убедитесь, что конец движения не обрезан.")
    report = Report(
        video=video_name,
        expected_move=move,
        stance=stance,
        status=Status.COMPLETED,
        pose_quality=quality.level,
        quality=quality,
        attempt_detected=True,
        peak_method=attempt.peak_method,
        score=score,
        main_feedback=feedback,
        violations=violations,
        metrics=features,
        phases=p,
        score_components=components,
        effective_weights=weights,
        video_info=info,
        warnings=warnings,
        configuration=cfg.model_dump(mode="json"),
    )
    return report, normalized, attempt


def run_analysis(
    video: Path,
    model: Path,
    output: Path,
    move: Move,
    stance: Stance,
    cfg: Config,
    *,
    mirror: bool = False,
    save_frames: bool = False,
    progress: Callable[[str], None] | None = None,
) -> Report:
    from shadowcoach.output.landmarks_writer import write_landmarks
    from shadowcoach.output.publish import publish_output
    from shadowcoach.output.renderer import render_video
    from shadowcoach.output.report import write_report
    from shadowcoach.pose.extractor import extract_video
    from shadowcoach.pose.landmarker import MediaPipeEstimator, check_model

    if not video.is_file():
        raise ShadowCoachError(f"Видео не найдено: {video}")
    check_model(model)
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ShadowCoachError(
            f"Папка результата не пуста: {output}. Укажите новую папку --output."
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    with MediaPipeEstimator(model, cfg.pose) as estimator:
        frames, info, warnings = extract_video(video, estimator, cfg, progress)
    report, normalized, attempt = analyze_landmarks(frames, info, move, stance, cfg, str(video))
    report.warnings.extend(warnings)
    with TemporaryDirectory(prefix=".shadowcoach-", dir=output.parent) as temp:
        staging = Path(temp) / "result"
        staging.mkdir()
        write_landmarks(staging / "landmarks.jsonl", normalized)
        if progress:
            progress("Создаётся размеченное видео…")
        report.warnings.extend(
            render_video(
                video,
                staging,
                normalized,
                attempt,
                report,
                cfg,
                mirror=mirror,
                save_frames=save_frames,
            )
        )
        write_report(staging, report)
        publish_output(staging, output)
    return report
