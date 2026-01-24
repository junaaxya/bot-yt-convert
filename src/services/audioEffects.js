import ffmpeg from '../utils/ffmpeg.js';
import { tempPath } from '../utils/temp.js';
import { promises as fsp } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Apply pitch shift to an audio file
 * @param {string} inputPath - Path to input audio file
 * @param {number} semitones - Number of semitones to shift (e.g., -1, 0.5, 2)
 * @returns {Promise<{path: string, fileName: string}>}
 */
export async function applyPitchShift(inputPath, semitones) {
    // 1. Get input sample rate to prevent duration drift (48k vs 44.1k issue)
    const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
        });
    });

    // Default to 44100 if probing fails or missing
    const inputRate =
        metadata.streams.find((s) => s.codec_type === 'audio')?.sample_rate ||
        44100;

    // 2. Calculate frequency ratio: f = 2^(n/12)
    const ratio = Math.pow(2, semitones / 12);

    // 3. New sample rate based on INPUT rate
    const newRate = Math.round(inputRate * ratio);

    // 4. Tempo compensation (to keep original duration)
    // If we pitch up (ratio > 1), audio gets faster, so we must slow down (tempo < 1)
    const tempo = 1 / ratio;

    const out = tempPath('mp3');

    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            // Trick: set audio sample rate (asetrate) to change pitch + speed
            .audioFilters([
                `asetrate=${newRate}`,
                `atempo=${tempo.toFixed(4)}`,
                // Resample back to original rate to standardise output
                `aresample=${inputRate}`,
            ])
            .format('mp3')
            .on('error', reject)
            .on('end', resolve)
            .save(out);
    });

    try {
        await fsp.stat(out);
    } catch (e) {
        throw new Error(`FFmpeg failed to create output file for pitch shift.`);
    }

    return {
        path: out,
        fileName: `pitch_${semitones > 0 ? '+' : ''}${semitones}.mp3`,
    };
}

/**
 * Apply AI-powered vocal separation using Demucs
 * @param {string} inputPath - Path to input audio file
 * @param {boolean} keepVocals - If true, return vocals only; if false, return instrumental
 * @returns {Promise<{path: string, fileName: string}>}
 */
export async function applyKaraoke(inputPath, keepVocals = false) {
    const outputDir = path.dirname(inputPath);
    const stemType = keepVocals ? 'vocals' : 'no_vocals';
    const scriptPath = path.join(__dirname, '../../scripts/demucs_separate.py');

    // Call Python Demucs script
    await new Promise((resolve, reject) => {
        const proc = spawn('python3', [
            scriptPath,
            inputPath,
            outputDir,
            stemType,
        ]);

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Demucs failed: ${stderr}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to start Demucs: ${err.message}`));
        });
    });

    // Find the result WAV file
    const wavPath = path.join(outputDir, `${stemType}.wav`);

    try {
        await fsp.stat(wavPath);
    } catch (e) {
        throw new Error('Demucs failed to create output file.');
    }

    // Convert WAV to M4A (AAC) for high quality & iPhone compatibility
    const m4aOut = tempPath('m4a');
    await new Promise((resolve, reject) => {
        ffmpeg(wavPath)
            .format('adts') // ADTS container for AAC
            .audioCodec('aac')
            .audioBitrate('320k') // Max quality
            .on('error', reject)
            .on('end', resolve)
            .save(m4aOut);
    });

    // Cleanup WAV file
    try {
        await fsp.unlink(wavPath);
    } catch (e) {
        // Ignore cleanup errors
    }

    // Get output file size
    let stats;
    try {
        stats = await fsp.stat(m4aOut);
    } catch (e) {
        throw new Error('Failed to stat output file.');
    }

    return {
        path: m4aOut,
        fileName: keepVocals ? 'vocals_only.m4a' : 'instrumental.m4a',
        size: stats.size,
    };
}

/**
 * Apply AI-powered vocal separation for VIDEO files
 * Returns MP4 with original video + instrumental audio
 * @param {string} inputPath - Path to input video file
 * @param {boolean} keepVocals - If true, return vocals only; if false, return instrumental
 * @returns {Promise<{path: string, fileName: string}>}
 */
export async function applyKaraokeVideo(inputPath, keepVocals = false) {
    const outputDir = path.dirname(inputPath);
    const stemType = keepVocals ? 'vocals' : 'no_vocals';
    const scriptPath = path.join(__dirname, '../../scripts/demucs_separate.py');

    // 1. Extract audio from video
    const audioPath = tempPath('wav');
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .noVideo()
            .audioCodec('pcm_s16le')
            .audioFrequency(44100)
            .format('wav')
            .on('error', reject)
            .on('end', resolve)
            .save(audioPath);
    });

    // 2. Process audio with Demucs
    await new Promise((resolve, reject) => {
        const proc = spawn('python3', [
            scriptPath,
            audioPath,
            outputDir,
            stemType,
        ]);
        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Demucs failed: ${stderr}`));
        });
        proc.on('error', (err) =>
            reject(new Error(`Failed to start Demucs: ${err.message}`)),
        );
    });

    // 3. Get processed audio
    const processedAudioPath = path.join(outputDir, `${stemType}.wav`);
    try {
        await fsp.stat(processedAudioPath);
    } catch (e) {
        throw new Error('Demucs failed to create output file.');
    }

    // 4. Mux processed audio with original video
    const mp4Out = tempPath('mp4');
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(inputPath)
            .input(processedAudioPath)
            .outputOptions([
                '-c:v copy', // Copy video stream without re-encoding
                '-c:a aac', // Encode audio as AAC
                '-b:a 320k', // Max audio quality
                '-map 0:v:0', // Take video from first input
                '-map 1:a:0', // Take audio from second input
                '-shortest', // Match shortest stream
                '-pix_fmt yuv420p', // Ensure iPhone compatibility
            ])
            .format('mp4')
            .on('error', reject)
            .on('end', resolve)
            .save(mp4Out);
    });

    // 5. Cleanup temp files
    try {
        await fsp.unlink(audioPath);
        await fsp.unlink(processedAudioPath);
    } catch (e) {
        // Ignore cleanup errors
    }

    // Get output file size
    let stats;
    try {
        stats = await fsp.stat(mp4Out);
    } catch (e) {
        throw new Error('Failed to stat output file.');
    }

    return {
        path: mp4Out,
        fileName: keepVocals ? 'vocals_only.mp4' : 'instrumental.mp4',
        size: stats.size,
    };
}

/**
 * Generate lyrics from audio/video and overlay on video
 * Uses Whisper AI for transcription and FFmpeg for subtitle overlay
 * @param {string} inputPath - Path to input video/audio file
 * @param {boolean} isVideo - Whether input is video
 * @param {string} lang - Language code for transcription (default: 'id' for Indonesian)
 * @returns {Promise<{path: string, fileName: string, srtPath: string}>}
 */
async function preprocessAudio(inputPath) {
    const outPath = tempPath('wav');
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioFilters([
                'loudnorm', // Normalize volume
                'aresample=16000', // Convert to 16kHz (Whisper native)
                'aformat=channel_layouts=mono', // Convert to mono
            ])
            .format('wav')
            .on('error', reject)
            .on('end', resolve)
            .save(outPath);
    });
    return outPath;
}

export async function generateLyricsVideo(
    inputPath,
    isVideo = true,
    lang = 'id',
) {
    const outputDir = path.dirname(inputPath);
    const scriptPath = path.join(
        __dirname,
        '../../scripts/whisper_transcribe.py',
    );
    const srtPath = path.join(outputDir, 'lyrics.srt');

    // 1. Transcribe audio using Whisper directly (original audio works better)
    // Note: Vocals extraction was tested but reduced accuracy, so using original
    console.log('Transcribing audio with Whisper...');

    // Preprocess audio (normalize + 16kHz mono) to fix iPhone/HEVC issues
    let processedAudioPath;
    try {
        console.log('Preprocessing audio (normalize + 16kHz)...');
        processedAudioPath = await preprocessAudio(inputPath);
    } catch (e) {
        console.error('Audio preprocessing failed, using original:', e);
        processedAudioPath = inputPath;
    }

    await new Promise((resolve, reject) => {
        const proc = spawn('python3', [
            scriptPath,
            processedAudioPath,
            srtPath,
            lang,
        ]);

        let stderr = '';
        proc.stdout.on('data', (data) => {
            console.log('Whisper:', data.toString());
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Whisper failed: ${stderr}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to start Whisper: ${err.message}`));
        });
    });

    // Cleanup processed audio
    if (processedAudioPath !== inputPath) {
        try {
            await fsp.unlink(processedAudioPath);
        } catch (e) {}
    }

    // Check SRT file exists
    try {
        await fsp.stat(srtPath);
    } catch (e) {
        throw new Error('Whisper failed to create subtitle file.');
    }

    // 2. If input is video, overlay subtitles
    if (isVideo) {
        const mp4Out = tempPath('mp4');

        // Copy SRT to a simpler path without special characters
        const simpleSrtPath = '/tmp/subs.srt';
        try {
            await fsp.copyFile(srtPath, simpleSrtPath);
        } catch (e) {
            // If copy fails, use original path
        }
        const srtToUse = simpleSrtPath;

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters([
                    // Subtitle filter dengan font besar dan posisi yang jelas
                    // Note: Escape spaces in font name for FFmpeg
                    `subtitles=${srtToUse}:force_style='FontSize=18,FontName=Liberation\\\\ Sans,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=25'`,
                ])
                .outputOptions([
                    // PENGATURAN KOMPRESI:
                    '-c:v libx264', // Re-encode menggunakan codec H.264
                    '-crf 26', // Kualitas lebih baik untuk lirik terlihat jelas
                    '-preset fast', // Kecepatan proses encoding
                    '-pix_fmt yuv420p', // Memastikan video kompatibel di semua HP
                    '-movflags +faststart', // Optimize for streaming
                ])
                .audioCodec('aac')
                .audioBitrate('192k') // Higher bitrate for competition quality
                .format('mp4')
                .on('error', (err) => {
                    console.error('FFmpeg subtitle error:', err.message);
                    reject(err);
                })
                .on('end', resolve)
                .save(mp4Out);
        });

        // Cleanup SRT files
        try {
            await fsp.unlink(srtPath);
            await fsp.unlink(simpleSrtPath);
        } catch (e) {}

        return {
            path: mp4Out,
            fileName: 'lyrics_video.mp4',
        };
    } else {
        // If audio only, just return the SRT file path
        // (We'll handle this in message handler by converting to video first)
        return {
            path: srtPath,
            fileName: 'lyrics.srt',
        };
    }
}
