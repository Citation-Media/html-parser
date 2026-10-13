// Parses every .html file of a directory with every option on, fifteen times each after three
// warm-up runs, and prints the median per page and the total. Usage:
//   node --expose-gc bench/parse.mjs <directory> [dist directory, default ./dist] [options as JSON]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [directory, dist = "dist", extra = "{}"] = process.argv.slice(2);
if (!directory) {
  console.error(
    "Usage: node --expose-gc bench/parse.mjs <directory> [dist] [options]"
  );
  process.exit(1);
}
const { parseHtmlSync } = await import(
  pathToFileURL(path.resolve(dist, "index.js")).href
);
const options = {
  head: true,
  headings: true,
  hidden: true,
  hydration: true,
  ids: true,
  images: true,
  inlineCode: true,
  links: true,
  meta: true,
  positions: true,
  resources: true,
  structuredData: true,
  styles: true,
  text: true,
  url: "https://example.com/",
  ...JSON.parse(extra),
};
const median = (values) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
let total = 0;
for (const file of readdirSync(directory)
  .filter((name) => name.endsWith(".html"))
  .toSorted()) {
  const html = readFileSync(join(directory, file), "utf-8");
  for (let run = 0; run < 3; run += 1) {
    parseHtmlSync(html, options);
  }
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const times = [];
  let peak = 0;
  for (let run = 0; run < 15; run += 1) {
    const start = performance.now();
    parseHtmlSync(html, options);
    times.push(performance.now() - start);
    peak = Math.max(peak, process.memoryUsage().heapUsed - before);
  }
  const time = median(times);
  total += time;
  console.log(
    `${file.padEnd(40)} ${(html.length / 1024).toFixed(0).padStart(5)} KB` +
      `  median ${time.toFixed(1).padStart(6)} ms  heap ${(peak / 1_048_576).toFixed(0).padStart(4)} MB`
  );
}
console.log(`total median ${total.toFixed(1)} ms`);
