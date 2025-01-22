const axios = require('axios');
const File = require('../models/File');

const getThumbNail = async (req, res) => {
    try {
        const fileId = req.params.fileId;

        // Step 1: Get the file path from Telegram
        const fileData = await File.findOne({ fileId: fileId });
        if (!fileData) return res.status(400).json({ status: false, message: "File not found!" });
        const fileResponse = await axios.get(fileData.thumbnail, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(fileResponse.data, 'binary').toString('base64');
        const contentType = fileResponse.headers['content-type'];
        return res.send(`data:${contentType};base64,${base64Image}`);

    } catch (error) {
        console.error("Error fetching thumbnail:", error);
        res.status(500).send("Internal Server Error");
    }
};

module.exports = { getThumbNail };
