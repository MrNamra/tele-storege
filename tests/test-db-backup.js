const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

process.env.DB_FILE = path.join(os.tmpdir(), `tele_backup_test_${Date.now()}.sqlite`);

const db = require('../config/db');
const telegramService = require('../services/telegramService');

let createdChannels = [];
let uploads = [];

telegramService.createPrivateChannel = async (name) => {
  const ch = { channel_id: `-10099${createdChannels.length + 1}`, access_hash: '777', title: name };
  createdChannels.push(ch);
  return ch;
};

telegramService.uploadFileToChannel = async (channelId, _hash, filePath, fileName) => {
  uploads.push({ channelId, fileName, buf: fs.readFileSync(filePath) });
  return { id: uploads.length + 10 };
};

const { runDbBackup } = require('../services/dbBackupService');

(async () => {
  const restoredPath = path.join(os.tmpdir(), `tele_backup_restored_${Date.now()}.sqlite`);
  try {
    // Seed a user row so we can verify backup integrity
    db.prepare(
      "INSERT INTO users (name, email, password, role, bucketAllowed, status) VALUES ('BackupCheck', 'backup@test.local', 'hash', 'admin', 10, 'active')"
    ).run();

    // First backup creates db_backup channel and uploads .sqlite.gz
    const r1 = await runDbBackup();
    assert.strictEqual(createdChannels.length, 1);
    assert.strictEqual(createdChannels[0].title, 'db_backup');
    assert.strictEqual(r1.skipped, false);
    assert.ok(r1.file_name.endsWith('.sqlite.gz'));
    assert.strictEqual(uploads.length, 1);

    // Second backup reuses the exact same db_backup channel (never duplicates)
    const r2 = await runDbBackup();
    assert.strictEqual(createdChannels.length, 1, 'must reuse existing db_backup channel');
    assert.strictEqual(r2.channel_id, r1.channel_id);
    assert.strictEqual(uploads.length, 2);

    // Decompress uploaded snapshot and verify it opens as a valid SQLite DB with our row intact
    fs.writeFileSync(restoredPath, zlib.gunzipSync(uploads[0].buf));
    const restoredDb = new Database(restoredPath, { readonly: true });
    const row = restoredDb.prepare('SELECT name, email FROM users WHERE email = ?').get('backup@test.local');
    restoredDb.close();
    assert.deepStrictEqual(row, { name: 'BackupCheck', email: 'backup@test.local' });

    console.log('✓ All SQLite 24h db_backup tests passed (channel reuse + gzip snapshot integrity verified)!');
  } finally {
    try { db.close(); } catch {}
    for (const f of [restoredPath, process.env.DB_FILE, process.env.DB_FILE + '-wal', process.env.DB_FILE + '-shm']) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  }
})();
