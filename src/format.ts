export function formatDuration(seconds: number | null | undefined): string {
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

export function formatNumber(
  value: number | null | undefined,
  digits = 1
): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toFixed(digits);
}

export function formatMeters(distanceMeters: number | null | undefined): string {
  if (distanceMeters == null || Number.isNaN(distanceMeters)) {
    return "-";
  }

  return `${formatNumber(distanceMeters / 1000, 2)} km`;
}

export function formatSpeed(
  speedMetersPerSecond: number | null | undefined
): string {
  if (speedMetersPerSecond == null || Number.isNaN(speedMetersPerSecond)) {
    return "-";
  }

  return `${formatNumber(speedMetersPerSecond * 3.6, 2)} km/h`;
}

export function formatHeartRate(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value)} bpm`;
}

export function formatPower(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${Math.round(value)} W`;
}

export function formatHeartRateDifference(
  value: number | null | undefined
): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} bpm`;
}

export function formatEfficiency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return `${formatNumber(value, 2)} W/BPM`;
}

export function formatDrift(
  value: number | null | undefined,
  unit: string
): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} ${unit}`;
}
