import { downloadMediaMessage } from '@whiskeysockets/baileys';
import PQueue from 'p-queue';
import { parseCommand, getTextFromMessage } from '../utils/wa.js';
import { tempPath, safeUnlink, writeStreamToFile } from '../utils/temp.js';
import {
    mp4ToMp3,
    mp3ToMp4,
    ensureWithinLimit,
} from '../services/converter.js';
import { downloadYouTubeMP3, downloadYouTubeMP4 } from '../services/youtube.js';
import { CONFIG } from '../config.js';

export function createMessageHandler(sock, logger = console) {
    const queue = new PQueue({ concurrency: CONFIG.MAX_CONCURRENCY });

    async function reply(jid, content, opts = {}) {
        return sock.sendMessage(jid, { text: content }, opts);
    }

    // Fungsi untuk mengirim audio (menggantikan sendDoc)
    async function sendAudio(jid, path, fileName, mimetype, opts = {}) {
        return sock.sendMessage(
            jid,
            { audio: { url: path }, fileName, mimetype },
            opts
        );
    }

    async function sendVideo(jid, path, caption, opts = {}) {
        return sock.sendMessage(jid, { video: { url: path }, caption }, opts);
    }

    // Fungsi unwrap (pembuka) pesan
    function unwrap(msg) {
        let m = msg;
        if (m?.ephemeralMessage) m = m.ephemeralMessage.message;
        if (m?.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
        if (m?.viewOnceMessage) m = m.viewOnceMessage.message;
        return m || {};
    }

    function pickMediaMessage(container) {
        const mm = unwrap(container);
        if (mm.videoMessage)
            return {
                kind: 'video',
                message: { videoMessage: mm.videoMessage },
            };
        if (mm.audioMessage)
            return {
                kind: 'audio',
                message: { audioMessage: mm.audioMessage },
            };
        if (mm.imageMessage)
            return {
                kind: 'image',
                message: { imageMessage: mm.imageMessage },
            };
        if (mm.documentMessage)
            return {
                kind: 'document',
                message: { documentMessage: mm.documentMessage },
            };
        return null;
    }

    async function downloadQuotedOrOwnMedia(message) {
        const ctx = message?.message?.extendedTextMessage?.contextInfo;

        // 1) Prefer quoted media (reply)
        const q = ctx?.quotedMessage
            ? pickMediaMessage(ctx.quotedMessage)
            : null;
        if (q) {
            const mediaMsg = { key: message.key, message: q.message };
            const stream = await downloadMediaMessage(mediaMsg, 'stream');
            const ext =
                q.kind === 'video' ? 'mp4' : q.kind === 'audio' ? 'mp3' : 'bin';
            const out = tempPath(ext);
            await writeStreamToFile(stream, out);
            return {
                out,
                isVideo: q.kind === 'video',
                isAudio: q.kind === 'audio',
            };
        }

        // 2) Fallback: the incoming message itself contains media with caption command
        const own = pickMediaMessage(message.message);
        if (own) {
            const mediaMsg = { key: message.key, message: own.message };
            const stream = await downloadMediaMessage(mediaMsg, 'stream');
            const ext =
                own.kind === 'video'
                    ? 'mp4'
                    : own.kind === 'audio'
                    ? 'mp3'
                    : 'bin';
            const out = tempPath(ext);
            await writeStreamToFile(stream, out);
            return {
                out,
                isVideo: own.kind === 'video',
                isAudio: own.kind === 'audio',
            };
        }

        throw new Error(
            'Tidak menemukan media. Balas *video/audio* dengan perintah, atau kirim media + caption perintah.'
        );
    }

    // --- PERBAIKAN ALTERNATIF DIMULAI DI SINI ---

    // 1. Fungsi 'handleYouTube' sekarang menerima 'safeQuote'
    async function handleYouTube(type, url, jid, safeQuote) {
        return queue.add(async () => {
            await reply(
                jid,
                `⏳ Tunggu yaa ${type.toUpperCase()} nya… masih di download`,
                { quoted: safeQuote } // 2. Menggunakan 'safeQuote'
            );
            try {
                if (type === 'mp3') {
                    const { path, fileName } = await downloadYouTubeMP3(url);
                    await ensureWithinLimit(path);
                    await sendAudio(jid, path, fileName, 'audio/mp4', {
                        quoted: safeQuote, // 3. Menggunakan 'safeQuote'
                    });
                    await safeUnlink(path);
                } else {
                    const { path, fileName } = await downloadYouTubeMP4(url);
                    await ensureWithinLimit(path);
                    await sendVideo(jid, path, fileName, {
                        quoted: safeQuote, // 4. Menggunakan 'safeQuote'
                    });
                    await safeUnlink(path);
                }
            } catch (e) {
                logger.error(e);
                await reply(jid, `❌ Failed: ${e.message || e}`, {
                    quoted: safeQuote, // 5. Menggunakan 'safeQuote'
                });
            }
        });
    }

    async function onMessageUpsert({ messages }) {
        const m = messages?.[0];
        if (!m || !m.message || m.key.fromMe) return;
        const jid = m.key.remoteJid;
        const text = getTextFromMessage(m);
        if (!text.startsWith('.')) return; // only handle dot-prefixed commands

        const { cmd, arg } = parseCommand(text);

        // 6. ---- INI ADALAH SOLUSI BARU ----
        // Kita buat salinan dari 'm' dan 'membuka' pesan kompleks.
        // Ini (semoga) akan disukai oleh Baileys DAN iPhone.
        const safeQuote = { ...m };
        if (safeQuote.message?.ephemeralMessage) {
            safeQuote.message = safeQuote.message.ephemeralMessage.message;
        }
        if (safeQuote.message?.viewOnceMessageV2) {
            safeQuote.message = safeQuote.message.viewOnceMessageV2.message;
        }
        if (safeQuote.message?.viewOnceMessage) {
            safeQuote.message = safeQuote.message.viewOnceMessage.message;
        }
        // ---- AKHIR SOLUSI BARU ----

        try {
            if (cmd === '.help' || cmd === '.menu') {
                await reply(
                    jid,
                    `🤖 *WhatsApp Converter Bot*

Commands:
• *.ytmp3 <url>* – Download YouTube as MP3
• *.ytmp4 <url>* – Download YouTube as MP4
• Reply a video with *.to_mp3* OR send video with caption *.to_mp3*
• Reply an audio with *.to_mp4* OR send audio with caption *.to_mp4*

Limits: duration ≤ ${CONFIG.MAX_DURATION_SEC / 60} min, size ≤ ${
                        CONFIG.MAX_FILE_MB
                    } MB.`,
                    { quoted: safeQuote } // 7. Menggunakan 'safeQuote'
                );
                return;
            }

            if (cmd === '.ytmp3') {
                if (!arg)
                    return reply(jid, 'Send: *.ytmp3 <YouTube URL>*', {
                        quoted: safeQuote, // 8. Menggunakan 'safeQuote'
                    });
                return handleYouTube('mp3', arg, jid, safeQuote); // 9. Menggunakan 'safeQuote'
            }

            if (cmd === '.ytmp4') {
                if (!arg)
                    return reply(jid, 'Send: *.ytmp4 <YouTube URL>*', {
                        quoted: safeQuote, // 10. Menggunakan 'safeQuote'
                    });
                return handleYouTube('mp4', arg, jid, safeQuote); // 11. Menggunakan 'safeQuote'
            }
            if (cmd === '.to_mp3') {
                return queue.add(async () => {
                    const { out, isVideo } = await downloadQuotedOrOwnMedia(m);
                    if (!isVideo)
                        throw new Error(
                            'Pesan bukan video. Balas sebuah *video* dengan .to_mp3'
                        );
                    await reply(
                        jid,
                        '⏳ Converting to Audio (M4A)…',
                        { quoted: safeQuote } // 12. Menggunakan 'safeQuote'
                    );
                    const m4a = await mp4ToMp3(out);
                    await ensureWithinLimit(m4a);
                    await sendAudio(jid, m4a, 'output.m4a', 'audio/mp4', {
                        quoted: safeQuote, // 13. Menggunakan 'safeQuote'
                    });
                    await safeUnlink(out);
                    await safeUnlink(m4a);
                });
            }

            if (cmd === '.to_mp4') {
                return queue.add(async () => {
                    const { out, isAudio } = await downloadQuotedOrOwnMedia(m);
                    if (!isAudio)
                        throw new Error(
                            'Pesan bukan audio. Balas sebuah *audio* dengan .to_mp4'
                        );
                    await reply(jid, '⏳ Converting to MP4…', {
                        quoted: safeQuote, // 14. Menggunakan 'safeQuote'
                    });
                    const mp4 = await mp3ToMp4(out);
                    await ensureWithinLimit(mp4);
                    await sendVideo(jid, mp4, 'output.mp4', {
                        quoted: safeQuote, // 15. Menggunakan 'safeQuote'
                    });
                    await safeUnlink(out);
                    await safeUnlink(mp4);
                });
            }
        } catch (e) {
            console.error(e);
            await reply(jid, `❌ Error: ${e.message || e}`, {
                quoted: safeQuote, // 16. Menggunakan 'safeQuote'
            });
        }
    }

    sock.ev.on('messages.upsert', onMessageUpsert);
}
