// The parts of Web Bluetooth and Web Serial the wardrive page uses; the DOM
// library in this TypeScript setup does not declare them.

interface WardriveBluetoothCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<WardriveBluetoothCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
}

interface WardriveBluetoothService {
  getCharacteristic(uuid: string): Promise<WardriveBluetoothCharacteristic>;
}

interface WardriveBluetoothServer {
  connected: boolean;
  connect(): Promise<WardriveBluetoothServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<WardriveBluetoothService>;
}

interface WardriveBluetoothDevice extends EventTarget {
  name?: string;
  gatt?: WardriveBluetoothServer;
}

interface WardriveBluetooth {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices?: string[];
  }): Promise<WardriveBluetoothDevice>;
}

interface WardriveSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface WardriveSerial {
  requestPort(options?: object): Promise<WardriveSerialPort>;
}

interface Navigator {
  bluetooth?: WardriveBluetooth;
  serial?: WardriveSerial;
}
