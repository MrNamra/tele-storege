const FileShare = require('../models/FileShare');
const FileModel = require('../models/File');
const Bucket = require('../models/Bucket');
const axios = require('axios')
const mongoose = require('mongoose');
const { handleFileUpload } = require('../src/bot');

// Share File
const shareBucket = async (req, res) => {
    const { bucketId, password, expiresAt } = req.body;
    
    const expiresAtDate = new Date(expiresAt||null);
    // if ((expiresAt!='undefined' || expiresAt != '')) {
        // if(isNaN(expiresAtDate)) return res.status(400).json({ message: 'Invalid date format for expiresAt' });
    // }

    if(!bucketId) return res.status(400).json({ message: 'BucketId is required' });

    if(!mongoose.Types.ObjectId.isValid(bucketId)) return res.status(400).json({ message: 'BucketId is invalid' });

    const bucketData = await Bucket.findOne({_id:bucketId, userId:req.user.id});

    if(!bucketData) return res.status(400).json({ message: 'Bucket not found' });

    const userId = req.user.id;

    try {
        const fileShare = new FileShare({
            userId,
            bucketId,
            password: password || null,
            expiresAt: expiresAtDate || null,
            code: Math.random().toString(36).substring(7),
        });

        await fileShare.save();
        res.status(200).json({ message: 'File shared successfully', url: `${process.env.BASE_URL}/share/${fileShare.code}` });
    } catch (error) {
        console.log("------------error-----------");
        console.log(error);
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Access shared file
const accessFile = async (req, res) => {
    const { code } = req.params;

    try {
        const fileShare = await FileShare.findOne({ code });
        if (!fileShare) return res.status(400).json({ message: 'File not found' });

        // Check expiration
        if (new Date() > new Date(fileShare.expiresAt)) {
            return res.status(400).json({ message: 'Link expired' });
        }

        const response = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`, {
            params: { file_id: fileShare.fileId },
        });

        if (response.data.ok) {
            const filePath = response.data.result.file_path;
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

            // Optionally, you can redirect the client to the file URL:
            // res.redirect(fileUrl);

            // Or fetch the file and stream it to the client
            const fileResponse = await axios.get(fileUrl, { responseType: 'stream' });
            res.setHeader('Content-Type', fileResponse.headers['content-type']);
            res.setHeader('Content-Disposition', `inline; filename="${fileShare.fileName}"`);
            fileResponse.data.pipe(res);
        } else {
            res.status(400).json({ message: 'Error fetching file from CloudStorage' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error });
    }
};

// End share
const endShare = async (req, res) => {
    const { code } = req.params;
    const fileShare = await FileShare.findOne({ code });
    if(!fileShare) return res.status(400).json({ status:false, message:"Data not found!" });
    await FileShare.updateOne({ code }, { code:null, password:null });
    return res.status(200).json({ status:true, message:"Sharing ended successfully!" });
};

// Upload file
const uploadFile = async (req, res) => {
    const { bucketId, password } = req.body;
    const userId = req.user.id;
    const fileBuffer = req.file.buffer;
    const originalFileName = req.file.originalname;
    const fileSizeInBytes = req.file.size;
    const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

    if (!req.file) return res.status(400).json({ status:false, message: 'File is required.' });

    try {
        const bucket = await Bucket.findById(bucketId);
        if(!bucket) return res.status(400).json({ status:false, message: 'Bucket not found.' });

        const uploadResult = await handleFileUpload(fileBuffer, bucketId, originalFileName, userId);

        const newStorage = bucket.storage + fileSizeInMB;
        bucket.storage = newStorage;
        await bucket.save();

        res.status(200).json({ status:true, message: 'File uploaded successfully.', fileId: uploadResult.fileId, thumbnail: uploadResult.thumbnail });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ status:false, message: 'Internal server error.' });
    }
};

const uploadFileByCode = async (req, res) => {
    const { code } = req.params;
    const { password } = req.body;
    const fileBuffer = req.file.buffer;
    const originalFileName = req.file.originalname;
    const fileSizeInBytes = req.file.size;
    const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

    if (!req.file) return res.status(400).json({ status:false, message: 'File is required.' });

    try {
        const fileShare = await FileShare.findOne({ code });
        if(!fileShare) return res.status(400).json({ status:false, message: 'data not found.' });
        if(fileShare.password && fileShare.password !== password) return res.status(400).json({ status:false, message: 'Password is incorrect.' });

        const bucket = await Bucket.findById(fileShare.bucketId);
        if(!bucket) return res.status(400).json({ status:false, message: 'Bucket not found.' });

        const uploadResult = await handleFileUpload(fileBuffer, fileShare.bucketId, originalFileName);

        const newStorage = bucket.storage + fileSizeInMB;  // Add the file size (in MB) to the current storage
        bucket.storage = newStorage;
        await bucket.save();

        res.status(200).json({ status:true, message: 'File uploaded successfully.', fileId: uploadResult.fileId });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ status:false, message: 'Internal server error.' });
    }
};
const deleteFileByCode = async (req, res) => {
    const { code, password } = req.params;
    const fileShare = await FileShare.findOne({ code });
    if(!fileShare) return res.status(400).json({ status:false, message:"Data not found!" });
    if(fileShare.password && fileShare.password !== password) return res.status(400).json({ status:false, message: "you can't able to do this." });
    await FileShare.updateOne({ code }, { code:null, password:null });
    return res.status(200).json({ status:true, message:"Sharing ended successfully!" });
}

module.exports = { shareBucket, accessFile, endShare, uploadFile, uploadFileByCode, deleteFileByCode };
