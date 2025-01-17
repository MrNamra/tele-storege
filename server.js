const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const userRoutes = require('./routes/user');
const bucketRoutes = require('./routes/bucket');
const fileShareRoutes = require('./routes/fileShare');

dotenv.config();

const app = express();

// Body parser middleware
app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/buckets', bucketRoutes);
app.use('/api/files', fileShareRoutes);

// MongoDB Connection
mongoose
    .connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.log(err));

// Server setup
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
