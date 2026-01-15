export async function commit(PAT, rootUrl, path, lastSha, merge, logJson) {
    const url = `${rootUrl}/${path}`;
    const headers = {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'User-Agent': 'project201-worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Accept': 'application/vnd.github+json'
    };

    let currentSha = lastSha;
    let oldContent = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        // If we need to merge or we don't have the SHA, fetch current state from GitHub
        if (merge || !currentSha) {
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                currentSha = data.sha;
                if (merge) {
                    // Decoded content from GitHub (base64)
                    try {
                        oldContent = data.content ? atob(data.content.replace(/\s/g, '')) : null;
                    } catch (e) {
                        console.error("Failed to decode old content", e);
                        oldContent = null;
                    }
                }
            } else if (res.status !== 404) {
                throw new Error(`Failed to fetch ${path} for commit (status ${res.status}): ${await res.text()}`);
            }
        }

        let finalContent = logJson;
        if (merge && typeof merge === 'function') {
            finalContent = merge(finalContent, oldContent);
        }

        // Ensure content is a string
        const contentString = typeof finalContent === 'string' ? finalContent : JSON.stringify(finalContent);

        // Convert to Base64 (handling UTF-8)
        const contentBase64 = btoa(unescape(encodeURIComponent(contentString)));

        const body = {
            message: `Sync ${path}: ${new Date().toISOString()}`,
            content: contentBase64,
        };

        if (currentSha) {
            body.sha = currentSha;
        }

        const putRes = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        if (putRes.ok) {
            return await pullLatestChanges(PAT, rootUrl, path);
        }

        if (putRes.status === 409 && merge) {
            // Conflict! Increment attempts and retry (fetching new SHA/content)
            attempts++;
            currentSha = null;
            console.log(`Conflict detected for ${path}, retrying (${attempts}/${maxAttempts})...`);
            continue;
        }

        const errorText = await putRes.text();
        throw new Error(`Failed to commit ${path} (status ${putRes.status}): ${errorText}`);
    }

    throw new Error(`Failed to commit ${path} after ${maxAttempts} attempts due to conflicts.`);
}

export async function pullLatestChanges(PAT, rootUrl, path) {
    const url = `${rootUrl}/${path}`;
    const headers = {
        'Authorization': `Bearer ${PAT}`,
        'User-Agent': 'project201-worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Accept': 'application/vnd.github+json'
    };
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Failed to pull latest changes for ${path}: ${res.status}`);
    return await res.json();
}
