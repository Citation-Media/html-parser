import { describe, expect, test } from "vitest";

import { parseHtmlSync } from "../src/index.ts";

const url = "https://example.com/";

const page = `
  <header class="site-header"><a href="/h">Header</a></header>
  <main id="content" data-layout="Wide Grid">
    <section class="intro lead"><a href="/1">One</a><p><a href="/2">Two</a></p></section>
    <section class="teaser" lang="de-AT"><a href="/3">Three</a></section>
    <section class="teaser hidden"><a href="/4">Four</a></section>
    <div><a href="/5" rel="nofollow noopener">Five</a><a href="/6">Six</a><a href="/7">Seven</a></div>
  </main>
  <footer><a href="/f">Footer</a></footer>`;

const textsIn = (context: string) =>
  parseHtmlSync(page, { context, links: true, url }).links?.map(
    ({ text }) => text
  );

describe("context selectors", () => {
  test("matches types, ids, classes, and attributes", () => {
    expect(textsIn("#content > section.intro")).toEqual(["One", "Two"]);
    expect(textsIn(".teaser:not(.hidden)")).toEqual(["Three"]);
    expect(textsIn("[lang|='de']")).toEqual(["Three"]);
    expect(textsIn("main[data-layout~=Grid] div")).toEqual([
      "Five",
      "Six",
      "Seven",
    ]);
    expect(textsIn("[data-layout^='wide' i] .lead")).toEqual(["One", "Two"]);
    expect(textsIn("a[href$='6'], a[rel*=nofollow]")).toEqual(["Five", "Six"]);
    expect(textsIn("[data-layout='Wide Grid'] > div > a:first-child")).toEqual([
      "Five",
    ]);
  });

  test("tells child from descendant combinators", () => {
    expect(textsIn("section > a")).toEqual(["One", "Three", "Four"]);
    expect(textsIn("section a")).toEqual(["One", "Two", "Three", "Four"]);
  });

  test("counts positions among siblings and siblings of a type", () => {
    expect(textsIn("main > section:nth-child(2)")).toEqual(["Three"]);
    expect(textsIn("main > section:nth-of-type(odd)")).toEqual([
      "One",
      "Two",
      "Four",
    ]);
    expect(textsIn("div > a:nth-child(-n+2)")).toEqual(["Five", "Six"]);
    expect(textsIn("main > :first-of-type")).toEqual([
      "One",
      "Two",
      "Five",
      "Six",
      "Seven",
    ]);
    expect(textsIn("div > a:nth-of-type(2n+1)")).toEqual(["Five", "Seven"]);
  });

  test("throws for selectors a single pass cannot decide", () => {
    for (const selector of [
      "a:last-child",
      "section + section",
      "p ~ a",
      "a:hover",
    ]) {
      expect(() => textsIn(selector)).toThrow(SyntaxError);
    }
  });
});
