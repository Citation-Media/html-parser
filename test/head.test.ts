import { describe, expect, test } from "vitest";

import { parseHtmlSync } from "../src/index.ts";

const url = "https://firma.de/";

const headOf = (
  html: string,
  rules?: Parameters<typeof parseHtmlSync>[1]["head"]
) => {
  const { head } = parseHtmlSync(html, { head: rules ?? true, url });
  if (!head) {
    throw new Error("head was asked for");
  }
  return head;
};

const rulesOf = (html: string) => headOf(html).issues.map(({ rule }) => rule);

describe("head elements", () => {
  test("lists the head's elements in page order, with sizes and the title's text", () => {
    const css = ".a { color: red }\n";
    const { elements } = headOf(`<html><head>
      <title> Firma &amp; Co. </title>
      <meta charset="utf-8">
      <link rel="stylesheet" href="/a.css">
      <style>${css}</style>
      <script>console.log("ü")</script>
      <noscript><img src="/pixel.gif"></noscript>
      </head><body><svg><title>Icon</title></svg><script src="/late.js"></script></body></html>`);
    expect(elements.map(({ tag }) => tag)).toEqual([
      "title",
      "meta",
      "link",
      "style",
      "script",
      "noscript",
    ]);
    expect(elements[0]).toMatchObject({ text: "Firma & Co.", weight: 10 });
    expect(elements[1]).toMatchObject({
      attributes: { charset: "utf-8" },
      weight: -20,
    });
    expect(elements[3]?.size).toBe(css.length);
    expect(elements[4]?.size).toBe(
      new TextEncoder().encode('console.log("ü")').byteLength
    );
  });

  test("ends the head where body content starts", () => {
    const { elements } = headOf(
      '<head><meta name="viewport" content="width=device-width"><p>Text</p><link rel="stylesheet" href="/b.css">'
    );
    expect(elements.map(({ tag }) => tag)).toEqual(["meta"]);
  });

  test("weighs elements by Capo, so a misplaced one shows", () => {
    const { elements } = headOf(`<head>
      <script src="/sync.js"></script>
      <meta charset="utf-8">
      <link rel="preconnect" href="https://cdn.example.com">
      <script async src="/async.js"></script>
      <script defer src="/defer.js"></script>
      <link rel="prefetch" href="/next">
    </head>`);
    expect(elements.map(({ weight }) => weight)).toEqual([
      50, -20, 20, 30, 80, 90,
    ]);
  });
});

describe("head issues", () => {
  test("names render-blocking scripts, but not async, deferred, or module scripts", () => {
    const { elements, issues } =
      headOf(`<head><meta charset="utf-8"><title>T</title>
      <meta name="description" content="D">
      <script src="/blocking.js"></script>
      <script async src="/async.js"></script>
      <script defer src="/defer.js"></script>
      <script type="module" src="/module.js"></script>
    </head>`);
    const blocking = issues.filter(
      ({ rule }) => rule === "render-blocking-script"
    );
    expect(
      blocking.map(({ element }) => elements[element ?? -1]?.attributes.src)
    ).toEqual(["/blocking.js"]);
  });

  test("reads the page's order, so a late charset counts", () => {
    const filler = Array.from(
      { length: 5 },
      (_, index) => `<link rel="stylesheet" href="/${index}.css">`
    ).join("");
    expect(
      rulesOf(`<head><title>T</title>${filler}<meta charset="utf-8"></head>`)
    ).toContain("charset-not-early");
    expect(
      rulesOf(`<head><meta charset="utf-8"><title>T</title>${filler}</head>`)
    ).not.toContain("charset-not-early");
  });

  test("finds resource hints and meta problems with unhead's rules", () => {
    const preloads = Array.from(
      { length: 8 },
      (_, index) => `<link rel="preload" as="image" href="/${index}.jpg">`
    ).join("");
    const rules = rulesOf(`<head><meta charset="utf-8"><title>Firma</title>
      <meta name="viewport" content="width=device-width, user-scalable=no">
      <meta name="description" content="">
      <link rel="canonical" href="/start">
      <link rel="preload" href="/font.woff2" as="font">
      ${preloads}
    </head>`);
    for (const rule of [
      "viewport-user-scalable",
      "empty-meta-content",
      "non-absolute-canonical",
      "preload-font-crossorigin",
      "too-many-preloads",
    ]) {
      expect(rules).toContain(rule);
    }
  });

  test("leaves out rules about unhead's own API", () => {
    expect(
      rulesOf(
        '<html class="dark"><head><meta charset="utf-8"><title>T</title><meta name="description" content="D"></head></html>'
      )
    ).toEqual([]);
  });

  test("takes unhead's rule configuration", () => {
    const preloads = Array.from(
      { length: 8 },
      (_, index) => `<link rel="preload" as="image" href="/${index}.jpg">`
    ).join("");
    const html = `<head><meta charset="utf-8"><title>T</title><meta name="description" content="D">${preloads}</head>`;
    expect(rulesOf(html)).toContain("too-many-preloads");
    expect(
      headOf(html, { rules: { "too-many-preloads": ["warn", { max: 10 }] } })
        .issues
    ).toEqual([]);
    expect(
      headOf(html, { rules: { "too-many-preloads": "off" } }).issues
    ).toEqual([]);
  });

  test("leaves the head out unless asked for", () => {
    expect(
      parseHtmlSync("<head><title>T</title></head>", { url })
    ).not.toHaveProperty("head");
  });
});
