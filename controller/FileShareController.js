const FileShare = require('../models/FileShare');
const UserInfo = require('../models/UserInfo');

// Share File
const shareFile = async (req, res) => {
    const { bucketId, fileUrl, password } = req.body;
    const userId = req.user.id;

    try {
        const fileShare = new FileShare({
            userId,
            bucketId,
            fileUrl,
            password: password || null,
            code: Math.random().toString(36).substring(7), // Unique code generation
            expiresAt: new Date(new Date().getTime() + 1000 * 60 * 60 * 24), // 24 hours expiry
        });

        await fileShare.save();
        res.status(200).json({ message: 'File shared successfully', code: fileShare.code });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error });
    }
};

// Access shared file
const accessSharedFile = async (req, res) => {
    const { fileId } = req.params;
    const { password } = req.body;

    try {
        const file = await FileShare.findById(fileId);
        if (!file) return res.status(400).json({ message: 'File not found' });

        // Check expiration
        if (new Date() > new Date(file.expiresAt)) {
            return res.status(400).json({ message: 'Link expired' });
        }

        // Check password
        if (file.password && file.password !== password) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        res.status(200).json({ message: 'Access granted', fileUrl: file.fileUrl });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error });
    }
};

module.exports = { shareFile, accessSharedFile };
