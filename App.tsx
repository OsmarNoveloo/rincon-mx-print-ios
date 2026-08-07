import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { base64ToBytes } from './src/base64';
import { getSavedPrinter, pingPrinter, printBytes, subscribeBluetoothState, type SavedPrinter } from './src/ble';
import { PrinterSettings } from './src/PrinterSettings';

type PrintStatus = { kind: 'idle' } | { kind: 'printing' } | { kind: 'success' } | { kind: 'error'; message: string };
type ConnStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';

function parsePrintUrl(url: string): Uint8Array | null {
	const match = url.match(/^rinconprint:\/\/print\?data=(.+)$/);
	if (!match) return null;
	return base64ToBytes(decodeURIComponent(match[1]));
}

function Dot({ color }: { color: string }) {
	return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export default function App() {
	const [screen, setScreen] = useState<'home' | 'settings'>('home');
	const [printStatus, setPrintStatus] = useState<PrintStatus>({ kind: 'idle' });

	const [bluetoothState, setBluetoothState] = useState('Unknown');
	const [printer, setPrinter] = useState<SavedPrinter | null>(null);
	const [connStatus, setConnStatus] = useState<ConnStatus>('unknown');

	const refreshPrinter = useCallback(async () => {
		const saved = await getSavedPrinter();
		setPrinter(saved);
		setConnStatus('unknown');
		return saved;
	}, []);

	const checkConnection = useCallback(async (target?: SavedPrinter | null) => {
		const savedPrinter = target ?? printer;
		if (!savedPrinter) return;
		setConnStatus('checking');
		const ok = await pingPrinter(savedPrinter.deviceId);
		setConnStatus(ok ? 'connected' : 'disconnected');
	}, [printer]);

	useEffect(() => {
		const unsubscribe = subscribeBluetoothState(setBluetoothState);
		refreshPrinter().then((saved) => checkConnection(saved));
		return unsubscribe;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleUrl(url: string | null) {
		const bytes = url ? parsePrintUrl(url) : null;
		if (!bytes) return;

		setPrintStatus({ kind: 'printing' });
		try {
			await printBytes(bytes);
			setPrintStatus({ kind: 'success' });
			checkConnection();
		} catch (err) {
			setPrintStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
			checkConnection();
		}
	}

	useEffect(() => {
		Linking.getInitialURL().then(handleUrl);
		const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
		return () => subscription.remove();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleCloseSettings() {
		setScreen('home');
		const saved = await refreshPrinter();
		checkConnection(saved);
	}

	if (screen === 'settings') {
		return <PrinterSettings onDone={handleCloseSettings} />;
	}

	const bluetoothOn = bluetoothState === 'PoweredOn';

	return (
		<View style={styles.container}>
			<Text style={styles.title}>Rincon Print</Text>

			<View style={styles.card}>
				<View style={styles.row}>
					<Dot color={bluetoothOn ? '#2e7d32' : '#c62828'} />
					<Text style={styles.rowText}>Bluetooth {bluetoothOn ? 'encendido' : 'apagado'}</Text>
				</View>

				<View style={styles.row}>
					{connStatus === 'checking' ? (
						<ActivityIndicator size="small" />
					) : (
						<Dot color={connStatus === 'connected' ? '#2e7d32' : connStatus === 'disconnected' ? '#c62828' : '#999'} />
					)}
					<Text style={styles.rowText} numberOfLines={1}>
						{printer ? printer.deviceName : 'Sin impresora configurada'}
					</Text>
				</View>

				{printer && (
					<Pressable style={styles.checkButton} onPress={() => checkConnection()} disabled={connStatus === 'checking'}>
						<Text style={styles.checkButtonText}>Verificar conexión</Text>
					</Pressable>
				)}
			</View>

			{printStatus.kind === 'idle' && <Text style={styles.subtitle}>Esperando un ticket para imprimir…</Text>}
			{printStatus.kind === 'printing' && (
				<>
					<ActivityIndicator size="large" />
					<Text style={styles.subtitle}>Imprimiendo…</Text>
				</>
			)}
			{printStatus.kind === 'success' && <Text style={styles.success}>Ticket enviado a la impresora ✔</Text>}
			{printStatus.kind === 'error' && <Text style={styles.error}>{printStatus.message}</Text>}

			<Pressable style={styles.settingsButton} onPress={() => setScreen('settings')}>
				<Text style={styles.settingsButtonText}>Configurar impresora</Text>
			</Pressable>

			<StatusBar style="auto" />
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
	title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
	card: { width: '100%', borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 16, gap: 10, backgroundColor: '#fafafa' },
	row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	rowText: { fontSize: 15, flexShrink: 1 },
	dot: { width: 10, height: 10, borderRadius: 5 },
	checkButton: { alignSelf: 'flex-start', marginTop: 4 },
	checkButtonText: { color: '#1565c0', fontWeight: '600', fontSize: 13 },
	subtitle: { color: '#666' },
	success: { color: '#2e7d32', fontSize: 16 },
	error: { color: '#c62828', fontSize: 14, textAlign: 'center' },
	settingsButton: { marginTop: 24, borderWidth: 1, borderColor: '#1565c0', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
	settingsButtonText: { color: '#1565c0', fontWeight: '600' },
});
