import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Device } from 'react-native-ble-plx';
import { connectAndSave, ensurePermissions, getSavedPrinter, scanForDevices, type SavedPrinter } from './ble';

export function PrinterSettings({ onDone }: { onDone: () => void }) {
	const [devices, setDevices] = useState<Device[]>([]);
	const [scanning, setScanning] = useState(false);
	const [connectingId, setConnectingId] = useState<string | null>(null);
	const [saved, setSaved] = useState<SavedPrinter | null>(null);

	useEffect(() => {
		getSavedPrinter().then(setSaved);
	}, []);

	useEffect(() => {
		let stopScan: (() => void) | undefined;

		(async () => {
			await ensurePermissions();
			setScanning(true);
			stopScan = scanForDevices((device) => {
				setDevices((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device]));
			});
		})();

		return () => stopScan?.();
	}, []);

	async function handleSelect(device: Device) {
		setConnectingId(device.id);
		try {
			const printer = await connectAndSave(device);
			setSaved(printer);
			Alert.alert('Impresora guardada', printer.deviceName);
		} catch (err) {
			Alert.alert('No se pudo conectar', err instanceof Error ? err.message : String(err));
		} finally {
			setConnectingId(null);
		}
	}

	return (
		<View style={styles.container}>
			<Text style={styles.title}>Configurar impresora</Text>
			{saved && <Text style={styles.saved}>Guardada actualmente: {saved.deviceName}</Text>}

			{scanning && (
				<View style={styles.scanningRow}>
					<ActivityIndicator />
					<Text style={styles.scanningText}>Buscando impresoras Bluetooth cercanas…</Text>
				</View>
			)}

			<FlatList
				data={devices}
				keyExtractor={(d) => d.id}
				style={styles.list}
				renderItem={({ item }) => (
					<Pressable style={styles.item} onPress={() => handleSelect(item)} disabled={connectingId !== null}>
						<Text style={styles.itemText}>{item.name ?? item.localName ?? item.id}</Text>
						{connectingId === item.id && <ActivityIndicator />}
					</Pressable>
				)}
				ListEmptyComponent={!scanning ? <Text style={styles.empty}>No se encontraron dispositivos</Text> : null}
			/>

			<Pressable style={styles.doneButton} onPress={onDone}>
				<Text style={styles.doneButtonText}>Listo</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, padding: 20, paddingTop: 60 },
	title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
	saved: { color: '#2e7d32', marginBottom: 16 },
	scanningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
	scanningText: { color: '#666' },
	list: { flex: 1 },
	item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
	itemText: { fontSize: 16 },
	empty: { color: '#999', textAlign: 'center', marginTop: 40 },
	doneButton: { backgroundColor: '#1565c0', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
	doneButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
