const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sessionFile = path.join(__dirname, '../storage/telegram/session.txt');

async function main() {
  console.log('========================================================');
  console.log('         CloudVault Telegram Client Login');
  console.log('========================================================');

  let apiId = parseInt(process.env.TELEGRAM_API_ID || '27622442', 10);
  let apiHash = process.env.TELEGRAM_API_HASH || 'd21311e9010f410a84606f286a45939a';

  // If invalid or placeholder ID detected, prompt user
  if (!apiId || apiId === 824488511) {
    apiId = 27622442;
    apiHash = 'd21311e9010f410a84606f286a45939a';
  }

  console.log(`Using Telegram App Credentials:`);
  console.log(`  API ID   : ${apiId}`);
  console.log(`  API HASH : ${apiHash.substring(0, 6)}...${apiHash.substring(apiHash.length - 4)}`);
  console.log('--------------------------------------------------------');

  const custom = await input.text('Press Enter to use these credentials, or type "custom" to enter your own: ');
  if (custom.trim().toLowerCase() === 'custom') {
    const customId = await input.text('Enter your API ID (from https://my.telegram.org): ');
    const customHash = await input.text('Enter your API HASH: ');
    if (customId && customHash) {
      apiId = parseInt(customId.trim(), 10);
      apiHash = customHash.trim();
    }
  }

  let sessionStr = '';
  if (fs.existsSync(sessionFile)) {
    sessionStr = fs.readFileSync(sessionFile, 'utf8').trim();
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      await input.text('Enter phone number with country code (e.g., +919876543210): '),
    password: async () =>
      await input.text('Enter 2-Step Verification password (leave empty if none): '),
    phoneCode: async () =>
      await input.text('Enter verification code received in Telegram: '),
    onError: (err) => {
      console.error('Error:', err.message);
      if (err.message && err.message.includes('API_ID_INVALID')) {
        console.error('\n[Tip] API_ID_INVALID means the API ID and API HASH do not match or are expired.');
        console.error('You can generate a free pair at https://my.telegram.org under "API development tools".');
      }
    },
  });

  const me = await client.getMe();
  const saved = client.session.save();

  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile, saved, 'utf8');

  console.log('========================================================');
  console.log(`✓ Successfully authenticated as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'no_username'})`);
  console.log(`✓ Session successfully saved to: ${sessionFile}`);
  console.log('✓ You can now start the server with: npm start');
  console.log('========================================================');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\nAuthentication failed:', err.message);
  process.exit(1);
});
