import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

import { qualityIgnorePatterns } from "./quality-ignore.ts";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [...ultracite.ignorePatterns, ...qualityIgnorePatterns],
});
