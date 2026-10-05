import type { ScreenPosition } from "./layout.ts";

/**
 * Whether a server-rendered page hydrates in the browser, read from the HTML as the server sends
 * it, without running it. Frameworks that hydrate leave unambiguous markers: Astro's
 * `<astro-island>` elements, Next.js' `__NEXT_DATA__` or its streamed `self.__next_f` payload,
 * Nuxt's `__NUXT_DATA__`, and the data SvelteKit, Remix, and Angular write. The data they
 * serialize into the HTML is what the browser processes before the page responds to input. Qwik
 * resumes instead of hydrating and counts as no hydration.
 */

export type HydrationFramework =
  | "astro"
  | "next-pages"
  | "next-app"
  | "nuxt"
  | "sveltekit"
  | "angular"
  | "remix";

/** An Astro island: a framework component the browser hydrates. */
export interface AstroIsland {
  /** Its `uid`, unique on the page. */
  uid: string;
  /** The directive, such as `load`, `idle`, `visible`, `media`, or `only`. */
  client: string;
  /** The component's file name, from its `component-url`, such as `Cart.C2.js`. */
  component: string;
  /** Characters of the serialized props, as the HTML carries them. */
  propsBytes: number;
  /** Whether the server rendered its HTML; `client:only` islands render in the browser only. */
  serverRendered: boolean;
  /** Where it is expected on a desktop visit, with the `positions` option. */
  position?: ScreenPosition;
}

export interface Hydration {
  framework: HydrationFramework;
  /**
   * Characters of the data the framework serializes into the HTML for hydration; for the JSON
   * the frameworks write, about its bytes.
   */
  payloadBytes: number;
  /** Astro's islands, the first `maxIslands`. */
  islands: AstroIsland[];
}

export const maxIslands = 200;

// How far into an inline script its framework marker may stand.
const headLength = 1000;

/** What one pass learns about hydration while the page streams through. */
export interface HydrationState {
  islands: AstroIsland[];
  islandCount: number;
  propsBytes: number;
  /** Payload characters per framework found in inline scripts. */
  scripts: Partial<Record<HydrationFramework, number>>;
  angular: boolean;
  /** The inline script being read. */
  script: { id: string; head: string; length: number } | undefined;
}

export const emptyHydration = (): HydrationState => ({
  angular: false,
  islandCount: 0,
  islands: [],
  propsBytes: 0,
  script: undefined,
  scripts: {},
});

const fileName = (url: string) =>
  (url.split("?")[0] ?? "").split("/").at(-1) ?? url;

/** An element's attributes, with entities decoded. */
type Attributes = Record<string, string>;

// Astro escapes props for their attribute as `&amp;`, `&#39;`, `&lt;`, `&gt;`, and `&quot;`; these
// are the characters each escape adds.
const escapes = /[&'<>"]/gu;
const added = new Map([
  ['"', 5],
  ["&", 4],
  ["'", 4],
  ["<", 3],
  [">", 3],
]);

const escapedLength = (value: string) => {
  let { length } = value;
  for (const [character] of value.matchAll(escapes)) {
    length += added.get(character) ?? 0;
  }
  return length;
};

/** Reads an `<astro-island>` start tag; props are measured as Astro escapes them in the HTML. */
export const readIsland = (
  state: HydrationState,
  attributes: Attributes
): AstroIsland | undefined => {
  const propsBytes = escapedLength(attributes.props ?? "");
  state.islandCount += 1;
  state.propsBytes += propsBytes;
  if (state.islands.length >= maxIslands) {
    return undefined;
  }
  const island: AstroIsland = {
    client: attributes.client ?? "",
    component: fileName(attributes["component-url"] ?? ""),
    propsBytes,
    serverRendered: "ssr" in attributes,
    uid: attributes.uid ?? "",
  };
  state.islands.push(island);
  return island;
};

const scriptIds = new Map<string, HydrationFramework>([
  ["__NEXT_DATA__", "next-pages"],
  ["__NUXT_DATA__", "nuxt"],
  ["ng-state", "angular"],
]);

const scriptMarkers: [RegExp, HydrationFramework][] = [
  [/self\.__next_f\b/u, "next-app"],
  [/window\.__NUXT__\s*=/u, "nuxt"],
  [/__sveltekit_\w+\s*=\s*\{/u, "sveltekit"],
  [/window\.__(?:remixContext|reactRouterContext)\s*=/u, "remix"],
];

const settleScript = (state: HydrationState) => {
  const { script } = state;
  state.script = undefined;
  if (!script) {
    return;
  }
  const framework =
    scriptIds.get(script.id) ??
    scriptMarkers.find(([marker]) => marker.test(script.head))?.[1];
  if (framework) {
    state.scripts[framework] = (state.scripts[framework] ?? 0) + script.length;
  }
};

export const readScriptStart = (
  state: HydrationState,
  attributes: Attributes
) => {
  settleScript(state);
  state.script =
    "src" in attributes
      ? undefined
      : { head: "", id: attributes.id ?? "", length: 0 };
};

export const readScriptText = (state: HydrationState, text: string) => {
  const { script } = state;
  if (!script) {
    return;
  }
  script.length += text.length;
  if (script.head.length < headLength) {
    script.head += text.slice(0, headLength - script.head.length);
  }
};

/** Ends the inline script being read, at its end tag. */
export const readScriptEnd = (state: HydrationState) => settleScript(state);

const frameworkOrder: HydrationFramework[] = [
  "next-pages",
  "next-app",
  "nuxt",
  "sveltekit",
  "remix",
];

/** The hydrating framework and its serialized data, or `null` when nothing hydrates. */
export const hydrationOf = (state: HydrationState): Hydration | null => {
  settleScript(state);
  if (state.islandCount > 0) {
    return {
      framework: "astro",
      islands: state.islands,
      payloadBytes: state.propsBytes,
    };
  }
  const framework = frameworkOrder.find(
    (name) => (state.scripts[name] ?? 0) > 0
  );
  if (framework) {
    return {
      framework,
      islands: [],
      payloadBytes: state.scripts[framework] ?? 0,
    };
  }
  return state.angular
    ? {
        framework: "angular",
        islands: [],
        payloadBytes: state.scripts.angular ?? 0,
      }
    : null;
};
