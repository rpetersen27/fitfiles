export type NumericField =
  | "heart_rate"
  | "power"
  | "speed"
  | "distance"
  | "elapsed_time"
  | "timer_time";

export interface MessageIndexValue {
  value: number;
}

export interface FitRecord {
  heart_rate?: number;
  power?: number;
  speed?: number;
  distance?: number;
  elapsed_time?: number;
  timer_time?: number;
}

export interface FitSession {
  total_elapsed_time?: number;
  total_timer_time?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  total_distance?: number;
  avg_speed?: number;
  enhanced_avg_speed?: number;
  avg_power?: number;
  max_power?: number;
  normalized_power?: number;
}

export interface FitLap extends FitSession {
  message_index?: number | MessageIndexValue;
  start_time?: string;
  records?: FitRecord[];
}

export interface FitParseResult {
  sessions?: FitSession[];
  laps?: FitLap[];
  records?: FitRecord[];
}

export interface Stats {
  totalElapsedTime: number | null;
  totalTimerTime: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  normalizedHeartRate: number | null;
  totalDistance: number | null;
  avgSpeed: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  heartRateDiffAfterOneMinute: number | null;
  efficiency: number | null;
  heartRateDrift: number | null;
  powerDrift: number | null;
}

export interface LapStats extends Stats {
  label: string;
  startTime: string | null;
}

export interface AnalysisResult {
  overall: Stats;
  sections: LapStats[];
}
