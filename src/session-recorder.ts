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

export class SessionRecorder {
  state: SessionState = "stopped";
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
    this.startedAt = now;
    this.activeStartedAt = now;
    this.activeBeforeCurrentRun = 0;
    this.distance = 0;
    this.records = [];
    this.events = [{ timestamp: now, type: "start" }];
    this.sectionStarts = [0];
    this.capture();
    this.timer = window.setInterval(() => this.capture(), 1000);
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
      id: crypto.randomUUID(),
      startedAt: this.startedAt,
      stoppedAt: now,
      totalTimerTime: this.activeBeforeCurrentRun / 1000,
      distance: this.distance,
      records: [...this.records],
      events: [...this.events],
      sectionStarts: [...this.sectionStarts]
    };
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
