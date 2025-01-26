const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const File = require("../models/File");
const Bucket = require("../models/Bucket");
require('dotenv').config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionString = process.env.STRING_SESSION;

// Initialize Telegram Client
const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });

(async () => {
  try {
    await client.connect();
    console.log("Telegram Client Connected Successfully!");
  } catch (error) {
    console.error("Error connecting to Telegram Client:", error);
  }
})();

// Function to handle file upload to Telegram and save metadata in DB
const handleFileUpload = async (fileBuffer, bucketId, fileName, groupId, userId = null) => {
  try {
    if (!Buffer.isBuffer(fileBuffer)) {
      console.error("Invalid file buffer");
      throw new Error("Invalid file buffer");
    }

    const fileSize = Buffer.byteLength(fileBuffer);
    const partSize = 10 * 1024 * 1024;  // 10MB per part (max allowed by Telegram)
    const fileTotalParts = Math.ceil(fileSize / partSize); // Calculate total parts based on part size

    // If file is smaller than or equal to 10MB, upload as a single part
    if (fileSize <= partSize) {
      console.log("Uploading a small file (under 10MB) as a single part...");
      const uploadedFile = await client.uploadFile({
        file: fileBuffer,
        name: fileName,
        workers: 2,
      });

      console.log("File uploaded successfully!");
      const message = await client.sendMessage(groupId, {
        message: `File from bucket ${bucketId}`,
        media: new Api.InputMediaUploadedDocument({
          file: uploadedFile,
          mimeType: 'application/octet-stream',
        }),
      });

      console.log("Message sent successfully!");

      const fileType = message.media.document.mimeType;
      const newFile = new File({
        fileId: message.media.document.id.toString(),
        fileName,
        fileUrl: null,  // No URL needed in DB
        messageId: message.id,
        fileType,
        bucketId,
        userId,
      });

      await newFile.save();

      return { success: true, fileId: message.media.document.id.toString(), fileName, fileType, bucketId, userId };

    } else {
      // Handle large files by splitting them into smaller parts (10MB each)
      let partCount = 0;
      let fileId;

      console.log(`Uploading large file in parts... Total parts: ${fileTotalParts}`);

      while (partCount < fileTotalParts) {
        // Ensure each part does not exceed 10MB
        const partBuffer = fileBuffer.slice(partCount * partSize, Math.min((partCount + 1) * partSize, fileSize));
        
        if (partBuffer.length === 0) {
          console.error("File part is empty!");
          break;
        }

        // Upload the first part to initialize the fileId
        if (partCount === 0) {
          const result = await client.invoke(new Api.upload.SaveBigFilePart({
            filePart: partCount + 1,
            fileTotalParts: fileTotalParts,
            bytes: partBuffer,
          }));

          fileId = result.fileId;  // Store the fileId for future parts
          console.log(`Uploaded first part, fileId: ${fileId}`);
        } else {
          // Upload subsequent parts using the same fileId
          await client.invoke(new Api.upload.SaveBigFilePart({
            fileId: fileId,
            filePart: partCount + 1,
            fileTotalParts: fileTotalParts,
            bytes: partBuffer,
          }));

          console.log(`Uploaded part ${partCount + 1} of ${fileTotalParts}`);
        }

        partCount++;
      }

      // Once all parts are uploaded, send the file to the group
      const uploadedFile = await client.uploadFile({
        file: fileBuffer,
        name: fileName,
        workers: 2,
      });

      console.log("File uploaded successfully!");

      const message = await client.sendMessage(groupId, {
        message: `File from bucket ${bucketId}`,
        media: new Api.InputMediaUploadedDocument({
          file: uploadedFile,
          mimeType: 'application/octet-stream',
        }),
      });

      console.log("Message sent successfully!");

      const fileType = message.media.document.mimeType;
      const newFile = new File({
        fileId: message.media.document.id.toString(),
        fileName,
        fileUrl: null,  // No URL needed in DB
        messageId: message.id,
        fileType,
        bucketId,
        userId,
      });

      await newFile.save();

      return { success: true, fileId: fileId.toString(), fileName, fileType, bucketId, userId };
    }

  } catch (error) {
    console.error("Error during file upload:", error);
    return false;
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