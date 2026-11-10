import { expect, test } from "vitest";

import { parseHtml, siteOf, specialProtocol } from "../src/index.ts";

const url = "https://firma.de/";

test("lists media, picture sources, embeds, and objects, and an image's srcset URLs", async () => {
  const html = `<video src="/v.mp4" poster="/v.jpg"><source src="/v.webm" type="video/webm"><track src="/v.vtt"></video>
    <audio src="http://cdn.example/a.mp3"></audio>
    <picture><source srcset="/a-1x.webp 1x, /a-2x.webp 2x" type="image/webp"><img src="/a.jpg" alt=""></picture>
    <object data="/d.pdf"></object><embed src="/e.swf">
    <img src="/b.jpg" srcset="/b-400.jpg 400w,/b-800.jpg 800w, data:image/gif;base64,R0lGOD 1600w" alt="">
    <img src="/c.jpg" srcset="/c-1.jpg,/c-2.jpg 2x, /c-1.jpg" alt="">`;
  const { images = [], resources } = await parseHtml(html, {
    images: true,
    resources: true,
    url,
  });
  expect(resources?.media).toEqual([
    "https://firma.de/v.mp4",
    "https://firma.de/v.webm",
    "https://firma.de/v.vtt",
    "http://cdn.example/a.mp3",
    "https://firma.de/a-1x.webp",
    "https://firma.de/a-2x.webp",
    "https://firma.de/d.pdf",
    "https://firma.de/e.swf",
  ]);
  expect(images.map(({ sources, srcset }) => ({ sources, srcset }))).toEqual([
    { sources: undefined, srcset: false },
    {
      sources: ["https://firma.de/b-400.jpg", "https://firma.de/b-800.jpg"],
      srcset: true,
    },
    {
      sources: ["https://firma.de/c-1.jpg", "https://firma.de/c-2.jpg"],
      srcset: true,
    },
  ]);
});

test("keeps every meta property, the first where one repeats", async () => {
  const { meta } = await parseHtml(
    `<head><meta property="og:title" content="Titel"><meta property="OG:title" content="Zweiter">
    <meta property="article:published_time" content="2026-01-01"><meta name="description" content="Text">
    <meta property="og:image" content="/og.jpg"></head>`,
    { meta: true, url }
  );
  expect(meta?.properties).toEqual({
    "article:published_time": "2026-01-01",
    "og:image": "/og.jpg",
    "og:title": "Titel",
  });
  expect(meta?.description).toBe("Text");
  expect(meta?.image).toBe("https://firma.de/og.jpg");
});

test("takes the first of a repeated meta field, every robots rule, and the last viewport", async () => {
  const { meta } = await parseHtml(
    `<head><meta name="description" content=" "><meta name="description" content="Erste">
    <meta name="generator" content="WordPress 6.9"><meta name="generator" content="Elementor 3.30">
    <meta property="og:image" content="/1.jpg"><meta property="og:image" content="/2.jpg">
    <meta name="robots" content="index, follow"><meta name="ROBOTS" content="noindex">
    <meta name="viewport" content="width=device-width"><meta name="viewport" content="width=1200"></head>
    <body><meta name="description" content="Im Body"></body>`,
    { meta: true, url }
  );
  expect(meta).toMatchObject({
    description: "Erste",
    generator: "WordPress 6.9",
    image: "https://firma.de/1.jpg",
    robots: "index, follow, noindex",
    viewport: "width=1200",
  });
});

test("leaves out frames and link elements without an address", async () => {
  const { resources } = await parseHtml(
    '<link rel="stylesheet" href=""><iframe src=" "></iframe><iframe></iframe><iframe src="/f"></iframe>',
    { resources: true, url }
  );
  expect(resources).toMatchObject({
    frames: ["https://firma.de/f"],
    links: [],
  });
});

test("takes any scheme but http and https as special, and tells downloads by their extension", async () => {
  const { links = [] } = await parseHtml(
    `<a href="WhatsApp://send?text=Hallo">WhatsApp</a><a href="callto:+49211123">Anruf</a>
    <a href="sip:info@firma.de">SIP</a><a href="meine-app://start">App</a>
    <a href="HTTPS://firma.de/kontakt.vcf">vCard</a><a href="/termin.ics">Termin</a><a href="/a/b:c">Pfad</a>`,
    { links: true, url }
  );
  expect(links.map(({ kind, resource }) => [kind, resource])).toEqual([
    ["special", false],
    ["special", false],
    ["special", false],
    ["special", false],
    ["internal", true],
    ["internal", true],
    ["internal", false],
  ]);
  expect(specialProtocol(" MailTo:a@b.de")).toBe("mailto:");
  expect(specialProtocol("meine-app://start")).toBe("meine-app:");
  expect(specialProtocol("//cdn.example/x")).toBeUndefined();
  expect(specialProtocol("http://example.com/")).toBeUndefined();
});

test("takes a fragment link as an anchor only where it stays on the page", async () => {
  const html = '<a href="#team">Team</a><a href="/#kontakt">Kontakt</a>';
  const kinds = async (page: string) => {
    const { links = [] } = await parseHtml(html, { links: true, url: page });
    return links.map(({ kind }) => kind);
  };
  expect(await kinds("https://firma.de/")).toEqual(["anchor", "anchor"]);
  expect(await kinds("https://firma.de/#top")).toEqual(["anchor", "anchor"]);
  expect(await kinds("https://firma.de/ueber-uns/")).toEqual([
    "anchor",
    "internal",
  ]);
});

test("knows the registrable domain under or.at and keeps a site's hosts internal", async () => {
  expect(siteOf("www.verein.or.at")).toBe("verein.or.at");
  expect(siteOf("shop.firma.co.uk")).toBe("firma.co.uk");
  expect(siteOf("mail.firma.de")).toBe("firma.de");
  const { links = [] } = await parseHtml(
    '<a href="https://www.verein.or.at/termine">Termine</a><a href="https://anderer.or.at/">Anderer</a>',
    { links: true, url: "https://verein.or.at/" }
  );
  expect(links.map(({ kind }) => kind)).toEqual(["internal", "external"]);
});
