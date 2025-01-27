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

                    // Extract file name correctly
                    const fileNameAttr = document.attributes.find(attr => attr.className === "DocumentAttributeFilename");

                    return {
                        fileId: msg.id,
                        fileName: fileNameAttr ? fileNameAttr.fileName : "Unknown",
                        fileSize: document.size,
                        mimeType: document.mimeType,
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

            const totalFiles = (totalFilesResponse) ? totalFilesResponse.count - 1 : 0;

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
            const { bucketId, fileId, code } = req.params;
    
            let bucket;
            if(bucketId){
                bucket = await Bucket.findById(bucketId);
            }
            if(code){
                const tmpBucket = await FileShare.findOne({code})
                bucket = await Bucket.findById(tmpBucket.bucketId);
            }

            if (!bucket || !bucket.groupId) {
                console.error(`Bucket not found or missing groupId for bucketId: ${bucketId}`);
                return res.status(400).json({ status: false, message: "Bucket not found or missing on server!" });
            }
    
            const groupId = bucket.groupId;
            const accessHash = bucket.accessHash;
    
            console.log(`Fetching file for Bucket ID: ${bucketId}, Group ID: ${groupId}, File ID: ${fileId}`);
    
            // Create a peer object for the group
            const peer = new Api.InputPeerChannel({
                channelId: Number(groupId),
                accessHash: BigInt(accessHash),
            });
    
            // Fetch message containing the file from the group
            const messages = await client.invoke(new Api.messages.GetHistory({
                peer: peer,
                minId: Number(fileId) - 1,
                maxId: Number(fileId) + 1,
            }));
    
            let message = messages.messages.find(msg => msg.id == fileId);
            if (!message || !message.media || !message.media.document) {
                console.error(`File not found or no document found for fileId: ${fileId}`);
                return res.status(404).json({ status: false, message: "File not found in Server Bucket!" });
            }
    
            const document = message.media.document;
            console.log("Document retrieved: ", document);
    
            const fileReference = document.fileReference || Buffer.alloc(0); // Default to an empty buffer if undefined
            const thumbSize = document.thumbs && document.thumbs[0] ? document.thumbs[0].type : ""; // Use an empty string if no thumbs
    
            // Extract file name from document attributes
            const fileNameAttr = document.attributes.find(attr => attr._ === "DocumentAttributeFilename");
            const fileName = fileNameAttr ? fileNameAttr.file_name : "unknown_file";
            const fileMimeType = document.mimeType;
    
            console.log(`File name: ${fileName}, Mime type: ${fileMimeType}`);
    
            // Set the appropriate headers for streaming the file
            res.setHeader("Content-Type", fileMimeType);
            res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    
            const getFileData = async (location, offset, limit, retryCount = 0) => {
                try {
                    console.log(`Fetching file data at offset ${offset} with limit ${limit}, Retry Count: ${retryCount}`);
    
                    const fileResponse = await client.invoke(new Api.upload.GetFile({
                        cdnSupported: true,
                        location: location,
                        offset: offset,
                        limit: limit,
                    }));
    
                    if (fileResponse && fileResponse.bytes) {
                        return fileResponse.bytes;
                    } else {
                        throw new Error("Error retrieving file data.");
                    }
                } catch (error) {
                    if (error.errorMessage.includes("FILE_REFERENCE_EXPIRED")) {
                        if (retryCount >= 3) {
                            console.error("Max retries reached for expired file reference.");
                            throw new Error("Max retries reached for expired file reference.");
                        }
    
                        console.log("File reference expired. Refetching the message to get a new reference.");
    
                        // Refetch the message to get a new file reference
                        const newMessages = await client.invoke(new Api.messages.GetHistory({
                            peer: peer,
                            minId: Number(fileId) - 1,
                            maxId: Number(fileId) + 1,
                        }));
    
                        message = newMessages.messages.find(msg => msg.id == fileId);
                        if (!message || !message.media || !message.media.document) {
                            console.error("File not found after refetch.");
                            throw new Error("File not found after refetch.");
                        }
    
                        const newDocument = message.media.document;
                        const newFileReference = newDocument.fileReference || Buffer.alloc(0);
                        console.log("newDocument")
                        console.log(newFileReference)
                        const newLocation = new Api.InputDocumentFileLocation({
                            id: newDocument.id,
                            accessHash: newDocument.accessHash,
                            fileReference: newFileReference,
                            thumbSize: thumbSize,
                        });
    
                        // Retry downloading with the new file reference
                        return await getFileData(newLocation, offset, limit, retryCount + 1);
                    } else {
                        throw error;
                    }
                }
            };
    
            // Prepare for chunked download
            const filePart = 512 * 1024; // 512KB per chunk
            let offset = 0;
            const fileParts = [];
    
            // Loop to download the file in parts
            while (offset < document.size) {
                const fileData = await getFileData(
                    new Api.InputDocumentFileLocation({
                        id: document.id,
                        accessHash: BigInt(document.accessHash),
                        fileReference: fileReference,
                        thumbSize: thumbSize,
                    }),
                    offset,
                    filePart
                );
    
                // Push each part to the array
                fileParts.push(fileData);
                offset += filePart;
            }
    
            // Merge the downloaded parts
            const fileData = Buffer.concat(fileParts);
    
            // Stream the file content directly to the response
            res.send(fileData);
    
        } catch (error) {
            console.error("Error streaming file:", error);
            return res.status(500).json({ status: false, message: 'Streaming server error', error });
        }
    }
}

