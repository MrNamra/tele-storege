const mongoose = require('mongoose');
require('dotenv').config();

const mongURL = process.env.MONGODB_URI;
mongoose.connect(mongURL, {});

const db = mongoose.connection;
db.once('error', (err) => console.log("DataBase Error: ", err))
db.on('connected', () => console.log("DataBase Connected"))
db.on('disconnected', () => console.log("DataBase Disconnected"))

module.exports = db