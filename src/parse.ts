import { MarkdownWriter, languageName } from "./markdown.ts";
import type { InlineKind } from "./markdown.ts";
import {
  collapseWhitespace,
  decodeEntities,
  readAttribute,
  removeHyphenation,
} from "./text.ts";
import { absoluteUrl, isResource, linkKind } from "./urls.ts";
import type { LinkKind } from "./urls.ts";

/**
 * One streaming pass over a page with Cloudflare's HTMLRewriter, which never builds a DOM: it
 * collects links, images, resources, metadata, headings, and class counts, and writes Markdown at
 * the same time. Memory stays flat even for pages of several megabytes.
 */

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
}

export interface Image {
  url: string;
  /** `null` when the attribute is missing, `""` when the image is marked as decorative. */
  alt: string | null;
  width?: string;
  height?: string;
  loading?: string;
  srcset: boolean;
}

export interface Script {
  src?: string;
  type?: string;
  /** Names of the element's attributes, for consent markers such as `data-cookieconsent`. */
  attributes: string[];
}

export interface Resources {
  scripts: Script[];
  frames: string[];
  /** `<link>` elements with their `rel`, such as stylesheets and preconnects. */
  links: { href: string; rel: string }[];
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
}

export interface Heading {
  level: number;
  text: string;
}

export interface LinkFilter {
  /** Kinds to keep; all when not set. */
  kinds?: LinkKind[];
  /** Whether to keep links to downloads such as PDFs. Default true. */
  resources?: boolean;
}

export interface MarkdownOptions {
  /** Writes `[text](url)` for links. Default true. */
  links?: boolean;
  /** Writes `![alt](url)` for images. Default false. */
  images?: boolean;
  /** Longest output in characters. Default 100 000. */
  maxLength?: number;
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
  markdown?: boolean | MarkdownOptions;
  /**
   * Collects only inside elements matching this selector, such as `main` or `article`. When
   * nothing matches, the whole page counts; for a `Response` input, nothing is collected then.
   */
  context?: string;
  /**
   * Leaves `aria-hidden` content out of the Markdown. Default true. Set it to false for DOMs taken
   * from a browser while a dialog is open: consent tools hide the whole page behind it that way.
   */
  skipAriaHidden?: boolean;
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
  markdown?: string;
}

const blockTags = new Set([
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "tr",
  "td",
  "th",
  "dt",
  "dd",
  "figcaption",
  "section",
  "article",
  "div",
]);

const inlineTags = new Map<string, InlineKind>([
  ["b", "**"],
  ["strong", "**"],
  ["i", "*"],
  ["em", "*"],
  ["code", "code"],
]);

// Content that is not what a reader reads: page chrome, code, and consent dialogs.
const hiddenFromMarkdown = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "nav",
  "footer",
  "form",
  "select",
  "[hidden]",
  "[role='dialog']",
  "[aria-modal='true']",
  "[id*='cookie']",
  "[class*='cookie']",
  "[id*='consent']",
  "[class*='consent']",
  "[id^='brlbs-cmpnt']",
  "[class^='brlbs-cmpnt']",
  "#BorlabsCookieBox",
  "#usercentrics-root",
  "#CybotCookiebotDialog",
  "#cc-main",
  ".screen-reader-text",
  ".sr-only",
  ".visually-hidden",
];

const maxHeadings = 200;
const maxResources = 500;

/**
 * Follows an element to its end tag. HTMLRewriter keeps only the last end-tag handler an element
 * gets, so every handler adds its action to the element's list and registers the whole list; the
 * last registration then runs them all. Void elements such as <img> have no end tag, and
 * HTMLRewriter throws for them; elements closed implicitly, such as <li> without </li>, end with
 * their parent.
 */
const enter = (pass: Pass, element: Element, onEnd: () => void) => {
  const actions = [...pass.endActions, onEnd];
  try {
    element.onEndTag(() => {
      for (const action of actions) {
        action();
      }
    });
  } catch {
    return false;
  }
  pass.endActions = actions;
  return true;
};

/**
 * The language of a code block. HTML has no attribute for it; the HTML standard suggests a class
 * prefixed with `language-` on the `<code>` element, which CommonMark writes for fenced code and
 * highlighters such as Prism and highlight.js read.
 */
const classLanguage = (element: Element) =>
  languageName(
    /(?:^|\s)language-(?<name>\S+)/u.exec(readAttribute(element, "class") ?? "")
      ?.groups?.name
  );

const clean = (text: string) =>
  collapseWhitespace(removeHyphenation(decodeEntities(text))).trim();

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

/** What the handlers of one pass share while the page streams through. */
interface Pass {
  options: ParseOptions;
  base: URL;
  linkFilter: LinkFilter | undefined;
  markdownOptions: MarkdownOptions | undefined;
  markdown: MarkdownWriter | undefined;
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
  /** Open elements whose content stays out of the Markdown. */
  hidden: number;
  /** End-tag actions of the element whose start tag the handlers are reading, see `enter`. */
  endActions: (() => void)[];
  title: string[] | undefined;
  heading: { level: number; text: string[] } | undefined;
  link: string[] | undefined;
}

const collecting = (pass: Pass) => pass.inContext > 0;
const writing = (pass: Pass) =>
  collecting(pass) && pass.hidden === 0 && pass.markdown !== undefined;

const hide = (pass: Pass) => ({
  element(element: Element) {
    if (enter(pass, element, () => (pass.hidden -= 1))) {
      pass.hidden += 1;
    }
  },
});

const onStructure = (rewriter: HTMLRewriter, pass: Pass) => {
  const { context, classPrefixes = [] } = pass.options;
  let next = rewriter;
  if (context) {
    next = next.on(context, {
      element(element) {
        pass.contextFound = true;
        if (enter(pass, element, () => (pass.inContext -= 1))) {
          pass.inContext += 1;
        }
      },
    });
  }
  next = next.on(hiddenFromMarkdown.join(", "), hide(pass));
  if (pass.options.skipAriaHidden ?? true) {
    next = next.on("[aria-hidden='true']", hide(pass));
  }
  // The fence is written when <pre> opens; the language on its <code> names it afterwards.
  next = next.on("pre > code", {
    element(element) {
      if (writing(pass)) {
        pass.markdown?.codeLanguage(classLanguage(element));
      }
    },
  });
  return next.on("*", {
    element(element) {
      // Namespaced tags such as <x:xmpmeta> carry image metadata, not content.
      if (element.tagName.includes(":")) {
        hide(pass).element(element);
      }
      if (!collecting(pass)) {
        return;
      }
      const classes = readAttribute(element, "class")?.split(/\s+/u) ?? [];
      for (const prefix of classPrefixes) {
        if (classes.some((name) => name.startsWith(prefix))) {
          pass.classCounts[prefix] = (pass.classCounts[prefix] ?? 0) + 1;
        }
      }
      const tag = element.tagName.toLowerCase();
      if (!writing(pass)) {
        return;
      }
      // Inline formatting closes whatever it opened, so its markers stay paired even when a
      // context ends on the same element.
      const inline = inlineTags.get(tag);
      if (inline && enter(pass, element, () => pass.markdown?.closeInline())) {
        pass.markdown?.openInline(inline);
      }
      if (!blockTags.has(tag)) {
        return;
      }
      pass.markdown?.open(tag);
      enter(pass, element, () => {
        if (writing(pass)) {
          pass.markdown?.close(tag);
        }
      });
    },
  });
};

const onLinks = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter.on("a[href]", {
    element(element) {
      const href = readAttribute(element, "href") ?? "";
      if (!collecting(pass) || !href) {
        return;
      }
      const url = absoluteUrl(href, pass.base);
      const text: string[] = [];
      pass.link = text;
      // Attributes are readable only while this handler runs, not in the end-tag handler.
      const label = readAttribute(element, "aria-label") ?? undefined;
      const rel = readAttribute(element, "rel") ?? undefined;
      const target = readAttribute(element, "target") ?? undefined;
      const written =
        writing(pass) &&
        pass.markdownOptions?.links !== false &&
        !href.startsWith("#");
      if (written) {
        pass.markdown?.openLink(url);
      }
      enter(pass, element, () => {
        if (written) {
          pass.markdown?.closeLink();
        }
        if (pass.linkFilter) {
          addLink(
            pass.links,
            { href, label, rel, target, text: clean(text.join("")), url },
            pass.base
          );
        }
        pass.link = undefined;
      });
    },
  });

const onImages = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter.on("img", {
    element(element) {
      // Lazy-loading scripts keep the real address in data-src and a placeholder in src.
      const src = [
        readAttribute(element, "src"),
        readAttribute(element, "data-src"),
        readAttribute(element, "data-lazy-src"),
      ].find((value) => value && !value.startsWith("data:"));
      if (!collecting(pass) || !src) {
        return;
      }
      const url = absoluteUrl(src, pass.base);
      const alt = readAttribute(element, "alt");
      if (pass.options.images && !pass.images.has(url)) {
        pass.images.set(url, {
          alt: alt === null ? null : clean(alt),
          height: readAttribute(element, "height") ?? undefined,
          loading: readAttribute(element, "loading") ?? undefined,
          srcset: element.hasAttribute("srcset"),
          url,
          width: readAttribute(element, "width") ?? undefined,
        });
      }
      if (writing(pass) && pass.markdownOptions?.images) {
        pass.markdown?.image(alt ?? "", url);
      }
    },
  });

const onResources = (rewriter: HTMLRewriter, pass: Pass) => {
  const { resources, base } = pass;
  return rewriter
    .on("script", {
      element(element) {
        if (resources.scripts.length < maxResources) {
          const src = readAttribute(element, "src");
          resources.scripts.push({
            attributes: [...element.attributes].flatMap(([name]) =>
              name ? [name] : []
            ),
            src: src ? absoluteUrl(src, base) : undefined,
            type: readAttribute(element, "type") ?? undefined,
          });
        }
      },
    })
    .on("iframe[src]", {
      element(element) {
        if (resources.frames.length < maxResources) {
          resources.frames.push(
            absoluteUrl(readAttribute(element, "src") ?? "", base)
          );
        }
      },
    })
    .on("link[href]", {
      element(element) {
        if (resources.links.length < maxResources) {
          resources.links.push({
            href: absoluteUrl(readAttribute(element, "href") ?? "", base),
            rel: readAttribute(element, "rel") ?? "",
          });
        }
      },
    });
};

const metaFields = new Map<string, keyof Meta>([
  ["description", "description"],
  ["generator", "generator"],
  ["og:image", "image"],
  ["robots", "robots"],
  ["viewport", "viewport"],
]);

const onMeta = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter
    .on("html", {
      element(element) {
        pass.meta.language = readAttribute(element, "lang") ?? undefined;
      },
    })
    .on("title", {
      element(element) {
        pass.title = [];
        enter(pass, element, () => {
          pass.meta.title = clean((pass.title ?? []).join(""));
          pass.title = undefined;
        });
      },
    })
    .on("meta", {
      element(element) {
        const name =
          readAttribute(element, "name") ??
          readAttribute(element, "property") ??
          "";
        const field = metaFields.get(name.toLowerCase());
        if (field) {
          pass.meta[field] = readAttribute(element, "content") ?? undefined;
        }
      },
    })
    .on("link[rel='canonical']", {
      element(element) {
        const href = readAttribute(element, "href");
        pass.meta.canonical = href ? absoluteUrl(href, pass.base) : undefined;
      },
    });

const onHeadings = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter.on("h1, h2, h3, h4, h5, h6", {
    element(element) {
      if (!collecting(pass)) {
        return;
      }
      const level = Number(element.tagName.slice(1));
      pass.headingCounts[level - 1] = (pass.headingCounts[level - 1] ?? 0) + 1;
      pass.heading = { level, text: [] };
      enter(pass, element, () => {
        const text = clean(pass.heading?.text.join("") ?? "");
        if (pass.heading && text && pass.headings.length < maxHeadings) {
          pass.headings.push({ level: pass.heading.level, text });
        }
        pass.heading = undefined;
      });
    },
  });

const onText = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter.onDocument({
    text(chunk) {
      pass.title?.push(chunk.text);
      if (!collecting(pass)) {
        return;
      }
      pass.link?.push(chunk.text);
      pass.heading?.text.push(chunk.text);
      if (writing(pass)) {
        pass.markdown?.text(chunk.text);
      }
    },
  });

const resultOf = (pass: Pass): ParseResult => {
  const { options } = pass;
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
  if (pass.markdown) {
    result.markdown = pass.markdown.toString();
  }
  return result;
};

/** Parses a page, as text or as a `Response` such as a `fetch` result, for what `options` ask. */
export const parseHtml = async (
  input: string | Response,
  options: ParseOptions
): Promise<ParseResult> => {
  const markdownOptions: MarkdownOptions | undefined =
    options.markdown === true ? {} : options.markdown || undefined;
  const pass: Pass = {
    base: new URL(options.url),
    classCounts: Object.fromEntries(
      (options.classPrefixes ?? []).map((prefix) => [prefix, 0])
    ),
    contextFound: false,
    endActions: [],
    heading: undefined,
    headingCounts: [0, 0, 0, 0, 0, 0],
    headings: [],
    hidden: 0,
    images: new Map(),
    inContext: options.context ? 0 : 1,
    link: undefined,
    linkFilter: options.links === true ? {} : options.links || undefined,
    links: new Map(),
    markdown: markdownOptions
      ? new MarkdownWriter(markdownOptions.maxLength ?? 100_000)
      : undefined,
    markdownOptions,
    meta: {},
    options,
    resources: { frames: [], links: [], scripts: [] },
    title: undefined,
  };

  // An empty page has nothing to stream; some runtimes never finish transforming an empty body.
  if (!(input instanceof Response) && input.trim() === "") {
    return resultOf(pass);
  }
  // Registered first, so every element starts with an empty list of end-tag actions.
  const first = new HTMLRewriter().on("*", {
    element() {
      pass.endActions = [];
    },
  });
  let rewriter = onImages(onLinks(onStructure(first, pass), pass), pass);
  if (options.resources) {
    rewriter = onResources(rewriter, pass);
  }
  if (options.meta) {
    rewriter = onMeta(rewriter, pass);
  }
  if (options.headings) {
    rewriter = onHeadings(rewriter, pass);
  }
  const response =
    input instanceof Response
      ? input
      : new Response(input, { headers: { "content-type": "text/html" } });
  // The rewritten page is discarded; the handlers are what this pass is for.
  await onText(rewriter, pass).transform(response).arrayBuffer();

  // Like a selector that matches nothing in a DOM library, a missing context means the whole page.
  // A response can be read only once, so this second pass needs the page as text.
  if (options.context && !pass.contextFound && !(input instanceof Response)) {
    return parseHtml(input, { ...options, context: undefined });
  }
  return resultOf(pass);
};
