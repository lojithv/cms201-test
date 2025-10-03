# cms201

`npx wrangler dev --port 3033` to run locally!

## how to stamp the project?

**1. accounts google oauth client (manual)**
1. Create a gmail account, github account, cloudflare account for the project. This must be done manually.
=> gmail and password
=> github username (and password?)
=> cloudflare username (and password?)

2. Create a console.cloud.google.com project with the name of the project.

3. Set up an oauth service. select the project, go to "APIs & Services" > "OAuth consent screen". Select "External", fill in the app name, user support email, developer contact email, and save. Then go to "Credentials" > "Create Credentials" > "OAuth Client ID". Select "Web application", give it a name, and add the following authorized redirect URIs:
   - `https://<your-cloudflare-project-name>.workers.dev/auth/callback`
   - `http://localhost:3033/api/auth/callback`
   - `http://127.0.0.1:3033/api/auth/callback`
   Replace `<your-cloudflare-project-name>` with the actual name of your Cloudflare project.


**2. github (manual)**
1. Create a github repo with the name of the project.

**3. cloudflare (manual)**
1. Create a cloudflare project with the name of the project.

**4. cloudflare + github (manual)**
1. Create a github pat token for the project, with
`content:write` and `meta:read` permissions.
=> github PAT

2. Connect the cloudflare project to the github repo.

3. Add the github pat token to the cloudflare project secrets as `GITHUB_PAT`.


**4. copy files (cli script)**
0. make a `README.md` and `wrangler.jsonc` file with the content of this file.
1. commit `README.md` and `wrangler.jsonc` plus `.gitignore`, `public/*`, `src/*`, `data/*` to the github repo.
2. Wait for 1min, and check `https://<your-cloudflare-project-name>.workers.dev/`
3. Run `https://<your-cloudflare-project-name>.workers.dev/startup`.
4. This will setup the database with default data, and then send an email to the gmail account with info. It will then redirect to the admin page.