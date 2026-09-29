import {
  collapseWhitespace,
  decodeEntities,
  looksBinary,
  removeHyphenation,
} from "./text.ts";

/**
 * Builds Markdown from parser events while the page streams through: blocks for headings,
 * paragraphs, list items, quotes, and table rows, inline links and images, and preformatted text
 * that keeps its whitespace. It follows HTMLRewriter's limits: no aligned tables, and formatting such
 * as bold or italic is dropped, because the content, not its styling, is what the output is for.
 */
export class MarkdownWriter {
  readonly #parts: string[] = [];
  #text: string[] = [];
  #length = 0;
  readonly #maxLength: number;
  readonly #links: { index: number; href: string }[] = [];
  readonly #lists: { ordered: boolean; count: number }[] = [];
  #preformatted = 0;

  constructor(maxLength: number) {
    this.#maxLength = maxLength;
  }

  get full() {
    return this.#length >= this.#maxLength;
  }

  text(chunk: string) {
    if (!this.full) {
      this.#text.push(chunk);
    }
  }

  /** Starts a block such as `h2`, `p`, `li`, `blockquote`, `tr`, or `pre`. */
  open(tag: string) {
    this.#flush();
    const level = /^h(?<level>[1-6])$/u.exec(tag)?.groups?.level;
    if (level) {
      this.#push(`\n\n${"#".repeat(Number(level))} `);
    } else if (tag === "li") {
      const list = this.#lists.at(-1);
      if (list?.ordered) {
        list.count += 1;
      }
      const indent = "  ".repeat(Math.max(0, this.#lists.length - 1));
      this.#push(`\n${indent}${list?.ordered ? `${list.count}.` : "-"} `);
    } else if (tag === "ul" || tag === "ol") {
      this.#lists.push({ count: 0, ordered: tag === "ol" });
      this.#push("\n");
    } else if (tag === "blockquote") {
      this.#push("\n\n> ");
    } else if (tag === "tr") {
      this.#push("\n|");
    } else if (tag === "td" || tag === "th") {
      this.#push(" ");
    } else if (tag === "pre") {
      this.#preformatted += 1;
      this.#push("\n\n```\n");
    } else if (tag === "br") {
      this.#push("\n");
    } else if (tag === "hr") {
      this.#push("\n\n---\n\n");
    } else {
      this.#push("\n\n");
    }
  }

  /** Ends a block; blocks without an end tag end when the next one opens. */
  close(tag: string) {
    this.#flush();
    if (tag === "ul" || tag === "ol") {
      this.#lists.pop();
      this.#push("\n");
    } else if (tag === "td" || tag === "th") {
      this.#push(" |");
    } else if (tag === "pre") {
      this.#preformatted = Math.max(0, this.#preformatted - 1);
      this.#push("\n```\n\n");
    } else if (tag !== "li" && tag !== "tr") {
      // List items and table rows end where the next one starts, so lists stay tight.
      this.#push("\n\n");
    }
  }

  openLink(href: string) {
    this.#flush();
    this.#links.push({ href, index: this.#parts.length });
    this.#push("[");
  }

  closeLink() {
    this.#flush();
    const link = this.#links.pop();
    if (!link) {
      return;
    }
    // A link without text, such as an icon, keeps nothing: an empty [](url) helps no reader.
    const label = this.#parts
      .slice(link.index + 1)
      .join("")
      .trim();
    if (!label) {
      this.#parts.splice(link.index);
      return;
    }
    this.#push(`](${link.href})`);
  }

  image(alt: string, src: string) {
    this.#flush();
    this.#push(`![${collapseWhitespace(alt).trim()}](${src})`);
  }

  toString() {
    this.#flush();
    // Code blocks keep their whitespace; everything between them is tidied.
    return this.#parts
      .join("")
      .split(/(?<code>```[\s\S]*?```)/u)
      .map((segment) =>
        segment.startsWith("```")
          ? segment
          : segment
              .replaceAll(/[ \t]+\n/gu, "\n")
              .replaceAll(/\n[ \t]+(?=[^-\d> ])/gu, "\n")
      )
      .join("")
      .replaceAll(/\n{3,}/gu, "\n\n")
      .trim()
      .slice(0, this.#maxLength);
  }

  #flush() {
    if (this.#text.length === 0) {
      return;
    }
    const raw = removeHyphenation(decodeEntities(this.#text.join("")));
    this.#text = [];
    if (looksBinary(raw)) {
      return;
    }
    this.#push(this.#preformatted > 0 ? raw : collapseWhitespace(raw));
  }

  #push(part: string) {
    if (!this.full) {
      this.#parts.push(part);
      this.#length += part.length;
    }
  }
}
