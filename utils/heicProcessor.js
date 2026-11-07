const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function isHeicFile(filename) {
  return /\.(heic|heif)$/i.test(filename || '');
}

/**
 * Extracts a lightweight crisp JPEG thumbnail from a HEIC file (~400px width)
 * @param {string} filePath
 * @param {number} size
 * @returns {string|null} path to temporary jpg file, or null if failed
 */
function extractHeicThumbnail(filePath, size = 400) {
  if (!fs.existsSync(filePath)) return null;
  const tmpPng = path.join(os.tmpdir(), `heic_th_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  const tmpJpg = path.join(os.tmpdir(), `heic_th_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
  const opts = { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    try {
      execFileSync('heif-thumbnailer', ['-s', String(size), '-p', filePath, tmpPng], opts);
      if (fs.existsSync(tmpPng) && fs.statSync(tmpPng).size > 0) {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmpPng, '-q:v', '3', tmpJpg], opts);
        try { fs.unlinkSync(tmpPng); } catch (_) {}
        if (fs.existsSync(tmpJpg) && fs.statSync(tmpJpg).size > 0) {
          return tmpJpg;
        }
      }
    } catch (_) {
      try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
      // Fallback to heif-convert directly
      execFileSync('heif-convert', ['-q', '80', filePath, tmpJpg], opts);
      if (fs.existsSync(tmpJpg) && fs.statSync(tmpJpg).size > 0) {
        return tmpJpg;
      }
    }
  } catch (_) {
    try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
    try { if (fs.existsSync(tmpJpg)) fs.unlinkSync(tmpJpg); } catch (_) {}
  }
  return null;
}

/**
 * Converts a HEIC file to a high-resolution web-viewable JPEG (up to 2048px width)
 * @param {string} filePath
 * @param {number} maxSize
 * @returns {string|null} path to temporary jpg file, or null if failed
 */
function convertHeicToJpeg(filePath, maxSize = 2048) {
  if (!fs.existsSync(filePath)) return null;
  const tmpPng = path.join(os.tmpdir(), `heic_pv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  const tmpJpg = path.join(os.tmpdir(), `heic_pv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
  const opts = { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    try {
      execFileSync('heif-thumbnailer', ['-s', String(maxSize), '-p', filePath, tmpPng], opts);
      if (fs.existsSync(tmpPng) && fs.statSync(tmpPng).size > 0) {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmpPng, '-q:v', '2', tmpJpg], opts);
        try { fs.unlinkSync(tmpPng); } catch (_) {}
        if (fs.existsSync(tmpJpg) && fs.statSync(tmpJpg).size > 0) {
          return tmpJpg;
        }
      }
    } catch (_) {
      try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
      // Fallback to heif-convert directly
      execFileSync('heif-convert', ['-q', '90', filePath, tmpJpg], opts);
      if (fs.existsSync(tmpJpg) && fs.statSync(tmpJpg).size > 0) {
        return tmpJpg;
      }
    }
  } catch (_) {
    try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
    try { if (fs.existsSync(tmpJpg)) fs.unlinkSync(tmpJpg); } catch (_) {}
  }
  return null;
}

module.exports = {
  isHeicFile,
  extractHeicThumbnail,
  convertHeicToJpeg,
};
