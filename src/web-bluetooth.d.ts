interface BluetoothRequestDeviceOptions {
  filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>;
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface Bluetooth {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
  getAvailability?(): Promise<boolean>;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
