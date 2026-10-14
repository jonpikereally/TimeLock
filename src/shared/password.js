// Only a salted PBKDF2 hash is stored, never the password itself.

const ITER = 210000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(password, salt, ITER)), iter: ITER };
}

export async function checkPassword(password, stored) {
  if (!stored) return false;
  const got = b64(await derive(String(password), unb64(stored.salt), stored.iter));
  // Constant-time-ish compare; the cooldown does the real brute-force protection.
  let diff = got.length ^ stored.hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (stored.hash.charCodeAt(i) || 0);
  return diff === 0;
}
