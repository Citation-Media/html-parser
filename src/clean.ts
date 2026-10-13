import { hiddenFromReaders } from "./layout.ts";
import type { LinkFilter } from "./parse.ts";
import { looksBinary, readAttribute } from "./text.ts";
import { absoluteUrl, isResource, linkKind } from "./urls.ts";

/**
 * Cleans a page in one streaming pass, for callers that need HTML rather than extracted facts,
 * such as a scraper that stores the page or hands it to a converter. EXIF and XMP blobs and
 * binary-looking text are always removed; everything else is removed only when asked.
 */

export interface CleanOptions {
  /** The page's address, needed to filter links by kind. */
  url: string | URL;
  remove?: {
    scripts?: boolean;
    /** Style elements, style attributes, and inline SVG. */
    styles?: boolean;
    comments?: boolean;
    /** The consent tools' dialogs, banners, and content blockers, see `consentSelectors`. */
    cookieConsent?: boolean;
    /**
     * What screen readers do not get: `aria-hidden="true"`, `inert`, and texts for screen readers
     * only, such as skip links. The main landmark stays, see `hiddenFromReaders`.
     */
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

/**
 * The dialogs, banners, and content blockers of widespread consent tools: Borlabs Cookie,
 * Cookiebot, Usercentrics, Complianz, CookieYes, Cookie Law Info, OneTrust, Klaro, CCM19, Real
 * Cookie Banner, consentmanager, CookieConsent, Didomi, Sourcepoint, Quantcast, TrustArc, Moove,
 * and ids that name a cookie or consent banner. Selectors HTMLRewriter and the `context` option
 * accept, for callers that leave the consent tool out of what they read or measure.
 */
export const consentSelectors: readonly string[] = [
  "#BorlabsCookieBox",
  "[id^='brlbs-cmpnt']",
  "[class^='brlbs-cmpnt']",
  ".brlbs-cmpnt-dialog",
  "[consent-skip-blocker]",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  "#usercentrics-cmp-ui",
  ".cmplz-cookiebanner",
  "#cmplz-cookiebanner-container",
  ".cky-consent-container",
  "#cookie-law-info-bar",
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
  ".klaro",
  "#ccm-widget",
  ".ccm-root",
  ".rcb-banner",
  "[id^='real-cookie-banner']",
  "#cmpbox",
  "#cmpbox2",
  ".cmpboxBG",
  "#cc-main",
  "#didomi-host",
  "[id^='sp_message_container']",
  ".qc-cmp2-container",
  "#truste-consent-track",
  "#moove_gdpr_cookie_info_bar",
  "[id*='cookie-banner' i]",
  "[id*='cookiebanner' i]",
  "[id*='consent-banner' i]",
  "div[class*='consent-banner']",
  "div[id*='consent-modal']",
  "div[class*='consent-modal']",
  "div[id*='consent-wrapper']",
  "div[class*='consent-wrapper']",
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
    rewriter = rewriter.on(consentSelectors.join(", "), remove);
  }
  if (removed.ariaHidden) {
    rewriter = rewriter
      .on("[aria-hidden='true'], [inert]", {
        element(element) {
          // The main landmark an open dialog marked hidden stays; see `hiddenFromReaders`.
          if (
            hiddenFromReaders(
              element.tagName,
              Object.fromEntries(element.attributes)
            )
          ) {
            element.remove();
          }
        },
      })
      .on(
        ".screen-reader-text, .sr-only, .visually-hidden, .skip-link",
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
        const href = readAttribute(element, "href");
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
