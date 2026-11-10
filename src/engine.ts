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
 * converter, unchanged, over the same input. A stream's bytes are decoded here, by the encoding the
 * page declares, before either reads them.
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

// How many bytes a browser reads before it settles on a page's encoding.
const prescanLength = 1024;

// `<meta charset="…">`, or the charset in the `content` of `<meta http-equiv="Content-Type">`.
const metaCharset = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*(?<label>[\w:.-]+)/iu;

const headerCharset = /charset\s*=\s*["']?(?<label>[^"';\s]+)/iu;

/** The encoding a response's `Content-Type` names. */
const charsetOf = (input: Response | ReadableStream<Uint8Array | string>) =>
  input instanceof Response
    ? headerCharset.exec(input.headers.get("content-type") ?? "")?.groups?.label
    : undefined;

const bomEncoding = ([first, second, third]: Uint8Array) => {
  if (first === 0xef && second === 0xbb && third === 0xbf) {
    return "utf-8";
  }
  if (first === 0xfe && second === 0xff) {
    return "utf-16be";
  }
  return first === 0xff && second === 0xfe ? "utf-16le" : undefined;
};

/** The encoding a `<meta>` in the page's first bytes names, comments left out. */
const metaEncoding = (start: Uint8Array) => {
  const head = new TextDecoder("windows-1252")
    .decode(start.subarray(0, prescanLength))
    .replaceAll(/<!--[\s\S]*?-->/gu, "");
  const label = metaCharset.exec(head)?.groups?.label?.toLowerCase();
  // A page whose <meta> reads as ASCII is not UTF-16, whatever it says; HTML takes UTF-8 then.
  if (label?.startsWith("utf-16")) {
    return "utf-8";
  }
  return label === "x-user-defined" ? "windows-1252" : label;
};

/** A decoder for an encoding label, or nothing where the runtime does not know the label. */
const decoderFor = (label: string | undefined) => {
  if (!label) {
    return;
  }
  try {
    return new TextDecoder(label);
  } catch {
    // A label the runtime does not know leaves the next source to decide.
  }
};

/**
 * The decoder for a page's bytes, settled as HTML settles the encoding: a byte order mark first,
 * then what the caller or the response's `Content-Type` declares, then a `<meta charset>` in the
 * first 1,024 bytes, and UTF-8 where nothing says otherwise.
 */
const decoderOf = (start: Uint8Array, declared: string | undefined) =>
  decoderFor(bomEncoding(start)) ??
  decoderFor(declared) ??
  decoderFor(metaEncoding(start)) ??
  new TextDecoder();

/** Decodes a stream's chunks, holding its first bytes back until their encoding is settled. */
const decoding = (declared: string | undefined) => {
  let decoder: TextDecoder | undefined;
  let held = new Uint8Array(0);
  const settle = () => {
    decoder = decoderOf(held, declared);
    const text = decoder.decode(held, { stream: true });
    held = new Uint8Array(0);
    return text;
  };
  const hold = (chunk: Uint8Array) => {
    const joined = new Uint8Array(held.length + chunk.length);
    joined.set(held);
    joined.set(chunk, held.length);
    held = joined;
    return held.length < prescanLength ? "" : settle();
  };
  return {
    end() {
      const text = decoder || held.length === 0 ? "" : settle();
      return text + (decoder?.decode() ?? "");
    },
    write(chunk: Uint8Array | string) {
      if (chunk instanceof Uint8Array) {
        return decoder ? decoder.decode(chunk, { stream: true }) : hold(chunk);
      }
      // Text needs no decoding; bytes held before it are read first.
      return (decoder || held.length === 0 ? "" : settle()) + chunk;
    },
  };
};

/** The stream's Markdown, or the failure of the conversion, which its caller throws at the end. */
const convertStream = async (
  body: ReadableStream<string>,
  options: MarkdownOptions
): Promise<string | Error> => {
  let output = "";
  try {
    for await (const chunk of streamHtmlToMarkdown(body, options)) {
      output += chunk;
    }
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return output;
};

/** How a streamed page is converted to Markdown alongside the tokenizer. */
export interface Conversion {
  /** mdream's options, asked for when the conversion starts. */
  options: () => MarkdownOptions;
  /**
   * Whether the options are final, asked after each chunk the tokenizer has read; the text read
   * until then is held back, so what the page's head says can still shape the options.
   */
  settled: () => boolean;
}

/** Feeds mdream's converter the text the tokenizer has read, from where its options are final. */
const converting = ({ options, settled }: Conversion) => {
  const held: string[] = [];
  let feed: ReadableStreamDefaultController<string> | undefined;
  let output: Promise<string | Error> | undefined;
  const start = () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        feed = controller;
      },
    });
    output = convertStream(stream, options());
    for (const text of held) {
      feed?.enqueue(text);
    }
    held.length = 0;
  };
  return {
    /** Ends the page and returns its Markdown. */
    async end() {
      if (!feed) {
        start();
      }
      feed?.close();
      const converted = await output;
      if (converted instanceof Error) {
        throw converted;
      }
      return converted ?? "";
    },
    /** Ends the conversion after the tokenizer failed, and returns its own failure, if any. */
    async failure() {
      try {
        feed?.close();
      } catch {
        // The converter has already ended the stream.
      }
      const converted = await output;
      return converted instanceof Error ? converted : undefined;
    },
    write(text: string) {
      if (feed) {
        feed.enqueue(text);
        return;
      }
      held.push(text);
      if (settled()) {
        start();
      }
    },
  };
};

export interface StreamOptions {
  /** The encoding the caller knows the bytes to have; a response's `Content-Type` otherwise. */
  encoding?: string;
  /** Converts the page to Markdown alongside. */
  conversion?: Conversion;
  /** Collects the decoded text, for a second pass. */
  keep?: string[];
}

/**
 * Tokenizes a streamed page chunk by chunk, so memory stays near one chunk, and converts it to
 * Markdown alongside when asked. Bytes are decoded once, by the encoding the page declares, for
 * the tokenizer and the converter alike.
 */
export const scanStream = async (
  input: Response | ReadableStream<Uint8Array | string>,
  handlers: Handlers,
  { conversion, encoding, keep }: StreamOptions = {}
): Promise<string | undefined> => {
  const body = bodyOf(input);
  if (!body) {
    scanText("", handlers);
    return conversion ? "" : undefined;
  }
  const run = tokenizer(handlers);
  const decode = decoding(encoding ?? charsetOf(input));
  const markdown = conversion && converting(conversion);
  let rest = "";
  const read = (text: string) => {
    if (text) {
      keep?.push(text);
      rest = run.write(rest + text);
      markdown?.write(text);
    }
  };
  try {
    for await (const chunk of body) {
      read(decode.write(chunk));
    }
    read(decode.end());
    run.end(rest);
  } catch (error) {
    // A converter that failed first is why the feed broke; its failure is the one to report.
    throw (await markdown?.failure()) ?? error;
  }
  return markdown?.end();
};
