/**
 * URL rules shared by link and image extraction: resolving against the page, telling the site's
 * own links from others, and recognising special protocols and downloadable resources.
 */

export type LinkKind = "internal" | "external" | "special" | "anchor";

const specialProtocols = [
  "mailto:",
  "mail:",
  "tel:",
  "sms:",
  "ftp:",
  "ftps:",
  "ssh:",
  "git:",
  "svn:",
  "news:",
  "irc:",
  "xmpp:",
  "webcal:",
  "skype:",
  "slack:",
  "spotify:",
  "steam:",
  "discord:",
  // oxlint-disable-next-line eslint/no-script-url -- recognised so such links are not followed.
  "javascript:",
  "data:",
  "blob:",
];

const resourceExtensions =
  /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|tar|gz|mp3|mp4|avi|mov|jpe?g|png|gif|svg|webp|avif|csv)$/iu;

// Second-level labels under which registrable domains sit one level deeper, such as example.co.uk.
const secondLevels = /^(?:co|com|org|net|gov|gv|ac|edu)$/u;

/** The special protocol of a URL, such as `mailto:`, or undefined for web and relative URLs. */
export const specialProtocol = (url: string) => {
  const lower = url.trim().toLowerCase();
  return specialProtocols.find((protocol) => lower.startsWith(protocol));
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
 * lowercased. Special URLs other than mail stay as written.
 */
export const absoluteUrl = (url: string, base: URL): string => {
  const trimmed = url.trim();
  const protocol = specialProtocol(trimmed);
  if (protocol === "mail:" || protocol === "mailto:") {
    return `mailto:${trimmed.slice(protocol.length).toLowerCase()}`;
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

/** What a link is, judged from its written `href` and its resolved URL. */
export const linkKind = (
  href: string,
  resolved: string,
  base: URL
): LinkKind => {
  const written = href.trim();
  if (specialProtocol(written)) {
    return "special";
  }
  if (written.startsWith("#") || written.startsWith("/#")) {
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
