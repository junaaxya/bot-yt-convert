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

    // Convert WAV to MP3 for smaller file size
    const mp3Out = tempPath('mp3');
    await new Promise((resolve, reject) => {
        ffmpeg(wavPath)
            .format('mp3')
            .audioBitrate('192k')
            .on('error', reject)
            .on('end', resolve)
            .save(mp3Out);
    });

    // Cleanup WAV file
    try {
        await fsp.unlink(wavPath);
    } catch (e) {
        // Ignore cleanup errors
    }

    return {
        path: mp3Out,
        fileName: keepVocals ? 'vocals_only.mp3' : 'instrumental.mp3',
    };
}
