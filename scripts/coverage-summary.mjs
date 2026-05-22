// Turns the Vitest json-summary into a Markdown report for the per-PR sticky
// comment. Overall totals up top, per-file line/function/branch coverage in a
// collapsible table.
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

const summary = JSON.parse(
  readFileSync("coverage/coverage-summary.json", "utf8"),
);
const cwd = process.cwd();
const total = summary.total;

let md = "## Coverage Summary\n\n";
md +=
  `**Lines: ${total.lines.pct}%** ` +
  `(${total.lines.covered}/${total.lines.total}) · ` +
  `Statements: ${total.statements.pct}% · ` +
  `Functions: ${total.functions.pct}% · ` +
  `Branches: ${total.branches.pct}%\n\n`;

const files = Object.keys(summary)
  .filter((k) => k !== "total")
  .map((k) => ({ path: relative(cwd, k), m: summary[k] }))
  .sort((a, b) => a.path.localeCompare(b.path));

md += "<details><summary>Per-file coverage</summary>\n\n";
md += "| File | Lines | Functions | Branches |\n";
md += "|------|------:|----------:|---------:|\n";
for (const f of files) {
  md += `| ${f.path} | ${f.m.lines.pct}% | ${f.m.functions.pct}% | ${f.m.branches.pct}% |\n`;
}
md += "\n</details>\n";

writeFileSync("coverage/coverage-summary.md", md);
console.log("wrote coverage/coverage-summary.md");
