import {
  collapseWhitespace,
  decodeEntities,
  looksBinary,
  removeHyphenation,
} from "./text.ts";

/** A code block's language cleaned to the characters of names such as `c++`, `c#`, or `objective-c`. */
export const languageName = (value: string | null | undefined) =>
  value?.replaceAll(/[^\w#+.-]/gu, "") ?? "";

/**
 * Backticks around inline code: one more than the longest run inside, padded with spaces when the
 * code has backticks, so CommonMark reads the code as written.
 */
const codeFence = (code: string) => {
  const longest = Math.max(
    0,
    ...(code.match(/`+/gu) ?? []).map((run) => run.length)
  );
  const fence = "`".repeat(longest + 1);
  return longest === 0 ? [fence, fence] : [`${fence} `, ` ${fence}`];
};

/** Inline formatting: strong and emphasized text by their marker, and inline code. */
export type InlineKind = "**" | "*" | "code";

/**
 * An open inline element: where its opening marker goes once its content is known, or `undefined`
 * when it is written as plain text, such as bold text inside a code block.
 */
type Span = { index: number; kind: InlineKind } | undefined;

/**
 * Builds Markdown from parser events while the page streams through: blocks for headings,
 * paragraphs, list items, quotes, and table rows, inline links, images, bold and italic text, and
 * inline code, and code blocks that keep their whitespace and name their language. It follows
 * HTMLRewriter's limits: tables have no alignment, and inline formatting across lines or blocks is
 * written as plain text.
 */
export class MarkdownWriter {
  readonly #parts: string[] = [];
  #text: string[] = [];
  #length = 0;
  readonly #maxLength: number;
  readonly #links: ({ index: number; href: string } | undefined)[] = [];
  readonly #lists: { ordered: boolean; count: number }[] = [];
  readonly #spans: Span[] = [];
  /** Opening fences of open code blocks, which a `<code>` inside can still give a language. */
  readonly #fences: { index: number; language: boolean }[] = [];
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
      this.#fences.push({ index: this.#parts.length, language: false });
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
      this.#fences.pop();
      this.#push("\n```\n\n");
    } else if (tag !== "li" && tag !== "tr") {
      // List items and table rows end where the next one starts, so lists stay tight.
      this.#push("\n\n");
    }
  }

  /** Names the language of the open code block, whose fence is already written, unless it has one. */
  codeLanguage(language: string) {
    const fence = this.#fences.at(-1);
    if (
      !fence ||
      fence.language ||
      !language ||
      fence.index >= this.#parts.length
    ) {
      return;
    }
    fence.language = true;
    this.#set(fence.index, `\n\n\`\`\`${language}\n`);
  }

  /**
   * Starts bold or italic text or inline code. Its marker waits for the content: formatting around
   * only whitespace is left out, and spaces at its edges go outside, since `** text**` is no bold.
   */
  openInline(kind: InlineKind) {
    this.#flush();
    // Code shows its characters as written, and a marker inside the same marker would end it.
    const plain =
      this.#preformatted > 0 ||
      this.full ||
      this.#spans.some((span) => span?.kind === "code" || span?.kind === kind);
    this.#spans.push(plain ? undefined : { index: this.#parts.length, kind });
    if (!plain) {
      this.#push("");
    }
  }

  closeInline() {
    this.#flush();
    const span = this.#spans.pop();
    if (!span || span.index >= this.#parts.length || this.full) {
      return;
    }
    const content = this.#parts.slice(span.index + 1).join("");
    const inner = content.trim();
    // Formatting across lines or blocks, such as two paragraphs, would not hold together.
    if (!inner || inner.includes("\n")) {
      return;
    }
    const [open, close] =
      span.kind === "code" ? codeFence(inner) : [span.kind, span.kind];
    this.#trimFrom(span.index + 1);
    this.#set(
      span.index,
      `${content.slice(0, content.length - content.trimStart().length)}${open}`
    );
    this.#push(`${close}${content.slice(content.trimEnd().length)}`);
  }

  openLink(href: string) {
    this.#flush();
    // Inside inline code, a link is its text: Markdown would show [text](url) literally.
    if (this.#inCode) {
      this.#links.push(undefined);
      return;
    }
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
    if (this.#inCode) {
      return;
    }
    this.#push(`![${collapseWhitespace(alt).trim()}](${src})`);
  }

  toString() {
    this.#flush();
    // Code blocks keep their whitespace; everything between them is tidied. Their fences stand on
    // lines of their own, unlike the backticks of inline code.
    return this.#parts
      .join("")
      .split(/(?<code>^```[\w#+.-]*\n[\s\S]*?\n```$)/mu)
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
    if (this.#preformatted > 0) {
      this.#push(raw);
      return;
    }
    // Inline elements split text into runs; a space between two runs is still one space.
    const text = collapseWhitespace(raw);
    const before = this.#parts.findLast(Boolean) ?? "";
    this.#push(before.endsWith(" ") ? text.replace(/^ /u, "") : text);
  }

  get #inCode() {
    return this.#spans.some((span) => span?.kind === "code");
  }

  /** Moves whitespace at the edges of the parts from `start` on out of them, see `closeInline`. */
  #trimFrom(start: number) {
    for (let index = start; index < this.#parts.length; index += 1) {
      const part = (this.#parts[index] ?? "").trimStart();
      this.#set(index, part);
      if (part) {
        break;
      }
    }
    for (let index = this.#parts.length - 1; index >= start; index -= 1) {
      const part = (this.#parts[index] ?? "").trimEnd();
      this.#set(index, part);
      if (part) {
        break;
      }
    }
  }

  #set(index: number, part: string) {
    this.#length += part.length - (this.#parts[index] ?? "").length;
    this.#parts[index] = part;
  }

  #push(part: string) {
    if (!this.full) {
      this.#parts.push(part);
      this.#length += part.length;
    }
  }
}
