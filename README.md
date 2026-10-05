# @citation-media/html-parser

Extracts links, images, resources, metadata, headings, class counts, JSON-LD, styles, hydration, visible text, and inline code from HTML in one pass over the page, and writes it as Markdown with [mdream](https://github.com/harlan-zw/mdream) from the same input when asked. It reads the page with mdream's tokenizer, which never builds a DOM and runs in plain JavaScript in Cloudflare Workers, Node.js, Bun, Deno, and browsers: a streamed page of several megabytes costs about as much memory as a small one.

## Install

```bash
npm install @citation-media/html-parser @mdream/js
```

`@mdream/js` is a peer dependency, `^1.7.2` or `2.0.0-beta.1`. [unhead](https://unhead.unjs.io/) comes along for the `head` option. `cleanHtml` builds on [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) and runs only where it is a global: Cloudflare Workers, `wrangler dev`, and `@cloudflare/vitest-pool-workers`.

## Parse A Page

`parseHtml` returns only what you ask for. The input is the page as text, a `Response` such as the result of `fetch`, or a `ReadableStream` of its body; a response or stream is read chunk by chunk. `parseHtmlSync` does the same for text without a promise.

```ts
import { parseHtml } from "@citation-media/html-parser";

const response = await fetch("https://example.com/");
const { links, images, meta } = await parseHtml(response, {
  url: response.url,
  links: { kinds: ["internal"], resources: false },
  images: true,
  meta: true,
});
```

| Option | What it collects |
| --- | --- |
| `url` | Required. Resolves relative URLs and tells internal links from external ones. |
| `links` | `true` or a filter: `kinds` (`internal`, `external`, `special`, `anchor`) and `resources: false` to drop downloads such as PDFs. |
| `images` | Images with `alt` (`null` when missing, `""` when decorative), `width`, `height`, `loading`, and whether they have a `srcset`. |
| `resources` | Scripts with their `src`, `type`, attribute names, and whether they stand in the `<head>`, frame URLs, and `<link>` elements with their `rel` and, where they have one, `type`, such as `text/markdown` for a Markdown version of the page. A classic script in the head without `async`, `defer`, or `nomodule` blocks the first render. |
| `meta` | Title, description, language, canonical URL, robots, viewport, generator, and Open Graph image. The title is the document's first `<title>`; an SVG's `<title>` names the graphic and does not count. |
| `headings` | The first 200 headings with their level and text, and `headingCounts` per level without a limit. |
| `classPrefixes` | Counts of elements whose class starts with a prefix, such as `["elementor-", "brxe-", "wp-block-"]`. |
| `context` | A CSS selector such as `main` or `article`: only content inside matching elements counts. When nothing matches, the whole page counts. It takes types, `#id`, `.class`, attribute selectors with `=`, `~=`, `\|=`, `^=`, `$=`, `*=` and an `i` flag, `:first-child`, `:nth-child()`, `:first-of-type`, `:nth-of-type()`, `:not()`, and the descendant and `>` combinators, as HTMLRewriter does; selectors that need what comes after an element, such as `:last-child` or `+`, throw a `SyntaxError`. |
| `structuredData` | The page's JSON-LD as `items`, the nodes of every `<script type="application/ld+json">` block with lists and `@graph` expanded, and `invalid`, the blocks that are not valid JSON with their position and error. Read wherever the blocks are, regardless of `context`. |
| `styles` | The page's own CSS for `readStyles`: `blocks`, each `<style>` block's text with its `id`; `attributes`, each `style` attribute with its element, such as `div#hero.banner`; and `stylesheets`, the absolute URLs of `rel="stylesheet"` links and stylesheets preloaded with `as="style"`. Read regardless of `context`. |
| `hydration` | The framework that hydrates the page in the browser, or `null`, see [Hydration](#hydration). Read regardless of `context`. |
| `positions` | Adds a `position` to each image and Astro island, see [First Screen](#first-screen). Read regardless of `context`. |
| `text` | The text a visitor reads, as `length` and `content`: without the head, scripts, styles, templates, `<noscript>`, and SVG, with whitespace collapsed and block elements separated by a space. `{ maxLength }` cuts `content`, 100,000 characters by default; `length` counts the whole text. Little text in the body as served marks a page that scripts render. |
| `inlineCode` | What a Content Security Policy has to allow: `scripts`, the text of every inline script a browser runs, exactly as written for its hash, without data blocks such as JSON-LD or templates; `eventHandlers`, attributes such as `onclick`; `javascriptUrls` in `href`, `src`, `action`, and `formaction`; `styleElements` and `styleAttributes`; and `formActions`, the absolute URLs forms send to. Read regardless of `context`. |
| `markdown` | The page as Markdown, written by mdream from the same input: `true` for mdream's defaults with the page's origin, or mdream's options, such as `{ plugins: { filter: { exclude: ["nav"] }, isolateMain: true } }`. mdream's filters shape only the Markdown, never what the other options collect. |
| `head` | The `<head>` as [unhead](https://unhead.unjs.io/) validates it, see [Head](#head). Read regardless of `context`. |

`readStructuredData(blocks)` turns the text of JSON-LD blocks into the same result, for blocks you already have. It checks only that each block is JSON; whether the nodes carry the properties a search engine expects is up to the caller.

Links are deduplicated by URL, counted, and sorted by count. Each carries its `text`, `kind`, `resource`, `count`, and, where present, `rel`, `target`, and `aria-label`. URLs are absolute; paths keep their case. Texts read as a DOM's `textContent` does, with entities decoded once and whitespace collapsed.

## One Pass For Several Needs

Ask for everything a page is needed for at once, so it is read once:

```ts
import { parseHtml } from "@citation-media/html-parser";

const page = await parseHtml(await fetch(url), {
  url,
  links: true,
  meta: true,
  structuredData: true,
  text: true,
  markdown: { plugins: { filter: { exclude: ["script", "style"] } } },
});
```

For a response or stream with `markdown`, the body is read once and feeds the tokenizer and mdream's converter side by side. The facts come from mdream's tokenizer, tuned to keep whitespace and CSS as the page has them; the Markdown comes from mdream's converter unchanged. Measured in workerd on 18 pages from 4 KB to 1.9 MB, all options together take about a seventh of the time the earlier HTMLRewriter pass took, and the facts with Markdown a quarter of the facts plus two Markdown conversions.

## Head

With `head`, `parseHtml` hands the `<head>` it read to unhead: `elements` lists the head's elements in page order, each with its `attributes`, its Capo `weight`, the `size` in bytes of inline content, and the title's `text`; `issues` lists what unhead's validator finds, each with its `rule`, unhead's English `message`, its `severity`, and the index of its `element`.

```ts
const { head } = await parseHtml(html, { url, head: true });
for (const issue of head.issues) {
  console.log(issue.rule, head.elements[issue.element ?? -1]?.attributes);
}
```

The rules are unhead's own, such as `render-blocking-script`, `charset-not-early`, `too-many-preloads`, `preload-font-crossorigin`, `preconnect-missing-crossorigin`, `inline-style-size`, `non-absolute-canonical`, `og-image-missing-dimensions`, or `viewport-user-scalable`. unhead normally sorts and deduplicates the tags it renders; here every element is its own entry with one weight, so the rules read the page's order and tags. Rules about using unhead's API, such as `invalid-input-shape`, are off. `{ head: { rules } }` passes unhead's rule configuration, such as `{ "too-many-preloads": ["warn", { max: 10 }] }` or `{ "deprecated-twitter-meta": "off" }`.

`weight` is Capo's order as unhead computes it: the lower, the earlier an element belongs, from `-30` for a Content-Security-Policy over `-20` for the charset, `10` for the title, and `50` for blocking scripts, to `100`. An element with a lower weight than one before it stands later than it should. What to report, and in which words, is up to the caller.

## Hydration

With `hydration`, `parseHtml` tells from the HTML as the server sends it, without running a script, whether a framework hydrates the page in the browser, and measures the data it serializes into the HTML for that, which the browser processes before the page responds to input.

| `framework` | Marker | `payloadBytes` counts |
| --- | --- | --- |
| `astro` | `<astro-island>` elements | The props of every island, as the HTML carries them |
| `next-pages` | `<script id="__NEXT_DATA__">` | That script |
| `next-app` | Inline scripts starting the `self.__next_f` stream | Those scripts |
| `nuxt` | `<script id="__NUXT_DATA__">`, or Nuxt 2's `window.__NUXT__ =` | That script |
| `sveltekit` | `__sveltekit_… = {` in an inline script | That script |
| `remix` | `window.__remixContext =` or React Router's `window.__reactRouterContext =` | That script |
| `angular` | An element with `ng-version` | `<script id="ng-state">` |

`payloadBytes` counts characters, which for the JSON the frameworks write is about its bytes. Astro's `islands` list the first 200 with `uid`, `client` directive, `component` file, `propsBytes`, and `serverRendered`, which is `false` for `client:only` islands. A marker counts only in an inline script's first 1,000 characters, so bundles that mention it do not. Qwik resumes instead of hydrating and is `null`, as is a page whose scripts render it in the browser without server-rendered HTML.

## First Screen

With `positions`, each image and Astro island gets a `position`: where it is expected on a desktop visit before scrolling, estimated from the markup alone, without a browser. A streaming pass knows no sizes, so it reads how much visible text and how many images come before an element and whether it sits in a hidden, sliding, or fixed container, and answers only where that is clear:

| `position` | When |
| --- | --- |
| `hidden` | Inside an element the markup hides: `hidden`, `display: none` or `visibility: hidden` in its `style`, a `<dialog>` without `open`, a template, or classes such as `modal`, `drawer`, `offcanvas`, `popover`, `tooltip`, `sr-only`, or `screen-reader-text`. |
| `first-screen` | Fewer than 200 characters of visible text and no visible image before it. |
| `below` | At least 1,500 characters and a quarter of the page's visible text before it. |
| `unknown` | Everything else. Slides of a carousel or slider are always `unknown`, since the markup lists them side by side; elements in a header or a fixed or sticky container are never `below`, since such containers stay in view. |

Text in `<nav>` and `<header>`, scripts, styles, templates, and hidden containers does not count. An image's position is that of its first occurrence.

Measured against Chromium at 1440 × 900 on 17 sites, from small company sites built with WordPress and Astro to SaaS sites and a news portal, with 486 images and islands:

| `position` | Estimated | Correct |
| --- | --- | --- |
| `below` | 184 | 182 not in the first screen: 135 below it, 47 not rendered |
| `first-screen` | 28 | 28 not below it: 17 in the first screen, 11 not rendered, such as images in a closed menu |
| `hidden` | 11 | 11 not rendered |
| `unknown` | 263 |  |

So `below` and `first-screen` are reliable claims that an element is not in, or not below, the first screen, and `unknown` covers about half of all elements. A layout whose source order differs from what it shows, such as a grid reordered by CSS, can still place an element wrongly; for exact positions, measure in a browser.

## Read A Page's Styles

`readStyles` builds a map of what CSS defines and uses, without a browser, from CSS text you give it: the `blocks` and `attributes` `parseHtml` collects with `styles`, and the stylesheets, which you fetch and, across the pages of a site, cache.

```ts
import { parseHtml, readStyles } from "@citation-media/html-parser";

const { styles } = await parseHtml(html, { url, styles: true });
const sheets = await Promise.all(
  styles.stylesheets.map(async (href) => ({
    css: await (await fetch(href)).text(),
    origin: href,
  }))
);
const map = readStyles([
  ...sheets,
  ...styles.blocks.map(({ css, id }) => ({
    css,
    origin: `inline#${id ?? ""}`,
  })),
  ...styles.attributes.map(({ css, element }) => ({
    css,
    element,
    origin: "attribute",
  })),
]);
```

| Field | What it holds |
| --- | --- |
| `variables` | Every custom property with its definitions (value, selector, origin), how many declarations read it through `var()`, and, where its root definition resolves to one, its `color` as hex. A definition on `:root`, `html`, or `:host` counts for the page, one outside `@media` first. |
| `colors` | Every colour a colour property paints with, as hex with its alpha, its property, selector, and origin, and the `variable` it comes through; a colour the declaration writes itself has none. Fallbacks inside `var()` do not count as written. |
| `fonts` | Every `font-family` and `font` declaration's first family and whole stack, after resolving variables, with the variable it comes through. |
| `fontFaces` | The families `@font-face` rules load, with weight, style, `font-display`, and `src`, each from its own rule whatever the order of its descriptors. |
| `imports` | The URLs `@import` rules load, as written, for you to fetch too. |

The reader is not a full CSS parser: it follows comments, strings, at-rules such as `@media` and `@layer`, and CSS nesting, keeps a declaration's innermost selector, skips `@keyframes`, and ignores what it cannot read. Nothing is rendered: the map says what the CSS writes, not which elements show it. `readDeclarations(css, origin)` returns the plain declarations of one stylesheet with their selectors and at-rules.

`parseColor` reads hex, `rgb()`, `hsl()`, `oklch()`, `oklab()`, and the named colours as sRGB; colours that depend on the element, such as `currentcolor` or `color-mix()`, are `null`. `colorsIn` finds every colour in a value, `toHex` writes one as six-digit hex, and `colorDistance` measures how far apart two look (CIE76 in Lab: below 1, the eye cannot tell them apart).

## Clean A Page

`cleanHtml` returns HTML without what you remove. EXIF and XMP blocks and binary-looking text are always removed.

```ts
import { cleanHtml } from "@citation-media/html-parser";

const html = await cleanHtml(page, {
  url: "https://example.com/",
  remove: {
    scripts: true,
    styles: true,
    comments: true,
    cookieConsent: true,
    classes: true,
  },
  links: { kinds: ["internal"] },
  context: "main",
});
```

`remove` accepts `scripts`, `styles` (with style attributes and inline SVG), `comments`, `cookieConsent`, `ariaHidden`, `images`, `classes`, `ids`, `meta`, `linkTags`, and `hyphenation`. Links that `links` does not keep become their text.

## Markdown

The Markdown itself is mdream's: the `markdown` option hands it the page with your options. To convert with mdream's WebAssembly engine, the `mdream` package, call it on the same text yourself.

## Limits

Elements are opened and closed as an HTML parser does: `<li>` and `<p>` close where the next one starts, and elements left open close at the end of the page. `cleanHtml` needs HTMLRewriter, so it runs only in Cloudflare's runtime.

## Develop

Development needs Node.js 22.18 or later, which loads the TypeScript configuration of Oxlint and Oxfmt; `.nvmrc` pins Node.js 24.

```bash
npm ci
npm test
npm run check
npm run build
```

Tests run in workerd through `@cloudflare/vitest-pool-workers` and in Node.js, except those of `cleanHtml`, which need HTMLRewriter.

## Release

Bump `version` in `package.json` and add a section to `CHANGELOG.md` on `main`, then push a matching tag such as `v0.2.0`. The release workflow publishes to npm with provenance and creates the GitHub release.

## License

MIT
