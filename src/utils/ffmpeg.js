import ffmpegBin from 'ffmpeg-static';
import ffmpegRaw from 'fluent-ffmpeg';


// fluent-ffmpeg is CJS; ensure default interop works
const ffmpeg = ffmpegRaw.default || ffmpegRaw;

ffmpeg.setFfmpegPath('ffmpeg');

export default ffmpeg;
