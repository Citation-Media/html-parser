---
description: Streaming HTML parser for Cloudflare Workers, published as @citation-media/html-parser.
citation:
  repository_kind: single
  customer: internal
---

# Agent Instructions

This repository maintains `@citation-media/html-parser`, a library that extracts links, images, resources, metadata, and Markdown from HTML in one HTMLRewriter pass, without a DOM, for Cloudflare Workers. Everything it needs is in this repository; keep it that way, since the repository and the npm package are public.

## Runtime

- The package runs where `HTMLRewriter` is a global: Cloudflare Workers and their local runtime. Tests run inside workerd through `@cloudflare/vitest-pool-workers`, not in Node.
- HTMLRewriter elements are not DOM nodes: attributes are readable only inside the element handler, void elements throw on `onEndTag`, and text arrives in chunks with entities still encoded.
- Keep the public API stable: link kinds, counts, and filters; images with missing (`null`) versus empty (`""`) alt texts; the cleaning options. A breaking change needs a major version.

## Checks

- `npm run check` runs Oxlint and Oxfmt through Ultracite plus the type check; `npm run fix` applies fixes. `quality-ignore.ts` holds shared exclusions.
- `npm test` runs the Vitest suite in the Workers runtime; `npm run build` compiles to `dist`.

## Documentation And Releases

- `README.md` documents installation, the API, options, and limitations; update it with every change to the public API.
- `CHANGELOG.md` gets a section per release. Bump `version` in `package.json` with it, then push a matching `v*` tag: `.github/workflows/release.yml` publishes to npm through trusted publishing with provenance and creates the GitHub release.
