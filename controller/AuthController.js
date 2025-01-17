const User = require("../models/User");
const { generateToken } = require("../config/jwt");

const login = async (req, res) => {
    try {
        const [email, password] = req.body;
        const user = await User.findOne({ email });
    
        if(!user || await user.confirmpassword(password))
            return res.status(401).json({ status: false, message: "User not Found with is credentials"});
    
        const payload = {
            id : user._id,
        }
        const token = generateToken(payload)
        return res.status(200).json({ status: true, message: "User logged in successfully", data: token })
    }catch(err){
        res.send({satus: false, message: err});
    }
}
const register = async (req, res) => {
    try {
        const data = req.body
        if(data.email !== undefined || data.email == ''){
            res.status(403).json({ status: flase , message: "Email is missing"});
        }
        if(data.password !== undefined || data.password == ''){
            res.status(403).json({ status: flase , message: "Password is missing"});
        }
        if(data.name !== undefined || data.name == ''){
            res.status(403).json({ status: flase , message: "Name is missing"});
        }
        if(data.password !== data.confirmpassword){
            res.status(403).json({ status: flase , message: "Password & Confirm Password is not match"});
        }
        const newUser = new User(data)
        const response = await newUser.save()
        console.log(response);

        return res.status(201).json({ status: true, message: "User created successfully" })
    } catch(err) {
        res.send({"satus": false, "message": err});
    }
}

module.exports = {
    login,
    register
}