import { analyzeFitData } from "./analysis.js";
import {
  deleteActivity,
  listActivities,
  saveActivity,
  saveActivityIfNew,
  type StoredActivity,
} from "./activity-store.js";
import {
  formatDrift,
  formatDuration,
  formatEfficiency,
  formatHeartRate,
  formatHeartRateDifference,
  formatMeters,
  formatPower,
  formatSpeed,
} from "./format.js";
import { parseFit } from "./fit.js";
import { createFitFile } from "./fit-writer.js";
import {
  SessionRecorder,
  type LiveSessionStats,
} from "./session-recorder.js";
import {
  TrainingBluetoothDevice,
  type TrainingMetric,
  type TrainingReading,
} from "./training-device.js";
import "./styles.css";
import type { AnalysisResult, Stats } from "./types.js";
import {
  POWER_ZONES,
  loadWorkouts,
  saveWorkouts,
  targetPower,
  type Workout,
  type WorkoutStep,
} from "./workouts.js";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root.");
}

app.innerHTML = `
  <header class="site-header">
    <div class="nav-shell">
      <a class="brand" href="#analysis" aria-label="FIT Files home">FIT Files</a>
      <nav class="main-nav" aria-label="Main navigation">
        <a class="nav-link" href="#analysis" data-view-link="analysis">Analysis</a>
        <a class="nav-link" href="#training" data-view-link="training">Training</a>
      </nav>
    </div>
  </header>
  <main class="page">
    <section id="analysis-view" class="view" data-view="analysis">
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
      <section class="panel activity-history analysis-history">
        <div><p class="eyebrow">Saved files</p><h2>FIT file library</h2></div>
        <div id="analysis-activity-list" class="activity-list"><p class="empty-devices">No saved FIT files yet.</p></div>
      </section>
    </section>
    <section id="training-view" class="view hidden" data-view="training">
      <section class="hero training-hero">
        <p class="eyebrow">Live training</p>
        <h1>Bring your sensors into one training view.</h1>
        <p class="intro">
          Connect your cycling sensors, follow live data, and record a training session.
          Pair Bluetooth cycling sensors and see their measurements as you ride.
        </p>
      </section>
      <section class="device-setup panel">
        <div>
          <p class="eyebrow">Bluetooth devices</p>
          <h2>Connect your training sensors.</h2>
          <p id="bluetooth-status" class="status" role="status">Choose a device to discover its live data.</p>
        </div>
        <button id="bluetooth-connect" class="connect-device-button" type="button">Connect Bluetooth sensor</button>
        <div id="connected-devices" class="connected-devices">
          <p class="empty-devices">No devices connected.</p>
        </div>
      </section>
      <section class="sensor-grid" aria-label="Supported training sensors">
        <article class="sensor-card heart-rate-card">
          <span class="sensor-icon" aria-hidden="true">♥</span>
          <div class="sensor-copy">
            <h2>Heart rate</h2>
            <p>Live heart-rate measurement</p>
          </div>
          <div id="heart-rate-reading" class="live-reading" aria-live="polite">
            <strong>--</strong><span>bpm</span>
          </div>
        </article>
        <article class="sensor-card">
          <span class="sensor-icon" aria-hidden="true">↻</span>
          <div class="sensor-copy"><h2>Cadence</h2><p>Live pedaling rate</p></div>
          <div class="live-reading"><strong id="cadence-reading">--</strong><span>rpm</span></div>
        </article>
        <article class="sensor-card power-card">
          <span class="sensor-icon" aria-hidden="true">W</span>
          <div class="sensor-copy"><h2>Power</h2><p>Live / 3s / 10s output</p></div>
          <div class="power-readings" aria-live="polite">
            <div><strong id="power-live">--</strong><span>Live</span></div>
            <div class="primary"><strong id="power-3s">--</strong><span>3s</span></div>
            <div><strong id="power-10s">--</strong><span>10s</span></div>
            <span class="power-unit">W</span>
          </div>
        </article>
        <article class="sensor-card">
          <span class="sensor-icon" aria-hidden="true">›</span>
          <div class="sensor-copy"><h2>Speed</h2><p>Live riding speed</p></div>
          <div class="live-reading"><strong id="speed-reading">--</strong><span>km/h</span></div>
        </article>
      </section>
      <section id="workout-builder" class="panel workout-builder">
        <div class="workout-title-row">
          <div><p class="eyebrow">Structured training</p><h2>Training plan</h2></div>
          <div class="workout-selection-actions">
            <select id="workout-selection" aria-label="Selected training"><option value="">Free ride</option></select>
            <button id="workout-edit" class="disconnect-device-button" type="button" disabled>Edit</button>
            <button id="workout-delete" class="disconnect-device-button danger" type="button" disabled>Delete</button>
          </div>
        </div>
        <div id="workout-summary" class="workout-summary">Ride without a predefined interval plan.</div>
        <details id="workout-editor">
          <summary id="workout-editor-title">Create a training</summary>
          <div class="workout-form">
            <label>Name <input id="workout-name" type="text" value="My training" /></label>
            <label>FTP <span><input id="workout-ftp" type="number" min="50" max="600" value="250" /> W</span></label>
            <div id="workout-steps" class="workout-steps"></div>
            <div class="workout-total"><span>Total time</span><output id="workout-total-duration">05:00</output></div>
            <div class="session-controls">
              <button id="workout-add-step" class="disconnect-device-button" type="button">Add interval</button>
              <button id="workout-save" class="connect-device-button compact" type="button">Save training</button>
              <button id="workout-cancel" class="disconnect-device-button hidden" type="button">Cancel editing</button>
            </div>
          </div>
        </details>
      </section>
      <article id="training-session" class="panel training-placeholder">
        <p class="eyebrow">Session setup</p>
        <div class="session-heading">
          <div>
            <h2 id="session-title">Training session: Free ride</h2>
            <p id="session-state" class="status">Ready to start.</p>
          </div>
          <div class="session-clock"><strong id="session-timer">00:00:00</strong><span id="session-section">Section 1</span></div>
        </div>
        <div id="workout-guidance" class="workout-guidance hidden">
          <div class="workout-progress">
            <div id="workout-progress-fill" class="workout-progress-fill"></div>
            <div class="workout-guidance-content"><span id="workout-current-section"></span><strong id="workout-current-target"></strong></div>
          </div>
          <div id="workout-upcoming" class="workout-upcoming"></div>
        </div>
        <div class="session-controls">
          <button id="session-start" class="connect-device-button" type="button">Start</button>
          <button id="session-pause" class="connect-device-button hidden" type="button">Pause</button>
          <button id="session-resume" class="connect-device-button hidden" type="button">Resume</button>
          <button id="session-next" class="disconnect-device-button hidden" type="button">Next lap</button>
          <button id="session-stop" class="disconnect-device-button danger hidden" type="button">Stop</button>
        </div>
        <div class="session-stats-grid">
          <section class="session-stats">
            <header><h3>Whole training</h3><span id="overall-stats-duration">00:00:00</span></header>
            <dl id="overall-session-stats" class="metrics compact-metrics"></dl>
          </section>
          <section class="session-stats">
            <header><h3>Current lap</h3><span id="section-stats-duration">00:00:00</span></header>
            <dl id="section-session-stats" class="metrics compact-metrics"></dl>
          </section>
        </div>
        <label class="wheel-setting" for="wheel-circumference">
          <span>Wheel circumference</span>
          <span><input id="wheel-circumference" type="number" min="1000" max="3000" step="1" value="2105" /> mm</span>
        </label>
      </article>
      <section class="panel activity-history">
        <div>
          <p class="eyebrow">Saved sessions</p>
          <h2>FIT files</h2>
        </div>
        <div id="activity-list" class="activity-list"><p class="empty-devices">No saved sessions yet.</p></div>
      </section>
    </section>
  </main>
  <div id="section-countdown" class="section-countdown hidden" aria-label="Next section countdown" aria-live="assertive"><strong>10</strong></div>
  <dialog id="training-finished-dialog" class="training-finished-dialog">
    <p class="eyebrow">Training finished</p>
    <h2>Great work!</h2>
    <p>Would you like to finish and save this session, or continue riding without a power target?</p>
    <div class="session-controls">
      <button id="training-finish-save" class="connect-device-button" type="button">Finish and save</button>
      <button id="training-continue" class="disconnect-device-button" type="button">Continue riding</button>
    </div>
  </dialog>
`;

const trainingSessionPanel = document.querySelector<HTMLElement>("#training-session");
const workoutBuilderPanel = document.querySelector<HTMLElement>("#workout-builder");
if (trainingSessionPanel && workoutBuilderPanel) {
  trainingSessionPanel.insertAdjacentElement("afterend", workoutBuilderPanel);
}

const fileInputElement = document.querySelector<HTMLInputElement>("#fit-file");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const resultsElement = document.querySelector<HTMLElement>("#results");
const views = Array.from(document.querySelectorAll<HTMLElement>("[data-view]"));
const viewLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>("[data-view-link]"),
);
const heartRateReading = document.querySelector<HTMLElement>(
  "#heart-rate-reading strong",
);
const cadenceReading = document.querySelector<HTMLElement>("#cadence-reading");
const powerLiveReading = document.querySelector<HTMLElement>("#power-live");
const power3SecondReading = document.querySelector<HTMLElement>("#power-3s");
const power10SecondReading = document.querySelector<HTMLElement>("#power-10s");
const speedReading = document.querySelector<HTMLElement>("#speed-reading");
const wheelCircumference = document.querySelector<HTMLInputElement>(
  "#wheel-circumference",
);
const bluetoothButton =
  document.querySelector<HTMLButtonElement>("#bluetooth-connect");
const bluetoothStatus =
  document.querySelector<HTMLElement>("#bluetooth-status");
const connectedDevices =
  document.querySelector<HTMLElement>("#connected-devices");
const sessionStateText = document.querySelector<HTMLElement>("#session-state");
const sessionTitle = document.querySelector<HTMLElement>("#session-title");
const sessionTimer = document.querySelector<HTMLElement>("#session-timer");
const sessionSection = document.querySelector<HTMLElement>("#session-section");
const sessionStart =
  document.querySelector<HTMLButtonElement>("#session-start");
const sessionPause =
  document.querySelector<HTMLButtonElement>("#session-pause");
const sessionResume =
  document.querySelector<HTMLButtonElement>("#session-resume");
const sessionNext = document.querySelector<HTMLButtonElement>("#session-next");
const sessionStop = document.querySelector<HTMLButtonElement>("#session-stop");
const activityList = document.querySelector<HTMLElement>("#activity-list");
const analysisActivityList = document.querySelector<HTMLElement>(
  "#analysis-activity-list",
);
const overallSessionStats = document.querySelector<HTMLElement>(
  "#overall-session-stats",
);
const sectionSessionStats = document.querySelector<HTMLElement>(
  "#section-session-stats",
);
const overallStatsDuration = document.querySelector<HTMLElement>(
  "#overall-stats-duration",
);
const sectionStatsDuration = document.querySelector<HTMLElement>(
  "#section-stats-duration",
);
const workoutSelection = document.querySelector<HTMLSelectElement>("#workout-selection");
const workoutName = document.querySelector<HTMLInputElement>("#workout-name");
const workoutFtp = document.querySelector<HTMLInputElement>("#workout-ftp");
const workoutSteps = document.querySelector<HTMLElement>("#workout-steps");
const workoutTotalDuration = document.querySelector<HTMLOutputElement>("#workout-total-duration");
const workoutSummary = document.querySelector<HTMLElement>("#workout-summary");
const workoutEditor = document.querySelector<HTMLDetailsElement>("#workout-editor");
const workoutEditorTitle = document.querySelector<HTMLElement>("#workout-editor-title");
const workoutAddStep = document.querySelector<HTMLButtonElement>("#workout-add-step");
const workoutSave = document.querySelector<HTMLButtonElement>("#workout-save");
const workoutCancel = document.querySelector<HTMLButtonElement>("#workout-cancel");
const workoutEdit = document.querySelector<HTMLButtonElement>("#workout-edit");
const workoutDelete = document.querySelector<HTMLButtonElement>("#workout-delete");
const workoutGuidance = document.querySelector<HTMLElement>("#workout-guidance");
const workoutProgressFill = document.querySelector<HTMLElement>("#workout-progress-fill");
const workoutCurrentSection = document.querySelector<HTMLElement>("#workout-current-section");
const workoutCurrentTarget = document.querySelector<HTMLElement>("#workout-current-target");
const workoutUpcoming = document.querySelector<HTMLElement>("#workout-upcoming");
const sectionCountdown = document.querySelector<HTMLElement>("#section-countdown");
const sectionCountdownValue = sectionCountdown?.querySelector<HTMLElement>("strong");
const trainingFinishedDialog = document.querySelector<HTMLDialogElement>("#training-finished-dialog");
const trainingFinishSave = document.querySelector<HTMLButtonElement>("#training-finish-save");
const trainingContinue = document.querySelector<HTMLButtonElement>("#training-continue");

if (
  !fileInputElement ||
  !statusElement ||
  !resultsElement ||
  !heartRateReading ||
  !cadenceReading ||
  !powerLiveReading ||
  !power3SecondReading ||
  !power10SecondReading ||
  !speedReading ||
  !wheelCircumference ||
  !bluetoothButton ||
  !bluetoothStatus ||
  !connectedDevices ||
  !sessionStateText ||
  !sessionTitle ||
  !sessionTimer ||
  !sessionSection ||
  !sessionStart ||
  !sessionPause ||
  !sessionResume ||
  !sessionNext ||
  !sessionStop ||
  !activityList ||
  !analysisActivityList ||
  !overallSessionStats ||
  !sectionSessionStats ||
  !overallStatsDuration ||
  !sectionStatsDuration
  || !workoutSelection || !workoutName || !workoutFtp || !workoutSteps ||
  !workoutTotalDuration || !workoutSummary || !workoutEditor || !workoutEditorTitle ||
  !workoutAddStep || !workoutSave || !workoutCancel || !workoutEdit || !workoutDelete || !workoutGuidance ||
  !workoutProgressFill || !workoutCurrentSection || !workoutCurrentTarget || !workoutUpcoming ||
  !sectionCountdown || !sectionCountdownValue ||
  !trainingFinishedDialog || !trainingFinishSave || !trainingContinue
) {
  throw new Error("Missing required UI elements.");
}

const fileInput = fileInputElement;
const status = statusElement;
const results = resultsElement;
const heartRateValue = heartRateReading;
const cadenceValue = cadenceReading;
const powerLiveValue = powerLiveReading;
const power3SecondValue = power3SecondReading;
const power10SecondValue = power10SecondReading;
const speedValue = speedReading;
const wheelCircumferenceInput = wheelCircumference;
const bluetoothConnectButton = bluetoothButton;
const bluetoothStatusText = bluetoothStatus;
const connectedDevicesList = connectedDevices;
const sessionStateLabel = sessionStateText;
const sessionTitleLabel = sessionTitle;
const sessionTimerLabel = sessionTimer;
const sessionSectionLabel = sessionSection;
const sessionStartButton = sessionStart;
const sessionPauseButton = sessionPause;
const sessionResumeButton = sessionResume;
const sessionNextButton = sessionNext;
const sessionStopButton = sessionStop;
const activityListElement = activityList;
const analysisActivityListElement = analysisActivityList;
const overallSessionStatsElement = overallSessionStats;
const sectionSessionStatsElement = sectionSessionStats;
const overallStatsDurationLabel = overallStatsDuration;
const sectionStatsDurationLabel = sectionStatsDuration;
const workoutSelect = workoutSelection;
const workoutNameInput = workoutName;
const workoutFtpInput = workoutFtp;
const workoutStepsElement = workoutSteps;
const workoutTotalDurationOutput = workoutTotalDuration;
const workoutSummaryElement = workoutSummary;
const workoutEditorElement = workoutEditor;
const workoutEditorTitleElement = workoutEditorTitle;
const workoutAddStepButton = workoutAddStep;
const workoutSaveButton = workoutSave;
const workoutCancelButton = workoutCancel;
const workoutEditButton = workoutEdit;
const workoutDeleteButton = workoutDelete;
const workoutGuidanceElement = workoutGuidance;
const workoutProgressFillElement = workoutProgressFill;
const workoutCurrentSectionElement = workoutCurrentSection;
const workoutCurrentTargetElement = workoutCurrentTarget;
const workoutUpcomingElement = workoutUpcoming;
const countdownOverlay = sectionCountdown;
const countdownValue = sectionCountdownValue;
const finishedDialog = trainingFinishedDialog;
const finishAndSaveButton = trainingFinishSave;
const continueRidingButton = trainingContinue;
const devices = new Map<string, TrainingBluetoothDevice>();
const deviceCapabilities = new Map<string, Set<TrainingMetric>>();
const connectingDevices = new Set<string>();
const deviceReadings = new Map<
  string,
  Partial<Record<TrainingMetric, { value: number; sequence: number }>>
>();
const powerSamplesByDevice = new Map<string, Array<{ timestamp: number; value: number }>>();
let readingSequence = 0;
const ACTIVE_DEVICES_KEY = "fitfiles.activeBluetoothDevices";
const BLUETOOTH_LOG_PREFIX = "[FIT Bluetooth]";

interface RememberedDevice {
  id: string;
  name: string | null;
}

function loadRememberedDevices(): Map<string, RememberedDevice> {
  try {
    const stored = JSON.parse(localStorage.getItem(ACTIVE_DEVICES_KEY) ?? "[]");
    const remembered = new Map<string, RememberedDevice>();
    if (Array.isArray(stored)) {
      for (const item of stored) {
        if (typeof item === "string")
          remembered.set(item, { id: item, name: null });
        else if (item && typeof item.id === "string") {
          remembered.set(item.id, {
            id: item.id,
            name: typeof item.name === "string" ? item.name : null,
          });
        }
      }
    }
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Loaded remembered devices",
      Array.from(remembered.values()),
    );
    return remembered;
  } catch (error) {
    console.error(
      BLUETOOTH_LOG_PREFIX,
      "Could not read remembered devices",
      error,
    );
    return new Map();
  }
}

const rememberedDevices = loadRememberedDevices();

function saveRememberedDevices(): void {
  try {
    localStorage.setItem(
      ACTIVE_DEVICES_KEY,
      JSON.stringify(Array.from(rememberedDevices.values())),
    );
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Saved remembered devices",
      Array.from(rememberedDevices.values()),
    );
  } catch (error) {
    console.error(
      BLUETOOTH_LOG_PREFIX,
      "Could not save active device IDs",
      error,
    );
    // Bluetooth still works when storage is unavailable; only auto-reconnect is lost.
  }
}

function getWheelCircumferenceMeters(): number {
  const millimeters = wheelCircumferenceInput.valueAsNumber;
  return Number.isFinite(millimeters) && millimeters > 0
    ? millimeters / 1000
    : 2.105;
}

const metricLabels: Record<TrainingMetric, string> = {
  heartRate: "Heart rate",
  cadence: "Cadence",
  power: "Power",
  speed: "Speed",
};

function getLatestReadings(): TrainingReading {
  const latest = new Map<TrainingMetric, { value: number; sequence: number }>();
  for (const readings of deviceReadings.values()) {
    for (const metric of Object.keys(readings) as TrainingMetric[]) {
      const candidate = readings[metric];
      const current = latest.get(metric);
      if (candidate && (!current || candidate.sequence > current.sequence)) {
        latest.set(metric, candidate);
      }
    }
  }

  const reading: TrainingReading = {};
  const heartRate = latest.get("heartRate");
  const cadence = latest.get("cadence");
  const power = latest.get("power");
  const speed = latest.get("speed");
  if (heartRate) reading.heartRate = heartRate.value;
  if (cadence) reading.cadence = cadence.value;
  if (power) reading.power = power.value;
  if (speed) reading.speed = speed.value;
  return reading;
}

function latestPowerDeviceId(): string | null {
  let latest: { id: string; sequence: number } | null = null;
  for (const [id, readings] of deviceReadings) {
    const power = readings.power;
    if (power && (!latest || power.sequence > latest.sequence)) {
      latest = { id, sequence: power.sequence };
    }
  }
  return latest?.id ?? null;
}

function rollingPowerAverage(deviceId: string, seconds: number): number | null {
  const cutoff = Date.now() - seconds * 1000;
  const samples = powerSamplesByDevice.get(deviceId)?.filter((sample) => sample.timestamp >= cutoff) ?? [];
  if (samples.length === 0) return null;
  return samples.reduce((total, sample) => total + sample.value, 0) / samples.length;
}

function renderDashboard(): void {
  const latest = getLatestReadings();
  heartRateValue.textContent = latest.heartRate?.toFixed(0) ?? "--";
  cadenceValue.textContent = latest.cadence?.toFixed(0) ?? "--";
  const powerDeviceId = latestPowerDeviceId();
  powerLiveValue.textContent = latest.power?.toFixed(0) ?? "--";
  power3SecondValue.textContent = powerDeviceId
    ? rollingPowerAverage(powerDeviceId, 3)?.toFixed(0) ?? "--"
    : "--";
  power10SecondValue.textContent = powerDeviceId
    ? rollingPowerAverage(powerDeviceId, 10)?.toFixed(0) ?? "--"
    : "--";
  speedValue.textContent = latest.speed?.toFixed(1) ?? "--";
}

function storeDeviceReading(deviceId: string, reading: TrainingReading): void {
  const stored = deviceReadings.get(deviceId) ?? {};
  if (reading.power != null) {
    const now = Date.now();
    const samples = powerSamplesByDevice.get(deviceId) ?? [];
    samples.push({ timestamp: now, value: reading.power });
    powerSamplesByDevice.set(deviceId, samples.filter((sample) => sample.timestamp >= now - 10_000));
  }
  for (const metric of Object.keys(reading) as TrainingMetric[]) {
    const value = reading[metric];
    if (value != null) stored[metric] = { value, sequence: ++readingSequence };
  }
  deviceReadings.set(deviceId, stored);
  renderDashboard();
}

const sessionRecorder = new SessionRecorder(getLatestReadings);
let workouts = loadWorkouts();
let draftSteps: WorkoutStep[] = [{ durationSeconds: 300, zone: 2 }];
let editingWorkoutId: string | null = null;
let sectionTransitioning = false;
let countdownSecond: number | null = null;
let finishingPromptOpen = false;

function selectedWorkout(): Workout | null {
  return workouts.find((workout) => workout.id === workoutSelect.value) ?? null;
}

function renderWorkoutSelection(): void {
  const selected = workoutSelect.value;
  workoutSelect.replaceChildren(new Option("Free ride", ""));
  for (const workout of workouts) workoutSelect.add(new Option(workout.name, workout.id));
  workoutSelect.value = workouts.some((workout) => workout.id === selected) ? selected : "";
  renderWorkoutSummary();
  updateSessionControls();
}

function formatMinutesAndSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderWorkoutSummary(): void {
  const workout = selectedWorkout();
  workoutDeleteButton.disabled = !workout || sessionRecorder.state !== "stopped";
  workoutEditButton.disabled = !workout || sessionRecorder.state !== "stopped";
  if (!workout) {
    workoutSummaryElement.textContent = "Ride without a predefined interval plan.";
    return;
  }
  const totalSeconds = workout.steps.reduce((total, step) => total + step.durationSeconds, 0);
  workoutSummaryElement.innerHTML = `<strong>${workout.steps.length} intervals</strong><span>${formatMinutesAndSeconds(totalSeconds)} total</span><span>FTP ${workout.ftp} W</span>`;
}

function renderWorkoutTotalDuration(): void {
  const totalSeconds = draftSteps.reduce((total, step) => total + step.durationSeconds, 0);
  workoutTotalDurationOutput.textContent = formatMinutesAndSeconds(totalSeconds);
}

function moveDraftStep(from: number, to: number): void {
  if (from < 0 || to < 0 || from >= draftSteps.length || to >= draftSteps.length) return;
  const [step] = draftSteps.splice(from, 1);
  if (!step) return;
  draftSteps.splice(to, 0, step);
  renderWorkoutSteps();
}

function renderWorkoutSteps(): void {
  workoutStepsElement.replaceChildren(
    ...draftSteps.map((step, index) => {
      const row = document.createElement("div");
      row.className = "workout-step";
      const zone = document.createElement("select");
      for (const definition of POWER_ZONES) {
        zone.add(new Option(`Zone ${definition.zone} · ${definition.name} (${definition.range})`, String(definition.zone)));
      }
      zone.value = String(step.zone);
      const duration = document.createElement("input");
      duration.type = "number"; duration.min = "5"; duration.step = "5";
      duration.value = String(step.durationSeconds);
      const formattedDuration = document.createElement("output");
      formattedDuration.className = "workout-step-duration";
      formattedDuration.setAttribute("aria-label", "Duration in minutes and seconds");
      const target = document.createElement("strong");
      const refresh = (): void => {
        step.zone = Number(zone.value);
        step.durationSeconds = Math.max(5, Number(duration.value) || 5);
        formattedDuration.textContent = formatMinutesAndSeconds(step.durationSeconds);
        target.textContent = `${targetPower(workoutFtpInput.valueAsNumber || 250, step.zone)} W`;
        renderWorkoutTotalDuration();
      };
      zone.addEventListener("change", refresh); duration.addEventListener("input", refresh);
      workoutFtpInput.addEventListener("input", refresh);
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "disconnect-device-button"; remove.textContent = "Remove";
      remove.addEventListener("click", () => { draftSteps.splice(index, 1); renderWorkoutSteps(); });
      const moveUp = document.createElement("button");
      moveUp.type = "button"; moveUp.className = "disconnect-device-button interval-move"; moveUp.textContent = "Move up";
      moveUp.disabled = index === 0;
      moveUp.addEventListener("click", () => moveDraftStep(index, index - 1));
      const moveDown = document.createElement("button");
      moveDown.type = "button"; moveDown.className = "disconnect-device-button interval-move"; moveDown.textContent = "Move down";
      moveDown.disabled = index === draftSteps.length - 1;
      moveDown.addEventListener("click", () => moveDraftStep(index, index + 1));
      row.append(zone, duration, document.createTextNode(" seconds"), formattedDuration, target, moveUp, moveDown, remove);
      refresh();
      return row;
    }),
  );
  renderWorkoutTotalDuration();
}

workoutAddStepButton.addEventListener("click", () => {
  draftSteps.push({ durationSeconds: 300, zone: 2 }); renderWorkoutSteps();
});

function finishEditingWorkout(): void {
  editingWorkoutId = null;
  workoutEditorTitleElement.textContent = "Create a training";
  workoutSaveButton.textContent = "Save training";
  workoutCancelButton.classList.add("hidden");
}

function resetWorkoutEditor(): void {
  finishEditingWorkout();
  workoutEditorElement.open = false;
  workoutNameInput.value = "My training";
  workoutFtpInput.value = "250";
  draftSteps = [{ durationSeconds: 300, zone: 2 }];
  renderWorkoutSteps();
}

workoutEditButton.addEventListener("click", () => {
  const workout = selectedWorkout();
  if (!workout) return;
  editingWorkoutId = workout.id;
  workoutNameInput.value = workout.name;
  workoutFtpInput.value = String(workout.ftp);
  draftSteps = workout.steps.map((step) => ({ ...step }));
  workoutEditorTitleElement.textContent = `Edit ${workout.name}`;
  workoutSaveButton.textContent = "Save changes";
  workoutCancelButton.classList.remove("hidden");
  workoutEditorElement.open = true;
  renderWorkoutSteps();
});

workoutCancelButton.addEventListener("click", () => {
  resetWorkoutEditor();
});

workoutSaveButton.addEventListener("click", () => {
  if (draftSteps.length === 0) return;
  const workout: Workout = {
    id: editingWorkoutId ?? crypto.randomUUID(),
    name: workoutNameInput.value.trim() || "Training",
    ftp: Math.max(50, workoutFtpInput.valueAsNumber || 250),
    steps: draftSteps.map((step) => ({ ...step })),
  };
  if (editingWorkoutId) {
    workouts = workouts.map((existing) => existing.id === editingWorkoutId ? workout : existing);
  } else {
    workouts.push(workout);
  }
  saveWorkouts(workouts);
  workoutSelect.value = workout.id; renderWorkoutSelection();
  resetWorkoutEditor();
});
workoutDeleteButton.addEventListener("click", () => {
  const workout = selectedWorkout();
  if (!workout || !window.confirm(`Delete “${workout.name}”?`)) return;
  workouts = workouts.filter((workout) => workout.id !== workoutSelect.value);
  if (editingWorkoutId === workout.id) resetWorkoutEditor();
  saveWorkouts(workouts); renderWorkoutSelection();
});
workoutSelect.addEventListener("change", () => {
  renderWorkoutSummary();
  updateSessionControls();
});
renderWorkoutSteps();
renderWorkoutSelection();

let savedActivities: StoredActivity[] = [];
const busyActivities = new Map<string, { name: string; startedAt: number }>();

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function renderStatsBlock(
  element: HTMLElement,
  durationElement: HTMLElement,
  stats: LiveSessionStats,
  targetPowerValue?: number | null,
): void {
  durationElement.textContent = formatClock(stats.duration);
  const averagePower = formatPower(stats.averagePower);
  const powerDisplay = targetPowerValue !== undefined
    ? `${averagePower} / ${formatPower(targetPowerValue)}`
    : averagePower;
  element.innerHTML = `
    ${metricRow("Speed", formatSpeed(stats.speed != null ? stats.speed / 3.6 : null))}
    ${metricRow("Distance", formatMeters(stats.distance))}
    ${metricRow("Average power", powerDisplay)}
    ${metricRow("Normalized power", formatPower(stats.normalizedPower))}
    ${metricRow("Average heart rate", formatHeartRate(stats.averageHeartRate))}
    ${metricRow("Max heart rate", formatHeartRate(stats.maxHeartRate))}
  `;
}

function renderSessionStats(): void {
  const workout = selectedWorkout();
  const currentStep = workout?.steps[sessionRecorder.sectionNumber - 1];
  renderStatsBlock(
    overallSessionStatsElement,
    overallStatsDurationLabel,
    sessionRecorder.overallStats,
  );
  renderStatsBlock(
    sectionSessionStatsElement,
    sectionStatsDurationLabel,
    sessionRecorder.currentSectionStats,
    workout && currentStep ? targetPower(workout.ftp, currentStep.zone) : null,
  );
}

function structuredSectionElapsed(workout: Workout): number {
  const sectionIndex = sessionRecorder.sectionNumber - 1;
  const precedingDuration = workout.steps
    .slice(0, sectionIndex)
    .reduce((total, step) => total + step.durationSeconds, 0);
  return Math.max(0, sessionRecorder.timerSeconds - precedingDuration);
}

function renderWorkoutProgress(): void {
  const workout = selectedWorkout();
  sessionTitleLabel.textContent = `Training session: ${workout?.name ?? "Free ride"}`;
  const active = sessionRecorder.state !== "stopped";
  const sectionIndex = sessionRecorder.sectionNumber - 1;
  const step = workout?.steps[sectionIndex];
  workoutGuidanceElement.classList.toggle("hidden", !workout || !step || !active);
  if (!workout || !step || !active) return;

  const elapsed = Math.min(step.durationSeconds, structuredSectionElapsed(workout));
  const remaining = Math.max(0, step.durationSeconds - elapsed);
  const progress = step.durationSeconds > 0 ? (elapsed / step.durationSeconds) * 100 : 100;
  workoutProgressFillElement.style.width = `${progress}%`;
  workoutCurrentSectionElement.textContent = `Section ${sectionIndex + 1}/${workout.steps.length} · Zone ${step.zone}`;
  workoutCurrentTargetElement.textContent = `${targetPower(workout.ftp, step.zone)} W`;

  const upcoming = workout.steps[sectionIndex + 1];
  workoutUpcomingElement.textContent = upcoming
    ? `Next: Zone ${upcoming.zone} · ${targetPower(workout.ftp, upcoming.zone)} W for ${formatMinutesAndSeconds(upcoming.durationSeconds)} · starts in ${formatMinutesAndSeconds(remaining)}`
    : `Training ends in ${formatMinutesAndSeconds(remaining)}`;
}

function updateSessionControls(): void {
  const running = sessionRecorder.state === "running";
  const paused = sessionRecorder.state === "paused";
  const workout = selectedWorkout();
  sessionStartButton.classList.toggle("hidden", running || paused);
  sessionPauseButton.classList.toggle("hidden", !running);
  sessionResumeButton.classList.toggle("hidden", !paused);
  sessionNextButton.classList.toggle("hidden", Boolean(workout) || (!running && !paused));
  sessionStopButton.classList.toggle("hidden", !running && !paused);
  sessionStateLabel.textContent = running
    ? "Recording live sensor data."
    : paused
      ? "Session paused."
      : "Ready to start.";
  sessionSectionLabel.textContent = `Section ${Math.max(1, sessionRecorder.sectionNumber)}`;
  workoutSelect.disabled = running || paused;
  workoutEditButton.disabled = !workout || running || paused;
  workoutDeleteButton.disabled = !workout || running || paused;
  renderWorkoutProgress();
}

function activityFileName(startedAt: number, trainingName: string): string {
  const safeName = trainingName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "training";
  return `${safeName}-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.fit`;
}

async function fingerprintBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function analyzeStoredActivity(activity: StoredActivity): Promise<void> {
  status.textContent = `Reading ${activity.name}…`;
  try {
    const parsed = await parseFit(await activity.blob.arrayBuffer());
    renderAnalysis(analyzeFitData(parsed), activity.name);
    status.textContent = `Loaded ${activity.name}`;
    window.location.hash = "#analysis";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Error: ${message}`;
  }
}

function createActivityRows(includeAnalyze: boolean): HTMLElement[] {
  const entries: HTMLElement[] = [];
  for (const busy of busyActivities.values()) {
    const row = document.createElement("article");
    row.className = "activity-row";
    row.innerHTML = `<div><strong>${busy.name}</strong><p>${new Date(busy.startedAt).toLocaleString()}</p></div><span class="device-connecting"><span class="connecting-spinner" aria-hidden="true"></span>Creating FIT file…</span>`;
    entries.push(row);
  }
  for (const activity of savedActivities) {
    const row = document.createElement("article");
    row.className = "activity-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = activity.name;
    const detail = document.createElement("p");
    detail.textContent = `${new Date(activity.startedAt).toLocaleString()} · ${formatClock(activity.duration)}`;
    info.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "device-actions";
    if (includeAnalyze) {
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "connect-device-button compact";
      analyze.textContent = "Analyze";
      analyze.addEventListener(
        "click",
        () => void analyzeStoredActivity(activity),
      );
      actions.append(analyze);
    }
    const download = document.createElement("a");
    download.className = "disconnect-device-button activity-download";
    download.textContent = "Download";
    download.download = activity.name;
    download.addEventListener("click", () => {
      const url = URL.createObjectURL(activity.blob);
      download.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "disconnect-device-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      await deleteActivity(activity.id);
      savedActivities = savedActivities.filter(
        (item) => item.id !== activity.id,
      );
      renderActivities();
    });
    actions.append(download, remove);
    row.append(info, actions);
    entries.push(row);
  }
  return entries;
}

function renderActivities(): void {
  const trainingRows = createActivityRows(false);
  const analysisRows = createActivityRows(true);
  activityListElement.replaceChildren(
    ...(trainingRows.length > 0
      ? trainingRows
      : [
          Object.assign(document.createElement("p"), {
            className: "empty-devices",
            textContent: "No saved sessions yet.",
          }),
        ]),
  );
  analysisActivityListElement.replaceChildren(
    ...(analysisRows.length > 0
      ? analysisRows
      : [
          Object.assign(document.createElement("p"), {
            className: "empty-devices",
            textContent: "No saved FIT files yet.",
          }),
        ]),
  );
}

sessionStartButton.addEventListener("click", () => {
  sectionTransitioning = false;
  countdownSecond = null;
  finishingPromptOpen = false;
  sessionRecorder.start();
  sessionTimerLabel.textContent = "00:00:00";
  updateSessionControls();
  renderSessionStats();
});
sessionPauseButton.addEventListener("click", () => {
  sessionRecorder.pause();
  updateSessionControls();
  renderSessionStats();
});
sessionResumeButton.addEventListener("click", () => {
  sessionRecorder.resume();
  updateSessionControls();
  renderSessionStats();
});
sessionNextButton.addEventListener("click", () => {
  sessionRecorder.nextSection();
  updateSessionControls();
  renderSessionStats();
});
async function finishSession(): Promise<void> {
  const trainingName = selectedWorkout()?.name ?? "Free ride";
  countdownOverlay.classList.add("hidden");
  if (finishedDialog.open) finishedDialog.close();
  finishingPromptOpen = false;
  const recorded = sessionRecorder.stop();
  if (!recorded) return;
  sessionRecorder.reset();
  sessionTimerLabel.textContent = "00:00:00";
  updateSessionControls();
  renderSessionStats();
  const name = activityFileName(recorded.startedAt, trainingName);
  busyActivities.set(recorded.id, { name, startedAt: recorded.startedAt });
  renderActivities();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const blob = createFitFile(recorded);
    const activity: StoredActivity = {
      id: recorded.id,
      name,
      startedAt: recorded.startedAt,
      duration: recorded.totalTimerTime,
      blob,
      fingerprint: await fingerprintBlob(blob),
    };
    await saveActivity(activity);
    savedActivities = [activity, ...savedActivities];
  } catch (error) {
    console.error("Could not create FIT file", error);
    sessionStateLabel.textContent =
      "The session stopped, but its FIT file could not be saved.";
  } finally {
    busyActivities.delete(recorded.id);
    renderActivities();
  }
}

sessionStopButton.addEventListener("click", () => void finishSession());

finishedDialog.addEventListener("cancel", (event) => event.preventDefault());
finishAndSaveButton.addEventListener("click", () => void finishSession());
continueRidingButton.addEventListener("click", () => {
  sessionRecorder.nextSection();
  sessionRecorder.resume();
  finishedDialog.close();
  finishingPromptOpen = false;
  sectionTransitioning = false;
  countdownSecond = null;
  updateSessionControls();
  renderSessionStats();
});

window.setInterval(() => {
  if (sessionRecorder.state !== "stopped") {
    sessionTimerLabel.textContent = formatClock(sessionRecorder.timerSeconds);
    renderSessionStats();
    renderWorkoutProgress();
  }
  const workout = selectedWorkout();
  const step = workout?.steps[sessionRecorder.sectionNumber - 1];
  if (sessionRecorder.state !== "running" || !workout || !step) {
    countdownOverlay.classList.add("hidden");
    return;
  }
  const remaining = step.durationSeconds - structuredSectionElapsed(workout);
  if (remaining <= 10) {
    const second = Math.max(0, Math.ceil(remaining));
    countdownOverlay.classList.remove("hidden");
    if (second !== countdownSecond) {
      countdownSecond = second;
      countdownValue.textContent = String(second);
      countdownValue.classList.remove("countdown-pop");
      void countdownValue.offsetWidth;
      countdownValue.classList.add("countdown-pop");
    }
  } else {
    countdownOverlay.classList.add("hidden");
  }
  if (remaining <= 0 && !sectionTransitioning) {
    sectionTransitioning = true;
    if (sessionRecorder.sectionNumber < workout.steps.length) {
      sessionRecorder.nextSection();
      countdownSecond = null;
      sectionTransitioning = false;
      updateSessionControls();
      renderSessionStats();
    } else {
      sessionRecorder.pause();
      countdownOverlay.classList.add("hidden");
      finishingPromptOpen = true;
      updateSessionControls();
      renderSessionStats();
      finishedDialog.showModal();
    }
  }
}, 250);

const activitiesReady = listActivities()
  .then(async (activities) => {
    for (const activity of activities) {
      if (!activity.fingerprint) {
        activity.fingerprint = await fingerprintBlob(activity.blob);
        await saveActivity(activity);
      }
    }
    savedActivities = activities;
    renderActivities();
  })
  .catch((error) => console.error("Could not load saved FIT files", error));

updateSessionControls();
renderSessionStats();

function renderConnectedDevices(): void {
  if (devices.size === 0 && rememberedDevices.size === 0) {
    connectedDevicesList.innerHTML =
      '<p class="empty-devices">No devices connected.</p>';
    return;
  }

  const rows = Array.from(devices.values(), (device) => {
    const row = document.createElement("article");
    row.className = "connected-device";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = device.name;
    const tags = document.createElement("div");
    tags.className = "capability-tags";
    const capabilities =
      deviceCapabilities.get(device.id) ?? new Set<TrainingMetric>();
    if (connectingDevices.has(device.id)) {
      const connecting = document.createElement("span");
      connecting.className = "device-connecting";
      connecting.innerHTML =
        '<span class="connecting-spinner" aria-hidden="true"></span>Connecting…';
      tags.append(connecting);
    } else if (capabilities.size === 0) {
      const waiting = document.createElement("span");
      waiting.className = "capability-tag waiting";
      waiting.textContent = "Waiting for data";
      tags.append(waiting);
    } else {
      for (const capability of capabilities) {
        const tag = document.createElement("span");
        tag.className = "capability-tag";
        tag.textContent = metricLabels[capability];
        tags.append(tag);
      }
    }
    info.append(name, tags);
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.className = "disconnect-device-button";
    disconnect.textContent = "Disconnect";
    disconnect.disabled = connectingDevices.has(device.id);
    disconnect.addEventListener("click", () => {
      device.disconnect();
      rememberedDevices.delete(device.id);
      saveRememberedDevices();
      devices.delete(device.id);
      deviceCapabilities.delete(device.id);
      connectingDevices.delete(device.id);
      deviceReadings.delete(device.id);
      powerSamplesByDevice.delete(device.id);
      renderDashboard();
      renderConnectedDevices();
    });
    row.append(info, disconnect);
    return row;
  });

  for (const remembered of rememberedDevices.values()) {
    if (devices.has(remembered.id)) continue;
    const row = document.createElement("article");
    row.className = "connected-device remembered-device";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = remembered.name ?? "Remembered Bluetooth sensor";
    const state = document.createElement("div");
    state.className = "capability-tags";
    state.innerHTML =
      '<span class="capability-tag waiting">Disconnected</span>';
    info.append(name, state);
    const reconnect = document.createElement("button");
    reconnect.type = "button";
    reconnect.className = "disconnect-device-button";
    reconnect.textContent = "Reconnect";
    reconnect.addEventListener("click", async () => {
      reconnect.disabled = true;
      const reconnected = await connectTrainingDevice(
        (callbacks) =>
          remembered.name
            ? TrainingBluetoothDevice.selectNamedAndConnect(
                remembered.name,
                callbacks,
                getWheelCircumferenceMeters,
              )
            : TrainingBluetoothDevice.selectAndConnect(
                callbacks,
                getWheelCircumferenceMeters,
              ),
        true,
      );
      if (reconnected && reconnected.id !== remembered.id) {
        rememberedDevices.delete(remembered.id);
        saveRememberedDevices();
        renderConnectedDevices();
      }
      reconnect.disabled = false;
    });
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "disconnect-device-button";
    forget.textContent = "Disconnect";
    forget.addEventListener("click", () => {
      rememberedDevices.delete(remembered.id);
      saveRememberedDevices();
      renderConnectedDevices();
    });
    const actions = document.createElement("div");
    actions.className = "device-actions";
    actions.append(reconnect, forget);
    row.append(info, actions);
    rows.push(row);
  }

  connectedDevicesList.replaceChildren(...rows);
}

if (!window.isSecureContext || !navigator.bluetooth) {
  bluetoothConnectButton.disabled = true;
  bluetoothStatusText.textContent = !window.isSecureContext
    ? "Bluetooth requires HTTPS or localhost."
    : "Web Bluetooth is not supported by this browser.";
}

async function connectTrainingDevice(
  connect: (
    callbacks: Parameters<typeof TrainingBluetoothDevice.selectAndConnect>[0],
  ) => Promise<TrainingBluetoothDevice>,
  rememberOnSuccess: boolean,
): Promise<TrainingBluetoothDevice | null> {
  let connectedDevice: TrainingBluetoothDevice | null = null;
  let discoveredCapabilities = new Set<TrainingMetric>();

  try {
    connectedDevice = await connect({
      onConnecting: (device) => {
        connectedDevice = device;
        const previousDevice = devices.get(device.id);
        if (previousDevice && previousDevice !== device)
          previousDevice.disconnect();
        devices.set(device.id, device);
        deviceCapabilities.set(device.id, new Set());
        connectingDevices.add(device.id);
        renderConnectedDevices();
        bluetoothStatusText.textContent = `Connecting to ${device.name}…`;
      },
      onReading: (reading) => {
        if (connectedDevice) storeDeviceReading(connectedDevice.id, reading);
      },
      onCapabilitiesChanged: (capabilities) => {
        discoveredCapabilities = new Set(capabilities);
        if (!connectedDevice) return;
        deviceCapabilities.set(connectedDevice.id, discoveredCapabilities);
        renderConnectedDevices();
      },
      onDisconnected: () => {
        if (!connectedDevice) return;
        devices.delete(connectedDevice.id);
        deviceCapabilities.delete(connectedDevice.id);
        connectingDevices.delete(connectedDevice.id);
        deviceReadings.delete(connectedDevice.id);
        powerSamplesByDevice.delete(connectedDevice.id);
        renderDashboard();
        renderConnectedDevices();
        bluetoothStatusText.textContent = `${connectedDevice.name} disconnected.`;
      },
    });

    const existing = devices.get(connectedDevice.id);
    if (existing && existing !== connectedDevice) existing.disconnect();
    devices.set(connectedDevice.id, connectedDevice);
    connectingDevices.delete(connectedDevice.id);
    for (const metric of connectedDevice.availableMetrics)
      discoveredCapabilities.add(metric);
    deviceCapabilities.set(connectedDevice.id, discoveredCapabilities);
    if (rememberOnSuccess) {
      rememberedDevices.set(connectedDevice.id, {
        id: connectedDevice.id,
        name: connectedDevice.advertisedName,
      });
      saveRememberedDevices();
    }
    renderConnectedDevices();
    bluetoothStatusText.textContent = `Connected to ${connectedDevice.name}. Start riding to detect its data.`;
    console.info(BLUETOOTH_LOG_PREFIX, "Connection registered in UI", {
      id: connectedDevice.id,
      name: connectedDevice.name,
      remembered: rememberOnSuccess,
    });
    return connectedDevice;
  } catch (error) {
    console.error(BLUETOOTH_LOG_PREFIX, "Connection attempt failed", error);
    if (connectedDevice) {
      devices.delete(connectedDevice.id);
      deviceCapabilities.delete(connectedDevice.id);
      connectingDevices.delete(connectedDevice.id);
      deviceReadings.delete(connectedDevice.id);
      powerSamplesByDevice.delete(connectedDevice.id);
      renderDashboard();
      renderConnectedDevices();
    }
    const cancelled =
      error instanceof DOMException && error.name === "NotFoundError";
    const message = error instanceof Error ? error.message : String(error);
    bluetoothStatusText.textContent = cancelled
      ? "Connection cancelled."
      : `Could not connect: ${message}`;
    return null;
  }
}

bluetoothConnectButton.addEventListener("click", async () => {
  bluetoothConnectButton.disabled = true;
  bluetoothStatusText.textContent = "Choose a Bluetooth training sensor…";
  await connectTrainingDevice(
    (callbacks) =>
      TrainingBluetoothDevice.selectAndConnect(
        callbacks,
        getWheelCircumferenceMeters,
      ),
    true,
  );
  bluetoothConnectButton.disabled = false;
});

async function reconnectActiveDevices(): Promise<void> {
  const bluetooth = navigator.bluetooth;
  console.info(BLUETOOTH_LOG_PREFIX, "Auto-reconnect check started", {
    secureContext: window.isSecureContext,
    bluetoothAvailable: Boolean(bluetooth),
    getDevicesAvailable: Boolean(bluetooth?.getDevices),
    activeDeviceIds: Array.from(rememberedDevices.keys()),
  });
  if (!bluetooth?.getDevices) {
    console.warn(
      BLUETOOTH_LOG_PREFIX,
      "Auto-reconnect unavailable: getDevices() is not supported",
    );
    return;
  }
  if (rememberedDevices.size === 0) {
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Auto-reconnect skipped: no active devices stored",
    );
    return;
  }

  try {
    const authorizedDevices = await bluetooth.getDevices();
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Previously authorized devices returned by browser",
      authorizedDevices.map((device) => ({ id: device.id, name: device.name })),
    );
    const reconnectable = authorizedDevices.filter((device) =>
      rememberedDevices.has(device.id),
    );
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Devices selected for auto-reconnect",
      reconnectable.map((device) => ({ id: device.id, name: device.name })),
    );
    for (const device of reconnectable) {
      console.info(BLUETOOTH_LOG_PREFIX, "Attempting automatic connection", {
        id: device.id,
        name: device.name,
      });
      await connectTrainingDevice(
        (callbacks) =>
          TrainingBluetoothDevice.connectAuthorized(
            device,
            callbacks,
            getWheelCircumferenceMeters,
          ),
        false,
      );
    }
  } catch (error) {
    console.error(
      BLUETOOTH_LOG_PREFIX,
      "Could not restore Bluetooth devices",
      error,
    );
    const message = error instanceof Error ? error.message : String(error);
    bluetoothStatusText.textContent = `Could not restore Bluetooth devices: ${message}`;
  }
}

renderConnectedDevices();
void reconnectActiveDevices();

type ViewName = "analysis" | "training";

function showView(viewName: ViewName): void {
  for (const view of views) {
    view.classList.toggle("hidden", view.dataset.view !== viewName);
  }

  for (const link of viewLinks) {
    const isActive = link.dataset.viewLink === viewName;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function viewFromHash(): ViewName {
  return window.location.hash === "#training" ? "training" : "analysis";
}

window.addEventListener("hashchange", () => showView(viewFromHash()));
showView(viewFromHash());

function metricRow(label: string, value: string): string {
  return `<div class="metric"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderStats(
  stats: Stats,
  options: { includeSectionMetrics?: boolean } = {},
): string {
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
      `,
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
  await activitiesReady;
  const activity: StoredActivity = {
    id: crypto.randomUUID(),
    name: file.name,
    startedAt: file.lastModified || Date.now(),
    duration: analysis.overall.totalTimerTime ?? 0,
    blob: file,
    fingerprint: await fingerprintBlob(file),
  };
  const added = await saveActivityIfNew(activity);
  if (added) {
    savedActivities = await listActivities();
    renderActivities();
  }
  status.textContent = added
    ? `Loaded and saved ${file.name}`
    : `Loaded ${file.name} (already in library)`;
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
