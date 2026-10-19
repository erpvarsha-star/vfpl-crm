/* Export tab: minimal stub from A1. A6 replaces this file and must keep the "Download customers.json" button id="export". */
App.registerPanel("export", {
  label: "Export",
  mount: function (el) {
    el.appendChild(Ui.el("p", { class: "coming", text: "Coming in this build." }));
    var b = Ui.el("button", { class: "btn", type: "button", id: "export", text: "Download customers.json" });
    b.addEventListener("click", function () {
      App.download("customers.json", JSON.stringify(Store.exportCustomersJson(), null, 2) + "\n", "application/json");
    });
    el.appendChild(Ui.el("p", null, b));
  },
  render: function () {}, show: function () {}
});
