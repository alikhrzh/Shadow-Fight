import type { Stance } from "../../../../packages/coach-core/src/types";
import { handLabel, type LessonConfig } from "./lessonConfig";
export function LessonScreen({
  lesson,
  stance,
  onPractice,
  onBack,
}: {
  lesson: LessonConfig;
  stance: Stance;
  onPractice: () => void;
  onBack: () => void;
}) {
  return (
    <section className="lesson-layout">
      <div className="lesson-video panel">
        <div className="eyebrow">ВИДЕОУРОК · {lesson.author}</div>
        <h2>{lesson.title}</h2>
        <iframe
          loading="lazy"
          title={`${lesson.title}: ${lesson.videoTitle}`}
          src={`https://www.youtube-nocookie.com/embed/${lesson.youtubeId}?rel=0`}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        <p>
          Видео на английском. Ключевые пункты урока — на русском рядом. Если
          плеер недоступен, используйте текстовый урок.
        </p>
        <a
          className="text-button"
          href={lesson.youtubeUrl}
          target="_blank"
          rel="noreferrer"
        >
          Открыть на YouTube ↗
        </a>
      </div>
      <div className="lesson-notes panel">
        <div className="eyebrow">СНАЧАЛА ПОЙМИ. ЗАТЕМ ПОВТОРИ.</div>
        <h2>{handLabel(lesson.move, stance)}</h2>
        <p>{lesson.description}</p>
        <ol className="key-points">
          {lesson.keyPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <p className="safety-note">{lesson.safetyNote}</p>
        <p>
          Встаньте в боксерскую стойку:{" "}
          {stance === "orthodox" ? "левая" : "правая"} нога впереди. После
          команды «БЕЙ!» выполните только выбранный удар.
        </p>
        <div className="lesson-actions">
          <button className="primary-button" onClick={onPractice}>
            Перейти к практике →
          </button>
          <button className="secondary-button" onClick={onBack}>
            Назад к урокам
          </button>
        </div>
        <small>
          Камера включится после перехода к практике. Видеоурок загружается с
          YouTube.
        </small>
      </div>
    </section>
  );
}
