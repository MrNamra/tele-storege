const bcrypt = require('bcrypt');
const User = require('../models/User');
const Bucket = require('../models/Bucket');
const FileShare = require('../models/FileShare');
const File = require('../models/File');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const newUser = new User({ name, email, password });
        await newUser.save();
        res.status(201).json({ status: true, message: 'User registered successfully' });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Server Error', error });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: '1h',
        });
        res.status(200).json({ status: true, message: 'Login successful', token });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Server Error', error });
    }
};

const profile = async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.user.id }, { password: 0, __v: 0, role: 0, createdAt: 0 });
        res.status(200).json({ status: true, message: 'Profile fetched successfully', user });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Server Error', error });
    }
};

const updateProfile = async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword) return res.status(400).json({ status: false, message: 'Password and confirm password do not match' });

    const userId = req.user.id;
    const updateFields = { name, email };
    if (password) {
        const salt = await bcrypt.genSalt(10);
        updateFields.password = await bcrypt.hash(password, salt);
    }

    const user = await User.findOneAndUpdate({ _id: userId },{ $set: updateFields },{ new: true, runValidators: true });
    res.status(200).json({ status: true, message: 'Profile updated successfully', user });
};

const dashboard = async (req, res) => {
    const userId = req.user.id;
    const user = await User.findOne({ _id: userId }, { _id: 0, password: 0, __v: 0, role: 0, createdAt: 0 });
    const buckets = await Bucket.find({ userId: userId },{ userId: 0 , __v: 0});
    const totalBuckets = await Bucket.estimatedDocumentCount({ userId: userId });
    const totalStorage = buckets.reduce((sum, bucket) => sum + (bucket.storage || 0), 0);

    const newBuckets = await Promise.all(
        buckets.map(async (bucket) => {
            const fileData = await FileShare.findOne({ bucketId: bucket._id }).select("code");
            return {
                ...bucket.toObject(),
                code: fileData ? fileData.code : null,
            };
        })
    );

    const recentFiles = await File.find({ userId: userId },{ _id: 0, fileUrl: 0, userId: 0, uploadedAt:0, __v: 0, thumbnail: 0}).sort({ createdAt: -1 }).limit(5);
    const totalFiles = await File.estimatedDocumentCount({ userId: userId });
    let data = {
        user: user,
        bucket: newBuckets,
        recentFiles: recentFiles,
        totalBuckets: totalBuckets,
        totalStorage: totalStorage,
        totalFiles: totalFiles,
    }
    // const files = await File.find({ userId: userId });

    console.log(userId);
    res.status(200).json({ status: true, message: 'Dashboard fetched successfully', data });
};

module.exports = { register, login, profile, updateProfile, dashboard };
