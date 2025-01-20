const jwt = require('jsonwebtoken')

const jwtAuthMiddleware = (req, res, next) => {
    const authorization = req.headers.authorization
    if(!authorization) return res.status(401).json({ status:false, message: "Token Not Found!"})
    
    const token = authorization.split(' ')[1]
    if(!token) return res.status(401).json({ status:false, message: "Token Not Found!"})

    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = decoded
        next()
    }catch(err){
        if(err.message == 'jwt expired') return res.status(401).json({ status:false, session:false, message: "Session expired!"})
        console.log(err)
        res.status(500).json({error: "Invalide Token"})
    }
}

module.exports = {jwtAuthMiddleware}