# Working on this repo

The owner is not a developer and mostly uses the page on a phone. `README.md` is their instruction sheet: keep it accurate and in plain words whenever behaviour changes.

- `index.html` is the whole product: settings (`CONFIG`) in the first `<script>`, page code in the second. No build step, no libraries.
- Publishing is automatic. Every push to `main` (except `.md`-only changes) runs `.github/workflows/publish.yml`: check, reserve the next `vMAJOR.MINOR` tag, deploy to GitHub Pages, create the release. So:
  - Work on a branch and open a pull request; that runs the check without publishing.
  - Do not push to `main`, merge, or start the workflow by hand until the owner says so.
  - Never create `v*` tags or releases by hand, and never edit, move or duplicate the line `const VERSION = 'dev';`.
- The check is `node checks/check.mjs` (Node 22; the pull request's run is the place to see it if Node is not installed locally). When a rule changes, update `runSelfTest()` in `index.html`; its frozen test settings stay separate from `CONFIG` on purpose. When a setting is added to `CONFIG`, add it to `checkSettings()`.
- "Restore" (Run workflow with a version number) puts back `index.html` together with `checks/check.mjs` as they were in that version, and nothing else. A page is always checked by the check that was published with it, so after a restore, re-apply any newer improvements to the check on purpose. Keep the way the workflow calls the check (`node checks/check.mjs`, optional `RESTORING` variable) stable.
- Preview locally with `python3 -m http.server`, then open `/index.html` and `/index.html?test`. Check layouts at 375px and 320px wide.
- After a change is published, refresh the plain copy in the owner's Google Drive (`My Drive/tennis-weather`) if that folder is reachable from the session.
