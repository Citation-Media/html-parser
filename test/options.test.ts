import { describe, expect, test } from "vitest";

import { parseHtml, parseHtmlSync } from "../src/index.ts";

const url = "https://firma.de/";

describe("scripts", () => {
  test("tells scripts in the head from those in the body, as served", async () => {
    const html = `<html><head>
      <script src="/js/jquery.min.js?ver=3.7.1"></script>
      <script src='https://js.hs-scripts.com/123.js' type="text/javascript"></script>
      <script async src="/a.js"></script>
      <script defer src="/b.js"></script>
      <script type="module" src="/c.js"></script>
      <script nomodule src="/legacy.js"></script>
      <script type="text/plain" data-cookieconsent="marketing" src="/parked.js"></script>
      <!-- <script src="/commented.js"></script> -->
      <script>inline()</script>
    </head><body><script src="/late.js"></script></body></html>`;
    const { resources } = await parseHtml(html, { resources: true, url });
    const scripts = resources?.scripts ?? [];
    expect(scripts.map(({ src }) => src)).not.toContain(
      "https://firma.de/commented.js"
    );
    expect(
      scripts.map(({ attributes, head, src, type }) => ({
        attributes,
        head,
        src,
        type,
      }))
    ).toEqual([
      {
        attributes: ["src"],
        head: true,
        src: "https://firma.de/js/jquery.min.js?ver=3.7.1",
        type: undefined,
      },
      {
        attributes: ["src", "type"],
        head: true,
        src: "https://js.hs-scripts.com/123.js",
        type: "text/javascript",
      },
      {
        attributes: ["async", "src"],
        head: true,
        src: "https://firma.de/a.js",
        type: undefined,
      },
      {
        attributes: ["defer", "src"],
        head: true,
        src: "https://firma.de/b.js",
        type: undefined,
      },
      {
        attributes: ["type", "src"],
        head: true,
        src: "https://firma.de/c.js",
        type: "module",
      },
      {
        attributes: ["nomodule", "src"],
        head: true,
        src: "https://firma.de/legacy.js",
        type: undefined,
      },
      {
        attributes: ["type", "data-cookieconsent", "src"],
        head: true,
        src: "https://firma.de/parked.js",
        type: "text/plain",
      },
      { attributes: [], head: true, src: undefined, type: undefined },
      {
        attributes: ["src"],
        head: false,
        src: "https://firma.de/late.js",
        type: undefined,
      },
    ]);
  });

  test("ends the head where body content starts, as a browser does", async () => {
    const { resources } = await parseHtml(
      '<head><script src="/a.js"></script><p>Text</p><script src="/b.js"></script>',
      { resources: true, url }
    );
    expect(resources?.scripts.map(({ head }) => head)).toEqual([true, false]);
  });
});

describe("inline code", () => {
  test("counts what a Content Security Policy has to allow", async () => {
    const { inlineCode } = await parseHtml(
      [
        "<script>console.log(1)</script>",
        '<script type="application/ld+json">{"@type":"Organization"}</script>',
        '<script type="importmap">{"imports":{}}</script>',
        '<script type="text/template"><p>x</p></script>',
        '<script src="/app.js"></script>',
        '<script type="module">import "/m.js";</script>',
        "<script>   </script>",
        '<button onclick="go()" onmouseover="hover()">Los</button>',
        '<a href="javascript:void(0)">x</a><a href=" JavaScript:alert(1)">y</a>',
        '<div style="color:red">rot</div><span style=" "></span><style>p{}</style>',
        '<form action="https://forms.example.com/send"></form>',
        '<form action="/kontakt"></form><form action="/kontakt"></form><form></form>',
      ].join(""),
      { inlineCode: true, url }
    );
    expect(inlineCode).toEqual({
      eventHandlers: 2,
      formActions: [
        "https://forms.example.com/send",
        "https://firma.de/kontakt",
      ],
      javascriptUrls: 2,
      scripts: ["console.log(1)", 'import "/m.js";'],
      styleAttributes: 1,
      styleElements: 1,
    });
  });

  test("keeps an inline script exactly as written, for its hash", async () => {
    const body = '\n  var a = "x  y";\n  if (a < b && c) {}\n';
    const { inlineCode } = await parseHtml(`<script>${body}</script>`, {
      inlineCode: true,
      url,
    });
    expect(inlineCode?.scripts).toEqual([body]);
  });

  test("leaves inline code out unless asked for", async () => {
    expect(await parseHtml("<script>x()</script>", { url })).not.toHaveProperty(
      "inlineCode"
    );
  });
});

describe("visible text", () => {
  const paragraph = `<p>${"Wir beraten Unternehmen in Köln zu Websites und Software. ".repeat(12)}</p>`;

  test("reads the text a visitor sees, without head, scripts, styles, templates, and SVG", async () => {
    const { text } = await parseHtml(
      `<html><head><title>Titel</title><style>p { color: red }</style></head>
      <body><nav><a href="/">Start</a></nav><h1>Websites   aus&nbsp;Köln</h1>
      <p>Wir <strong>bauen</strong> sie.<br>Seit 2010.</p>
      <script>var hidden = 1;</script><noscript>Bitte JavaScript aktivieren</noscript>
      <template><p>Vorlage</p></template><svg><title>Icon</title></svg>
      <ul><li>Beratung</li><li>Umsetzung</li></ul></body></html>`,
      { text: true, url }
    );
    expect(text?.content).toBe(
      "Start Websites aus Köln Wir bauen sie. Seit 2010. Beratung Umsetzung"
    );
    expect(text?.length).toBe(text?.content.length);
  });

  test("leaves out a title outside a head, as in a fragment", () => {
    const { text } = parseHtmlSync("<title>Titel</title><p>Inhalt</p>", {
      text: true,
      url,
    });
    expect(text?.content).toBe("Inhalt");
  });

  test("tells a server-rendered page from an app shell by its text", async () => {
    const page = await parseHtml(
      `<html><body><main>${paragraph}</main><script src="/app.js"></script></body></html>`,
      { text: true, url }
    );
    const shell = await parseHtml(
      '<html><body><div id="root"></div><script src="/app.js"></script></body></html>',
      { text: true, url }
    );
    expect(page.text?.length).toBeGreaterThan(500);
    expect(shell.text).toEqual({ content: "", length: 0 });
  });

  test("cuts the content but counts the whole text", async () => {
    const { text } = await parseHtml(`<p>${"Wort ".repeat(1000)}</p>`, {
      text: { maxLength: 20 },
      url,
    });
    expect(text?.content).toBe("Wort Wort Wort Wort ".trimEnd());
    expect(text?.length).toBe(4999);
  });

  test("reads only the context's text", async () => {
    const { text } = await parseHtml(
      "<header>Menü</header><main><h1>Impressum</h1><p>Muster GmbH</p></main><footer>Newsletter</footer>",
      { context: "main", text: true, url }
    );
    expect(text?.content).toBe("Impressum Muster GmbH");
  });
});

describe("texts as a DOM reads them", () => {
  test("keeps the space between inline elements and after graphics", async () => {
    const { headings, links } = await parseHtml(
      `<a href="/x"><h3><span><svg role="img"><title>Play</title></svg>
        </span>
        <span>Medizin-Nobelpreis</span></h3></a>
       <a href="/y">a<span> </span>b</a>`,
      { headings: true, links: true, url }
    );
    expect(links?.map(({ text }) => text)).toEqual([
      "Play Medizin-Nobelpreis",
      "a b",
    ]);
    expect(headings).toEqual([{ level: 3, text: "Play Medizin-Nobelpreis" }]);
  });

  test("takes the document's first title, not an SVG's", async () => {
    const { meta } = await parseHtml(
      `<html><head><title>Firma &amp; Co.</title><title>Zweiter</title></head>
       <body><svg><title>Pfeil runter</title></svg></body></html>`,
      { meta: true, url }
    );
    expect(meta?.title).toBe("Firma & Co.");
    const { meta: none } = await parseHtml(
      "<body><svg><title>Logo</title></svg></body>",
      { meta: true, url }
    );
    expect(none?.title).toBeUndefined();
  });

  test("decodes each entity once", async () => {
    const { links } = await parseHtml(
      '<a href="/a?x=1&amp;amp;y=2">&amp;lt;b&amp;gt; &lt;b&gt;</a>',
      { links: true, url }
    );
    expect(links?.[0]).toMatchObject({
      text: "&lt;b&gt; <b>",
      url: "https://firma.de/a?x=1&amp;y=2",
    });
  });

  test("keeps CSS exactly as written", async () => {
    const css =
      '\n  :root {\n    --brand: #06417a;\n  }\n  .a::before { content: "a  b" }\n';
    const { styles } = await parseHtml(`<style>${css}</style>`, {
      styles: true,
      url,
    });
    expect(styles?.blocks).toEqual([{ css }]);
  });
});

describe("markdown", () => {
  const page = `<html><head><title>Firma</title></head><body>
    <nav><a href="/leistungen">Leistungen</a></nav>
    <main><h1>Websites aus Köln</h1><p>Wir bauen <a href="/web">Websites</a> und <strong>Shops</strong>.</p>
    <ul><li>Beratung</li><li>Umsetzung</li></ul></main>
    <div role="dialog">Wir nutzen Cookies</div>
    <script>window.x = 1;</script><footer>Tel. 0211 123</footer></body></html>`;

  test("writes the page as Markdown from the same input", async () => {
    const { links, markdown } = await parseHtml(page, {
      links: true,
      markdown: true,
      url,
    });
    expect(markdown).toMatch(/^# Websites aus Köln$/mu);
    expect(markdown).toMatch(/\[Websites\]\(https:\/\/firma\.de\/web\)/u);
    expect(links).toHaveLength(2);
  });

  test("passes mdream's options; its filters shape only the Markdown", async () => {
    const { links, markdown, text } = await parseHtml(page, {
      links: true,
      markdown: {
        plugins: {
          filter: { exclude: ["script", "[role='dialog']"] },
          isolateMain: true,
        },
      },
      text: true,
      url,
    });
    expect(markdown).toMatch(/Wir bauen/u);
    for (const gone of ["Leistungen", "Cookies", "window.x", "Tel."]) {
      expect(markdown).not.toContain(gone);
    }
    expect(links?.map(({ text: linkText }) => linkText)).toEqual([
      "Leistungen",
      "Websites",
    ]);
    expect(text?.content).toContain("Wir nutzen Cookies");
  });

  test("reads a response once for the facts and the Markdown", async () => {
    const response = new Response(page, {
      headers: { "content-type": "text/html" },
    });
    const result = await parseHtml(response, {
      headings: true,
      markdown: true,
      url,
    });
    expect(result.headings).toEqual([{ level: 1, text: "Websites aus Köln" }]);
    expect(result.markdown).toBe(
      parseHtmlSync(page, { markdown: true, url }).markdown
    );
  });

  test("leaves the Markdown out unless asked for", async () => {
    expect(await parseHtml(page, { url })).not.toHaveProperty("markdown");
  });
});
