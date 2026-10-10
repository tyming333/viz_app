const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../shared/app-switcher.js"), "utf8");
const routes = { viewer: "index.html", "yolo-viewer": "yolo-viewer/index.html", "attribute-annotator": "index.html#attributes", "field-defect": "field-defect/index.html", "model-config": "model-config/index.html" };
for (const root of ["http://localhost:8000/", "http://localhost:8000/sub/app/", "file:///F:/tools/viz_app/"]) {
  test(`all apps can switch to every destination under ${root}`, () => {
    for (const current of Object.keys(routes)) {
      let handler;
      const select = { options: [], querySelector: () => null, add: option => select.options.push(option), addEventListener: (_, fn) => { handler = fn; } }, window = { location: { href: root + routes[current] } };
      vm.runInNewContext(script, { URL, window, document: { createElement: () => ({}), currentScript: { src: root + "shared/app-switcher.js" }, body: { dataset: { app: current } }, getElementById: () => select } });
      assert.equal(select.options[0].value, "yolo-viewer");
      assert.equal(select.options.length, 1);
      assert.equal(select.value, current);
      for (const [target, route] of Object.entries(routes)) { select.value = target; handler(); assert.equal(window.location.href, root + route); }
    }
  });
}
