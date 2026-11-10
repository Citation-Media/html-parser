import { describe, expect, test } from "vitest";

import { parseHtml } from "../src/index.ts";

const url = "https://firma.de/";

/** Text as the bytes of a single-byte encoding such as ISO-8859-1, where ü is one byte. */
const latin1 = (text: string) =>
  Uint8Array.from(text, (character) => character.codePointAt(0) ?? 0);

const utf16le = (text: string) => {
  const bytes = new Uint8Array(text.length * 2);
  for (const [index, character] of [...text].entries()) {
    const unit = character.codePointAt(0) ?? 0;
    bytes[index * 2] = unit % 256;
    bytes[index * 2 + 1] = Math.floor(unit / 256);
  }
  return bytes;
};

const joined = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

const chunked = (bytes: Uint8Array, size: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += size) {
        controller.enqueue(bytes.slice(index, index + size));
      }
      controller.close();
    },
  });

const titleOf = async (
  input: Response | ReadableStream<Uint8Array>,
  encoding?: string
) => {
  const { meta } = await parseHtml(input, { encoding, meta: true, url });
  return meta?.title;
};

const page = (head = "") =>
  `<html><head>${head}<title>Grüße aus Köln</title></head><body><h1>Straße</h1></body></html>`;

describe("encoding", () => {
  test("reads the encoding a response's Content-Type names", async () => {
    const response = new Response(latin1(page()), {
      headers: { "content-type": 'text/html; charset="ISO-8859-1"' },
    });
    expect(await titleOf(response)).toBe("Grüße aus Köln");
  });

  test("reads a meta charset in the page's first bytes, however it is chunked", async () => {
    const heads = [
      '<meta charset="windows-1252">',
      "<meta charset=iso-8859-1>",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=ISO-8859-1">',
    ];
    const titles = await Promise.all(
      heads.flatMap((head) =>
        [1, 7, 4096].map((size) => titleOf(chunked(latin1(page(head)), size)))
      )
    );
    expect(new Set(titles)).toEqual(new Set(["Grüße aus Köln"]));
  });

  test("decodes the Markdown from the same text", async () => {
    const { headings, markdown } = await parseHtml(
      chunked(latin1(page('<meta charset="iso-8859-1">')), 5),
      { headings: true, markdown: true, url }
    );
    expect(headings).toEqual([{ level: 1, text: "Straße" }]);
    expect(markdown).toContain("# Straße");
    expect(markdown).not.toContain("�");
  });

  test("takes a byte order mark over what the header and the page say", async () => {
    const utf8 = joined(
      Uint8Array.of(0xef, 0xbb, 0xbf),
      new TextEncoder().encode(page('<meta charset="iso-8859-1">'))
    );
    const response = new Response(utf8, {
      headers: { "content-type": "text/html; charset=iso-8859-1" },
    });
    expect(await titleOf(response)).toBe("Grüße aus Köln");
    const wide = joined(Uint8Array.of(0xff, 0xfe), utf16le(page()));
    expect(await titleOf(chunked(wide, 3))).toBe("Grüße aus Köln");
  });

  test("takes the caller's encoding over the header and the page", async () => {
    const bytes = latin1(page('<meta charset="utf-8">'));
    expect(await titleOf(chunked(bytes, 64), "windows-1252")).toBe(
      "Grüße aus Köln"
    );
    const response = new Response(bytes, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    expect(await titleOf(response, "latin1")).toBe("Grüße aus Köln");
  });

  test("reads UTF-8 where nothing says otherwise, or only says what it cannot be", async () => {
    const utf8 = (head: string) => new TextEncoder().encode(page(head));
    const heads = [
      "",
      '<meta charset="no-such-encoding">',
      '<meta charset="utf-16">',
      '<!-- <meta charset="iso-8859-1"> -->',
      `<!-- ${"x".repeat(1024)} --><meta charset="iso-8859-1">`,
    ];
    const titles = await Promise.all(
      heads.map((head) => titleOf(chunked(utf8(head), 100)))
    );
    expect(new Set(titles)).toEqual(new Set(["Grüße aus Köln"]));
  });
});
