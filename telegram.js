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
const configuredTimeout = process.env.TELEGRAM_REQUEST_TIMEOUT_SECONDS;
const timeoutSeconds = configuredTimeout == null || configuredTimeout === ''
  ? 10
  : Number(configuredTimeout);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  throw new Error('TELEGRAM_REQUEST_TIMEOUT_SECONDS must be a positive number');
}
const REQUEST_TIMEOUT_MS = timeoutSeconds * 1000;
const MAX_RATE_LIMIT_RETRIES = 2;

const isConfigured = Boolean(BOT_TOKEN && CHANNEL_ID);
const isReportConfigured = Boolean(REPORT_BOT_TOKEN && REPORT_CHAT_ID);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callApi(token, method, body) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Telegram ${method} timed out`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Telegram ${method} returned invalid JSON (HTTP ${response.status})`);
    }

    if ((response.status === 429 || result.error_code === 429) && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(result.parameters && result.parameters.retry_after) || 1;
      await wait(retryAfter * 1000);
      continue;
    }
    if (!response.ok || !result.ok) {
      throw new Error(`Telegram ${method} error: ${result.description || JSON.stringify(result)}`);
    }
    return result.result;
  }
  throw new Error(`Telegram ${method} exceeded its retry limit`);
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
