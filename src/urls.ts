/**
 * URL rules shared by link and image extraction: resolving against the page, telling the site's
 * own links from others, and recognising special protocols and downloadable resources.
 */

export type LinkKind = "internal" | "external" | "special" | "anchor";

// A URL's scheme: a letter, then letters, digits, `+`, `-`, and `.`, up to the colon.
const scheme = /^[a-z][a-z\d+.-]*:/iu;

// Files a link downloads or plays rather than pages: documents, archives, media, and images.
const resourceExtensions =
  /\.(?:pdf|docx?|xlsx?|pptx?|od[tsp]|rtf|csv|epub|vcf|ics|zip|rar|7z|tar|t?gz|bz2|exe|msi|dmg|apk|mp3|m4a|wav|ogg|mp4|m4v|webm|avi|mov|mkv|wmv|jpe?g|png|gif|svg|webp|avif|bmp|tiff?|ico)$/iu;

// Second-level labels under which registrable domains sit one level deeper, such as example.co.uk.
// `or.at` and `or.jp` register organisations, as `org` does elsewhere.
const secondLevels = /^(?:co|com|org|net|gov|gv|ac|edu|or)$/u;

/**
 * The scheme of a URL that leads to no web page, lower-cased, such as `mailto:`, `tel:`,
 * `whatsapp:`, or `javascript:`: every scheme but `http:` and `https:`, whether widely known or
 * made up by one app. Undefined for web and relative URLs.
 */
export const specialProtocol = (url: string) => {
  const protocol = scheme.exec(url.trim())?.[0].toLowerCase();
  return protocol === "http:" || protocol === "https:" ? undefined : protocol;
};

/** The registrable part of a host, good enough to tell a site's own hosts from third parties. */
export const siteOf = (host: string) => {
  const parts = host
    .toLowerCase()
    .replace(/^www\./u, "")
    .split(".");
  return parts.slice(secondLevels.test(parts.at(-2) ?? "") ? -3 : -2).join(".");
};

/**
 * Resolves `url` against the page. Scheme and host are normalised by `URL`; paths keep their case,
 * because servers treat them as case-sensitive. `mail:` becomes `mailto:` and addresses are
 * lowercased; a subject or body after them stays as written. Special URLs other than mail stay as
 * written.
 */
export const absoluteUrl = (url: string, base: URL): string => {
  const trimmed = url.trim();
  const protocol = specialProtocol(trimmed);
  if (protocol === "mail:" || protocol === "mailto:") {
    const rest = trimmed.slice(protocol.length);
    const query = rest.indexOf("?");
    const end = query === -1 ? rest.length : query;
    return `mailto:${rest.slice(0, end).toLowerCase()}${rest.slice(end)}`;
  }
  if (protocol) {
    return trimmed;
  }
  try {
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
};

/** Whether the URL points to a file download such as a PDF, rather than a page. */
export const isResource = (url: string) => {
  try {
    return resourceExtensions.test(new URL(url).pathname);
  } catch {
    return resourceExtensions.test(url);
  }
};

const withoutFragment = (url: string) => url.split("#")[0] ?? url;

/**
 * What a link is, judged from its written `href`, its resolved URL, and the page's address. An
 * `anchor` is written as a fragment, `#team` or `/#team`, and stays on the page: `/#team` anywhere
 * but on the home page, or `#team` under a `<base href>` elsewhere, leads to another page.
 */
export const linkKind = (
  href: string,
  resolved: string,
  base: URL
): LinkKind => {
  const written = href.trim();
  if (specialProtocol(written)) {
    return "special";
  }
  if (
    (written.startsWith("#") || written.startsWith("/#")) &&
    withoutFragment(resolved) === withoutFragment(base.href)
  ) {
    return "anchor";
  }
  try {
    return siteOf(new URL(resolved).hostname) === siteOf(base.hostname)
      ? "internal"
      : "external";
  } catch {
    return "external";
  }
};
