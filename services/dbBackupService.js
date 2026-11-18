const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const db = require('../config/db');
const telegramService = require('./telegramService');

db.exec(`
  CREATE TABLE IF NOT EXISTS "system_settings" (
    "key" VARCHAR PRIMARY KEY NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const CHANNEL_KEY = 'db_backup_channel';
const LAST_BACKUP_KEY = 'db_backup_last_at';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let isRunning = false;
let backupTimer = null;

function getSetting(key) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, String(value));
}

async function ensureBackupChannel() {
  const saved = getSetting(CHANNEL_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.channel_id) return parsed;
    } catch (_) {}
  }

  const channel = await telegramService.createPrivateChannel('db_backup');
  if (!channel || !channel.channel_id) {
    throw new Error('Failed to create db_backup channel.');
  }

  const record = { channel_id: channel.channel_id, access_hash: channel.access_hash };
  setSetting(CHANNEL_KEY, JSON.stringify(record));
  return record;
}

async function runDbBackup() {
  if (isRunning) {
    return { skipped: true, reason: 'backup already in progress' };
  }

  isRunning = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `database_${stamp}.sqlite`;
  const tmpSqlite = path.join(os.tmpdir(), `cv_${process.pid}_${baseName}`);
  const tmpGz = `${tmpSqlite}.gz`;

  try {
    const channel = await ensureBackupChannel();

    // Online WAL-safe hot backup via better-sqlite3
    await db.backup(tmpSqlite);

    // Compress snapshot with built-in gzip before uploading
    await pipeline(
      fs.createReadStream(tmpSqlite),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(tmpGz)
    );

    const gzSize = fs.statSync(tmpGz).size;
    const uploadName = `${baseName}.gz`;
    const uploaded = await telegramService.uploadFileToChannel(
      channel.channel_id,
      channel.access_hash,
      tmpGz,
      uploadName
    );

    const completedAt = new Date().toISOString();
    setSetting(LAST_BACKUP_KEY, completedAt);

    console.log(`[DB Backup] Uploaded ${uploadName} (${gzSize} bytes) to db_backup channel (${channel.channel_id}).`);
    return {
      skipped: false,
      channel_id: channel.channel_id,
      file_name: uploadName,
      size: gzSize,
      msg_id: uploaded ? uploaded.id : null,
      completed_at: completedAt,
    };
  } catch (err) {
    console.error('[DB Backup] Backup failed:', err.message);
    throw err;
  } finally {
    isRunning = false;
    for (const f of [tmpSqlite, tmpGz]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {}
    }
  }
}

function startDbBackupWorker() {
  if (backupTimer) return;

  const hours = Number(process.env.DB_BACKUP_INTERVAL_HOURS) || 24;
  const intervalMs = Math.max(1, hours) * 60 * 60 * 1000 || DEFAULT_INTERVAL_MS;

  const scheduleNext = (delayMs) => {
    backupTimer = setTimeout(async () => {
      try {
        await runDbBackup();
      } catch (_) {}
      scheduleNext(intervalMs);
    }, delayMs);
    if (backupTimer.unref) backupTimer.unref();
  };

  // Check last backup time so restarts don't spam backups, while stale DBs (>24h) back up 60s after boot
  const lastAt = getSetting(LAST_BACKUP_KEY);
  const elapsed = lastAt ? Date.now() - new Date(lastAt).getTime() : Infinity;
  const initialDelay = elapsed >= intervalMs ? 60 * 1000 : Math.max(60 * 1000, intervalMs - elapsed);

  scheduleNext(initialDelay);
}

module.exports = {
  ensureBackupChannel,
  runDbBackup,
  startDbBackupWorker,
};
