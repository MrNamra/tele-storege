const express = require('express');
const multer = require('multer');
const db = require('./config/db');
const axios = require('axios');
const dotenv = require('dotenv');
const FormData = require('form-data');
const AuthController = require('./controller/AuthController');
const UserRoutes = require('./routes/user');

// Initialize dotenv
dotenv.config();

// Telegram bot info
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

// Initialize Express app
const app = express();

// Middleware to handle JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Temporary in-memory store for files (key: code, value: array of files)
let fileStorage = {};

// Multer configuration for handling file uploads
const storage = multer.memoryStorage(); // Store files in memory (not disk)
const upload = multer({ storage });

app.post('/login', AuthController.login);
app.post('/register', AuthController.register);

app.use('/user', UserRoutes);

// Route to serve the index.html file when the user accesses the root route "/"
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Route to show all files uploaded with a specific code
app.get('/u/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const messages = await getMessagesFromChat();
    const matchingFiles = findMatchingFiles(messages, code);

    if (matchingFiles.length > 0) {
      res.json({ success: true, files: matchingFiles });
    } else {
      res.status(404).json({ success: false, message: 'No files found for the provided code' });
    }
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).send('Internal Server Error');
  }
});
async function getMessagesFromChat() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;

  try {
    const response = await axios.get(url);
    const messages = response.data.result;
    return messages;
  } catch (error) {
    throw new Error('Failed to fetch messages from Telegram');
  }
}
function findMatchingFiles(messages, code) {
  const matchingFiles = [];

  messages.forEach(message => {
    // Check if message has text or document and contains the code
    if (message.message.text && message.message.text.includes(code)) {
      matchingFiles.push({
        type: 'text',
        content: message.message.text,
        date: message.message.date,
      });
    }

    if (message.message.document && message.message.document.file_name) {
      // Check if document file name contains the code
      if (message.message.document.file_name.includes(code)) {
        matchingFiles.push({
          type: 'file',
          fileName: message.message.document.file_name,
          fileId: message.message.document.file_id,
          date: message.message.date,
        });
      }
    }
  });

  return matchingFiles;
}

// Start the server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
