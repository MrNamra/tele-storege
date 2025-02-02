const mongoose = require('mongoose');

const FileShareSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bucketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bucket',
        required: true
    },
    password: {
        type: String,
        required: false
    },
    code: {
        type: String,
        required: false,
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