# Deploying Rice Statistics for Africa to GitHub Pages

The site is entirely static. `index.html` is a single self-contained bundle
(HTML, CSS and all thirteen JavaScript modules inlined) that fetches the
compiled data files from `data/rsa-*.json` over relative paths. There is no
build step in CI, no server-side code, and no external dependency at runtime:
GitHub Pages serves the repository exactly as it stands.

What gets published: `index.html`, `tests.html`, `data/rsa-*.json` (~623 KB),
`src/`, `tools/`, `README.md`. What does not: `data/raw/` and `data/versions/`,
which together are about 180 MB of reproducible downloads and rollback
archives — see [.gitignore](.gitignore).

## What has already been done locally

- The repository is initialised, `.gitignore` is in place, and the whole project
  is committed on the `main` branch.
- [.github/workflows/pages.yml](.github/workflows/pages.yml) is ready and will
  deploy on every push to `main`.

## What you need to do

These steps need your GitHub account, so they cannot be done for you.

### 1. Create the repository on GitHub

Go to <https://github.com/new> and create a repository named
`rice-statistics-for-africa`. Leave it empty — no README, no `.gitignore`, no
licence — so the first push is not rejected as a non-fast-forward.

### 2. Push

Run this from the project folder, replacing `YOUR-USERNAME`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/rice-statistics-for-africa.git && git push -u origin main
```

If Git asks for a password, GitHub no longer accepts account passwords over
HTTPS. Create a personal access token at
<https://github.com/settings/tokens> with the `repo` scope and paste that
instead, or install [GitHub CLI](https://cli.github.com/) and run `gh auth login`
first.

### 3. Turn Pages on

In the new repository: **Settings → Pages → Build and deployment → Source**, and
choose **GitHub Actions**. The workflow runs on the next push; you can also
trigger it immediately from the **Actions** tab via *Deploy to GitHub Pages →
Run workflow*.

### 4. Your link

Once the workflow goes green (about a minute), the site is live at:

```
https://YOUR-USERNAME.github.io/rice-statistics-for-africa/
```

The test suite is published alongside it at
`https://YOUR-USERNAME.github.io/rice-statistics-for-africa/tests.html`, so the
447 checks can be re-run in any browser against the deployed build.

## Publishing updated data later

`tools/auto-update.ps1` refreshes the compiled data when FAOSTAT or USDA PSD
publish new figures. After it runs, publish the result with:

```bash
git add data/rsa-*.json index.html && git commit -m "Refresh FAOSTAT and USDA data" && git push
```

The Pages workflow redeploys automatically. Note that the scheduled updater runs
on your machine, not on GitHub — Pages serves whatever data was last pushed.

## A note on `data/raw/`

If you ever clone the repository somewhere fresh, `data/raw/` will be missing.
Nothing at runtime needs it; it is only the input to the pipeline. To rebuild it:

```bash
pwsh -File tools/build-data.ps1
```
