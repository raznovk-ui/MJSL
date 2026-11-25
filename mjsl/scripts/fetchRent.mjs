/**
 * Downloads the rent data used by the economic dimension:
 *   - OLL 13 / AMP, observed private-rent levels by IRIS (millesime 2025);
 *   - Carte des loyers 2025, asking rents by arrondissement (cross-check).
 *
 *   npm run data:rent
 *
 * Sources: ADIL13 / Observatoire local des loyers (Licence Ouverte 2.0),
 * ANIL / ministere de la Transition ecologique (Licence Ouverte 2.0).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OLL_API = "https://data.ampmetropole.fr/api/explore/v2.1/catalog/datasets/oll-complet/records";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "amp", "rent.json");
const CARTE_LOYERS_DATASET = "carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025";

const number = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

const logical = (value) => /^(oui|yes|true|1)$/i.test(String(value ?? ""));

async function ollRows() {
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const url = new URL(OLL_API);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("where", 'millesime="2025" and commune_regroupee="Marseille" and code_iris is not null');
    url.searchParams.set("select", "code_iris,nom_iris,zone,nb_enq,plr,s_q1,s_med,s_q3,m_med,s_app,sm_med");
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`OLL: HTTP ${response.status}`);
    const page = (await response.json()).results ?? [];
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

async function askingByArrondissement() {
  const search = await fetch("https://www.data.gouv.fr/api/1/datasets/?q=carte%20des%20loyers&page_size=10", {
    signal: AbortSignal.timeout(60_000),
  });
  if (!search.ok) throw new Error(`Carte des loyers search: HTTP ${search.status}`);
  const dataset = (await search.json()).data?.find((d) => String(d.title).includes("2025"));
  if (!dataset) throw new Error("Carte des loyers 2025 dataset not found");
  const detail = await fetch(`https://www.data.gouv.fr/api/1/datasets/${dataset.id}/`, { signal: AbortSignal.timeout(60_000) });
  if (!detail.ok) throw new Error(`Carte des loyers dataset: HTTP ${detail.status}`);
  const resources = (await detail.json()).resources ?? [];
  const resource = resources.find((r) => r.format === "csv" && /appartement/i.test(r.title) && !/1 ou 2|3 pi/i.test(r.title));
  if (!resource) throw new Error("Carte des loyers: apartment CSV not found");
  const csvResponse = await fetch(resource.url, { signal: AbortSignal.timeout(120_000) });
  if (!csvResponse.ok) throw new Error(`Carte des loyers CSV: HTTP ${csvResponse.status}`);
  const text = await csvResponse.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(";").map((h) => h.replace(/^"|"$/g, ""));
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const out = {};
  for (const line of lines.slice(1)) {
    const row = line.split(";");
    const code = String(row[index.INSEE_C] ?? "").replace(/"/g, "");
    if (!/^132\d{2}$/.test(code)) continue;
    const median = number(String(row[index.loypredm2] ?? "").replace(/"/g, ""));
    if (median === undefined) continue;
    out[code] = {
      median,
      low: number(String(row[index["lwr.IPm2"]] ?? "").replace(/"/g, "")),
      high: number(String(row[index["upr.IPm2"]] ?? "").replace(/"/g, "")),
      observations: number(row[index.nbobs_com]),
    };
  }
  return out;
}

console.log("Downloading OLL 13 observed rents (2025)...");
const rows = await ollRows();
const observed = {};
for (const row of rows) {
  const code = String(row.code_iris);
  const sMed = number(row.s_med);
  const mMed = number(row.m_med);
  if (!/^132\d{6}$/.test(code) || sMed === undefined || mMed === undefined) continue;
  observed[code] = {
    zone: String(row.zone ?? ""),
    sMed,
    mMed,
    sQ1: number(row.s_q1),
    sQ3: number(row.s_q3),
    surface: number(row.sm_med),
    nbEnq: number(row.nb_enq),
    plr: logical(row.plr),
  };
}

console.log("Downloading Carte des loyers 2025 (cross-check by arrondissement)...");
const asking = await askingByArrondissement();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      source: "OLL 13 / ADIL13 via Metropole AMP (millesime 2025)",
      license: "Licence Ouverte 2.0",
      observedMillesime: "2025",
      observed,
      askingCrossCheck: {
        source: "Carte des loyers 2025, ANIL / ministere de la Transition ecologique (loyers d'annonce, charges comprises)",
        license: "Licence Ouverte 2.0",
        byArrondissement: asking,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(`${Object.keys(observed).length} IRIS (observed), ${Object.keys(asking).length} arrondissements (asking) -> ${OUT}`);
