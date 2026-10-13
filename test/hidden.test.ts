import { expect, test } from "vitest";

import { hidesContent, parseHtml } from "../src/index.ts";
import type { HiddenRule } from "../src/index.ts";

const url = "https://firma.de/";

const flags = <T extends { hidden?: boolean }>(
  items: readonly T[],
  key: (item: T) => string
) => Object.fromEntries(items.map((item) => [key(item), item.hidden]));

test("marks links, images, and headings in hidden content, cleared where one occurrence shows", async () => {
  const html = `<body>
    <nav class="menu" hidden><a href="/leistungen">Leistungen</a><img src="/logo.svg" alt="Firma"></nav>
    <header><a href="/leistungen">Leistungen</a><img src="/logo.svg" alt="Firma"></header>
    <div aria-hidden="true"><a href="/klon">Klon</a><h2>Versteckt</h2></div>
    <main aria-hidden="true"><h1>Kontakt</h1><img src="/hero.jpg" alt=""></main>
    <dialog><h3>Dialog</h3></dialog>
    <template><img src="/vorlage.jpg" alt=""></template>
    <section inert><a href="/inert">Inert</a></section>
    <div style="color: red; display : none"><a href="/none">None</a></div>
    <p hidden="until-found"><a href="/found">Found</a></p>
  </body>`;
  const {
    links = [],
    images = [],
    headings = [],
  } = await parseHtml(html, {
    headings: true,
    hidden: true,
    images: true,
    links: true,
    url,
  });
  expect(flags(links, (link) => link.url.replace(url, ""))).toEqual({
    found: true,
    inert: true,
    klon: true,
    leistungen: false,
    none: true,
  });
  expect(flags(images, (image) => image.url.replace(url, ""))).toEqual({
    "hero.jpg": false,
    "logo.svg": false,
    "vorlage.jpg": true,
  });
  expect(headings).toEqual([
    { hidden: true, level: 2, text: "Versteckt" },
    { hidden: false, level: 1, text: "Kontakt" },
    { hidden: true, level: 3, text: "Dialog" },
  ]);
});

/** Keeps popups, which may hold an imprint, and hides screen-reader-only text. */
const popupsShown: HiddenRule = (_tag, attributes, byMarkup) =>
  (byMarkup && !(attributes.class ?? "").includes("popup")) ||
  /\bsr-only\b/u.test(attributes.class ?? "");

test("lets a rule keep popups and hide screen-reader-only text, for positions too", async () => {
  const html = `<div class="popup" hidden><h2>Impressum</h2><img src="/p.jpg" alt=""></div>
    <span class="sr-only"><a href="/skip">Skip</a></span>
    <div hidden><a href="/weg">Weg</a><img src="/w.jpg" alt=""></div>`;
  const {
    headings = [],
    images = [],
    links = [],
  } = await parseHtml(html, {
    headings: true,
    hidden: popupsShown,
    images: true,
    links: true,
    positions: true,
    url,
  });
  expect(headings).toEqual([{ hidden: false, level: 2, text: "Impressum" }]);
  expect(flags(links, (link) => link.url.replace(url, ""))).toEqual({
    skip: true,
    weg: true,
  });
  expect(
    Object.fromEntries(
      images.map((image) => [image.url.replace(url, ""), image.position])
    )
  ).toEqual({ "p.jpg": "first-screen", "w.jpg": "hidden" });
});

test("adds no hidden mark without the option", async () => {
  const {
    headings = [],
    images = [],
    links = [],
  } = await parseHtml(
    '<div hidden><a href="/a">A</a><img src="/i.png" alt=""><h2>H</h2></div>',
    { headings: true, images: true, links: true, url }
  );
  expect(links[0]).not.toHaveProperty("hidden");
  expect(images[0]).not.toHaveProperty("hidden");
  expect(headings[0]).not.toHaveProperty("hidden");
});

test("hidesContent reads the markup, not classes", () => {
  expect(hidesContent("dialog", {})).toBe(true);
  expect(hidesContent("dialog", { open: "" })).toBe(false);
  expect(hidesContent("template", {})).toBe(true);
  expect(hidesContent("div", { style: "visibility:hidden" })).toBe(true);
  expect(hidesContent("div", { style: "color:red" })).toBe(false);
  expect(hidesContent("div", { inert: "" })).toBe(true);
  expect(hidesContent("main", { "aria-hidden": "true" })).toBe(false);
  expect(hidesContent("div", { class: "modal sr-only" })).toBe(false);
});
