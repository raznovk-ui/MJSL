import { useMemo, useState } from "react";
import { OVERPASS_PRESETS } from "../overpass/presets.js";
import { useAppStore } from "../state.js";
import { useWalkwayStore } from "../walkway/walkwayStore.js";

const PAGE = 50;

/**
 * The non-map view the accessibility requirement calls for: everything on the
 * map is reachable here without a pointer or a visual channel.
 */
export function DataTable() {
  const presets = useAppStore((s) => s.presets);
  const zones = useWalkwayStore((s) => s.zones);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(
    () => [
      ...zones.map((zone) => ({
        preset: "Zone prioritaire",
        id: zone.id,
        label: `#${zone.rank} : ${zone.summary}`,
        type: `${Math.round(zone.lengthM)} m`,
        wheelchair: "",
      })),
      ...OVERPASS_PRESETS.flatMap((preset) =>
        (presets[preset.id]?.geojson?.features ?? []).map((feature) => ({
          preset: preset.label,
          id: String(feature.properties?.osm_id ?? feature.id ?? ""),
          label: String(feature.properties?.label ?? ""),
          type: feature.geometry.type,
          wheelchair: String(feature.properties?.wheelchair ?? ""),
        })),
      ),
    ],
    [presets, zones],
  );

  if (rows.length === 0) {
    return (
      <p className="m-4 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Aucune donnee chargee pour l&apos;instant.
      </p>
    );
  }

  return (
    <div className="p-4">
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="p-3 text-left text-xs text-slate-500">
            {rows.length} objets charges. Memes donnees que la carte.
          </caption>
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--line)", background: "var(--surface-alt)" }}>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Type</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Objet</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Geometrie</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Dimensions / wheelchair</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Identifiant</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, index) => (
              <tr
                key={row.id}
                className="border-b"
                style={{ borderColor: "var(--line)", background: index % 2 ? "var(--surface-alt)" : "var(--surface)" }}
              >
                <td className="px-3 py-1.5 text-slate-600">{row.preset}</td>
                <td className="px-3 py-1.5 font-medium text-slate-900">{row.label}</td>
                <td className="px-3 py-1.5 text-slate-600">{row.type}</td>
                <td className="px-3 py-1.5 text-slate-600">{row.wheelchair || "-"}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{row.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limit < rows.length && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="btn btn-secondary mt-3">
          Afficher {Math.min(PAGE, rows.length - limit)} objets de plus
        </button>
      )}
    </div>
  );
}
