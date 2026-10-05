/**
 * CSS selectors for the `context` option, matched against the elements open while the page streams
 * through. The grammar is the one HTMLRewriter accepts, so a selector that worked there works here:
 * `*`, type, `#id`, `.class`, attribute selectors with `=`, `~=`, `|=`, `^=`, `$=`, `*=` and an `i`
 * or `s` flag, `:first-child`, `:nth-child()`, `:first-of-type`, `:nth-of-type()`, `:not()`, and the
 * descendant and child combinators, in comma-separated lists. Selectors that need the elements after
 * one, such as `:last-child` or sibling combinators, cannot be decided in one pass and throw.
 */

/** An open element as the matcher sees it. */
export interface Frame {
  name: string;
  attributes: Record<string, string>;
  parent: Frame | undefined;
  /** Its position among its parent's elements, from 1. */
  position: number;
  /** Its position among its parent's elements of its type, from 1. */
  typePosition: number;
}

type Test = (frame: Frame) => boolean;

interface Step {
  test: Test;
  /** How this step relates to the one before it: any ancestor or the parent. */
  combinator: "descendant" | "child";
}

/** Whether the selector matches an element, given its ancestors. */
export type Matcher = (frame: Frame) => boolean;

const fail = (selector: string, reason: string): never => {
  throw new SyntaxError(`Unsupported selector "${selector}": ${reason}`);
};

/** The index of the `]` that closes the attribute selector at the start, outside quotes. */
const closingBracket = (text: string) => {
  let quote = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "]") {
      return index;
    }
  }
  return -1;
};

/** Splits on a character outside quotes, brackets, and parentheses. */
const splitTop = (text: string, separator: string) => {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
};

/** `an+b` as a test of a position from 1. */
const nth = (
  formula: string,
  selector: string
): ((position: number) => boolean) => {
  const value = formula.replaceAll(/\s+/gu, "").toLowerCase();
  if (value === "odd") {
    return (position) => position % 2 === 1;
  }
  if (value === "even") {
    return (position) => position % 2 === 0;
  }
  const match = /^(?:(?<a>[+-]?\d*)n)?(?<b>[+-]?\d+)?$/u.exec(value);
  if (!match || value === "") {
    return fail(selector, `bad formula "${formula}"`);
  }
  const { a: rawA, b: rawB } = match.groups ?? {};
  if (rawA === undefined) {
    const b = Number(rawB);
    return (position) => position === b;
  }
  let a = Number(rawA);
  if (rawA === "" || rawA === "+") {
    a = 1;
  } else if (rawA === "-") {
    a = -1;
  }
  const b = rawB === undefined ? 0 : Number(rawB);
  if (a === 0) {
    return (position) => position === b;
  }
  return (position) => (position - b) / a >= 0 && (position - b) % a === 0;
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  const [first] = trimmed;
  if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1).replaceAll(/\\(?<escaped>.)/gu, "$<escaped>");
  }
  return trimmed;
};

const attributeTest = (inner: string, selector: string): Test => {
  const match =
    /^\s*(?<name>[^\s~|^$*=\]]+)\s*(?:(?<operator>[~|^$*]?=)\s*(?<value>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s\]]+)\s*(?<flag>[is])?)?\s*$/iu.exec(
      inner
    );
  if (!match?.groups) {
    return fail(selector, `bad attribute selector "[${inner}]"`);
  }
  const name = (match.groups.name ?? "").toLowerCase();
  const { operator } = match.groups;
  if (!operator) {
    return (frame) => name in frame.attributes;
  }
  const insensitive = match.groups.flag?.toLowerCase() === "i";
  const wanted = insensitive
    ? unquote(match.groups.value ?? "").toLowerCase()
    : unquote(match.groups.value ?? "");
  const read = (frame: Frame) => {
    const value = frame.attributes[name];
    if (value === undefined) {
      return;
    }
    return insensitive ? value.toLowerCase() : value;
  };
  switch (operator) {
    case "=": {
      return (frame) => read(frame) === wanted;
    }
    case "~=": {
      return (frame) =>
        wanted !== "" &&
        !/\s/u.test(wanted) &&
        (read(frame)?.split(/\s+/u).includes(wanted) ?? false);
    }
    case "|=": {
      return (frame) => {
        const value = read(frame);
        return value === wanted || (value?.startsWith(`${wanted}-`) ?? false);
      };
    }
    case "^=": {
      return (frame) =>
        wanted !== "" && (read(frame)?.startsWith(wanted) ?? false);
    }
    case "$=": {
      return (frame) =>
        wanted !== "" && (read(frame)?.endsWith(wanted) ?? false);
    }
    default: {
      return (frame) =>
        wanted !== "" && (read(frame)?.includes(wanted) ?? false);
    }
  }
};

const hasClass = (frame: Frame, name: string) => {
  const value = frame.attributes.class;
  return value !== undefined && value.split(/\s+/u).includes(name);
};

const identifier = /^-?[_a-z\P{ASCII}][\w\P{ASCII}-]*/iu;
const pseudoClass =
  /^:(?<name>[a-z-]+)(?:\((?<argument>[^()]*(?:\([^()]*\)[^()]*)*)\))?/iu;

/** A simple selector's test and how many characters of the compound it took. */
interface Simple {
  test: Test;
  length: number;
}

// The pseudo-classes one pass can decide, by the position counts the open elements carry.
const pseudoTest = (name: string, argument: string, selector: string): Test => {
  switch (name) {
    case "first-child": {
      return (frame) => frame.position === 1;
    }
    case "first-of-type": {
      return (frame) => frame.typePosition === 1;
    }
    case "nth-child": {
      const at = nth(argument, selector);
      return (frame) => at(frame.position);
    }
    case "nth-of-type": {
      const at = nth(argument, selector);
      return (frame) => at(frame.typePosition);
    }
    case "not": {
      const inner = splitTop(argument, ",").map((part) =>
        // oxlint-disable-next-line no-use-before-define -- `:not()` holds compounds itself.
        compound(part.trim(), selector)
      );
      return (frame) => !inner.some((test) => test(frame));
    }
    default: {
      return fail(selector, `":${name}" needs more than one pass`);
    }
  }
};

const readName = (rest: string, sigil: string, selector: string): Simple => {
  const name = identifier.exec(rest.slice(1))?.[0];
  if (!name) {
    return fail(selector, `bad name after "${sigil}"`);
  }
  return {
    length: 1 + name.length,
    test:
      sigil === "#"
        ? (frame) => frame.attributes.id === name
        : (frame) => hasClass(frame, name),
  };
};

const readAttributeSelector = (rest: string, selector: string): Simple => {
  const end = closingBracket(rest);
  if (end === -1) {
    return fail(selector, 'missing "]"');
  }
  return { length: end + 1, test: attributeTest(rest.slice(1, end), selector) };
};

const readPseudo = (rest: string, selector: string): Simple => {
  const pseudo = pseudoClass.exec(rest);
  if (!pseudo?.groups) {
    return fail(selector, "bad pseudo-class");
  }
  const name = (pseudo.groups.name ?? "").toLowerCase();
  return {
    length: pseudo[0].length,
    test: pseudoTest(name, pseudo.groups.argument ?? "", selector),
  };
};

/** The simple selector at the start of `rest`, after the type. */
const readSimple = (rest: string, selector: string): Simple => {
  const [sigil = ""] = rest;
  if (sigil === "#" || sigil === ".") {
    return readName(rest, sigil, selector);
  }
  if (sigil === "[") {
    return readAttributeSelector(rest, selector);
  }
  if (sigil === ":") {
    return readPseudo(rest, selector);
  }
  return fail(selector, `unexpected "${sigil}"`);
};

/** A compound selector such as `div.card[data-x]:not(.hidden)` as one test. */
const compound = (text: string, selector: string): Test => {
  const tests: Test[] = [];
  let rest = text;
  const [type] = /^(?:\*|[a-z][\w-]*)/iu.exec(rest) ?? [];
  if (type) {
    const name = type.toLowerCase();
    if (name !== "*") {
      tests.push((frame) => frame.name === name);
    }
    rest = rest.slice(type.length);
  }
  while (rest.length > 0) {
    const simple = readSimple(rest, selector);
    tests.push(simple.test);
    rest = rest.slice(simple.length);
  }
  const [only] = tests;
  if (tests.length === 0 || !only) {
    return () => true;
  }
  if (tests.length === 1) {
    return only;
  }
  return (frame) => tests.every((test) => test(frame));
};

/** Compounds and combinators of a complex selector, split outside quotes and brackets. */
const tokens = (text: string) => {
  const found: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  const flush = () => {
    if (current) {
      found.push(current);
      current = "";
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote) {
      if (char === "\\") {
        current += char + (text[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth -= 1;
    } else if (depth === 0 && /\s/u.test(char)) {
      flush();
      continue;
    } else if (depth === 0 && (char === ">" || char === "+" || char === "~")) {
      flush();
      found.push(char);
      continue;
    }
    current += char;
  }
  flush();
  return found;
};

/** A complex selector such as `main > article p` as steps from the outermost. */
const complex = (text: string, selector: string): Step[] => {
  const steps: Step[] = [];
  let combinator: Step["combinator"] = "descendant";
  for (const token of tokens(text)) {
    if (token === ">") {
      combinator = "child";
      continue;
    }
    if (token === "+" || token === "~") {
      fail(selector, `the "${token}" combinator needs more than one pass`);
    }
    steps.push({ combinator, test: compound(token, selector) });
    combinator = "descendant";
  }
  if (steps.length === 0) {
    fail(selector, "it is empty");
  }
  return steps;
};

/** Whether the steps up to `last` match `frame` and its ancestors. */
const matchesSteps = (steps: Step[], last: number, frame: Frame): boolean => {
  const step = steps[last];
  if (!step?.test(frame)) {
    return false;
  }
  if (last === 0) {
    return true;
  }
  if (step.combinator === "child") {
    return (
      frame.parent !== undefined && matchesSteps(steps, last - 1, frame.parent)
    );
  }
  for (let ancestor = frame.parent; ancestor; ancestor = ancestor.parent) {
    if (matchesSteps(steps, last - 1, ancestor)) {
      return true;
    }
  }
  return false;
};

/** Compiles a selector list; throws a `SyntaxError` for what it cannot match in one pass. */
export const compileSelector = (selector: string): Matcher => {
  const list = splitTop(selector, ",").map((part) =>
    complex(part.trim(), selector)
  );
  if (list.length === 1) {
    const [steps = []] = list;
    return (frame) => matchesSteps(steps, steps.length - 1, frame);
  }
  return (frame) =>
    list.some((steps) => matchesSteps(steps, steps.length - 1, frame));
};
