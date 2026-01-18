import ffmpegBin from 'ffmpeg-static';
import ffmpegRaw from 'fluent-ffmpeg';


// fluent-ffmpeg is CJS; ensure default interop works
const ffmpeg = ffmpegRaw.default || ffmpegRaw;

// Gunakan path absolut sistem Ubuntu/Debian
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
ffmpeg.setFfprobePath('/usr/bin/ffprobe');

export default ffmpeg;
