import { describe, expect, test } from "vitest";

import { parseHtml, parseHtmlSync } from "../src/index.ts";

const url = "https://example.com/guides/start/";
const html = `<main><h1>Grüße &amp; 👩‍💻</h1>
  <p><a href="next/?page=2&amp;lang=de">Next</a>
  <a href="../other/">Other</a><img src="image.webp" alt="Müller"></p>
  <p><code>&amp;lt;</code></p>
  <pre><code>&amp;lt;  x\n\n\n  y</code></pre></main>`;

describe("Markdown", () => {
  test("uses the page URL for relative links and images with defaults or custom options", async () => {
    await Promise.all(
      [true, { plugins: { filter: { include: ["main"] } } }].map(
        async (markdown) => {
          const result = parseHtmlSync(html, { markdown, url });
          expect(result.markdown).toContain(
            "[Next](https://example.com/guides/start/next/?page=2&lang=de)"
          );
          expect(result.markdown).toContain(
            "[Other](https://example.com/guides/other/)"
          );
          expect(result.markdown).toContain(
            "![Müller](https://example.com/guides/start/image.webp)"
          );
          expect(
            await parseHtml(new Response(html), { markdown, url })
          ).toEqual(result);
        }
      )
    );
  });

  test("honours an explicit Markdown origin override", () => {
    const result = parseHtmlSync(html, {
      markdown: { origin: "https://cdn.example.com/assets/" },
      url,
    });
    expect(result.markdown).toContain(
      "![Müller](https://cdn.example.com/assets/image.webp)"
    );
  });

  test("keeps UTF-8 characters across one-byte stream chunks and does not decode entities twice", async () => {
    const bytes = new TextEncoder().encode(html);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) {
          controller.enqueue(new Uint8Array([byte]));
        }
        controller.close();
      },
    });
    const result = parseHtmlSync(html, { markdown: true, url });
    expect(await parseHtml(stream, { markdown: true, url })).toEqual(result);
    expect(result.markdown).toContain("# Grüße & 👩‍💻");
    expect(result.markdown).toContain("`&lt;`");
    expect(result.markdown).toContain("```\n&lt;  x\n\n\n  y\n```");
  });
});
