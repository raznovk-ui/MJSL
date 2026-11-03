import { DIMENSION_KEYS, dimension as meta, type DimensionScores } from "../../domain/zone/index.js";

/**
 * The six scores side by side, 0 (total obstacle) to 1 (none). Each shows its number
 * as text as well as a bar, so nothing depends on colour, and "pas de donnee" when
 * the open data has nothing for that dimension.
 */
export function DimensionBars({ scores }: { scores: DimensionScores }) {
  return (
    <ul className="flex flex-col gap-2 text-xs">
      {DIMENSION_KEYS.map((key) => {
        const { score, coverage } = scores[key];
        return (
          <li key={key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
            <span className="font-medium">{meta(key).label.split(" et ")[0]}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              {score !== null && <span className="block h-full rounded-full" style={{ width: `${Math.round(score * 100)}%`, background: meta(key).colour }} />}
            </span>
            <span className="w-24 text-right tabular-nums text-muted-foreground">
              {score === null ? "pas de donnee" : `${score.toFixed(2)} (${Math.round(coverage * 100)} %)`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
