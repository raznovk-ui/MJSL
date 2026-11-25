/**
 * Downloads the INSEE FiLoSoFi 2021 income data at IRIS level and writes the small
 * file the app reads: public/data/amp/income_2021.json.
 *
 *   npm run data:income
 *
 * Source: INSEE, FiLoSoFi 2021, revenus disponibles (IRIS), Licence Ouverte 2.0.
 * https://www.insee.fr/fr/statistiques/8229323
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const URL_2021 = "https://www.insee.fr/fr/statistiques/fichier/8229323/BASE_TD_FILO_IRIS_2021_DISP_CSV.zip";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "amp", "income_2021.json");

const number = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

console.log("Downloading FiLoSoFi 2021 (IRIS, revenus disponibles)...");
const response = await fetch(URL_2021, { signal: AbortSignal.timeout(180_000) });
if (!response.ok) throw new Error(`FiLoSoFi download failed: HTTP ${response.status}`);
const zip = await JSZip.loadAsync(await response.arrayBuffer());
const entries = Object.values(zip.files).filter((f) => f.name.endsWith(".csv") && !f.name.toLowerCase().includes("meta"));
if (entries.length === 0) throw new Error("FiLoSoFi: no CSV found in the archive");
const csv = await entries[0].async("string");
const lines = csv.split(/\r?\n/).filter(Boolean);
const header = lines[0].split(";");
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const at = (row, name) => row[index[name]];

const iris = {};
for (const line of lines.slice(1)) {
  const row = line.split(";");
  const code = at(row, "IRIS");
  if (!/^132\d{6}$/.test(code ?? "")) continue; // Marseille only
  const median = number(at(row, "DISP_MED21"));
  if (median === undefined) continue;
  iris[code] = {
    median,
    poverty: number(at(row, "DISP_TP6021")),
    q1: number(at(row, "DISP_Q121")),
    q3: number(at(row, "DISP_Q321")),
  };
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      source: "INSEE FiLoSoFi 2021 — revenus disponibles (IRIS)",
      millesime: "2021",
      license: "Licence Ouverte 2.0",
      iris,
    },
    null,
    2,
  )}\n`,
);
console.log(`${Object.keys(iris).length} IRIS -> ${OUT}`);
