# Contributing

Thank you for helping improve Sail PDF. Small, focused changes are easiest to review.

## Before changing code

Search existing issues and describe the concrete user problem. For bugs, include the app version, macOS version, reproducible steps, and expected versus actual behavior. Use synthetic or redacted PDFs; never post credentials or private documents.

Use Node.js 24 and `npm ci`. For the full macOS test suite, install Chrome and `qpdf`, then run `npm run test:fixtures`. Do not commit generated PDFs, system font programs, model weights, native executables, dependencies, build output or local profiles.

## Development

```sh
npm run dev
npm test
npm run build
npm run test:e2e
npm run test:native
npm run format:check
```

Browser/font tests use macOS fonts and run with explicit Chinese fixture settings; the bilingual suite verifies both languages. Live AI and model-download tests are optional and are not part of the default offline suite.

Preserve document isolation, undo behavior and save conflict checks. Do not mutate original PDF bytes or bypass output validation to make a test pass. If changing localization, add English entries in `locales/en.json`, preserve interpolation values and subscribe cached UI catalogs to language changes. Do not translate user content.

## Pull requests

Explain the problem, the resulting behavior and relevant validation. Add a screenshot for visible UI changes. Include meaningful regression coverage when behavior changes. Keep formatting separate from unrelated functional changes where practical.

Treat other contributors respectfully and review ideas on their technical merits. Security reports should follow [SECURITY.md](SECURITY.md).

Contributions are offered under the project's Apache-2.0 license. Third-party code and assets must include compatible licensing and attribution.
