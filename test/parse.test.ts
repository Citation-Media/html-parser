import { describe, expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://example.com/";

const sample = `
  <html lang="de">
    <head>
      <title>Beispiel &amp; Co.</title>
      <meta name="description" content="Wir bauen Websites.">
      <link rel="canonical" href="/start">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="/app.js"></script>
      <script type="text/plain" data-cookieconsent="marketing" src="https://www.googletagmanager.com/gtm.js"></script>
    </head>
    <body>
      <a href="https://example.com">Example</a>
      <a href="/relative-link">Relative Link</a>
      <a>Invalid Link</a>
      <img src="https://example.com/image.png" alt="Example Image" />
      <img src="/relative-image.png" alt="Relative Image" />
      <img alt="Invalid Image" />
      <a href="https://example.com">Example</a>
      <img src="https://example.com/image.png" alt="Example Image" />
      <a href="https://example-image.com"><img src="https://example.com/image1.png" alt="Example Image" /></a>
      <iframe src="https://www.youtube.com/embed/x"></iframe>
    </body>
  </html>`;

describe("links", () => {
  test("deduplicates, counts, resolves, and sorts by count", async () => {
    const { links } = await parseHtml(sample, { links: true, url });
    expect(
      links?.map(({ count, text, url: href }) => ({ count, href, text }))
    ).toEqual([
      { count: 2, href: "https://example.com/", text: "Example" },
      {
        count: 1,
        href: "https://example.com/relative-link",
        text: "Relative Link",
      },
      { count: 1, href: "https://example-image.com/", text: "" },
    ]);
  });

  test("classifies links and filters by kind and downloads", async () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://shop.example.com/">Shop</a>
      <a href="https://other.org/">Other</a>
      <a href="/files/price-list.PDF">Prices</a>
      <a href="#top">Top</a>
      <a href="mail:Team@Example.com">Mail</a>
      <a href="MAILTO:TEAM@EXAMPLE.COM">Mail again</a>
      <a href="tel:+49211123">Call</a>`;
    const { links } = await parseHtml(html, { links: true, url });
    const kinds = Object.fromEntries(
      links?.map(({ kind, url: href }) => [href, kind]) ?? []
    );
    expect(kinds).toMatchObject({
      "https://example.com/about": "internal",
      "https://example.com/files/price-list.PDF": "internal",
      "https://other.org/": "external",
      "https://shop.example.com/": "internal",
      "mailto:team@example.com": "special",
      "tel:+49211123": "special",
    });
    expect(
      links?.find(({ url: href }) => href.startsWith("mailto:"))?.count
    ).toBe(2);
    expect(links?.find(({ url: href }) => href.endsWith("#top"))?.kind).toBe(
      "anchor"
    );

    const external = await parseHtml(html, {
      links: { kinds: ["external"] },
      url,
    });
    expect(external.links?.map(({ url: href }) => href)).toEqual([
      "https://other.org/",
    ]);
    const pages = await parseHtml(html, {
      links: { kinds: ["internal"], resources: false },
      url,
    });
    expect(pages.links?.map(({ url: href }) => href)).not.toContain(
      "https://example.com/files/price-list.PDF"
    );
  });

  test("keeps the case of paths, which servers treat as case-sensitive", async () => {
    const { links } = await parseHtml(
      '<a href="/Downloads/Flyer.pdf">Flyer</a>',
      {
        links: true,
        url: "https://Example.com/",
      }
    );
    expect(links?.[0]?.url).toBe("https://example.com/Downloads/Flyer.pdf");
    expect(links?.[0]?.resource).toBe(true);
  });

  test("skips Cloudflare's e-mail obfuscation links and keeps labels and targets", async () => {
    const { links } = await parseHtml(
      '<a href="/cdn-cgi/l/email-protection#abc">[email&#160;protected]</a><a href="https://x.org" target="_blank" rel="noopener" aria-label="X öffnen"><svg></svg></a>',
      { links: true, url }
    );
    expect(links).toEqual([
      {
        count: 1,
        kind: "external",
        label: "X öffnen",
        rel: "noopener",
        resource: false,
        target: "_blank",
        text: "",
        url: "https://x.org/",
      },
    ]);
  });
});

describe("images", () => {
  test("deduplicates, resolves, and tells missing from empty alt texts", async () => {
    const { images } = await parseHtml(
      `${sample}<img src="/deco.svg" alt=""><img src="/photo.jpg" width="800" height="600" loading="lazy" srcset="/photo-2x.jpg 2x">`,
      { images: true, url }
    );
    expect(images?.map(({ alt, url: src }) => [src, alt])).toEqual([
      ["https://example.com/image.png", "Example Image"],
      ["https://example.com/relative-image.png", "Relative Image"],
      ["https://example.com/image1.png", "Example Image"],
      ["https://example.com/deco.svg", ""],
      ["https://example.com/photo.jpg", null],
    ]);
    expect(images?.at(-1)).toMatchObject({
      height: "600",
      loading: "lazy",
      srcset: true,
      width: "800",
    });
  });
});

describe("resources and meta", () => {
  test("lists scripts with their attributes, frames, and link elements", async () => {
    const { resources } = await parseHtml(sample, { resources: true, url });
    expect(resources?.scripts).toEqual([
      {
        attributes: ["src"],
        src: "https://example.com/app.js",
        type: undefined,
      },
      {
        attributes: ["type", "data-cookieconsent", "src"],
        src: "https://www.googletagmanager.com/gtm.js",
        type: "text/plain",
      },
    ]);
    expect(resources?.frames).toEqual(["https://www.youtube.com/embed/x"]);
    expect(resources?.links.map(({ rel }) => rel)).toEqual([
      "canonical",
      "stylesheet",
    ]);
  });

  test("reads title, description, language, and canonical URL", async () => {
    const { meta } = await parseHtml(sample, { meta: true, url });
    expect(meta).toMatchObject({
      canonical: "https://example.com/start",
      description: "Wir bauen Websites.",
      language: "de",
      title: "Beispiel & Co.",
    });
  });

  test("counts elements by class prefix, such as page builders", async () => {
    const { classCounts } = await parseHtml(
      '<div class="brxe-section"><div class="x brxe-block"></div><p class="wp-block-paragraph"></p><span class="noelementor-x"></span></div>',
      { classPrefixes: ["brxe-", "wp-block-", "elementor-"], url }
    );
    expect(classCounts).toEqual({
      "brxe-": 2,
      "elementor-": 0,
      "wp-block-": 1,
    });
  });
});

describe("context", () => {
  const sections = `
    <header><a href="/header-link">Header Link</a><img src="/header.png" alt="Header"></header>
    <main class="content">
      <article id="article1"><h1>Article 1</h1><a href="/article1-link">Article 1 Link</a><img src="/article1.png" alt="Article 1 Image"></article>
      <article id="article2"><h1>Article 2</h1><a href="/article2-link">Article 2 Link</a><img src="/article2.png" alt="Article 2 Image"></article>
    </main>
    <footer><a href="/footer-link">Footer Link</a></footer>`;

  test("collects only inside matching elements", async () => {
    const one = await parseHtml(sections, {
      context: "#article1",
      images: true,
      links: true,
      url,
    });
    expect(one.links?.map(({ url: href }) => href)).toEqual([
      "https://example.com/article1-link",
    ]);
    expect(one.images?.map(({ alt }) => alt)).toEqual(["Article 1 Image"]);
    const both = await parseHtml(sections, {
      context: "article",
      headings: true,
      links: true,
      url,
    });
    expect(both.links).toHaveLength(2);
    expect(both.headings?.map(({ text }) => text)).toEqual([
      "Article 1",
      "Article 2",
    ]);
  });

  test("counts headings per level beyond the list's limit", async () => {
    const html = `<h1>A</h1>${"<h2>x</h2>".repeat(300)}<h1>B</h1>`;
    const { headings, headingCounts } = await parseHtml(html, {
      headings: true,
      url,
    });
    expect(headings).toHaveLength(200);
    expect(headingCounts).toEqual([2, 300, 0, 0, 0, 0]);
  });

  test("falls back to the whole page when nothing matches", async () => {
    const { links } = await parseHtml(sections, {
      context: ".missing",
      links: true,
      url,
    });
    expect(links).toHaveLength(4);
  });
});
