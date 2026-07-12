/// <reference types="web-bluetooth" />

/**
 * Shared BLE types used by every protocol module. Kept in one place so
 * cross-protocol consumers (DeviceContext, drawer tabs) get a stable surface.
 */

export interface BleConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
  characteristics: {
    fileList: BluetoothRemoteGATTCharacteristic;
    fileRequest: BluetoothRemoteGATTCharacteristic;
    fileData: BluetoothRemoteGATTCharacteristic;
    fileStatus: BluetoothRemoteGATTCharacteristic;
  };
}

export interface FileInfo {
  name: string;
  size: number;
}

export interface DownloadProgress {
  received: number;
  total: number;
  percent: number;
  speed: string;
  eta: string;
}

export interface BatteryInfo {
  percent: number;
  voltage: number;
}
