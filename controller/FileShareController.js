const FileShare = require('../models/FileShare');
const File = require('../models/File');
const Bucket = require('../models/Bucket');
const axios = require('axios')
const bot = require('../src/bot');
const mongoose = require('mongoose');
const { handleFileUpload, getFile } = require('../src/bot');

// Share File
const shareBucket = async (req, res) => {
    const { bucketId, password, expiresAt } = req.body;
    
    const expiresAtDate = new Date(expiresAt||null);
    // if ((expiresAt!='undefined' || expiresAt != '')) {
        // if(isNaN(expiresAtDate)) return res.status(400).json({ message: 'Invalid date format for expiresAt' });
    // }

    if(!bucketId) return res.status(400).json({ status: false, message: 'BucketId is required' });

    if(!mongoose.Types.ObjectId.isValid(bucketId)) return res.status(400).json({ status: false, message: 'BucketId is invalid' });

    const bucketData = await Bucket.findOne({_id:bucketId, userId:req.user.id});

    if(!bucketData) return res.status(400).json({ status: false, message: 'Bucket not found' });

    const userId = req.user.id;

    try {
        let fileShare = await FileShare.findOne({ bucketId: bucketId });
        if(fileShare) {
            fileShare = await FileShare.findOneAndUpdate({ bucketId: bucketId }, {
                password: password || null,
                expiresAt: expiresAtDate || null,
                code: Math.random().toString(36).substring(7),
            });
        } else {
            fileShare = new FileShare({
                userId,
                bucketId,
                password: password || null,
                expiresAt: expiresAtDate || null,
                code: Math.random().toString(36).substring(7),
            });
        }

        await fileShare.save();
        res.status(200).json({ status: true, message: 'File shared successfully', url: `${process.env.BASE_URL}/share/${fileShare.code}` });
    } catch (error) {
        console.log("------------error-----------");
        console.log(error);
        res.status(500).json({ status: false, message: 'Server Error', error });
    }
};

// Access file
const accessFile = async (req, res) => {
    const { fileId } = req.params;
    const userId = req.user.id;

    try {
        const fileData = await File.findOne({ fileId });
        if (!fileData) return res.status(400).json({ status: false, message: 'File not found!' });

        const bucketData = await Bucket.findOne({ _id: fileData.bucketId, userId });
        if(!bucketData) return res.status(400).json({ status:false, message:"File not found!" });

        // Or fetch the file and stream it to the client
        const fileResponse = await axios.get(fileData.fileUrl, { responseType: 'stream' });
        res.setHeader('Content-Type', fileResponse.headers['content-type']);
        res.setHeader('Content-Disposition', `inline; filename="${fileData.fileName}"`);
        fileResponse.data.pipe(res);
    } catch (error) {
        res.status(500).json({ status: false, message: 'Server Error', error });
    }
};

// End share
const endShare = async (req, res) => {
    const userId = req.user.id; 
    const { code } = req.params;
    const fileShare = await FileShare.findOne({ code });
    if(!fileShare) return res.status(400).json({ status:false, message:"Data not found!" });
    console.log(fileShare, userId);
    if(!fileShare.userId.equals(userId)) return res.status(400).json({ status:false, message:"Something went wrong!" });
    await FileShare.deleteOne({ code });
    return res.status(200).json({ status:true, message:"Sharing ended successfully!" });
};

// Upload file
const uploadFile = async (req, res) => {
    const { bucketId } = req.body;
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

const deleteUploadFile = async (req, res) => {
    try{
        const { fileId } = req.params;
        const userId = req.user.id;
    
        const fileData = await File.findById(fileId);
        if(!fileData) return res.status(404).json({ status:false, message:"Data not found!" });

        if(!fileData.userId.equals(userId)) return res.status(400).json({ status:false, message:"Something went wrong!" });
    
        const bucket = await Bucket.findById(fileData.bucketId);
        if(!bucket) return res.status(404).json({ status:false, message:"Bucket not found!" });
    
        const fileInfo = await getFile(fileData.fileId);
        
        const fileSize = fileInfo.file_size??0;

        let newStorage = bucket.storage - fileSize;
        if(newStorage < 0) newStorage = 0;
        
        bucket.storage = newStorage;
        await bucket.save();
    
        await bot.deleteFileFromCloud(fileData.messageId);
    
        await File.deleteOne({ _id: fileId });
        return res.status(200).json({ status:true, message:"File deleted successfully!" });
    } catch(error){
        console.error('Error deleting file:', error);
        res.status(500).json({ status:false, message: 'Internal server error.' });
    }
}

module.exports = { 
    shareBucket,
    accessFile,
    endShare,
    uploadFile,
    uploadFileByCode,
    deleteUploadFile
};
