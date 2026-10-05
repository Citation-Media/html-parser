---
description: Streaming HTML parser for Cloudflare Workers, published as @citation-media/html-parser.
citation:
  repository_kind: single
  customer: internal
---

# Agent Instructions

This repository maintains `@citation-media/html-parser`, a library that extracts links, images, resources, metadata, headings, class counts, JSON-LD, styles, hydration, visible text, and inline code from HTML in one pass with mdream's tokenizer, without a DOM, in any JavaScript runtime, and cleans HTML. Converting HTML to Markdown is mdream's job; `parseHtml` only hands it the same input. Everything it needs is in this repository; keep it that way, since the repository and the npm package are public.

## Runtime

- `parseHtml` runs in any JavaScript runtime on `@mdream/js`, a peer dependency. `src/engine.ts` drives its tokenizer and tunes its state so whitespace and CSS stay as written; mdream's Markdown converter runs unchanged. Pin the versions the parity of these tunings is tested with.
- `cleanHtml` runs where `HTMLRewriter` is a global: Cloudflare Workers and their local runtime. HTMLRewriter elements are not DOM nodes: attributes are readable only inside the element handler, void elements throw on `onEndTag`, and text arrives in chunks with entities still encoded.
- Tests run in workerd through `@cloudflare/vitest-pool-workers` and in Node; the `cleanHtml` tests only in workerd.
- Keep the public API stable: link kinds, counts, and filters; images with missing (`null`) versus empty (`""`) alt texts; the cleaning options. A breaking change needs a major version, or a minor version before 1.0.

## Checks

- `npm run check` runs Oxlint and Oxfmt through Ultracite plus the type check; `npm run fix` applies fixes. `quality-ignore.ts` holds shared exclusions.
- `npm test` runs the Vitest suite in the Workers runtime; `npm run build` compiles to `dist`.

## Documentation And Releases

- `README.md` documents installation, the API, options, and limitations; update it with every change to the public API.
- `CHANGELOG.md` gets a section per release. Bump `version` in `package.json` with it, then push a matching `v*` tag: `.github/workflows/release.yml` publishes to npm through trusted publishing with provenance and creates the GitHub release.
