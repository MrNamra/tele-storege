require('dotenv').config();
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { runDbBackup } = require('../services/dbBackupService');

(async () => {
  try {
    const result = await runDbBackup();
    console.log('✓ Database backup complete:', JSON.stringify(result));
    try { await telegramService.disconnectClient(); } catch {}
    try { db.close(); } catch {}
    process.exit(0);
  } catch (err) {
    console.error('✗ Database backup failed:', err.message);
    try { await telegramService.disconnectClient(); } catch {}
    try { db.close(); } catch {}
    process.exit(1);
  }
})();
