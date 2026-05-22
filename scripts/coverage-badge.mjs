// Reads the Vitest json-summary and emits a shields.io endpoint badge JSON.
// No third-party service involved — the JSON is published to the `badges`
// branch by the Coverage workflow and rendered by img.shields.io/endpoint.
import { readFileSync, writeFileSync } from "node:fs";

const summary = JSON.parse(
  readFileSync("coverage/coverage-summary.json", "utf8"),
);
const pct = summary.total.lines.pct;

function colorFor(p) {
  if (p >= 90) return "brightgreen";
  if (p >= 75) return "green";
  if (p >= 60) return "yellowgreen";
  if (p >= 40) return "yellow";
  if (p >= 20) return "orange";
  return "red";
}

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${Math.round(pct)}%`,
  color: colorFor(pct),
};

writeFileSync("coverage/coverage-badge.json", JSON.stringify(badge) + "\n");
console.log("coverage badge:", JSON.stringify(badge));
