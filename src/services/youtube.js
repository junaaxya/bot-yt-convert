import ytdl from '@distube/ytdl-core';
import ffmpeg from '../utils/ffmpeg.js';
import { CONFIG } from '../config.js';
import { tempPath, writeStreamToFile } from '../utils/temp.js';
import YtDlpWrap from 'yt-dlp-wrap';
import { promises as fsp } from 'fs';
import ffmpegBin from 'ffmpeg-static';

// Ambil constructor yg benar (mengatasi masalah CJS/ESM interop)
const YtDlpWrapCtor = YtDlpWrap.default || YtDlpWrap;

// Coba pakai binary sistem (yang tadi kamu install di VPS)
const YTDLP_PATH = process.env.YT_DLP_PATH || '/usr/local/bin/yt-dlp'; // lokasi yg kamu install manual

const ytDlp = new YtDlpWrapCtor(YTDLP_PATH);
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

/**
 * Parse YouTube error and return user-friendly Indonesian message
 * @param {Error} error - The error object
 * @returns {string} - User-friendly error message in Indonesian
 */
function parseYouTubeError(error) {
    const msg = String(error?.message || error || '').toLowerCase();

    // Regional lock
    if (
        msg.includes('not available') ||
        msg.includes('country') ||
        msg.includes('geo') ||
        msg.includes('region')
    ) {
        return '❌ Video tidak tersedia di Indonesia (regional lock). Coba video lain.';
    }

    // Private video
    if (
        msg.includes('private') ||
        msg.includes('sign in') ||
        msg.includes('login')
    ) {
        return '❌ Video ini privat atau butuh login. Pastikan video bersifat publik.';
    }

    // Age restricted
    if (
        msg.includes('age') ||
        msg.includes('confirm your age') ||
        msg.includes('mature')
    ) {
        return '❌ Video ini dibatasi usia (18+). Tidak bisa diunduh.';
    }

    // Removed/Deleted
    if (
        msg.includes('removed') ||
        msg.includes('deleted') ||
        msg.includes('no longer available') ||
        msg.includes('unavailable')
    ) {
        return '❌ Video sudah dihapus atau tidak tersedia di YouTube.';
    }

    // Copyright
    if (
        msg.includes('copyright') ||
        msg.includes('blocked') ||
        msg.includes('claim')
    ) {
        return '❌ Video diblokir karena masalah hak cipta.';
    }

    // Duration filter
    if (msg.includes('duration') || msg.includes('too long')) {
        return `❌ Video terlalu panjang (maks ${Math.round(CONFIG.MAX_DURATION_SEC / 60)} menit).`;
    }

    // Size filter
    if (
        msg.includes('filesize') ||
        msg.includes('too large') ||
        msg.includes('size')
    ) {
        return `❌ File terlalu besar (maks ${CONFIG.MAX_FILE_MB} MB).`;
    }

    // Bot/Captcha (will trigger fallback)
    if (
        msg.includes('bot') ||
        msg.includes('captcha') ||
        msg.includes('signature') ||
        msg.includes('extract')
    ) {
        return null; // Return null to signal "try fallback"
    }

    // Live stream
    if (msg.includes('live') || msg.includes('premiere')) {
        return '❌ Live stream atau premiere tidak bisa diunduh. Tunggu sampai selesai.';
    }

    // Invalid URL
    if (msg.includes('invalid') || msg.includes('url')) {
        return '❌ URL YouTube tidak valid. Pastikan link benar.';
    }

    // Generic fallback
    return null; // Return null to signal "try fallback first"
}

// <-- TAMBAHAN: Fungsi fallback yt-dlp untuk MP3
async function ytDlpAudioMP3(url) {
    const out = tempPath('m4a');
    try {
        await ytDlp.execPromise([
            cleanUrl(url),
            '--ffmpeg-location',
            '/usr/bin/ffmpeg',
            '--js-runtime',
            'node',
            '-x',
            '--audio-format',
            'm4a',
            '-f',
            'bestaudio',
            '--max-filesize',
            `${CONFIG.MAX_FILE_MB}m`,
            '--match-filter',
            `duration <= ?${CONFIG.MAX_DURATION_SEC}`,
            '--geo-bypass', // Bypass geo restrictions
            '--no-check-certificate', // Skip SSL issues
            '--no-playlist', // Single video only
            '-o',
            out,
        ]);
    } catch (e) {
        // Parse the error for user-friendly message
        const userMsg = parseYouTubeError(e);
        if (userMsg) throw new Error(userMsg);
        throw new Error(
            '❌ Gagal mengunduh audio. Video mungkin terkunci atau tidak tersedia.',
        );
    }

    try {
        await fsp.stat(out);
    } catch (e) {
        throw new Error(
            '❌ Gagal unduh: Video mungkin terkunci regional, privat, atau melebihi batas durasi/ukuran.',
        );
    }

    return out;
}

// <-- TAMBAHAN: Fungsi fallback yt-dlp untuk MP4
async function ytDlpVideoMP4(url) {
    const out = tempPath('mp4');
    console.log('[yt-dlp] Starting video download to:', out);
    console.log('[yt-dlp] URL:', cleanUrl(url));

    try {
        // Use simplest possible download - no format restrictions
        const result = await ytDlp.execPromise([
            cleanUrl(url),
            '--ffmpeg-location',
            '/usr/bin/ffmpeg',
            '-f',
            'best[ext=mp4]/best', // Simplest: best mp4 or just best
            '--no-playlist',
            '--geo-bypass',
            '--no-check-certificate',
            '-o',
            out,
            '--verbose', // Add verbose output for debugging
        ]);
        console.log('[yt-dlp] Download completed, result:', result);
    } catch (e) {
        console.error('[yt-dlp video error] Full error:', e);
        console.error('[yt-dlp video error] stderr:', e.stderr);
        const userMsg = parseYouTubeError(e);
        if (userMsg) throw new Error(userMsg);
        throw new Error(
            '❌ Gagal mengunduh video: ' + (e.message || 'Unknown error'),
        );
    }

    // Check all possible output files
    const possibleExtensions = ['.mp4', '.webm', '.mkv', ''];
    for (const ext of possibleExtensions) {
        const checkPath = ext ? out.replace(/\.mp4$/, ext) : out;
        try {
            await fsp.stat(checkPath);
            console.log('[yt-dlp] Found file at:', checkPath);

            // If not mp4, convert to mp4
            if (ext && ext !== '.mp4') {
                const mp4Out = tempPath('mp4');
                await new Promise((resolve, reject) => {
                    ffmpeg(checkPath)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .outputOptions([
                            '-pix_fmt',
                            'yuv420p',
                            '-movflags',
                            '+faststart',
                        ])
                        .format('mp4')
                        .on('error', reject)
                        .on('end', resolve)
                        .save(mp4Out);
                });
                await fsp.unlink(checkPath);
                return mp4Out;
            }
            return checkPath;
        } catch {
            // Continue checking other extensions
        }
    }

    // Debug: list /tmp directory to see what files exist
    try {
        const files = await fsp.readdir('/tmp');
        console.log(
            '[yt-dlp] Files in /tmp:',
            files.filter((f) => f.includes('ytdl') || f.includes('yt-dlp')),
        );
    } catch (e) {
        console.log('[yt-dlp] Could not list /tmp');
    }

    throw new Error(
        '❌ Gagal unduh: File tidak ditemukan setelah download. Cek log untuk detail.',
    );
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
        const out = await ytDlpAudioMP3(url);
        return { path: out, fileName: safeName('audio', 'm4a') };
    }
    try {
        const { info, lengthSec } = await getBasicInfo(url); // <-- PERBAIKAN (dari getInfoDistube)
        if (CONFIG.MAX_DURATION_SEC && lengthSec > CONFIG.MAX_DURATION_SEC)
            throw new Error(
                `Video too long: ${(lengthSec / 60).toFixed(1)} min > ${(
                    CONFIG.MAX_DURATION_SEC / 60
                ).toFixed(1)} min`,
            );
        const audio = ytdl.downloadFromInfo(info, {
            ...reqOpts(),
            filter: 'audioonly',
            quality: 'highestaudio',
        });
        const out = tempPath('m4a');
        await new Promise((resolve, reject) => {
            ffmpeg(audio)
                .audioCodec('aac')
                .audioBitrate('256k')
                .format('ipod') // M4A container for iPhone compatibility
                .on('error', reject)
                .on('end', resolve)
                .save(out);
        });
        return {
            path: out,
            fileName: safeName(info.videoDetails.title, 'm4a'),
        };
    } catch (ytdlError) {
        // Check if this is a definitive error that won't be fixed by fallback
        const userMsg = parseYouTubeError(ytdlError);
        if (userMsg) {
            // Definitive error - throw immediately without fallback
            throw new Error(userMsg);
        }

        // Try yt-dlp fallback for all other errors
        console.log(
            '[YouTube] ytdl-core failed, trying yt-dlp fallback:',
            ytdlError.message,
        );
        try {
            const out = await ytDlpAudioMP3(url);
            return { path: out, fileName: safeName('audio', 'm4a') };
        } catch (ytdlpError) {
            // Both failed - parse yt-dlp error for user message
            const ytdlpUserMsg = parseYouTubeError(ytdlpError);
            if (ytdlpUserMsg) throw new Error(ytdlpUserMsg);
            throw new Error(
                '❌ Gagal mengunduh audio. Coba video lain atau cek URL.',
            );
        }
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
                ).toFixed(1)} min`,
            );

        // progressive first
        let format = ytdl.chooseFormat(
            info.formats,
            (f) =>
                f.isHLS === false &&
                f.container === 'mp4' &&
                f.hasAudio &&
                f.hasVideo,
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
    } catch (ytdlError) {
        // Check if this is a definitive error that won't be fixed by fallback
        const userMsg = parseYouTubeError(ytdlError);
        if (userMsg) {
            // Definitive error - throw immediately without fallback
            throw new Error(userMsg);
        }

        // Try yt-dlp fallback for all other errors
        console.log(
            '[YouTube] ytdl-core failed, trying yt-dlp fallback:',
            ytdlError.message,
        );
        try {
            const out = await ytDlpVideoMP4(url);
            return { path: out, fileName: safeName('video', 'mp4') };
        } catch (ytdlpError) {
            // Both failed - parse yt-dlp error for user message
            const ytdlpUserMsg = parseYouTubeError(ytdlpError);
            if (ytdlpUserMsg) throw new Error(ytdlpUserMsg);
            throw new Error(
                '❌ Gagal mengunduh video. Coba video lain atau cek URL.',
            );
        }
    }
}
