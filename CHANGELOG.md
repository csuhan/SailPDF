# Changelog

## 0.11.0 — Sail PDF

- Rename the application and project to Sail PDF, with the approved open-sail mark across the app icon, interface, website and documentation.
- Keep the established navy, slate and paper palette, English default and Chinese language switch.
- Move the project, feedback and releases to `csuhan/SailPDF`, with GitHub Pages served from `docs/`.
- Keep the established desktop profile and preference keys so recent files, settings, recovery drafts and models remain available after the rename.

## 0.10.2 — Initial public beta

- Validate system font exports before embedding; fall back when macOS exposes a face without glyph outlines.
- Rebuild standalone faces from font collections with correct table offsets and requested-face selection.
- Cover font compatibility and asynchronous password-dialog rendering in regression tests.

- Unify the desktop icon, in-app mark and favicon with the project website's Sail identity.
- Publish English and Chinese documentation with language links, reproducible setup and release instructions.
- Add source-only asset, OCR and synthetic PDF fixture generation; omit test PDFs and system-font fixtures from production packages.
- Consolidate duplicated localization catalogs and format the source consistently.
- Update development dependencies to resolve the currently reported npm audit findings.
- Add GitHub CI and a project website served from `docs/` through GitHub Pages.

This release includes English/Simplified Chinese UI and native menus, multi-document workspaces, reading colors, annotations, supported text/image editing, form filling, page tools, an optional AI assistant, recovery drafts, save validation and external file conflict handling.

The macOS Apple Silicon beta is unsigned and not notarized. Model weights are downloaded separately. Complex PDF editing limitations still apply.

## Earlier development milestones

- **0.10.0:** bilingual interface, native menus and help; language switches preserve document contents and edits.
- **0.9.0:** cross-document/form recovery, desktop security boundaries, protected credentials, privacy/license/help and feedback entries.

Earlier milestones, including the 0.10.1 release candidate, were local development builds, not prior public GitHub releases.
