import { htmlToMarkdown, streamHtmlToMarkdown, TEXT_NODE } from "@mdream/js";
import type {
  ElementNode,
  MdreamOptions,
  Node,
  NodeEvent,
  TextNode,
} from "@mdream/js";
import { finalizeParse, parseHtmlStream } from "@mdream/js/parse";
import type { ParseState } from "@mdream/js/parse";

/**
 * Drives mdream's HTML tokenizer, which runs in plain JavaScript in any runtime, and hands its
 * events to one set of handlers. The tokenizer is tuned for Markdown: it drops whitespace before an
 * element's first text and collapses it in `<style>`. The pass keeps both as the page has them, so
 * texts read like a DOM's and CSS stays exact. Markdown, when asked for, comes from mdream's own
 * converter, unchanged, over the same input.
 */

/** A page as text, as a `Response` such as a `fetch` result, or as a stream of its body. */
export type HtmlInput = string | Response | ReadableStream<Uint8Array | string>;

export interface Handlers {
  enter: (element: ElementNode) => void;
  exit: (element: ElementNode) => void;
  /** Text with entities decoded; outside raw text such as scripts, whitespace is collapsed. */
  text: (value: string) => void;
}

/** Options for mdream's converter. */
export type MarkdownOptions = MdreamOptions;

// Room for every tag id mdream assigns; it uses about 120.
const tagIds = 1024;

const isText = (node: Node): node is TextNode => node.type === TEXT_NODE;

const isElement = (node: Node): node is ElementNode => node.type !== TEXT_NODE;

const freshState = (): ParseState => ({
  depth: 0,
  depthMap: new Uint16Array(tagIds),
  plainText: true,
});

let preformatted: number | undefined;

/** mdream's tag id for <pre>, read from the tokenizer itself, so it holds across versions. */
const preId = () => {
  if (preformatted === undefined) {
    parseHtmlStream("<pre>", freshState(), ({ node }) => {
      if (isElement(node)) {
        preformatted ??= node.tagId;
      }
    });
    preformatted ??= -1;
  }
  return preformatted;
};

const tokenizer = (handlers: Handlers) => {
  const { enter, exit, text } = handlers;
  const state = freshState();
  const pre = preId();
  // Inside <style>, whitespace counts as in <pre>: kept as written.
  const preformat = (by: number) => {
    if (pre >= 0) {
      state.depthMap[pre] = Math.max(0, (state.depthMap[pre] ?? 0) + by);
    }
  };
  const onEvent = ({ node, type }: NodeEvent) => {
    if (isText(node)) {
      if (type === 0) {
        text(node.value);
      }
      return;
    }
    if (!isElement(node)) {
      return;
    }
    if (type === 0) {
      // Counted as holding text already, an element keeps whitespace before its first text.
      node.childTextNodeIndex ||= 1;
      if (node.name === "style") {
        preformat(1);
      }
      enter(node);
    } else {
      if (node.name === "style") {
        preformat(-1);
      }
      exit(node);
    }
  };
  return {
    end(rest: string) {
      finalizeParse(
        rest ? parseHtmlStream(rest, state, onEvent) : "",
        state,
        onEvent
      );
    },
    write(html: string) {
      return parseHtmlStream(html, state, onEvent);
    },
  };
};

/** Tokenizes a page held as text. */
export const scanText = (html: string, handlers: Handlers) => {
  const run = tokenizer(handlers);
  run.end(run.write(html));
};

/** Converts a page held as text to Markdown with mdream. */
export const markdownOf = (html: string, options: MarkdownOptions) =>
  htmlToMarkdown(html, options);

const bodyOf = (input: Response | ReadableStream<Uint8Array | string>) =>
  input instanceof Response ? input.body : input;

const tokenizeStream = async (
  body: ReadableStream<Uint8Array | string>,
  handlers: Handlers,
  keep: string[] | undefined
) => {
  const run = tokenizer(handlers);
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of body) {
    const text =
      chunk instanceof Uint8Array
        ? decoder.decode(chunk, { stream: true })
        : chunk;
    keep?.push(text);
    rest = run.write(rest + text);
  }
  const tail = decoder.decode();
  keep?.push(tail);
  run.end(rest + tail);
};

const convertStream = async (
  body: ReadableStream<Uint8Array | string>,
  options: MarkdownOptions
) => {
  let output = "";
  for await (const chunk of streamHtmlToMarkdown(body, options)) {
    output += chunk;
  }
  return output;
};

/**
 * Tokenizes a streamed page chunk by chunk, so memory stays near one chunk, and converts it to
 * Markdown alongside when asked; `keep` collects the decoded text for a second pass.
 */
export const scanStream = async (
  input: Response | ReadableStream<Uint8Array | string>,
  handlers: Handlers,
  markdown: MarkdownOptions | undefined,
  keep?: string[]
): Promise<string | undefined> => {
  const body = bodyOf(input);
  if (!body) {
    scanText("", handlers);
    return markdown ? "" : undefined;
  }
  if (!markdown) {
    await tokenizeStream(body, handlers, keep);
    return undefined;
  }
  const [facts, converted] = body.tee();
  const [, output] = await Promise.all([
    tokenizeStream(facts, handlers, keep),
    convertStream(converted, markdown),
  ]);
  return output;
};
