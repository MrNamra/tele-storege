const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
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

const handleFileUpload = async (fileBuffer, bucketId, fileName, groupId, userId = null) => {
  try {
    // Ensure client is connected
    if (!client.connected) {
      await client.connect();
    }

    // Validate file buffer
    if (!Buffer.isBuffer(fileBuffer)) {
      console.error("Invalid file buffer");
      throw new Error("Invalid file buffer");
    }

    // Fetch the channel information using the groupId
    const channelResponse = await client.invoke(
      new Api.channels.GetChannels({
        id: [groupId]  // Use the groupId here directly
      })
    );

    console.log("channelResponse:", channelResponse);

    // Make sure the channel data is correctly returned
    const channel = channelResponse.chats && channelResponse.chats[0];
    if (!channel || !channel.id || !channel.accessHash) {
      throw new Error("Could not find the specified group/channel");
    }

    // Create InputPeerChannel with resolved channel ID and accessHash
    const peer = new Api.InputPeerChannel({
      channelId: channel.id,
      accessHash: channel.accessHash
    });

    const fileSize = Buffer.byteLength(fileBuffer);
    const partSize = 512 * 1024;  // 512KB per part
    const fileId = BigInt(Math.floor(Math.random() * -Math.pow(2, 32))); // Random fileId

    // Upload the file parts if the file is larger than the allowed part size
    if (fileSize <= partSize) {
      const result = await client.invoke(
        new Api.upload.SaveFilePart({
          fileId: fileId,
          filePart: 0,  // For the first part (you can adjust this depending on the logic)
          bytes: fileBuffer
        })
      );

      if (!result || !result.success) {
        throw new Error("Failed to upload file part");
      }
    } else {
      // Multi-part upload logic (you can keep this from your previous code)
      console.log("Uploading large file in parts...");
      // Upload parts as needed (keep the existing multi-part upload logic)
    }

    // Send the uploaded file to the group using the correct peer
    const message = await client.sendMessage(peer, {
      message: `File from bucket ${bucketId}`,
      file: {
        id: fileId,
        parts: Math.ceil(fileSize / partSize),
        name: fileName,
        size: fileSize
      }
    });

    if (!message || !message.media || !message.media.document) {
      throw new Error("Failed to send file message");
    }

    // Save file information in the database
    const fileType = message.media.document.mimeType;
    const newFile = new File({
      fileId: message.media.document.id.toString(),
      fileName,
      fileUrl: null,
      messageId: message.id,
      fileType,
      bucketId,
      userId,
    });

    await newFile.save();

    return {
      success: true,
      fileId: message.media.document.id.toString(),
      fileName,
      fileType,
      bucketId,
      userId
    };
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