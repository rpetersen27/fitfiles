// Virtual riding speed from power, so indoor distance compares to outdoor rides.
//
//   m · dv/dt = P · η / v − m · g · (Crr · cos θ + sin θ) − ½ · ρ · CdA · v²
//
// CdA is calibrated from one reference ride (power ↔ speed on flat road).

export interface SpeedModelSettings {
  riderMass: number;
  bikeMass: number;
  referencePower: number;
  referenceSpeed: number;
}

export interface SpeedModelInput {
  power?: number | undefined;
  cadence?: number | undefined;
  sensorSpeed?: number | undefined;
}

export const DEFAULT_SPEED_MODEL: SpeedModelSettings = {
  riderMass: 77,
  bikeMass: 8,
  referencePower: 170,
  referenceSpeed: 30.5,
};

const DRIVETRAIN_EFFICIENCY = 0.975;
const GRAVITY = 9.81;
const ROLLING_RESISTANCE = 0.004;
const AIR_DENSITY = 1.225;
const FALLBACK_CDA = 0.37;
const MIN_CDA = 0.1;
// Keeps P / v finite when starting from standstill.
const MIN_DRIVE_SPEED = 1;
const STEP_SECONDS = 0.1;
const MAX_ELAPSED_SECONDS = 60;
// Without a flywheel speed signal, no pedalling for this long means the flywheel stopped.
const STOP_WITHOUT_PEDALLING_MS = 5_000;

export function systemMass(settings: SpeedModelSettings): number {
  return settings.riderMass + settings.bikeMass;
}

// Solves the steady-state equation (dv/dt = 0, θ = 0) for CdA.
export function calibrateCdA(settings: SpeedModelSettings): number {
  const speed = settings.referenceSpeed / 3.6;
  if (!(speed > 0) || !(settings.referencePower > 0)) return FALLBACK_CDA;
  const drivingForce = (settings.referencePower * DRIVETRAIN_EFFICIENCY) / speed;
  const rollingForce = systemMass(settings) * GRAVITY * ROLLING_RESISTANCE;
  const cda = (drivingForce - rollingForce) / (0.5 * AIR_DENSITY * speed ** 2);
  return Number.isFinite(cda) ? Math.max(MIN_CDA, cda) : FALLBACK_CDA;
}

export class VirtualSpeed {
  // Road gradient as rise over run; stays 0 until routes can be ridden.
  grade = 0;
  private speed = 0;
  private lastUpdate: number | null = null;
  private lastPedallingAt = 0;

  constructor(private readonly getSettings: () => SpeedModelSettings) {}

  // Advances the model to `timestamp` and returns the speed in km/h, or null when no power
  // data is available and the sensor speed should be used instead.
  update(input: SpeedModelInput, timestamp = Date.now()): number | null {
    const elapsed =
      this.lastUpdate == null
        ? 0
        : Math.min(MAX_ELAPSED_SECONDS, Math.max(0, (timestamp - this.lastUpdate) / 1000));
    this.lastUpdate = timestamp;

    const power = Math.max(0, input.power ?? 0);
    if (power > 0 || (input.cadence ?? 0) > 0) this.lastPedallingAt = timestamp;

    if (input.power == null && this.speed === 0) return null;

    this.integrate(power, elapsed);

    const flywheelStopped =
      input.sensorSpeed != null
        ? input.sensorSpeed <= 0
        : timestamp - this.lastPedallingAt >= STOP_WITHOUT_PEDALLING_MS;
    if (flywheelStopped) this.speed = 0;

    return this.speed * 3.6;
  }

  reset(): void {
    this.speed = 0;
    this.lastUpdate = null;
    this.lastPedallingAt = 0;
  }

  private integrate(power: number, seconds: number): void {
    const settings = this.getSettings();
    const mass = systemMass(settings);
    const cda = calibrateCdA(settings);
    const angle = Math.atan(this.grade);
    const gravityForce =
      mass * GRAVITY * (ROLLING_RESISTANCE * Math.cos(angle) + Math.sin(angle));

    for (let remaining = seconds; remaining > 0; remaining -= STEP_SECONDS) {
      const step = Math.min(STEP_SECONDS, remaining);
      const drivingForce =
        (power * DRIVETRAIN_EFFICIENCY) / Math.max(this.speed, MIN_DRIVE_SPEED);
      const dragForce = 0.5 * AIR_DENSITY * cda * this.speed ** 2;
      const acceleration = (drivingForce - gravityForce - dragForce) / mass;
      this.speed = Math.max(0, this.speed + acceleration * step);
    }
  }
}
