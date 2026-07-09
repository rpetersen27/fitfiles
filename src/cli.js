#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import FitParserModule from "fit-file-parser";

const FitParser = FitParserModule.default ?? FitParserModule;

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toFixed(digits);
}

function formatMeters(distanceMeters) {
  if (distanceMeters == null || Number.isNaN(distanceMeters)) {
    return "-";
  }

  return `${formatNumber(distanceMeters / 1000, 2)} km`;
}

function formatSpeed(speedMetersPerSecond) {
  if (speedMetersPerSecond == null || Number.isNaN(speedMetersPerSecond)) {
    return "-";
  }

  return `${formatNumber(speedMetersPerSecond * 3.6, 2)} km/h`;
}

function formatHeartRate(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value)} bpm`;
}

function formatPower(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value)} W`;
}

function formatHeartRateDifference(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} bpm`;
}

function formatEfficiency(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${formatNumber(value, 2)} W/BPM`;
}

function formatDrift(value, unit) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} ${unit}`;
}

function unwrapFitValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "object" && "value" in value) {
    return value.value;
  }

  return value;
}

function weightedAverage(parts, fieldName, weightFieldName) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const part of parts) {
    const value = part[fieldName];
    const weight = part[weightFieldName];

    if (
      value == null ||
      weight == null ||
      Number.isNaN(value) ||
      Number.isNaN(weight) ||
      weight <= 0
    ) {
      continue;
    }

    totalWeight += weight;
    weightedSum += value * weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  return weightedSum / totalWeight;
}

function maxValue(parts, fieldName) {
  const values = parts
    .map((part) => part[fieldName])
    .filter((value) => value != null && !Number.isNaN(value));

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function sumValue(parts, fieldName) {
  const values = parts
    .map((part) => part[fieldName])
    .filter((value) => value != null && !Number.isNaN(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function averageValue(records, fieldName, durationFieldName) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  let weightedSum = 0;
  let totalDuration = 0;
  let fallbackSum = 0;
  let fallbackCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    const value = current[fieldName];

    if (value == null || Number.isNaN(value)) {
      continue;
    }

    fallbackSum += value;
    fallbackCount += 1;

    if (!next) {
      continue;
    }

    const currentDuration = current[durationFieldName];
    const nextDuration = next[durationFieldName];

    if (
      currentDuration == null ||
      nextDuration == null ||
      Number.isNaN(currentDuration) ||
      Number.isNaN(nextDuration)
    ) {
      continue;
    }

    const delta = nextDuration - currentDuration;

    if (delta <= 0) {
      continue;
    }

    weightedSum += value * delta;
    totalDuration += delta;
  }

  if (totalDuration > 0) {
    return weightedSum / totalDuration;
  }

  if (fallbackCount > 0) {
    return fallbackSum / fallbackCount;
  }

  return null;
}

function buildStatsFromRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  const first = records[0];
  const last = records.at(-1);
  const startDistance = first.distance ?? 0;
  const endDistance = last.distance ?? null;
  const elapsedTime =
    last.elapsed_time != null && first.elapsed_time != null
      ? last.elapsed_time - first.elapsed_time
      : null;
  const timerTime =
    last.timer_time != null && first.timer_time != null
      ? last.timer_time - first.timer_time
      : null;
  const distance =
    endDistance != null && startDistance != null
      ? Math.max(0, endDistance - startDistance)
      : null;

  return {
    totalElapsedTime: elapsedTime,
    totalTimerTime: timerTime,
    avgHeartRate: averageValue(records, "heart_rate", "timer_time"),
    maxHeartRate: maxValue(records, "heart_rate"),
    totalDistance: distance,
    avgSpeed:
      timerTime != null && timerTime > 0 && distance != null
        ? distance / timerTime
        : averageValue(records, "speed", "timer_time"),
    avgPower: averageValue(records, "power", "timer_time"),
    maxPower: maxValue(records, "power"),
  };
}

function calculateEfficiency(avgPower, avgHeartRate) {
  if (
    avgPower == null ||
    avgHeartRate == null ||
    Number.isNaN(avgPower) ||
    Number.isNaN(avgHeartRate) ||
    avgHeartRate <= 0
  ) {
    return null;
  }

  return avgPower / avgHeartRate;
}

function heartRateDifferenceAfterOneMinute(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  const startRecord = records.find(
    (record) => record.heart_rate != null && !Number.isNaN(record.heart_rate),
  );

  if (
    !startRecord ||
    startRecord.timer_time == null ||
    Number.isNaN(startRecord.timer_time)
  ) {
    return null;
  }

  const targetTime = startRecord.timer_time + 60;
  const oneMinuteRecord = records.find(
    (record) =>
      record.timer_time != null &&
      !Number.isNaN(record.timer_time) &&
      record.timer_time >= targetTime &&
      record.heart_rate != null &&
      !Number.isNaN(record.heart_rate),
  );

  if (!oneMinuteRecord) {
    return null;
  }

  return oneMinuteRecord.heart_rate - startRecord.heart_rate;
}

function averageOverRange(records, fieldName, startTime, endTime) {
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    startTime == null ||
    endTime == null ||
    endTime <= startTime
  ) {
    return null;
  }

  let weightedSum = 0;
  let totalDuration = 0;

  for (let index = 0; index < records.length - 1; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    const value = current[fieldName];
    const currentTime = current.timer_time;
    const nextTime = next.timer_time;

    if (
      value == null ||
      currentTime == null ||
      nextTime == null ||
      Number.isNaN(value) ||
      Number.isNaN(currentTime) ||
      Number.isNaN(nextTime) ||
      nextTime <= currentTime
    ) {
      continue;
    }

    const overlapStart = Math.max(startTime, currentTime);
    const overlapEnd = Math.min(endTime, nextTime);
    const duration = overlapEnd - overlapStart;

    if (duration <= 0) {
      continue;
    }

    weightedSum += value * duration;
    totalDuration += duration;
  }

  if (totalDuration <= 0) {
    return null;
  }

  return weightedSum / totalDuration;
}

function calculateHalfDrift(records, fieldName) {
  if (!Array.isArray(records) || records.length < 2) {
    return null;
  }

  const validTimes = records
    .map((record) => record.timer_time)
    .filter((value) => value != null && !Number.isNaN(value));

  if (validTimes.length < 2) {
    return null;
  }

  const startTime = validTimes[0];
  const endTime = validTimes.at(-1);
  const midpoint = startTime + (endTime - startTime) / 2;

  if (midpoint <= startTime || midpoint >= endTime) {
    return null;
  }

  const firstHalfAverage = averageOverRange(
    records,
    fieldName,
    startTime,
    midpoint,
  );
  const secondHalfAverage = averageOverRange(
    records,
    fieldName,
    midpoint,
    endTime,
  );

  if (firstHalfAverage == null || secondHalfAverage == null) {
    return null;
  }

  return secondHalfAverage - firstHalfAverage;
}

function mergeStats(primary, fallback) {
  if (!primary) {
    return fallback;
  }

  if (!fallback) {
    return primary;
  }

  return {
    totalElapsedTime: primary.totalElapsedTime ?? fallback.totalElapsedTime,
    totalTimerTime: primary.totalTimerTime ?? fallback.totalTimerTime,
    avgHeartRate: primary.avgHeartRate ?? fallback.avgHeartRate,
    maxHeartRate: primary.maxHeartRate ?? fallback.maxHeartRate,
    totalDistance: primary.totalDistance ?? fallback.totalDistance,
    avgSpeed: primary.avgSpeed ?? fallback.avgSpeed,
    avgPower: primary.avgPower ?? fallback.avgPower,
    maxPower: primary.maxPower ?? fallback.maxPower,
    heartRateDiffAfterOneMinute:
      primary.heartRateDiffAfterOneMinute ??
      fallback.heartRateDiffAfterOneMinute,
    efficiency: primary.efficiency ?? fallback.efficiency,
    heartRateDrift: primary.heartRateDrift ?? fallback.heartRateDrift,
    powerDrift: primary.powerDrift ?? fallback.powerDrift,
  };
}

function normalizeSession(session) {
  return {
    totalElapsedTime: session.total_elapsed_time ?? null,
    totalTimerTime: session.total_timer_time ?? null,
    avgHeartRate: session.avg_heart_rate ?? null,
    maxHeartRate: session.max_heart_rate ?? null,
    totalDistance: session.total_distance ?? null,
    avgSpeed: session.avg_speed ?? session.enhanced_avg_speed ?? null,
    avgPower: session.avg_power ?? null,
    maxPower: session.max_power ?? null,
  };
}

function normalizeLap(lap, index) {
  const lapIndex = unwrapFitValue(lap.message_index);

  return {
    label: Number.isFinite(lapIndex)
      ? `Lap ${lapIndex + 1}`
      : `Lap ${index + 1}`,
    startTime: lap.start_time ?? null,
    totalElapsedTime: lap.total_elapsed_time ?? null,
    totalTimerTime: lap.total_timer_time ?? null,
    avgHeartRate: lap.avg_heart_rate ?? null,
    maxHeartRate: lap.max_heart_rate ?? null,
    totalDistance: lap.total_distance ?? null,
    avgSpeed: lap.avg_speed ?? lap.enhanced_avg_speed ?? null,
    avgPower: lap.avg_power ?? null,
    maxPower: lap.max_power ?? null,
    heartRateDiffAfterOneMinute: null,
    efficiency: calculateEfficiency(
      lap.avg_power ?? null,
      lap.avg_heart_rate ?? null,
    ),
    heartRateDrift: null,
    powerDrift: null,
  };
}

function summarizeSessions(sessions) {
  if (sessions.length === 0) {
    return null;
  }

  if (sessions.length === 1) {
    return normalizeSession(sessions[0]);
  }

  return {
    totalElapsedTime: sumValue(sessions, "total_elapsed_time"),
    totalTimerTime: sumValue(sessions, "total_timer_time"),
    avgHeartRate: weightedAverage(
      sessions,
      "avg_heart_rate",
      "total_timer_time",
    ),
    maxHeartRate: maxValue(sessions, "max_heart_rate"),
    totalDistance: sumValue(sessions, "total_distance"),
    avgSpeed: weightedAverage(
      sessions.map((session) => ({
        avg_speed: session.avg_speed ?? session.enhanced_avg_speed ?? null,
        total_timer_time: session.total_timer_time ?? null,
      })),
      "avg_speed",
      "total_timer_time",
    ),
    avgPower: weightedAverage(sessions, "avg_power", "total_timer_time"),
    maxPower: maxValue(sessions, "max_power"),
  };
}

function printBlock(title, stats, options = {}) {
  const {
    includeHeartRateDiffAfterOneMinute = false,
    includeEfficiency = false,
  } = options;

  console.log(title);
  console.log(`  Complete duration: ${formatDuration(stats.totalElapsedTime)}`);
  console.log(`  Active duration:   ${formatDuration(stats.totalTimerTime)}`);
  console.log(`  Average HF:        ${formatHeartRate(stats.avgHeartRate)}`);
  console.log(`  Max HF:            ${formatHeartRate(stats.maxHeartRate)}`);
  if (includeHeartRateDiffAfterOneMinute) {
    console.log(
      `  HF Δ (60 s): ${formatHeartRateDifference(stats.heartRateDiffAfterOneMinute)}`,
    );
  }
  if (includeEfficiency) {
    console.log(`  Efficiency:        ${formatEfficiency(stats.efficiency)}`);
  }
  if (includeHeartRateDiffAfterOneMinute) {
    console.log(
      `  HF drift:          ${formatDrift(stats.heartRateDrift, "bpm")}`,
    );
    console.log(`  Watt drift:        ${formatDrift(stats.powerDrift, "W")}`);
  }
  console.log(`  Distance:          ${formatMeters(stats.totalDistance)}`);
  console.log(`  Average Speed:     ${formatSpeed(stats.avgSpeed)}`);
  console.log(`  Average Watt:      ${formatPower(stats.avgPower)}`);
  console.log(`  Max Watt:          ${formatPower(stats.maxPower)}`);
}

function parseFit(buffer) {
  const parser = new FitParser({
    force: true,
    mode: "both",
    elapsedRecordField: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    temperatureUnit: "celsius",
  });

  return new Promise((resolve, reject) => {
    parser.parse(buffer, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });
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

  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const laps = Array.isArray(parsed.laps) ? parsed.laps : [];
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const overall = mergeStats(
    summarizeSessions(sessions),
    buildStatsFromRecords(records),
  );

  if (!overall) {
    throw new Error("The FIT file did not contain any session summary data.");
  }

  console.log(`File: ${absolutePath}`);
  console.log("");
  printBlock("Overall", overall);

  if (laps.length === 0) {
    console.log("");
    console.log("Sections");
    console.log("  No lap messages found in this FIT file.");
    return;
  }

  console.log("");
  console.log("Sections");

  for (const [index, lap] of laps.entries()) {
    const lapRecords = Array.isArray(lap.records) ? lap.records : [];
    const lapSummary = normalizeLap(lap, index);
    const lapFallback = buildStatsFromRecords(lapRecords);
    const normalizedLap = {
      ...lapSummary,
      ...mergeStats(lapSummary, {
        ...lapFallback,
        efficiency: calculateEfficiency(
          lapFallback?.avgPower,
          lapFallback?.avgHeartRate,
        ),
        heartRateDiffAfterOneMinute:
          heartRateDifferenceAfterOneMinute(lapRecords),
        heartRateDrift: calculateHalfDrift(lapRecords, "heart_rate"),
        powerDrift: calculateHalfDrift(lapRecords, "power"),
      }),
    };
    console.log("");
    printBlock(`  ${normalizedLap.label}`, normalizedLap, {
      includeHeartRateDiffAfterOneMinute: true,
      includeEfficiency: true,
    });
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
