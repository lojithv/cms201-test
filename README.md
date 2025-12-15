# CMS201 - Micro CMS on Cloudflare Workers

A lightweight, serverless Content Management System built on Cloudflare Workers with Durable Objects, featuring Google OAuth authentication, automatic GitHub backups, and real-time data synchronization.

## Architecture

**Serverless Edge Computing Stack:**
- **Frontend**: Static HTML/CSS/JS served via Cloudflare Assets
- **Backend**: Cloudflare Workers (JavaScript runtime at the edge)
- **Database**: Durable Objects with SQLite (persistent, in-memory)
- **Authentication**: Google OAuth 2.0
- **Backup**: Automated GitHub sync via Actions
- **File Storage**: Cloudflare Assets + GitHub repository

## Project Structure

```
cms201/
├── .github/workflows/
│   ├── syncWorkerFiles.yml     # Daily backup automation
│   └── syncWorkerFiles.sh      # Sync script
├── public/
│   ├── index.html              # Main entry point
│   ├── admin/index.html        # Admin interface
│   ├── test/index.html         # Comprehensive testing suite
│   └── data/                   # Static data files
├── src/
│   ├── index.js                # Main worker entry point
│   └── EventSnapsDO.js         # Durable Object implementation
├── wrangler.jsonc              # Cloudflare Worker configuration
└── .dev.vars                   # Local environment variables
```

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account
- GitHub account  
- Google Cloud Console project (for OAuth)

### Local Development
1. **Clone and install:**
   ```bash
   git clone <your-repo>
   cd cms201
   ```

2. **Configure environment variables:**
   Copy `.dev.vars.example` to `.dev.vars` and fill in your values:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your actual credentials
   ```

3. **Start local development server:**
   ```bash
   npx wrangler dev --port 3033
   ```

4. **Access the application:**
   - **Homepage**: http://localhost:3033/
   - **Admin Panel**: http://localhost:3033/admin
   - **Test Suite**: http://localhost:3033/test.html

### Testing GitHub Sync Locally
```bash
CF_DOMAIN="http://127.0.0.1:3033" \
CF_GH_SECRET="your_github_pat_token" \
COMMIT="false" \
bash .github/workflows/syncWorkerFiles.sh
```

## API Endpoints

### Public Endpoints
- `GET /` - Homepage
- `GET /api/snap` - Current state snapshot
- `GET /api/snap/notNull` - Filtered state snapshot
- `GET /api/uploaded-images` - List uploaded images

### Authentication Endpoints  
- `GET /auth/login` - Initiate Google OAuth
- `GET /auth/callback` - OAuth callback handler
- `GET /auth/logout` - Logout user
- `GET /auth/checkLogin` - Check authentication status

### Authenticated Endpoints (Require Login)
- `GET /admin` - Admin interface
- `GET /api/events` - List all events
- `POST /api/addEvent` - Create new event
- `POST /api/addFile` - Upload file
- `GET /api/uploadImageURL` - Get image upload URL
- `GET /api/backup` - Trigger GitHub backup

### GitHub Sync Endpoints (Require PAT Token)
- `GET /api/github/syncStart` - Start sync process
- `POST /api/github/syncEnd` - Complete sync process  
- `GET /api/github/readFile/{path}` - Read file from storage

### Data Access Endpoints
- `GET /data/{filename}` - Access stored files
- `GET /api/readFile/{filename}` - Read specific file

## Overview 

Below is a receipe for how to replicate this project from scratch. It involves a mix of manual steps and scripts. The goal is to have a fully working Cloudflare Worker project that uses Google OAuth for authentication, GitHub for version control, and Cloudflare Pages for deployment. The project also includes a system for tracking changes and creating snapshots of data.

## .dev.vars

<!-- Oussama: Added <username> to GITHUB_WORKFLOW url -->
<!-- Oussama: Added ${username} to <cloudfare link> -->

```
ORIGIN="http://127.0.0.1:3033"
OAUTH_USERS="orstavik77@gmail.com"
GOOGLE_ID="12345.apps.googleusercontent.com"
GOOGLE_SECRET="GOCSPX-12345"
GOOGLE_REDIRECT="http://127.0.0.1:3033/auth/callback"
# GOOGLE_REDIRECT="<cloudflare link>/auth/callback"

CF_DOMAIN="<projectname>.<username>.workers.dev"
IMAGE_SERVER_ACCOUNT_ID="12345"
IMAGE_SERVER_API_TOKEN="12345"

GITHUB_REPO="orstavik/cms201"
GITHUB_WORKFLOW="https://api.github.com/repos/<username>/<reponame>/actions/workflows/syncWorkerFiles/dispatches" 

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
        - `https://${projectname}.${username}.workers.dev/auth/callback`
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
        * Name: `CF_DOMAIN`, => value: `${projectname}.${username}.workers.dev`
    3. Name: `production`
    4. Click "Configure environment"
    5. Click "Add variable"
        * Name: `CF_DOMAIN`, => value: `${projectname}.${username}.workers.dev`
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
        * Name: `CF_DOMAIN`, `Text`, => value: `${projectname}.${username}.workers.dev`
        * Name: `REPO`, `Text`, => value: `${githubusername}/${projectname}`
    4. Click "Save"

* question: can we use the gmail with cloudflare for sending emails? can we somehow authorize cloudflare to use the gmail account as the sender when we use it's most recent .send() email feature? 

## create a fork of the cms201 repo

0. update the .dev.vars file with the values from above.
1. change the project name in `wrangler.jsonc` and `README.md` to `${projectname}`.
2. commit the repo to github as a new repo with the name ${projectname}.
2. Wait for 1min??
<!-- Update "snapshot.json" to "snap.json" -->
3. fetch `https://${projectname}.${username}.workers.dev/startup`. Make sure that it returns the same state as in the snap.json inside make sure that it returns the same value as was in the `data` branch commit.

## Data structure

**on Github**
1. `/public/data/events/x-y.json` files. All the events between timestamps_key x and y. Format `[{id, timestamp, email, json}, ...]`.
2. `/public/data/snap.json`. The last up-to-date version of the `{snap, lastEventId, pages}`. Snap is created using `Object.assignAssign` logic.
3. `/public/data/files.json`. A list of all the files in the static ASSETS resources.

**in Worker (durable object)**
1. `events`. A list of all the events added to the repo. Format `[{id, timestamp, email, json}, ...]`. (in sqlite the json is stringified).
2. `#currentState`. The last up-to-date version of the `{snap, lastEventId, pages}`.
3. `files`. files stored in the sqlite that is not yet pushed to github/ASSETS.

## Testing Suite

### Comprehensive Test Interface (`/test.html`)
The project includes a comprehensive testing suite that validates all endpoints and functionality:

**Features:**
- **Visual iframe navigation** - See actual pages loading during tests
- **Real authentication support** - Input actual session tokens from Google OAuth
- **Simulation mode** - Test without real authentication
- **Admin form interaction** - Actually fills out and submits admin forms
- **Complete API coverage** - Tests all public, authenticated, and GitHub sync endpoints
- **Live commentary** - Real-time logging of all test operations

**Authentication Options:**
1. **Real Session Token**: After logging in via `/auth/login`, copy your session token and paste it into the test interface for real authentication testing
2. **Simulation Mode**: Use simulated authentication for testing without real login

### Manual Testing Workflow
1. Start local development: `npx wrangler dev --port 3033`
2. Open test suite: http://localhost:3033/test.html
3. Choose authentication method (real token or simulation)
4. Run comprehensive tests or individual endpoint tests
5. Monitor visual iframe and logs for results

## Data Synchronization

### How to timetravel using Github data?

The worker's memory limit is ~30mb. Hence, history and timetravel is done page by page in the browser.
1. Browser fetches `/data/files.json` from Worker.
2. The browser finds all the `/data/events/` files. 
3. The worker can then list all the events in this gz file.
