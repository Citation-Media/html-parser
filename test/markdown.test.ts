import { expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://example.com/";

test("writes headings, paragraphs, lists, links, and quotes", async () => {
  const { markdown } = await parseHtml(
    `<h1>Wir bauen&nbsp;Websites</h1>
     <p>Für den <strong>Mittelstand</strong> in Düsseldorf. <a href="/kontakt">Kontakt</a></p>
     <ul><li>Webdesign<li>Hosting</ul>
     <ol><li>Anfrage</li><li>Angebot</li></ol>
     <blockquote>Sehr gut.</blockquote>`,
    { markdown: true, url }
  );
  expect(markdown).toBe(
    [
      "# Wir bauen Websites",
      "",
      "Für den Mittelstand in Düsseldorf. [Kontakt](https://example.com/kontakt)",
      "",
      "- Webdesign",
      "- Hosting",
      "",
      "1. Anfrage",
      "2. Angebot",
      "",
      "> Sehr gut.",
    ].join("\n")
  );
});

test("leaves out navigation, footer, scripts, consent dialogs, and hidden helpers", async () => {
  const { markdown } = await parseHtml(
    `<nav><a href="/">Start</a></nav>
     <div id="BorlabsCookieBox"><p>Wir nutzen Cookies.</p></div>
     <main><h2>Leistungen</h2><p>Websites mit Astro.</p><span class="sr-only">Zum Inhalt</span>
     <script>window.x = "<p>nope</p>"</script><style>p{}</style></main>
     <footer>Impressum</footer>`,
    { markdown: true, url }
  );
  expect(markdown).toBe("## Leistungen\n\nWebsites mit Astro.");
});

test("keeps content that a consent dialog hides with aria-hidden when asked to", async () => {
  const html =
    '<div aria-hidden="true"><h1>Angebot</h1></div><div role="dialog">Cookies?</div>';
  const hidden = await parseHtml(html, { markdown: true, url });
  expect(hidden.markdown).toBe("");
  const kept = await parseHtml(html, {
    markdown: true,
    skipAriaHidden: false,
    url,
  });
  expect(kept.markdown).toBe("# Angebot");
});

test("keeps preformatted text, writes images on request, and drops empty links", async () => {
  const { markdown } = await parseHtml(
    '<pre>const a = 1;\n  return a;</pre><p><img src="/team.jpg" alt="Unser Team"><a href="/x"><svg></svg></a></p>',
    { markdown: { images: true }, url }
  );
  expect(markdown).toBe(
    "```\nconst a = 1;\n  return a;\n```\n\n![Unser Team](https://example.com/team.jpg)"
  );
});

test("removes soft hyphens and binary EXIF text", async () => {
  const { markdown } = await parseHtml(
    "<p>Barriere&shy;freiheit</p><span>ExifII*\u0000\u0000 Photoshop 3.0 8BIM</span><x:xmpmeta><rdf:RDF>meta</rdf:RDF></x:xmpmeta>",
    { markdown: true, url }
  );
  expect(markdown).toBe("Barrierefreiheit");
});

test("stops at the maximum length", async () => {
  const { markdown } = await parseHtml(`<p>${"Wort ".repeat(1000)}</p>`, {
    markdown: { maxLength: 100 },
    url,
  });
  expect(markdown?.length).toBeLessThanOrEqual(100);
});

test("writes headings when headings are collected in the same pass", async () => {
  const { headings, markdown } = await parseHtml("<h1>Titel</h1><p>Text</p>", {
    headings: true,
    markdown: true,
    url,
  });
  expect(headings).toEqual([{ level: 1, text: "Titel" }]);
  expect(markdown).toBe("# Titel\n\nText");
});
