# Tennis weather

Shows when outdoor tennis is playable this week at Talavera and Lower Hutt tennis clubs.

**Live page:** https://justwang031.github.io/tennis-weather/

## Change a setting

1. Open [`index.html`](index.html) and tap the pencil (**Edit this file**).
2. Change the settings near the top, between `const CONFIG = {` and `};`.
   Times are 24-hour with four digits and quotes, like `'17:30'`.
3. Tap **Commit changes**, write a few words about what you changed, keep
   **Commit directly to the main branch** selected, and confirm.

## What happens next

GitHub checks the page automatically. It takes about a minute, and you can watch it under the **Actions** tab.

- **Green tick:** the change is published as the next version. The version number and date at the very bottom of the live page change. Your phone can take up to 10 minutes to show it; reload the page.
- **Red cross:** nothing was published and the live page is exactly as it was. Open the failed run: its summary names the line to fix. Fix it the same way as above, or put an earlier version back.

Changing only this README does not publish a new version.

## Put an earlier version back

1. Go to the **Actions** tab and choose **Check and publish** in the list.
2. Tap **Run workflow**, leave the branch on `main`, type the version (for example `v1.0`), and tap **Run workflow**.

That version of `index.html` is checked and published as the next version number. Nothing is erased.

## See every version

[Releases](https://github.com/justwang031/tennis-weather/releases) lists every version with what changed, newest first.

## Ask Claude to make a change

Start a Claude Code session and say something like: "In my GitHub repo `justwang031/tennis-weather`, …" followed by what you want changed. Claude follows the notes in [`CLAUDE.md`](CLAUDE.md): it works on a separate branch, the same check runs, and nothing is published until you say so.

## What is in this repo

| File | What it is |
|---|---|
| `index.html` | The whole page. Settings are at the top. |
| `checks/check.mjs` | The automatic check: typing mistakes, sensible settings, the rule tests, and a test drawing of the page. |
| `.github/workflows/publish.yml` | Runs the check, numbers the version, publishes it, and handles putting a version back. |

Adding `?test` to the end of the live page's address runs the rule tests in your browser.

Weather data by [Open-Meteo.com](https://open-meteo.com/).
