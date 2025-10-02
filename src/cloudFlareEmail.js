async function strToZipBase64(str) {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(str));
    writer.close();
    const buff = await new Response(cs.readable).arrayBuffer();
    const compressed = new Uint8Array(buff);
    return btoa(String.fromCharCode(...compressed));
}

export class CloudFlareEmail {
    constructor(emailBinding) {
        this.emailBinding = emailBinding;
    }

    //YYMMDD_HHMM in GMT
    timestamp() {
        return new Date().toISOString().replaceAll(/[:-]/g, "").replaceAll("T", "_").slice(2, 13);
    }

    async #sendEmail(emailData){
        return await this.emailBinding.send({
            to: Array.isArray(emailData.to) ? emailData.to.map(email => ({ email })) : [{ email: emailData.to }],
            from: { email: "noreply@your-domain.com", name: "CMS Backup Service"},
            subject: emailData.subject,
            html: emailData.html,
            ...(emailData.attachments && { attachments: emailData.attachments})
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
            html: `please review this backup, click this link to continue to rollback: <a href="${link}">${link}</a>`,
            attachments: [{
                filename: `backup_domain_${timestamp}.json.gz`,
                content: await strToZipBase64(content)
            }]
        });
    }
    
}

