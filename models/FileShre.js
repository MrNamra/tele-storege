const mongoose = require('mongoose');

const FileShareSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    bucketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserInfo'
    },
    fileUrl: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: false
    },
    code: {
        type: String,
        required: true,
        unique: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        required: false
    }
})

module.exports = mongoose.model('FileShare', FileShareSchema);