const mongoose = require('mongoose');

const UserInfoSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    bucketName: {
        type: String,
        required: true
    },
    bucketId: {
        type: String,
        required: true,
        unique: true
    },
    bucketAllowed: {
        type: Number,
        required: true,
        default: 5
    },
    storageUsed: {
        type: Number,
        required: true,
        default: 0
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
})

module.exports = mongoose.model('UserInfo', UserInfoSchema);