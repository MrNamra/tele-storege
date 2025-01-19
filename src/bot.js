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
      caption: `${bucketId}`, // Attach bucketId as caption
    });

    fs.unlinkSync(tempFilePath);

    // Extract file details
    const fileId = message.document.file_id;
    const fileName = message.document.file_name;
    const messageId = message.message_id;
    const fileType = message.document.mime_type;

    // Get the file link from Telegram
    const fileLink = await bot.getFileLink(fileId);

    // Save the file metadata to the database (not the actual file)
    const newFile = new File({
      fileId: fileId,
      fileName: originalFileName,
      fileUrl: fileLink,
      messageId: messageId,
      fileType: fileType,
      bucketId: bucketId,
      userId: userId,
    });

    await newFile.save();

    return { success: true, fileId, fileName, fileType, fileUrl: fileLink, bucketId, userId };
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

async function getThumbnail(fileId) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);
    console.log("response----------------");
    console.log(response.data);

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
  getThumbnail
};