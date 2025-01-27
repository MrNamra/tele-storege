const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const File = require("../models/File");
const Bucket = require("../models/Bucket");
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

    // Create a valid InputPeerChannel object
    const peer = new Api.InputPeerChannel({
      channelId: Number(groupId),
      accessHash: BigInt(accessHash),
    });

    // Fetch group details
    const channelResponse = await client.invoke(new Api.channels.GetChannels({ id: [peer] }));

    // Validate group response
    const channel = channelResponse.chats && channelResponse.chats[0];
    if (!channel || !channel.id || !channel.accessHash) {
      throw new Error("Could not find the specified group/channel");
    }

    const fileSize = fileBuffer.length;
    const partSize = 512 * 1024; // 512KB per part
    const totalParts = Math.ceil(fileSize / partSize);
    const fileId = BigInt(Math.floor(Math.random() * -Math.pow(2, 32))); // Random file ID

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

    // Create InputFileBig object
    const inputFile = new Api.InputFileBig({
      id: fileId,
      parts: totalParts,
      name: fileName,
    });

    // Send the uploaded file to the group
    const message = await client.sendMessage(peer, {
      message: `File from bucket ${bucketId}`,
      file: inputFile,
    });

    // Validate response
    if (!message.media || !message.media.document) {
      console.error("Telegram response error:", message);
      throw new Error("Failed to send file message or document is missing.");
    }

    const fileIdToGetUrl = message.media.document.id;
    const accesshash = message.media.document.accessHash;

    const fileResponse = await client.invoke(
      new Api.upload.GetFile({
        location: new Api.InputDocumentFileLocation({
          id: fileIdToGetUrl,
          accessHash: BigInt(accesshash),
        }),
        offset: 0,
        limit: 1,
      })
    );

    // Get file type, fallback to a default MIME type
    const fileType = message.media.document.mimeType || "application/octet-stream";

    // Save file information in the database
    // const newFile = new File({
    //   fileId: message.media.document.id.toString(),
    //   fileName,
    //   fileUrl: null,
    //   messageId: message.id,
    //   fileType,
    //   bucketId,
    //   userId,
    // });

    // await newFile.save();

    return {
      success: true,
      fileId: message.media.document.id.toString(),
      fileName,
      fileType,
      bucketId,
      userId,
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