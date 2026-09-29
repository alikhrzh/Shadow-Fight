import { useCallback, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  Download,
  Focus,
  Pause,
  Play,
  ShieldCheck,
  Target,
} from "lucide-react";
import { LiveCamera, type CameraStats } from "./components/LiveCamera";
import type {
  Move,
  Report,
  Stance,
} from "../../../packages/coach-core/src/types";
const emptyStats: CameraStats = {
  fps: 0,
  latency: 0,
  visible: 0,
  message: "Камера выключена",
  phase: "idle",
  delegate: "",
};
const phaseNames: Record<string, string> = {
  idle: "Ожидание",
  calibrating: "Калибровка",
  ready: "Готов к удару",
  punch: "Движение",
  return: "Возврат",
  recovering: "Подготовка",
  error: "Проверьте камеру",
};
export function App() {
  const [active, setActive] = useState(false),
    [move, setMove] = useState<Move>("jab"),
    [stance, setStance] = useState<Stance>("orthodox"),
    [facing, setFacing] = useState<"user" | "environment">("user");
  const [stats, setStats] = useState(emptyStats),
    [results, setResults] = useState<Report[]>([]),
    [total, setTotal] = useState(0),
    [completed, setCompleted] = useState(0),
    [sum, setSum] = useState(0),
    [issues, setIssues] = useState<Record<string, number>>({}),
    [finished, setFinished] = useState(false);
  const stop = useCallback(() => {
    setActive(false);
    setStats(emptyStats);
  }, []);
  const onResult = useCallback((r: Report) => {
    setResults((old) => [...old.slice(-49), r]);
    setTotal((n) => n + 1);
    if (r.status === "completed") {
      setCompleted((n) => n + 1);
      setSum((n) => n + r.score!);
      setIssues((old) => {
        const next = { ...old };
        r.violations.forEach(
          (v) => (next[v.message] = (next[v.message] ?? 0) + 1),
        );
        return next;
      });
    }
  }, []);
  const last = results.at(-1),
    average = completed ? Math.round(sum / completed) : null;
  function start() {
    setFinished(false);
    setStats({ ...emptyStats, message: "Подключаем камеру…" });
    setActive(true);
  }
  function finish() {
    stop();
    setFinished(true);
  }
  function reset() {
    stop();
    setResults([]);
    setTotal(0);
    setCompleted(0);
    setSum(0);
    setIssues({});
    setFinished(false);
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: "0.2.0",
            model: "pose_landmarker_full",
            createdAt: new Date().toISOString(),
            total,
            completed,
            unreliable: total - completed,
            average,
            issues,
            last50Attempts: results,
            warning:
              "Оценки прототипа, не подтверждённые тренером. Видео и координаты не сохранены.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "shadowcoach-session.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./" aria-label="ShadowCoach — главная">
          <span className="brand-icon">
            <Activity size={23} />
          </span>
          SHADOW<span>COACH</span>
          <small>BETA</small>
        </a>
        <div className="header-note">
          <ShieldCheck size={16} /> Видео остаётся на устройстве
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> ТВОЯ ТЕХНИКА. В РЕАЛЬНОМ ВРЕМЕНИ.
            </div>
            <h1>
              Каждый удар.
              <br />
              <span>Чуть точнее.</span>
            </h1>
          </div>
          <p>
            Камера видит движение. Ты видишь, что улучшить.
            <br />
            Джеб и передний боковой — с разбором после каждого удара.
          </p>
        </section>
        <div className={`workspace ${active ? "is-active" : ""}`}>
          <section className="camera-column">
            <div className="camera-heading">
              <span>
                <span className={active ? "live-dot" : "idle-dot"} />
                {active ? "LIVE-ТРЕНИРОВКА" : "ТВОЯ ТРЕНИРОВКА"}
              </span>
              <span>01 / ТЕХНИКА</span>
            </div>
            {active ? (
              <LiveCamera
                move={move}
                stance={stance}
                facing={facing}
                onResult={onResult}
                onStats={setStats}
                onStop={stop}
              />
            ) : (
              <div className="camera-placeholder">
                <div className="viewfinder">
                  <span />
                  <span />
                  <span />
                  <span />
                  <svg viewBox="0 0 240 220" aria-hidden="true">
                    <circle cx="120" cy="43" r="22" />
                    <path d="M83 91L157 91M83 91L60 135L90 83M157 91L180 135L150 83M83 91L95 171L145 171L157 91M95 171L81 214M145 171L159 214" />
                    {[
                      [83, 91],
                      [157, 91],
                      [60, 135],
                      [180, 135],
                      [90, 83],
                      [150, 83],
                      [95, 171],
                      [145, 171],
                    ].map(([x, y], i) => (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="4"
                        className="pose-dot"
                      />
                    ))}
                  </svg>
                </div>
                <div className="placeholder-copy">
                  <h2>{finished ? "Тренировка завершена" : "Встань в кадр"}</h2>
                  <p>
                    Голова, плечи, локти и обе кисти должны быть видны.
                    <br />
                    Камера включится только после нажатия кнопки.
                  </p>
                  <span className="illustration-label">
                    Схема размещения · не результат распознавания
                  </span>
                </div>
              </div>
            )}
            <div className="camera-footer">
              <span>
                <Focus size={15} />
                {phaseNames[stats.phase] ?? "Подготовка"}
              </span>
              <span>
                {stats.fps
                  ? `${stats.fps} FPS · ${stats.latency} мс`
                  : "FULL MODEL · ON DEVICE"}
              </span>
            </div>
            <div className="controls">
              {!active ? (
                <button className="primary-button" onClick={start}>
                  <Play size={17} fill="currentColor" />
                  {total ? "Продолжить" : "Начать тренировку"}
                  <ArrowUpRight size={19} />
                </button>
              ) : (
                <>
                  <button className="secondary-button" onClick={stop}>
                    <Pause size={17} />
                    Пауза
                  </button>
                  <button className="primary-button" onClick={finish}>
                    <Check size={17} />
                    Завершить
                  </button>
                </>
              )}
              <span>Без записи видео. Без микрофона.</span>
            </div>
            <div className="how-to">
              <span>КАК НАЧАТЬ</span>
              <p>
                <b>1</b> Поставь камеру устойчиво
              </p>
              <p>
                <b>2</b> Замри в защите на секунду
              </p>
              <p>
                <b>3</b> Ударь и верни руку
              </p>
            </div>
          </section>
          <aside>
            <section className="settings panel">
              <div className="section-title">
                <Target size={16} />
                <h2>Настрой тренировку</h2>
              </div>
              <label>УПРАЖНЕНИЕ</label>
              <div className="move-buttons">
                <button
                  disabled={active}
                  className={move === "jab" ? "selected" : ""}
                  onClick={() => setMove("jab")}
                >
                  <span>01</span>Джеб
                  <ChevronRight size={16} />
                </button>
                <button
                  disabled={active}
                  className={move === "hook" ? "selected" : ""}
                  onClick={() => setMove("hook")}
                >
                  <span>02</span>Боковой
                  <ChevronRight size={16} />
                </button>
              </div>
              <label htmlFor="stance">СТОЙКА</label>
              <select
                id="stance"
                disabled={active}
                value={stance}
                onChange={(e) => setStance(e.target.value as Stance)}
              >
                <option value="orthodox">Левая нога впереди</option>
                <option value="southpaw">Правая нога впереди</option>
              </select>
              <label htmlFor="camera">КАМЕРА</label>
              <select
                id="camera"
                disabled={active}
                value={facing}
                onChange={(e) => setFacing(e.target.value as typeof facing)}
              >
                <option value="user">Передняя / веб-камера</option>
                <option value="environment">Задняя камера</option>
              </select>
              <p className="setting-hint">
                Удар передней рукой. Выполняй отдельные удары с паузой в защите,
                не комбинации.
              </p>
            </section>
            <section className="session-stats">
              <div>
                <span>ОЦЕНЕНО</span>
                <strong>{completed.toString().padStart(2, "0")}</strong>
              </div>
              <div>
                <span>СРЕДНИЙ БАЛЛ</span>
                <strong>
                  {average ?? "—"}
                  <small>{average !== null ? "/100" : ""}</small>
                </strong>
              </div>
              <div>
                <span>БЕЗ ОЦЕНКИ</span>
                <strong>{total - completed}</strong>
              </div>
            </section>
            <section
              className={`feedback panel ${last?.status === "completed" ? "has-result" : ""}`}
              aria-live="polite"
            >
              <div className="section-title">
                <ShieldCheck size={17} />
                <h2>{last ? "Последняя попытка" : "Подсказка тренера"}</h2>
                {last?.score !== null && last?.score !== undefined && (
                  <span className="score-pill">{last.score}/100</span>
                )}
              </div>
              <h3>
                {last
                  ? last.status === "completed"
                    ? "Есть что отработать?"
                    : "Недостаточно данных"
                  : "Сначала — защита"}
              </h3>
              <p>
                {last?.main_feedback ??
                  "Подними руки к подбородку и замри. После калибровки выполни один удар и верни руку."}
              </p>
              {last && last.violations.length > 1 && (
                <details>
                  <summary>Все замечания ({last.violations.length})</summary>
                  <ul>
                    {last.violations.map((v) => (
                      <li key={v.code}>{v.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              <small>
                {last
                  ? "Относится к завершённой попытке, не к текущей позе."
                  : "Оценка появится после завершения удара."}
              </small>
            </section>
            <section className="privacy-note">
              <Camera size={18} />
              <p>
                Обработка прямо в браузере.
                <br />
                <span>Видео не загружается на сервер.</span>
              </p>
            </section>
          </aside>
        </div>
        {(finished || (!active && total > 0)) && (
          <section className="summary panel">
            <div>
              <div className="eyebrow">ИТОГ ТРЕНИРОВКИ</div>
              <h2>
                {completed} оценённых · {total - completed} без оценки
              </h2>
              <p>
                Средний балл: {average ?? "—"}. Это оценка правил прототипа, не
                процент правильности техники.
              </p>
            </div>
            <ul>
              {Object.entries(issues)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([message, count]) => (
                  <li key={message}>
                    {message} <span>×{count}</span>
                  </li>
                ))}
            </ul>
            <div className="summary-actions">
              <button className="secondary-button" onClick={download}>
                <Download size={16} />
                Скачать отчёт
              </button>
              <button className="text-button" onClick={reset}>
                Новая тренировка
              </button>
            </div>
          </section>
        )}
        <footer className="site-footer">
          <span>SHADOWCOACH / EXPERIMENTAL 0.2</span>
          <p>
            Одна камера не измеряет силу удара и не заменяет тренера. При плохой
            видимости оценка не выдаётся. На слабом устройстве обработка может
            быть медленнее.
          </p>
        </footer>
      </main>
    </div>
  );
}
