const express = require('express');
const db = require('./config/db');
const dotenv = require('dotenv');
const userRoutes = require('./routes/user');
const bucketRoutes = require('./routes/bucket');
const fileShareRoutes = require('./routes/fileShare');
const thumbnailRoutes = require('./routes/thumbnailRoutes');
const bodyParser = require('body-parser');
const cors = require('cors')

const https = require('https');

dotenv.config();

const app = express();

// Body parser middleware
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
app.use(express.json());
app.use(cors({ origin: '*' }));


// app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/buckets', bucketRoutes);
app.use('/api/files', fileShareRoutes);
app.use('/api', thumbnailRoutes);

// proxy routes
app.get('/file/:fileName', (req, res) => {
    const fileName = req.params.fileName;
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/documents/${fileName}`;

    https.get(fileUrl, (fileRes) => {
        const contentType = fileRes.headers['content-type'];

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        fileRes.pipe(res);
    }).on('error', (err) => {
        res.status(500).send('Error streaming file');
    });
});

// Server setup
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
