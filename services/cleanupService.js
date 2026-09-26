const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../config/db');
const { getChunksDir, getAssembledDir, getTmpDir, getThumbnailsDir } = require('../utils/storagePaths');

/**
 * Clean files or directories in target folder older than maxAgeMs.
 */
function cleanOldFilesInDir(dirPath, maxAgeMs) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  const now = Date.now();
  let count = 0;

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
          count++;
        }
      } catch (_) {}
    }
  } catch (_) {}

  return count;
}

/**
 * Runs storage garbage collection to ensure NO files remain on the server
 * longer than needed.
 */
function runStorageCleanup() {
  const TEN_MINUTES = 10 * 60 * 1000;
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  let totalCleaned = 0;

  // 1. Clean abandoned chunk directories (> 10 mins old)
  totalCleaned += cleanOldFilesInDir(getChunksDir(), TEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(os.tmpdir(), 'cloudvault', 'chunks'), TEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(__dirname, '../storage/app/chunks'), TEN_MINUTES);

  // 2. Clean stalled assembled files (> 15 mins old)
  totalCleaned += cleanOldFilesInDir(getAssembledDir(), FIFTEEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(os.tmpdir(), 'cloudvault', 'assembled'), FIFTEEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(__dirname, '../storage/app/assembled'), FIFTEEN_MINUTES);

  // 3. Clean multer temporary uploads (> 10 mins old)
  totalCleaned += cleanOldFilesInDir(getTmpDir(), TEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(os.tmpdir(), 'cloudvault', 'tmp'), TEN_MINUTES);
  totalCleaned += cleanOldFilesInDir(path.join(__dirname, '../storage/app/tmp'), TEN_MINUTES);

  // 4. Clean old thumbnails (> 24 hours old)
  totalCleaned += cleanOldFilesInDir(getThumbnailsDir(), ONE_DAY);
  totalCleaned += cleanOldFilesInDir(path.join(os.tmpdir(), 'cloudvault', 'thumbnails'), ONE_DAY);

  // 5. Clean database upload queue records (completed > 24 hours, failed > 1 hour)
  try {
    db.prepare("DELETE FROM upload_queues WHERE status IN ('failed', 'cancelled') AND datetime(updated_at) < datetime('now', '-1 hour')").run();
    db.prepare("DELETE FROM upload_queues WHERE status = 'completed' AND datetime(updated_at) < datetime('now', '-24 hours')").run();
  } catch (_) {}

  if (totalCleaned > 0) {
    console.log(`[Storage Cleanup] Purged ${totalCleaned} temporary/abandoned files from server.`);
  }
}

let cleanupInterval = null;

function startCleanupWorker() {
  if (cleanupInterval) return;

  // Run once immediately on startup
  runStorageCleanup();

  // Run periodically every 5 minutes
  cleanupInterval = setInterval(runStorageCleanup, 5 * 60 * 1000);
}

module.exports = {
  runStorageCleanup,
  startCleanupWorker,
};
