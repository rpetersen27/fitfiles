import { calculateNormalizedHeartRate } from "./analysis.js";
import type { TrainingReading } from "./training-device.js";

export type SessionState = "stopped" | "running" | "paused";

export interface SessionRecord extends TrainingReading {
  timestamp: number;
  elapsedTime: number;
  timerTime: number;
  distance: number;
}

export interface SessionEvent {
  timestamp: number;
  type: "start" | "stop_all";
}

export interface RecordedSession {
  id: string;
  startedAt: number;
  stoppedAt: number;
  totalTimerTime: number;
  distance: number;
  records: SessionRecord[];
  events: SessionEvent[];
  sectionStarts: number[];
}

export interface LiveSessionStats {
  duration: number;
  speed: number | null;
  distance: number;
  averagePower: number | null;
  normalizedPower: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  normalizedHeartRate: number | null;
}

function average(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function calculateNormalizedPower(records: SessionRecord[]): number | null {
  const powers = records
    .map((record) => record.power)
    .filter((power): power is number => power != null);
  if (powers.length < 30) return null;
  let rollingSum = powers.slice(0, 30).reduce((sum, power) => sum + power, 0);
  let fourthPowerSum = (rollingSum / 30) ** 4;
  let windows = 1;
  for (let index = 30; index < powers.length; index += 1) {
    rollingSum += (powers[index] ?? 0) - (powers[index - 30] ?? 0);
    fourthPowerSum += (rollingSum / 30) ** 4;
    windows += 1;
  }
  return (fourthPowerSum / windows) ** 0.25;
}

function summarizeRecords(
  records: SessionRecord[],
  baseline: SessionRecord | undefined = records[0],
): LiveSessionStats {
  const first = records[0];
  const last = records.at(-1);
  const duration = first && last && baseline
    ? Math.max(0, last.timerTime - baseline.timerTime)
    : 0;
  const distance = first && last && baseline
    ? Math.max(0, last.distance - baseline.distance)
    : 0;
  const powers = records
    .map((record) => record.power)
    .filter((power): power is number => power != null);
  const heartRates = records
    .map((record) => record.heartRate)
    .filter((heartRate): heartRate is number => heartRate != null);
  return {
    duration,
    speed: duration > 0 ? (distance / duration) * 3.6 : null,
    distance,
    averagePower: average(powers),
    normalizedPower: calculateNormalizedPower(records),
    averageHeartRate: average(heartRates),
    maxHeartRate: heartRates.length > 0 ? Math.max(...heartRates) : null,
    normalizedHeartRate: calculateNormalizedHeartRate(
      heartRates.map((heartRate) => ({ heartRate, duration: 1 })),
    ),
  };
}

const RECORD_INTERVAL_MS = 1000;

export class SessionRecorder {
  state: SessionState = "stopped";
  private sessionId = "";
  private startedAt = 0;
  private activeStartedAt = 0;
  private activeBeforeCurrentRun = 0;
  private distance = 0;
  private records: SessionRecord[] = [];
  private events: SessionEvent[] = [];
  private sectionStarts: number[] = [];
  private timer: number | null = null;

  constructor(private readonly getReading: () => TrainingReading) {}

  start(): void {
    const now = Date.now();
    this.state = "running";
    this.sessionId = crypto.randomUUID();
    this.startedAt = now;
    this.activeStartedAt = now;
    this.activeBeforeCurrentRun = 0;
    this.distance = 0;
    this.records = [];
    this.events = [{ timestamp: now, type: "start" }];
    this.sectionStarts = [0];
    this.capture();
    // Polls faster than the record rate; tick() keeps records at least one second apart.
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  // Also called on incoming sensor data, which keeps recording going when a background
  // tab throttles timers.
  tick(timestamp = Date.now()): void {
    const previous = this.records.at(-1);
    if (previous && timestamp - previous.timestamp < RECORD_INTERVAL_MS) return;
    this.capture(timestamp);
  }

  pause(): void {
    if (this.state !== "running") return;
    const now = Date.now();
    this.capture(now);
    this.activeBeforeCurrentRun += now - this.activeStartedAt;
    this.events.push({ timestamp: now, type: "stop_all" });
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused") return;
    const now = Date.now();
    this.activeStartedAt = now;
    this.events.push({ timestamp: now, type: "start" });
    this.state = "running";
    this.capture(now);
  }

  nextSection(): void {
    if (this.state === "stopped") return;
    if (this.state === "running") this.capture();
    const nextIndex = this.records.length;
    if (nextIndex > (this.sectionStarts.at(-1) ?? -1)) this.sectionStarts.push(nextIndex);
  }

  stop(): RecordedSession | null {
    if (this.state === "stopped") return null;
    const now = Date.now();
    if (this.state === "running") {
      this.capture(now);
      this.activeBeforeCurrentRun += now - this.activeStartedAt;
    }
    this.events.push({ timestamp: now, type: "stop_all" });
    this.state = "stopped";
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;

    return {
      id: this.sessionId,
      startedAt: this.startedAt,
      stoppedAt: now,
      totalTimerTime: this.activeBeforeCurrentRun / 1000,
      distance: this.distance,
      records: [...this.records],
      events: [...this.events],
      sectionStarts: [...this.sectionStarts]
    };
  }

  // Session as if it were stopped at the last record; used for crash recovery checkpoints.
  snapshot(): RecordedSession | null {
    const last = this.records.at(-1);
    if (this.state === "stopped" || !last) return null;
    const events = this.events.filter((event) => event.timestamp <= last.timestamp);
    if (events.at(-1)?.type !== "stop_all") {
      events.push({ timestamp: last.timestamp, type: "stop_all" });
    }
    return {
      id: this.sessionId,
      startedAt: this.startedAt,
      stoppedAt: last.timestamp,
      totalTimerTime: last.timerTime,
      distance: this.distance,
      records: [...this.records],
      events,
      sectionStarts: [...this.sectionStarts]
    };
  }

  reset(): void {
    if (this.state !== "stopped") return;
    this.startedAt = 0;
    this.activeStartedAt = 0;
    this.activeBeforeCurrentRun = 0;
    this.distance = 0;
    this.records = [];
    this.events = [];
    this.sectionStarts = [];
  }

  get elapsedSeconds(): number {
    return this.state === "stopped" ? 0 : (Date.now() - this.startedAt) / 1000;
  }

  get timerSeconds(): number {
    if (this.state === "stopped") return 0;
    const current = this.state === "running" ? Date.now() - this.activeStartedAt : 0;
    return (this.activeBeforeCurrentRun + current) / 1000;
  }

  get sectionNumber(): number {
    return this.sectionStarts.length;
  }

  get overallStats(): LiveSessionStats {
    return summarizeRecords(this.records);
  }

  get currentSectionStats(): LiveSessionStats {
    const startIndex = this.sectionStarts.at(-1) ?? 0;
    return summarizeRecords(
      this.records.slice(startIndex),
      startIndex > 0 ? this.records[startIndex - 1] : this.records[0],
    );
  }

  private capture(timestamp = Date.now()): void {
    if (this.state !== "running") return;
    const timerTime = (this.activeBeforeCurrentRun + timestamp - this.activeStartedAt) / 1000;
    const previous = this.records.at(-1);
    const reading = this.getReading();
    if (previous && reading.speed != null) {
      this.distance += (reading.speed / 3.6) * Math.max(0, timerTime - previous.timerTime);
    }
    this.records.push({
      ...reading,
      timestamp,
      elapsedTime: (timestamp - this.startedAt) / 1000,
      timerTime,
      distance: this.distance
    });
  }
}
