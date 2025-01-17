const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

// Create a new instance of the bot using the token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Connect to MongoDB (or your preferred database)
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

// Define a File schema to store file metadata in the database
const fileSchema = new mongoose.Schema({
  fileId: String,
  fileName: String,
  fileUrl: String,
  uploadedAt: { type: Date, default: Date.now },
});
const File = mongoose.model("File", fileSchema);

// Respond to /start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome to TGStorage! You can upload files.");
});

// Handle file uploads (documents)
bot.on("document", (msg) => {
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  // Get the file link from Telegram
  bot.getFileLink(fileId).then((fileLink) => {
    console.log(`Received file: ${fileName}`);
    console.log(`File link: ${fileLink}`);

    // Save the file metadata to the database (not the actual file)
    const newFile = new File({
      fileId: fileId,
      fileName: fileName,
      fileUrl: fileLink, // Save the file URL directly from Telegram
    });

    newFile.save()
      .then(() => {
        console.log(`File metadata saved: ${fileName}`);
      })
      .catch((err) => {
        console.error("Error saving file metadata:", err);
      });
  });
});

// Optionally, log any errors with the bot
bot.on("polling_error", (error) => {
  console.log(error);
});
