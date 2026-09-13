const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    const tempOutput = `${outputPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.mp4`;
    try {
        // Probe input codec first
        const probeRes = await runFfmpeg(['-i', inputPath]);
        const probeInfo = (probeRes.stderr || '').toLowerCase();

        const isHevc = probeInfo.includes('hevc') || probeInfo.includes('h265');
        const isH264 = (probeInfo.includes('h264') || probeInfo.includes('avc1')) && !isHevc;
        const isAac = probeInfo.includes('aac');

        let success = false;

        // If already standard H.264 + AAC, fast remux in ~1 second
        if (isH264) {
            const copyArgs = ['-y', '-i', inputPath, '-c:v', 'copy', '-c:a', isAac ? 'copy' : 'aac', '-b:a', '128k', '-movflags', '+faststart', tempOutput];
            const copyRes = await runFfmpeg(copyArgs);
            if (copyRes.ok && fs.existsSync(tempOutput) && fs.statSync(tempOutput).size > 0) {
                success = true;
            }
        }

        // If not H.264 or fast remux failed (e.g. HEVC from iPhone MOV), transcode with ultrafast preset
        if (!success) {
            if (fs.existsSync(tempOutput)) {
                try { fs.unlinkSync(tempOutput); } catch (e) {}
            }
            const transcodeArgs = [
                '-y',
                '-i', inputPath,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'fastdecode',
                '-crf', '24',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                tempOutput
            ];
            const transcodeRes = await runFfmpeg(transcodeArgs);
            if (transcodeRes.ok && fs.existsSync(tempOutput) && fs.statSync(tempOutput).size > 0) {
                success = true;
            } else {
                console.error('Transcode failed:', transcodeRes.stderr.slice(-400));
            }
        }

        if (success) {
            // Atomic rename to target path so no process reads partial file
            fs.renameSync(tempOutput, outputPath);
            process.exit(0);
        } else {
            if (fs.existsSync(tempOutput)) {
                try { fs.unlinkSync(tempOutput); } catch (e) {}
            }
            process.exit(1);
        }
    } catch (err) {
        if (fs.existsSync(tempOutput)) {
            try { fs.unlinkSync(tempOutput); } catch (e) {}
        }
        console.error('convert-video uncaught error:', err);
        process.exit(1);
    }
})();

