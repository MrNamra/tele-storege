const Bucket = require('../models/Bucket');
const https = require('https');
const FileShare = require('../models/FileShare');
const User = require('../models/User');
const File = require('../models/File');
const { deleteFileFromCloud, getThumbnail } = require('../src/bot');

module.exports = {
    // Create Bucket
    createBucket: async (req, res) => {
        const { bucketName } = req.body;
        const userId = req.user.id;

        try {

            const userData = await User.findById(userId);
            if (!userData) return res.status(400).json({ status: false, message: "User not found!" });

            if (userData.bucketAllowed < 1) return res.status(400).json({ status: false, message: "You have no bucket allowed!" });

            userData.bucketAllowed = userData.bucketAllowed - 1;
            userData.bucketCount = userData.bucketCount + 1;
            await userData.save();

            // Creating a new bucket with a unique bucketId
            const newBucket = new Bucket({
                userId,
                bucketName,
                storageUsed: 0,
            });

            // Save to database
            await newBucket.save();
            return res.status(201).json({ status: true, message: 'Bucket created successfully', bucket: newBucket });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
        }
    },

    // List Buckets
    listBuckets: async (req, res) => {
        const userId = req.user.id;

        try {
            const buckets = await Bucket.find({ userId });
            return res.status(200).json({ status: true, message: "Buckets found", buckets });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
        }
    },

    // Edit Bucket
    editBucket: async (req, res) => {
        const userId = req.user.id;
        const bucketId = sanitizeInput(req.params.bucketId);
        const { bucketName } = req.body;

        try {
            const bucket = await Bucket.findOne({_id: bucketId, userId: userId});
            if (!bucket) return res.status(400).json({ status: false, message: "Bucket not found!" });

            bucket.bucketName = bucketName;
            await bucket.save();
            return res.status(200).json({ status: true, message: 'Bucket updated successfully', bucket });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
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

            // delete files Share Info data
            await FileShare.deleteMany({ bucketId: bucketId });

            // delete files from Cloud Storage
            const allFiles = await File.find({ bucketId: bucketId });
            for(const file of allFiles){
                await deleteFileFromCloud(file.fileId);
                await File.deleteOne({ fileId: file.fileId });
            }

            // Delete the bucket
            await bucket.deleteOne();

            const userData = await User.findById(userId);
            if (!userData) return res.status(400).json({ status: false, message: "User not found!" });

            userData.bucketCount = userData.bucketCount - 1;
            userData.bucketAllowed = userData.bucketAllowed + 1;
            await userData.save();

            return res.status(200).json({ status: true, message: 'Bucket deleted successfully' });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
        }
    },

    // Show Bucket
    showBucket: async (req, res) => {
        const code = req.params.code;
        const bucketId = req.params.bucketId;
        const page = parseInt(req.query.page) || 1;
        if (isNaN(page) || page <= 0) page = 1;
        const limit = parseInt(req.query.limit) || 20;
        if (isNaN(limit) || limit <= 0) limit = 20;
        const skip = (page - 1) * limit;
        try {

            let bucket = null;
            let totalStorage = 0;
            // Find the bucket by its code
            if(code != null){
                bucket = await FileShare.findOne({ code: code })
                const tmpBucketData = await Bucket.findById(bucket.bucketId);
                totalStorage = tmpBucketData.storage;
            } else if(bucketId != null) {
                bucket = await Bucket.findOne({ _id: bucketId })
                totalStorage = bucket.storage;
            }
            if (!bucket) return res.status(400).json({ status: false, message: "Data not found!" });
    
            // Fetch all files associated with the bucket (excluding userId)
            var bucketData = await File.find({ bucketId: bucket.bucketId }, { userId: 0, thumbnail: 0, fileUrl: 0 }).skip(skip).limit(limit);

            const totalFiles = await File.countDocuments({ bucketId: bucket.bucketId });

            // Send the updated data in the response
            res.status(200).json({ status: true, message: "Data found", data: bucketData, totalFiles, totalStorage, pagination: {
                    currentPage: page, 
                    totalPages: Math.ceil(totalFiles / limit),
                    totalItems: totalFiles
                }
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: "Server Error", error });
        }
    },
    
    showBucketFile: async (req, res) => {
        try {
            const { code, file_id } = req.params;
            const fileInfo = await FileShare.findOne({ code: code });
            const fileData = await File.findOne({ fileId: file_id, bucketId: fileInfo.bucketId });
            if (!fileData) return res.status(400).json({ status: false, message: "File not found!" });

            // const fileResponse = await axios.get(fileData.fileUrl, { responseType: 'stream' });
            // res.setHeader('Content-Type', fileResponse.headers['content-type']);
            // res.setHeader('Content-Disposition', `inline; filename="${fileData.fileName}"`);
            // fileResponse.data.pipe(res);

            // const fileResponse = await axios.get(fileData.fileUrl, { responseType: 'arraybuffer' });
            // const base64Image = Buffer.from(fileResponse.data, 'binary').toString('base64');
            // const contentType = fileResponse.headers['content-type'];
            // return res.send(`data:${contentType};base64,${base64Image}`);

            https.get(fileData.fileUrl, (fileRes) => {
                const contentType = fileRes.headers['content-type'];
    
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', 'inline');
                fileRes.pipe(res);
            }).on('error', (err) => {
                res.status(500).send('Error streaming file');
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error });
        }
    }
}

