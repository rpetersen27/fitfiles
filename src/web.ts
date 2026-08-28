import { analyzeFitData } from "./analysis.js";
import { deleteActivity, listActivities, saveActivity, type StoredActivity } from "./activity-store.js";
import {
  formatDrift,
  formatDuration,
  formatEfficiency,
  formatHeartRate,
  formatHeartRateDifference,
  formatMeters,
  formatPower,
  formatSpeed
} from "./format.js";
import { parseFit } from "./fit.js";
import { createFitFile } from "./fit-writer.js";
import { SessionRecorder } from "./session-recorder.js";
import {
  TrainingBluetoothDevice,
  type TrainingMetric,
  type TrainingReading
} from "./training-device.js";
import "./styles.css";
import type { AnalysisResult, Stats } from "./types.js";

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
        <article class="sensor-card">
          <span class="sensor-icon" aria-hidden="true">W</span>
          <div class="sensor-copy"><h2>Power</h2><p>Live power output</p></div>
          <div class="live-reading"><strong id="power-reading">--</strong><span>W</span></div>
        </article>
        <article class="sensor-card">
          <span class="sensor-icon" aria-hidden="true">›</span>
          <div class="sensor-copy"><h2>Speed</h2><p>Live riding speed</p></div>
          <div class="live-reading"><strong id="speed-reading">--</strong><span>km/h</span></div>
        </article>
      </section>
      <article class="panel training-placeholder">
        <p class="eyebrow">Session setup</p>
        <div class="session-heading">
          <div>
            <h2>Training session</h2>
            <p id="session-state" class="status">Ready to start.</p>
          </div>
          <div class="session-clock"><strong id="session-timer">00:00:00</strong><span id="session-section">Section 1</span></div>
        </div>
        <div class="session-controls">
          <button id="session-start" class="connect-device-button" type="button">Start</button>
          <button id="session-pause" class="connect-device-button hidden" type="button">Pause</button>
          <button id="session-resume" class="connect-device-button hidden" type="button">Resume</button>
          <button id="session-next" class="disconnect-device-button hidden" type="button">Next section</button>
          <button id="session-stop" class="disconnect-device-button danger hidden" type="button">Stop</button>
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
`;

const fileInputElement = document.querySelector<HTMLInputElement>("#fit-file");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const resultsElement = document.querySelector<HTMLElement>("#results");
const views = Array.from(document.querySelectorAll<HTMLElement>("[data-view]"));
const viewLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-view-link]"));
const heartRateReading = document.querySelector<HTMLElement>("#heart-rate-reading strong");
const cadenceReading = document.querySelector<HTMLElement>("#cadence-reading");
const powerReading = document.querySelector<HTMLElement>("#power-reading");
const speedReading = document.querySelector<HTMLElement>("#speed-reading");
const wheelCircumference = document.querySelector<HTMLInputElement>("#wheel-circumference");
const bluetoothButton = document.querySelector<HTMLButtonElement>("#bluetooth-connect");
const bluetoothStatus = document.querySelector<HTMLElement>("#bluetooth-status");
const connectedDevices = document.querySelector<HTMLElement>("#connected-devices");
const sessionStateText = document.querySelector<HTMLElement>("#session-state");
const sessionTimer = document.querySelector<HTMLElement>("#session-timer");
const sessionSection = document.querySelector<HTMLElement>("#session-section");
const sessionStart = document.querySelector<HTMLButtonElement>("#session-start");
const sessionPause = document.querySelector<HTMLButtonElement>("#session-pause");
const sessionResume = document.querySelector<HTMLButtonElement>("#session-resume");
const sessionNext = document.querySelector<HTMLButtonElement>("#session-next");
const sessionStop = document.querySelector<HTMLButtonElement>("#session-stop");
const activityList = document.querySelector<HTMLElement>("#activity-list");

if (
  !fileInputElement ||
  !statusElement ||
  !resultsElement ||
  !heartRateReading ||
  !cadenceReading ||
  !powerReading ||
  !speedReading ||
  !wheelCircumference ||
  !bluetoothButton ||
  !bluetoothStatus ||
  !connectedDevices || !sessionStateText || !sessionTimer || !sessionSection ||
  !sessionStart || !sessionPause || !sessionResume || !sessionNext || !sessionStop || !activityList
) {
  throw new Error("Missing required UI elements.");
}

const fileInput = fileInputElement;
const status = statusElement;
const results = resultsElement;
const heartRateValue = heartRateReading;
const cadenceValue = cadenceReading;
const powerValue = powerReading;
const speedValue = speedReading;
const wheelCircumferenceInput = wheelCircumference;
const bluetoothConnectButton = bluetoothButton;
const bluetoothStatusText = bluetoothStatus;
const connectedDevicesList = connectedDevices;
const sessionStateLabel = sessionStateText;
const sessionTimerLabel = sessionTimer;
const sessionSectionLabel = sessionSection;
const sessionStartButton = sessionStart;
const sessionPauseButton = sessionPause;
const sessionResumeButton = sessionResume;
const sessionNextButton = sessionNext;
const sessionStopButton = sessionStop;
const activityListElement = activityList;
const devices = new Map<string, TrainingBluetoothDevice>();
const deviceCapabilities = new Map<string, Set<TrainingMetric>>();
const connectingDevices = new Set<string>();
const deviceReadings = new Map<
  string,
  Partial<Record<TrainingMetric, { value: number; sequence: number }>>
>();
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
        if (typeof item === "string") remembered.set(item, { id: item, name: null });
        else if (item && typeof item.id === "string") {
          remembered.set(item.id, {
            id: item.id,
            name: typeof item.name === "string" ? item.name : null
          });
        }
      }
    }
    console.info(BLUETOOTH_LOG_PREFIX, "Loaded remembered devices", Array.from(remembered.values()));
    return remembered;
  } catch (error) {
    console.error(BLUETOOTH_LOG_PREFIX, "Could not read remembered devices", error);
    return new Map();
  }
}

const rememberedDevices = loadRememberedDevices();

function saveRememberedDevices(): void {
  try {
    localStorage.setItem(ACTIVE_DEVICES_KEY, JSON.stringify(Array.from(rememberedDevices.values())));
    console.info(BLUETOOTH_LOG_PREFIX, "Saved remembered devices", Array.from(rememberedDevices.values()));
  } catch (error) {
    console.error(BLUETOOTH_LOG_PREFIX, "Could not save active device IDs", error);
    // Bluetooth still works when storage is unavailable; only auto-reconnect is lost.
  }
}

function getWheelCircumferenceMeters(): number {
  const millimeters = wheelCircumferenceInput.valueAsNumber;
  return Number.isFinite(millimeters) && millimeters > 0 ? millimeters / 1000 : 2.105;
}

const metricLabels: Record<TrainingMetric, string> = {
  heartRate: "Heart rate",
  cadence: "Cadence",
  power: "Power",
  speed: "Speed"
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

function renderDashboard(): void {
  const latest = getLatestReadings();
  heartRateValue.textContent = latest.heartRate?.toFixed(0) ?? "--";
  cadenceValue.textContent = latest.cadence?.toFixed(0) ?? "--";
  powerValue.textContent = latest.power?.toFixed(0) ?? "--";
  speedValue.textContent = latest.speed?.toFixed(1) ?? "--";
}

function storeDeviceReading(deviceId: string, reading: TrainingReading): void {
  const stored = deviceReadings.get(deviceId) ?? {};
  for (const metric of Object.keys(reading) as TrainingMetric[]) {
    const value = reading[metric];
    if (value != null) stored[metric] = { value, sequence: ++readingSequence };
  }
  deviceReadings.set(deviceId, stored);
  renderDashboard();
}

const sessionRecorder = new SessionRecorder(getLatestReadings);
let savedActivities: StoredActivity[] = [];
const busyActivities = new Map<string, { name: string; startedAt: number }>();

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

function updateSessionControls(): void {
  const running = sessionRecorder.state === "running";
  const paused = sessionRecorder.state === "paused";
  sessionStartButton.classList.toggle("hidden", running || paused);
  sessionPauseButton.classList.toggle("hidden", !running);
  sessionResumeButton.classList.toggle("hidden", !paused);
  sessionNextButton.classList.toggle("hidden", !running && !paused);
  sessionStopButton.classList.toggle("hidden", !running && !paused);
  sessionStateLabel.textContent = running
    ? "Recording live sensor data."
    : paused
      ? "Session paused."
      : "Ready to start.";
  sessionSectionLabel.textContent = `Section ${Math.max(1, sessionRecorder.sectionNumber)}`;
}

function activityFileName(startedAt: number): string {
  return `training-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.fit`;
}

function renderActivities(): void {
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
      savedActivities = savedActivities.filter((item) => item.id !== activity.id);
      renderActivities();
    });
    actions.append(download, remove);
    row.append(info, actions);
    entries.push(row);
  }
  if (entries.length === 0) {
    activityListElement.innerHTML = '<p class="empty-devices">No saved sessions yet.</p>';
  } else {
    activityListElement.replaceChildren(...entries);
  }
}

sessionStartButton.addEventListener("click", () => {
  sessionRecorder.start();
  sessionTimerLabel.textContent = "00:00:00";
  updateSessionControls();
});
sessionPauseButton.addEventListener("click", () => {
  sessionRecorder.pause();
  updateSessionControls();
});
sessionResumeButton.addEventListener("click", () => {
  sessionRecorder.resume();
  updateSessionControls();
});
sessionNextButton.addEventListener("click", () => {
  sessionRecorder.nextSection();
  updateSessionControls();
});
sessionStopButton.addEventListener("click", async () => {
  const recorded = sessionRecorder.stop();
  if (!recorded) return;
  sessionTimerLabel.textContent = formatClock(recorded.totalTimerTime);
  updateSessionControls();
  const name = activityFileName(recorded.startedAt);
  busyActivities.set(recorded.id, { name, startedAt: recorded.startedAt });
  renderActivities();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const activity: StoredActivity = {
      id: recorded.id,
      name,
      startedAt: recorded.startedAt,
      duration: recorded.totalTimerTime,
      blob: createFitFile(recorded)
    };
    await saveActivity(activity);
    savedActivities = [activity, ...savedActivities];
  } catch (error) {
    console.error("Could not create FIT file", error);
    sessionStateLabel.textContent = "The session stopped, but its FIT file could not be saved.";
  } finally {
    busyActivities.delete(recorded.id);
    renderActivities();
  }
});

window.setInterval(() => {
  if (sessionRecorder.state !== "stopped") {
    sessionTimerLabel.textContent = formatClock(sessionRecorder.timerSeconds);
  }
}, 250);

void listActivities()
  .then((activities) => {
    savedActivities = activities;
    renderActivities();
  })
  .catch((error) => console.error("Could not load saved FIT files", error));

updateSessionControls();

function renderConnectedDevices(): void {
  if (devices.size === 0 && rememberedDevices.size === 0) {
    connectedDevicesList.innerHTML = '<p class="empty-devices">No devices connected.</p>';
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
      const capabilities = deviceCapabilities.get(device.id) ?? new Set<TrainingMetric>();
      if (connectingDevices.has(device.id)) {
        const connecting = document.createElement("span");
        connecting.className = "device-connecting";
        connecting.innerHTML = '<span class="connecting-spinner" aria-hidden="true"></span>Connecting…';
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
    state.innerHTML = '<span class="capability-tag waiting">Disconnected</span>';
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
                getWheelCircumferenceMeters
              )
            : TrainingBluetoothDevice.selectAndConnect(callbacks, getWheelCircumferenceMeters),
        true
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
    callbacks: Parameters<typeof TrainingBluetoothDevice.selectAndConnect>[0]
  ) => Promise<TrainingBluetoothDevice>,
  rememberOnSuccess: boolean
): Promise<TrainingBluetoothDevice | null> {
  let connectedDevice: TrainingBluetoothDevice | null = null;
  let discoveredCapabilities = new Set<TrainingMetric>();

  try {
    connectedDevice = await connect({
        onConnecting: (device) => {
          connectedDevice = device;
          const previousDevice = devices.get(device.id);
          if (previousDevice && previousDevice !== device) previousDevice.disconnect();
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
          renderDashboard();
          renderConnectedDevices();
          bluetoothStatusText.textContent = `${connectedDevice.name} disconnected.`;
        }
      });

    const existing = devices.get(connectedDevice.id);
    if (existing && existing !== connectedDevice) existing.disconnect();
    devices.set(connectedDevice.id, connectedDevice);
    connectingDevices.delete(connectedDevice.id);
    for (const metric of connectedDevice.availableMetrics) discoveredCapabilities.add(metric);
    deviceCapabilities.set(connectedDevice.id, discoveredCapabilities);
    if (rememberOnSuccess) {
      rememberedDevices.set(connectedDevice.id, {
        id: connectedDevice.id,
        name: connectedDevice.advertisedName
      });
      saveRememberedDevices();
    }
    renderConnectedDevices();
    bluetoothStatusText.textContent = `Connected to ${connectedDevice.name}. Start riding to detect its data.`;
    console.info(BLUETOOTH_LOG_PREFIX, "Connection registered in UI", {
      id: connectedDevice.id,
      name: connectedDevice.name,
      remembered: rememberOnSuccess
    });
    return connectedDevice;
  } catch (error) {
    console.error(BLUETOOTH_LOG_PREFIX, "Connection attempt failed", error);
    if (connectedDevice) {
      devices.delete(connectedDevice.id);
      deviceCapabilities.delete(connectedDevice.id);
      connectingDevices.delete(connectedDevice.id);
      deviceReadings.delete(connectedDevice.id);
      renderDashboard();
      renderConnectedDevices();
    }
    const cancelled = error instanceof DOMException && error.name === "NotFoundError";
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
      TrainingBluetoothDevice.selectAndConnect(callbacks, getWheelCircumferenceMeters),
    true
  );
  bluetoothConnectButton.disabled = false;
});

async function reconnectActiveDevices(): Promise<void> {
  const bluetooth = navigator.bluetooth;
  console.info(BLUETOOTH_LOG_PREFIX, "Auto-reconnect check started", {
    secureContext: window.isSecureContext,
    bluetoothAvailable: Boolean(bluetooth),
    getDevicesAvailable: Boolean(bluetooth?.getDevices),
    activeDeviceIds: Array.from(rememberedDevices.keys())
  });
  if (!bluetooth?.getDevices) {
    console.warn(BLUETOOTH_LOG_PREFIX, "Auto-reconnect unavailable: getDevices() is not supported");
    return;
  }
  if (rememberedDevices.size === 0) {
    console.info(BLUETOOTH_LOG_PREFIX, "Auto-reconnect skipped: no active devices stored");
    return;
  }

  try {
    const authorizedDevices = await bluetooth.getDevices();
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Previously authorized devices returned by browser",
      authorizedDevices.map((device) => ({ id: device.id, name: device.name }))
    );
    const reconnectable = authorizedDevices.filter((device) => rememberedDevices.has(device.id));
    console.info(
      BLUETOOTH_LOG_PREFIX,
      "Devices selected for auto-reconnect",
      reconnectable.map((device) => ({ id: device.id, name: device.name }))
    );
    for (const device of reconnectable) {
      console.info(BLUETOOTH_LOG_PREFIX, "Attempting automatic connection", {
        id: device.id,
        name: device.name
      });
      await connectTrainingDevice(
        (callbacks) =>
          TrainingBluetoothDevice.connectAuthorized(
            device,
            callbacks,
            getWheelCircumferenceMeters
          ),
        false
      );
    }
  } catch (error) {
    console.error(BLUETOOTH_LOG_PREFIX, "Could not restore Bluetooth devices", error);
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

function renderStats(stats: Stats, options: { includeSectionMetrics?: boolean } = {}): string {
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
      `
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
  status.textContent = `Loaded ${file.name}`;
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
