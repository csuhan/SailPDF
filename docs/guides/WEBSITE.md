# Website maintenance and SEO

Cloudflare Pages serves `docs/` at https://sailpdf.pages.dev/. The existing configuration deploys the repository's `main` branch with `docs` as the output directory and no build command. Generate and commit website updates before pushing to `main`.

## Edit and validate

- `docs/index.html` is the English page source, including its visible copy.
- `docs/site-content.js` contains the Chinese translations and shared tool content used by both the generator and browser interactions.
- `scripts/build-website.mjs` owns the generated SEO metadata, structured data, static tool content, language alternatives and crawler files.

After editing website copy, translations, tool descriptions or the application version, run:

```sh
npm run build:website
npm run check:website
npm run test:website
```

The build refreshes the English page's generated sections, creates `docs/zh-CN/index.html`, and writes `docs/sitemap.xml` and `docs/robots.txt`. Keep these generated files tracked and commit them with their sources. Do not edit the generated Chinese page directly. Static content lets crawlers read both languages and the tool descriptions without running JavaScript; browser scripts add the interactive preview.

`check:website` checks that generated output is current. `test:website` runs browser regressions and requires Chrome; set `CHROME_PATH` to the Chrome executable if it is not found automatically. Review both language pages on desktop and mobile after visible copy or layout changes.

The shared social preview image uses the existing logo and workspace screenshot. After changing those assets, run `node scripts/generate-seo-image.mjs` to refresh `docs/images/social-card.png`.

`docs/404.html` gives Cloudflare Pages a real not-found page instead of its default single-page-app fallback. Keep it in the deployment so unknown URLs return HTTP 404 rather than a copy of the home page with HTTP 200.

## Deploy and request discovery

Local generation and validation do not deploy the website. This SEO update does not itself publish a deployment. Once the changes are reviewed and pushed to `main`, Cloudflare Pages deploys them automatically. Verify the production responses and content at:

- https://sailpdf.pages.dev/
- https://sailpdf.pages.dev/zh-CN/
- https://sailpdf.pages.dev/robots.txt
- https://sailpdf.pages.dev/sitemap.xml

Check that both language pages load correctly, each has its own canonical URL, and their language links work. Check the deployed HTML as well as the rendered page, and confirm that crawler files reference the production domain.

A verified site owner can submit `https://sailpdf.pages.dev/sitemap.xml` in Google Search Console and Bing Webmaster Tools, then inspect both page URLs for crawl or indexing issues. These steps require the owner's accounts and site access. A sitemap helps discovery; indexing and ranking depend on each search engine and are not immediate or guaranteed.

If the domain changes, update `SITE_URL` in `scripts/build-website.mjs` and `homepage` in `package.json`, then regenerate and validate the website. Arrange redirects from the old domain when configuring the new host.
