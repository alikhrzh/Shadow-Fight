import json
from pathlib import Path

from shadowcoach.analysis.normalization import NormalizedFrame


def write_landmarks(path: Path, frames: list[NormalizedFrame]) -> None:
    with path.open("x", encoding="utf-8") as stream:
        for f in frames:
            row = f.raw.model_dump(mode="json")
            row["coordinate_spaces"] = {
                "landmarks": "mediapipe_image_normalized_raw",
                "world_landmarks": "mediapipe_world_metres_raw",
                "normalized_image": "shoulder_widths_aspect_corrected_xyz",
                "normalized_world": "shoulder_widths_world_xyz",
            }
            for key, points in (
                ("normalized_image", f.image),
                ("normalized_world", f.world),
                ("smoothed_image", f.smooth_image),
                ("smoothed_world", f.smooth_world),
            ):
                row[key] = {name: values.tolist() for name, values in points.items()}
            row["image_shoulder_scale"] = f.image_scale
            row["world_shoulder_scale"] = f.world_scale
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
