const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const telegramService = require('./telegramService');

let isProcessing = false;

async function processNextJob() {
  if (isProcessing) return;

  const job = db
    .prepare("SELECT * FROM upload_queues WHERE status = 'pending' ORDER BY id ASC LIMIT 1")
    .get();

  if (!job) return;

  isProcessing = true;

  try {
    // 1. Fetch bucket access_hash
    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(job.bucket_id);
    const accessHash = bucket ? bucket.access_hash : null;

    db.prepare("UPDATE upload_queues SET status = 'processing', progress = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);

    if (!fs.existsSync(job.file_path)) {
      throw new Error(`Assembled file not found: ${job.file_path}`);
    }

    // 2. Upload to Telegram with progress tracking
    await telegramService.uploadFileToChannel(
      job.channel_id,
      accessHash,
      job.file_path,
      job.file_name,
      (progressRatio) => {
        const percent = Math.min(99, Math.round(progressRatio * 100));
        try {
          db.prepare("UPDATE upload_queues SET status = 'uploading_to_cloud', progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(percent, job.id);
        } catch {}
      }
    );

    // 3. Mark completed and remove temp file
    db.prepare("UPDATE upload_queues SET status = 'completed', progress = 100, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);

    try {
      if (fs.existsSync(job.file_path)) {
        fs.unlinkSync(job.file_path);
      }
    } catch {}
  } catch (err) {
    console.error(`[Queue] Upload job ${job.id} (${job.file_name}) failed:`, err.message);
    db.prepare("UPDATE upload_queues SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(err.message, job.id);
    try {
      if (fs.existsSync(job.file_path)) {
        fs.unlinkSync(job.file_path);
      }
    } catch {}
  } finally {
    isProcessing = false;
    // Process next item in queue immediately
    setImmediate(processNextJob);
  }
}

function startQueueWorker(intervalMs = 2000) {
  setInterval(processNextJob, intervalMs);
  processNextJob();
}

module.exports = {
  startQueueWorker,
  processNextJob,
};
