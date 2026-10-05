# Changelog

## 0.4.0 (2026-10-05)

### Breaking changes

- `parseHtml` reads pages with mdream's tokenizer instead of HTMLRewriter, about seven times faster with all options and in any JavaScript runtime. `@mdream/js` (`^1.7.2` or `2.0.0-beta.1`) is now a peer dependency; install it next to this package. `cleanHtml` still uses HTMLRewriter and runs only in Cloudflare's runtime.
- `meta.title` is the document's first `<title>`. An SVG's `<title>`, such as an icon's, no longer replaces it, and a page whose only titles name graphics has none.
- Elements close where an HTML parser closes them: an unclosed `<li>` or `<p>` ends where the next one starts, and a context, link, or heading no longer collects to the end of the page.
- `Script` carries `head`, whether the script stands in the `<head>`.

### Features

- `parseHtml` takes a `ReadableStream` as well as text and responses, and `parseHtmlSync` parses text without a promise.
- The new `markdown` option writes the page as Markdown with mdream from the same input; a response or stream is read once for both. mdream's filters shape only the Markdown.
- The new `text` option returns the visible text with its length, for telling server-rendered pages from app shells or reading a page's words.
- The new `inlineCode` option returns what a Content Security Policy has to allow: the exact text of inline scripts that run, event handler attributes, `javascript:` URLs, inline styles, and form targets.
- A `context` that matches nothing falls back to the whole page for responses and streams too, not only for text.
- `parseHtml` collects the page's own CSS with the new `styles` option: each `<style>` block with its `id`, each `style` attribute with its element, and the stylesheets the page loads or preloads.
- `readStyles` builds a style map from CSS text without a browser: custom properties with their definitions, uses, and resolved colours; every colour a declaration paints with, written out or read through a variable; the font families declarations ask for; the `@font-face` rules with their weight, style, and `font-display`; and `@import`s. `readDeclarations` returns one stylesheet's declarations with their selectors and at-rules.
- `parseColor`, `colorsIn`, `toHex`, and `colorDistance` read and compare CSS colours, from hex to `oklch()`.
- `parseHtml` detects with the new `hydration` option which framework hydrates the page, Astro, Next.js, Nuxt, SvelteKit, Remix, or Angular, and measures the data it serializes into the HTML; for Astro, it lists the islands with their directive, component, and props.
- `parseHtml` estimates with the new `positions` option, without a browser, whether each image and Astro island is in the first screen of a desktop visit, below it, hidden, or unknown.

## 0.3.0 (2026-10-01)

### Features

- `parseHtml` reads the page's JSON-LD with the new `structuredData` option, in the same pass: the nodes of every `<script type="application/ld+json">` block, with lists and `@graph` expanded, and the blocks that are not valid JSON. `readStructuredData` does the same for block texts you already have.

## 0.2.0 (2026-10-01)

### Breaking changes

HTML-to-Markdown conversion is removed; this library now only extracts facts from HTML and cleans it. Use [mdream](https://github.com/harlan-zw/mdream) for Markdown: it converts tables, nested lists, and the languages of code blocks correctly, which the streaming writer did not.

- `parseHtml` no longer takes the `markdown` option and no longer returns `markdown`. Convert the page with `import { htmlToMarkdown } from "@mdream/js"`, or with `mdream` for the Rust/WASM engine. To limit the Markdown to the content, pass it the output of `cleanHtml` with `context`.
- `parseHtml` no longer takes `skipAriaHidden`, which affected only the Markdown. Remove it from the options; links, images, and headings inside `aria-hidden` elements were and still are collected.
- `markdownWithAi` and its types `AiMarkdownOptions` and `MarkdownConverter` are removed. Call Workers AI directly with the output of `cleanHtml`: `env.AI.toMarkdown([{ name: "index.html", blob: new Blob([html], { type: "text/html" }) }])`. For the same input as before, clean with `remove` set to `scripts`, `styles`, `comments`, `cookieConsent`, `ariaHidden`, `classes`, `ids`, `meta`, `linkTags`, `hyphenation`, and, unless you want images, `images`.
- The type `MarkdownOptions` is removed.

### Changes

- `parseHtml` registers the handlers for links, images, and class counts only when they are asked for.

## 0.1.2 (2026-09-29)

### Fixes

- Attribute values have their entities decoded, as a DOM parser would: `href="?a=1&amp;b=2"` becomes `?a=1&b=2`, and addresses obfuscated with numeric entities become readable. HTMLRewriter returns attributes as written in the source.
- Text and attributes decode every named entity of HTML 4, not only the most common ones.
- Lazy-loaded images are taken from `data-src` or `data-lazy-src` when `src` holds only a `data:` placeholder.
- `images` lists every image of the page; the limit of 500 is gone.

## 0.1.1 (2026-09-29)

### Fixes

- A context selector, a link, a heading, or a Markdown block that ended on the same element lost all but one of their end-tag actions, because HTMLRewriter keeps only the last end-tag handler per element. A context such as `main a` then collected everything after its first match, and headings collected together with Markdown lost their Markdown line break.
- An empty page returns empty results at once instead of starting a transform that some runtimes never finish.

## 0.1.0 (2026-09-29)

### Features

- `parseHtml` collects links, images, scripts, frames, link elements, metadata, headings, class-prefix counts, and Markdown in one HTMLRewriter pass, optionally limited to a CSS selector.
- `cleanHtml` removes scripts, styles, comments, consent banners, hidden helpers, images, classes, IDs, meta and link tags, and hyphenation on request, filters links, and always strips EXIF, XMP, and binary text.
- `headingCounts` counts headings per level without the limit of the `headings` list.
- `markdownWithAi` converts the cleaned page with Workers AI as the second way to Markdown.
- Link URLs keep the case of their paths; only scheme, host, and e-mail addresses are lowercased.
- Images report a missing `alt` as `null` and an empty one as `""`.
