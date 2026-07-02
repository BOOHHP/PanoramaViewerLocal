# Tauri Windows Installer and Updater

This project is moving to the Tauri v2 installer and updater path for Windows distribution.

## Current updater model

- Installer type: NSIS setup.exe.
- Update endpoint: `https://github.com/BOOHHP/PanoramaViewerLocal/releases/latest/download/latest.json`.
- The repository must keep public Releases so installed clients can read `latest.json` and download update bundles without embedding a GitHub token.
- Tauri updater signatures are required and cannot be disabled.
- The public updater key is stored in `src-tauri/tauri.conf.json`.
- The private signing key is stored locally under `.secrets/tauri-updater.key` and is ignored by Git.
- The same private key is stored in the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`.

## Local signing key

The generated private key has no password. Keep it secret and back it up. If it is lost, existing installations cannot be updated with future signed packages.

To set or refresh the GitHub Actions secret without printing the private key:

```powershell
Get-Content -Raw ".secrets\tauri-updater.key" | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo BOOHHP/PanoramaViewerLocal
```

## Local Windows installer build

Prerequisites:

- Rust toolchain with `cargo` and `rustup` installed.
- Visual Studio Build Tools for the MSVC Windows target.
- Node dependencies installed with `npm ci` or `npm install`.

Build locally from the project root:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "D:\Claude\project\panorama-viewer-local\.secrets\tauri-updater.key"
npm run desktop:build
```

Expected output after a successful Windows build:

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
src-tauri/target/release/bundle/nsis/*-setup.exe.sig
```

The installer uses the Tauri app identifier in `src-tauri/tauri.conf.json`. Future installers with the same identifier and a higher version overwrite the old installation.

## GitHub release flow

The workflow `.github/workflows/tauri-release.yml` builds on `windows-latest` and uses `tauri-apps/tauri-action@v1`.

Release steps:

1. Bump all app versions consistently:
   - `package.json` `version`
   - `src-tauri/tauri.conf.json` `version`
   - `src-tauri/Cargo.toml` `version`
2. Commit the version bump.
3. Push a tag that matches the version:

```powershell
git tag v0.2.0
git push origin main --tags
```

4. GitHub Actions creates the Release, uploads the NSIS installer, uploads updater signatures, and uploads `latest.json`.
5. Installed clients check the configured `latest.json` on startup.

## Runtime update behavior

On startup, the app only checks for updates inside the Tauri runtime. Browser/Vite preview mode does not check.

When a newer version is found:

1. The app shows a confirmation dialog with the remote version and release notes.
2. If the user confirms, the updater downloads and installs the signed update.
3. On Windows, Tauri exits the app during installation because of Windows installer limitations.

## Important constraints

- Do not commit `.secrets/`.
- Do not embed GitHub tokens in the client app.
- Do not rotate the updater signing key after users have installed a signed version unless you intentionally implement key rotation.
- Draft GitHub Releases do not work for public updater checks; the Release must be published.
