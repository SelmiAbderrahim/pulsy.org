// Apply the saved or system theme before the first application paint.
(function () {
  var stored; try { stored = localStorage.getItem("pulsy-theme"); } catch (e) {}
  var dark = stored === "dark" || (stored !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
