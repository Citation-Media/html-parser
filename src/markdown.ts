import { TEXT_NODE } from "@mdream/js";
import type { ElementNode, Node, TransformPlugin } from "@mdream/js";

import { hidesContent } from "./layout.ts";
import type { HiddenRule } from "./parse.ts";
import { enterRegion, outsideRegions } from "./regions.ts";
import type { RegionRule, RegionScope } from "./regions.ts";
import { compileSelector } from "./selector.ts";
import type { Frame, Matcher } from "./selector.ts";

/**
 * The hooks the parser gives mdream's converter: one that leaves elements out of the Markdown, and
 * one that marks where the page's chrome begins and ends, so one conversion yields the Markdown with
 * and without it (`splitChrome`).
 */

/** What `markdownExclude` leaves out of the Markdown, with their content. */
export interface MarkdownExclude {
  /** Elements matching this CSS selector, such as `consentSelectors` or `[role='dialog']`. */
  selector?: string;
  /** Elements that hide their content: what `hidesContent` says, or what a `HiddenRule` decides. */
  hidden?: boolean | HiddenRule;
}

// Noncharacters, which no page text carries: they open and close the chrome in mdream's output.
const chromeStart = "﷐";
const chromeEnd = "﷑";
const markers = /[﷐﷑]/u;

const isElement = (node: Node): node is ElementNode => node.type !== TEXT_NODE;

/** An element as the selector matcher sees it, with the counts its children's positions need. */
interface MatchFrame extends Frame {
  children: number;
  types: Map<string, number>;
}

/** The frames of mdream's elements, built as they enter, for selectors with positions. */
const framesOf = () => {
  const frames = new WeakMap<ElementNode, MatchFrame>();
  return (node: ElementNode) => {
    const parent = node.parent ? frames.get(node.parent) : undefined;
    const frame: MatchFrame = {
      attributes: node.attributes ?? {},
      children: 0,
      name: node.name,
      parent,
      position: 1,
      typePosition: 1,
      types: new Map(),
    };
    if (parent) {
      parent.children += 1;
      frame.position = parent.children;
      frame.typePosition = (parent.types.get(node.name) ?? 0) + 1;
      parent.types.set(node.name, frame.typePosition);
    }
    frames.set(node, frame);
    return frame;
  };
};

const hiddenRuleOf = (hidden: MarkdownExclude["hidden"]) => {
  if (hidden === true) {
    return (tag: string, attributes: Record<string, string>) =>
      hidesContent(tag, attributes);
  }
  return hidden
    ? (tag: string, attributes: Record<string, string>) =>
        hidden(tag, attributes, hidesContent(tag, attributes))
    : undefined;
};

/** A hook that skips the elements `exclude` names, with their content. */
const excludeHook = (exclude: MarkdownExclude): TransformPlugin | undefined => {
  const matcher: Matcher | undefined = exclude.selector
    ? compileSelector(exclude.selector)
    : undefined;
  const hides = hiddenRuleOf(exclude.hidden);
  if (!(matcher || hides)) {
    return undefined;
  }
  const frameOf = framesOf();
  const skipped = new WeakSet<Node>();
  const excludes = (node: ElementNode) => {
    if (skipped.has(node)) {
      return true;
    }
    if (node.parent && skipped.has(node.parent)) {
      skipped.add(node);
      return true;
    }
    const attributes = node.attributes ?? {};
    const frame = frameOf(node);
    if (hides?.(node.name, attributes) || matcher?.(frame)) {
      skipped.add(node);
      return true;
    }
    return false;
  };
  return {
    beforeNodeProcess: ({ node, type }) => {
      if (!isElement(node)) {
        return node.parent && skipped.has(node.parent)
          ? { skip: true }
          : undefined;
      }
      // An element is decided as it enters; its exit follows that decision.
      const skip = type === 0 ? excludes(node) : skipped.has(node);
      return skip ? { skip: true } : undefined;
    },
    excludesOverflowSubtree: excludes,
  };
};

/** A hook that marks where the page's chrome begins and ends, see `splitChrome`. */
const chromeHook = (rule: RegionRule | undefined): TransformPlugin => {
  const scopes = new WeakMap<ElementNode, RegionScope>();
  const opened = new WeakSet<ElementNode>();
  return {
    beforeNodeProcess: ({ node, type }) => {
      if (type !== 0 || !isElement(node)) {
        return;
      }
      const parent = (node.parent && scopes.get(node.parent)) || outsideRegions;
      const { opensChrome, scope } = enterRegion(
        node.name,
        node.attributes ?? {},
        parent,
        rule
      );
      scopes.set(node, scope);
      if (opensChrome) {
        opened.add(node);
      }
    },
    onNodeEnter: (node) => (opened.has(node) ? chromeStart : undefined),
    onNodeExit: (node) => (opened.has(node) ? chromeEnd : undefined),
  };
};

/** The hooks for a conversion: the caller's own first, so what they skip stays skipped. */
export const markdownHooks = (
  own: readonly TransformPlugin[] | undefined,
  exclude: MarkdownExclude | undefined,
  regions: RegionRule | true | undefined
): TransformPlugin[] => {
  const hooks = [...(own ?? [])];
  const excluding = exclude && excludeHook(exclude);
  if (excluding) {
    hooks.push(excluding);
  }
  if (regions) {
    hooks.push(chromeHook(regions === true ? undefined : regions));
  }
  return hooks;
};

/**
 * Joins two pieces of Markdown where a marker stood. mdream took the marker for a word, so it may
 * have written a space beside it: at the start or end of a line that space goes, between words
 * one stays. Blank lines merge into at most one.
 */
const joinAt = (before: string, after: string) => {
  // Counted from the ends only: the Markdown before grows with every piece.
  let end = before.length;
  let start = 0;
  if (end === 0 || before[end - 1] === "\n" || before[end - 1] === " ") {
    while (after[start] === " ") {
      start += 1;
    }
  }
  if (start === after.length || after[start] === "\n") {
    while (end > 0 && before[end - 1] === " ") {
      end -= 1;
    }
  }
  let trailing = 0;
  while (end - trailing > 0 && before[end - trailing - 1] === "\n") {
    trailing += 1;
  }
  let leading = 0;
  while (after[start + leading] === "\n") {
    leading += 1;
  }
  const newlines = end - trailing === 0 ? 0 : Math.min(trailing + leading, 2);
  return (
    before.slice(0, end - trailing) +
    "\n".repeat(newlines) +
    after.slice(start + leading)
  );
};

/** The Markdown of a conversion with `chromeHook`, as `whole` with the chrome and `content` without. */
export const splitChrome = (marked: string) => {
  if (!markers.test(marked)) {
    return { content: marked, whole: marked };
  }
  let whole = "";
  let content = "";
  let depth = 0;
  for (const piece of marked.split(/(?<marker>[\uFDD0\uFDD1])/u)) {
    if (piece === chromeStart || piece === chromeEnd) {
      depth = Math.max(0, depth + (piece === chromeStart ? 1 : -1));
      continue;
    }
    whole = joinAt(whole, piece);
    if (depth === 0) {
      content = joinAt(content, piece);
    }
  }
  return { content: content.trim(), whole: whole.trim() };
};
