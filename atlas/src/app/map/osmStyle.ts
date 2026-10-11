import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The "Indices OSM" overlay: physical features that OpenStreetMap records. It is NOT the
 * citizens' reports: each kind has its own glyph (stairs, lift, kerb, tactile dots), filled
 * in a shade of the blue-to-purple palette, never the red of the "bad" zones.
 */
export type OsmKind = "steps" | "elevator" | "kerb" | "tactile";

/** Each glyph is drawn in a 20 x 20 box. `d` is the outline, `fillRule` decides the holes. */
interface Glyph {
  d: string;
  fillRule?: "evenodd" | "nonzero";
}

/** Dots for the tactile paving: a 3 x 3 grid of small discs. */
const dots = (): string =>
  [5, 10, 15]
    .flatMap((y) => [5, 10, 15].map((x) => `M${x - 1.5} ${y}a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0z`))
    .join("");

export const OSM_STYLE: Record<OsmKind, { label: string; colour: string; glyph: Glyph }> = {
  steps: {
    label: "Escaliers (OSM)",
    colour: "#190087",
    glyph: { d: "M2 18V14H6V10H10V6H14V2H18V18Z" },
  },
  elevator: {
    label: "Ascenseur (OSM)",
    colour: "#3e00b3",
    glyph: { d: "M2 2H18V18H2Z M9.2 4.5H10.8V15.5H9.2Z", fillRule: "evenodd" },
  },
  kerb: {
    label: "Bordure (OSM)",
    colour: "#6b00d7",
    glyph: { d: "M2 8H18V11H2Z M5 12H15V18H5Z" },
  },
  tactile: {
    label: "Bandes podotactiles (OSM)",
    colour: "#a230ed",
    glyph: { d: dots() },
  },
};

export const OSM_KINDS = Object.keys(OSM_STYLE) as OsmKind[];

/** The kind of an OSM feature, from its tags. */
export function osmKind(tags: Record<string, unknown>): OsmKind {
  if (tags.highway === "elevator") return "elevator";
  if (tags.highway === "steps") return "steps";
  if (tags.tactile_paving) return "tactile";
  return "kerb";
}

/** The glyph as an SVG document: filled, with a thin white outline so it reads on any basemap. */
export function osmSvg(kind: OsmKind): string {
  const { colour, glyph } = OSM_STYLE[kind];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="40" height="40">` +
    `<path d="${glyph.d}" fill="${colour}" fill-rule="${glyph.fillRule ?? "nonzero"}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** Rasterises the SVG glyph to pixels, which is what the map takes as an image. */
export function osmIconPixels(kind: OsmKind, size = 40): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image(size, size);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    image.onerror = () => reject(new Error(`Icone ${kind} illisible.`));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(osmSvg(kind))}`;
  });
}

/**
 * Adds the four glyphs to the map (again after a basemap change, which drops them). Images
 * are loaded asynchronously; a symbol layer shows nothing until its image is there, then
 * the map redraws by itself.
 */
export async function ensureOsmIcons(instance: MapLibreMap): Promise<void> {
  await Promise.all(
    OSM_KINDS.map(async (kind) => {
      const id = `osm-${kind}`;
      if (instance.hasImage(id)) return;
      const pixels = await osmIconPixels(kind);
      if (!instance.hasImage(id)) instance.addImage(id, pixels, { pixelRatio: 2 });
    }),
  );
}
