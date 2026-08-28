import { analyzeFitData } from "./analysis.js";
import {
  formatDrift,
  formatDuration,
  formatEfficiency,
  formatHeartRate,
  formatHeartRateDifference,
  formatMeters,
  formatPower,
  formatSpeed
} from "./format.js";
import { parseFit } from "./fit.js";
import "./styles.css";
import type { AnalysisResult, Stats } from "./types.js";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root.");
}

app.innerHTML = `
  <main class="page">
    <section class="hero">
      <p class="eyebrow">FIT analysis in the browser</p>
      <h1>Upload a cycling FIT file and get section-level analysis instantly.</h1>
      <p class="intro">
        Everything runs client-side, so this can be hosted as a static site on GitHub Pages.
      </p>
      <label class="upload-card" for="fit-file">
        <span class="upload-title">Choose a <code>.fit</code> file</span>
        <span class="upload-subtitle">The file stays in your browser. No backend needed.</span>
        <input id="fit-file" type="file" accept=".fit,application/octet-stream" />
      </label>
      <p id="status" class="status">Waiting for file.</p>
    </section>
    <section id="results" class="results hidden"></section>
  </main>
`;

const fileInputElement = document.querySelector<HTMLInputElement>("#fit-file");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const resultsElement = document.querySelector<HTMLElement>("#results");

if (!fileInputElement || !statusElement || !resultsElement) {
  throw new Error("Missing required UI elements.");
}

const fileInput = fileInputElement;
const status = statusElement;
const results = resultsElement;

function metricRow(label: string, value: string): string {
  return `<div class="metric"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderStats(stats: Stats, options: { includeSectionMetrics?: boolean } = {}): string {
  const { includeSectionMetrics = false } = options;

  return `
    <dl class="metrics">
      ${metricRow("Complete duration", formatDuration(stats.totalElapsedTime))}
      ${metricRow("Active duration", formatDuration(stats.totalTimerTime))}
      ${metricRow("Average HF", formatHeartRate(stats.avgHeartRate))}
      ${metricRow("Max HF", formatHeartRate(stats.maxHeartRate))}
      ${includeSectionMetrics ? metricRow("HF Δ (60 s)", formatHeartRateDifference(stats.heartRateDiffAfterOneMinute)) : ""}
      ${includeSectionMetrics ? metricRow("Efficiency", formatEfficiency(stats.efficiency)) : ""}
      ${includeSectionMetrics ? metricRow("HF drift", formatDrift(stats.heartRateDrift, "bpm")) : ""}
      ${includeSectionMetrics ? metricRow("Watt drift", formatDrift(stats.powerDrift, "W")) : ""}
      ${metricRow("Distance", formatMeters(stats.totalDistance))}
      ${metricRow("Average speed", formatSpeed(stats.avgSpeed))}
      ${metricRow("Average watt", formatPower(stats.avgPower))}
      ${metricRow("Normalized power", formatPower(stats.normalizedPower))}
      ${metricRow("Max watt", formatPower(stats.maxPower))}
    </dl>
  `;
}

function renderAnalysis(analysis: AnalysisResult, fileName: string): void {
  const sections = analysis.sections
    .map(
      (section) => `
        <article class="panel section-panel">
          <header class="panel-header">
            <h3>${section.label}</h3>
          </header>
          ${renderStats(section, { includeSectionMetrics: true })}
        </article>
      `
    )
    .join("");

  results.innerHTML = `
    <section class="summary-head">
      <div>
        <p class="eyebrow">Analysis</p>
        <h2>${fileName}</h2>
      </div>
    </section>
    <article class="panel">
      <header class="panel-header">
        <h3>Overall</h3>
      </header>
      ${renderStats(analysis.overall)}
    </article>
    <section class="sections-grid">
      ${sections || '<article class="panel"><p>No lap messages found in this FIT file.</p></article>'}
    </section>
  `;
  results.classList.remove("hidden");
}

async function handleFile(file: File): Promise<void> {
  status.textContent = `Reading ${file.name}...`;
  results.classList.add("hidden");

  const buffer = await file.arrayBuffer();
  const parsed = await parseFit(buffer);
  const analysis = analyzeFitData(parsed);

  renderAnalysis(analysis, file.name);
  status.textContent = `Loaded ${file.name}`;
}

fileInput.addEventListener("change", async () => {
  const [file] = Array.from(fileInput.files ?? []);

  if (!file) {
    status.textContent = "Waiting for file.";
    results.classList.add("hidden");
    return;
  }

  try {
    await handleFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Error: ${message}`;
    results.classList.add("hidden");
  }
});
