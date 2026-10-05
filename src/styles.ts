import { colorsIn, parseColor, toHex } from "./colors.ts";

/**
 * A map of what a page's CSS defines and uses, without a browser: custom properties with their
 * definitions and the colours they resolve to, every colour a declaration paints with and whether
 * it reads a variable or writes the value itself, the font families declarations ask for, and the
 * `@font-face` rules. It reads CSS text it is given: the page's <style> blocks and style
 * attributes, which `parseHtml` collects with `styles`, and its stylesheets, which the caller
 * fetches and caches across the pages of a site. Nothing is rendered, so the map says what the CSS
 * writes, not which elements show it.
 */

export interface StyleSource {
  /** CSS text: a stylesheet, a <style> block, or the declarations of a style attribute. */
  css: string;
  /** Where it comes from, such as the stylesheet's URL, `inline`, or `attribute`. */
  origin: string;
  /** For a style attribute, the element, such as `div.hero`; its declarations need no selector. */
  element?: string;
}

/** One declaration as the CSS writes it, with the rule it belongs to. */
export interface StyleDeclaration {
  property: string;
  value: string;
  /** The rule's selector, `@font-face`, or for a style attribute its element. */
  selector: string;
  origin: string;
  /** The enclosing at-rules, such as `@media (max-width: 600px)`, outermost first. */
  atRules: string[];
  /** The number of the block it is in, counted per stylesheet, so a rule's declarations group. */
  block: number;
}

/** What `readDeclarations` finds in one stylesheet. */
export interface ReadCss {
  declarations: StyleDeclaration[];
  /** Stylesheets its `@import` rules load, as written. */
  imports: string[];
}

export interface StyleVariable {
  name: string;
  /** Every definition, with its value as written. */
  definitions: { value: string; selector: string; origin: string }[];
  /** The colour its root definition resolves to, as hex, where it is one. */
  color?: string;
  /** How many declarations read it through `var()`. */
  uses: number;
}

/** A colour a declaration paints with. */
export interface ColorUse {
  property: string;
  /** As six-digit hex, with the alpha apart. */
  color: string;
  alpha: number;
  selector: string;
  origin: string;
  /** The variable the colour comes through; a colour the declaration writes itself has none. */
  variable?: string;
}

export interface FontUse {
  /** The first family of the stack, which the browser tries first. */
  family: string;
  stack: string;
  selector: string;
  origin: string;
  /** The variable the stack comes through, where it does. */
  variable?: string;
}

export interface FontFace {
  family: string;
  origin: string;
  weight?: string;
  style?: string;
  /** The `font-display` descriptor, such as `swap`; missing means the browser's default, `auto`. */
  display?: string;
  /** The `src` descriptor as written, such as `url(inter.woff2) format("woff2")` or `local(Arial)`. */
  src?: string;
}

export interface StyleMap {
  variables: StyleVariable[];
  colors: ColorUse[];
  fonts: FontUse[];
  fontFaces: FontFace[];
  /** Stylesheets that `@import` loads, as written, for the caller to fetch too. */
  imports: string[];
}

// Bounds for pages with megabytes of CSS: the map stays useful without growing without limit.
const maxColors = 20_000;
const maxFonts = 5000;

/** Returns the index after the string literal that starts at `start`. */
const afterString = (css: string, start: number) => {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length && css[index] !== quote) {
    index += css[index] === "\\" ? 2 : 1;
  }
  return index + 1;
};

const importUrl = /url\(\s*["']?(?<url>[^"')]+)|["'](?<quoted>[^"']+)["']/u;

const declarationOf = (
  statement: string,
  stack: readonly string[],
  origin: string,
  block: number
): StyleDeclaration | null => {
  const colon = statement.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const property = statement.slice(0, colon).trim();
  if (!/^-?-?[\w-]+$/u.test(property)) {
    return null;
  }
  const atRules = stack.filter((prelude) => prelude.startsWith("@"));
  const rule = stack.findLast((prelude) => !prelude.startsWith("@"));
  const fontFace = atRules.at(-1)?.toLowerCase() === "@font-face";
  return {
    atRules,
    block,
    origin,
    property: property.startsWith("--") ? property : property.toLowerCase(),
    selector: fontFace ? "@font-face" : (rule ?? ""),
    value: statement
      .slice(colon + 1)
      .replace(/\s*!important\s*$/iu, "")
      .trim(),
  };
};

/**
 * The declarations of a stylesheet, in order, with their selectors and at-rules. A small reader
 * rather than a full CSS parser: it skips comments and strings, follows nested blocks such as
 * `@media`, `@layer`, and CSS nesting, and ignores what it cannot read instead of failing.
 */
export const readDeclarations = (css: string, origin: string): ReadCss => {
  const read: ReadCss = { declarations: [], imports: [] };
  const stack: string[] = [];
  // The number of each open block, so declarations of one rule share it.
  const blocks: number[] = [];
  let opened = 0;
  let buffer = "";
  let depth = 0;
  const flush = () => {
    const statement = buffer.trim();
    buffer = "";
    if (statement.startsWith("@import")) {
      const { url, quoted } = importUrl.exec(statement)?.groups ?? {};
      const href = url ?? quoted;
      if (href) {
        read.imports.push(href.trim());
      }
      return;
    }
    const declaration =
      statement && stack.length > 0
        ? declarationOf(statement, stack, origin, blocks.at(-1) ?? 0)
        : null;
    if (declaration) {
      read.declarations.push(declaration);
    }
  };
  let index = 0;
  while (index < css.length) {
    const char = css[index] ?? "";
    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = afterString(css, index);
      buffer += css.slice(index, end);
      index = end;
      continue;
    }
    index += 1;
    if (char === "(" || char === ")") {
      depth = Math.max(0, depth + (char === "(" ? 1 : -1));
    } else if (depth === 0 && char === "{") {
      stack.push(buffer.trim().replaceAll(/\s+/gu, " "));
      opened += 1;
      blocks.push(opened);
      buffer = "";
      continue;
    } else if (depth === 0 && (char === "}" || char === ";")) {
      flush();
      if (char === "}") {
        stack.pop();
        blocks.pop();
      }
      continue;
    }
    buffer += char;
  }
  flush();
  return read;
};

// Selectors whose custom properties hold for the whole page.
const rootSelector =
  /(?:^|,)\s*(?::root|html|:host|\*)(?=\s*(?:,|$|\[|:where|:is))/iu;

const colorProperty =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|text-decoration(?:-color)?|box-shadow|text-shadow|caret-color|accent-color|column-rule(?:-color)?)$/u;

const fontKeyword = /^(?:inherit|initial|unset|revert|revert-layer)$/iu;

const variableCall =
  /var\(\s*(?<name>--[\w-]+)\s*(?:,(?<fallback>[^()]*(?:\([^()]*\))*[^()]*))?\)/gu;

const firstFamily = (stack: string) =>
  (stack.split(",")[0] ?? "").trim().replaceAll(/^["']|["']$/gu, "");

// The family list of the `font` shorthand follows the size, which has a unit, and the line height.
const shorthandFamilies = (value: string) =>
  /(?:^|\s)[\d.]+(?:px|r?em|%|pt|vw|vh|ch|ex)(?:\/\S+)?\s+(?<families>.+)$/iu.exec(
    value
  )?.groups?.families ?? "";

const variablesRead = (value: string) =>
  [...value.matchAll(variableCall)].flatMap(({ groups }) =>
    groups?.name ? [groups.name] : []
  );

/** Every declaration of the sources; a style attribute's ones take its element as selector. */
const declarationsOf = (sources: readonly StyleSource[]) => {
  const all: ReadCss = { declarations: [], imports: [] };
  for (const source of sources) {
    const { element } = source;
    const read = readDeclarations(
      element === undefined ? source.css : `x{${source.css}}`,
      source.origin
    );
    all.declarations.push(
      ...(element === undefined
        ? read.declarations
        : read.declarations.map((declaration) => ({
            ...declaration,
            selector: element,
          })))
    );
    all.imports.push(...read.imports);
  }
  return all;
};

const unconditional = (declaration: StyleDeclaration) =>
  declaration.atRules.length === 0;

/**
 * Resolves `var()` through the variables' definitions. A definition on the root counts for the
 * page, one outside `@media` first; the order of definitions does not matter otherwise.
 */
const resolverOf = (declarations: readonly StyleDeclaration[]) => {
  const definitions = new Map<string, StyleDeclaration[]>();
  for (const declaration of declarations) {
    if (declaration.property.startsWith("--")) {
      const list = definitions.get(declaration.property) ?? [];
      list.push(declaration);
      definitions.set(declaration.property, list);
    }
  }
  const rootValue = (name: string) => {
    const list = definitions.get(name) ?? [];
    const onRoot = list.filter(({ selector }) => rootSelector.test(selector));
    return (
      onRoot.find(unconditional) ??
      onRoot[0] ??
      list.find(unconditional) ??
      list[0]
    )?.value;
  };
  const resolve = (
    value: string,
    seen: ReadonlySet<string> = new Set()
  ): string => {
    let resolved = "";
    let last = 0;
    for (const match of value.matchAll(variableCall)) {
      const { name = "", fallback } = match.groups ?? {};
      const own = seen.has(name) ? undefined : rootValue(name);
      let replacement = "";
      if (own !== undefined) {
        replacement = resolve(own, new Set([...seen, name]));
      } else if (fallback !== undefined) {
        replacement = resolve(fallback.trim(), seen);
      }
      resolved += value.slice(last, match.index) + replacement;
      last = match.index + match[0].length;
    }
    return resolved + value.slice(last);
  };
  return { definitions, resolve, rootValue };
};

type Resolve = (value: string) => string;

/** The colours a declaration paints with: those it writes itself, then those it reads. */
const colorUses = (
  { property, value, selector, origin }: StyleDeclaration,
  resolve: Resolve
): ColorUse[] => {
  // A colour outside var() and its fallback is one the declaration writes itself.
  const written = colorsIn(value.replaceAll(variableCall, " ")).map(
    (color) => ({
      alpha: color.alpha,
      color: toHex(color),
      origin,
      property,
      selector,
    })
  );
  const read = [...value.matchAll(variableCall)].flatMap((match) =>
    colorsIn(resolve(match[0])).map((color) => ({
      alpha: color.alpha,
      color: toHex(color),
      origin,
      property,
      selector,
      variable: match.groups?.name ?? "",
    }))
  );
  return [...written, ...read];
};

const fontUse = (
  { property, value, selector, origin }: StyleDeclaration,
  resolve: Resolve
): FontUse | null => {
  const written = property === "font" ? shorthandFamilies(value) : value;
  const stack = resolve(written).trim();
  const family = firstFamily(stack);
  if (!family || fontKeyword.test(family)) {
    return null;
  }
  const [variable] = variablesRead(written);
  return { family, origin, selector, stack, ...(variable && { variable }) };
};

const faceDescriptors = new Map<string, "display" | "src" | "style" | "weight">(
  [
    ["font-display", "display"],
    ["font-style", "style"],
    ["font-weight", "weight"],
    ["src", "src"],
  ]
);

/** The `@font-face` rules, each from its block's declarations, in whatever order they come. */
const fontFacesOf = (
  declarations: readonly StyleDeclaration[],
  resolve: Resolve
): FontFace[] => {
  const faces = new Map<string, FontFace>();
  for (const { property, value, origin, selector, block } of declarations) {
    if (selector !== "@font-face") {
      continue;
    }
    const key = `${origin} ${block}`;
    const face = faces.get(key) ?? { family: "", origin };
    const descriptor = faceDescriptors.get(property);
    if (property === "font-family") {
      face.family = firstFamily(resolve(value));
    } else if (descriptor) {
      face[descriptor] = value;
    }
    faces.set(key, face);
  }
  return [...faces.values()].filter(({ family }) => family);
};

/** Builds the map from CSS sources: stylesheets, <style> blocks, and style attributes. */
export const readStyles = (sources: readonly StyleSource[]): StyleMap => {
  const { declarations, imports } = declarationsOf(sources);
  const { definitions, resolve, rootValue } = resolverOf(declarations);
  const uses = new Map<string, number>();
  const map: StyleMap = {
    colors: [],
    fontFaces: [],
    fonts: [],
    imports,
    variables: [],
  };
  for (const declaration of declarations) {
    const { property, selector } = declaration;
    if (property.startsWith("--")) {
      continue;
    }
    for (const name of variablesRead(declaration.value)) {
      uses.set(name, (uses.get(name) ?? 0) + 1);
    }
    if (selector === "@font-face") {
      continue;
    }
    if (!declaration.atRules.some((rule) => /^@keyframes/iu.test(rule))) {
      if (colorProperty.test(property) && map.colors.length < maxColors) {
        map.colors.push(...colorUses(declaration, resolve));
      }
      const font =
        (property === "font-family" || property === "font") &&
        map.fonts.length < maxFonts
          ? fontUse(declaration, resolve)
          : null;
      if (font) {
        map.fonts.push(font);
      }
    }
  }
  map.fontFaces = fontFacesOf(declarations, resolve);
  map.variables = [...definitions].map(([name, list]) => {
    const resolved = resolve(rootValue(name) ?? "").trim();
    const color = resolved.length < 80 ? parseColor(resolved) : null;
    return {
      definitions: list.map(({ origin, selector, value }) => ({
        origin,
        selector,
        value,
      })),
      name,
      uses: uses.get(name) ?? 0,
      ...(color && color.alpha > 0 && { color: toHex(color) }),
    };
  });
  return map;
};
