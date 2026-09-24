(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./core.js") : root.ModelConfigCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModelConfigGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";
  // Childlist alone defines ancestry. Repeated model names never merge nodes.
  function buildTree(roots, collapsed = new Set(), query = "") {
    query = query.trim().toLowerCase();
    function visit(value, path, indices) {
      const key = JSON.stringify(path);
      const allChildren = value.childlist.map((child, i) => visit(child, [...path, "childlist", i], [...indices, i + 1]));
      const terms = Object.entries(value).filter(([name]) => name !== "childlist").map(([name, v]) => `${name} ${JSON.stringify(v)}`).join(" ").toLowerCase();
      const match = Boolean(query) && terms.includes(query);
      const included = !query || match || allChildren.some(child => child.included);
      const expanded = Boolean(query) || !collapsed.has(key);
      return {
        value, path, key, indices, depth: indices.length - 1, match, included, expanded,
        title: C.nodeTitle(value),
        kind: String(value.current_model || "").startsWith("pretreat:") ? "pretreat" : value.current_model ? "model" : "result",
        childCount: allChildren.length,
        descendants: allChildren.reduce((sum, child) => sum + child.descendants + 1, 0),
        children: expanded ? allChildren.filter(child => child.included) : []
      };
    }
    return roots.map((value, i) => visit(value, ["model_route", i], [i + 1])).filter(node => node.included);
  }
  return { buildTree };
});
