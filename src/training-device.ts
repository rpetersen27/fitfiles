export type TrainingMetric = "heartRate" | "cadence" | "power" | "speed";

export interface TrainingReading {
  heartRate?: number;
  cadence?: number;
  power?: number;
  speed?: number;
}

export interface TrainingDeviceCallbacks {
  onConnecting?: (device: TrainingBluetoothDevice) => void;
  onReading: (reading: TrainingReading) => void;
  onCapabilitiesChanged: (capabilities: Set<TrainingMetric>) => void;
  onConnectionLost: () => void;
  onReconnected: () => void;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

const SERVICES = [
  "heart_rate",
  "cycling_speed_and_cadence",
  "cycling_power",
  "fitness_machine"
];
const LOG_PREFIX = "[FIT Bluetooth]";
const CONNECT_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 10_000;

interface RevolutionSample {
  revolutions: number;
  eventTime: number;
}

function counterDelta(current: number, previous: number, maximum: number): number {
  return current >= previous ? current - previous : maximum - previous + current + 1;
}

function cadence(current: RevolutionSample, previous: RevolutionSample): number | null {
  const time = counterDelta(current.eventTime, previous.eventTime, 0xffff);
  const revolutions = counterDelta(current.revolutions, previous.revolutions, 0xffff);
  return time > 0 ? (revolutions * 60 * 1024) / time : null;
}

function speed(
  current: RevolutionSample,
  previous: RevolutionSample,
  frequency: number,
  circumference: number
): number | null {
  const time = counterDelta(current.eventTime, previous.eventTime, 0xffff);
  const revolutions = counterDelta(current.revolutions, previous.revolutions, 0xffffffff);
  return time > 0 ? (revolutions * circumference * frequency * 3.6) / time : null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

export class TrainingBluetoothDevice {
  private readonly capabilities = new Set<TrainingMetric>();
  private readonly subscriptions: Array<{
    characteristic: BluetoothRemoteGATTCharacteristic;
    listener: (event: Event) => void;
  }> = [];
  private state: ConnectionState = "connecting";
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private previousWheel: RevolutionSample | null = null;
  private previousCrank: RevolutionSample | null = null;

  private constructor(
    private readonly device: BluetoothDevice,
    private readonly callbacks: TrainingDeviceCallbacks,
    private readonly getWheelCircumferenceMeters: () => number
  ) {}

  static async selectAndConnect(
    callbacks: TrainingDeviceCallbacks,
    getWheelCircumferenceMeters: () => number
  ): Promise<TrainingBluetoothDevice> {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth is not supported by this browser.");

    const device = await navigator.bluetooth.requestDevice({
      filters: SERVICES.map((service) => ({ services: [service] })),
      optionalServices: SERVICES
    });
    console.info(LOG_PREFIX, "Device selected", { id: device.id, name: device.name });
    return TrainingBluetoothDevice.connectAuthorized(
      device,
      callbacks,
      getWheelCircumferenceMeters
    );
  }

  static async selectNamedAndConnect(
    name: string,
    callbacks: TrainingDeviceCallbacks,
    getWheelCircumferenceMeters: () => number
  ): Promise<TrainingBluetoothDevice> {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth is not supported by this browser.");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name }],
      optionalServices: SERVICES
    });
    console.info(LOG_PREFIX, "Remembered device selected", { id: device.id, name: device.name });
    return TrainingBluetoothDevice.connectAuthorized(
      device,
      callbacks,
      getWheelCircumferenceMeters
    );
  }

  static async connectAuthorized(
    device: BluetoothDevice,
    callbacks: TrainingDeviceCallbacks,
    getWheelCircumferenceMeters: () => number
  ): Promise<TrainingBluetoothDevice> {
    console.info(LOG_PREFIX, "Starting connection", { id: device.id, name: device.name });
    const trainingDevice = new TrainingBluetoothDevice(
      device,
      callbacks,
      getWheelCircumferenceMeters
    );
    callbacks.onConnecting?.(trainingDevice);
    try {
      await trainingDevice.connect();
    } catch (error) {
      trainingDevice.disconnect();
      throw error;
    }
    trainingDevice.state = "connected";
    console.info(LOG_PREFIX, "Device connection ready", {
      id: device.id,
      name: device.name,
      capabilities: Array.from(trainingDevice.availableMetrics)
    });
    return trainingDevice;
  }

  get id(): string {
    return this.device.id;
  }

  get name(): string {
    return this.device.name ?? "Bluetooth sensor";
  }

  get advertisedName(): string | null {
    return this.device.name ?? null;
  }

  get availableMetrics(): Set<TrainingMetric> {
    return new Set(this.capabilities);
  }

  get reconnecting(): boolean {
    return this.state === "reconnecting";
  }

  disconnect(): void {
    console.info(LOG_PREFIX, "Disconnect requested", { id: this.id, name: this.name });
    this.state = "closed";
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.device.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.device.gatt?.disconnect();
    this.resetSubscriptions();
  }

  private async connect(): Promise<void> {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error("The selected device has no Bluetooth GATT server.");
    this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    console.info(LOG_PREFIX, "Connecting GATT server", { id: this.id, name: this.name });
    let server: BluetoothRemoteGATTServer;
    try {
      server = await withTimeout(
        gatt.connect(),
        CONNECT_TIMEOUT_MS,
        "The Bluetooth device did not respond in time."
      );
    } catch (error) {
      // Abort a connection attempt that is still pending in the browser.
      gatt.disconnect();
      throw error;
    }
    console.info(LOG_PREFIX, "GATT server connected", { id: this.id, name: this.name });

    // Keep GATT discovery sequential; several trainers reject overlapping GATT operations.
    const subscriptions = [
      await this.subscribe(server, "heart_rate", "heart_rate_measurement", this.parseHeartRate),
      await this.subscribe(
        server,
        "cycling_speed_and_cadence",
        "csc_measurement",
        this.parseCyclingSpeedCadence
      ),
      await this.subscribe(
        server,
        "cycling_power",
        "cycling_power_measurement",
        this.parseCyclingPower
      ),
      await this.subscribe(server, "fitness_machine", "indoor_bike_data", this.parseIndoorBikeData)
    ];

    if (!server.connected) throw new Error("The Bluetooth device disconnected during setup.");
    if (!subscriptions.some(Boolean)) {
      console.error(LOG_PREFIX, "No supported measurement characteristics found", {
        id: this.id,
        name: this.name
      });
      throw new Error("No supported live measurement characteristic was found.");
    }
  }

  private async subscribe(
    server: BluetoothRemoteGATTServer,
    serviceName: string,
    characteristicName: string,
    handler: (value: DataView) => void
  ): Promise<boolean> {
    try {
      const service = await server.getPrimaryService(serviceName);
      const characteristic = await service.getCharacteristic(characteristicName);
      const listener = (event: Event): void => {
        const source = event.target as BluetoothRemoteGATTCharacteristic | null;
        if (source?.value) handler(source.value);
      };
      characteristic.addEventListener("characteristicvaluechanged", listener);
      this.subscriptions.push({ characteristic, listener });
      await characteristic.startNotifications();
      console.info(LOG_PREFIX, "Subscribed to measurement", {
        id: this.id,
        service: serviceName,
        characteristic: characteristicName
      });
      return true;
    } catch (error) {
      console.debug(LOG_PREFIX, "Measurement unavailable", {
        id: this.id,
        service: serviceName,
        characteristic: characteristicName,
        error
      });
      return false;
    }
  }

  private emit(reading: TrainingReading): void {
    let changed = false;
    for (const metric of Object.keys(reading) as TrainingMetric[]) {
      if (!this.capabilities.has(metric)) {
        this.capabilities.add(metric);
        changed = true;
      }
    }
    if (changed) this.callbacks.onCapabilitiesChanged(this.availableMetrics);
    this.callbacks.onReading(reading);
  }

  private readonly parseHeartRate = (value: DataView): void => {
    if (value.byteLength < 2) return;
    const sixteenBit = (value.getUint8(0) & 0x01) !== 0;
    if (sixteenBit && value.byteLength < 3) return;
    this.emit({ heartRate: sixteenBit ? value.getUint16(1, true) : value.getUint8(1) });
  };

  private readonly parseCyclingSpeedCadence = (value: DataView): void => {
    if (value.byteLength < 1) return;
    const flags = value.getUint8(0);
    const reading: TrainingReading = {};
    let offset = 1;

    if ((flags & 0x01) !== 0 && value.byteLength >= offset + 6) {
      const wheel = {
        revolutions: value.getUint32(offset, true),
        eventTime: value.getUint16(offset + 4, true)
      };
      if (this.previousWheel) {
        const result = speed(wheel, this.previousWheel, 1024, this.getWheelCircumferenceMeters());
        if (result != null) reading.speed = result;
      }
      this.previousWheel = wheel;
      offset += 6;
    }
    if ((flags & 0x02) !== 0 && value.byteLength >= offset + 4) {
      const crank = {
        revolutions: value.getUint16(offset, true),
        eventTime: value.getUint16(offset + 2, true)
      };
      if (this.previousCrank) {
        const result = cadence(crank, this.previousCrank);
        if (result != null) reading.cadence = result;
      }
      this.previousCrank = crank;
    }
    if (Object.keys(reading).length > 0) this.emit(reading);
  };

  private readonly parseCyclingPower = (value: DataView): void => {
    if (value.byteLength < 4) return;
    const flags = value.getUint16(0, true);
    const reading: TrainingReading = { power: value.getInt16(2, true) };
    let offset = 4;
    if ((flags & 0x01) !== 0) offset += 1;
    if ((flags & 0x04) !== 0) offset += 2;
    if ((flags & 0x10) !== 0 && value.byteLength >= offset + 6) {
      const wheel = {
        revolutions: value.getUint32(offset, true),
        eventTime: value.getUint16(offset + 4, true)
      };
      if (this.previousWheel) {
        const result = speed(wheel, this.previousWheel, 2048, this.getWheelCircumferenceMeters());
        if (result != null) reading.speed = result;
      }
      this.previousWheel = wheel;
      offset += 6;
    }
    if ((flags & 0x20) !== 0 && value.byteLength >= offset + 4) {
      const crank = {
        revolutions: value.getUint16(offset, true),
        eventTime: value.getUint16(offset + 2, true)
      };
      if (this.previousCrank) {
        const result = cadence(crank, this.previousCrank);
        if (result != null) reading.cadence = result;
      }
      this.previousCrank = crank;
    }
    this.emit(reading);
  };

  private readonly parseIndoorBikeData = (value: DataView): void => {
    if (value.byteLength < 2) return;
    const flags = value.getUint16(0, true);
    const reading: TrainingReading = {};
    let offset = 2;
    const readUint16 = (): number | null => {
      if (value.byteLength < offset + 2) return null;
      const result = value.getUint16(offset, true);
      offset += 2;
      return result;
    };
    const skip = (bytes: number): boolean => {
      if (value.byteLength < offset + bytes) return false;
      offset += bytes;
      return true;
    };

    if ((flags & 0x01) === 0) {
      const result = readUint16();
      if (result == null) return;
      reading.speed = result / 100;
    }
    if ((flags & 0x02) !== 0 && !skip(2)) return;
    if ((flags & 0x04) !== 0) {
      const result = readUint16();
      if (result == null) return;
      reading.cadence = result / 2;
    }
    if ((flags & 0x08) !== 0 && !skip(2)) return;
    if ((flags & 0x10) !== 0 && !skip(3)) return;
    if ((flags & 0x20) !== 0 && !skip(2)) return;
    if ((flags & 0x40) !== 0) {
      if (value.byteLength < offset + 2) return;
      reading.power = value.getInt16(offset, true);
      offset += 2;
    }
    if ((flags & 0x80) !== 0 && !skip(2)) return;
    if ((flags & 0x100) !== 0 && !skip(5)) return;
    if ((flags & 0x200) !== 0) {
      if (value.byteLength < offset + 1) return;
      reading.heartRate = value.getUint8(offset);
    }
    if (Object.keys(reading).length > 0) this.emit(reading);
  };

  private readonly handleDisconnect = (): void => {
    console.warn(LOG_PREFIX, "GATT server disconnected", {
      id: this.id,
      name: this.name,
      state: this.state
    });
    // Failed setup and reconnect attempts handle their own errors.
    if (this.state !== "connected") return;
    this.state = "reconnecting";
    this.resetSubscriptions();
    this.callbacks.onConnectionLost();
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (this.state !== "reconnecting" || this.reconnectTimer != null) return;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt
    );
    this.reconnectAttempt += 1;
    console.info(LOG_PREFIX, "Reconnect scheduled", {
      id: this.id,
      attempt: this.reconnectAttempt,
      delay
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.state !== "reconnecting") return;
    try {
      // Reuses the authorized BluetoothDevice, so no user gesture or chooser is required.
      await this.connect();
      if (this.state !== "reconnecting") {
        this.device.gatt?.disconnect();
        return;
      }
      this.state = "connected";
      this.reconnectAttempt = 0;
      console.info(LOG_PREFIX, "Device reconnected", { id: this.id, name: this.name });
      this.callbacks.onReconnected();
    } catch (error) {
      console.warn(LOG_PREFIX, "Reconnect attempt failed", { id: this.id, error });
      this.device.gatt?.disconnect();
      this.resetSubscriptions();
      this.scheduleReconnect();
    }
  }

  private resetSubscriptions(): void {
    for (const { characteristic, listener } of this.subscriptions) {
      characteristic.removeEventListener("characteristicvaluechanged", listener);
    }
    this.subscriptions.length = 0;
    this.previousWheel = null;
    this.previousCrank = null;
  }
}
