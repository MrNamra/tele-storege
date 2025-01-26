const Bucket = require('../models/Bucket');
const FileShare = require('../models/FileShare');
const User = require('../models/User');
const { deleteFileFromCloud, client } = require('../src/bot');
const { Api } = require("telegram");
const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    // Create Bucket
    createBucket: async (req, res) => {
        const { bucketName } = req.body;
        const userId = req.user.id;

        // try {

            const userData = await User.findById(userId);
            if (!userData) return res.status(400).json({ status: false, message: "User not found!" });

            if (userData.bucketAllowed < 1) return res.status(400).json({ status: false, message: "You have no bucket allowed!" });

            await client.connect();
            const result = await client.invoke(
                new Api.channels.CreateChannel({
                    title: bucketName,
                    about: "Storage Group for " + bucketName,
                    megagroup: true,
                })
            );

            console.log("result:", result);
            const groupId = result.updates.find(update => update.className === 'UpdateChannel').channelId;
            const accessHash = result.chats[0].accessHash;
            const inviteLink = await client.invoke(
                new Api.messages.ExportChatInvite({ peer: groupId })
            );

            // Creating a new bucket with a unique bucketId
            const newBucket = new Bucket({
                userId,
                bucketName,
                groupId,
                accessHash,
                inviteLink: inviteLink.link,
                storageUsed: 0,
            });

            // Save to database
            await newBucket.save();
            
            userData.bucketAllowed = userData.bucketAllowed - 1;
            userData.bucketCount = userData.bucketCount + 1;
            await userData.save();

            return res.status(201).json({ status: true, message: 'Bucket created successfully', bucket: newBucket });
        // } catch (error) {
        //     return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
        // }
    },

    // List Buckets
    listBuckets: async (req, res) => {
        const userId = req.user.id;

        try {
            const buckets = await Bucket.find({ userId }, { userId: 0, __v: 0, inviteLink: 0 });
            return res.status(200).json({ status: true, message: "Buckets found", buckets });
        } catch (error) {
            return res.status(500).json({ status: false, message: 'Server Error', error: error.message });
        }
    },

    // Edit Bucket
    editBucket: async (req, res) => {
        const userId = req.user.id;
        const bucketId = req.params.bucketId;
        const { bucketName } = req.body;

        try {
            const bucket = await Bucket.findOne({ _id: bucketId, userId: userId });
            if (!bucket) return res.status(400).json({ status: false, message: "Bucket not found!" });

            bucket.bucketName = bucketName;

            console.log("bucket:", bucket);
            console.log("bucketName:", bucketName);

            if (bucket.groupId && bucket.accessHash) {
                try {
                    const peer = new Api.InputPeerChannel({
                        channelId: Number(bucket.groupId),
                        accessHash: BigInt(bucket.accessHash),
                    });

                    const invoke = await new Api.channels.EditTitle({
                        channel: peer,
                        title: bucketName,
                    })
                    console.log("invoke:", invoke);
    
                    // Call the API to update the group title
                    const result = await client.invoke(invoke);

                } catch (error) {
                    console.error("Error updating group name:", error);
                    return res.status(500).json({
                        status: false,
                        message: 'Error updating group name',
                        error: error.message,
                    });
                }
            } else {
                return res.status(400).json({
                    status: false,
                    message: 'Group ID or Hash not found for this bucket. Cannot update group name.',
                });
            }
    
            // Save the updated bucket details to database
            await bucket.save();
    
            return res.status(200).json({ status: true, message: 'Bucket updated successfully' });
        } catch (error) {
            console.error("Error in editBucket method:", error);
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

            if (!bucket) return res.status(404).json({ status: false, message: 'Bucket not found' });

            // delete files Share Info data
            await FileShare.deleteMany({ bucketId: bucketId });

            if (bucket.groupId && bucket.accessHash) {
                try {
                    const peer = new Api.InputPeerChannel({
                        channelId: Number(bucket.groupId),
                        accessHash: BigInt(bucket.accessHash),
                    });
    
                    await client.invoke(new Api.channels.DeleteChannel({ channel: peer }));
                } catch (error) {
                    console.error("Error deleting Bucket:", error);
                    return res.status(500).json({
                        status: false,
                        message: "Error deleting Bucket",
                        error: error.message,
                    });
                }
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
        const { code, bucketId } = req.params;
        let search = req.query.search || '';
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
    
        if (isNaN(page) || page <= 0) page = 1;
        if (isNaN(limit) || limit <= 0) limit = 20;
    
        const skip = (Math.max(page - 1, 0)) * limit;
    
        try {
            let bucket = null;
            let totalStorage = 0;
    
            // Find bucket based on code or bucketId
            if (code) {
                bucket = await FileShare.findOne({ code });
                if (!bucket) return res.status(404).json({ status: false, message: "Data not found!" });
                
                const tmpBucketData = await Bucket.findById(bucket.bucketId);
                console.log("tmpBucketData:", tmpBucketData);

                bucket.groupId = tmpBucketData.groupId;
                bucket.accessHash = tmpBucketData.accessHash;
                totalStorage = tmpBucketData.storage;
            } else if (bucketId) {
                const userId = req.user.id;
                bucket = await Bucket.findOne({ _id: bucketId, userId });
                if (!bucket) return res.status(404).json({ status: false, message: "Data not found!" });

                bucket.bucketId = bucket._id;
                totalStorage = bucket.storage;
            }

            console.log("bucket:", bucket);

            if (!bucket.groupId) return res.status(404).json({ status: false, message: "Bucket has no Telegram group!" });
    
            const groupId = bucket.groupId;
   
            // Fetch messages (files) from the Telegram group
            const messages = await client.invoke(
                new Api.messages.GetHistory({
                    peer: new Api.InputPeerChannel({
                        channelId: Number(groupId),
                        accessHash: BigInt(bucket.accessHash),
                    }),
                    limit: limit,
                    addOffset: skip,
                })
            );
    
            if (!messages || messages.messages.length === 0) {
                return res.status(200).json({
                    status: true,
                    message: "No files found",
                    data: [],
                    totalFiles: 0,
                    totalStorage,
                    pagination: { currentPage: page, totalPages: 0, totalItems: 0 },
                });
            }
    
            // Extract file data from messages
            const bucketData = messages.messages
                .filter(msg => msg.media && msg.media.document) // Ensure message contains a file
                .map(msg => {
                    const document = msg.media.document;
                    const fileNameAttr = document.attributes.find(attr => attr._ === "DocumentAttributeFilename");
    
                    return {
                        fileId: msg.id,
                        fileName: fileNameAttr ? fileNameAttr.file_name : "Unknown",
                        fileSize: document.size,
                        mimeType: document.mime_type,
                        date: msg.date,
                    };
                });
    
            // Get the total number of messages in the group
            const totalFilesResponse = await client.invoke(
                new Api.messages.GetHistory({
                    peer: new Api.InputPeerChannel({
                        channelId: Number(groupId),
                        accessHash: BigInt(bucket.accessHash),
                    }),
                    limit: 1, // Just get the latest message
                    addOffset: 0,
                })
            );

            const totalFiles = (totalFilesResponse) ? totalFilesResponse.count : 0;
    
            return res.status(200).json({
                status: true,
                message: "Success",
                data: bucketData,
                totalFiles,
                totalStorage,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalFiles / limit),
                    totalItems: totalFiles,
                },
            });
        } catch (error) {
            console.error("Error fetching bucket files:", error);
            return res.status(500).json({ status: false, message: "Server Error", error: error.message });
        }
    },
    
    // Show Bucket File
    showBucketFile: async (req, res) => {
        try {
            const { code, file_id } = req.params;
            const fileInfo = await FileShare.findOne({ code: code });
            if (!fileInfo) return res.status(404).json({ status: false, message: "File not found!" });

            const bucket = await Bucket.findById(fileInfo.bucketId);
            if (!bucket || !bucket.groupId) return res.status(400).json({ status: false, message: "Bucket not found or missing On Server!" });

            const peer = new Api.InputPeerChannel({
                channelId: Number(bucket.groupId),
                accessHash: BigInt(bucket.accessHash),
            });

            const messages = await client.invoke(new Api.messages.GetHistory({
                peer: peer,
                limit: 1,
                addOffset: 0,
                minId: Number(file_id),
                maxId: Number(file_id) + 1,
                })
            );

            const message = messages.messages.find(msg => msg.id == file_id)
            if (!message || !message.media || !message.media.document) return res.status(400).json({ status: false, message: "File not found in Telegram group!" });

            const document = message.media.document;
            const fileNameAttr = document.attributes.find(attr => attr._ === "DocumentAttributeFilename");
            const fileName = fileNameAttr ? fileNameAttr.file_name : "unknown_file";
            const fileMimeType = document.mime_type;

            res.setHeader("Content-Type", fileMimeType);
            res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

            await client.downloadFile(document, {
                progressCallback: (progress, total) => {
                    console.log(`Streaming: ${((progress / total) * 100).toFixed(2)}%`);
                },
                outputStream: res,
            });
        } catch (error) {
            console.error("Error fetching file:", error);
            return res.status(500).json({ status: false, message: 'Server Error', error });
        }
    }
}

