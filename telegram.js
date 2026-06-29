// Posts messages to Telegram via the Bot API.
//
// Two destinations:
//   - the public channel (TELEGRAM_*)        -> daily free-slots post
//   - a private group   (REPORT_*)           -> daily payroll report
// REPORT_BOT_TOKEN falls back to the channel bot token when only the chat differs.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // @username or numeric -100... id

const REPORT_BOT_TOKEN = process.env.REPORT_BOT_TOKEN || BOT_TOKEN;
const REPORT_CHAT_ID = process.env.REPORT_CHAT_ID; // numeric group/supergroup id

const isConfigured = Boolean(BOT_TOKEN && CHANNEL_ID);
const isReportConfigured = Boolean(REPORT_BOT_TOKEN && REPORT_CHAT_ID);

async function callApi(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram ${method} error: ${result.description || JSON.stringify(result)}`);
  }
  return result.result;
}

function sendMessage(token, chatId, text, replyMarkup) {
  return callApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function postToChannel(text) {
  if (!isConfigured) {
    throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID)');
  }
  return sendMessage(BOT_TOKEN, CHANNEL_ID, text);
}

async function postReport(text, replyMarkup) {
  if (!isReportConfigured) {
    throw new Error('Report Telegram is not configured (REPORT_BOT_TOKEN / REPORT_CHAT_ID)');
  }
  return sendMessage(REPORT_BOT_TOKEN, REPORT_CHAT_ID, text, replyMarkup);
}

async function deleteMessage(messageId) {
  if (!isConfigured || !messageId) return;
  await callApi(BOT_TOKEN, 'deleteMessage', { chat_id: CHANNEL_ID, message_id: messageId });
}

// --- Report callback buttons (tap-to-mark-paid) ----------------------------
function editReportMarkup(chatId, messageId, replyMarkup) {
  return callApi(REPORT_BOT_TOKEN, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

function answerReportCallback(callbackId, text) {
  return callApi(REPORT_BOT_TOKEN, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
  });
}

// Point the report bot's callbacks at our webhook. `secret` is echoed back by
// Telegram in the X-Telegram-Bot-Api-Secret-Token header so we can verify it.
function setReportWebhook(url, secret) {
  return callApi(REPORT_BOT_TOKEN, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['callback_query'],
  });
}

module.exports = {
  postToChannel,
  postReport,
  deleteMessage,
  editReportMarkup,
  answerReportCallback,
  setReportWebhook,
  isConfigured,
  isReportConfigured,
};
