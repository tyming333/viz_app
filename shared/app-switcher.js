(function () {
  "use strict";
  const select = document.getElementById("appSwitcher");
  if (!select) return;
  const appRoot = new URL("../", document.currentScript.src);
  const routes = {
    viewer: "index.html",
    "field-defect": "field-defect/index.html",
    "model-config": "model-config/index.html"
  };
  select.value = document.body.dataset.app || "viewer";
  select.addEventListener("change", function () {
    if (routes[select.value]) window.location.href = new URL(routes[select.value], appRoot).href;
  });
})();
