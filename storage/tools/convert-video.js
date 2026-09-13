const { spawn } = require('child_process');
const fs = require('fs');

let ffmpegPath = 'ffmpeg';
try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller && ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
        ffmpegPath = ffmpegInstaller.path;
    }
} catch (e) {}

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
    console.error('Usage: node convert-video.js <input> <output>');
    process.exit(1);
}

function runFfmpeg(args) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            resolve({ ok: code === 0, stderr });
        });
        proc.on('error', (err) => {
            resolve({ ok: false, stderr: err.message });
        });
    });
}

(async () => {
    try {
        // First try fast copy with +faststart
        let res = await runFfmpeg(['-y', '-i', inputPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath]);

        let success = res.ok && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;

        // If fast copy fails or input is HEVC (iPhone default), transcode to standard H.264
        if (!success || res.stderr.toLowerCase().includes('hevc') || res.stderr.toLowerCase().includes('h265')) {
            if (fs.existsSync(outputPath)) {
                try { fs.unlinkSync(outputPath); } catch (e) {}
            }
            res = await runFfmpeg(['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath]);
            success = res.ok && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
        }

        if (success) {
            process.exit(0);
        } else {
            console.error('Video conversion failed:', res.stderr.slice(-300));
            process.exit(1);
        }
    } catch (err) {
        console.error('convert-video uncaught error:', err);
        process.exit(1);
    }
})();
