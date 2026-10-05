import { ValidatePlugin } from "unhead/plugins";
import type { RulesConfig, ValidationRuleId } from "unhead/plugins";
import { capoTagWeight, createHead } from "unhead/server";
import type { ResolvableHead } from "unhead/types";

/**
 * The page's `<head>` as unhead sees it: the pass collects its elements in page order and hands them
 * to unhead's own validator and its Capo weights, so the rules and the recommended order are
 * unhead's, not a copy. unhead normally sorts and deduplicates what it renders; here every element
 * is its own entry with one weight, so the order and the tags are the page's.
 */

/** Elements that belong in `<head>`. */
export type HeadTagName =
  | "base"
  | "link"
  | "meta"
  | "noscript"
  | "script"
  | "style"
  | "title";

export interface HeadElement {
  tag: HeadTagName;
  attributes: Record<string, string>;
  /** UTF-8 bytes of an inline script's, style's, or `<noscript>`'s content. */
  size?: number;
  /** The title's text. */
  text?: string;
  /**
   * Capo's weight for the element, from unhead: the lower, the earlier it belongs, from
   * `-30` for a Content-Security-Policy over `10` for the title to `100`. An element with a
   * lower weight than one before it stands later than it should.
   */
  weight: number;
}

export interface HeadIssue {
  /** unhead's rule id, such as `render-blocking-script` or `too-many-preloads`. */
  rule: ValidationRuleId;
  /** unhead's message, in English. */
  message: string;
  severity: "warn" | "info";
  /** The element the issue is about, as its index in `elements`; rules about the whole head have none. */
  element?: number;
}

export interface PageHead {
  elements: HeadElement[];
  issues: HeadIssue[];
}

export interface HeadOptions {
  /** unhead's rule configuration, such as `{ "too-many-preloads": ["warn", { max: 10 }] }`. */
  rules?: RulesConfig;
}

/** An element the pass is still reading; its content arrives as text. */
export interface OpenHeadElement {
  tag: HeadTagName;
  attributes: Record<string, string>;
  content: string[];
}

const headTags = new Set<string>([
  "base",
  "link",
  "meta",
  "noscript",
  "script",
  "style",
  "title",
]);

export const isHeadTag = (name: string): name is HeadTagName =>
  headTags.has(name);

// Rules about using unhead's API, which a page someone else built cannot break.
const apiRules: RulesConfig = {
  "deprecated-option-mode": "off",
  "deprecated-prop-body": "off",
  "deprecated-prop-children": "off",
  "deprecated-prop-hid-vmid": "off",
  "invalid-input-shape": "off",
  "missing-alias-sorting-plugin": "off",
  "missing-template-params-plugin": "off",
  "numeric-tag-priority": "off",
  "prefer-define-helpers": "off",
  "streamed-tag-hidden-from-bots": "off",
};

// Boolean attributes the tokenizer reads as "" and unhead tests for truth.
const booleanAttributes = new Set(["async", "defer", "nomodule"]);

const propsOf = (attributes: Record<string, string>) => {
  const props: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(attributes)) {
    props[name] = booleanAttributes.has(name) && value === "" ? true : value;
  }
  return props;
};

const encoder = new TextEncoder();

/** The element as one unhead input entry, or nothing for what unhead does not render. */
const entryOf = (
  tag: HeadTagName,
  content: string,
  props: Record<string, string | boolean>
): ResolvableHead | undefined => {
  if (tag === "title") {
    return { title: content };
  }
  if (tag === "noscript") {
    return undefined;
  }
  let page = props;
  if (tag === "script" && content) {
    page = { ...props, innerHTML: content };
  } else if (tag === "style") {
    page = { ...props, textContent: content };
  }
  // SAFETY: unhead's input types describe what an app writes; a page's attributes are any strings,
  // and unhead's validator reads them as such, as its own HTML parser hands them over.
  return (tag === "base" ? { base: page } : { [tag]: [page] }) as never;
};

/** The Capo weight of an element, by unhead's `capoTagWeight`. */
const weightOf = (
  tag: HeadTagName,
  props: Record<string, string>,
  content: string
) =>
  capoTagWeight({
    innerHTML: tag === "script" ? content : undefined,
    props,
    tag,
    textContent: tag === "style" ? content : undefined,
  });

/** Validates the collected head with unhead and weighs its elements by Capo. */
export const readHead = (
  open: readonly OpenHeadElement[],
  options: HeadOptions = {}
): PageHead => {
  const issues: HeadIssue[] = [];
  const entries = new Map<number, number>();
  const head = createHead({
    plugins: [
      ValidatePlugin({
        onReport(rules) {
          for (const { id, message, severity, tag } of rules) {
            // unhead numbers a tag by its entry times 1024 plus its place in the entry.
            const element =
              tag?._p === undefined
                ? undefined
                : entries.get(Math.floor(tag._p / 1024));
            issues.push({
              element,
              message,
              rule: id,
              severity,
            });
          }
        },
        rules: { ...apiRules, ...options.rules },
      }),
    ],
    // One weight for all keeps the page's order, which charset-not-early reads.
    tagWeight: () => 100,
  });
  const elements = open.map((element, index): HeadElement => {
    const content = element.content.join("");
    const props = propsOf(element.attributes);
    const entry = entryOf(element.tag, content, props);
    if (entry) {
      entries.set(head.push(entry)._i, index);
    }
    const read: HeadElement = {
      attributes: element.attributes,
      tag: element.tag,
      // Capo reads a boolean attribute's "" as set, as HTML does.
      weight: weightOf(element.tag, element.attributes, content),
    };
    if (element.tag === "title") {
      read.text = content.replaceAll(/\s+/gu, " ").trim();
    } else if (content) {
      read.size = encoder.encode(content).byteLength;
    }
    return read;
  });
  head.render();
  return { elements, issues };
};
