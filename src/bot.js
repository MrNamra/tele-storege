const fs = require('fs');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');
const File = require("../models/File");
// const fileType = require('file-type');

dotenv.config();

// Create a new instance of the bot using the token
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Function to handle file upload to Telegram and save metadata in DB
const handleFileUpload = async (fileBuffer, bucketId, originalFileName, userId = null) => {
  try {
    const tempFilePath = `./uploads/${originalFileName}`;
    fs.writeFileSync(tempFilePath, fileBuffer);


    // Send the document to Telegram chat
    const message = await bot.sendDocument(process.env.CHAT_ID, tempFilePath, {
      filename: originalFileName,
      content: fs.createReadStream(tempFilePath),
    }, { caption: `${bucketId}` });

    fs.unlinkSync(tempFilePath);

    console.log("Telegram API Response:", message);

    // Extract file details
    let fileId, fileName, fileType, fileUrl, thumbnailUrl = null;
    if (message.document) {
      fileId = message.document.file_id;
      fileName = message.document.file_name || originalFileName;
      fileType = message.document.mime_type;
    } else if (message.photo) {
      fileId = message.photo[message.photo.length - 1].file_id; // Get highest resolution image
      fileName = originalFileName;
      fileType = "image/jpeg"; // Telegram returns photos as JPEG
    } else if (message.video) {
      fileId = message.video.file_id;
      fileName = message.video.file_name || originalFileName;
      fileType = message.video.mime_type;
    } else if (message.audio) {
      fileId = message.audio.file_id;
      fileName = message.audio.file_name || originalFileName;
      fileType = message.audio.mime_type;
    } else {
      console.error("Telegram API did not return a recognized file type:", message);
      throw new Error("Unsupported file type returned by Cloud.");
    }
    
    fileUrl = await bot.getFileLink(fileId);

    let thumbnailId = null;
    if (message.document?.thumbnail) {
      thumbnailId = message.document.thumbnail.file_id;
    } else if (message.photo) {
      thumbnailId = message.photo[0].file_id; // Use first photo in array
    } else if (message.video?.thumbnail) {
      thumbnailId = message.video.thumbnail.file_id;
    }

    if (thumbnailId) {
      try {
        const fileInfo = await bot.getFile(thumbnailId);
        console.log("Thumbnail Info:", fileInfo);
        thumbnailUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
      } catch (thumbnailError) {
        console.error("Error fetching thumbnail:", thumbnailError);
      }
    }

    // Save the file metadata to the database (not the actual file)
    const newFile = new File({
      fileId: fileId,
      fileName: originalFileName,
      fileUrl: fileUrl,
      messageId: message.message_id,
      fileType: fileType,
      thumbnail: thumbnailUrl,
      bucketId: bucketId,
      userId: userId,
    });

    await newFile.save();

    return { success: true, fileId, fileName, fileType, fileUrl: fileUrl, bucketId, userId };
  } catch (error) {
    console.error("Error uploading file to Telegram:", error);
    throw error;
  }
};

// Delete file from Telegram
const deleteFileFromCloud = async (messageId) => {
  try {
    await bot.deleteMessage(process.env.CHAT_ID, messageId);
    return { status: true, message: 'File deleted successfully.' };
  } catch (error) {
    console.error("Error deleting file from Cloud:", error);
    return { status: false, message: 'Failed to delete file from Telegram.' };
  }
}

const getFile = async (fileId) => {
  const fileInfo = await bot.getFile(fileId);
  return fileInfo;
}

// this function is no need to use
async function getThumbnail(fileId) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);

    if (response.data.ok) {
      const filePath = response.data.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

      // Fetch the file as a buffer (arraybuffer)
      const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      console.log("imageResponse----------------");
      console.log(imageResponse);

      // Use file-type to check if it's an image based on binary data
      // const type = await fileType.fromBuffer(imageResponse.data);

      // // If the file is an image, convert to base64
      // if (type && type.mime && type.mime.startsWith('image')) {
        const buffer = Buffer.from(imageResponse.data).toString('base64');
        let base64 = `data:${imageResponse.headers['content-type']};base64,${buffer.toString('base64')}`;
        console.log("base64----------------");
        console.log(base64);
        console.log("-------------------------------------------");
        return base64;
      // } else {
      //   console.log('Not an image file');
      //   return null;
      // }
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching thumbnail:', error);
    return null;
  }
}

// Respond to /start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome to TGStorage! You can upload files.");
});

// Optionally, log any errors with the bot
bot.on("polling_error", (error) => {
  console.log(error);
});

module.exports = {
  handleFileUpload,
  deleteFileFromCloud,
  getThumbnail,
  getFile
};