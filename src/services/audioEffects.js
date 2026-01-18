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
    // 1. Calculate frequency ratio: f = 2^(n/12)
    const ratio = Math.pow(2, semitones / 12);

    // 2. New sample rate
    const newRate = Math.round(44100 * ratio);

    // 3. Tempo compensation (to keep original duration)
    // If we pitch up (ratio > 1), audio gets faster, so we must slow down (tempo < 1)
    const tempo = 1 / ratio;

    const out = tempPath('mp3');

    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            // Trick: set audio sample rate (asetrate) to change pitch + speed
            .audioFilters([
                `asetrate=${newRate}`,
                `atempo=${tempo}`,
                'aresample=44100', // Resample back to standard rate
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
