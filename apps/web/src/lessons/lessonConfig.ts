import {
  expectedHand,
  type Move,
  type Stance,
} from "../../../../packages/coach-core/src/types";
export interface LessonConfig {
  move: Move;
  title: string;
  description: string;
  youtubeId: string;
  youtubeUrl: string;
  videoTitle: string;
  author: string;
  keyPoints: string[];
  safetyNote: string;
}
const safetyNote =
  "Освободите пространство на расстоянии вытянутых рук. Выполняйте одиночные удары в воздух без контакта, в комфортном темпе.";
export const lessons: LessonConfig[] = [
  {
    move: "jab",
    title: "Джеб",
    description:
      "Прямой удар передней рукой. Начните с точной траектории и возврата.",
    youtubeId: "71nmi6nGcrY",
    youtubeUrl: "https://www.youtube.com/watch?v=71nmi6nGcrY",
    videoTitle: "How to Throw the Perfect Jab in Boxing",
    author: "Tony Jeffries",
    keyPoints: [
      "Ведите переднюю руку прямо к цели.",
      "Свободная рука остаётся у подбородка.",
      "Верните ударную руку в защиту.",
    ],
    safetyNote,
  },
  {
    move: "cross",
    title: "Кросс",
    description: "Прямой удар задней рукой с поворотом плеч и корпуса.",
    youtubeId: "sK-6Ujp3KYY",
    youtubeUrl: "https://www.youtube.com/watch?v=sK-6Ujp3KYY",
    videoTitle: "How to Throw the Perfect Cross (Right Hand / 2) in Boxing",
    author: "Tony Jeffries",
    keyPoints: [
      "Удар выполняет задняя рука.",
      "Поверните плечи и корпус, сохраняйте равновесие.",
      "Верните руку в защиту, свободную держите у подбородка.",
    ],
    safetyNote,
  },
  {
    move: "hook",
    title: "Передний боковой",
    description: "Удар передней рукой по дуге с согнутым локтем.",
    youtubeId: "0gtMKaCJ5I8",
    youtubeUrl: "https://www.youtube.com/watch?v=0gtMKaCJ5I8",
    videoTitle:
      "The Correct Way To Throw HOOKS in BOXING | Thumb Up or Thumb In",
    author: "Tony Jeffries",
    keyPoints: [
      "Сохраняйте ударный локоть согнутым.",
      "Поднимите локоть приблизительно к уровню плеча.",
      "Ведите руку по дуге с поворотом плеч, затем вернитесь в защиту.",
    ],
    safetyNote,
  },
];
export function handLabel(move: Move, stance: Stance) {
  return `${move === "cross" ? "Задняя" : "Передняя"} рука — ${expectedHand(move, stance) === "left" ? "левая" : "правая"}`;
}
