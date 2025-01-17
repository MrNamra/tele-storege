// controller/BucketController.js
const UserInfo = require('../models/UserInfo');
const mongoose = require('mongoose');

module.exports = {
    // Create Bucket
    createBucket : async (req, res) => {
        const { bucketName } = req.body;
        const userId = req.user.id;
    
        try {
            // Creating a new bucket with a unique bucketId
            const newBucket = new UserInfo({
                userId,
                bucketName,
                storageUsed: 0,
            });
    
            // Save to database
            await newBucket.save();
            return res.status(201).json({ message: 'Bucket created successfully', bucket: newBucket });
        } catch (error) {
            return res.status(500).json({ message: 'Server Error', error: error.message });
        }
    },

    // List Buckets
    listBuckets : async (req, res) => {
        const userId = req.user.id;
    
        try {
            const buckets = await UserInfo.find({ userId });
            return res.status(200).json({ buckets });
        } catch (error) {
            return res.status(500).json({ message: 'Server Error', error: error.message });
        }
    },

    // Delete Bucket
    deleteBucket : async (req, res) => {
        const { bucketId } = req.params;
        const userId = req.user.id;
    
        try {
            // Find the bucket that belongs to the current user
            const bucket = await UserInfo.findOne({ _id: bucketId, userId });
            if (!bucket) return res.status(400).json({ message: 'Bucket not found' });
    
            // Delete the bucket
            await bucket.deleteOne();
            return res.status(200).json({ message: 'Bucket deleted successfully' });
        } catch (error) {
            return res.status(500).json({ message: 'Server Error', error: error.message });
        }
    }
}

