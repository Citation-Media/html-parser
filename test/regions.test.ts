import { expect, test } from "vitest";

import {
  consentSelectors,
  parseHtml,
  parseHtmlSync,
  regionOf,
} from "../src/index.ts";

const url = "https://firma.de/";

const page = `<body>
  <div id="masthead"><a href="/"><img src="/logo.svg" alt="Firma"></a>
    <nav><ul><li><a href="/leistungen">Leistungen</a></li><li><a href="/kontakt">Kontakt</a></li></ul></nav>
    <form role="search" action="/suche"><input name="s"></form></div>
  <main>
    <article><header><h1>Webdesign</h1><a href="/autor">Anna Muster</a></header>
      <p>Wir bauen <b>schnelle</b> Websites. <a href="/kontakt">Schreiben Sie uns</a>.</p>
      <img src="/team.jpg" alt="Team"><img src="/logo.svg" alt="Firma">
      <footer><p>Veröffentlicht im Mai</p></footer></article>
    <nav aria-label="Inhalt"><a href="#ablauf">Ablauf</a></nav>
    <aside><h2>Verwandt</h2></aside>
  </main>
  <aside id="secondary"><h2>Neueste Beiträge</h2></aside>
  <footer class="site-footer"><h2>Firma GmbH</h2><a href="/impressum">Impressum</a></footer>
</body>`;

test("tells the regions of links, images, headings, forms, and selected elements", () => {
  const parsed = parseHtmlSync(page, {
    forms: true,
    headings: true,
    images: true,
    links: true,
    regions: true,
    select: { paragraphs: "p" },
    url,
  });
  const links = Object.fromEntries(
    (parsed.links ?? []).map(({ chrome, region, url: href }) => [
      href,
      { chrome, region },
    ])
  );
  expect(links).toEqual({
    "https://firma.de/": { chrome: true, region: "header" },
    "https://firma.de/#ablauf": { chrome: true, region: "navigation" },
    "https://firma.de/autor": { chrome: false, region: "main" },
    "https://firma.de/impressum": { chrome: true, region: "footer" },
    // In the navigation first, and in the content too.
    "https://firma.de/kontakt": { chrome: false, region: "navigation" },
    "https://firma.de/leistungen": { chrome: true, region: "navigation" },
  });
  expect(parsed.headings).toEqual([
    { level: 1, region: "main", text: "Webdesign" },
    // An aside inside the main content belongs to it.
    { level: 2, region: "main", text: "Verwandt" },
    { level: 2, region: "sidebar", text: "Neueste Beiträge" },
    { level: 2, region: "footer", text: "Firma GmbH" },
  ]);
  expect(
    parsed.images?.map(({ chrome, region, url: src }) => [src, region, chrome])
  ).toEqual([
    ["https://firma.de/logo.svg", "header", false],
    ["https://firma.de/team.jpg", "main", false],
  ]);
  expect(parsed.forms?.map(({ region }) => region)).toEqual(["search"]);
  expect(parsed.selected?.paragraphs?.map(({ region }) => region)).toEqual([
    "main",
    "main",
  ]);
});

test("leaves the region out where an element lies in none, and without the option", () => {
  const html = `<div><a href="/a">A</a><h2>Titel</h2></div>`;
  const parsed = parseHtmlSync(html, {
    headings: true,
    links: true,
    regions: true,
    url,
  });
  expect(parsed.links?.[0]).toMatchObject({ chrome: false });
  expect(parsed.links?.[0]?.region).toBeUndefined();
  expect(parsed.headings?.[0]).toEqual({ level: 2, text: "Titel" });
  const plain = parseHtmlSync(page, { headings: true, links: true, url });
  expect(
    plain.links?.some((link) => "region" in link || "chrome" in link)
  ).toBe(false);
  expect(plain.headings?.some((heading) => "region" in heading)).toBe(false);
});

test("reads regions from landmarks, roles, and the markers of themes and page builders", () => {
  expect(regionOf("header", {})).toBe("header");
  expect(regionOf("search", {})).toBe("search");
  expect(regionOf("div", { role: "contentinfo" })).toBe("footer");
  expect(regionOf("ul", { role: "Navigation" })).toBe("navigation");
  expect(regionOf("header", { role: "presentation" })).toBeUndefined();
  expect(regionOf("div", { "data-elementor-type": "header" })).toBe("header");
  expect(regionOf("div", { class: "brxe-x elementor-location-footer" })).toBe(
    "footer"
  );
  expect(regionOf("section", { id: "Colophon" })).toBe("footer");
  // Ids and classes count on containers only, not on a heading or a link.
  expect(regionOf("h1", { id: "header" })).toBeUndefined();
  expect(regionOf("a", { class: "site-header" })).toBeUndefined();
  expect(regionOf("div", { class: "site-header-inner" })).toBeUndefined();
});

test("lets a rule decide the regions", () => {
  const html = `<div id="top"><a href="/">Start</a></div><header class="hero"><a href="/angebot">Angebot</a></header>`;
  const { links } = parseHtmlSync(html, {
    links: true,
    regions: (_tag, attributes, byMarkup) => {
      if (attributes.id === "top") {
        return "header";
      }
      return attributes.class === "hero" ? undefined : byMarkup;
    },
    url,
  });
  expect(links?.map(({ region }) => region)).toEqual(["header", undefined]);
});

test("writes the Markdown with and without the chrome in one conversion", async () => {
  const plain = parseHtmlSync(page, { markdown: true, url }).markdown;
  const parsed = parseHtmlSync(page, { markdown: true, regions: true, url });
  // The whole page reads as without regions.
  expect(parsed.markdown).toBe(plain);
  expect(parsed.contentMarkdown).toBe(
    [
      "# Webdesign",
      "",
      "[Anna Muster](https://firma.de/autor)",
      "",
      "Wir bauen **schnelle** Websites. [Schreiben Sie uns](https://firma.de/kontakt).",
      "",
      "![Team](https://firma.de/team.jpg)![Firma](https://firma.de/logo.svg)",
      "",
      "Veröffentlicht im Mai",
      "",
      "## Verwandt",
    ].join("\n")
  );
  const streamed = await parseHtml(new Response(page), {
    markdown: true,
    regions: true,
    url,
  });
  expect(streamed.markdown).toBe(parsed.markdown);
  expect(streamed.contentMarkdown).toBe(parsed.contentMarkdown);
});

test("keeps the caller's own mdream hooks, and the whole page where it has no chrome", () => {
  const html = `<main><p>Erster Absatz</p><p>Werbung</p></main>`;
  const parsed = parseHtmlSync(html, {
    markdown: {
      hooks: [
        {
          processTextNode: (node) =>
            node.value === "Werbung" ? { content: "", skip: true } : undefined,
        },
      ],
    },
    regions: true,
    url,
  });
  expect(parsed.markdown).toBe("Erster Absatz");
  expect(parsed.contentMarkdown).toBe("Erster Absatz");
});

test("leaves elements out of the Markdown by selector and by what hides its content", () => {
  const html = `<body>
    <div id="BorlabsCookieBox"><p>Wir nutzen Cookies</p></div>
    <div role="dialog"><p>Newsletter</p></div>
    <main><p>Inhalt</p><p hidden>Versteckt</p><p style="display:none">Auch versteckt</p>
      <ul><li>eins</li><li>zwei</li></ul><div class="popup" hidden><p>Impressum im Popup</p></div></main>
  </body>`;
  const exclude = [
    ...consentSelectors,
    "[role='dialog']",
    "li:nth-child(2)",
  ].join(", ");
  const { markdown } = parseHtmlSync(html, {
    markdown: true,
    markdownExclude: { hidden: true, selector: exclude },
    url,
  });
  expect(markdown).toBe("Inhalt\n\n- eins");
  const kept = parseHtmlSync(html, {
    markdown: true,
    markdownExclude: {
      hidden: (_tag, attributes, byMarkup) =>
        byMarkup && !attributes.class?.includes("popup"),
    },
    url,
  });
  expect(kept.markdown).toContain("Impressum im Popup");
  expect(kept.markdown).not.toContain("Versteckt");
  expect(kept.markdown).toContain("Wir nutzen Cookies");
  // Only the Markdown: the other options still read what it leaves out.
  const { text } = parseHtmlSync(html, {
    markdown: true,
    markdownExclude: { selector: exclude },
    text: true,
    url,
  });
  expect(text?.content).toContain("Wir nutzen Cookies");
});
