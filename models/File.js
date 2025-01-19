const mongoose = require('mongoose');
const axios = require('axios');

// Define the file schema to store file metadata
const fileSchema = new mongoose.Schema({
  fileId: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    required: false
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: false
  },
  fileUrl: {
    type: String,
    required: true
  },
  bucketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bucket', // Assuming you have a 'Bucket' model in your app to link the file to a specific bucket
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Assuming you have a 'Bucket' model in your app to link the file to a specific bucket
    required: false
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const File = mongoose.model('File', fileSchema);
module.exports = File;