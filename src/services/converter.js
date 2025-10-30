import ffmpeg from '../utils/ffmpeg.js';
import { tempPath } from '../utils/temp.js';
import { CONFIG } from '../config.js';
import { promises as fsp } from 'fs';


export async function mp4ToMp3(inFile) {
const outFile = tempPath('mp3');
await new Promise((resolve, reject) => {
ffmpeg(inFile)
.noVideo()
.audioCodec('libmp3lame')
.audioBitrate('192k')
.format('mp3')
.on('error', reject)
.on('end', resolve)
.save(outFile);
});
return outFile;
}


export async function mp3ToMp4(inFile) {
// Create an MP4 with a static black background + the audio track
const outFile = tempPath('mp4');
await new Promise((resolve, reject) => {
ffmpeg()
.input('color=c=black:s=1280x720')
.inputOptions(['-f', 'lavfi'])
.input(inFile)
.videoCodec('libx264')
.outputOptions([
'-tune', 'stillimage',
'-pix_fmt', 'yuv420p',
'-shortest'
])
.audioCodec('aac') // copy may fail for mp3→mp4 containers on some builds; aac is broadly compatible
.format('mp4')
.on('error', reject)
.on('end', resolve)
.save(outFile);
});
return outFile;
}


export async function ensureWithinLimit(filePath, maxMB = CONFIG.MAX_FILE_MB) {
const stat = await fsp.stat(filePath);
const sizeMB = stat.size / (1024 * 1024);
if (sizeMB > maxMB) {
throw new Error(`File too large: ${sizeMB.toFixed(2)} MB > ${maxMB} MB`);
}
}