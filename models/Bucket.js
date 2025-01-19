const mongoose = require('mongoose');

const BucketSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      storage: {
        type: Number,
        required: false,
        default: 0
      },
      bucketName: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
});

module.exports = mongoose.model('Bucket', BucketSchema);