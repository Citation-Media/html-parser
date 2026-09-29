# Changelog

## 0.1.0 (2026-09-29)

### Features

- `parseHtml` collects links, images, scripts, frames, link elements, metadata, headings, class-prefix counts, and Markdown in one HTMLRewriter pass, optionally limited to a CSS selector.
- `cleanHtml` removes scripts, styles, comments, consent banners, hidden helpers, images, classes, IDs, meta and link tags, and hyphenation on request, filters links, and always strips EXIF, XMP, and binary text.
- `headingCounts` counts headings per level without the limit of the `headings` list.
- `markdownWithAi` converts the cleaned page with Workers AI as the second way to Markdown.
- Link URLs keep the case of their paths; only scheme, host, and e-mail addresses are lowercased.
- Images report a missing `alt` as `null` and an empty one as `""`.
