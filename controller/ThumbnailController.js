const axios = require('axios');
const mime = require('mime-types'); // To get MIME types based on file extension

const getThumbNail = async (req, res) => {
    try {
        const fileId = req.params.fileId;

        // Step 1: Get the file path from Telegram
        const response = await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);
        
        if (!response.data.ok) {
            return res.status(404).send("Thumbnail not found");
        }

        const filePath = response.data.result.file_path;
        const tFileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

        // Step 2: Determine file extension and MIME type
        const fileExt = filePath.split('.').pop(); // Get file extension
        const contentType = mime.lookup(fileExt) || "application/octet-stream"; // Get MIME type

        // Step 3: Check if the file is an image (optional: check for videos too)
        if (contentType.startsWith("image/")) {
            // Step 4: Fetch the actual image file
            const response2 = await axios.get(tFileUrl, { responseType: 'stream' });

            // Step 5: Set headers to display the image in the browser
            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", `inline; filename="thumbnail.${fileExt}"`);

            // Step 6: Pipe the file directly to the response
            response2.data.pipe(res);
        } else if (contentType === "application/octet-stream") {
            // Handle files like OpenSSH keys (you could either display the text or force download)
            const response2 = await axios.get(tFileUrl, { responseType: 'stream' });

            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", `attachment; filename="file.${fileExt}"`);
            response2.data.pipe(res); // Force download of the file
        } else {
            // If it's not an image or file to handle differently
            res.status(415).json({});
        }
    } catch (error) {
        console.error("Error fetching thumbnail:", error);
        res.status(500).send("Internal Server Error");
    }
};

module.exports = { getThumbNail };
