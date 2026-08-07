import { BleManager, type Device } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { bytesToBase64 } from './base64';

const STORAGE_KEY = 'rincon-print/printer';
// La mayoría de las impresoras térmicas baratas con modo BLE no aceptan paquetes
// grandes de una sola vez; se manda en trozos chicos y conservadores.
const CHUNK_SIZE = 180;

export interface Candidate {
	serviceUUID: string;
	characteristicUUID: string;
	writeWithResponse: boolean;
}

export interface SavedPrinter extends Candidate {
	deviceId: string;
	deviceName: string;
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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: tardó demasiado (>${ms}ms), la impresora seguramente se desconectó`)), ms)),
	]);
}

// Varios módulos BLE baratos (incluida la MP210) tiran la conexión ellos mismos
// si el teléfono no empieza a pedir servicios/characteristics casi de inmediato
// después de conectar, o si la interrogación de servicios se alarga. Se le da un
// respiro corto antes de descubrir servicios, y se pone un timeout explícito para
// no quedarse colgado esperando una respuesta que ya no va a llegar.
async function connectAndSettle(device: Device): Promise<Device> {
	const connected = (await device.isConnected()) ? device : await device.connect({ timeout: 8000 });
	await delay(300);
	await withTimeout(connected.discoverAllServicesAndCharacteristics(), 8000, 'Descubrir servicios');
	return connected;
}

// Muchas de estas impresoras exponen más de una characteristic con permiso de
// escritura (config, batería, etc.) y solo una es la que realmente imprime. No
// se puede adivinar cuál es, así que se listan todas para probarlas una por una
// desde la pantalla de configuración.
export async function listWritableCharacteristics(device: Device): Promise<Candidate[]> {
	const connected = await connectAndSettle(device);

	const candidates: Candidate[] = [];
	const services = await connected.services();
	for (const service of services) {
		const characteristics = await connected.characteristicsForService(service.uuid);
		for (const c of characteristics) {
			if (c.isWritableWithResponse || c.isWritableWithoutResponse) {
				candidates.push({
					serviceUUID: c.serviceUUID,
					characteristicUUID: c.uuid,
					writeWithResponse: !c.isWritableWithoutResponse,
				});
			}
		}
	}
	return candidates;
}

export async function getSavedPrinter(): Promise<SavedPrinter | null> {
	const raw = await AsyncStorage.getItem(STORAGE_KEY);
	return raw ? (JSON.parse(raw) as SavedPrinter) : null;
}

export async function savePrinter(deviceId: string, deviceName: string, candidate: Candidate): Promise<SavedPrinter> {
	const printer: SavedPrinter = { deviceId, deviceName, ...candidate };
	await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(printer));
	return printer;
}

function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
	return chunks;
}

async function writeBytes(deviceId: string, candidate: Candidate, bytes: Uint8Array): Promise<void> {
	for (const part of chunk(bytes, CHUNK_SIZE)) {
		const base64 = bytesToBase64(part);
		if (candidate.writeWithResponse) {
			await manager.writeCharacteristicWithResponseForDevice(deviceId, candidate.serviceUUID, candidate.characteristicUUID, base64);
		} else {
			await manager.writeCharacteristicWithoutResponseForDevice(deviceId, candidate.serviceUUID, candidate.characteristicUUID, base64);
		}
	}
}

// Ticket mínimo ESC/POS: init + texto + varios saltos de línea. Sin comando de
// corte a propósito — la MP210 (y la mayoría de impresoras BLE portátiles) no
// tienen cuchilla, y mandarles ese comando puede hacer que truenen el buzzer de
// error y tiren la conexión. El corte real solo debe ir si la impresora en uso
// de verdad lo soporta.
export function buildTestTicket(): Uint8Array {
	const text = 'PRUEBA RINCON PRINT\n\n\n\n\n';
	const bytes = [0x1b, 0x40, ...Array.from(text, (ch) => ch.charCodeAt(0) & 0xff)];
	return new Uint8Array(bytes);
}

export async function testCandidate(device: Device, candidate: Candidate): Promise<void> {
	const connected = await connectAndSettle(device);
	try {
		await writeBytes(connected.id, candidate, buildTestTicket());
	} finally {
		await connected.cancelConnection();
	}
}

export function subscribeBluetoothState(onChange: (state: string) => void): () => void {
	const subscription = manager.onStateChange((state) => onChange(state), true);
	return () => subscription.remove();
}

// Conexión corta solo para confirmar que la impresora responde; no descubre
// servicios ni escribe nada. Sirve para mostrar un estado en pantalla sin tener
// que mandar un ticket de prueba cada vez.
export async function pingPrinter(deviceId: string): Promise<boolean> {
	try {
		const device = await manager.connectToDevice(deviceId, { timeout: 5000 });
		await device.cancelConnection();
		return true;
	} catch {
		return false;
	}
}

export async function printBytes(bytes: Uint8Array): Promise<void> {
	const printer = await getSavedPrinter();
	if (!printer) throw new Error('No hay impresora configurada. Ve a Configurar impresora primero.');

	const device = await manager.connectToDevice(printer.deviceId, { timeout: 8000 });
	await delay(300);
	await withTimeout(device.discoverAllServicesAndCharacteristics(), 8000, 'Descubrir servicios');

	try {
		await writeBytes(printer.deviceId, printer, bytes);
	} finally {
		await device.cancelConnection();
	}
}
