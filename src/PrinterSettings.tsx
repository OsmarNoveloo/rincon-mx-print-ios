import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Device } from 'react-native-ble-plx';
import { ensurePermissions, listWritableCharacteristics, savePrinter, scanForDevices, testCandidate, type Candidate, type SavedPrinter } from './ble';

export function PrinterSettings({ onDone }: { onDone: () => void }) {
	const [devices, setDevices] = useState<Device[]>([]);
	const [scanning, setScanning] = useState(false);
	const [saved, setSaved] = useState<SavedPrinter | null>(null);

	const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
	const [candidates, setCandidates] = useState<Candidate[] | null>(null);
	const [busyIndex, setBusyIndex] = useState<number | null>(null);
	const [loadingCandidates, setLoadingCandidates] = useState(false);

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

	async function handleSelectDevice(device: Device) {
		setSelectedDevice(device);
		setLoadingCandidates(true);
		try {
			const found = await listWritableCharacteristics(device);
			setCandidates(found);
			if (found.length === 0) Alert.alert('Sin characteristics de escritura', 'Este dispositivo no expone nada a lo que se le pueda mandar datos.');
		} catch (err) {
			Alert.alert('No se pudo conectar', err instanceof Error ? err.message : String(err));
			setSelectedDevice(null);
		} finally {
			setLoadingCandidates(false);
		}
	}

	async function handleTest(candidate: Candidate, index: number) {
		if (!selectedDevice) return;
		setBusyIndex(index);
		try {
			await testCandidate(selectedDevice, candidate);
			Alert.alert('¿Salió el ticket de prueba?', 'Revisa la impresora física.', [
				{ text: 'No salió nada', style: 'cancel' },
				{
					text: 'Sí, imprimió',
					onPress: async () => {
						const printer = await savePrinter(selectedDevice.id, selectedDevice.name ?? selectedDevice.localName ?? selectedDevice.id, candidate);
						setSaved(printer);
						setSelectedDevice(null);
						setCandidates(null);
						Alert.alert('Impresora guardada', printer.deviceName);
					},
				},
			]);
		} catch (err) {
			Alert.alert('Error al mandar la prueba', err instanceof Error ? err.message : String(err));
		} finally {
			setBusyIndex(null);
		}
	}

	if (selectedDevice) {
		return (
			<View style={styles.container}>
				<Text style={styles.title}>{selectedDevice.name ?? selectedDevice.localName ?? selectedDevice.id}</Text>
				<Text style={styles.subtitle}>Prueba cada opción hasta encontrar la que realmente imprime</Text>

				{loadingCandidates && <ActivityIndicator style={{ marginTop: 20 }} />}

				<FlatList
					data={candidates ?? []}
					keyExtractor={(c, i) => `${c.serviceUUID}-${c.characteristicUUID}-${i}`}
					style={styles.list}
					renderItem={({ item, index }) => (
						<View style={styles.candidateItem}>
							<View style={{ flex: 1 }}>
								<Text style={styles.candidateText} numberOfLines={1}>
									svc {item.serviceUUID}
								</Text>
								<Text style={styles.candidateText} numberOfLines={1}>
									char {item.characteristicUUID}
								</Text>
							</View>
							<Pressable style={styles.testButton} onPress={() => handleTest(item, index)} disabled={busyIndex !== null}>
								{busyIndex === index ? <ActivityIndicator color="#fff" /> : <Text style={styles.testButtonText}>Probar</Text>}
							</Pressable>
						</View>
					)}
				/>

				<Pressable
					style={styles.doneButton}
					onPress={() => {
						setSelectedDevice(null);
						setCandidates(null);
					}}
				>
					<Text style={styles.doneButtonText}>Volver a la lista</Text>
				</Pressable>
			</View>
		);
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
					<Pressable style={styles.item} onPress={() => handleSelectDevice(item)}>
						<Text style={styles.itemText}>{item.name ?? item.localName ?? item.id}</Text>
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
	subtitle: { color: '#666', marginBottom: 12 },
	saved: { color: '#2e7d32', marginBottom: 16 },
	scanningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
	scanningText: { color: '#666' },
	list: { flex: 1 },
	item: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
	itemText: { fontSize: 16 },
	candidateItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
	candidateText: { fontSize: 11, color: '#555' },
	testButton: { backgroundColor: '#1565c0', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
	testButtonText: { color: '#fff', fontWeight: '600' },
	empty: { color: '#999', textAlign: 'center', marginTop: 40 },
	doneButton: { backgroundColor: '#1565c0', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
	doneButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
