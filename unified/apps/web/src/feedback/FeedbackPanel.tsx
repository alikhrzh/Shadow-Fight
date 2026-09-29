import type { Training } from "../training/trainingMachine";
const names: Record<string, string> = {
  completion: "Амплитуда",
  return: "Возврат",
  extension: "Разгибание",
  elbow_form: "Форма локтя",
  guard: "Защита",
  trajectory: "Траектория",
  rotation: "Поворот плеч",
  elbow_height: "Высота локтя",
};
export function FeedbackPanel({ training: t }: { training: Training }) {
  const r = t.report;
  if (!r) return null;
  return (
    <section
      className="feedback panel has-result"
      aria-live="polite"
      data-testid="result"
    >
      <div className="section-title">
        <h2>Локальный результат</h2>
        <span className="score-pill">
          {r.score === null ? "Без балла" : `${r.score}/100`}
        </span>
      </div>
      <p className="reliability">
        {r.status === "completed"
          ? "Достаточно данных для локальной оценки"
          : r.status === "no_attempt"
            ? "Движение не обнаружено"
            : "Ненадёжная попытка — оценка не выдана"}
      </p>
      <h3>{r.main_feedback}</h3>
      {r.quality.issues.map((i, index) => (
        <p key={`${i.code}-${index}`}>{i.message}</p>
      ))}
      <dl className="score-components">
        {Object.entries(r.score_components).map(([key, value]) => (
          <div key={key}>
            <dt>{names[key] ?? key}</dt>
            <dd>{Math.round(value * 100)}%</dd>
            <meter
              min={0}
              max={1}
              value={value}
              aria-label={names[key] ?? key}
            />
          </div>
        ))}
      </dl>
      {r.violations.length > 0 && (
        <details open>
          <summary>Найденные замечания ({r.violations.length})</summary>
          <ul>
            {r.violations.map((v) => (
              <li key={v.code}>{v.message}</li>
            ))}
          </ul>
        </details>
      )}
      <small>
        Оранжевым на скелете отмечены суставы из замечаний к завершённой
        попытке, а не ошибка текущей позы.
      </small>
      {t.ai === "loading" && (
        <p className="ai-status" role="status">
          AI-тренер готовит объяснение…
        </p>
      )}
      {t.ai === "fallback" && (
        <p className="ai-status">
          AI-разбор сейчас недоступен. Показываем локальный анализ техники.
        </p>
      )}
      {t.ai === "skipped" && (
        <p>
          Для AI-разбора недостаточно надёжных данных. Повторите попытку с
          учётом подсказки.
        </p>
      )}
      {t.feedback && (
        <div className="ai-feedback">
          <div className="eyebrow">ОБЪЯСНЕНИЕ · NVIDIA AI</div>
          <h3>{t.feedback.headline}</h3>
          {(
            [
              ["Что получилось", t.feedback.positive],
              [
                "Главная ошибка",
                t.feedback.mainIssue ??
                  "Существенных ошибок по измеримым признакам не найдено.",
              ],
              ["Как исправить", t.feedback.correction],
              ["Упражнение", t.feedback.drill],
              ["Цель следующей попытки", t.feedback.nextGoal],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <h4>{label}</h4>
              <p>{value}</p>
            </div>
          ))}
          <p>{t.feedback.motivation}</p>
        </div>
      )}
      <small>
        Одна камера оценивает ограниченный набор визуальных признаков. Балл —
        оценка правил прототипа, не процент правильности техники.
      </small>
    </section>
  );
}
