export interface WorkoutStep {
  durationSeconds: number;
  zone: number;
}

export interface Workout {
  id: string;
  name: string;
  ftp: number;
  steps: WorkoutStep[];
}

export const POWER_ZONES = [
  { zone: 1, name: "Recovery", range: "≤55%", target: 0.5 },
  { zone: 2, name: "Endurance", range: "56–75%", target: 0.65 },
  { zone: 3, name: "Tempo", range: "76–90%", target: 0.83 },
  { zone: 4, name: "Threshold", range: "91–105%", target: 0.98 },
  { zone: 5, name: "VO₂ max", range: "106–120%", target: 1.13 },
  { zone: 6, name: "Anaerobic", range: "121–150%", target: 1.35 },
  { zone: 7, name: "Neuromuscular", range: ">150%", target: 1.6 },
];

const STORAGE_KEY = "fitfiles.workouts";

export function targetPower(ftp: number, zone: number): number {
  return Math.round(ftp * (POWER_ZONES.find((item) => item.zone === zone)?.target ?? 1));
}

export function loadWorkouts(): Workout[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function saveWorkouts(workouts: Workout[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
}
