const crypto = require('node:crypto');

const BOT_TOKEN = process.env.EITAA_BOT_TOKEN || '';

// The docs explicitly recommend bounding initData's age using auth_date so a
// leaked/logged initData string can't be replayed forever to mint sessions.
const MAX_SIGNED_DATA_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies the HMAC-SHA256 hash on a query-string-shaped payload from Eitaa
 * (used for both `initData` and the `requestContact` callback's second
 * argument — the docs state the latter is verified "همانند initData", i.e.
 * the same algorithm). Returns the parsed key/value fields with `hash`
 * removed, or null if the signature doesn't check out.
 */
function verifySignedData(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const params = new URLSearchParams(raw);
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

  return Object.fromEntries(params.entries());
}

/**
 * Validates initData raw string and returns the parsed fields, including the
 * decoded `user` object and a freshness-checked `auth_date`, when valid.
 */
function verifyInitData(initData) {
  const result = verifySignedData(initData);
  if (!result) return null;

  const authDate = Number(result.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > MAX_SIGNED_DATA_AGE_SECONDS) return null;

  if (!result.user) return null;
  try {
    result.user = JSON.parse(result.user);
  } catch {
    return null;
  }
  return result;
}

/**
 * Validates the contact-data string passed as the second argument to
 * WebApp.requestContact()'s callback, and returns the parsed `contact` field
 * (or the raw fields if there's no separate `contact` key) when valid.
 *
 * Unlike initData, the docs never actually specify this payload's exact
 * field set — they only say it's verifiable "همانند initData" (the same
 * algorithm). auth_date is therefore checked if present, but NOT required:
 * an earlier version required it unconditionally, which — if Eitaa's real
 * payload omits it — made every single call fail verification, silently
 * (the caller's error was swallowed), so contact_shared never got persisted
 * and the share-your-number prompt kept reappearing on every launch.
 */
function verifyContactData(raw) {
  const result = verifySignedData(raw);
  if (!result) return null;

  if (result.auth_date !== undefined) {
    const authDate = Number(result.auth_date);
    if (!authDate || Date.now() / 1000 - authDate > MAX_SIGNED_DATA_AGE_SECONDS) return null;
  }

  if (result.contact) {
    try {
      result.contact = JSON.parse(result.contact);
    } catch {
      // leave as the raw string — still usable, just not pre-parsed
    }
  }
  return result;
}

/**
 * Sends a text message to a user via the Eitaa app API. Requires prior write
 * access. Returns { ok, status, body } — callers should log `status`/`body`
 * on failure since Eitaa's API includes the actual rejection reason there.
 */
async function sendMessage(chatId, text) {
  const res = await fetch('https://eitaayar.ir/api/app/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOT_TOKEN, chat_id: chatId, text }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body && body.ok === true, status: res.status, body };
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

module.exports = { verifyInitData, verifyContactData, sendMessage, issueSessionToken, verifySessionToken };
