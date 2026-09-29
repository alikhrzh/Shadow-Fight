export interface HoldState {
  last: number | null;
  missingSince: number | null;
  held: number;
  latched: boolean;
  cooldownUntil: number;
}
export const emptyHold = (): HoldState => ({
  last: null,
  missingSince: null,
  held: 0,
  latched: false,
  cooldownUntil: 0,
});
/** Pure temporal filter: gaps never count as held time; release is required to re-arm. */
export function gestureHold(
  state: HoldState,
  present: boolean,
  now: number,
  duration: number,
) {
  if (!Number.isFinite(now) || (state.last !== null && now <= state.last))
    return {
      state,
      progress: Math.min(1, state.held / duration),
      fired: false,
    };
  let s = { ...state };
  const dt = s.last === null ? 0 : now - s.last;
  if (dt > 180)
    s = { ...emptyHold(), cooldownUntil: s.cooldownUntil, latched: s.latched };
  s.last = now;
  if (!present) {
    s.missingSince ??= now;
    if (now - s.missingSince > 160) {
      s.held = 0;
      s.latched = false;
    }
  } else {
    if (s.missingSince !== null && now - s.missingSince > 160) {
      s.held = 0;
      s.latched = false;
    }
    if (s.missingSince === null && !s.latched && now >= s.cooldownUntil)
      s.held += dt > 180 ? 0 : dt;
    s.missingSince = null;
  }
  const fired =
    present && !s.latched && s.held >= duration && now >= s.cooldownUntil;
  if (fired) {
    s.latched = true;
    s.cooldownUntil = now + 1800;
  }
  return { state: s, progress: Math.min(1, s.held / duration), fired };
}
