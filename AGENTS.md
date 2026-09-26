# Job Browser agent instructions

## Licensing and ownership boundary

- Job Browser is proprietary software. The copyright owner is the person named
  in `package.json#author`; do not remove or replace that attribution without
  the user's explicit instruction.
- Keep `package.json#license` set to `UNLICENSED`. Do not substitute MIT,
  Apache, GPL, or another open-source license without the user's explicit
  authorization.
- `LICENSE.txt`, `EULA.txt`, and `THIRD_PARTY_NOTICES.md` are mandatory release
  files. Do not delete, rename, omit, or weaken them as incidental cleanup.
- `THIRD_PARTY_NOTICES.md` is generated. After any dependency or lockfile
  change, run `npm run legal:notices`; before committing or packaging, run
  `npm run legal:check`.
- Preserve the privacy boundary: the owner's public name may appear only in the
  approved legal-attribution files enforced by
  `tests/privacy-distribution.test.ts`. Do not add a personal address, phone
  number, or private email address to distributed files.

## Mandatory desktop release gate

A desktop release is incomplete until all of the following are true:

1. `electron-builder.yml` still packages `LICENSE.txt`, `EULA.txt`, and
   `THIRD_PARTY_NOTICES.md`, and its NSIS configuration still sets
   `license: EULA.txt`.
2. `npm run legal:notices` and `npm run legal:check` pass before the installer
   is built.
3. A new NSIS installer is built from the current commit. Never claim an older
   installer represents newer licensing or source changes.
4. The packaged `app.asar` is inspected and confirmed to contain all three
   legal files plus `package.json` with the expected author and `UNLICENSED`
   metadata.
5. The assisted NSIS installer is confirmed to present the Job Browser EULA
   for acceptance. Do not switch the installer to one-click mode if that would
   remove the agreement screen.
6. The normal packaged and installed smoke tests, `npm run privacy:check`, and
   the repository's release checks pass. The installed `app.asar` must match
   the packaged `app.asar`.
7. Release documentation records the EULA check, legal-file presence, notice
   generation result, installer hash, and validation results.

Do not describe a release as licensed, packaged, or ready for distribution if
any item in this gate is missing. Do not push or publish a release without the
user's explicit approval.

## Product name

`Job Browser` remains the working product name. Do not rename it or claim that
it is federally trademarked without the user's explicit decision and a proper
trademark-clearance review. A later product rename does not remove these
licensing requirements.
