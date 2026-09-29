import type { Frame } from "../../../../packages/coach-core/src/types";
import { visible } from "../../../../packages/coach-core/src/normalize";
export function cameraQuality(frame: Frame, fps: number, dark: boolean) {
  const p = frame.landmarks;
  if (dark) return "Освещение слишком слабое. Добавьте свет перед собой.";
  if (frame.pose_count > 1) return "В кадре должен находиться один человек.";
  if (!frame.pose_count) return "Встаньте в кадр: человек не найден.";
  if (fps > 0 && fps < 10)
    return "Обработка кадров слишком медленная. Закройте другие приложения.";
  if (
    !visible(p.left_shoulder) ||
    !visible(p.right_shoulder) ||
    !visible(p.left_elbow) ||
    !visible(p.right_elbow)
  )
    return "Плечи и локти должны быть видны.";
  const shoulderWidth = Math.abs(p.left_shoulder.x - p.right_shoulder.x);
  if (
    shoulderWidth > 0.48 ||
    Object.values(p).some(
      (j) => (j.visibility ?? 0) > 0.5 && (j.x < 0 || j.x > 1),
    )
  )
    return "Отойдите немного назад.";
  if (shoulderWidth < 0.12)
    return "Подойдите немного ближе и немного повернитесь к камере.";
  if (!visible(p.left_wrist) || !visible(p.right_wrist))
    return "Покажите обе кисти.";
  if (!visible(p.nose))
    return "Голова должна быть видна. Отойдите немного назад.";
  return null;
}
