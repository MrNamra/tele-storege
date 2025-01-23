const https = require('https');
const File = require('../models/File');
const { sanitizeFileId } = require('../utils/sanitizers');

const getThumbNail = async (req, res) => {
    try {
        const fileId = sanitizeFileId(req.params.fileId);

        const fileData = await File.findOne({ fileId: fileId });
        if (!fileData) return res.status(404).json({ status: false, message: "Thumbnail not found!" });

        const fileUrl = fileData.thumbnail;
        https.get(fileUrl, (fileRes) => {
            const contentType = fileRes.headers['content-type'];

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', 'inline');
            fileRes.pipe(res);
        }).on('error', (err) => {
            res.status(500).send('Error streaming file');
        });

    } catch (error) {
        console.error("Error fetching thumbnail:", error);
        res.status(500).send("Internal Server Error");
    }
};

const getFile = async (req, res) => {
    const fileId = sanitizeFileId(req.params.fileId);

    const fileData = await File.findOne({ fileId: fileId });
    if (!fileData) return res.status(404).json({ status: false, message: "File not found!" });

    const fileUrl = fileData.fileUrl;
    https.get(fileUrl, (fileRes) => {
        const contentType = fileRes.headers['content-type'];

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        fileRes.pipe(res);
    }).on('error', (err) => {
        res.status(500).send('Error streaming file');
    });
};

module.exports = { getThumbNail, getFile };
