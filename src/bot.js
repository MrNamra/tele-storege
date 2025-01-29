const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const sharp = require("sharp");
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

    if (isImage && fileSize <= 10 * 1024 * 1024) {
      const processedImage = await sharp(fileBuffer).jpeg().toBuffer();
      
      inputFile = await client.uploadFile({
        file: processedImage,
        fileName,
        workers: 1,
      });

      const message = await client.sendMessage(peer, {
        message: `Image from bucket ${bucketId}`,
        file: inputFile,
      });

      return {
        success: true,
        fileId: message.media.photo.id.toString(),
        fileName,
        fileType: "image",
        bucketId,
        userId,
      };

    } else {
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