/* Boot: runs last. Opens the page once every module has registered itself. Owned by A1. */
App.boot().catch(function (e) {
  console.warn("Boot failed", e);
  document.body.dataset.ready = "1";
  App.notice("The page could not start: " + (e && e.message ? e.message : e), "error");
});
