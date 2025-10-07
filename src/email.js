import { EmailMessage } from "cloudflare:email";

async function strToZipBase64(str) {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const buff = await new Response(cs.readable).arrayBuffer();
  const compressed = new Uint8Array(buff);
  return btoa(String.fromCharCode(...compressed));
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:-]/g, "").replaceAll("T", "_").slice(2, 13);
}

export async function EmailMessageWithZipAttachment(msg, domain, from, to, contentToBeZipped, body) {
  const signature = domain + "_" + timestamp();
  const subject = msg + ` backup (${signature})`;
  const zipFileName = msg.replaceAll(/[^a-z0-9_]/ig, "_") + `_backup_${signature}.json.gz`;
  contentToBeZipped = await strToZipBase64(contentToBeZipped);
  let random = Math.random().toString(36).substring(2);
  let boundary;
  while (contentToBeZipped.includes(boundary = "----=_Part_" + random))
    random = Math.random().toString(36).substring(2);

  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <${Date.now()}.${random}@${domain}>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    body ?? subject,
    ``,
    `--${boundary}`,
    `Content-Type: application/gzip; name="${zipFileName}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${zipFileName}"`,
    ``,
    contentToBeZipped,
    `--${boundary}--`,
    ``
  ].join("\r\n");
  return await new EmailMessage(from, to, raw);
}
