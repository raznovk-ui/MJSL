/**
 * No chart library: these small charts use semantic HTML, direct value labels,
 * and a table alternative rather than depending on an axis or colour alone.
 *
 * One hue throughout. The job here is magnitude, not identity, so a sequential
 * single hue is the correct encoding and no categorical palette is in play.
 */
interface BarDatum {
  key: string;
  label: string;
  value: number | null;
  /** Shown under the label; e.g. how many cells backed the figure. */
  note?: string;
}

export function BarChart({
  data,
  max,
  caption,
  unit = "",
}: {
  data: BarDatum[];
  max: number;
  caption: string;
  unit?: string;
}) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-xs font-medium">{caption}</figcaption>
      <div className="flex flex-col gap-2" aria-label={`${caption}. ${data
        .map((datum) => `${datum.label} ${datum.value === null ? "non renseignee" : `${datum.value.toFixed(2)}${unit}`}`)
        .join(". ")}`}>
        {data.map((datum) => {
          const ratio = datum.value === null ? 0 : Math.max(0, Math.min(1, datum.value / max));
          return (
            <div key={datum.key} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs">
              <span>{datum.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {datum.value !== null && <span className="block h-full min-w-0 rounded-full bg-primary" style={{ width: `${Math.max(1, ratio * 100)}%` }} />}
              </span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">{datum.value === null ? "—" : `${datum.value.toFixed(2)}${unit}`}</span>
            </div>
          );
        })}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">Voir les valeurs</summary>
        <table className="mt-1 w-full border-collapse text-left text-xs">
          <tbody>
            {data.map((datum) => (
              <tr key={datum.key} className="border-b border-border">
                <th scope="row" className="py-1 pr-2 font-normal">
                  {datum.label}
                </th>
                <td className="py-1 pr-2">
                  {datum.value === null ? "non renseignee" : `${datum.value.toFixed(2)}${unit}`}
                </td>
                <td className="py-1 text-muted-foreground">{datum.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}


export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
