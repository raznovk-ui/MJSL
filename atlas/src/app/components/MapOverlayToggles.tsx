import { useAppStore } from "../state.js";
import { useZoneStore } from "../zone/zoneStore.js";
import { IconLayers } from "./icons.js";
import { SCORED_DIMENSIONS, ZONE_CONFIG, reportKind } from "../../domain/zone/index.js";
import { dimension as meta } from "../../domain/dimensions.js";
import { GRADIENT } from "../zone/zoneLayers.js";
import { REPORT_KINDS, REPORT_STYLE, SHAPE_PATH } from "../zone/reportStyle.js";
import { OSM_KINDS, OSM_STYLE } from "../map/osmStyle.js";

/** The person each dimension is read through, as the client defined them. */
const PERSONA: Record<string, string> = {
  physical: "mobilite reduite",
  sensory: "malvoyant.e / neurodivergent.e",
  cognitive: "allophone",
  economic: "faibles revenus",
  socio_cultural: "co-presence",
  political: "co-participation",
};

/**
 * On/off switches for every overlay, on the map itself, so any layer can be hidden
 * to compare against the bare basemap. "Carte seule" hides them all at once.
 */
export function MapOverlayToggles() {
  const presets = useAppStore((s) => s.presets);
  const visible = useZoneStore((s) => s.visible);
  const reportsVisible = useZoneStore((s) => s.reportsVisible);
  const zoneCount = useZoneStore((s) => s.zones.length);
  const layer = useZoneStore((s) => s.layer);
  const reportKinds = useZoneStore((s) => s.reportKinds);
  const reports = useZoneStore((s) => s.reports);
  const setLayer = useZoneStore((s) => s.setLayer);

  const osmVisible = Object.values(presets).some((p) => p.visible);
  const allHidden = !visible && !osmVisible && !reportsVisible;

  const setOsm = (visible: boolean) =>
    useAppStore.setState((s) => ({
      presets: Object.fromEntries(Object.entries(s.presets).map(([id, p]) => [id, { ...p, visible }])),
    }));

  const setAll = (visible: boolean) => {
    setOsm(visible);
    useZoneStore.setState({ visible, reportsVisible: visible && reportsVisible });
  };

  const row = "flex items-start gap-2 text-xs";

  return (
    <fieldset
      className="absolute left-2 top-2 z-10 max-h-[calc(100%-1rem)] w-64 overflow-y-auto rounded-md border bg-white p-2 shadow-md"
      style={{ borderColor: "var(--line)" }}
    >
      <legend className="sr-only">Calques de la carte</legend>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-900">
        <IconLayers className="h-4 w-4" />
        Calques
      </p>
      <div role="radiogroup" aria-label="Couche affichee" className="mb-2 space-y-1 border-b pb-2" style={{ borderColor: "var(--line)" }}>
        <p className="text-xs font-semibold text-slate-700">Couche affichee</p>
        {([["combined", "Score combine (profil choisi)"], ...SCORED_DIMENSIONS.map((d) => [d, `${meta(d).mjslCode} ${meta(d).label} — ${PERSONA[d]}`] as const)] as const).map(([key, label]) => (
          <label key={key} className={row}>
            <input type="radio" name="map-layer" checked={layer === key} onChange={() => setLayer(key)} className="mt-0.5" />
            <span>{label}</span>
          </label>
        ))}
        <div className="pt-1">
          <div
            className="h-2 rounded"
            aria-hidden="true"
            style={{ background: `linear-gradient(to right, ${GRADIENT.map(([x, c]) => `${c} ${x * 100}%`).join(", ")})` }}
          />
          <p className="mt-0.5 flex justify-between text-[11px] text-slate-600">
            <span>bas : obstacles (pointille)</span>
            <span>haut : peu d'obstacles</span>
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className={row}>
          <input
            type="checkbox"
            checked={visible && zoneCount > 0}
            disabled={zoneCount === 0}
            onChange={() => useZoneStore.getState().toggleVisible()}
            className="mt-0.5"
          />
          <span>
            Zones
            {zoneCount === 0 && <span className="block text-slate-500">calcul en cours</span>}
          </span>
        </label>
        <label className={row}>
          <input type="checkbox" checked={reportsVisible} onChange={() => useZoneStore.getState().toggleReports()} className="mt-0.5" />
          <span>Signalements des habitants</span>
        </label>
        {reportsVisible && (
          <fieldset className="ml-5 space-y-1 border-l pl-2" style={{ borderColor: "var(--line)" }}>
            <legend className="sr-only">Types de signalements affiches</legend>
            {REPORT_KINDS.map((kind) => {
              const st = REPORT_STYLE[kind];
              const n = reports.filter((r) => reportKind(r.type, ZONE_CONFIG) === kind).length;
              return (
                <label key={kind} className={row}>
                  <input type="checkbox" checked={reportKinds[kind]} onChange={() => useZoneStore.getState().toggleReportKind(kind)} className="mt-0.5" />
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="mt-px shrink-0">
                    <path d={SHAPE_PATH[st.shape]} fill={st.colour} stroke="#111827" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                  <span>
                    {st.label} ({n})
                    {st.feeds && <span className="block text-slate-500">alimente {st.feeds}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <label className={row}>
          <input type="checkbox" checked={osmVisible} onChange={(e) => setOsm(e.target.checked)} className="mt-0.5" />
          <span>Indices OSM (donnees OpenStreetMap, pas les citoyens)</span>
        </label>
        {osmVisible && (
          <fieldset className="ml-5 space-y-1 border-l pl-2" style={{ borderColor: "var(--line)" }}>
            <legend className="sr-only">Indices OSM affiches</legend>
            {OSM_KINDS.map((kind) => {
              const st = OSM_STYLE[kind];
              return (
                <div key={kind} className={row}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="mt-px shrink-0">
                    <path d={SHAPE_PATH[st.shape]} fill="none" stroke={st.colour} strokeWidth="2.2" strokeLinejoin="round" />
                  </svg>
                  <span>{st.label}</span>
                </div>
              );
            })}
          </fieldset>
        )}
      </div>
      <button type="button" onClick={() => setAll(allHidden)} className="btn btn-secondary btn-sm btn-block mt-2">
        {allHidden ? "Tout afficher" : "Carte seule"}
      </button>
    </fieldset>
  );
}
