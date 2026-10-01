import { describe, expect, test } from "vitest";

import { parseHtml, readStructuredData } from "../src/index.ts";

const url = "https://example.com/blog/post/";

const page = (...blocks: string[]) =>
  `<html><head>${blocks
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join("")}</head><body><p>Text</p></body></html>`;

describe("structured data", () => {
  test("reads every JSON-LD block, with lists and @graph expanded", async () => {
    const html = page(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        author: { "@type": "Person", name: "Justin Vogt" },
        headline: "Debug-Log",
      }),
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "#org", "@type": "Organization", name: "Citation Media" },
          { "@id": "#site", "@type": "WebSite", url: "https://example.com/" },
        ],
      }),
      JSON.stringify([{ "@type": "BreadcrumbList" }, "not a node"])
    );
    const { structuredData } = await parseHtml(html, {
      structuredData: true,
      url,
    });
    expect(structuredData?.invalid).toEqual([]);
    expect(structuredData?.items.map((item) => item["@type"])).toEqual([
      "BlogPosting",
      "Organization",
      "WebSite",
      "BreadcrumbList",
    ]);
    // The graph's context applies to each of its nodes.
    expect(structuredData?.items[1]?.["@context"]).toBe("https://schema.org");
  });

  test("names broken blocks and keeps reading the rest", async () => {
    const { structuredData } = await parseHtml(
      page('{"@type": "Product", "name": "Tisch",}', '{"@type": "Offer"}'),
      { structuredData: true, url }
    );
    expect(structuredData?.items).toEqual([{ "@type": "Offer" }]);
    expect(structuredData?.invalid).toHaveLength(1);
    expect(structuredData?.invalid[0]?.index).toBe(0);
  });

  test("accepts type parameters, any case, and comment or CDATA wrappers", async () => {
    const html = `<html><body>
      <script type="Application/LD+JSON; charset=utf-8"><!-- {"@type": "Event"} --></script>
      <script type="application/ld+json">/* <![CDATA[ */ {"@type": "Recipe"} /* ]]> */</script>
      <script type="text/plain">{"@type": "Ignored"}</script>
      <script>{"@type": "AlsoIgnored"}</script>
    </body></html>`;
    const { structuredData } = await parseHtml(html, {
      structuredData: true,
      url,
    });
    expect(structuredData?.items.map((item) => item["@type"])).toEqual([
      "Event",
      "Recipe",
    ]);
  });

  test("reads blocks outside the context and only when asked", async () => {
    const html = page('{"@type": "Organization"}');
    const inMain = await parseHtml(`${html}<main><p>x</p></main>`, {
      context: "main",
      structuredData: true,
      url,
    });
    expect(inMain.structuredData?.items).toHaveLength(1);
    const without = await parseHtml(html, { meta: true, url });
    expect(without.structuredData).toBeUndefined();
  });

  test("reads a long block that streams in several chunks", async () => {
    // Long enough that HTMLRewriter hands the script's text over in several pieces.
    const description = "Wort ".repeat(40_000);
    const { structuredData } = await parseHtml(
      page(JSON.stringify({ "@type": "Article", description })),
      { structuredData: true, url }
    );
    expect(structuredData?.invalid).toEqual([]);
    expect(structuredData?.items[0]?.["description"]).toBe(description);
  });

  test("leaves out empty blocks", () => {
    expect(readStructuredData(["", "  "])).toEqual({ invalid: [], items: [] });
  });
});
