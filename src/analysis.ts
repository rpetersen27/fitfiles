import type {
  AnalysisResult,
  FitLap,
  FitParseResult,
  FitRecord,
  FitSession,
  LapStats,
  MessageIndexValue,
  NumericField,
  Stats
} from "./types.js";

function unwrapFitValue(
  value: number | MessageIndexValue | null | undefined
): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "object" && "value" in value) {
    return value.value;
  }

  return value;
}

function emptyStats(): Stats {
  return {
    totalElapsedTime: null,
    totalTimerTime: null,
    avgHeartRate: null,
    maxHeartRate: null,
    totalDistance: null,
    avgSpeed: null,
    avgPower: null,
    maxPower: null,
    heartRateDiffAfterOneMinute: null,
    efficiency: null,
    heartRateDrift: null,
    powerDrift: null
  };
}

function weightedAverage<T, K extends keyof T, W extends keyof T>(
  parts: T[],
  fieldName: K,
  weightFieldName: W
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const part of parts) {
    const value = part[fieldName];
    const weight = part[weightFieldName];

    if (
      typeof value !== "number" ||
      typeof weight !== "number" ||
      Number.isNaN(value) ||
      Number.isNaN(weight) ||
      weight <= 0
    ) {
      continue;
    }

    totalWeight += weight;
    weightedSum += value * weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function maxValue<T, K extends keyof T>(parts: T[], fieldName: K): number | null {
  const values: number[] = [];

  for (const part of parts) {
    const value = part[fieldName];

    if (typeof value === "number" && !Number.isNaN(value)) {
      values.push(value);
    }
  }

  return values.length > 0 ? Math.max(...values) : null;
}

function sumValue<T, K extends keyof T>(parts: T[], fieldName: K): number | null {
  const values: number[] = [];

  for (const part of parts) {
    const value = part[fieldName];

    if (typeof value === "number" && !Number.isNaN(value)) {
      values.push(value);
    }
  }

  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function averageValue(
  records: FitRecord[],
  fieldName: NumericField,
  durationFieldName: "timer_time" | "elapsed_time"
): number | null {
  if (records.length === 0) {
    return null;
  }

  let weightedSum = 0;
  let totalDuration = 0;
  let fallbackSum = 0;
  let fallbackCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    const next = records[index + 1];

    if (!current) {
      continue;
    }

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

  return fallbackCount > 0 ? fallbackSum / fallbackCount : null;
}

function calculateEfficiency(
  avgPower: number | null | undefined,
  avgHeartRate: number | null | undefined
): number | null {
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

function buildStatsFromRecords(records: FitRecord[]): Stats | null {
  if (records.length === 0) {
    return null;
  }

  const first = records[0];
  const last = records.at(-1);

  if (!first || !last) {
    return null;
  }

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
    endDistance != null ? Math.max(0, endDistance - startDistance) : null;

  return {
    ...emptyStats(),
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
    maxPower: maxValue(records, "power")
  };
}

function heartRateDifferenceAfterOneMinute(records: FitRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }

  const startRecord = records.find(
    (record) => record.heart_rate != null && !Number.isNaN(record.heart_rate)
  );

  if (
    !startRecord ||
    startRecord.timer_time == null ||
    Number.isNaN(startRecord.timer_time) ||
    startRecord.heart_rate == null
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
      !Number.isNaN(record.heart_rate)
  );

  return oneMinuteRecord?.heart_rate != null
    ? oneMinuteRecord.heart_rate - startRecord.heart_rate
    : null;
}

function averageOverRange(
  records: FitRecord[],
  fieldName: NumericField,
  startTime: number | null | undefined,
  endTime: number | null | undefined
): number | null {
  if (
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

    if (!current || !next) {
      continue;
    }

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

  return totalDuration > 0 ? weightedSum / totalDuration : null;
}

function calculateHalfDrift(
  records: FitRecord[],
  fieldName: NumericField
): number | null {
  if (records.length < 2) {
    return null;
  }

  const validTimes = records
    .map((record) => record.timer_time)
    .filter((value): value is number => value != null && !Number.isNaN(value));

  if (validTimes.length < 2) {
    return null;
  }

  const startTime = validTimes[0];
  const endTime = validTimes.at(-1);

  if (startTime == null || endTime == null) {
    return null;
  }

  const midpoint = startTime + (endTime - startTime) / 2;
  if (midpoint <= startTime || midpoint >= endTime) {
    return null;
  }

  const firstHalfAverage = averageOverRange(records, fieldName, startTime, midpoint);
  const secondHalfAverage = averageOverRange(records, fieldName, midpoint, endTime);

  return firstHalfAverage != null && secondHalfAverage != null
    ? secondHalfAverage - firstHalfAverage
    : null;
}

function mergeStats(primary: Stats | null, fallback: Stats | null): Stats | null {
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
      primary.heartRateDiffAfterOneMinute ?? fallback.heartRateDiffAfterOneMinute,
    efficiency: primary.efficiency ?? fallback.efficiency,
    heartRateDrift: primary.heartRateDrift ?? fallback.heartRateDrift,
    powerDrift: primary.powerDrift ?? fallback.powerDrift
  };
}

function normalizeSession(session: FitSession): Stats {
  return {
    ...emptyStats(),
    totalElapsedTime: session.total_elapsed_time ?? null,
    totalTimerTime: session.total_timer_time ?? null,
    avgHeartRate: session.avg_heart_rate ?? null,
    maxHeartRate: session.max_heart_rate ?? null,
    totalDistance: session.total_distance ?? null,
    avgSpeed: session.avg_speed ?? session.enhanced_avg_speed ?? null,
    avgPower: session.avg_power ?? null,
    maxPower: session.max_power ?? null
  };
}

function normalizeLap(lap: FitLap, index: number): LapStats {
  const lapIndex = unwrapFitValue(lap.message_index);
  const labelIndex = lapIndex != null ? lapIndex + 1 : index + 1;

  return {
    ...emptyStats(),
    label: `Lap ${labelIndex}`,
    startTime: lap.start_time ?? null,
    totalElapsedTime: lap.total_elapsed_time ?? null,
    totalTimerTime: lap.total_timer_time ?? null,
    avgHeartRate: lap.avg_heart_rate ?? null,
    maxHeartRate: lap.max_heart_rate ?? null,
    totalDistance: lap.total_distance ?? null,
    avgSpeed: lap.avg_speed ?? lap.enhanced_avg_speed ?? null,
    avgPower: lap.avg_power ?? null,
    maxPower: lap.max_power ?? null,
    efficiency: calculateEfficiency(lap.avg_power ?? null, lap.avg_heart_rate ?? null)
  };
}

function summarizeSessions(sessions: FitSession[]): Stats | null {
  if (sessions.length === 0) {
    return null;
  }

  if (sessions.length === 1) {
    const [session] = sessions;
    return session ? normalizeSession(session) : null;
  }

  return {
    ...emptyStats(),
    totalElapsedTime: sumValue(sessions, "total_elapsed_time"),
    totalTimerTime: sumValue(sessions, "total_timer_time"),
    avgHeartRate: weightedAverage(sessions, "avg_heart_rate", "total_timer_time"),
    maxHeartRate: maxValue(sessions, "max_heart_rate"),
    totalDistance: sumValue(sessions, "total_distance"),
    avgSpeed: weightedAverage(
      sessions.map((session) => ({
        avg_speed: session.avg_speed ?? session.enhanced_avg_speed ?? null,
        total_timer_time: session.total_timer_time ?? null
      })),
      "avg_speed",
      "total_timer_time"
    ),
    avgPower: weightedAverage(sessions, "avg_power", "total_timer_time"),
    maxPower: maxValue(sessions, "max_power")
  };
}

export function analyzeFitData(parsed: FitParseResult): AnalysisResult {
  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const laps = Array.isArray(parsed.laps) ? parsed.laps : [];
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const overall = mergeStats(summarizeSessions(sessions), buildStatsFromRecords(records));

  if (!overall) {
    throw new Error("The FIT file did not contain any session summary data.");
  }

  const sections = laps.map((lap, index) => {
    const lapRecords = Array.isArray(lap.records) ? lap.records : [];
    const lapSummary = normalizeLap(lap, index);
    const lapFallback = buildStatsFromRecords(lapRecords);
    const mergedLapStats =
      mergeStats(lapSummary, {
        ...(lapFallback ?? emptyStats()),
        efficiency: calculateEfficiency(lapFallback?.avgPower, lapFallback?.avgHeartRate),
        heartRateDiffAfterOneMinute: heartRateDifferenceAfterOneMinute(lapRecords),
        heartRateDrift: calculateHalfDrift(lapRecords, "heart_rate"),
        powerDrift: calculateHalfDrift(lapRecords, "power")
      }) ?? lapSummary;

    return {
      ...lapSummary,
      ...mergedLapStats
    };
  });

  return { overall, sections };
}
