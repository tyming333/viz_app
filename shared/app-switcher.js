(function () {
  "use strict";
  const select = document.getElementById("appSwitcher");
  if (!select) return;
  select.value = document.body.dataset.app || "viewer";
  select.addEventListener("change", function () {
    window.location.href = select.value === "field-defect" ? "./field-defect/index.html" : "../index.html";
  });
})();
