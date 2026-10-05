import { describe, expect, test } from "vitest";

import {
  colorDistance,
  colorsIn,
  parseColor,
  parseHtml,
  readDeclarations,
  readStyles,
  toHex,
} from "../src/index.ts";

const hexOf = (value: string) => {
  const color = parseColor(value);
  return color ? toHex(color) : null;
};

describe("colours", () => {
  test("reads hex, rgb, hsl, oklch, and named colours alike", () => {
    expect(hexOf("#06417A")).toBe("#06417a");
    expect(hexOf("#fff")).toBe("#ffffff");
    expect(hexOf("rgb(6, 65, 122)")).toBe("#06417a");
    expect(hexOf("rgb(6 65 122 / 50%)")).toBe("#06417a");
    expect(parseColor("rgba(0,0,0,.2)")?.alpha).toBeCloseTo(0.2);
    expect(hexOf("hsl(210 90% 25%)")).toBe("#064079");
    expect(hexOf("hsla(210, 90%, 25%, 1)")).toBe("#064079");
    expect(hexOf("rebeccapurple")).toBe("#663399");
    // Tailwind 4's teal-500.
    expect(hexOf("oklch(70.4% 0.14 182.503)")).toBe("#00bba7");
  });

  test("leaves out what depends on the element", () => {
    expect(parseColor("currentcolor")).toBeNull();
    expect(parseColor("color-mix(in oklab, red 50%, blue)")).toBeNull();
    expect(parseColor("rgb(var(--r) var(--g) var(--b))")).toBeNull();
    expect(parseColor("solid")).toBeNull();
    expect(parseColor("rgba(#000, .5)")).toBeNull();
  });

  test("finds every colour of a value, not keywords", () => {
    expect(
      colorsIn("1px solid #ccc, linear-gradient(red, rgb(0 0 255))").map(toHex)
    ).toEqual(["#cccccc", "#ff0000", "#0000ff"]);
    expect(colorsIn("none")).toEqual([]);
  });

  test("measures how far apart colours look", () => {
    const blue = parseColor("#06417a");
    const rounded = parseColor("rgb(6 65 123)");
    const grey = parseColor("#cccccc");
    expect(blue && rounded && colorDistance(blue, rounded)).toBeLessThan(1);
    expect(blue && grey && colorDistance(blue, grey)).toBeGreaterThan(30);
  });
});

describe("reading CSS", () => {
  test("reads declarations through comments, strings, at-rules, and nesting", () => {
    const { declarations, imports } = readDeclarations(
      `@import url("theme.css");
       /* a { color: red } */
       :root { --brand: #06417a; }
       a[href*="}"] { color: var(--brand) !important; content: "a;b" }
       @media (min-width: 600px) { .card { background: #fff; & h2 { color: red } } }
       @font-face { font-family: "Inter"; font-weight: 400 }`,
      "site.css"
    );
    expect(imports).toEqual(["theme.css"]);
    expect(
      declarations.map(({ property, value, selector, atRules }) => [
        property,
        value,
        selector,
        atRules,
      ])
    ).toEqual([
      ["--brand", "#06417a", ":root", []],
      ["color", "var(--brand)", 'a[href*="}"]', []],
      ["content", '"a;b"', 'a[href*="}"]', []],
      ["background", "#fff", ".card", ["@media (min-width: 600px)"]],
      ["color", "red", "& h2", ["@media (min-width: 600px)"]],
      ["font-family", '"Inter"', "@font-face", ["@font-face"]],
      ["font-weight", "400", "@font-face", ["@font-face"]],
    ]);
  });
});

describe("style map", () => {
  const map = readStyles([
    {
      css: `:root { --blue: #06417a; --brand: var(--blue); --text: var(--missing, #333) }
            @media (prefers-color-scheme: dark) { :root { --blue: #8ab4f8 } }
            .card { --blue: red; border: 1px solid var(--brand); color: #06417a }
            .hero { background: var(--brand, #000) }
            h1 { font: 700 2rem/1.2 "Gosha Sans", sans-serif }
            body { font-family: var(--font, Inter), system-ui }
            @keyframes pulse { from { color: #123456 } }
            @font-face { font-family: Gosha Sans; font-weight: 700 }
            @font-face { font-display: swap; font-family: Inter; src: url(inter.woff2) }`,
      origin: "theme.css",
    },
    { css: "color: rgb(6 65 122)", element: "p.lead", origin: "attribute" },
  ]);

  test("resolves variables from the root, through chains and fallbacks", () => {
    const byName = new Map(
      map.variables.map((variable) => [variable.name, variable])
    );
    expect(byName.get("--blue")?.color).toBe("#06417a");
    expect(byName.get("--blue")?.definitions).toHaveLength(3);
    expect(byName.get("--brand")?.color).toBe("#06417a");
    expect(byName.get("--brand")?.uses).toBe(2);
    expect(byName.get("--text")?.color).toBe("#333333");
  });

  test("tells colours written by hand from those read through a variable", () => {
    expect(
      map.colors.map(({ color, selector, variable }) => [
        color,
        selector,
        variable,
      ])
    ).toEqual([
      ["#06417a", ".card", "--brand"],
      ["#06417a", ".card", undefined],
      ["#06417a", ".hero", "--brand"],
      ["#06417a", "p.lead", undefined],
    ]);
  });

  test("lists font families with their stacks and the faces the CSS loads", () => {
    expect(
      map.fonts.map(({ family, selector, variable }) => [
        family,
        selector,
        variable,
      ])
    ).toEqual([
      ["Gosha Sans", "h1", undefined],
      ["Inter", "body", "--font"],
    ]);
    // Descriptors before the family belong to their own rule, not the one before.
    expect(map.fontFaces).toEqual([
      { family: "Gosha Sans", origin: "theme.css", weight: "700" },
      {
        display: "swap",
        family: "Inter",
        origin: "theme.css",
        src: "url(inter.woff2)",
      },
    ]);
  });
});

describe("parseHtml styles", () => {
  test("collects <style> blocks, style attributes, and stylesheets", async () => {
    const { styles } = await parseHtml(
      `<html><head>
        <link rel="stylesheet" href="/theme.css">
        <link rel="preload" as="style" href="/late.css">
        <link rel="preload" as="font" href="/font.woff2">
        <style id="theme-inline-css">:root { --brand: #06417a }</style>
      </head><body>
        <div id="hero" class="banner wide" style="color: #06417a; background: &quot;x&quot;">Hi</div>
      </body></html>`,
      { styles: true, url: "https://example.com/" }
    );
    expect(styles).toEqual({
      attributes: [
        { css: 'color: #06417a; background: "x"', element: "div#hero.banner" },
      ],
      blocks: [{ css: ":root { --brand: #06417a }", id: "theme-inline-css" }],
      stylesheets: [
        "https://example.com/theme.css",
        "https://example.com/late.css",
      ],
    });
  });
});
