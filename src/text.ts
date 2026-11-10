/**
 * Text helpers. The parser's texts arrive from mdream's tokenizer with their entities decoded and
 * only have their whitespace and hyphenation normalised here; `cleanHtml` recognises
 * binary-looking text with `looksBinary`.
 */

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
