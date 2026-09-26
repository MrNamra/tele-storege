const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sessionFile = path.join(__dirname, '../storage/telegram/session.txt');
const apiId = parseInt(process.env.TELEGRAM_API_ID || '824488511', 10);
const apiHash = process.env.TELEGRAM_API_HASH || 'd21311e9010f410a84606f286a45939a';

async function main() {
  console.log('--- Telegram Client Login ---');
  console.log(`Using API ID: ${apiId}`);

  let sessionStr = '';
  if (fs.existsSync(sessionFile)) {
    sessionStr = fs.readFileSync(sessionFile, 'utf8').trim();
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Enter your phone number (e.g. +1234567890): '),
    password: async () => await input.text('Enter 2FA password (leave empty if none): '),
    phoneCode: async () => await input.text('Enter the code sent to your Telegram app: '),
    onError: (err) => console.error('Error:', err.message),
  });

  const me = await client.getMe();
  const saved = client.session.save();

  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile, saved, 'utf8');

  console.log('---------------------------------------------------------');
  console.log(`✓ Successfully logged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'no_username'})`);
  console.log(`✓ Session successfully saved to: ${sessionFile}`);
  console.log('You can now start the server with: npm start');
  console.log('---------------------------------------------------------');
  process.exit(0);
}

main().catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
