const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesheet = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");

test("viewer declares three semantic sizes and a body baseline", () => {
  for (const [name, size] of [["title", 14], ["body", 12], ["meta", 11]]) {
    assert.match(stylesheet, new RegExp(`--font-${name}: ${size}px;`));
  }
  assert.match(stylesheet, /body\s*\{[^}]*font-size: var\(--font-body\)/);
});

test("text uses typography tokens except navigation arrows", () => {
  // 翻页箭头保留图形符号大小，界面文字只使用标题、正文、辅助三档。
  const sizes = [...stylesheet.matchAll(/font-size:\s*([^;]+);/g)].map(match => match[1]);
  for (const size of sizes) {
    assert.ok(["var(--font-title)", "var(--font-body)", "var(--font-meta)", "30px"].includes(size), size);
  }
});

test("viewer headings explicitly set size and weight", () => {
  assert.match(stylesheet, /#appSwitcher\s*\{[^}]*font-size: var\(--font-title\);[^}]*font-weight: 600;/);
  assert.match(stylesheet, /\.panel-title strong[^}]*font-size: var\(--font-title\);[^}]*font-weight: 600;/);
});
