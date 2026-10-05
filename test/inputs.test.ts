import { describe, expect, test } from "vitest";

import { parseHtml, parseHtmlSync } from "../src/index.ts";
import type { ParseOptions } from "../src/index.ts";

const url = "https://example.com/";

const page = `<!doctype html><html lang="de"><head><title>Grüße</title>
  <script type="application/ld+json">{"@type":"Organization","name":"Müller & Söhne"}</script>
  <style>.hero { color: #06417a }</style></head>
  <body><main><h1>Willkommen bei Müller</h1><a href="/über-uns">Über uns</a>
  <img src="/bild.jpg" alt="Team"><astro-island uid="a" props="{}" client="load"></astro-island>
  <script>self.__next_f = []</script></main></body></html>`;

const options: ParseOptions = {
  headings: true,
  hydration: true,
  images: true,
  inlineCode: true,
  links: true,
  meta: true,
  positions: true,
  resources: true,
  structuredData: true,
  styles: true,
  text: true,
  url,
};

/** The page as a stream of byte chunks of `size`, which split characters such as ü. */
const chunked = (html: string, size: number) => {
  const bytes = new TextEncoder().encode(html);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += size) {
        controller.enqueue(bytes.slice(index, index + size));
      }
      controller.close();
    },
  });
};

describe("inputs", () => {
  test("reads text, responses, and streams alike, however they are chunked", async () => {
    const expected = parseHtmlSync(page, options);
    expect(await parseHtml(page, options)).toEqual(expected);
    expect(
      await parseHtml(
        new Response(page, { headers: { "content-type": "text/html" } }),
        options
      )
    ).toEqual(expected);
    const results = await Promise.all(
      [1, 3, 7, 64].map((size) => parseHtml(chunked(page, size), options))
    );
    for (const result of results) {
      expect(result).toEqual(expected);
    }
  });

  test("reads a stream of strings", async () => {
    const parts = page.match(/[\s\S]{1,5}/gu) ?? [];
    const stream = new ReadableStream<string>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });
    expect(await parseHtml(stream, options)).toEqual(
      parseHtmlSync(page, options)
    );
  });

  test("returns empty results for an empty page or body", async () => {
    const empty = {
      headingCounts: [0, 0, 0, 0, 0, 0],
      headings: [],
      links: [],
    };
    expect(parseHtmlSync("", { headings: true, links: true, url })).toEqual(
      empty
    );
    expect(
      await parseHtml(new Response(null), { headings: true, links: true, url })
    ).toEqual(empty);
  });

  test("falls back to the whole page when a streamed page's context matches nothing", async () => {
    const html =
      '<header><a href="/a">A</a></header><div><a href="/b">B</a></div>';
    const { links } = await parseHtml(chunked(html, 4), {
      context: "main",
      links: true,
      url,
    });
    expect(links?.map(({ text }) => text)).toEqual(["A", "B"]);
  });

  test("closes elements the page leaves open", () => {
    const { headings, links } = parseHtmlSync('<h2>Offen <a href="/x">Link', {
      headings: true,
      links: true,
      url,
    });
    expect(links?.map(({ text }) => text)).toEqual(["Link"]);
    expect(headings).toEqual([{ level: 2, text: "Offen Link" }]);
  });

  test("ends implicitly closed elements where a browser does", () => {
    const { text } = parseHtmlSync("<ul><li>Eins<li>Zwei<li>Drei</ul>", {
      context: "li:first-child",
      text: true,
      url,
    });
    expect(text?.content).toBe("Eins");
  });
});
