const express = require('express');
const multer = require('multer');
const axios = require('axios');
const dotenv = require('dotenv');
const FormData = require('form-data');

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

// Upload endpoint for receiving file and code
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Check if file is uploaded
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    // Extract the code from the form data
    const { code } = req.body;
    
    // Check if code is provided
    if (!code) {
      return res.status(400).json({ success: false, message: 'Code is required.' });
    }

    // Upload the file to Telegram
    const result = await uploadToTelegram(req.file);

    // Store file metadata in memory under the code
    if (!fileStorage[code]) {
      fileStorage[code] = [];
    }
    fileStorage[code].push({
      fileName: req.file.originalname,
      fileSize: req.file.size,
      telegramResponse: result
    });

    // Respond to the client with success message
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully!',
      telegram_response: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error uploading file.' });
  }
});

// Function to upload file directly to Telegram without storing it on the server
async function uploadToTelegram(file) {
  try {
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('document', file.buffer, { filename: file.originalname });

    const response = await axios.post(TELEGRAM_API_URL, form, {
      headers: {
        ...form.getHeaders(),
      }
    });

    return response.data; // Return Telegram response
  } catch (error) {
    console.error('Error uploading to Telegram:', error);
    throw new Error('Failed to upload to Telegram.');
  }
}

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
