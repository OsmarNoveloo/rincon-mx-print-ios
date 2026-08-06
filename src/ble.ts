import { BleManager, type Characteristic, type Device } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { bytesToBase64 } from './base64';

const STORAGE_KEY = 'rincon-print/printer';
// La mayoría de las impresoras térmicas baratas con modo BLE no aceptan paquetes
// grandes de una sola vez; se manda en trozos chicos y conservadores.
const CHUNK_SIZE = 180;

export interface SavedPrinter {
	deviceId: string;
	deviceName: string;
	serviceUUID: string;
	characteristicUUID: string;
	writeWithResponse: boolean;
}

export const manager = new BleManager();

export async function ensurePermissions(): Promise<void> {
	if (Platform.OS !== 'android') return;
	await PermissionsAndroid.requestMultiple([
		PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
		PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
		PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
	]);
}

export function scanForDevices(onDevice: (device: Device) => void): () => void {
	manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
		if (error || !device) return;
		if (device.name || device.localName) onDevice(device);
	});
	return () => manager.stopDeviceScan();
}

// Busca, dentro de todos los servicios del dispositivo, la primera characteristic
// que acepte escritura. No se asume ningún UUID de fabricante: la MP210 (y la
// mayoría de estos módulos SPP-sobre-BLE) exponen un único servicio "de datos"
// con una characteristic de escritura, así que basta con la primera que aparezca.
async function findWritableCharacteristic(device: Device): Promise<Characteristic | null> {
	const services = await device.services();
	for (const service of services) {
		const characteristics = await device.characteristicsForService(service.uuid);
		const writable = characteristics.find((c) => c.isWritableWithResponse || c.isWritableWithoutResponse);
		if (writable) return writable;
	}
	return null;
}

export async function getSavedPrinter(): Promise<SavedPrinter | null> {
	const raw = await AsyncStorage.getItem(STORAGE_KEY);
	return raw ? (JSON.parse(raw) as SavedPrinter) : null;
}

export async function connectAndSave(device: Device): Promise<SavedPrinter> {
	const connected = await device.connect();
	await connected.discoverAllServicesAndCharacteristics();

	const characteristic = await findWritableCharacteristic(connected);
	if (!characteristic) {
		await connected.cancelConnection();
		throw new Error('La impresora no tiene ninguna característica Bluetooth de escritura');
	}

	const printer: SavedPrinter = {
		deviceId: device.id,
		deviceName: device.name ?? device.localName ?? device.id,
		serviceUUID: characteristic.serviceUUID,
		characteristicUUID: characteristic.uuid,
		writeWithResponse: !characteristic.isWritableWithoutResponse,
	};

	await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(printer));
	await connected.cancelConnection();
	return printer;
}

function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
	return chunks;
}

export async function printBytes(bytes: Uint8Array): Promise<void> {
	const printer = await getSavedPrinter();
	if (!printer) throw new Error('No hay impresora configurada. Ve a Configurar impresora primero.');

	const device = await manager.connectToDevice(printer.deviceId);
	await device.discoverAllServicesAndCharacteristics();

	try {
		for (const part of chunk(bytes, CHUNK_SIZE)) {
			const base64 = bytesToBase64(part);
			if (printer.writeWithResponse) {
				await manager.writeCharacteristicWithResponseForDevice(printer.deviceId, printer.serviceUUID, printer.characteristicUUID, base64);
			} else {
				await manager.writeCharacteristicWithoutResponseForDevice(printer.deviceId, printer.serviceUUID, printer.characteristicUUID, base64);
			}
		}
	} finally {
		await device.cancelConnection();
	}
}
