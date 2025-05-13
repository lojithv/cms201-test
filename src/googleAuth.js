async function getGoogleJWKs() {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await res.json();
  return keys;
}

async function importPublicKey(jwk) {
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
}

function base64UrlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4 !== 0) input += '=';
  return atob(input);
}

function base64UrlToUint8Array(base64url) {
  const decoded = base64UrlDecode(base64url);
  const binary = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) binary[i] = decoded.charCodeAt(i);
  return binary;
}

function parseJWT(token) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));
  const signature = base64UrlToUint8Array(signatureB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  return { header, payload, signature, signedData };
}

let googleCerts;
const googleCertCryptoKeys = {};
async function verifyJWTSignature(token) {
  const { header, payload, signature, signedData } = parseJWT(token);
  const keys = googleCerts ??= await getGoogleJWKs();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return;
  const cryptoKey = googleCertCryptoKeys[jwk.kid] ??= await importPublicKey(jwk);
  const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!isValid) return;
  return payload;
}

function validateToken(payload, settings) {
  return payload.aud === settings.google.client_id && ((Date.now() / 1000) < payload.exp);
}

const memory = {};
export function getAuthGoogleUser(rawToken, settings) {
  if (!rawToken) return;
  if (rawToken in memory) {
    if (validateToken(memory[rawToken], settings))
      return memory[rawToken];
    return delete memory[rawToken];
  }
  return verifyJWTSignature(rawToken).then(payload => {
    if (payload && validateToken(payload, settings))
      return memory[rawToken] = payload;
  });
}