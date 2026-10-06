import math

import pytest

from shadowcoach.config import load_config
from shadowcoach.domain.enums import Hand, Move, Stance, expected_hand
from shadowcoach.domain.models import FrameLandmarks, Landmark, VideoInfo


@pytest.fixture
def cfg():
    return load_config()


def recording(
    move=Move.JAB,
    stance=Stance.ORTHODOX,
    fps=30,
    *,
    wrong_hand=False,
    dropped=False,
    no_return=False,
    no_motion=False,
    extension=1.0,
    rotate=True,
    world=True,
):
    hand = expected_hand(move, stance)
    if wrong_hand:
        hand = hand.other
    frames = []
    for i in range(round(2.8 * fps)):
        t = i / fps
        q = (
            0
            if t < 0.8
            else min(1, (t - 0.8) / 0.35)
            if t < 1.25
            else (1 if no_return else max(0, 1 - (t - 1.25) / 0.35))
        )
        if no_motion:
            q = 0
        points = {
            "nose": [0.5, 0.22, 0],
            "left_shoulder": [0.4, 0.4, 0.035 * q if rotate else 0],
            "right_shoulder": [0.6, 0.4, -0.035 * q if rotate else 0],
            "left_elbow": [0.38, 0.55, 0],
            "right_elbow": [0.62, 0.55, 0],
            "left_wrist": [0.46, 0.26, 0],
            "right_wrist": [0.54, 0.26, 0],
            "left_hip": [0.44, 0.78, 0],
            "right_hip": [0.56, 0.78, 0],
        }
        sign = 1 if hand == Hand.LEFT else -1
        x0 = points[f"{hand}_wrist"][0]
        if move == Move.HOOK:
            # Curved image path and right-angle elbow at peak.
            points[f"{hand}_wrist"] = [x0 + sign * 0.27 * q, 0.26 - 0.16 * math.sin(math.pi * q), 0]
            points[f"{hand}_elbow"] = [
                (0.38 if sign == 1 else 0.62) + sign * 0.35 * q,
                0.55 - 0.15 * q,
                0,
            ]
        else:
            points[f"{hand}_wrist"] = [x0 + sign * 0.40 * q * extension, 0.26 + 0.08 * q, 0]
            points[f"{hand}_elbow"] = [
                (0.38 if sign == 1 else 0.62) + sign * 0.29 * q,
                0.55 - 0.18 * q * extension,
                0,
            ]
        if dropped:
            points[f"{hand.other}_wrist"][1] += 0.32 * q
        lm = {
            name: Landmark(x=x, y=y, z=z, visibility=0.99, presence=0.99)
            for name, (x, y, z) in points.items()
        }
        world_lm = (
            {
                name: Landmark(
                    x=(x - 0.5) * 2, y=(y - 0.4) * 1.5, z=z * 2, visibility=0.99, presence=0.99
                )
                for name, (x, y, z) in points.items()
            }
            if world
            else {}
        )
        frames.append(
            FrameLandmarks(
                frame=i,
                timestamp_ms=round(t * 1000),
                pose_count=1,
                landmarks=lm,
                world_landmarks=world_lm,
            )
        )
    info = VideoInfo(width=640, height=480, fps=fps, frame_count=len(frames), duration_ms=2800)
    return frames, info
