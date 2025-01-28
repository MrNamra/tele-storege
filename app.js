const express = require('express');
const db = require('./config/db');
const dotenv = require('dotenv');
const userRoutes = require('./routes/user');
const bucketRoutes = require('./routes/bucket');
const fileShareRoutes = require('./routes/fileShare');
const thumbnailRoutes = require('./routes/thumbnailRoutes');
const cors = require('cors')

const https = require('https');

dotenv.config();

const app = express();

// Body parser middleware
app.use(express.json());
app.use(cors({ origin: '*' }));


// app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/buckets', bucketRoutes);
app.use('/api/files', fileShareRoutes);
app.use('/api', thumbnailRoutes);

// Server setup
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
