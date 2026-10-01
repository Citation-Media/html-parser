# Changelog

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
