/**
 * JSON-LD, the structured data search engines read: the text of every
 * `<script type="application/ld+json">` block, parsed into the nodes it describes. A block may hold
 * one node, a list, or a `@graph` of nodes, as Yoast and Rank Math write it; all become one flat
 * list. Blocks that are not valid JSON are named with their parser error instead of failing the
 * page, since a broken block is itself worth reporting.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface StructuredData {
  /** The page's JSON-LD nodes, in page order, with lists and `@graph` expanded. */
  items: JsonObject[];
  /** Blocks that are not valid JSON: their position among the page's blocks and the error. */
  invalid: { index: number; error: string }[];
}

/** Blocks beyond this are not read; no page needs more, and each one costs a parse. */
export const maxBlocks = 50;
/** Characters per block; larger blocks are cut and then reported as invalid. */
export const maxBlockLength = 512 * 1024;

const isObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The nodes of one parsed block: an object, a list of objects, or the members of `@graph`. */
const nodesOf = (value: JsonValue): JsonObject[] => {
  if (Array.isArray(value)) {
    return value.flatMap(nodesOf);
  }
  if (!isObject(value)) {
    return [];
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    // The block's `@context` applies to every node of its graph.
    const context = value["@context"];
    return graph
      .filter(isObject)
      .map((node) =>
        context === undefined || "@context" in node
          ? node
          : { "@context": context, ...node }
      );
  }
  return [value];
};

// Some CMSs wrap the JSON in an HTML comment or CDATA section, which browsers and Google ignore.
const wrapper =
  /^\s*(?:<!--|\/\*\s*<!\[CDATA\[\s*\*\/|<!\[CDATA\[)|(?:-->|\/\*\s*\]\]>\s*\*\/|\]\]>)\s*$/gu;

/** Parses the text of the page's JSON-LD blocks, in page order. */
export const readStructuredData = (
  blocks: readonly string[]
): StructuredData => {
  const result: StructuredData = { invalid: [], items: [] };
  for (const [index, block] of blocks.entries()) {
    const text = block.replaceAll(wrapper, "").trim();
    if (!text) {
      continue;
    }
    try {
      // SAFETY: JSON.parse only returns JSON values, which `JsonValue` describes.
      result.items.push(...nodesOf(JSON.parse(text) as JsonValue));
    } catch (error) {
      result.invalid.push({
        error: error instanceof Error ? error.message : String(error),
        index,
      });
    }
  }
  return result;
};
