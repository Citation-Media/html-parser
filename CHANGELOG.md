# Changelog

## 0.2.0 (2026-10-01)

### Features

- The Markdown keeps inline formatting: `<strong>` and `<b>` become `**bold**`, `<em>` and `<i>` become `*italic*`, and `<code>` outside a code block becomes inline code, with a longer backtick fence when the code holds backticks. Formatting around only whitespace is left out, spaces at its edges stay outside the markers, and code blocks keep their content as written.
- Code blocks name their language, such as ` ```ts `, from a `language-` class on the `<code>` directly inside the `<pre>`, the convention the HTML standard suggests and CommonMark writes.

### Fixes

- Inside inline code, links and images are written as text instead of Markdown that would show literally.
- Spaces on both sides of an inline element no longer become two spaces.

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
