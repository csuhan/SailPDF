# Releasing Sail PDF

The supported package target is macOS Apple Silicon. Build on a matching Mac with Node.js 24 and Xcode Command Line Tools.

1. Update `package.json`, the lockfile, `CHANGELOG.md` and website version text together.
2. Run `npm ci`, `npm test`, `npm run build`, `npm run test:fixtures`, `npm run test:e2e`, `npm run test:native` and `npm run format:check`.
3. Run `npm run app:prepare`. This verifies the pinned official llama.cpp archive, compiles the OCR helper and generates icons.
4. Package with `npx electron-builder --mac dir dmg zip --arm64`. The output is under `release/`.
5. Open the actual packaged app with an isolated `PDFPRO_USER_DATA` directory. Verify document opening, language selection, branding, changes and saving using test files.
6. Run `node scripts/check-publication.mjs` against the staged/tracked files. Check that test PDFs, system fonts, profiles, binaries and credentials are not in the source commit.
7. Push the verified source commit and matching `v<version>` tag. Upload the DMG, ZIP and SHA-256 checksums to a GitHub prerelease. Never replace an existing release silently.

The manual Release workflow performs packaging for an existing tag that matches the package version and selected commit. Ordinary pushes run CI; they do not create releases.

## Signing

Current beta packages are unsigned and not notarized. Label them clearly as prereleases. Do not describe them as notarized or production-ready. Adding Apple signing/notarization requires the maintainer's own certificates and account; never commit those credentials.

## Files included in the app

The package contains the frontend, desktop bridge, OCR helper, pinned inference runtime and licenses. It does not include model weights, test PDFs or user data. PDF.js CMaps and standard fonts retain their upstream license notices. The generated third-party notices must match the installed dependency lockfile.

The website is published at https://sailpdf.pages.dev/ through Cloudflare Pages, connected to this repository's `main` branch with `docs` as the build output directory and no build command. Pushes to `main` automatically deploy the site. Keep asset links relative.
