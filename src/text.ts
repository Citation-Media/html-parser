/**
 * Text as HTMLRewriter delivers it: raw source text in chunks, with entities still encoded. The
 * parser collects chunks per run of text and decodes them here, so an entity split across two
 * chunks is still decoded correctly.
 */

const named = new Map(
  Object.entries({
    Auml: "Ä",
    Ouml: "Ö",
    Uuml: "Ü",
    amp: "&",
    apos: "'",
    auml: "ä",
    bdquo: "„",
    bull: "•",
    copy: "©",
    euro: "€",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: " ",
    ndash: "–",
    ouml: "ö",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
    sbquo: "‚",
    shy: "",
    szlig: "ß",
    trade: "™",
    uuml: "ü",
  })
);

const fromCodePoint = (value: number) => {
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
};

/** Decodes numeric and common named entities; unknown names stay as written. */
export const decodeEntities = (text: string) =>
  text.replaceAll(
    /&(?:#(?<decimal>\d+)|#x(?<hex>[\da-f]+)|(?<name>[a-z]+\d?));/giu,
    (
      entity,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined
    ) => {
      if (decimal) {
        return fromCodePoint(Number(decimal));
      }
      if (hex) {
        return fromCodePoint(Number.parseInt(hex, 16));
      }
      return named.get(name ?? "") ?? entity;
    }
  );

/** Soft hyphens and zero-width characters that split words for layout only. */
export const removeHyphenation = (text: string) => text.replaceAll(/[­​]/gu, "");

/** Whitespace collapsed to single spaces, as a browser renders normal text. */
export const collapseWhitespace = (text: string) =>
  text.replaceAll(/\s+/gu, " ");

// Control characters other than tab and line breaks, which words never contain.
// oxlint-disable-next-line no-control-regex -- control characters are what this detects.
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;

/**
 * Whether text looks like binary data or an EXIF/XMP blob rather than words. The thresholds stay
 * conservative so umlauts and other normal characters never trigger it.
 */
export const looksBinary = (text: string) => {
  if (text.length < 16) {
    return false;
  }
  if (
    /8BIM|Exif|Photoshop 3\.0|Adobe XMP Core|xmpmeta|rdf:RDF|xpacket/iu.test(
      text
    )
  ) {
    return true;
  }
  const control = text.match(controlCharacters)?.length ?? 0;
  return (
    text.includes("\u0000") || control > 20 || control / text.length > 0.05
  );
};
