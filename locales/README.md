# Interface localization

English is the default interface language; Simplified Chinese is available in Settings → Appearance & reading. The browser preference uses `lumen.ui.language`. Desktop menus also persist the choice in the app profile.

`en.json` maps canonical Chinese interface copy to English. Use `tr('copy')` at the point interface text is created. For dynamic values use numbered placeholders, for example `tr('第 {0} 页', page)`. Add the corresponding English entry and preserve every numbered parameter.

Never pass document text, user input, annotations, AI responses or arbitrary filenames through translation. The localization system translates code-defined UI copy and interpolates user values unchanged; it does not rewrite the DOM or document contents. Predefined interface catalogs refresh via `onLocaleChange`. Components with cached labels or React memoization must subscribe with `useLocale`.

AI answer language is independent of interface language. Legal notices retain original license text, while help, privacy, beta terms and model descriptions have English and Chinese versions.

`node scripts/test-i18n.mjs` audits literal translation keys and interpolation coverage. `node scripts/e2e-bilingual.mjs` verifies persistence and that language changes preserve source bytes, document identity, edits and form values. The unified legacy test runner explicitly defaults its fixtures to Chinese; bilingual tests select their own language.
