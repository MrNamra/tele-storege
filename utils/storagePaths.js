const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Checks if a given directory path is writable.
 * Attempts creation and permission fix (chmod 0o777) if needed.
 */
function isDirectoryWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o777 });
    }
    // Attempt permission fix in case directory exists with restricted mode
    try {
      fs.chmodSync(dirPath, 0o777);
    } catch (_) {}

    const testFile = path.join(
      dirPath,
      `.write_test_${process.pid}_${Date.now()}_${Math.random().toString(36).substring(2)}`
    );
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Resolves a reliable, writable directory.
 * If the primary directory in the project path cannot be written to (e.g. EACCES on /var/www/html),
 * it automatically and transparently falls back to os.tmpdir() (/tmp/cloudvault/...).
 */
const resolvedDirs = new Map();

function resolveWritableDir(primaryPath, fallbackName) {
  if (resolvedDirs.has(fallbackName)) {
    return resolvedDirs.get(fallbackName);
  }

  // 1. Try primary path
  if (isDirectoryWritable(primaryPath)) {
    resolvedDirs.set(fallbackName, primaryPath);
    return primaryPath;
  }

  // 2. Try fallback in os.tmpdir() (always writable by any process/user on Linux)
  const fallbackPath = path.join(os.tmpdir(), 'cloudvault', fallbackName);
  try {
    if (!fs.existsSync(fallbackPath)) {
      fs.mkdirSync(fallbackPath, { recursive: true, mode: 0o777 });
    }
    try {
      fs.chmodSync(fallbackPath, 0o777);
    } catch (_) {}
    console.warn(
      `[Storage Warning] Primary path "${primaryPath}" is not writable (EACCES). Automatically using writable fallback: "${fallbackPath}"`
    );
    resolvedDirs.set(fallbackName, fallbackPath);
    return fallbackPath;
  } catch (err) {
    console.error(`[Storage Error] Failed to create fallback path "${fallbackPath}":`, err.message);
    const osTmp = os.tmpdir();
    resolvedDirs.set(fallbackName, osTmp);
    return osTmp;
  }
}

function getChunksDir() {
  return resolveWritableDir(path.join(__dirname, '../storage/app/chunks'), 'chunks');
}

function getAssembledDir() {
  return resolveWritableDir(path.join(__dirname, '../storage/app/assembled'), 'assembled');
}

function getTmpDir() {
  return resolveWritableDir(path.join(__dirname, '../storage/app/tmp'), 'tmp');
}

function getThumbnailsDir() {
  return resolveWritableDir(path.join(__dirname, '../storage/app/thumbnails'), 'thumbnails');
}

function safeMkdirSync(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o777 });
    }
    try {
      fs.chmodSync(dirPath, 0o777);
    } catch (_) {}
    return dirPath;
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.warn(`[safeMkdirSync] ${err.code} on ${dirPath}. Using fallback in os.tmpdir()`);
      const projectRoot = path.resolve(__dirname, '..');
      let rel = path.relative(projectRoot, dirPath);
      if (rel.startsWith('..')) {
        rel = path.basename(dirPath);
      }
      const fallback = path.join(os.tmpdir(), 'cloudvault', rel);
      if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true, mode: 0o777 });
      }
      return fallback;
    }
    throw err;
  }
}

/**
 * Locates an existing chunk directory across primary and fallback locations.
 */
function findChunkDir(uploadId) {
  const candidates = [
    path.join(getChunksDir(), uploadId),
    path.join(os.tmpdir(), 'cloudvault', 'chunks', uploadId),
    path.join(__dirname, '../storage/app/chunks', uploadId),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // Return the default active chunks dir
  return path.join(getChunksDir(), uploadId);
}

module.exports = {
  getChunksDir,
  getAssembledDir,
  getTmpDir,
  getThumbnailsDir,
  safeMkdirSync,
  findChunkDir,
};
