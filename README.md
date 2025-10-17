# cms201

## project files

* `.github/workflows/`
    * `workerEvents.yml`
* `wrangler.jsonc`
* `.gitignore`
* `README.md`
* `public/*` (static files)
* `scripts/*` (serverside scripts)
* `src/*` (worker code)
* `data/*` (data files)
    * `snap.json` (current state snapshot)
    * `pages.json` (list of event pages)
    * `events/` (folder with event files)
    * `snaps/` (folder with snapshots matching event pages)

## HowTo: run locally

To run the worker locally, use the commands:
1. `npx wrangler dev --port 3033` (in the FIRST terminal console in project root folder)

2. To test the GitHub sync script against your local worker:
```bash
CF_DOMAIN="http://127.0.0.1:3033" CF_GH_SECRET="hello sunshine" COMMIT="false" \
bash .github/workflows/syncWorkerFiles.sh
```

## overview 

Below is a receipe for how to replicate this project from scratch. It involves a mix of manual steps and scripts. The goal is to have a fully working Cloudflare Worker project that uses Google OAuth for authentication, GitHub for version control, and Cloudflare Pages for deployment. The project also includes a system for tracking changes and creating snapshots of data.

## .dev.vars

```
ORIGIN="http://127.0.0.1:3033"
OAUTH_USERS="orstavik77@gmail.com"
GOOGLE_ID="12345.apps.googleusercontent.com"
GOOGLE_SECRET="GOCSPX-12345"
GOOGLE_REDIRECT="http://127.0.0.1:3033/auth/callback"
# GOOGLE_REDIRECT="<cloudflare link>/auth/callback"

CF_DOMAIN="<projectname>.workers.dev"
IMAGE_SERVER_ACCOUNT_ID="12345"
IMAGE_SERVER_API_TOKEN="12345"

GITHUB_REPO="orstavik/cms201"
GITHUB_WORKFLOW="https://api.github.com/repos/<reponame>/actions/workflows/syncWorkerFiles/dispatches"

CF_GH_SECRET="github_pat_12345"
GITHUB_TTL="300" 
# GITHUB_TTL="5"00" # in prod 5 minutes, the allowed delay time for the cloudflare secret given github.
```

## 1. Manual steps
1. Create a **gmail account**, **github account**, **cloudflare account** for the project.
=> gmail and password
=> github username (and password?)
=> cloudflare username (and password?)
=> `${projectname}` Project name must match `/[a-z][a-z0-9]+/` regex.
<!-- 
input from user: 
    ${projectname}
    ${gmail}
    ${githubusername}
    ${cloudflareusername}
check for conflicts, and then create accounts when needed.
 -->
2. Create a github repo named `${projectname}`.
3. Create a cloudflare project named `${projectname}`.
4. Create a console.cloud.google.com project named `${projectname}`.
5. Set up an oauth service. 
    1. select the project, go to "APIs & Services" > "OAuth consent screen". 
    2. Select "External", name: `"${projectname}$ oauth client"`, user support: `${gmail}`, developer contact: `${gmail}`, and save. 
    3. Then go to "Credentials" > "Create Credentials" > "OAuth Client ID". 
    4. Select "Web application", give it a name: `"${projectname} oauth client"`, and add the following authorized redirect URIs:
        - `https://${projectname}$.workers.dev/auth/callback`
        - `http://localhost:3033/api/auth/callback`
        - `http://127.0.0.1:3033/api/auth/callback`
=> google auth client id 
=> google auth secret

<!-- 
at this point, should we make the .dev.vars file?? In one place.
 -->

6. Create and connect the cloudflare project to the github repo.
    1. Go to the dash.cloudflare.com
    2. Go to "Compute" > "Workers & Pages" > "Create application" > under "Workers" click "import a repository"
    3. Connect your github account, and authorize cloudflare to access your github account.

7. Create a github workflow dispatch PAT token.
    1. Go to github.com/settings/tokens
    2. Click "Fine-grained tokens" > "Generate new token"
    3. Name: `${projectname}-worker-events`
    4. Select project repository ${projectname}$. (!!att!!)
    5. permissions: `actions:write`, `contents:read` and `meta:read`
    6. Expiration: `No expiration`
    7. Click "Generate token"
    8. Copy the token
=> github PAT
8. Update github environment variable DOMAIN.
    1. Go to https://github.com/${GITHUB_REPO}$/settings/secrets/actions
    2. Click "New repository secret"
        * Name: `DOMAIN`, => value: `${projectname}.workers.dev`
    3. Name: `production`
    4. Click "Configure environment"
    5. Click "Add variable"
        * Name: `DOMAIN`, => value: `${projectname}.workers.dev`
    6. Click "Save variables"
8. Update Cloudflare enviroment variables:
    1. Go to dash.cloudflare.com
    2. Go to "Compute" > "Workers & Pages" > select your project > "Settings" > "Environment Variables"
    3. Click "Add variable"
        * Name: `CF_GH_SECRET`, `Secret`, => value: `github PAT`
        * Name: `OAUTH_CLIENT_ID`, `Secret`, => value: `google auth client id`
        * Name: `OAUTH_CLIENT_SECRET`, `Secret`, => value: `google auth secret`
        * Name: `EMAIL`, `Text`, => value: `gmail`
        * Name: `PROJECT_NAME`, `Text`, => value: `${projectname}`
        * Name: `DOMAIN`, `Text`, => value: `${projectname}.workers.dev`
        * Name: `REPO`, `Text`, => value: `${githubusername}/${projectname}`
    4. Click "Save"

* question: can we use the gmail with cloudflare for sending emails? can we somehow authorize cloudflare to use the gmail account as the sender when we use it's most recent .send() email feature? 

## create a fork of the cms201 repo

0. update the .dev.vars file with the values from above.
1. change the project name in `wrangler.jsonc` and `README.md` to `${projectname}`.
2. commit the repo to github as a new repo with the name ${projectname}.
2. Wait for 1min??
3. fetch `https://${projectname}.workers.dev/startup`. Make sure that it returns the same state as in the snapshot.json inside make sure that it returns the same value as was in the `data` branch commit.

## Data structure

**on Github**
1. `/public/data/events/x-y.json` files. All the events between timestamps_key x and y. Format `[{id, timestamp, email, json}, ...]`.
2. `/public/data/snap.json`. The last up-to-date version of the `{snap, lastEventId, pages}`. Snap is created using `Object.assignAssign` logic.
3. `/public/data/files.json`. A list of all the files in the static ASSETS resources.

**in Worker (durable object)**
1. `events`. A list of all the events added to the repo. Format `[{id, timestamp, email, json}, ...]`. (in sqlite the json is stringified).
2. `#currentState`. The last up-to-date version of the `{snap, lastEventId, pages}`.
3. `files`. files stored in the sqlite that is not yet pushed to github/ASSETS.

## How to timetravel using Github data?

The worker's memory limit is ~30mb. Hence, history and timetravel is done page by page in the browser.
1. Browser fetches `/data/files.json` from Worker.
2. The browser finds all the `/data/events/` files. 
3. The worker can then list all the events in this gz file.