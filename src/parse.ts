import {
  maxBlockLength,
  maxBlocks,
  readStructuredData,
} from "./structured-data.ts";
import type { StructuredData } from "./structured-data.ts";
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
 * collects links, images, resources, metadata, headings, class counts, and JSON-LD. Memory stays flat even
 * for pages of several megabytes.
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
   * Collects only inside elements matching this selector, such as `main` or `article`. When
   * nothing matches, the whole page counts; for a `Response` input, nothing is collected then.
   */
  context?: string;
  /** Reads the page's JSON-LD blocks, wherever they are, as `structuredData`. */
  structuredData?: boolean;
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
}

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
  /** End-tag actions of the element whose start tag the handlers are reading, see `enter`. */
  endActions: (() => void)[];
  title: string[] | undefined;
  heading: { level: number; text: string[] } | undefined;
  link: string[] | undefined;
  /** Text of the JSON-LD blocks read so far; the open block is the last. */
  jsonLd: string[];
}

const collecting = (pass: Pass) => pass.inContext > 0;

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
  if (classPrefixes.length === 0) {
    return next;
  }
  return next.on("*", {
    element(element) {
      if (!collecting(pass)) {
        return;
      }
      const classes = readAttribute(element, "class")?.split(/\s+/u) ?? [];
      for (const prefix of classPrefixes) {
        if (classes.some((name) => name.startsWith(prefix))) {
          pass.classCounts[prefix] = (pass.classCounts[prefix] ?? 0) + 1;
        }
      }
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
      enter(pass, element, () => {
        addLink(
          pass.links,
          { href, label, rel, target, text: clean(text.join("")), url },
          pass.base
        );
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
      if (!pass.images.has(url)) {
        const alt = readAttribute(element, "alt");
        pass.images.set(url, {
          alt: alt === null ? null : clean(alt),
          height: readAttribute(element, "height") ?? undefined,
          loading: readAttribute(element, "loading") ?? undefined,
          srcset: element.hasAttribute("srcset"),
          url,
          width: readAttribute(element, "width") ?? undefined,
        });
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

// The type may carry parameters, such as `application/ld+json; charset=utf-8`.
const jsonLdType = /^\s*application\/ld\+json\s*(?:;|$)/iu;

const onStructuredData = (rewriter: HTMLRewriter, pass: Pass) => {
  // Whether the script being read is a JSON-LD block; its text arrives in chunks.
  let reading = false;
  return rewriter.on("script[type]", {
    element(element) {
      reading =
        jsonLdType.test(readAttribute(element, "type") ?? "") &&
        pass.jsonLd.length < maxBlocks;
      if (reading) {
        pass.jsonLd.push("");
      }
    },
    text(chunk) {
      const last = pass.jsonLd.length - 1;
      const block = pass.jsonLd[last];
      if (reading && block !== undefined && block.length < maxBlockLength) {
        pass.jsonLd[last] = block + chunk.text;
      }
      if (chunk.lastInTextNode) {
        reading = false;
      }
    },
  });
};

const onText = (rewriter: HTMLRewriter, pass: Pass) =>
  rewriter.onDocument({
    text(chunk) {
      pass.title?.push(chunk.text);
      if (!collecting(pass)) {
        return;
      }
      pass.link?.push(chunk.text);
      pass.heading?.text.push(chunk.text);
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
  if (options.structuredData) {
    result.structuredData = readStructuredData(pass.jsonLd);
  }
  return result;
};

/** Parses a page, as text or as a `Response` such as a `fetch` result, for what `options` ask. */
export const parseHtml = async (
  input: string | Response,
  options: ParseOptions
): Promise<ParseResult> => {
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
    images: new Map(),
    inContext: options.context ? 0 : 1,
    jsonLd: [],
    link: undefined,
    linkFilter: options.links === true ? {} : options.links || undefined,
    links: new Map(),
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
  let rewriter = onStructure(first, pass);
  if (pass.linkFilter) {
    rewriter = onLinks(rewriter, pass);
  }
  if (options.images) {
    rewriter = onImages(rewriter, pass);
  }
  if (options.resources) {
    rewriter = onResources(rewriter, pass);
  }
  if (options.meta) {
    rewriter = onMeta(rewriter, pass);
  }
  if (options.headings) {
    rewriter = onHeadings(rewriter, pass);
  }
  if (options.structuredData) {
    rewriter = onStructuredData(rewriter, pass);
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
