/**
 * Estimates, without a browser, whether an element lies in the first screen of a desktop visit,
 * below it, or is not rendered at all. A streaming pass knows no sizes, so the estimate reads what
 * the markup says: how much visible text and how many images come before the element in source
 * order, and whether it sits in a hidden, sliding, or fixed container. It only answers where the
 * markup is clear and is `unknown` otherwise.
 *
 * Calibrated against Chromium at 1440 × 900 on 17 sites, from small company sites to a news
 * portal, with 1,130 images and Astro islands; see the README for the measured precision.
 */

/**
 * Where an element is expected on a desktop visit before scrolling. `first-screen` and `below`
 * are claims about position: an element estimated in the first screen was never measured below
 * it, though some, such as images in a closed menu, are not rendered at all, and an element
 * estimated below is not seen in the first screen. `hidden` elements are, in the markup, not
 * rendered until something opens them.
 */
export type ScreenPosition = "first-screen" | "below" | "hidden" | "unknown";

/** What the markup says about an element when the pass reaches it, before its own content. */
export interface Spot {
  /** Visible text before the element, in characters. */
  text: number;
  /** Visible images before the element. */
  images: number;
  hidden: boolean;
  /** Inside a carousel, slider, or marquee, whose slides the markup lists side by side. */
  carousel: boolean;
  /** Inside a header or an element whose classes say it is fixed or sticky. */
  fixed: boolean;
}

/** The layout state of one pass: depths of the open containers and what came before. */
export interface Layout {
  text: number;
  images: number;
  hidden: number;
  skipped: number;
  carousel: number;
  fixed: number;
  /** Open <nav> and <header> elements, whose text does not push content down much. */
  navigation: number;
  /** Whether the element the handlers are reading hides its content itself. */
  ownHidden: boolean;
  /** Text and images before the element the handlers are reading. */
  textBefore: number;
  imagesBefore: number;
}

// Up to this much text before it and no image, an element is in the first screen.
const firstScreenText = 200;
// From this much text before it and this share of the page's text, an element is below it.
const belowText = 1500;
const belowShare = 0.25;

const skippedTags = new Set([
  "noscript",
  "script",
  "style",
  "svg",
  "template",
  "title",
]);

// Containers that are closed until a visitor opens them, and text only screen readers get.
const hiddenClass =
  /(?:^|[\s_-])(?:modal|drawer|offcanvas|off-canvas|popover|tooltip|sr-only|visually-hidden|screen-reader-text)(?:$|[\s_-])/iu;
const carouselClass =
  /carousel|slider|swiper|slick|splide|glide|owl-|flickity|marquee|ticker|scroller|embla|keen-slider|snap/iu;
const fixedClass =
  /(?:^|[\s:_-])(?:fixed|sticky)(?:$|[\s_-])|position-fixed|is-fixed|is-sticky/iu;
const hiddenStyle = /display\s*:\s*none|visibility\s*:\s*hidden/iu;

export const emptyLayout = (): Layout => ({
  carousel: 0,
  fixed: 0,
  hidden: 0,
  images: 0,
  imagesBefore: 0,
  navigation: 0,
  ownHidden: false,
  skipped: 0,
  text: 0,
  textBefore: 0,
});

/** An element's attributes, with entities decoded. */
type Attributes = Record<string, string>;

const hides = (tag: string, attributes: Attributes) =>
  (tag === "dialog" && !("open" in attributes)) ||
  "hidden" in attributes ||
  hiddenStyle.test(attributes.style ?? "") ||
  hiddenClass.test(attributes.class ?? "");

type Container = "hidden" | "skipped" | "carousel" | "fixed" | "navigation";

/** The containers of an element that opens none, which most elements are. */
const none: readonly Container[] = [];

const change = (
  layout: Layout,
  containers: readonly Container[],
  by: number
) => {
  for (const container of containers) {
    layout[container] += by;
  }
};

export const closeContainers = (
  layout: Layout,
  containers: readonly Container[]
) => change(layout, containers, -1);

const isHidden = (layout: Layout) =>
  layout.ownHidden || layout.hidden > 0 || layout.skipped > 0;

/** The containers an element opens. */
const containersOf = (
  tag: string,
  attributes: Attributes,
  names: string
): readonly Container[] => {
  const hidden = hides(tag, attributes);
  const skipped = skippedTags.has(tag);
  const carousel = names !== "" && carouselClass.test(names);
  const fixed = tag === "header" || (names !== "" && fixedClass.test(names));
  const navigation = tag === "nav" || tag === "header";
  if (!(hidden || skipped || carousel || fixed || navigation)) {
    return none;
  }
  const opened: Container[] = [];
  if (hidden) {
    opened.push("hidden");
  }
  if (skipped) {
    opened.push("skipped");
  }
  if (carousel) {
    opened.push("carousel");
  }
  if (fixed) {
    opened.push("fixed");
  }
  if (navigation) {
    opened.push("navigation");
  }
  return opened;
};

/**
 * Reads an element's start tag: records what comes before it, opens the containers it opens, and
 * returns them for `closeContainers` at its end tag.
 */
export const readElement = (
  layout: Layout,
  tag: string,
  attributes: Attributes
): readonly Container[] => {
  const { class: classes, id } = attributes;
  // Most elements carry neither, and their names need no pattern.
  const names =
    classes === undefined && id === undefined
      ? ""
      : `${classes ?? ""} ${id ?? ""}`;
  const opened = containersOf(tag, attributes, names);
  layout.ownHidden = opened.includes("hidden") || opened.includes("skipped");
  layout.textBefore = layout.text;
  layout.imagesBefore = layout.images;
  if (tag === "img" && !isHidden(layout)) {
    layout.images += 1;
  }
  change(layout, opened, 1);
  return opened;
};

/** The spot of the element the handlers are reading, for an image or island asked about. */
export const spotOf = (layout: Layout): Spot => ({
  // Its own containers are already open, so the depths count it.
  carousel: layout.carousel > 0,
  fixed: layout.fixed > 0,
  hidden: isHidden(layout),
  images: layout.imagesBefore,
  text: layout.textBefore,
});

/** Counts a text chunk that a visitor sees in the page's flow. */
export const readText = (layout: Layout, text: string) => {
  if (layout.hidden + layout.skipped + layout.navigation > 0) {
    return;
  }
  // Text outside <pre> arrives with its whitespace collapsed; only other text needs the pattern.
  layout.text += (
    /[^\S ]| {2}/u.test(text) ? text.replaceAll(/\s+/gu, " ") : text
  ).trim().length;
};

/** The position of a spot, once the page's whole text is known. */
export const positionOf = (spot: Spot, totalText: number): ScreenPosition => {
  if (spot.hidden) {
    return "hidden";
  }
  if (spot.carousel) {
    return "unknown";
  }
  if (spot.text < firstScreenText && spot.images === 0) {
    return "first-screen";
  }
  // A fixed header stays in the first screen however much text the page has before it.
  if (spot.fixed) {
    return "unknown";
  }
  if (spot.text >= belowText && spot.text >= belowShare * totalText) {
    return "below";
  }
  return "unknown";
};
