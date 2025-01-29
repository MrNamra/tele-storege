const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const sharp = require("sharp");
const fs = require("fs");
const path = require('path');
require("dotenv").config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionString = process.env.STRING_SESSION;

// Initialize Telegram Client
const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  { connectionRetries: 5 }
);

(async () => {
  try {
    await client.connect();
    console.log("Telegram Client Connected Successfully!");
  } catch (error) {
    console.error("Error connecting to Telegram Client:", error);
  }
})();

const handleFileUpload = async (fileBuffer, bucketId, fileName, groupId, accessHash, userId = null) => {
  try {
    if (!Buffer.isBuffer(fileBuffer)) {
      throw new Error("Invalid file buffer");
    }

    const peer = new Api.InputPeerChannel({
      channelId: Number(groupId),
      accessHash: BigInt(accessHash),
    });

    const fileSize = fileBuffer.length;
    const isImage = fileName.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);

    let inputFile;

    // Generate a unique filename for the temporary file (based on timestamp or random string)
    const tempFileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}-${fileName}`;
    const tempFilePath = path.join(__dirname, 'tmp', tempFileName);

    if (isImage && fileSize <= 10 * 1024 * 1024) {
      // Process the image buffer to ensure alpha channel (if needed)
      fileBuffer = await sharp(fileBuffer).ensureAlpha().toBuffer();

      const { format } = await sharp(fileBuffer).metadata();
      const mimeType = `image/${format}`;

      // Save buffer to a temporary file to provide file name properly
      fs.writeFileSync(tempFilePath, fileBuffer);

      inputFile = await client.sendFile(peer, {
        file: tempFilePath,
        fileName, // Ensure that fileName is correctly passed
        mimeType, // Explicitly set the mimeType
        workers: 1,
      });

      fs.unlinkSync(tempFilePath);

      const fileId = inputFile.photo.id.toString();

      // Clean up the temporary file after sending the message
      fs.unlinkSync(tempFilePath);

      return {
        success: true,
        fileId,
        fileName,
        fileType: "image",
        bucketId,
        userId,
      };

    } else {
      // Handle large files (split into parts)
      const partSize = 512 * 1024;
      const totalParts = Math.ceil(fileSize / partSize);
      const fileId = BigInt(Math.floor(Math.random() * -Math.pow(2, 32)));

      for (let part = 0; part < totalParts; part++) {
        const start = part * partSize;
        const end = Math.min(start + partSize, fileSize);
        const fileChunk = fileBuffer.slice(start, end);

        await client.invoke(
          new Api.upload.SaveBigFilePart({
            fileId: fileId,
            filePart: part,
            fileTotalParts: totalParts,
            bytes: fileChunk,
          })
        );
      }

      inputFile = new Api.InputFileBig({
        id: fileId,
        parts: totalParts,
        name: fileName,
      });

      const message = await client.sendMessage(peer, {
        message: `File from bucket ${bucketId}`,
        file: inputFile,
      });

      // Ensure no double upload occurs
      if (!message || !message.media || !message.media.document || !message.media.document.id) {
        throw new Error("Failed to retrieve file ID from the message.");
      }

      return {
        success: true,
        fileId: message.media.document.id.toString(),
        fileName,
        fileType: message.media.document.mimeType || "application/octet-stream",
        bucketId,
        userId,
      };
    }
  } catch (error) {
    console.error("Error during file upload:", error);
    throw error;
  }
};

// Delete file from Telegram
const deleteFileFromCloud = async (groupId, messageId) => {
  try {
    await client.deleteMessage(groupId, [messageId]);
    return { status: true, message: 'File deleted successfully.' };
  } catch (error) {
    console.error("Error deleting file from Cloud:", error);
    return { status: false, message: 'Failed to delete file from Telegram.' };
  }
}

const getFile = async (groupId, fileId) => {
  try {
    const result = await client.getMessages(groupId, { ids: [fileId] });

    if (result && result.length > 0) {
      const message = result[0];

      if (message.media && message.media.document) {
        return { status: true, fileId: message.media.document.id, file_size: (message.media.document.size * 1024 * 1024) };
      }
    }
    return { status: false, message: "File not found." };
  } catch (error) {
    console.error("Error fetching file from Telegram:", error);
    return { status: false, message: "Failed to fetch file from Telegram." };
  }
}

module.exports = {
  handleFileUpload,
  deleteFileFromCloud,
  getFile,
  client
};