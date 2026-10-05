import { describe, expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://example.com/";

const hydrationOf = async (html: string) => {
  const { hydration } = await parseHtml(html, { hydration: true, url });
  return hydration;
};

describe("astro", () => {
  test("reads the islands with their directives, components, and props", async () => {
    const html = `<body><h1>Shop</h1>
      <astro-island uid="Z1" component-url="/_astro/Cart.CmQ8.js?v=2" component-export="Cart"
        renderer-url="/_astro/client.js" props="{&quot;items&quot;:[0,[]]}" ssr client="load"><p>Cart</p></astro-island>
      <astro-island uid="Z2" component-url="/_astro/Map.B1.js" props="{}" client="only"></astro-island></body>`;
    expect(await hydrationOf(html)).toEqual({
      framework: "astro",
      islands: [
        {
          client: "load",
          component: "Cart.CmQ8.js",
          propsBytes: 26,
          serverRendered: true,
          uid: "Z1",
        },
        {
          client: "only",
          component: "Map.B1.js",
          propsBytes: 2,
          serverRendered: false,
          uid: "Z2",
        },
      ],
      payloadBytes: 28,
    });
  });

  test("measures props as the HTML sends them, with their entities", async () => {
    const props = `{&quot;title&quot;:[0,&quot;${"x".repeat(2000)}&quot;]}`;
    const hydration = await hydrationOf(
      `<astro-island uid="a" props="${props}" client="visible"></astro-island>`
    );
    expect(hydration?.islands[0]?.propsBytes).toBe(props.length);
  });

  test("counts nested islands and every island's props past the list's limit", async () => {
    const islands = Array.from(
      { length: 250 },
      (_, index) =>
        `<astro-island uid="${index}" props="{}" client="idle"></astro-island>`
    ).join("");
    const hydration = await hydrationOf(
      `<astro-island uid="outer" props="{}" client="load">${islands}</astro-island>`
    );
    expect(hydration?.islands).toHaveLength(200);
    expect(hydration?.payloadBytes).toBe(251 * 2);
  });

  test("prefers Astro when an island renders a framework that writes its own data", async () => {
    const hydration = await hydrationOf(
      `<astro-island uid="1" props="{}" client="load"></astro-island><script>self.__next_f.push([1,"x"])</script>`
    );
    expect(hydration?.framework).toBe("astro");
  });
});

describe("next.js", () => {
  test("measures the pages router's __NEXT_DATA__", async () => {
    expect(
      await hydrationOf(
        `<div id="__next"><p>Hi</p></div><script id="__NEXT_DATA__" type="application/json">{"props":{"a":1}}</script>`
      )
    ).toEqual({ framework: "next-pages", islands: [], payloadBytes: 17 });
  });

  test("sums the app router's streamed payload across its scripts", async () => {
    const first = `(self.__next_f=self.__next_f||[]).push([0])`;
    const second = `self.__next_f.push([1,"0:[\\"$\\",\\"div\\",null,{}]"])`;
    const hydration = await hydrationOf(
      `<body><main>Hi</main><script>${first}</script><script>${second}</script><script src="/_next/static/chunks/main.js" async></script></body>`
    );
    expect(hydration).toEqual({
      framework: "next-app",
      islands: [],
      payloadBytes: first.length + second.length,
    });
  });

  test("measures a payload that arrives in several chunks", async () => {
    const data = `{"props":{"text":"${"y".repeat(300_000)}"}}`;
    const hydration = await hydrationOf(
      `<script id="__NEXT_DATA__" type="application/json">${data}</script>`
    );
    expect(hydration?.payloadBytes).toBe(data.length);
  });
});

describe("other frameworks", () => {
  test("reads Nuxt 3's __NUXT_DATA__ and Nuxt 2's window.__NUXT__", async () => {
    expect(
      await hydrationOf(
        `<div id="__nuxt"></div><script type="application/json" id="__NUXT_DATA__" data-ssr="true">[1,2]</script>`
      )
    ).toEqual({ framework: "nuxt", islands: [], payloadBytes: 5 });
    const legacy = `window.__NUXT__=(function(a){return {data:[a]}}(1));`;
    expect(await hydrationOf(`<script>${legacy}</script>`)).toEqual({
      framework: "nuxt",
      islands: [],
      payloadBytes: legacy.length,
    });
  });

  test("reads SvelteKit's start script", async () => {
    const script = `
      {
        __sveltekit_1x2y3z = {
          base: new URL(".", location).pathname.slice(0, -1)
        };
        const element = document.currentScript.parentElement;
        const data = [null,{"type":"data","data":{"posts":[]},"uses":{}}];
      }`;
    const hydration = await hydrationOf(
      `<div style="display: contents"><h1>Blog</h1><script>${script}</script></div>`
    );
    expect(hydration?.framework).toBe("sveltekit");
    expect(hydration?.payloadBytes).toBe(script.length);
  });

  test("reads Remix's and React Router's context", async () => {
    const remix = await hydrationOf(
      `<script>window.__remixContext = {"state":{"loaderData":{}}};</script>`
    );
    const reactRouter = await hydrationOf(
      `<script>window.__reactRouterContext = {"basename":"/"};</script>`
    );
    expect([remix?.framework, reactRouter?.framework]).toEqual([
      "remix",
      "remix",
    ]);
  });

  test("reads Angular's version marker and transferred state", async () => {
    expect(
      await hydrationOf(
        `<app-root ng-version="19.0.0" ng-server-context="ssr"></app-root><script id="ng-state" type="application/json">{"x":1}</script>`
      )
    ).toEqual({ framework: "angular", islands: [], payloadBytes: 7 });
    expect(
      await hydrationOf(`<app-root ng-version="17.3.0"></app-root>`)
    ).toEqual({ framework: "angular", islands: [], payloadBytes: 0 });
  });
});

describe("pages that do not hydrate", () => {
  test("returns null for static pages and plain scripts", async () => {
    expect(await hydrationOf("<body><h1>Hallo</h1></body>")).toBeNull();
    expect(
      await hydrationOf(
        `<script>window.dataLayer = window.dataLayer || [];</script><script src="/app.js"></script>`
      )
    ).toBeNull();
  });

  test("does not take markers in external scripts or text for a framework", async () => {
    expect(
      await hydrationOf(
        `<p>We moved from window.__NUXT__ = data to Astro.</p><script src="/self.__next_f.js"></script>`
      )
    ).toBeNull();
  });

  test("ignores a marker that only stands deep inside a long inline script", async () => {
    const script = `var app = "${"z".repeat(2000)}"; self.__next_f.push([1,"x"]);`;
    expect(await hydrationOf(`<script>${script}</script>`)).toBeNull();
  });

  test("leaves hydration out unless asked for", async () => {
    const result = await parseHtml(
      `<script id="__NEXT_DATA__" type="application/json">{}</script>`,
      { url }
    );
    expect(result).not.toHaveProperty("hydration");
  });
});
