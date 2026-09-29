import type { LinkFilter } from "./parse.ts";
import { looksBinary } from "./text.ts";
import { absoluteUrl, isResource, linkKind } from "./urls.ts";

/**
 * Cleans a page in one streaming pass, for callers that need HTML rather than extracted facts,
 * such as a Markdown conversion by Workers AI. EXIF and XMP blobs and binary-looking text are
 * always removed; everything else is removed only when asked.
 */

export interface CleanOptions {
  /** The page's address, needed to filter links by kind. */
  url: string | URL;
  remove?: {
    scripts?: boolean;
    /** Style elements, style attributes, and inline SVG. */
    styles?: boolean;
    comments?: boolean;
    cookieConsent?: boolean;
    ariaHidden?: boolean;
    /** img, picture, and figure elements. */
    images?: boolean;
    classes?: boolean;
    ids?: boolean;
    meta?: boolean;
    linkTags?: boolean;
    /** Soft hyphens and `<wbr>`. */
    hyphenation?: boolean;
  };
  /** Keeps only links that match; others become their text. */
  links?: LinkFilter;
  /** Keeps only the content of elements matching this selector. */
  context?: string;
}

const cookieConsent = [
  "[id^='brlbs-cmpnt']",
  "[class^='brlbs-cmpnt']",
  "[consent-skip-blocker]",
  "#usercentrics-root",
  "div[id*='consent-modal']",
  "div[class*='consent-modal']",
  "div[id*='consent-wrapper']",
  "div[class*='consent-wrapper']",
  "div[id*='consent-banner']",
  "div[class*='consent-banner']",
];

const remove = {
  element(element: Element) {
    element.remove();
  },
};

/** The cleaned page as HTML. */
export const cleanHtml = (
  input: string | Response,
  options: CleanOptions
): Promise<string> => {
  // An empty page has nothing to stream; some runtimes never finish transforming an empty body.
  if (!(input instanceof Response) && input.trim() === "") {
    return Promise.resolve("");
  }
  const base = new URL(options.url);
  const removed = options.remove ?? {};
  let rewriter = new HTMLRewriter();

  if (options.context) {
    // Everything outside the context is unwrapped or dropped; the context's subtrees stay whole.
    let inContext = 0;
    rewriter = rewriter
      .on(options.context, {
        element(element) {
          try {
            element.onEndTag(() => {
              inContext -= 1;
            });
            inContext += 1;
          } catch {
            // A void element such as <img> has no content to keep.
          }
        },
      })
      .on("*", {
        element(element) {
          // The context handler above runs first, so a matching element already counts as inside.
          if (inContext === 0) {
            element.removeAndKeepContent();
          }
        },
      })
      .onDocument({
        text(chunk) {
          if (inContext === 0) {
            chunk.remove();
          }
        },
      });
  }

  rewriter = rewriter
    .on("*", {
      element(element) {
        if (element.tagName.includes(":")) {
          element.remove();
          return;
        }
        for (const [name, value] of element.attributes) {
          if (name && value && looksBinary(value)) {
            element.removeAttribute(name);
          }
        }
        if (removed.classes) {
          element.removeAttribute("class");
        }
        if (removed.ids) {
          element.removeAttribute("id");
        }
        if (removed.styles) {
          element.removeAttribute("style");
        }
      },
    })
    .onDocument({
      comments(comment) {
        if (
          removed.comments ||
          /xpacket|xmpmeta|rdf:RDF|Adobe XMP Core|Exif|8BIM/iu.test(
            comment.text
          )
        ) {
          comment.remove();
        }
      },
      text(chunk) {
        if (looksBinary(chunk.text)) {
          chunk.remove();
        } else if (removed.hyphenation && /&shy;|­/u.test(chunk.text)) {
          chunk.replace(chunk.text.replaceAll(/&shy;|­/gu, ""), { html: true });
        }
      },
    });

  if (removed.scripts) {
    rewriter = rewriter.on("script", remove);
  }
  if (removed.styles) {
    rewriter = rewriter.on("style, svg", remove);
  }
  if (removed.cookieConsent) {
    rewriter = rewriter.on(cookieConsent.join(", "), remove);
  }
  if (removed.ariaHidden) {
    rewriter = rewriter.on(
      "[aria-hidden='true'], .screen-reader-text, .sr-only, .visually-hidden, .skip-link",
      remove
    );
  }
  if (removed.images) {
    rewriter = rewriter.on("img, picture, figure", remove);
  }
  if (removed.meta) {
    rewriter = rewriter.on("meta", remove);
  }
  if (removed.linkTags) {
    rewriter = rewriter.on("link", remove);
  }
  if (removed.hyphenation) {
    rewriter = rewriter.on("wbr", remove);
  }

  const { links } = options;
  if (links) {
    rewriter = rewriter.on("a", {
      element(element) {
        const href = element.getAttribute("href");
        if (!href) {
          return;
        }
        const url = absoluteUrl(href, base);
        const kind = linkKind(href, url, base);
        const kept =
          (!links.kinds || links.kinds.includes(kind)) &&
          (links.resources !== false || !isResource(url));
        if (!kept) {
          element.removeAndKeepContent();
        }
      },
    });
  }

  const response =
    input instanceof Response
      ? input
      : new Response(input, { headers: { "content-type": "text/html" } });
  return rewriter.transform(response).text();
};
