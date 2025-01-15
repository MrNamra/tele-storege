const jwt = require('jsonwebtoken')

const generateToken = (userData) => {
    // gen JWt Token using user data
    return  jwt.sign(userData, process.env.JWT_SECRET, {expiresIn: 30000})
}

module.exports = {jwtAuthMiddleware, generateToken}