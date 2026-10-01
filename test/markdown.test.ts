import { describe, expect, test } from "vitest";

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
      "Für den **Mittelstand** in Düsseldorf. [Kontakt](https://example.com/kontakt)",
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

describe("code", () => {
  test("names the language of a code block from the language- class of its code", async () => {
    const markdown = async (html: string) => {
      const result = await parseHtml(html, { markdown: true, url });
      return result.markdown;
    };
    expect(await markdown("<pre><code>a = 1</code></pre>")).toBe(
      "```\na = 1\n```"
    );
    // The HTML standard's own example, and what CommonMark writes for a fenced block.
    expect(
      await markdown('<pre><code class="language-pascal">var i;</code></pre>')
    ).toBe("```pascal\nvar i;\n```");
    expect(
      await markdown('<pre><code class="hljs language-c++">a</code></pre>')
    ).toBe("```c++\na\n```");
    expect(
      await markdown('<pre><code class="language-`x`">a</code></pre>')
    ).toBe("```x\na\n```");
  });

  test("leaves the language out where HTML does not suggest one", async () => {
    const markdown = async (html: string) => {
      const result = await parseHtml(html, { markdown: true, url });
      return result.markdown;
    };
    expect(await markdown('<pre data-language="ts">a</pre>')).toBe(
      "```\na\n```"
    );
    expect(await markdown('<pre class="language-css">a</pre>')).toBe(
      "```\na\n```"
    );
    expect(await markdown('<pre><code class="lang-js">a</code></pre>')).toBe(
      "```\na\n```"
    );
  });

  test("keeps formatting inside a code block as written", async () => {
    const { markdown } = await parseHtml(
      "<pre><code>if (a) {\n  <b>return</b> <code>x</code>  <em> y</em>;\n}</code></pre>",
      { markdown: true, url }
    );
    expect(markdown).toBe("```\nif (a) {\n  return x   y;\n}\n```");
  });

  test("writes inline code with a longer fence around backticks", async () => {
    const { markdown } = await parseHtml(
      "<p>Run <code>npm   test</code>, quote with <code>`</code> or <code>a``b</code>, not <code> </code>.</p><p><code>``` x</code></p>",
      { markdown: true, url }
    );
    expect(markdown).toBe(
      "Run `npm test`, quote with `` ` `` or ``` a``b ```, not .\n\n```` ``` x ````"
    );
  });

  test("writes links and emphasis inside inline code as text", async () => {
    const { markdown } = await parseHtml(
      '<p><code><a href="/api">parse</a>(<strong>html</strong>)</code> and <a href="/api"><code>api</code></a></p>',
      { markdown: true, url }
    );
    expect(markdown).toBe("`parse(html)` and [`api`](https://example.com/api)");
  });

  test("keeps whitespace in code blocks after inline code with backticks", async () => {
    const { markdown } = await parseHtml(
      "<p><code>a```b</code></p><pre>  indented</pre><p><code>c</code></p>",
      { markdown: true, url }
    );
    expect(markdown).toBe("```` a```b ````\n\n```\n  indented\n```\n\n`c`");
  });
});

describe("emphasis", () => {
  test("writes bold and italic text with spaces outside the markers", async () => {
    const { markdown } = await parseHtml(
      "<p>Wir <strong> bauen </strong>schnelle<b>Websites</b> <em>für <i>alle</i></em>, <b><strong>doppelt</strong></b>.</p>",
      { markdown: true, url }
    );
    expect(markdown).toBe(
      "Wir **bauen** schnelle**Websites** *für alle*, **doppelt**."
    );
  });

  test("leaves out markers around whitespace and empty elements", async () => {
    const { markdown } = await parseHtml(
      '<p>Ein<strong> </strong>Wort <em></em><i class="icon"></i>und <b>\n</b>mehr</p>',
      { markdown: true, url }
    );
    expect(markdown).toBe("Ein Wort und mehr");
  });

  test("writes emphasis inside and around links", async () => {
    const { markdown } = await parseHtml(
      '<p><a href="/a"><strong>Neu</strong> und <em>schnell</em></a> <em><a href="/b">Blog</a></em> <strong><a href="/c"><svg></svg></a></strong></p>',
      { markdown: true, url }
    );
    expect(markdown).toBe(
      "[**Neu** und *schnell*](https://example.com/a) *[Blog](https://example.com/b)*"
    );
  });

  test("writes emphasis across blocks as plain text", async () => {
    const { markdown } = await parseHtml(
      "<strong><p>Eins</p><p>Zwei</p></strong><h2><em>Titel</em></h2>",
      { markdown: true, url }
    );
    expect(markdown).toBe("Eins\n\nZwei\n\n## *Titel*");
  });

  test("formats only inside the context and skips hidden content", async () => {
    const { markdown } = await parseHtml(
      '<p><b>Außen</b></p><main><p><b>Innen</b><em aria-hidden="true">Icon</em></p></main>',
      { context: "main", markdown: true, url }
    );
    expect(markdown).toBe("**Innen**");
  });
});
