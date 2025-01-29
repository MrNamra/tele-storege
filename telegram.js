const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

require('dotenv').config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionId = process.env.STRING_SESSION;

const client = new TelegramClient(new StringSession(sessionId), apiId, apiHash, {
  connectionRetries: 5
});

async function uploadLargeFile(filePath, chatId) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error("❌ File not found: " + filePath);
        }

        const fileStat = fs.statSync(filePath);
        console.log(`📂 Uploading file: ${filePath} (${(fileStat.size / 1024 / 1024).toFixed(2)} MB)`);

        await client.connect();

        const entity = await client.getEntity(chatId);

        const uploadedFile = await client.uploadFile({
            file: filePath,
            workers: 5,
            onProgress: (bytesUploaded) => {
                console.log(`⬆ Upload Progress: ${((bytesUploaded / fileStat.size) * 100).toFixed(2)}%`);
            }
        });

        console.log("✅ File uploaded successfully!");

        await client.sendFile(entity, {
            file: uploadedFile,
            caption: "Here is your file:"
        });

        console.log("✅ File sent successfully!");
    } catch (error) {
        console.error("❌ Error uploading file:", error);
    }
}

// Usage Example
(async () => {
    await uploadLargeFile('./video.mp4', '2370024483'); // Replace with actual file path and chat ID
})();
