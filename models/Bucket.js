const mongoose = require('mongoose');

const BucketSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      groupId: {
        type: String,
        required: false,
      },
      storage: {
        type: Number,
        required: false,
        default: 0,
        min: 0
      },
      bucketName: {
        type: String,
        required: true,
      },
      accessHash: {
        type: String,
        required: false,
      },
      inviteLink: {
        type: String,
        required: false,
      },
      createdAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
});

module.exports = mongoose.model('Bucket', BucketSchema);