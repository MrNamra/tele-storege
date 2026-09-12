const fs = require('fs');
const convert = require('heic-convert');

(async () => {
    try {
        const inputPath = process.argv[2];
        const outputPath = process.argv[3];
        const quality = parseFloat(process.argv[4] || '0.85');

        if (!inputPath || !outputPath) {
            console.error('Usage: node convert-heic.js <input.heic> <output.jpg> [quality]');
            process.exit(1);
        }

        const inputBuffer = fs.readFileSync(inputPath);
        const outputBuffer = await convert({
            buffer: inputBuffer,
            format: 'JPEG',
            quality: quality
        });

        fs.writeFileSync(outputPath, outputBuffer);
        process.exit(0);
    } catch (err) {
        console.error('HEIC conversion error:', err);
        process.exit(1);
    }
})();
