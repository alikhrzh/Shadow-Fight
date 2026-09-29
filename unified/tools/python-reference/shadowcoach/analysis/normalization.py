from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from shadowcoach.config import Config
from shadowcoach.domain.models import FrameLandmarks, VideoInfo
from shadowcoach.pose.quality import visible

Coordinates = dict[str, NDArray[np.float64]]


@dataclass
class NormalizedFrame:
    raw: FrameLandmarks
    image: Coordinates = field(default_factory=dict)
    world: Coordinates = field(default_factory=dict)
    smooth_image: Coordinates = field(default_factory=dict)
    smooth_world: Coordinates = field(default_factory=dict)
    image_scale: float | None = None
    world_scale: float | None = None


def normalize_frames(
    frames: list[FrameLandmarks],
    info: VideoInfo,
    cfg: Config,
) -> list[NormalizedFrame]:
    """Keep image and world spaces separate; never use normalized x/y as square pixels.

    Image coordinates use frame-width units (y *= height/width), then a fixed
    median baseline shoulder scale. Center follows shoulders to remove translation.
    Fixed scales avoid amplifying motion as the projected shoulders turn narrower.
    """
    if not frames:
        return []
    aspect = info.height / info.width
    raw_spaces: list[tuple[Coordinates, Coordinates]] = []
    image_widths: list[float] = []
    world_widths: list[float] = []
    for f in frames:
        img = {
            name: np.array([p.x, p.y * aspect, p.z], dtype=float)
            for name, p in f.landmarks.items()
            if f.pose_count == 1 and visible(p, cfg.pose)
        }
        world = {
            name: np.array([p.x, p.y, p.z], dtype=float)
            for name, p in f.world_landmarks.items()
            if name in img and visible(p, cfg.pose, image=False)
        }
        raw_spaces.append((img, world))
        if f.timestamp_ms - frames[0].timestamp_ms <= cfg.segmentation.calibration_ms:
            if all(n in img for n in ("left_shoulder", "right_shoulder")):
                image_widths.append(
                    float(np.linalg.norm(img["left_shoulder"][:2] - img["right_shoulder"][:2]))
                )
            if all(n in world for n in ("left_shoulder", "right_shoulder")):
                world_widths.append(
                    float(np.linalg.norm(world["left_shoulder"] - world["right_shoulder"]))
                )
    image_scale = float(np.median(image_widths)) if image_widths else 0
    world_scale = float(np.median(world_widths)) if world_widths else 0
    result = []
    for raw, (img, world) in zip(frames, raw_spaces, strict=True):
        frame = NormalizedFrame(raw=raw)
        for points, scale, attr in ((img, image_scale, "image"), (world, world_scale, "world")):
            if scale < cfg.pose.min_shoulder_width or not all(
                n in points for n in ("left_shoulder", "right_shoulder")
            ):
                continue
            left, right = points["left_shoulder"], points["right_shoulder"]
            current_scale = float(
                np.linalg.norm((left - right)[:2] if attr == "image" else left - right)
            )
            ratio = current_scale / scale
            if (
                not 1 / cfg.pose.max_shoulder_scale_ratio
                <= ratio
                <= cfg.pose.max_shoulder_scale_ratio
            ):
                continue
            center = (left + right) / 2
            setattr(frame, attr, {name: (p - center) / scale for name, p in points.items()})
            setattr(frame, f"{attr}_scale", scale)
        result.append(frame)
    return result
