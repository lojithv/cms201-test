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
1. Connect the cloudflare project to the github repo.
    1. Go to the dash.cloudflare.com
    2. Go to "Compute" > "Workers & Pages" > "Create application" > under "Workers" click "import a repository"
    3. Connect your github account, and authorize cloudflare to access your github account.

2. Create a github workflow dispatch PAT token for the project.
    1. Go to github.com/settings/tokens
    2. Click "Fine-grained tokens" > "Generate new token"
    4. Select project repository.
    5. Select permissions `actions:write`, `contents:read` and `meta:read`
    6. Select no expiration
    7. Click "Generate token"
    8. Copy the token
=> github PAT

3. Save githubPAT token to the cloudflare project as a runtime environment variable `GITHUB_PAT`. 
    1. Go to dash.cloudflare.com
    2. Go to "Compute" > "Workers & Pages" > select your project > "Settings" > "Environment Variables"
    3. Click "Add variable"
    4. Name: `GITHUB_PAT`
    5. Type: `Secret`
    6. Value: `<your-github-pat-token>`
    7. Click "Save"

**4. copy files (cli script)**
0. make a `README.md` and `wrangler.jsonc` file with the content of this file.
1. commit `README.md` and `wrangler.jsonc` plus `.gitignore`, `public/*`, `src/*`, `data/*` to the github repo.
2. create a branch `data` from main.
4. Wait for 1min.
5. fetch `https://<your-cloudflare-project-name>.workers.dev/startup`. Make sure that it returns the same state as in the snapshot.json inside  make sure that it returns the same value as was in the `data` branch commit.
4. This will setup the database with default data, and then send an email to the gmail account with info. It will then redirect to the admin page.

**5. github actions script**

1. `.github/workflows/worker-events.yml`. Receives input from the worker.
Purpose: store information about the changes of the app, and who made them. Write events_x_y.json files to the `/data/events/*` folder in the main branch.
    1. ensure that it parses as json.

2. `.github/workflows/make-snaps.yml`. Listens for changes in `/data/events/*`.
Purpose: make the app data more compact.
    0. Take the two newest `/data/events/*.json` files. If they are less than 25MB, then merge them into one file, and delete the two old files.
        0. How to merge two files `x1_y1.json` and `x2_y2.json`?
        1. `x1` and `x2` are the start indexes, `y1` and `y2` the end indexes.
        2. read both files, trim them, remove `/^\s*\[/`,`/\]\s*$/`, join their remaining content, wrap them in `[...]`.
        3. save the new file with new filename `x1_y2.json`.
        4. delete `/data/events/x1_y1.json` and `/data/events/x2_y2.json`.
        5. delete `/data/snapWithNull/x1_y1.json` and `/data/snapWithNull/x2_y2.json`.
    1. run through all the files in the `/data/events/` folder.
    2. if no file `/data/snapWithNull/<samename>` exists, then
    3. make an Object.assignAssignWithNull snap of the `/data/events/x_y.json`.
    4. save it as `/data/snapWithNull/x_y.json`.
    5. make a list `pages` of all the `x_y` names in the `/data/snapWithNull/` folder.
    6. Run through all the `x_y.json` and make `snap` as an Object.assignAssign of them. 
    7. save `snap` and `pages` as `/data/snap.json` and `/data/pages.json`.

* in sum: whenever the worker adds a new `/data/events/x_y.json` file, then:
    1. a new file will be added in the `<main>/data/events/` folder. This backs up the new events. This will leave a separate commit trace in the repo.
    2. the `<main>/data/events/` and `/data/snapWithNull/` folders are cleaned.
    3. the  `<main>/data/snap.json` file is updated. 2&3 leaves a separate commit trace.

* principles for worker:
    1. `/data/snap.json` is the most up-to-date version of the snap.
    2. `/data/events/` contains *all* the events split into pages of 25mb.
    3. `/data/snapWithNull/` contains pages of snapshots *matching* the event pages.
    4. new events can be pushed to `.github/workflows/worker-events.yml`.

* examples of worker interaction:
    1. Startup? fetch `/data/snap.json` and set as the primary `/data/snap.json`.
    2. Recreate history? The worker is limited to 50mb of working memory. This means that big history *must* be recreated in the browser. This means that we would like to view history *only* within a specific time period. The history reading app will need to  only view  so we would need to add a `this.paused = true` in the DO, and then we need to check that this is not on for all `write` operations that the worker wants to do against the DO.
    2. worker fetches `/api/some-endpoint` and gets 10 new events.


For the changed file, make a new `/data/snapsWithNull/*` json file with the same name. Empty properties are kept as null. Creates new snapshotWithNull.json file.
    1. merge the last two newest events_x_y.json files if they are less than 25mb in size.
    2. else. we remake snapshotWithNull_x_y.json files for all the events_. We make a snap remake snapshot. if the resulting file is less than 25MB.
3. Github actions then works, and updates the entire content of `/data/*`.
4. iff worker needs it, then it will manually fetch the entire content of `/data/*`.
the worker will do so using the github api to get the names of all the files in the `/data/` folder , and then fetch each file one by one.
((I don't ))

*
1. In

2. the `/public/data/*` folder contains all the data files the project needs.
3. The github actions script is a cleanup script that 

3. Whenever we retrieve more than 25files or 25mb of new events, then we create a new files in chunks of roughly 25mb. and 
3. If there are more than 25MB of new events, then we create a new file `/public/data/events_startIndex_endIndex_startDate_endDate.json`.

1. all longterm events are stored as `/data/events/event_startIndex_endIndex_startDate_endDate.json`. Whenever we try to add a set of events to the last entry in the db, and the new file is bigger than 25MB, then we instead create a new file with just the new events.
2. The start is given by the first instance of the file. The end is given by the last end added. The new file name is created using the start of the first file, and the end of the last file.
3. If the workflow fails, then multiple events*.json files will be left in the public folder. This is not a problem.



This script will read all the files starting with `/public/data/event*.json` in the repo.

2. First, it will find all the files matching `/data/events*.json` and less than 25MB in size.
3. Then it will sort them alphabetically, then trim them, and then remove `/^\s*\[/`,`/\]\s*$/`, join their remaining content, wrap them in `[...]`, and save them.
4. Then we need to run a script that creates a new full.json snapshot using an Object.assignAssign() of all the events in the db, fifo.
5. Then it will commit the new snapshot to the `data-feedback` branch.

