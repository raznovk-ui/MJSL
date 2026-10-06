import { SCORED_DIMENSIONS, type DimensionScores } from "../../domain/walkway/index.js";
import { dimension as meta } from "../../domain/dimensions.js";

/**
 * The five scores side by side, 0 (total obstacle) to 1 (none). Each shows its number
 * as text as well as a bar, so nothing depends on colour, and "pas de donnee" when
 * the open data has nothing for that dimension.
 */
export function DimensionBars({ scores }: { scores: DimensionScores }) {
  return (
    <ul className="space-y-1 text-xs">
      {SCORED_DIMENSIONS.map((key) => {
        const { score, coverage } = scores[key];
        return (
          <li key={key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
            <span className="font-medium text-slate-800">{meta(key).label.split(" et ")[0]}</span>
            <span className="h-2 rounded bg-slate-200" aria-hidden="true">
              {score !== null && <span className="block h-2 rounded" style={{ width: `${Math.round(score * 100)}%`, background: meta(key).colour }} />}
            </span>
            <span className="w-24 text-right tabular-nums text-slate-700">
              {score === null ? "pas de donnee" : `${score.toFixed(2)} (${Math.round(coverage * 100)} %)`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
