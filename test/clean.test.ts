import { expect, test } from "vitest";

import { cleanHtml, markdownWithAi } from "../src/index.ts";

const url = "https://example.com/";

test("removes what is asked and always strips EXIF and binary data", async () => {
  const html = `<html><head><meta name="x" content="y"><link rel="stylesheet" href="/a.css"><style>p{}</style></head>
    <body><!-- note --><p id="a" class="b" style="color:red">Text&shy;teil<wbr></p>
    <script>alert(1)</script><svg></svg><img src="/i.png"><div aria-hidden="true">hidden</div>
    <div id="brlbs-cmpnt-dialog">Cookies</div>
    <span class="elementor-icon"><!--?xpacket begin="" id="W5M0Mp"?--><x:xmpmeta><rdf:RDF>blob</rdf:RDF></x:xmpmeta>ExifII*\u0000\u0000 Photoshop 3.0 8BIM</span></body></html>`;
  const cleaned = await cleanHtml(html, {
    remove: {
      ariaHidden: true,
      classes: true,
      comments: true,
      cookieConsent: true,
      hyphenation: true,
      ids: true,
      images: true,
      linkTags: true,
      meta: true,
      scripts: true,
      styles: true,
    },
    url,
  });
  for (const gone of [
    "<meta",
    "<link",
    "<style",
    "note",
    'id="a"',
    'class="b"',
    "color:red",
    "&shy;",
    "<wbr",
    "<script",
    "<svg",
    "<img",
    "hidden",
    "Cookies",
    "xpacket",
    "xmpmeta",
    "ExifII",
    "8BIM",
  ]) {
    expect(cleaned).not.toContain(gone);
  }
  expect(cleaned).toContain("<p>Textteil</p>");
});

test("keeps everything but EXIF data by default", async () => {
  const cleaned = await cleanHtml(
    '<p class="b"><!-- c --><script>x</script>Text</p>',
    { url }
  );
  expect(cleaned).toBe('<p class="b"><!-- c --><script>x</script>Text</p>');
});

test("unwraps links that the filter does not keep and limits to a context", async () => {
  const cleaned = await cleanHtml(
    '<header><a href="/h">Head</a></header><main><a href="/in">In</a> <a href="https://out.org">Out</a></main>',
    { context: "main", links: { kinds: ["internal"] }, url }
  );
  expect(cleaned).toBe('<main><a href="/in">In</a> Out</main>');
});

test("converts cleaned HTML with Workers AI when asked", async () => {
  let received = "";
  const markdown = await markdownWithAi(
    {
      toMarkdown: async ([file]) => {
        received = (await file?.blob.text()) ?? "";
        return [{ data: "# Title", format: "markdown" }];
      },
    },
    '<h1 class="x">Title</h1><script>x</script><img src="/a.png">',
    { url }
  );
  expect(markdown).toBe("# Title");
  expect(received).toBe("<h1>Title</h1>");
});
