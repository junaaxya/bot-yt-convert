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
import { applyPitchShift, applyKaraoke } from '../services/audioEffects.js';
import { CONFIG } from '../config.js';

export function createMessageHandler(sock, logger = console) {
    const queue = new PQueue({ concurrency: CONFIG.MAX_CONCURRENCY });

    // Helper: Clean up temp file safely
    const cleanup = async (path) => {
        try {
            if (path) await safeUnlink(path);
        } catch (e) {
            logger.error(`Cleanup failed for ${path}:`, e);
        }
    };

    async function reply(jid, content, opts = {}) {
        return sock.sendMessage(jid, { text: content }, opts);
    }

    // Fungsi untuk mengirim audio (menggantikan sendDoc)
    async function sendAudio(jid, path, fileName, mimetype, opts = {}) {
        return sock.sendMessage(
            jid,
            { audio: { url: path }, fileName, mimetype },
            opts,
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
            'Tidak menemukan media. Balas *video/audio* dengan perintah, atau kirim media + caption perintah.',
        );
    }

    // --- PERBAIKAN ALTERNATIF DIMULAI DI SINI ---

    // 1. Fungsi 'handleYouTube' sekarang menerima 'safeQuote'
    async function handleYouTube(type, url, jid, safeQuote) {
        return queue.add(async () => {
            await reply(
                jid,
                `⏳ Tunggu yaa bitaa.. ${type.toUpperCase()} nya… masih di download`,
                { quoted: safeQuote }, // 2. Menggunakan 'safeQuote'
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
                const menuText = `🎵 *BITAA MUSIC BOT* 🎵

━━━━━━━━━━━━━━━━━━━━
📥 *DOWNLOAD YOUTUBE*
━━━━━━━━━━━━━━━━━━━━
▸ *.ytmp3* <url> → Download Lagu
▸ *.ytmp4* <url> → Download Video

━━━━━━━━━━━━━━━━━━━━
🎹 *AUDIO TOOLS*
━━━━━━━━━━━━━━━━━━━━
▸ *.pitch* <-12 s/d +12>
   🔽 Turunkan: *.pitch -2*
   🔼 Naikkan: *.pitch 2*

▸ *.karaoke* / *.vokaloff*
   🎤 Hapus vokal dengan AI

━━━━━━━━━━━━━━━━━━━━
🔄 *KONVERSI*
━━━━━━━━━━━━━━━━━━━━
▸ *.to_mp3* → Video jadi Audio
▸ *.to_mp4* → Audio jadi Video

⚠️ *Batas:* ${CONFIG.MAX_DURATION_SEC / 60} menit | ${CONFIG.MAX_FILE_MB} MB
💖 Bot: *Bitaa*`;
                await reply(jid, menuText, { quoted: safeQuote });
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
                            'Pesan bukan video. Balas sebuah *video* dengan .to_mp3',
                        );
                    await reply(
                        jid,
                        '⏳Tunggu yaa bitaa.. Converting to Audio (M4A)…',
                        { quoted: safeQuote }, // 12. Menggunakan 'safeQuote'
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
                            'Pesan bukan audio. Balas sebuah *audio* dengan .to_mp4',
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

            if (cmd === '.pitch') {
                return queue.add(async () => {
                    if (!arg) {
                        return reply(
                            jid,
                            'Kirim/Balas audio dengan: *.pitch <angka>*\nContoh: *.pitch -1* atau *.pitch 1,5*',
                            {
                                quoted: safeQuote,
                            },
                        );
                    }

                    // 1. Parse number (handle comma as dot for Indo users)
                    const valStr = arg.replace(',', '.');
                    const semitones = parseFloat(valStr);

                    if (isNaN(semitones)) {
                        return reply(
                            jid,
                            '❌ Angka tidak valid. Contoh: .pitch 0,5',
                            { quoted: safeQuote },
                        );
                    }

                    // 2. Validate range (safety)
                    if (semitones < -12 || semitones > 12) {
                        return reply(
                            jid,
                            '❌ Batas: -12 sampai +12 semitones.',
                            { quoted: safeQuote },
                        );
                    }

                    // 3. Get media
                    let out;
                    try {
                        const res = await downloadQuotedOrOwnMedia(m);
                        if (!res.isAudio && !res.isVideo) {
                            await cleanup(res.out);
                            throw new Error('Harap balas ke AUDIO atau VIDEO.');
                        }
                        out = res.out;
                    } catch (e) {
                        return reply(jid, `❌ ${e.message}`, {
                            quoted: safeQuote,
                        });
                    }

                    await reply(
                        jid,
                        `⏳ Tunggu yaa bitaa.. Mengubah nada sebesar ${semitones} semitones...`,
                        { quoted: safeQuote },
                    );

                    try {
                        // 4. Process
                        const { path: resultPath, fileName } =
                            await applyPitchShift(out, semitones);
                        await ensureWithinLimit(resultPath);

                        // 5. Send back
                        await sendAudio(
                            jid,
                            resultPath,
                            fileName,
                            'audio/mp4',
                            { quoted: safeQuote },
                        );

                        await cleanup(resultPath);
                    } catch (e) {
                        console.error('Pitch Error:', e);
                        await reply(jid, `❌ Gagal: ${e.message}`, {
                            quoted: safeQuote,
                        });
                    } finally {
                        await cleanup(out);
                    }
                });
            }

            if (cmd === '.karaoke' || cmd === '.vokaloff') {
                return queue.add(async () => {
                    let out;
                    try {
                        const res = await downloadQuotedOrOwnMedia(m);
                        if (!res.isAudio && !res.isVideo) {
                            await cleanup(res.out);
                            throw new Error('Harap balas ke AUDIO atau VIDEO.');
                        }
                        out = res.out;
                    } catch (e) {
                        return reply(jid, `❌ ${e.message}`, {
                            quoted: safeQuote,
                        });
                    }

                    await reply(
                        jid,
                        '⏳ Tunggu yaa bitaa... sedang memisahkan vokal...',
                        { quoted: safeQuote },
                    );

                    try {
                        const { path: resultPath, fileName } =
                            await applyKaraoke(out);
                        await ensureWithinLimit(resultPath);
                        await sendAudio(
                            jid,
                            resultPath,
                            fileName,
                            'audio/mp4',
                            { quoted: safeQuote },
                        );
                        await cleanup(resultPath);
                    } catch (e) {
                        console.error('Karaoke Error:', e);
                        await reply(jid, `❌ Gagal: ${e.message}`, {
                            quoted: safeQuote,
                        });
                    } finally {
                        await cleanup(out);
                    }
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
