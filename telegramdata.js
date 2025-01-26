// require("dotenv").config();

// const { TelegramClient } = require("telegram");
// const { StringSession } = require("telegram/sessions");
// const input = require("input"); // For interactive input

const apiId = "27622442"; // Replace with your actual API ID
const apiHash = "d21311e9010f410a84606f286a45939a"; // Replace with your actual API Hash
// const stringSession = new StringSession(""); // Empty session initially

// (async () => {
//   const client = new TelegramClient(stringSession, apiId, apiHash, {
//     connectionRetries: 5,
//   });

//   await client.start({
//     phoneNumber: async () => await input.text("Enter your phone number: "),
//     password: async () => await input.text("Enter your password: "),
//     phoneCode: async () => await input.text("Enter the code you received: "),
//     onError: (err) => console.log(err),
//   });

//   console.log("Logged in successfully!");
//   console.log("Your session string:", client.session.save());

//   // Copy and save this session string securely
// })();


const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// const apiId = ;  // Replace with your API ID
// const apiHash = 'your_api_hash';  // Replace with your API Hash

const stringSession = new StringSession(process.env.SESSION_STRING);  // Empty string if no session string is saved
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
});

async function startClient() {
    try {
        await client.connect();
        console.log('Client connected successfully!');
    } catch (error) {
        console.error('Error connecting the client:', error);
    }
}

startClient();