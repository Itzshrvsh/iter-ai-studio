// App shell: hash-based page router + connection indicator
const $ = (id) => document.getElementById(id);
const pages = document.querySelectorAll(".page");
const navItems = document.querySelectorAll(".nav-item");

function navigate(name) {
  pages.forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  navItems.forEach((n) => n.classList.toggle("active", n.dataset.page === name));
  // NOTE: use window.history — renderer.js declares a global lexical `history`
  // (chat message array) that would shadow the History API here.
  window.history.replaceState(null, "", "#" + name);
  $("dockStatus").textContent = "Page: " + name;
  document.dispatchEvent(new CustomEvent("pagechange", { detail: name }));
}

navItems.forEach((n) => n.addEventListener("click", () => navigate(n.dataset.page)));

// Restore last page from hash
const initial = location.hash.replace("#", "") || "chat";
navigate(pages.length && document.getElementById("page-" + initial) ? initial : "chat");

// Connection indicator: reflect the saved provider config (updated by renderer.js)
window.setConnectionStatus = (ok, label) => {
  $("connDot").classList.toggle("ok", !!ok);
  $("connStatus").textContent = label || (ok ? "Connected" : "Not connected");
};
