import type { ElementNode } from "@mdream/js";

import { markdownOf, scanStream, scanText } from "./engine.ts";
import type { Handlers, HtmlInput, MarkdownOptions } from "./engine.ts";
import { isHeadTag, readHead } from "./head.ts";
import type { HeadOptions, OpenHeadElement, PageHead } from "./head.ts";
import {
  emptyHydration,
  hydrationOf,
  readIsland,
  readScriptEnd,
  readScriptStart,
  readScriptText,
} from "./hydration.ts";
import type { AstroIsland, Hydration, HydrationState } from "./hydration.ts";
import {
  closeContainers,
  emptyLayout,
  hidesContent,
  positionOf,
  readElement,
  readText,
  spotOf,
} from "./layout.ts";
import type { Layout, ScreenPosition, Spot } from "./layout.ts";
import { compileSelector } from "./selector.ts";
import type { Frame as SelectorFrame, Matcher } from "./selector.ts";
import {
  maxBlockLength,
  maxBlocks,
  readStructuredData,
} from "./structured-data.ts";
import type { StructuredData } from "./structured-data.ts";
import { collapseWhitespace, removeHyphenation } from "./text.ts";
import { absoluteUrl, isResource, linkKind } from "./urls.ts";
import type { LinkKind } from "./urls.ts";

/**
 * One pass over a page with mdream's tokenizer, which never builds a DOM and runs in any JavaScript
 * runtime: it collects links, images, resources, metadata, headings, class counts, JSON-LD, styles,
 * hydration, visible text, and inline code. When asked, mdream also writes the page as Markdown
 * from the same input; a streamed page is then read once for both. A stream is read chunk by chunk.
 */

export type { HtmlInput, MarkdownOptions } from "./engine.ts";

export interface Link {
  url: string;
  /** Visible text of the first link to this URL. */
  text: string;
  kind: LinkKind;
  /** Whether the URL points to a file download such as a PDF. */
  resource: boolean;
  /** How often the page links to this URL. */
  count: number;
  rel?: string;
  target?: string;
  /** `aria-label` of the first link, which names links whose text does not. */
  label?: string;
  /** With the `hidden` option: whether every link to this URL is in hidden content. */
  hidden?: boolean;
}

export interface Image {
  url: string;
  /** `null` when the attribute is missing, `""` when the image is marked as decorative. */
  alt: string | null;
  width?: string;
  height?: string;
  loading?: string;
  srcset: boolean;
  /** The absolute URLs of its `srcset`, where it has one, at most `maxSources`. */
  sources?: string[];
  /** Where its first occurrence is expected on a desktop visit, with the `positions` option. */
  position?: ScreenPosition;
  /** With the `hidden` option: whether every occurrence of this image is in hidden content. */
  hidden?: boolean;
}

export interface Script {
  src?: string;
  type?: string;
  /** Names of the element's attributes, for consent markers such as `data-cookieconsent`. */
  attributes: string[];
  /** Whether it stands in the `<head>`, where a classic script without `async` or `defer` blocks. */
  head: boolean;
}

export interface Resources {
  scripts: Script[];
  frames: string[];
  /**
   * `<link>` elements with their `rel`, such as stylesheets and preconnects, and their `type`
   * where they have one, such as `text/markdown` for a Markdown version of the page.
   */
  links: { href: string; rel: string; type?: string }[];
  /**
   * The absolute URLs of audio, video, their `<source>`s and `<track>`s, a `<picture>`'s sources,
   * `<embed>`s, and `<object>`s, each once; what a page loads besides scripts, frames, and images.
   */
  media: string[];
}

export interface Meta {
  title?: string;
  description?: string;
  language?: string;
  canonical?: string;
  robots?: string;
  viewport?: string;
  generator?: string;
  image?: string;
  /**
   * Every `<meta property>` such as `og:title` or `article:published_time`, by its lower-cased
   * property, the first one where a property repeats, at most `maxProperties`.
   */
  properties?: Record<string, string>;
}

export interface Heading {
  level: number;
  text: string;
  /** With the `hidden` option: whether the heading is in hidden content. */
  hidden?: boolean;
}

/**
 * Decides whether an element hides its content, given what `hidesContent` says about its markup
 * (`byMarkup`). A caller keeps a popup's imprint with `(tag, attributes, byMarkup) => byMarkup &&
 * !attributes.class?.includes("popup")`, or hides screen-reader-only text as well.
 */
export type HiddenRule = (
  tag: string,
  attributes: Record<string, string>,
  byMarkup: boolean
) => boolean;

/** The page's own CSS, for `readStyles`: what it writes inline and which stylesheets it loads. */
export interface PageStyles {
  /** Each <style> block's text, with its `id` where it has one, such as `global-styles-inline-css`. */
  blocks: { css: string; id?: string }[];
  /** Each style attribute with its element, such as `div#hero.banner`. */
  attributes: { css: string; element: string }[];
  /** Stylesheets the page loads, absolute: `rel="stylesheet"` and stylesheets preloaded as styles. */
  stylesheets: string[];
}

/** The text a visitor reads, without the head, scripts, styles, templates, `<noscript>`, and SVG. */
export interface VisibleText {
  /** Characters of the whole text, with whitespace collapsed. */
  length: number;
  /** The text, cut at `maxLength`. */
  content: string;
}

/**
 * What a Content Security Policy has to allow for the page's own code: the inline scripts a
 * browser runs, which need hashes or a nonce, and the inline styles, event handler attributes,
 * `javascript:` URLs, and form targets.
 */
export interface InlineCode {
  /** The text of each inline script a browser runs, exactly as written; data blocks are left out. */
  scripts: string[];
  /** Event handler attributes such as `onclick`. */
  eventHandlers: number;
  /** `javascript:` URLs in `href`, `src`, `action`, and `formaction`. */
  javascriptUrls: number;
  styleElements: number;
  /** Elements with a non-empty `style` attribute. */
  styleAttributes: number;
  /** The absolute targets forms send to, each once. */
  formActions: string[];
}

export interface LinkFilter {
  /** Kinds to keep; all when not set. */
  kinds?: LinkKind[];
  /** Whether to keep links to downloads such as PDFs. Default true. */
  resources?: boolean;
}

export interface ParseOptions {
  /** The page's address, to resolve relative URLs and tell internal links from external ones. */
  url: string | URL;
  links?: boolean | LinkFilter;
  images?: boolean;
  resources?: boolean;
  meta?: boolean;
  headings?: boolean;
  /** Counts elements whose class starts with a prefix, such as page builders' `elementor-`. */
  classPrefixes?: string[];
  /**
   * Collects only inside elements matching this CSS selector, such as `main` or `article`. When
   * nothing matches, the whole page counts.
   */
  context?: string;
  /** Reads the page's JSON-LD blocks, wherever they are, as `structuredData`. */
  structuredData?: boolean;
  /** Collects the page's <style> blocks, style attributes, and stylesheet addresses as `styles`. */
  styles?: boolean;
  /** Detects the framework that hydrates the page and measures its data as `hydration`. */
  hydration?: boolean;
  /**
   * Estimates where images and Astro islands are on a desktop visit before scrolling, as their
   * `position`, from the markup alone. Read regardless of `context`.
   */
  positions?: boolean;
  /**
   * Marks links, images, and headings inside hidden content with `hidden`: what `hidesContent`
   * reads from the markup, or what a `HiddenRule` decides given it. With `positions`, the same
   * decision tells which containers hide their content.
   */
  hidden?: boolean | HiddenRule;
  /** The visible text, as `text`; `maxLength` cuts its content, 100,000 characters by default. */
  text?: boolean | { maxLength?: number };
  /** What a Content Security Policy has to allow, as `inlineCode`. Read regardless of `context`. */
  inlineCode?: boolean;
  /**
   * The targets a fragment link can point to, as `ids`: every element's `id` and each `<a>`'s
   * `name`, once each. Read regardless of `context`.
   */
  ids?: boolean;
  /**
   * Writes the page as Markdown with mdream, as `markdown`. `true` uses mdream's defaults with the
   * page's origin; an object passes its options, such as `plugins`, to mdream. mdream's filters
   * shape only the Markdown, not what the other options collect.
   */
  markdown?: boolean | MarkdownOptions;
  /**
   * The `<head>` as unhead validates it, as `head`: its elements in page order with Capo's weight,
   * and the issues unhead's rules find, such as render-blocking scripts or too many preloads. An
   * object passes unhead's rule configuration. Read regardless of `context`.
   */
  head?: boolean | HeadOptions;
}

export interface ParseResult {
  links?: Link[];
  images?: Image[];
  resources?: Resources;
  meta?: Meta;
  /** The first headings with their text, see `maxHeadings`. */
  headings?: Heading[];
  /** How many headings of each level the page has, uncapped: `headingCounts[0]` counts `h1`. */
  headingCounts?: number[];
  classCounts?: Record<string, number>;
  structuredData?: StructuredData;
  styles?: PageStyles;
  /** The hydrating framework, or `null` when the page does not hydrate. */
  hydration?: Hydration | null;
  text?: VisibleText;
  inlineCode?: InlineCode;
  /** The page's `id`s and `<a name>`s in page order, each once, at most 5,000. */
  ids?: string[];
  markdown?: string;
  head?: PageHead;
}

const maxHeadings = 200;
const maxStyleBlocks = 200;
const maxStyleBlockLength = 2_000_000;
const maxStyleAttributes = 2000;
const maxResources = 500;
const maxIds = 5000;
const maxSources = 20;
const maxProperties = 50;
const defaultTextLength = 100_000;

// The type may carry parameters, such as `application/ld+json; charset=utf-8`.
const jsonLdType = /^\s*application\/ld\+json\s*(?:;|$)/iu;

// Script types a browser runs; any other type marks a data block, such as JSON or a template.
const executableTypes = new Set([
  "",
  "module",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

// Elements whose text a visitor does not read.
const hiddenText = new Set([
  "head",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
  "title",
]);

// Elements that start a new line, so their text never runs into the text before or after.
const blocks = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "button",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "img",
  "input",
  "label",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "select",
  "summary",
  "table",
  "td",
  "textarea",
  "th",
  "tr",
  "ul",
]);

const urlAttributes = ["href", "src", "action", "formaction"] as const;

// The single-valued fields; `properties` collects every `<meta property>` on its own.
const metaFields = new Map<string, Exclude<keyof Meta, "properties">>([
  ["description", "description"],
  ["generator", "generator"],
  ["og:image", "image"],
  ["robots", "robots"],
  ["viewport", "viewport"],
]);

/** Text as a browser shows it: entities are already decoded by the tokenizer. */
const clean = (text: string) =>
  collapseWhitespace(removeHyphenation(text)).trim();

/** An open element: what the selector reads and what its end tag has to undo. */
interface Frame extends SelectorFrame {
  /** Elements opened inside it so far, by tag, for `:nth-of-type`. */
  children: number;
  types: Map<string, number> | undefined;
  /** Layout containers it opened, for `positions`. */
  containers: ReturnType<typeof readElement> | undefined;
  /** Whether it hides its content, for `hidden`. */
  hidden: boolean;
  context: boolean;
  link: string[] | undefined;
  heading: { level: number; text: string[]; hidden?: boolean } | undefined;
  title: string[] | undefined;
  /** The text of an inline script that runs, for `inlineCode`. */
  inline: string[] | undefined;
  /** The head element it is, for `head`. */
  headElement: OpenHeadElement | undefined;
}

/** What the handlers of one pass share while the page streams through. */
interface Pass {
  options: ParseOptions;
  base: URL;
  /** Resolved addresses by their written form; pages repeat most of theirs. */
  urls: Map<string, string>;
  linkFilter: LinkFilter | undefined;
  matcher: Matcher | undefined;
  links: Map<string, Link>;
  images: Map<string, Image>;
  resources: Resources;
  meta: Meta;
  headings: Heading[];
  headingCounts: number[];
  classCounts: Record<string, number>;
  /** Open context elements; without a context selector the whole page counts. */
  inContext: number;
  contextFound: boolean;
  stack: Frame[];
  /** Open <head>, <svg>, elements whose text is hidden, and elements that hide their content. */
  inHead: number;
  inSvg: number;
  inHiddenText: number;
  inHidden: number;
  link: string[] | undefined;
  heading: { level: number; text: string[]; hidden?: boolean } | undefined;
  title: string[] | undefined;
  titleRead: boolean;
  /** Text of the JSON-LD blocks read so far, and whether the open script is one. */
  jsonLd: string[];
  readingJsonLd: boolean;
  readingStyle: boolean;
  styles: PageStyles;
  hydration: HydrationState;
  /** Present with the `hidden` option: the rule that decides what hides its content. */
  hiddenRule: HiddenRule | undefined;
  /** Present with the `positions` option. */
  layout: Layout | undefined;
  /** The spots of the images and islands whose position is asked for. */
  spots: Map<Image | AstroIsland, Spot>;
  text: {
    parts: string[];
    length: number;
    kept: number;
    max: number;
    space: boolean;
    at: boolean;
  };
  inlineCode: InlineCode;
  formActions: Set<string>;
  /** The head's elements in page order, for `head`. */
  headElements: OpenHeadElement[];
  /** The fragment targets read so far, for `ids`. */
  ids: Set<string>;
}

const collecting = (pass: Pass) => pass.inContext > 0;

const resolve = (pass: Pass, url: string) => {
  let resolved = pass.urls.get(url);
  if (resolved === undefined) {
    resolved = absoluteUrl(url, pass.base);
    pass.urls.set(url, resolved);
  }
  return resolved;
};

const addLink = (
  links: Map<string, Link>,
  found: Omit<Link, "kind" | "resource" | "count"> & { href: string },
  base: URL
) => {
  // Cloudflare's e-mail obfuscation rewrites addresses to a script-decoded link.
  if (found.url.includes("/cdn-cgi/l/email-protection")) {
    return;
  }
  const existing = links.get(found.url);
  if (existing) {
    existing.count += 1;
    // One link in plain sight makes the URL reachable, however many hidden menus repeat it.
    if (existing.hidden && found.hidden === false) {
      existing.hidden = false;
    }
    return;
  }
  const { href, ...link } = found;
  links.set(found.url, {
    ...link,
    count: 1,
    kind: linkKind(href, found.url, base),
    resource: isResource(found.url),
  });
};

const filterLinks = (links: Link[], filter: LinkFilter) =>
  links
    .filter(
      (link) =>
        (!filter.kinds || filter.kinds.includes(link.kind)) &&
        (filter.resources !== false || !link.resource)
    )
    .toSorted((first, second) => second.count - first.count);

/** How a style attribute's element is named: its tag, id, and first class. */
const elementName = (name: string, attributes: Record<string, string>) => {
  const { id } = attributes;
  const firstClass = (attributes.class ?? "").split(/\s+/u).find(Boolean);
  return `${name}${id ? `#${id}` : ""}${firstClass ? `.${firstClass}` : ""}`;
};

/** Adds a piece of visible text, with a space where a block element separates it. */
const addText = (pass: Pass, value: string) => {
  const state = pass.text;
  // Like innerText, only ASCII whitespace collapses; a no-break space stays.
  let piece = value.replaceAll(/[\t\n\f\r ]+/gu, " ");
  if (state.length === 0 || state.space) {
    piece = piece.trimStart();
  } else if (state.at && !piece.startsWith(" ")) {
    piece = ` ${piece}`;
  }
  if (piece === "") {
    return;
  }
  state.at = false;
  state.space = piece.endsWith(" ");
  state.length += piece.length;
  if (state.kept < state.max) {
    const kept = piece.slice(0, state.max - state.kept);
    state.parts.push(kept);
    state.kept += kept.length;
  }
};

const countClasses = (pass: Pass, attributes: Record<string, string>) => {
  const value = attributes.class;
  if (!value) {
    return;
  }
  const classes = value.split(/\s+/u);
  for (const prefix of pass.options.classPrefixes ?? []) {
    if (classes.some((name) => name.startsWith(prefix))) {
      pass.classCounts[prefix] = (pass.classCounts[prefix] ?? 0) + 1;
    }
  }
};

/** An element's `id`, and an `<a>`'s `name`, which fragment links can point to as well. */
const readIds = (
  pass: Pass,
  name: string,
  attributes: Record<string, string>
) => {
  for (const target of [attributes.id, name === "a" ? attributes.name : ""]) {
    if (target && pass.ids.size < maxIds) {
      pass.ids.add(target);
    }
  }
};

const readInlineAttributes = (
  pass: Pass,
  name: string,
  attributes: Record<string, string>
) => {
  const code = pass.inlineCode;
  for (const attribute in attributes) {
    if (attribute.length > 2 && attribute.startsWith("on")) {
      code.eventHandlers += 1;
    }
  }
  for (const attribute of urlAttributes) {
    const value = attributes[attribute];
    if (value && /^\s*javascript:/iu.test(value)) {
      code.javascriptUrls += 1;
    }
  }
  if (attributes.style?.trim()) {
    code.styleAttributes += 1;
  }
  if (name === "style") {
    code.styleElements += 1;
  } else if (name === "form" && attributes.action) {
    pass.formActions.add(resolve(pass, attributes.action));
  }
};

const enterScript = (
  pass: Pass,
  frame: Frame,
  attributes: Record<string, string>
) => {
  const { options } = pass;
  const { type } = attributes;
  if (options.resources && pass.resources.scripts.length < maxResources) {
    const { src } = attributes;
    pass.resources.scripts.push({
      attributes: Object.keys(attributes),
      head: pass.inHead > 0,
      src: src ? resolve(pass, src) : undefined,
      type,
    });
  }
  if (options.structuredData) {
    pass.readingJsonLd =
      type !== undefined &&
      jsonLdType.test(type) &&
      pass.jsonLd.length < maxBlocks;
    if (pass.readingJsonLd) {
      pass.jsonLd.push("");
    }
  }
  if (options.hydration) {
    readScriptStart(pass.hydration, attributes);
  }
  if (
    options.inlineCode &&
    !("src" in attributes) &&
    executableTypes.has((type ?? "").trim().toLowerCase())
  ) {
    frame.inline = [];
  }
};

const enterMeta = (
  pass: Pass,
  frame: Frame,
  name: string,
  attributes: Record<string, string>
) => {
  switch (name) {
    case "html": {
      pass.meta.language = attributes.lang;
      break;
    }
    case "title": {
      // Only the document's first title counts; an SVG's <title> names the graphic.
      if (!pass.titleRead && pass.inSvg === 0) {
        pass.titleRead = true;
        frame.title = [];
        pass.title = frame.title;
      }
      break;
    }
    case "meta": {
      const field = metaFields.get(
        (attributes.name ?? attributes.property ?? "").toLowerCase()
      );
      if (field) {
        pass.meta[field] = attributes.content;
      }
      const { property, content } = attributes;
      if (property && content !== undefined) {
        pass.meta.properties ??= {};
        const { properties } = pass.meta;
        const key = property.toLowerCase();
        if (
          !(key in properties) &&
          Object.keys(properties).length < maxProperties
        ) {
          properties[key] = content;
        }
      }
      break;
    }
    case "link": {
      if (attributes.rel === "canonical") {
        const { href } = attributes;
        pass.meta.canonical = href ? resolve(pass, href) : undefined;
      }
      break;
    }
    default:
  }
};

const enterStyles = (
  pass: Pass,
  name: string,
  attributes: Record<string, string>
) => {
  const { styles } = pass;
  if (name === "style") {
    pass.readingStyle = styles.blocks.length < maxStyleBlocks;
    if (pass.readingStyle) {
      const { id } = attributes;
      styles.blocks.push({ css: "", ...(id && { id }) });
    }
  } else if (
    name === "link" &&
    attributes.href !== undefined &&
    attributes.rel !== undefined
  ) {
    const rel = attributes.rel.toLowerCase();
    const as = (attributes.as ?? "").toLowerCase();
    const { href } = attributes;
    if (
      href &&
      (rel.split(/\s+/u).includes("stylesheet") ||
        (rel.includes("preload") && as === "style"))
    ) {
      const url = resolve(pass, href);
      if (!styles.stylesheets.includes(url)) {
        styles.stylesheets.push(url);
      }
    }
  }
  const css = attributes.style;
  if (css && styles.attributes.length < maxStyleAttributes) {
    styles.attributes.push({ css, element: elementName(name, attributes) });
  }
};

/**
 * The absolute URLs of a `srcset`, without data URLs. Candidates are separated by commas, and a
 * descriptor's comma may run straight into the next URL, as in `400w,/b.jpg`, while a data URL
 * holds commas of its own. So the attribute is read word by word: a URL ends at its first comma
 * unless it is a data URL, and its descriptors run to the comma that ends the candidate.
 */
const srcsetUrls = (pass: Pass, srcset: string) => {
  const urls: string[] = [];
  const add = (url: string) => {
    if (url && !url.startsWith("data:") && urls.length < maxSources) {
      const resolved = resolve(pass, url);
      if (!urls.includes(resolved)) {
        urls.push(resolved);
      }
    }
  };
  let expectUrl = true;
  for (const word of srcset.trim().split(/\s+/u)) {
    let rest = word;
    while (rest !== "") {
      const comma = rest.startsWith("data:") ? -1 : rest.indexOf(",");
      if (expectUrl) {
        add(comma === -1 ? rest.replace(/,+$/u, "") : rest.slice(0, comma));
        expectUrl = comma !== -1 || rest.endsWith(",");
      } else {
        expectUrl = comma !== -1;
      }
      rest = comma === -1 ? "" : rest.slice(comma + 1);
    }
  }
  return urls;
};

const enterImage = (pass: Pass, attributes: Record<string, string>) => {
  // Lazy-loading scripts keep the real address in data-src and a placeholder in src.
  const src = [
    attributes.src,
    attributes["data-src"],
    attributes["data-lazy-src"],
  ].find((value) => value && !value.startsWith("data:"));
  if (!collecting(pass) || !src) {
    return;
  }
  const url = resolve(pass, src);
  const hidden = pass.options.hidden ? pass.inHidden > 0 : undefined;
  const existing = pass.images.get(url);
  if (existing) {
    if (existing.hidden && hidden === false) {
      existing.hidden = false;
    }
    return;
  }
  const { alt, srcset } = attributes;
  const image: Image = {
    alt: alt === undefined ? null : clean(alt),
    height: attributes.height,
    loading: attributes.loading,
    srcset: srcset !== undefined,
    url,
    width: attributes.width,
    ...(srcset && { sources: srcsetUrls(pass, srcset) }),
    ...(hidden !== undefined && { hidden }),
  };
  pass.images.set(url, image);
  if (pass.layout) {
    pass.spots.set(image, spotOf(pass.layout));
  }
};

/** Opens a frame for an element, with its position among its siblings for the selector. */
const openFrame = (pass: Pass, node: ElementNode): Frame => {
  const { name, attributes } = node;
  const parent = pass.stack.at(-1);
  const frame: Frame = {
    attributes,
    children: 0,
    containers: undefined,
    context: false,
    headElement: undefined,
    heading: undefined,
    hidden: false,
    inline: undefined,
    link: undefined,
    name,
    parent,
    position: 1,
    title: undefined,
    typePosition: 1,
    types: undefined,
  };
  if (pass.matcher && parent) {
    parent.children += 1;
    frame.position = parent.children;
    parent.types ??= new Map();
    frame.typePosition = (parent.types.get(name) ?? 0) + 1;
    parent.types.set(name, frame.typePosition);
  }
  pass.stack.push(frame);
  return frame;
};

/** Tracks the containers an element opens: layout, context, head, SVG, and hidden text. */
const enterStructure = (pass: Pass, frame: Frame) => {
  const { name, attributes } = frame;
  const rule = pass.hiddenRule;
  if (rule || pass.layout) {
    const byMarkup = hidesContent(name, attributes);
    const hides = rule ? rule(name, attributes, byMarkup) : byMarkup;
    if (hides && rule) {
      frame.hidden = true;
      pass.inHidden += 1;
    }
    if (pass.layout) {
      frame.containers = readElement(pass.layout, name, attributes, hides);
    }
  }
  if (pass.matcher?.(frame)) {
    pass.contextFound = true;
    pass.inContext += 1;
    frame.context = true;
  }
  if (name === "head") {
    pass.inHead += 1;
  } else if (name === "svg") {
    pass.inSvg += 1;
  }
  if (hiddenText.has(name)) {
    pass.inHiddenText += 1;
  }
  if (pass.options.text && blocks.has(name)) {
    pass.text.at = true;
  }
};

const enterLink = (pass: Pass, frame: Frame) => {
  if (pass.linkFilter && frame.attributes.href && collecting(pass)) {
    frame.link = [];
    pass.link = frame.link;
  }
};

const enterHeading = (pass: Pass, frame: Frame) => {
  if (!pass.options.headings || !collecting(pass)) {
    return;
  }
  const level = Number(frame.name.slice(1));
  pass.headingCounts[level - 1] = (pass.headingCounts[level - 1] ?? 0) + 1;
  frame.heading = {
    level,
    text: [],
    ...(pass.options.hidden && { hidden: pass.inHidden > 0 }),
  };
  pass.heading = frame.heading;
};

const mediaTags = new Set([
  "audio",
  "embed",
  "object",
  "source",
  "track",
  "video",
]);

/** Frames, media, and `<link>` elements, for `resources`. */
const enterResource = (pass: Pass, frame: Frame) => {
  const { attributes, name } = frame;
  const { resources } = pass;
  if (name === "iframe") {
    const { src } = attributes;
    if (src !== undefined && resources.frames.length < maxResources) {
      resources.frames.push(resolve(pass, src));
    }
    return;
  }
  if (mediaTags.has(name)) {
    const { media } = resources;
    const urls = [
      ...(name === "object" ? [attributes.data] : [attributes.src]),
      ...(attributes.srcset ? srcsetUrls(pass, attributes.srcset) : []),
    ];
    for (const url of urls) {
      if (url && !url.startsWith("data:") && media.length < maxResources) {
        const resolved = resolve(pass, url);
        if (!media.includes(resolved)) {
          media.push(resolved);
        }
      }
    }
    return;
  }
  const { href } = attributes;
  if (href !== undefined && resources.links.length < maxResources) {
    const { type } = attributes;
    resources.links.push({
      href: resolve(pass, href),
      rel: attributes.rel ?? "",
      ...(type && { type }),
    });
  }
};

const enterIsland = (pass: Pass, frame: Frame) => {
  const island = readIsland(pass.hydration, frame.attributes);
  if (island && pass.layout) {
    pass.spots.set(island, spotOf(pass.layout));
  }
};

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** What the element's own tag asks for. */
const enterTag = (pass: Pass, frame: Frame) => {
  const { options } = pass;
  const { name } = frame;
  if (name === "a") {
    enterLink(pass, frame);
  } else if (name === "img" && options.images) {
    enterImage(pass, frame.attributes);
  } else if (name === "script") {
    enterScript(pass, frame, frame.attributes);
  } else if (
    (name === "iframe" || name === "link" || mediaTags.has(name)) &&
    options.resources
  ) {
    enterResource(pass, frame);
  } else if (headingTags.has(name)) {
    enterHeading(pass, frame);
  } else if (name === "astro-island" && options.hydration) {
    enterIsland(pass, frame);
  }
};

const enter = (pass: Pass, node: ElementNode) => {
  const { options } = pass;
  const frame = openFrame(pass, node);
  const { name, attributes } = frame;
  enterStructure(pass, frame);
  if (options.classPrefixes && collecting(pass)) {
    countClasses(pass, attributes);
  }
  enterTag(pass, frame);
  if (options.meta) {
    enterMeta(pass, frame, name, attributes);
  }
  if (options.styles) {
    enterStyles(pass, name, attributes);
  }
  if (options.hydration && "ng-version" in attributes) {
    pass.hydration.angular = true;
  }
  if (options.inlineCode) {
    readInlineAttributes(pass, name, attributes);
  }
  if (options.ids) {
    readIds(pass, name, attributes);
  }
  if (options.head && pass.inHead > 0 && pass.inSvg === 0 && isHeadTag(name)) {
    frame.headElement = { attributes, content: [], tag: name };
    pass.headElements.push(frame.headElement);
  }
};

const leaveStructure = (pass: Pass, frame: Frame) => {
  const { name } = frame;
  if (frame.containers && pass.layout) {
    closeContainers(pass.layout, frame.containers);
  }
  if (frame.context) {
    pass.inContext -= 1;
  }
  if (frame.hidden) {
    pass.inHidden -= 1;
  }
  if (name === "head") {
    pass.inHead -= 1;
  } else if (name === "svg") {
    pass.inSvg -= 1;
  }
  if (hiddenText.has(name)) {
    pass.inHiddenText -= 1;
  }
  if (pass.options.text && blocks.has(name)) {
    pass.text.at = true;
  }
};

const leaveLink = (pass: Pass, frame: Frame, text: string[]) => {
  const { attributes } = frame;
  const href = attributes.href ?? "";
  addLink(
    pass.links,
    {
      href,
      label: attributes["aria-label"],
      rel: attributes.rel,
      target: attributes.target,
      text: clean(text.join("")),
      url: resolve(pass, href),
      ...(pass.options.hidden && { hidden: frame.hidden || pass.inHidden > 0 }),
    },
    pass.base
  );
  pass.link = undefined;
};

const leaveHeading = (pass: Pass, heading: NonNullable<Frame["heading"]>) => {
  const text = clean(heading.text.join(""));
  if (text && pass.headings.length < maxHeadings) {
    pass.headings.push({
      level: heading.level,
      text,
      ...(heading.hidden !== undefined && { hidden: heading.hidden }),
    });
  }
  pass.heading = undefined;
};

const leaveScript = (pass: Pass, frame: Frame) => {
  pass.readingJsonLd = false;
  if (pass.options.hydration) {
    readScriptEnd(pass.hydration);
  }
  if (frame.inline) {
    const body = frame.inline.join("");
    if (body.trim() !== "" && pass.inlineCode.scripts.length < maxResources) {
      pass.inlineCode.scripts.push(body);
    }
  }
};

const leave = (pass: Pass, frame: Frame) => {
  leaveStructure(pass, frame);
  if (frame.link) {
    leaveLink(pass, frame, frame.link);
  }
  if (frame.heading) {
    leaveHeading(pass, frame.heading);
  }
  if (frame.title) {
    pass.meta.title = clean(frame.title.join(""));
    pass.title = undefined;
  }
  if (frame.name === "script") {
    leaveScript(pass, frame);
  } else if (frame.name === "style") {
    pass.readingStyle = false;
  }
};

const exit = (pass: Pass, node: ElementNode) => {
  const { stack } = pass;
  // The tokenizer ends inner elements first; an exit for an element not open is ignored.
  let index = stack.length - 1;
  while (index >= 0 && stack[index]?.attributes !== node.attributes) {
    index -= 1;
  }
  if (index < 0) {
    return;
  }
  for (let open = stack.length; open > index; open -= 1) {
    const frame = stack.pop();
    if (frame) {
      leave(pass, frame);
    }
  }
};

/** Text of a script or style, which only some options read. */
const rawText = (pass: Pass, frame: Frame, value: string) => {
  if (frame.name === "script") {
    if (pass.readingJsonLd) {
      const last = pass.jsonLd.length - 1;
      const block = pass.jsonLd[last] ?? "";
      if (block.length < maxBlockLength) {
        pass.jsonLd[last] = block + value;
      }
    }
    if (pass.options.hydration) {
      readScriptText(pass.hydration, value);
    }
    frame.inline?.push(value);
  } else if (frame.name === "style" && pass.readingStyle) {
    const block = pass.styles.blocks.at(-1);
    if (block && block.css.length < maxStyleBlockLength) {
      block.css += value;
    }
  }
};

const text = (pass: Pass, value: string) => {
  pass.title?.push(value);
  const frame = pass.stack.at(-1);
  if (frame) {
    frame.headElement?.content.push(value);
    rawText(pass, frame, value);
  }
  if (pass.layout) {
    readText(pass.layout, value);
  }
  if (!collecting(pass)) {
    return;
  }
  pass.link?.push(value);
  pass.heading?.text.push(value);
  if (pass.options.text && pass.inHiddenText === 0) {
    addText(pass, value);
  }
};

const handlersOf = (pass: Pass): Handlers => ({
  enter: (node) => enter(pass, node),
  exit: (node) => exit(pass, node),
  text: (value) => text(pass, value),
});

/** What the markup says, unless the caller's rule decides. */
const byMarkupRule: HiddenRule = (_tag, _attributes, byMarkup) => byMarkup;

const hiddenRuleOf = (hidden: ParseOptions["hidden"]) => {
  if (hidden === true) {
    return byMarkupRule;
  }
  return hidden || undefined;
};

const newPass = (options: ParseOptions): Pass => {
  const max =
    options.text && options.text !== true
      ? (options.text.maxLength ?? defaultTextLength)
      : defaultTextLength;
  return {
    base: new URL(options.url),
    classCounts: Object.fromEntries(
      (options.classPrefixes ?? []).map((prefix) => [prefix, 0])
    ),
    contextFound: false,
    formActions: new Set(),
    headElements: [],
    heading: undefined,
    headingCounts: [0, 0, 0, 0, 0, 0],
    headings: [],
    hiddenRule: hiddenRuleOf(options.hidden),
    hydration: emptyHydration(),
    ids: new Set(),
    images: new Map(),
    inContext: options.context ? 0 : 1,
    inHead: 0,
    inHidden: 0,
    inHiddenText: 0,
    inSvg: 0,
    inlineCode: {
      eventHandlers: 0,
      formActions: [],
      javascriptUrls: 0,
      scripts: [],
      styleAttributes: 0,
      styleElements: 0,
    },
    jsonLd: [],
    layout: options.positions ? emptyLayout() : undefined,
    link: undefined,
    linkFilter: options.links === true ? {} : options.links || undefined,
    links: new Map(),
    matcher: options.context ? compileSelector(options.context) : undefined,
    meta: {},
    options,
    readingJsonLd: false,
    readingStyle: false,
    resources: { frames: [], links: [], media: [], scripts: [] },
    spots: new Map(),
    stack: [],
    styles: { attributes: [], blocks: [], stylesheets: [] },
    text: { at: false, kept: 0, length: 0, max, parts: [], space: false },
    title: undefined,
    titleRead: false,
    urls: new Map(),
  };
};

const resultOf = (pass: Pass, markdown: string | undefined): ParseResult => {
  const { options } = pass;
  // Elements still open at the end, which the tokenizer normally closes, end here.
  for (let frame = pass.stack.pop(); frame; frame = pass.stack.pop()) {
    leave(pass, frame);
  }
  const result: ParseResult = {};
  if (pass.linkFilter) {
    result.links = filterLinks([...pass.links.values()], pass.linkFilter);
  }
  if (options.images) {
    result.images = [...pass.images.values()];
  }
  if (options.resources) {
    result.resources = pass.resources;
  }
  if (options.meta) {
    result.meta = pass.meta;
  }
  if (options.headings) {
    result.headings = pass.headings;
    result.headingCounts = pass.headingCounts;
  }
  if (options.classPrefixes) {
    result.classCounts = pass.classCounts;
  }
  if (options.structuredData) {
    result.structuredData = readStructuredData(pass.jsonLd);
  }
  if (options.styles) {
    result.styles = pass.styles;
  }
  if (options.hydration) {
    result.hydration = hydrationOf(pass.hydration);
  }
  if (options.text) {
    result.text = {
      content: pass.text.parts.join("").trimEnd(),
      length: pass.text.length - (pass.text.space ? 1 : 0),
    };
  }
  if (options.inlineCode) {
    result.inlineCode = {
      ...pass.inlineCode,
      formActions: [...pass.formActions],
    };
  }
  if (options.ids) {
    result.ids = [...pass.ids];
  }
  if (markdown !== undefined) {
    result.markdown = markdown;
  }
  if (options.head) {
    result.head = readHead(
      pass.headElements,
      options.head === true ? {} : options.head
    );
  }
  const { layout } = pass;
  if (layout) {
    for (const [item, spot] of pass.spots) {
      item.position = positionOf(spot, layout.text);
    }
  }
  return result;
};

const markdownOptions = (
  options: ParseOptions,
  base: URL
): MarkdownOptions | undefined => {
  const { markdown } = options;
  if (!markdown) {
    return undefined;
  }
  if (markdown === true) {
    return { origin: base.origin };
  }
  return { origin: base.origin, ...markdown };
};

/** Whether a context was asked for but matched nothing, so the whole page has to count. */
const missedContext = (pass: Pass) =>
  Boolean(pass.options.context) && !pass.contextFound;

const withoutContext = (options: ParseOptions): ParseOptions => ({
  ...options,
  context: undefined,
  markdown: undefined,
});

/**
 * Parses a page held as text, synchronously, for what `options` ask. Like a selector that matches
 * nothing in a DOM library, a `context` that matches nothing means the whole page.
 */
export const parseHtmlSync = (
  html: string,
  options: ParseOptions
): ParseResult => {
  const pass = newPass(options);
  scanText(html, handlersOf(pass));
  const converter = markdownOptions(options, pass.base);
  const markdown = converter ? markdownOf(html, converter) : undefined;
  if (!missedContext(pass)) {
    return resultOf(pass, markdown);
  }
  const whole = parseHtmlSync(html, withoutContext(options));
  if (markdown !== undefined) {
    whole.markdown = markdown;
  }
  return whole;
};

/**
 * Parses a page, as text, as a `Response` such as a `fetch` result, or as a stream, for what
 * `options` ask. A response or stream is read chunk by chunk and can be read only once.
 */
export const parseHtml = async (
  input: HtmlInput,
  options: ParseOptions
): Promise<ParseResult> => {
  if (!(input instanceof Response || input instanceof ReadableStream)) {
    return parseHtmlSync(input, options);
  }
  const pass = newPass(options);
  // A stream can be read once, so a context that may match nothing keeps the text for a second pass.
  const kept: string[] | undefined = options.context ? [] : undefined;
  const markdown = await scanStream(
    input,
    handlersOf(pass),
    markdownOptions(options, pass.base),
    kept
  );
  if (!kept || !missedContext(pass)) {
    return resultOf(pass, markdown);
  }
  const whole = parseHtmlSync(kept.join(""), withoutContext(options));
  if (markdown !== undefined) {
    whole.markdown = markdown;
  }
  return whole;
};
