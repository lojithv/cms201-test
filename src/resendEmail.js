async function strToZipBase64(str) {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const buff = await new Response(cs.readable).arrayBuffer();
  const compressed = new Uint8Array(buff);
  return btoa(String.fromCharCode(...compressed));
}

export class ResendEmail {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  //YYMMDD_HHMM in GMT
  timestamp() {
    return new Date().toISOString().replaceAll(/[:-]/g, "").replaceAll("T", "_").slice(2, 13);
  }

  #sendEmail(body) {
    body.from = "Acme <onboarding@resend.dev>";
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async backupEmail(domain, to, content, type) {
    const timestamp = this.timestamp();
    return this.#sendEmail({
      to,
      subject: `${type} backup ${domain}`,
      html: `${type} backup of ${domain} at ${timestamp}`,
      attachments: [{
        filename: `backup_domain_${timestamp}.json.gz`,
        content: await strToZipBase64(content)
      }]
    });
  }

  async confirmRollbackEmail(domain, to, link, content) {
    const timestamp = this.timestamp();
    return this.#sendEmail({
      to,
      subject: `rollback confirmation ${domain} at ${this.timestamp()}`,
      html: `please review this backup, click this link to continue to rollback: <a href=${link}>${link}</a>`,
      attachments: [{
        filename: `backup_domain_${timestamp}.json.gz`,
        content: await strToZipBase64(content)
      }]
    });
  }
}