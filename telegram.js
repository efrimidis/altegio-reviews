// Posts messages to a Telegram channel via the Bot API.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // @username or numeric -100... id

const isConfigured = Boolean(BOT_TOKEN && CHANNEL_ID);

async function postToChannel(text) {
  if (!isConfigured) {
    throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID)');
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram error: ${result.description || JSON.stringify(result)}`);
  }
  return result.result;
}

module.exports = { postToChannel, isConfigured };
