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
app.get('/u/:code', (req, res) => {
  const { code } = req.params;
  
  // Check if there are any files stored under the provided code
  const files = fileStorage[code];
  
  if (!files || files.length === 0) {
    return res.status(404).json({ success: false, message: 'No files found for this code.' });
  }

  // Respond with the files
  res.status(200).json({
    success: true,
    files: files.map(file => ({
      fileName: file.fileName,
      fileSize: file.fileSize,
      telegramResponse: file.telegramResponse
    }))
  });
});

// Start the server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
