const crypto = require('node:crypto');

const BOT_TOKEN = process.env.EITAA_BOT_TOKEN || '';

/**
 * Validates initData raw string against the Eitaa Mini App hash algorithm
 * (see "احراز هویت با hash" in the Eitaa mini-app docs) and returns the
 * parsed fields, including the decoded `user` object, when valid.
 */
function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const result = Object.fromEntries(params.entries());
  if (result.user) {
    try {
      result.user = JSON.parse(result.user);
    } catch {
      return null;
    }
  }
  return result;
}

/** Sends a text message to a user via the Eitaa app API. Requires prior write access. */
async function sendMessage(chatId, text) {
  const res = await fetch('https://eitaayar.ir/api/app/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOT_TOKEN, chat_id: chatId, text }),
  });
  const data = await res.json().catch(() => ({}));
  return data && data.ok === true;
}

// --- Lightweight signed session tokens (no login UI, just proof-of-identity) ---

const APP_SECRET = process.env.APP_SECRET || 'dev-secret';

function issueSessionToken(userId) {
  const payload = JSON.stringify({ uid: userId, iat: Date.now() });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', APP_SECRET).update(payloadB64).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return payload.uid;
  } catch {
    return null;
  }
}

module.exports = { verifyInitData, sendMessage, issueSessionToken, verifySessionToken };
