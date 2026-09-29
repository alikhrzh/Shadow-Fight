import { useEffect, useState } from "react";
export function Countdown({
  attemptId,
  onDone,
  audio,
  onCancel,
}: {
  attemptId: string;
  onDone: (id: string) => void;
  audio: AudioContext | null;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(3);
  useEffect(() => {
    const start = performance.now();
    let last = 0;
    const tick = () => {
      const next = Math.max(
        0,
        3 - Math.floor((performance.now() - start) / 1000),
      );
      setCount(next);
      if (next && last !== next && audio?.state === "running") {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        oscillator.connect(gain);
        gain.connect(audio.destination);
        gain.gain.value = 0.04;
        oscillator.frequency.value = 660;
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.09);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }
      last = next;
      if (!next) {
        clearInterval(timer);
        onDone(attemptId);
      }
    };
    const timer = window.setInterval(tick, 100);
    tick();
    return () => clearInterval(timer);
  }, [attemptId, onDone, audio]);
  return (
    <div className="countdown" role="status" aria-live="assertive">
      <strong>{count || 1}</strong>
      <p>Опустите руки в защиту</p>
      <small>Приготовьтесь выполнить один удар</small>
      <button className="secondary-button" onClick={onCancel}>
        Отменить отсчёт
      </button>
    </div>
  );
}
