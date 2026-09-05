/**
 * Batch-runs every image in ../../test-images through POST /v1/analyze and
 * writes both a JSON results file and a self-contained local HTML report
 * (results.html) you can open directly in a browser — thumbnails alongside
 * detected foods, weights, kcal/macros, glycemic load, and confidence.
 *
 * Requires, in separate terminals:
 *   cd nutrition-service && npm run dev
 *   OPENROUTER_API_KEY=sk-or-v1-... npm run dev   (from api/)
 * Then, from api/:
 *   npm run analyze-folder
 */

import * as fs from "fs";
import * as path from "path";
import { MealSummary } from "../../lens-studio/spectacles/Assets/Nutrition/Types";

const API_URL = process.env.API_URL ?? "http://localhost:4002";
const TEST_IMAGES_DIR = path.resolve(__dirname, "../../test-images");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

interface AnalyzeResult {
  filename: string;
  ok: boolean;
  summary?: MealSummary;
  error?: string;
}

async function main() {
  if (!fs.existsSync(TEST_IMAGES_DIR)) {
    fs.mkdirSync(TEST_IMAGES_DIR, { recursive: true });
  }

  const files = fs
    .readdirSync(TEST_IMAGES_DIR)
    .filter((f) => Object.keys(MIME_BY_EXT).includes(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.log(`No images found in ${TEST_IMAGES_DIR}`);
    console.log(`Drop .jpg/.jpeg/.png/.webp photos of plates of food in there and re-run.`);
    return;
  }

  console.log(`Analyzing ${files.length} image(s) from ${TEST_IMAGES_DIR}...\n`);

  const results: AnalyzeResult[] = [];
  for (const filename of files) {
    const filePath = path.join(TEST_IMAGES_DIR, filename);
    const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()];
    const dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;

    process.stdout.write(`  ${filename} ... `);
    try {
      const res = await fetch(`${API_URL}/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: dataUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const summary = body as MealSummary;
      results.push({ filename, ok: true, summary });
      console.log(`${summary.totals.kcal} kcal, ${summary.items.length} food(s)`);
    } catch (err) {
      results.push({ filename, ok: false, error: (err as Error).message });
      console.log(`FAILED — ${(err as Error).message}`);
    }
  }

  console.log("\nSummary:");
  console.table(
    results.map((r) => ({
      file: r.filename,
      foods: r.ok ? r.summary!.items.map((i) => i.food).join(", ") : "-",
      kcal: r.ok ? r.summary!.totals.kcal : "-",
      proteinG: r.ok ? r.summary!.totals.proteinG : "-",
      carbsG: r.ok ? r.summary!.totals.carbsG : "-",
      fatG: r.ok ? r.summary!.totals.fatG : "-",
      glycemicLoad: r.ok ? `${r.summary!.glycemicEstimate?.totalGlycemicLoad} (${r.summary!.glycemicEstimate?.category})` : "-",
      confidence: r.ok ? r.summary!.confidence.overall : "-",
      error: r.error ?? "",
    }))
  );

  const resultsJsonPath = path.join(TEST_IMAGES_DIR, "results.json");
  fs.writeFileSync(resultsJsonPath, JSON.stringify(results, null, 2));

  const reportPath = path.join(TEST_IMAGES_DIR, "results.html");
  fs.writeFileSync(reportPath, renderHtmlReport(results, TEST_IMAGES_DIR, MIME_BY_EXT));

  console.log(`\nWrote ${resultsJsonPath}`);
  console.log(`Wrote ${reportPath} — open it in a browser to see thumbnails + full results.`);
}

function renderHtmlReport(results: AnalyzeResult[], dir: string, mimeByExt: Record<string, string>): string {
  const cards = results
    .map((r) => {
      const mime = mimeByExt[path.extname(r.filename).toLowerCase()];
      const imgData = fs.readFileSync(path.join(dir, r.filename)).toString("base64");
      const imgSrc = `data:${mime};base64,${imgData}`;

      if (!r.ok || !r.summary) {
        return `
        <div class="card card-error">
          <img src="${imgSrc}" alt="${escapeHtml(r.filename)}" />
          <div class="card-body">
            <div class="filename">${escapeHtml(r.filename)}</div>
            <div class="error">${escapeHtml(r.error ?? "Unknown error")}</div>
          </div>
        </div>`;
      }

      const s = r.summary;
      const items = s.items
        .map(
          (i) =>
            `<li>${escapeHtml(i.food)} — ${i.weightG}g ± ${i.weightUncertaintyG}g <span class="muted">(food ${i.foodConfidence}, portion ${i.portionConfidence})</span></li>`
        )
        .join("");

      const gl = s.glycemicEstimate;

      return `
        <div class="card">
          <img src="${imgSrc}" alt="${escapeHtml(r.filename)}" />
          <div class="card-body">
            <div class="filename">${escapeHtml(r.filename)}</div>
            <div class="kcal">${s.totals.kcal} kcal</div>
            <div class="macros">${s.totals.proteinG}g protein &middot; ${s.totals.carbsG}g carbs &middot; ${s.totals.fatG}g fat</div>
            <ul class="items">${items}</ul>
            ${
              gl
                ? `<div class="badge badge-${gl.category}">Est. glycemic load: ${gl.totalGlycemicLoad} (${gl.category})</div>`
                : ""
            }
            <div class="confidence">Confidence — eating ${s.confidence.eatingConfidence}, food ${s.confidence.foodConfidence}, portion ${s.confidence.portionConfidence}, overall <b>${s.confidence.overall}</b></div>
          </div>
        </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Nutrition pipeline test-image results</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f5f5f4; margin: 0; padding: 32px; color: #1c1917; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #78716c; margin: 0 0 24px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card img { width: 100%; height: 200px; object-fit: cover; display: block; background: #e7e5e4; }
  .card-body { padding: 14px 16px; }
  .filename { font-size: 12px; color: #78716c; margin-bottom: 6px; word-break: break-all; }
  .kcal { font-size: 22px; font-weight: 700; }
  .macros { font-size: 13px; color: #57534e; margin: 2px 0 10px; }
  .items { margin: 0 0 10px; padding-left: 18px; font-size: 13px; }
  .items li { margin-bottom: 2px; }
  .muted { color: #a8a29e; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 999px; margin-bottom: 8px; }
  .badge-low { background: #dcfce7; color: #166534; }
  .badge-medium { background: #fef9c3; color: #854d0e; }
  .badge-high { background: #fee2e2; color: #991b1b; }
  .confidence { font-size: 12px; color: #78716c; }
  .card-error .error { color: #dc2626; font-size: 13px; }
</style>
</head>
<body>
  <h1>Nutrition pipeline — test image results</h1>
  <p class="sub">Estimated glycemic load is derived from food composition only — not a measured blood glucose reading.</p>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
