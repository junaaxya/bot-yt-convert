import makeWASocket, {
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    DisconnectReason,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { createMessageHandler } from './handlers/messages.js';
import YtDlpWrap from 'yt-dlp-wrap';

let restarting = false;

async function start(retry = 0) {
    try {
        console.log('Checking/Downloading yt-dlp binary...');
        const YtDlpWrapCtor = YtDlpWrap.default || YtDlpWrap;
        await YtDlpWrapCtor.downloadFromGithub();
        console.log('yt-dlp binary is ready.');
    } catch (e) {
        console.error('Failed to download yt-dlp binary:', e);
        process.exit(1); // Keluar jika gagal download, karena fitur utama akan gagal
    }

    const backoff = Math.min(30000, 2000 * Math.pow(1.6, retry));
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        // Render QR ourselves (terminal)
        printQRInTerminal: false,
        browser: ['Chrome', 'Linux', '116.0'],
        // Reduce initial sync load — helps avoid stream error on some networks
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        emitOwnEvents: false,
        connectTimeoutMs: 60_000,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection) console.log('connection:', connection);

        if (connection === 'close') {
            const code =
                lastDisconnect?.error?.output?.statusCode ||
                lastDisconnect?.error?.status ||
                lastDisconnect?.error?.reason;
            const isRestartable =
                code !== DisconnectReason.loggedOut && code !== 401;
            console.log(
                'disconnect reason:',
                lastDisconnect?.error?.message || code
            );

            if (!restarting && isRestartable) {
                restarting = true;
                console.log(`Reconnecting in ${backoff}ms...`);
                setTimeout(() => {
                    restarting = false;
                    start(retry + 1).catch((e) => {
                        console.error('Fatal restart error:', e);
                        process.exit(1);
                    });
                }, backoff);
            } else if (!isRestartable) {
                console.log(
                    'Session logged out / not restartable. Delete auth/ and relogin.'
                );
            }
        }
    });

    createMessageHandler(sock);
}

start().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
});
