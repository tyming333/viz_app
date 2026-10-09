(function () {
  "use strict";
  const select = document.getElementById("appSwitcher");
  if (!select) return;
  if (!select.querySelector('option[value="yolo-viewer"]')) {
    const option = document.createElement("option");
    option.value = "yolo-viewer";
    option.textContent = "YOLO 数据可视化";
    select.add(option, 1);
  }
  const appRoot = new URL("../", document.currentScript.src);
  const routes = {
    viewer: "index.html",
    "yolo-viewer": "yolo-viewer/index.html",
    "field-defect": "field-defect/index.html",
    "model-config": "model-config/index.html"
  };
  select.value = document.body.dataset.app || "viewer";
  select.addEventListener("change", function () {
    if (routes[select.value]) window.location.href = new URL(routes[select.value], appRoot).href;
  });
})();
