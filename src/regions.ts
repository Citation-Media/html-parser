/**
 * The regions of a page: its header, navigation, search, sidebar, footer, and main content, by
 * landmark elements and roles and by the ids and classes widespread themes and page builders give
 * their header, footer, and sidebar. Header, navigation, search, sidebar, and footer are the page's
 * chrome, which every page of a site repeats around its own content.
 */

export type Region =
  | "header"
  | "navigation"
  | "search"
  | "sidebar"
  | "footer"
  | "main";

/** The regions that frame a page's own content, which `contentMarkdown` leaves out. */
export const chromeRegions: ReadonlySet<Region> = new Set([
  "header",
  "navigation",
  "search",
  "sidebar",
  "footer",
]);

/**
 * Decides an element's region, given what `regionOf` says about its markup (`byMarkup`):
 * `undefined` where it opens none, so it lies in the region around it. A caller adds its theme's
 * header with `(tag, attributes, byMarkup) => attributes.id === "top" ? "header" : byMarkup`.
 */
export type RegionRule = (
  tag: string,
  attributes: Record<string, string>,
  byMarkup: Region | undefined
) => Region | undefined;

const landmarkRoles = new Map<string, Region>([
  ["banner", "header"],
  ["complementary", "sidebar"],
  ["contentinfo", "footer"],
  ["main", "main"],
  ["navigation", "navigation"],
  ["search", "search"],
]);

const landmarkTags = new Map<string, Region>([
  ["aside", "sidebar"],
  ["footer", "footer"],
  ["header", "header"],
  ["main", "main"],
  ["nav", "navigation"],
  ["search", "search"],
]);

// Themes and page builders name their header, footer, and sidebar on a container: WordPress
// themes such as Twenty Twenty-Five, Astra, GeneratePress, and Kadence, Elementor, Divi, and Bricks.
const containers = new Set([
  "aside",
  "div",
  "footer",
  "header",
  "nav",
  "section",
]);
const markedIds = new Map<string, Region>([
  ["brx-footer", "footer"],
  ["brx-header", "header"],
  ["colophon", "footer"],
  ["footer", "footer"],
  ["header", "header"],
  ["main-footer", "footer"],
  ["main-header", "header"],
  ["masthead", "header"],
  ["secondary", "sidebar"],
  ["sidebar", "sidebar"],
  ["site-footer", "footer"],
  ["site-header", "header"],
]);
const markedClasses = new Map<string, Region>([
  ["elementor-location-footer", "footer"],
  ["elementor-location-header", "header"],
  ["et-l--footer", "footer"],
  ["et-l--header", "header"],
  ["site-footer", "footer"],
  ["site-header", "header"],
  ["widget-area", "sidebar"],
]);
const builderTypes = new Map<string, Region>([
  ["footer", "footer"],
  ["header", "header"],
]);

const byClass = (classes: string | undefined) =>
  (classes ?? "")
    .split(/\s+/u)
    .map((name) => markedClasses.get(name.toLowerCase()))
    .find(Boolean);

/**
 * The region an element opens by its markup: a landmark role such as `banner` or `contentinfo`, a
 * landmark element such as `<header>`, `<nav>`, or `<aside>`, or on a container the id, class, or
 * Elementor type a theme or page builder gives its header, footer, or sidebar. `undefined` where
 * it opens none. Whether a header, footer, or sidebar inside the main content belongs to it is up
 * to `enterRegion`.
 */
export const regionOf = (
  tag: string,
  attributes: Record<string, string>
): Region | undefined => {
  const [role] = (attributes.role ?? "").trim().toLowerCase().split(/\s+/u);
  if (role) {
    const landmark = landmarkRoles.get(role);
    if (landmark || role === "none" || role === "presentation") {
      return landmark;
    }
  }
  const landmark = landmarkTags.get(tag);
  if (landmark) {
    return landmark;
  }
  if (!containers.has(tag)) {
    return undefined;
  }
  const id = attributes.id?.toLowerCase();
  return (
    (id && markedIds.get(id)) ||
    byClass(attributes.class) ||
    builderTypes.get((attributes["data-elementor-type"] ?? "").toLowerCase())
  );
};

/** Where an element lies: its region, and whether it is inside the main content or an article. */
export interface RegionScope {
  region: Region | undefined;
  inContent: boolean;
}

export const outsideRegions: RegionScope = {
  inContent: false,
  region: undefined,
};

/** What `enterRegion` tells about an element. */
export interface EnteredRegion {
  scope: RegionScope;
  /** Whether it opens the page's chrome: a chrome region not inside another. */
  opensChrome: boolean;
}

// A header, footer, or sidebar inside the main content or an article belongs to it, as an
// article's byline or a post's related links do; navigation and search count wherever they are.
const scopedToContent = new Set<Region>(["header", "footer", "sidebar"]);

/** The scope of an element inside `parent`, as `rule` or `regionOf` decides its own region. */
export const enterRegion = (
  tag: string,
  attributes: Record<string, string>,
  parent: RegionScope,
  rule: RegionRule | undefined
): EnteredRegion => {
  const byMarkup = regionOf(tag, attributes);
  let own = rule ? rule(tag, attributes, byMarkup) : byMarkup;
  if (own && parent.inContent && scopedToContent.has(own)) {
    own = undefined;
  }
  const inChrome =
    parent.region !== undefined && chromeRegions.has(parent.region);
  return {
    opensChrome: own !== undefined && chromeRegions.has(own) && !inChrome,
    scope: {
      inContent: parent.inContent || own === "main" || tag === "article",
      region: own ?? parent.region,
    },
  };
};
