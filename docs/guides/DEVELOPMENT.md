# Development guide

## Setup

Use Node.js 24 and `npm ci`. Installation prepares the PDF.js assets and generates icons from `build/icon.svg`. `npm run dev` starts the browser UI; `npm run app` builds the frontend and launches Electron. Complete desktop packaging requires macOS Apple Silicon and Xcode Command Line Tools.

No `.env` file or remote AI account is required for standard development. Configure optional AI through the application, not hard-coded credentials.

## Architecture

- `src/components`: document UI, tools and settings.
- `src/state`: independent document sessions, edits, preferences and recovery status.
- `src/pdf`: PDF.js reading/rendering, extraction, conversion, security and edit operations.
- `src/ai`: retrieval, model transport and reviewable edit proposals.
- `src/i18n` and `locales`: UI language state and English translations of canonical interface copy.
- `electron`: trusted-frame IPC validation, user-selected file access, disk conflict protection, system-encrypted credentials and local model processes.
- `native/ocr.swift`: on-device recognition using Apple's Vision framework.

Original document bytes are retained as the input snapshot. Edits are stored as operations; output is generated and validated before writing. Document sessions capture their own view, form and edit state. Disk fingerprints prevent silently overwriting changes made outside the app.

Some internal `pdfpro` names intentionally retain the historical storage/IPC namespace so existing installations keep their preferences, drafts and local models. The `lumen.ui.language` key is also retained for upgrade compatibility. User-facing branding is Sail PDF.

Language changes update interface catalogs through shared factories; they do not recreate the document or translate user content. See [localization maintenance](../../locales/README.md).

## Tests and fixtures

The full browser suite needs macOS, Chrome, `qpdf`, Georgia and Arial Unicode system fonts. Run `npm run test:fixtures` to create every required PDF. All content is synthetic. System fonts are used locally for fidelity checks and are not committed or copied into production builds. For locally supplied compatible fonts, set `SAIL_TEST_FONT_DIR`.

`npm test` runs code checks. `npm run test:e2e` owns a clean Vite server on port 5174, runs the full suite and saves per-test logs. `-- --external` reuses a server; start it with `PDFPRO_TEST_LANGUAGE=zh-CN` for legacy fixtures. Avoid editing application source during a run, because HMR can invalidate document/module identities.

`npm run test:native` uses an isolated Electron profile and a controlled local HTTP server. It verifies production sandbox/CSP boot, permissions, IPC/navigation restrictions, language persistence and protected credential storage. It does not require real AI inference or download weights.

## Website

`docs/` is a dependency-free static website. Its default language is English, with a saved Chinese preference. Run `python3 -m http.server 4180 --bind 127.0.0.1 --directory docs` from the repository root. Product examples are illustrative; the website does not process PDFs or call AI services.
