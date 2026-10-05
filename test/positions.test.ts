import { describe, expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://example.com/";

/** Visible text of about `length` characters, in paragraphs. */
const prose = (length: number) =>
  Array.from(
    { length: Math.ceil(length / 100) },
    () => `<p>${"Lorem ipsum dolor sit amet, ".repeat(4)}consectetur ad.</p>`
  ).join("\n");

const positions = async (html: string) => {
  const { images = [], hydration } = await parseHtml(html, {
    hydration: true,
    images: true,
    positions: true,
    url,
  });
  return Object.fromEntries([
    ...images.map((image) => [
      image.url.replace(url, ""),
      image.position ?? "none",
    ]),
    ...(hydration?.islands ?? []).map((island) => [
      island.uid,
      island.position ?? "none",
    ]),
  ]);
};

describe("first screen", () => {
  test("places the header logo in the first screen and leaves a hero after it unknown", async () => {
    expect(
      await positions(`<body>
        <header class="site-header"><a href="/"><img src="logo.svg" alt="Firma"></a></header>
        <main><h1>Websites, die verkaufen</h1><p>Wir bauen sie.</p><img src="hero.jpg" alt=""></main>
        ${prose(4000)}</body>`)
    ).toEqual({ "hero.jpg": "unknown", "logo.svg": "first-screen" });
  });

  test("places the first image after a short intro in the first screen", async () => {
    expect(
      await positions(
        `<main><h1>Über uns</h1><p>Kurz und knapp.</p><img src="team.jpg" alt="Team"></main>${prose(3000)}`
      )
    ).toEqual({ "team.jpg": "first-screen" });
  });

  test("does not count the text of a large navigation", async () => {
    const menu = Array.from(
      { length: 120 },
      (_, index) =>
        `<li><a href="/p/${index}">Leistung Nummer ${index}</a></li>`
    ).join("");
    expect(
      await positions(
        `<nav><ul>${menu}</ul></nav><main><img src="hero.jpg" alt=""></main>${prose(3000)}`
      )
    ).toEqual({ "hero.jpg": "first-screen" });
  });

  test("does not count text in scripts, styles, templates, or closed containers", async () => {
    expect(
      await positions(`<head><title>${"Titel ".repeat(100)}</title>
        <style>${"body { color: red; } ".repeat(200)}</style></head>
        <body><script>${"var a = 1; ".repeat(400)}</script>
        <template><p>${"x".repeat(3000)}</p></template>
        <div class="modal" id="newsletter"><p>${"y".repeat(3000)}</p></div>
        <img src="hero.jpg" alt="">${prose(3000)}</body>`)
    ).toEqual({ "hero.jpg": "first-screen" });
  });
});

describe("below the first screen", () => {
  test("places images deep in a long article below the first screen", async () => {
    expect(
      await positions(
        `<article><h1>Ratgeber</h1>${prose(2500)}<img src="chart.png" alt="Chart">${prose(2500)}<img src="end.png" alt=""></article>`
      )
    ).toEqual({ "chart.png": "below", "end.png": "below" });
  });

  test("places an image in the footer of a long page below the first screen", async () => {
    expect(
      await positions(
        `<main>${prose(6000)}</main><footer><img src="partner.png" alt="Partner"></footer>`
      )
    ).toEqual({ "partner.png": "below" });
  });

  test("places an island far down the page below the first screen", async () => {
    expect(
      await positions(
        `<main>${prose(5000)}</main><astro-island uid="news" props="{}" client="load"><form></form></astro-island>`
      )
    ).toEqual({ news: "below" });
  });

  test("does not claim below for text that is a small share of a very long page", async () => {
    expect(
      await positions(
        `<main>${prose(1600)}<img src="early.png" alt="">${prose(12_000)}</main>`
      )
    ).toEqual({ "early.png": "unknown" });
  });
});

describe("unknown", () => {
  test("leaves images between the two rules unknown", async () => {
    expect(
      await positions(
        `<h1>Start</h1><img src="first.jpg" alt=""><img src="second.jpg" alt="">${prose(800)}<img src="third.jpg" alt="">${prose(800)}`
      )
    ).toEqual({
      "first.jpg": "first-screen",
      "second.jpg": "unknown",
      "third.jpg": "unknown",
    });
  });

  test("leaves the slides of a carousel unknown, wherever they are", async () => {
    expect(
      await positions(`<div class="swiper"><div class="swiper-wrapper">
        <div class="swiper-slide"><img src="slide-1.jpg" alt=""></div>
        <div class="swiper-slide"><img src="slide-2.jpg" alt=""></div></div></div>
        ${prose(4000)}<div class="logo-carousel"><img src="client.png" alt=""></div>`)
    ).toEqual({
      "client.png": "unknown",
      "slide-1.jpg": "unknown",
      "slide-2.jpg": "unknown",
    });
  });

  test("does not place a fixed or sticky element below, wherever the markup puts it", async () => {
    expect(
      await positions(
        `<main>${prose(5000)}</main><div class="sticky-cta is-sticky"><img src="cta.png" alt=""></div><header><img src="late-logo.png" alt=""></header>`
      )
    ).toEqual({ "cta.png": "unknown", "late-logo.png": "unknown" });
  });
});

describe("hidden", () => {
  // HTMLRewriter reads <noscript> as text, as a browser with scripts does, so its images are not
  // collected at all.
  test("recognizes elements the markup hides", async () => {
    expect(
      await positions(`<body>
        <div hidden><img src="hidden-attribute.png" alt=""></div>
        <div style="display: none"><img src="display-none.png" alt=""></div>
        <div style="visibility:hidden"><img src="visibility.png" alt=""></div>
        <dialog><img src="dialog.png" alt=""></dialog>
        <div class="offcanvas-menu"><img src="menu.png" alt=""></div>
        <span class="sr-only"><img src="screen-reader.png" alt=""></span>
        <noscript><img src="noscript.png" alt=""></noscript>
        <img src="own-attribute.png" alt="" hidden>
      </body>`)
    ).toEqual({
      "dialog.png": "hidden",
      "display-none.png": "hidden",
      "hidden-attribute.png": "hidden",
      "menu.png": "hidden",
      "own-attribute.png": "hidden",
      "screen-reader.png": "hidden",
      "visibility.png": "hidden",
    });
  });

  test("treats an open dialog and classes that only resemble hidden ones as visible", async () => {
    expect(
      await positions(
        `<dialog open><img src="open.png" alt=""></dialog><div class="modalities"><img src="word.png" alt=""></div>`
      )
    ).toEqual({ "open.png": "first-screen", "word.png": "unknown" });
  });

  test("ends a hidden container at its end tag", async () => {
    expect(
      await positions(
        `<div class="modal"><img src="in.png" alt=""></div><img src="after.png" alt="">`
      )
    ).toEqual({ "after.png": "first-screen", "in.png": "hidden" });
  });

  test("does not count hidden images as images before an element", async () => {
    expect(
      await positions(
        `<div hidden><img src="a.png" alt=""><img src="b.png" alt=""></div><img src="hero.png" alt="">`
      )
    ).toMatchObject({ "hero.png": "first-screen" });
  });
});

describe("the option", () => {
  test("uses the first occurrence of an image that appears twice", async () => {
    expect(
      await positions(
        `<img src="logo.svg" alt="Firma">${prose(5000)}<footer><img src="logo.svg" alt="Firma"></footer>`
      )
    ).toEqual({ "logo.svg": "first-screen" });
  });

  test("estimates the whole page regardless of context", async () => {
    const { images } = await parseHtml(
      `<nav><img src="logo.svg" alt=""></nav><main>${prose(5000)}<img src="end.png" alt=""></main>`,
      { context: "main", images: true, positions: true, url }
    );
    expect(images?.map(({ position }) => position)).toEqual(["below"]);
  });

  test("leaves positions out unless asked for", async () => {
    const { images } = await parseHtml(`<img src="a.png" alt="">`, {
      images: true,
      url,
    });
    expect(images?.[0]).not.toHaveProperty("position");
  });
});
