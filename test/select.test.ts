import { expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://firma.de/";

test("returns the elements each selector matches, with attributes and text", async () => {
  const html = `<body>
    <address class="vcard">Firma GmbH<br>Hauptstraße 1, <span>12345</span> Ort<script>x()</script></address>
    <p>Veröffentlicht am <time datetime="2026-01-02">2. Januar 2026</time></p>
    <a href="#" data-mail-to="aW5mb0BmaXJtYS5kZQ==">Mail</a>
    <footer><address>Zweite</address></footer>
    <meta name="generator" content="WordPress 6.9">
  </body>`;
  const { selected } = await parseHtml(html, {
    select: {
      addresses: "address",
      generator: "meta[name='generator' i]",
      mail: "a[data-mail-to]",
      none: ".missing",
      times: "time[datetime]",
    },
    url,
  });
  expect(selected).toEqual({
    addresses: [
      {
        attributes: { class: "vcard" },
        tag: "address",
        text: "Firma GmbHHauptstraße 1, 12345 Ort",
      },
      { attributes: {}, tag: "address", text: "Zweite" },
    ],
    generator: [
      {
        attributes: { content: "WordPress 6.9", name: "generator" },
        tag: "meta",
        text: "",
      },
    ],
    mail: [
      {
        attributes: { "data-mail-to": "aW5mb0BmaXJtYS5kZQ==", href: "#" },
        tag: "a",
        text: "Mail",
      },
    ],
    none: [],
    times: [
      {
        attributes: { datetime: "2026-01-02" },
        tag: "time",
        text: "2. Januar 2026",
      },
    ],
  });
});

test("reads selected elements regardless of the context and marks hidden ones", async () => {
  const { selected, links } = await parseHtml(
    `<header><div class="popup" hidden><button class="cta">Anrufen</button></div></header>
    <main><button class="cta">Anfragen</button><a href="/x">X</a></main>`,
    {
      context: "main",
      hidden: true,
      links: true,
      select: { ctas: "button.cta, main > button" },
      url,
    }
  );
  expect(links?.map((link) => link.text)).toEqual(["X"]);
  expect(selected?.ctas).toEqual([
    {
      attributes: { class: "cta" },
      hidden: true,
      tag: "button",
      text: "Anrufen",
    },
    {
      attributes: { class: "cta" },
      hidden: false,
      tag: "button",
      text: "Anfragen",
    },
  ]);
});

test("rejects a selector it cannot match in one pass", async () => {
  await expect(
    parseHtml("<p></p>", { select: { last: "p:last-child" }, url })
  ).rejects.toThrow(SyntaxError);
});
