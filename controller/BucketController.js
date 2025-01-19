// controller/BucketController.js
const Bucket = require('../models/Bucket');
const axios = require('axios');
const FileShare = require('../models/FileShare');
const File = require('../models/File');
const { deleteFileFromCloud, getThumbnail } = require('../src/bot');

module.exports = {
    // Create Bucket
    createBucket: async (req, res) => {
        const { bucketName } = req.body;
        const userId = req.user.id;

        try {
            // Creating a new bucket with a unique bucketId
            const newBucket = new Bucket({
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
    listBuckets: async (req, res) => {
        const userId = req.user.id;

        try {
            const buckets = await Bucket.find({ userId });
            return res.status(200).json({ buckets });
        } catch (error) {
            return res.status(500).json({ message: 'Server Error', error: error.message });
        }
    },

    // Delete Bucket
    deleteBucket: async (req, res) => {
        const { bucketId } = req.params;
        const userId = req.user.id;

        try {
            // Find the bucket that belongs to the current user
            const bucket = await Bucket.findOne({ _id: bucketId, userId });

            if (!bucket) return res.status(400).json({ message: 'Bucket not found' });

            // delete files data
            await FileShare.deleteMany({ bucketId: bucketId });

            // delete files from Cloud Storage
            const allFiles = await File.find({ bucketId: bucketId });
            console.log("allFiles----------------");
            console.log(allFiles);
            return;
            for (let i = 0; i < allFiles.length; i++) {
                const deleteResponse = await deleteFileFromCloud(allFiles[i].fileId);
                if (!deleteResponse.status) return res.status(400).json({ status: false, message: "Failed to delete file from Cloud!" });
            }

            // Delete the bucket
            await bucket.deleteOne();
            return res.status(200).json({ message: 'Bucket deleted successfully' });
        } catch (error) {
            return res.status(500).json({ message: 'Server Error', error: error.message });
        }
    },

    // Show Bucket
    showBucket: async (req, res) => {
        const { code } = req.params;
        const { password } = req.body;
        try {
            // Find the bucket by its code
            const bucket = await FileShare.findOne({ code: code });
            if (!bucket) return res.status(400).json({ status: false, message: "Data not found!" });
    
            // Fetch all files associated with the bucket (excluding userId)
            var bucketData = await File.find({ bucketId: bucket.bucketId }, { userId: 0 });
            var newbucketData = {};

            // Prepare promises for fetching thumbnails for image files
            const promisDAta = bucketData.map(async (file) => {
                if (file.fileType && file.fileType.startsWith("image")) {
                    // Fetch thumbnail base64 for image files
                    const thumbnailBase64 = await getThumbnail(file.fileId);
                    
                    // Append the thumbnail to the correct property
                    newbucketData.thumbnail = thumbnailBase64 || null;
                } else {
                    newbucketData.thumbnail = null;
                }
    
                // Return the updated file object
                return file;
            });

            const updatedBucketData = await Promise.all(promisDAta);

            // Log the updated data for debugging
            console.log("updatedBucketData with thumbnails----------------");
            console.log(updatedBucketData);
    
            // Send the updated data in the response
            res.status(200).json({ status: true, message: "Data found", data: updatedBucketData });
        } catch (error) {
            console.log("------------error-----------");
            console.log(error);
            return res.status(500).json({ message: "Server Error", error });
        }
    },
    
    showBucketFile: async (req, res) => {
        try {
            const { code } = req.params;
            const { file_id } = req.params;
            const fileInfo = await FileShare.findOne({ code: code });
            const fileData = await File.findOne({ fileId: file_id, bucketId: fileInfo.bucketId });
            if (!fileData) return res.status(400).json({ status: false, message: "File not found!" });

            const response = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`, {
                params: { file_id: fileData.fileId },
            });

            if (response.data.ok) {
                const filePath = response.data.result.file_path;
                const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

                const fileResponse = await axios.get(fileUrl, { responseType: 'stream' });
                res.setHeader('Content-Type', fileResponse.headers['content-type']);
                res.setHeader('Content-Disposition', `inline; filename="${fileData.fileName}"`);
                fileResponse.data.pipe(res);
            } else {
                return res.status(400).json({ status: false, message: 'Error fetching file from CloudStorage' });
            }
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error });
        }
    }
}

