# cms201

 > `npx wrangler dev --port 3033`

Below is a receipe for how to replicate this project from scratch. It involves a mix of manual steps and scripts. The goal is to have a fully working Cloudflare Worker project that uses Google OAuth for authentication, GitHub for version control, and Cloudflare Pages for deployment. The project also includes a system for tracking changes and creating snapshots of data.


## 1. Manual steps
1. Create a **gmail account**, **github account**, **cloudflare account** for the project.
=> gmail and password
=> github username (and password?)
=> cloudflare username (and password?)
=> `${projectname}` Project name must match `/[a-z][a-z0-9]+/` regex.
2. Create a github repo named `${projectname}`.
3. Create a cloudflare project named `${projectname}`.
4. Create a console.cloud.google.com project named `${projectname}`.
5. Set up an oauth service. 
    1. select the project, go to "APIs & Services" > "OAuth consent screen". 
    2. Select "External", name: `"${projectname}$ oauth client"`, user support: `gmail`, developer contact: `gmail`, and save. 
    3. Then go to "Credentials" > "Create Credentials" > "OAuth Client ID". 
    4. Select "Web application", give it a name: `"${projectname} oauth client"`, and add the following authorized redirect URIs:
        - `https://<projectname>.workers.dev/auth/callback`
        - `http://localhost:3033/api/auth/callback`
        - `http://127.0.0.1:3033/api/auth/callback`
=> google auth client id 
=> google auth secret
6. Connect the cloudflare project to the github repo.
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
8. Update Cloudflare enviroment variables:
    1. Go to dash.cloudflare.com
    2. Go to "Compute" > "Workers & Pages" > select your project > "Settings" > "Environment Variables"
    3. Click "Add variable"
        * Name: `GITHUB_PAT`, `Secret`, => value: `github PAT`
        * Name: `OAUTH_CLIENT_ID`, `Secret`, => value: `google auth client id`
        * Name: `OAUTH_CLIENT_SECRET`, `Secret`, => value: `google auth secret`
        * Name: `EMAIL`, `Text`, => value: `gmail`
        * Name: `PROJECT_NAME`, `Text`, => value: `${projectname}`
        * Name: `DOMAIN`, `Text`, => value: `<projectname>.workers.dev`
        * Name: `REPO`, `Text`, => value: `${githubusername}/${projectname}`
    4. Click "Save"

* question: can we use the gmail with cloudflare for sending emails? can we somehow authorize cloudflare to use the gmail account as the sender when we use it's most recent .send() email feature? 

## Copy files (cli script)

0. make a `README.md` and `wrangler.jsonc` file with the content of this file.
1. commit `README.md` and `wrangler.jsonc` plus `.gitignore`, `public/*`, `src/*`, `data/*` to the github repo.
2. Wait for 1min. 10sec?
3. fetch `https://<projectname>.workers.dev/startup`. Make sure that it returns the same state as in the snapshot.json inside make sure that it returns the same value as was in the `data` branch commit.

* Have the following files in the repo:
    * `.github/workflows/`
        * `worker-events.yml`
    * `wrangler.jsonc`
    * `.gitignore`
    * `README.md`
    * `public/*` (static files)
    * `src/*` (worker code)
    * `data/*` (data files)
        * `snap.json` (current state snapshot)
        * `pages.json` (list of event pages)
        * `events/` (folder with event files)
        * `snapWithNull/` (folder with snapshots matching event pages)

## Github actions script

1. `.github/workflows/worker-events.yml`. Receives input from the worker.

Purpose: store information about the changes of the app, and who made them. Write events_x_y.json files to the `/data/events/*` folder in the main branch.
Purpose2: make the app data more compact and with better overview.
    1. ensure that it parses as json. Ensure that it is just an array of objects with id, timestamp, email and json properties? yes?
    2. add other security meassures such as checking the name of the file matching a speficic format = `/^\/data\/events\/[0-9]+_[0-9]+_[0-9]+:[0-9]+\.json$/` (x_xk_y_yk.json). The format is `x_xk_y_yk.json` where `x` is the start timestamp, `xk` is the start id, `y` is the end timestamp, and `yk` is the end id.
    3. Take the newest `/data/events/*.json` file. If this file plus the incoming file is less than 25mb, then merge them into one file, under a new name, and delete the old file. Otherwise, just add the new file as is.
        0. How to merge two files `x1_y1.json` and `x2_y2.json`?
        1. `x1` and `x2` are the start indexes (both on x_xk format), `y1` and `y2` the end indexes (same format).
        2. read both files, trim them, remove `/^\s*\[/`,`/\]\s*$/`, join their remaining content, wrap them in `[...]`.
        3. save the new file with new filename `x1_y2.json`.
        4. delete `/data/events/x1_y1.json`.
        5. delete `/data/snapWithNull/x1_y1.json`.
    4. run through all the files in the `/data/events/` folder.
    5. if no file `/data/snapWithNull/<samename>` exists, then
    6. make an Object.assignAssign snap of the `/data/events/x_y.json`.
    7. save it as `/data/snapWithNull/x_y.json`.
    8. make a list `pages` of all the `x_y` names in the `/data/snapWithNull/` folder.
    9. Run through all the `x_y.json` and make `snap` as an Object.assignAssign of them. 
    10. save `snap` and `pages` as `/data/snap.json` and `/data/pages.json`.

```js
//todo check this one.
function Object.assignAssign(...objs) {
  objs = objs.map(o => o.json);
  const res = {};
  for (let obj of objs){
    for (let key in obj)
      Object.assign(res[key] ??= {}, obj[key]);
  }
  return res;
}
```

* in sum: whenever the worker adds a new `/data/events/x_y.json` file, then:
    1. a new file will be added in the `<main>/data/events/` folder. This backs up the new events.
    2. the `<main>/data/events/` and `/data/snapWithNull/` folders are cleaned.
    3. the  `<main>/data/snap.json` and `<main>/data/pages.json` file is updated. 
    This will leave a separate commit trace in the repo.

* principles for worker:
    1. `/data/snap.json` is the most up-to-date version of the snap.
    2. `/data/events/` contains *all* the events split into pages of 25mb.
    3. `/data/snapWithNull/` contains pages of snapshots *matching* the event pages.
    4. new events can be pushed to `.github/workflows/worker-events.yml`.

* examples of worker interaction:
    1. Startup? fetch `/data/snap.json` and set its content as `snap` the first entry in the DO. User is system. id and timestamp is default. Then DO's `this.active = true`.
    2. Recreate history? The worker is limited to 50mb of working memory. So history must be viewed in pages in the browser.
        1. Load list of pages from `/data/pages.json`.
        2. The x and y are timestamps. Find the `x_y` for that time.
        3. Load all *older* `/data/snapWithNull/x_y.json` files than x_y.
        4. merge them using Object.assignAssignWithNull into a `snap` json object.
        5. Then load all the `/data/events/x_y.json` and add them as events.
        6. You are ready to timetravel.
        7. Likely use case is *cherrypick* whole posts or single properties that you would like to "restore". Set them up as a new event, and push them to the worker `/api/add`. 

## worker chron jobs

1. `/admin/backup`
* can be triggered by an admin clicking a link.
* is triggered by a cron job every day at 02:00.

Purpose: make sure that the worker data is backed up.
    1. if there is only one event, that means that no changes have been made, just return.
    2. else, keep `varSnap` = snapshot of the state; and `varKey` = the event id with the last event added with a timestamp that is not now. Make sure that new Date().getTime() != last.timestamp.
    3. Try to push the events between 2 and last event to github. This can take a looong time.
    4. If this returns ok, then the body of the response should be the new `/data/snap.json` file.
    5. If this `/data/snap.json` is exactly the same as the snap saved in memory, things is ok, then we change the first snap by system user and delete the snaps from the sqllite database that has the key lower than `varKey`.
    6. make sure that the worker `ctx.waitUntil()` the fetch promise.

* if at any time the workflow fails, then just return. This will make the worker just try to upgrade events and its snap state the next day.
* send an ***ERROR*** email to the gmail account.

## todo

1. We have a key problem. We must use timestamp.id as the key number I think.
2. worker functions for `/admin/backup` => make a json events file and send it as a workflow dispatch to github.
3. worker function for `/api/data/xyz` => then read and reload the corresponding `/data/xyz` from github. Cache forever.
4. make the .yml file for cron job on github. Here, we need to add some security meassures, the llm is good at adding this.
5. set up history.html view. Just get the pages from `/data/pages.json`, and then load the snaps and events as needed.
6. and then we need to make `/admin/startup`?
7. cli script for automatic copying.