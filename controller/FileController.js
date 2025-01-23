const Bucket = require('../models/Bucket')
const { handleFileUpload, deleteFileFromCloud } = require("../src/bot");

const uploadFile = async (req, res) => {
  const { bucketId } = req.body;
  const user = req.user;
  const fileBuffer = req.file.buffer;
  const originalFileName = req.file.originalname;
  const fileSizeInBytes = req.file.size;
  const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

  if (!bucketId) return res.status(400).json({ error: 'BucketId is required.' });

  if (!req.file) return res.status(400).json({ error: 'File is required.' });

  try {
    // Validate bucketId (optional)
    const bucket = await Bucket.findById(bucketId);
    if (!bucket) {
      return res.status(404).json({ error: 'Bucket not found.' });
    }

    // Call the handleFileUpload function from bot.js to upload to Telegram
    const uploadResult = await handleFileUpload(fileBuffer, bucketId, originalFileName, user.id);

    const newStorage = bucket.storage + fileSizeInMB;
    bucket.storage = newStorage;
    await bucket.save();

    // Return response with file metadata
    res.status(200).json({
      status: true,
      message: 'File uploaded successfully.',
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName,
      fileUrl: uploadResult.fileUrl,
      bucketId: uploadResult.bucketId,
      thumbnail: uploadResult.thumbnail,
      // userId: uploadResult.userId,
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

const deleteFile = async (req, res) => {
  const { fileId } = req.body;
  const user = req.user;

  const file = await File.findById(fileId);
  if (!file) return res.status(400).json({ status: false, message: 'File not found.' });

  const bucket = await Bucket.findById(file.bucketId);
  if (!bucket) return res.status(400).json({ status: false, message: 'Bucket not found.' });


  const cloudResponse = await deleteFileFromCloud(file.messageId);

  if (!cloudResponse.status) return res.status(400).json({ status: false, message: 'Failed to delete file from Telegram.' });

  const newStorage = bucket.storage - file.size;
  bucket.storage = newStorage;
  await bucket.save();

  await File.findByIdAndDelete(fileId);

  res.status(200).json({ status: true, message: 'File deleted successfully.' });
}

module.exports = {
  uploadFile,
  deleteFile
}
