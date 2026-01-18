import ffmpeg from '../utils/ffmpeg.js';
import { tempPath } from '../utils/temp.js';
import { promises as fsp } from 'fs';

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
 * Apply karaoke effect (vocal removal) using phase cancellation
 * @param {string} inputPath
 * @returns {Promise<{path: string, fileName: string}>}
 */
export async function applyKaraoke(inputPath) {
    const out = tempPath('mp3');
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            // stereotools phase cancellation method
            .audioFilters('stereotools=mlev=0.015625')
            .format('mp3')
            .on('error', reject)
            .on('end', resolve)
            .save(out);
    });

    try {
        await fsp.stat(out);
    } catch (e) {
        throw new Error('FFmpeg failed to create karaoke file.');
    }

    return { path: out, fileName: 'karaoke_vocal_removed.mp3' };
}
