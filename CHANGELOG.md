# Changelog

## 0.8.0 (2026-10-13)

### Features

- The `select` option returns elements by CSS selector, as `selected` under the caller's keys: each match's tag, attributes, and text, at most 200 per key, read regardless of `context`. One pass answers questions a caller would otherwise regex the HTML for, such as `<address>` elements, `<time datetime>`, or links with `data-*` attributes. The selectors are those `context` takes.
- The `forms` option reads the page's forms: where each sends to, its method, its fields with type, name, autocomplete, placeholder, whether they are required, and their label by `for`, wrapping, or `aria-label`, and the texts of its buttons.

## 0.7.0 (2026-10-13)

### Features

- The `hidden` option marks each link, image, and heading inside hidden content: a `<template>`, a `<dialog>` without `open`, the `hidden` attribute, `aria-hidden="true"` or `inert`, or `display: none` or `visibility: hidden` in a `style` attribute. In place of `true`, a rule `(tag, attributes, byMarkup) => boolean` decides for each element given what the markup says, to keep popups or hide screen-reader-only classes as well; `positions` follows the same decision. A link or image repeated in plain sight is not hidden. `hidesContent(tag, attributes)` is the markup rule, exported beside `hiddenFromReaders`.
- `images[].sources`: the absolute URLs of an image's `srcset`, without data URLs; `resources.media`: the URLs of audio, video, their sources and tracks, a `<picture>`'s sources, embeds, and objects, so a mixed-content check reads every address a page loads from the result.
- `meta.properties`: every `<meta property>` such as `og:title` or `article:published_time` by its lower-cased property.
- `maxBlockLength`, the size limit of a JSON-LD block, is exported.
- `bench/parse.mjs` parses a directory of pages with every option on and prints the median per page, for comparing a change against `main`.

### Fixes

- `siteOf` knows `or.at` and `or.jp` as second levels, so `verein.or.at` is the site, not `or.at`, and the links of such a site are `internal`.

## 0.6.0 (2026-10-13)

### Features

- `consentSelectors` lists the dialogs, banners, and content blockers of widespread consent tools, the list `cleanHtml` removes with `cookieConsent`, now with Cookiebot, Complianz, CookieYes, Cookie Law Info, OneTrust, Klaro, CCM19, Real Cookie Banner, consentmanager, CookieConsent, Didomi, Sourcepoint, Quantcast, TrustArc, and Moove besides Borlabs Cookie and Usercentrics.
- `hiddenFromReaders(tag, attributes)` tells whether an element's `aria-hidden="true"` or `inert` hides its content from screen readers, leaving out the main landmark, which an open dialog marks for a moment and no page hides for good.

### Fixes

- `cleanHtml` with `ariaHidden` no longer removes the main landmark. An open modal dialog, such as a consent dialog on a first visit, marks every other child of the body `aria-hidden`, `<main>` included; a page rendered and saved in that state lost its whole content and kept only the dialog. `inert` elements are now removed like `aria-hidden` ones.
- `positions` takes images and islands inside `aria-hidden="true"` or `inert` elements, such as a slider's clones, as `hidden`, with the same exception for the main landmark.

## 0.5.1 (2026-10-13)

### Fixes

- `readDeclarations` and `readStyles` read past escaped characters outside strings. An escaped quote in a selector, such as Tailwind's `.before\:content-\[\'\/\/_\'\]`, no longer opens a string that swallows the rest of the stylesheet, and an escaped brace or parenthesis no longer opens a block. On Tailwind sites with such classes, the custom properties and colours after them, often the whole `:root` palette, were missing from the style map.

## 0.5.0 (2026-10-09)

### Features

- The new `ids` option returns the targets a fragment link can point to: every element's `id` and each `<a>`'s `name`, in page order and each once, read regardless of `context`. With the `anchor` links of a page, or the fragments of internal links to it, they show links whose target is missing.

## 0.4.1 (2026-10-06)

### Features

- `resources.links` carry the `<link>` element's `type` where it has one, so a Markdown version a page announces with `<link rel="alternate" type="text/markdown">` can be told from a feed or another alternate.

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
- The new `head` option hands the `<head>` to unhead's validator in page order: its elements with their Capo weights, and the issues unhead's rules find, such as render-blocking scripts, a late charset, or too many preloads. unhead is now a dependency.
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
