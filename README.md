# @citation-media/html-parser

Extracts links, images, resources, metadata, and Markdown from HTML in Cloudflare Workers, in one streaming pass over the page. It builds on the runtime's [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/), so it never holds a DOM: a page of several megabytes costs about as much memory as a small one.

## Install

```bash
npm install @citation-media/html-parser
```

The package runs wherever `HTMLRewriter` is a global: Cloudflare Workers, `wrangler dev`, and `@cloudflare/vitest-pool-workers`. It has no dependencies.

## Parse A Page

`parseHtml` returns only what you ask for. The input is the page as text or a `Response`, such as the result of `fetch`.

```ts
import { parseHtml } from "@citation-media/html-parser";

const response = await fetch("https://example.com/");
const { links, images, meta, markdown } = await parseHtml(response, {
  url: response.url,
  links: { kinds: ["internal"], resources: false },
  images: true,
  meta: true,
  markdown: true,
});
```

| Option | What it collects |
| --- | --- |
| `url` | Required. Resolves relative URLs and tells internal links from external ones. |
| `links` | `true` or a filter: `kinds` (`internal`, `external`, `special`, `anchor`) and `resources: false` to drop downloads such as PDFs. |
| `images` | Images with `alt` (`null` when missing, `""` when decorative), `width`, `height`, `loading`, and whether they have a `srcset`. |
| `resources` | Scripts with their `src`, `type`, and attribute names, frame URLs, and `<link>` elements with their `rel`. |
| `meta` | Title, description, language, canonical URL, robots, viewport, generator, and Open Graph image. |
| `headings` | The first 200 headings with their level and text, and `headingCounts` per level without a limit. |
| `classPrefixes` | Counts of elements whose class starts with a prefix, such as `["elementor-", "brxe-", "wp-block-"]`. |
| `markdown` | `true` or options: `links` (default true), `images` (default false), `maxLength` (default 100 000). |
| `context` | A CSS selector such as `main` or `article`: only content inside matching elements counts. When nothing matches, the whole page counts, if the input is text. |
| `skipAriaHidden` | Leaves `aria-hidden` content out of the Markdown. Default true; set it to false for DOMs taken from a browser while a consent dialog is open, which hides the page that way. |

Links are deduplicated by URL, counted, and sorted by count. Each carries its `text`, `kind`, `resource`, `count`, and, where present, `rel`, `target`, and `aria-label`. URLs are absolute; paths keep their case.

The Markdown leaves out navigation, footer, forms, scripts, consent dialogs, visually hidden helpers, and binary or EXIF text, so it holds what a reader reads.

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

## Markdown By Workers AI

`markdownWithAi` cleans the page and converts it with Workers AI's document conversion. It handles tables and nested formatting better than the streaming Markdown, at the cost of a service call.

```ts
import { markdownWithAi } from "@citation-media/html-parser";

const markdown = await markdownWithAi(env.AI, page, { url, images: true });
```

## Limits

The streaming Markdown follows HTMLRewriter's model: tables become rows without alignment, and bold or italic formatting is dropped. Use `markdownWithAi` where that matters. Elements that are opened but never closed, such as `<span/>`, keep their state to the end of the page.

## Develop

```bash
npm ci
npm test
npm run check
npm run build
```

Tests run in workerd through `@cloudflare/vitest-pool-workers`, the runtime the package targets.

## Release

Bump `version` in `package.json` and add a section to `CHANGELOG.md` on `main`, then push a matching tag such as `v0.2.0`. The release workflow publishes to npm with provenance and creates the GitHub release.

## License

MIT
