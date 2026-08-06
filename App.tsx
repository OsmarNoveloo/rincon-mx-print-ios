import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { base64ToBytes } from './src/base64';
import { printBytes } from './src/ble';
import { PrinterSettings } from './src/PrinterSettings';

type Status = { kind: 'idle' } | { kind: 'printing' } | { kind: 'success' } | { kind: 'error'; message: string };

function parsePrintUrl(url: string): Uint8Array | null {
	const match = url.match(/^rinconprint:\/\/print\?data=(.+)$/);
	if (!match) return null;
	return base64ToBytes(decodeURIComponent(match[1]));
}

export default function App() {
	const [screen, setScreen] = useState<'home' | 'settings'>('home');
	const [status, setStatus] = useState<Status>({ kind: 'idle' });

	async function handleUrl(url: string | null) {
		const bytes = url ? parsePrintUrl(url) : null;
		if (!bytes) return;

		setStatus({ kind: 'printing' });
		try {
			await printBytes(bytes);
			setStatus({ kind: 'success' });
		} catch (err) {
			setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}

	useEffect(() => {
		Linking.getInitialURL().then(handleUrl);
		const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
		return () => subscription.remove();
	}, []);

	if (screen === 'settings') {
		return <PrinterSettings onDone={() => setScreen('home')} />;
	}

	return (
		<View style={styles.container}>
			<Text style={styles.title}>Rincon Print</Text>

			{status.kind === 'idle' && <Text style={styles.subtitle}>Esperando un ticket para imprimir…</Text>}
			{status.kind === 'printing' && (
				<>
					<ActivityIndicator size="large" />
					<Text style={styles.subtitle}>Imprimiendo…</Text>
				</>
			)}
			{status.kind === 'success' && <Text style={styles.success}>Ticket enviado a la impresora ✔</Text>}
			{status.kind === 'error' && <Text style={styles.error}>{status.message}</Text>}

			<Pressable style={styles.settingsButton} onPress={() => setScreen('settings')}>
				<Text style={styles.settingsButtonText}>Configurar impresora</Text>
			</Pressable>

			<StatusBar style="auto" />
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
	title: { fontSize: 24, fontWeight: '700' },
	subtitle: { color: '#666' },
	success: { color: '#2e7d32', fontSize: 16 },
	error: { color: '#c62828', fontSize: 14, textAlign: 'center' },
	settingsButton: { marginTop: 24, borderWidth: 1, borderColor: '#1565c0', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
	settingsButtonText: { color: '#1565c0', fontWeight: '600' },
});
