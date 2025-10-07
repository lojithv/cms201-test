export class AesGcmHelper {
  constructor(cryptoKey) {
    this.key = cryptoKey;
  }

  static async make(password) {
    const enc = new TextEncoder();
    const passwordBytes = enc.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", passwordBytes);
    const key = await crypto.subtle.importKey(
      "raw",
      hashBuffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    return new AesGcmHelper(key);
  }

  async encrypt(plainText) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.key,
      enc.encode(plainText)
    );

    const packed = new Uint8Array(iv.length + ciphertext.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...packed));
  }

  async encryptAsJSON(obj) {
    return await this.encrypt(JSON.stringify(obj));
  }

  async decrypt(base64Ciphertext) {
    const packed = Uint8Array.from(atob(base64Ciphertext), c => c.charCodeAt(0));
    const iv = packed.slice(0, 12);
    const data = packed.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      this.key,
      data
    );

    return new TextDecoder().decode(decrypted);
  }

  async decryptAsJSON(encryptedStr) {
    const decrypted = await this.decrypt(encryptedStr);
    return JSON.parse(decrypted);
  }

  async makeSecret(ttl, data = {}) {
    return await this.encryptAsJSON({ ttl: new Date().getTime() + ttl, ...data });
  }

  async validateSecret(request) {
    const secretToken = request.headers.get("Authorization")?.split("Bearer ")?.[1];
    if (!secretToken)
      throw "no Authorization Bearer token found";
    const secret = await this.decryptAsJSON(secretToken);
    if (!secret) throw "invalid token";
    if (secret.ttl < new Date().getTime()) throw "token expired";
    return secret;
  }
}
