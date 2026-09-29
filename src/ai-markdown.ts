import { cleanHtml } from "./clean.ts";
import type { CleanOptions } from "./clean.ts";

/**
 * Markdown by Workers AI's document conversion, the second way besides the streaming Markdown of
 * `parseHtml`. It handles tables and nested formatting better, at the cost of a service call. The
 * page is cleaned first: scripts, styles, consent banners, and hidden helpers only cost tokens.
 */

/** The part of the Workers AI binding this needs, so callers can pass `env.AI` as it is. */
export interface MarkdownConverter {
  toMarkdown: (
    files: { name: string; blob: Blob }[]
  ) => Promise<{ format: string; data?: string }[]>;
}

export interface AiMarkdownOptions extends Pick<
  CleanOptions,
  "url" | "links" | "context"
> {
  /** Keeps images in the Markdown. Default false. */
  images?: boolean;
}

export const markdownWithAi = async (
  ai: MarkdownConverter,
  input: string | Response,
  { images = false, ...options }: AiMarkdownOptions
): Promise<string> => {
  const html = await cleanHtml(input, {
    ...options,
    remove: {
      ariaHidden: true,
      classes: true,
      comments: true,
      cookieConsent: true,
      hyphenation: true,
      ids: true,
      images: !images,
      linkTags: true,
      meta: true,
      scripts: true,
      styles: true,
    },
  });
  const [converted] = await ai.toMarkdown([
    { blob: new Blob([html], { type: "text/html" }), name: "index.html" },
  ]);
  return converted?.format === "markdown" ? (converted.data ?? "") : "";
};
