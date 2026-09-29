import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

import { qualityIgnorePatterns } from "./quality-ignore.ts";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: [...core.ignorePatterns, ...qualityIgnorePatterns],
  rules: {
    // HTMLRewriter's elements are not DOM nodes: they have getAttribute but no dataset.
    "unicorn/prefer-dom-node-dataset": "off",
  },
});
