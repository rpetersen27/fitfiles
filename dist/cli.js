#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeFitData } from "./analysis.js";
import { formatDistance, formatDrift, formatDuration, formatEfficiency, formatHeartRate, formatHeartRateDifference, formatPower, formatSpeed } from "./cli-format-shim.js";
import { parseFit } from "./fit.js";
function printBlock(title, stats, options = {}) {
    const { includeHeartRateDiffAfterOneMinute = false, includeEfficiency = false } = options;
    console.log(title);
    console.log(`  Complete duration: ${formatDuration(stats.totalElapsedTime)}`);
    console.log(`  Active duration:   ${formatDuration(stats.totalTimerTime)}`);
    console.log(`  Average HF:        ${formatHeartRate(stats.avgHeartRate)}`);
    console.log(`  Max HF:            ${formatHeartRate(stats.maxHeartRate)}`);
    if (includeHeartRateDiffAfterOneMinute) {
        console.log(`  HF Δ (60 s):       ${formatHeartRateDifference(stats.heartRateDiffAfterOneMinute)}`);
    }
    if (includeEfficiency) {
        console.log(`  Efficiency:        ${formatEfficiency(stats.efficiency)}`);
    }
    if (includeHeartRateDiffAfterOneMinute) {
        console.log(`  HF drift:          ${formatDrift(stats.heartRateDrift, "bpm")}`);
        console.log(`  Watt drift:        ${formatDrift(stats.powerDrift, "W")}`);
    }
    console.log(`  Distance:          ${formatDistance(stats.totalDistance)}`);
    console.log(`  Average Speed:     ${formatSpeed(stats.avgSpeed)}`);
    console.log(`  Average Watt:      ${formatPower(stats.avgPower)}`);
    console.log(`  Max Watt:          ${formatPower(stats.maxPower)}`);
}
async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: fit-analyze <file.fit>");
        process.exitCode = 1;
        return;
    }
    const absolutePath = path.resolve(process.cwd(), filePath);
    const buffer = await fs.readFile(absolutePath);
    const parsed = await parseFit(buffer);
    const analysis = analyzeFitData(parsed);
    console.log(`File: ${absolutePath}`);
    console.log("");
    printBlock("Overall", analysis.overall);
    if (analysis.sections.length === 0) {
        console.log("");
        console.log("Sections");
        console.log("  No lap messages found in this FIT file.");
        return;
    }
    console.log("");
    console.log("Sections");
    for (const section of analysis.sections) {
        console.log("");
        printBlock(`  ${section.label}`, section, {
            includeHeartRateDiffAfterOneMinute: true,
            includeEfficiency: true
        });
    }
}
void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
