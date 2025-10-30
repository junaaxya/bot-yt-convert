import ffmpegBin from 'ffmpeg-static';
import ffmpegRaw from 'fluent-ffmpeg';
import { fileURLToPath } from 'url';


// fluent-ffmpeg is CJS; ensure default interop works
const ffmpeg = ffmpegRaw.default || ffmpegRaw;


if (!ffmpegBin) {
throw new Error('ffmpeg-static binary not found. This host must match a supported platform.');
}
ffmpeg.setFfmpegPath(ffmpegBin);


export default ffmpeg;