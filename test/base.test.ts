import { describe, expect, test } from "vitest";

import { parseHtml, parseHtmlSync } from "../src/index.ts";

const url = "https://firma.de/leistungen/web/";

const page = `<html><head>
  <link rel="stylesheet" href="before.css">
  <base href="/" target="_blank"><base href="https://ignored.example/">
  <link rel="canonical" href="leistungen/web/">
  <meta property="og:image" content="img/og.jpg">
  </head><body>
  <a href="kontakt/">Kontakt</a><a href="#team">Team</a><a href="https://other.org/">Other</a>
  <img src="img/logo.svg" alt="Logo" srcset="img/logo-2x.png 2x">
  <form><input name="q"></form><form action="suche/"></form>
  </body></html>`;

describe("base", () => {
  test("resolves the URLs after a <base href> against it, as a browser does", () => {
    const { forms, images, links, meta, resources } = parseHtmlSync(page, {
      forms: true,
      images: true,
      links: true,
      meta: true,
      resources: true,
      url,
    });
    expect(resources?.links.map(({ href }) => href)).toEqual([
      "https://firma.de/leistungen/web/before.css",
      "https://firma.de/leistungen/web/",
    ]);
    expect(meta).toMatchObject({
      canonical: "https://firma.de/leistungen/web/",
      image: "https://firma.de/img/og.jpg",
    });
    expect(images?.[0]).toMatchObject({
      sources: ["https://firma.de/img/logo-2x.png"],
      url: "https://firma.de/img/logo.svg",
    });
    // A fragment under a base elsewhere leaves the page; a form without action stays on it.
    expect(links?.map(({ kind, url: href }) => [href, kind])).toEqual([
      ["https://firma.de/kontakt/", "internal"],
      ["https://firma.de/#team", "internal"],
      ["https://other.org/", "external"],
    ]);
    expect(forms?.map(({ action }) => action)).toEqual([
      "https://firma.de/leistungen/web/",
      "https://firma.de/suche/",
    ]);
  });

  test("judges the site by the page, not by a base on another host", () => {
    const { links } = parseHtmlSync(
      '<head><base href="https://cdn.example.net/assets/"></head><a href="a.pdf">A</a><a href="https://firma.de/b">B</a>',
      { links: true, url }
    );
    expect(links?.map(({ kind, url: href }) => [href, kind])).toEqual([
      ["https://cdn.example.net/assets/a.pdf", "external"],
      ["https://firma.de/b", "internal"],
    ]);
  });

  test("ignores a base without href, one that is no URL, and one after the content began", () => {
    const pages = [
      '<head><base target="_blank"></head><a href="x">X</a>',
      '<head><base href="https://"></head><a href="x">X</a>',
      '<p>Text</p><base href="/"><a href="x">X</a>',
    ];
    for (const html of pages) {
      const { links } = parseHtmlSync(html, { links: true, url });
      expect(links?.[0]?.url).toBe("https://firma.de/leistungen/web/x");
    }
  });

  test("writes the Markdown's URLs against the base, for text and streams alike", async () => {
    const expected = "[Kontakt](https://firma.de/kontakt/)";
    const sync = parseHtmlSync(page, { markdown: true, url });
    expect(sync.markdown).toContain(expected);
    const bytes = new TextEncoder().encode(page);
    const results = await Promise.all(
      [1, 16, 4096].map((size) =>
        parseHtml(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let index = 0; index < bytes.length; index += size) {
                controller.enqueue(bytes.slice(index, index + size));
              }
              controller.close();
            },
          }),
          { markdown: true, url }
        )
      )
    );
    for (const result of results) {
      expect(result.markdown).toBe(sync.markdown);
    }
    const { markdown } = parseHtmlSync(page, {
      markdown: { origin: "https://cdn.example.net/" },
      url,
    });
    expect(markdown).toContain("[Kontakt](https://cdn.example.net/kontakt/)");
  });
});
