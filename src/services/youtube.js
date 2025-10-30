import ytdl from '@distube/ytdl-core';
import ffmpeg from '../utils/ffmpeg.js';
import { CONFIG } from '../config.js';
import { tempPath, writeStreamToFile } from '../utils/temp.js';
import YtDlpWrap from 'yt-dlp-wrap';
import { promises as fsp } from 'fs';
import ffmpegBin from 'ffmpeg-static';

// Ambil constructor yg benar (mengatasi masalah CJS/ESM interop)
const YtDlpWrapCtor = YtDlpWrap.default || YtDlpWrap;
const ytDlp = new YtDlpWrapCtor();
const FORCE_YTDLP = String(process.env.USE_YTDLP || '').trim() === '1';

function cleanUrl(url) {
    try {
        const u = new URL(url.trim());
        // Strip tracking params that sometimes break parsers
        [
            'si',
            'pp',
            'feature',
            'embeds_referring_euri',
            'source',
            'app',
        ].forEach((k) => u.searchParams.delete(k));
        return u.toString();
    } catch {
        return url;
    }
}

function reqOpts() {
    const headers = {
        'user-agent': CONFIG.YTDL_USER_AGENT || 'Mozilla/5.0',
        'accept-language': 'en-US,en;q=0.9',
    };
    return { requestOptions: { headers } };
}

// <-- TAMBAHAN: Fungsi untuk membersihkan nama file
function safeName(title, ext) {
    const sane = (title || 'video')
        .replace(/[^a-z0-9\s-]/gi, '_')
        .replace(/\s+/g, ' ');
    return sane.slice(0, 50) + '.' + ext;
}

// <-- TAMBAHAN: Fungsi fallback yt-dlp untuk MP3
async function ytDlpAudioMP3(url) {
    const out = tempPath('mp3');
    await ytDlp.execPromise([
        cleanUrl(url),
        '--ffmpeg-location',
        ffmpegBin,
        '-x', // extract audio
        '--audio-format',
        'mp3',
        '--audio-quality',
        '192K',
        '-f',
        'bestaudio',
        '--max-filesize',
        `${CONFIG.MAX_FILE_MB}m`,
        '--match-filter',
        `duration <= ?${CONFIG.MAX_DURATION_SEC}`,
        '-o',
        out,
    ]);
    try {
        await fsp.stat(out);
    } catch (e) {
        // Jika file tidak ada, lempar error yang lebih jelas
        throw new Error(
            'Gagal unduh: yt-dlp tidak membuat file. Video mungkin terkunci regional, privat, atau terfilter (durasi/ukuran).'
        );
    }

    return out;
}

// <-- TAMBAHAN: Fungsi fallback yt-dlp untuk MP4 (INI YANG MENYEBABKAN ERROR)
async function ytDlpVideoMP4(url) {
    const out = tempPath('mp4');
    await ytDlp.execPromise([
        cleanUrl(url),
        '--ffmpeg-location',
        ffmpegBin,
        '-f',
        `bestvideo[height<=?720][ext=mp4]+bestaudio[ext=m4a]/best[height<=?720][ext=mp4]`,
        '--merge-output-format',
        'mp4',
        '--max-filesize',
        `${CONFIG.MAX_FILE_MB}m`,
        '--match-filter',
        `duration <= ?${CONFIG.MAX_DURATION_SEC}`,
        '-o',
        out,
    ]);
    try {
        await fsp.stat(out);
    } catch (e) {
        // Jika file tidak ada, lempar error yang lebih jelas
        throw new Error(
            'Gagal unduh: yt-dlp tidak membuat file. Video mungkin terkunci regional, privat, atau terfilter (durasi/ukuran).'
        );
    }
    return out;
}

export async function getBasicInfo(url) {
    const u = cleanUrl(url);
    if (!ytdl.validateURL(u)) throw new Error('Invalid YouTube URL');
    const info = await ytdl.getInfo(u, reqOpts());
    const lengthSec = Number(info.videoDetails.lengthSeconds || 0);
    const title = info.videoDetails.title || 'video';
    return { info, lengthSec, title };
}

export async function downloadYouTubeMP3(url) {
    // Force yt-dlp on server if requested
    if (FORCE_YTDLP) {
        const out = await ytDlpAudioMP3(url); // Sekarang sudah didefinisikan
        return { path: out, fileName: safeName('audio', 'mp3') }; // Sekarang sudah didefinisikan
    }
    try {
        const { info, lengthSec } = await getBasicInfo(url); // <-- PERBAIKAN (dari getInfoDistube)
        if (CONFIG.MAX_DURATION_SEC && lengthSec > CONFIG.MAX_DURATION_SEC)
            throw new Error(
                `Video too long: ${(lengthSec / 60).toFixed(1)} min > ${(
                    CONFIG.MAX_DURATION_SEC / 60
                ).toFixed(1)} min`
            );
        const audio = ytdl.downloadFromInfo(info, {
            ...reqOpts(),
            filter: 'audioonly',
            quality: 'highestaudio',
        });
        const out = tempPath('mp3');
        await new Promise((resolve, reject) => {
            ffmpeg(audio)
                .audioCodec('libmp3lame')
                .audioBitrate('192k')
                .format('mp3')
                .on('error', reject)
                .on('end', resolve)
                .save(out);
        });
        return {
            path: out,
            fileName: safeName(info.videoDetails.title, 'mp3'), // Sekarang sudah didefinisikan
        };
    } catch (e) {
        // broader match for any bot/captcha/signature issues
        if (
            /(confirm (you('|’|’)re|you are) not a bot|extract functions|captcha|signature)/i.test(
                String(e?.message)
            )
        ) {
            const out = await ytDlpAudioMP3(url); // Sekarang sudah didefinisikan
            return { path: out, fileName: safeName('audio', 'mp3') }; // Sekarang sudah didefinisikan
        }
        throw e;
    }
}

export async function downloadYouTubeMP4(url) {
    if (FORCE_YTDLP) {
        const out = await ytDlpVideoMP4(url); // Sekarang sudah didefinisikan
        return { path: out, fileName: safeName('video', 'mp4') }; // Sekarang sudah didefinisikan
    }
    try {
        const { info, lengthSec, title } = await getBasicInfo(url); // <-- PERBAIKAN (dari getInfoDistube)
        if (CONFIG.MAX_DURATION_SEC && lengthSec > CONFIG.MAX_DURATION_SEC)
            throw new Error(
                `Video too long: ${(lengthSec / 60).toFixed(1)} min > ${(
                    CONFIG.MAX_DURATION_SEC / 60
                ).toFixed(1)} min`
            );

        // progressive first
        let format = ytdl.chooseFormat(
            info.formats,
            (f) =>
                f.isHLS === false &&
                f.container === 'mp4' &&
                f.hasAudio &&
                f.hasVideo
        );
        if (format && format.url) {
            const vs = ytdl.downloadFromInfo(info, { ...reqOpts(), format });
            const out = tempPath('mp4');
            await writeStreamToFile(vs, out);
            return { path: out, fileName: safeName(title, 'mp4') }; // Sekarang sudah didefinisikan
        }

        // mux fallback
        const video = ytdl.downloadFromInfo(info, {
            ...reqOpts(),
            filter: (f) => f.hasVideo && !f.hasAudio,
            quality: 'highestvideo',
        });
        const audio = ytdl.downloadFromInfo(info, {
            ...reqOpts(),
            filter: 'audioonly',
            quality: 'highestaudio',
        });
        const out = tempPath('mp4');
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(video)
                .input(audio)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions(['-shortest'])
                .format('mp4')
                .on('error', reject)
                .on('end', resolve)
                .save(out);
        });
        return { path: out, fileName: safeName(title, 'mp4') }; // Sekarang sudah didefinisikan
    } catch (e) {
        if (
            /(confirm (you('|’|’)re|you are) not a bot|extract functions|captcha|signature)/i.test(
                String(e?.message)
            )
        ) {
            const out = await ytDlpVideoMP4(url); // Sekarang sudah didefinisikan
            return { path: out, fileName: safeName('video', 'mp4') }; // Sekarang sudah didefinisikan
        }
        throw e;
    }
}
