(function () {
  const api = QuizPop.api;
  const storage = QuizPop.storage;
  const CATEGORIES = QuizPop.CATEGORIES;
  const HOST_PERMISSIONS = { origins: ["http://*/*", "https://*/*"] };

  const categoryListEl = document.getElementById("category-list");
  const autoPopupToggle = document.getElementById("auto-popup-toggle");
  const intervalInput = document.getElementById("interval-input");
  const permissionRow = document.getElementById("permission-row");
  const permissionStatus = document.getElementById("permission-status");
  const grantPermissionBtn = document.getElementById("grant-permission-btn");
  const statsSummary = document.getElementById("stats-summary");
  const resetStatsBtn = document.getElementById("reset-stats-btn");
  const saveStatus = document.getElementById("save-status");
  const syncStatus = document.getElementById("sync-status");

  let suppressSave = true;

  function buildCategoryCheckboxes(selected) {
    categoryListEl.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = cat.id;
      checkbox.checked = selected.includes(cat.id);
      checkbox.addEventListener("change", onSettingsChanged);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(cat.label));
      categoryListEl.appendChild(label);
    });
  }

  function selectedCategoryIds() {
    return Array.from(categoryListEl.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
  }

  function flashSaved() {
    saveStatus.hidden = false;
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => (saveStatus.hidden = true), 1200);
  }

  function refreshPermissionUI() {
    return api.permissions.contains(HOST_PERMISSIONS).then((granted) => {
      if (!autoPopupToggle.checked) {
        permissionRow.hidden = true;
        permissionStatus.textContent = "";
        return granted;
      }
      permissionRow.hidden = granted;
      permissionStatus.textContent = granted
        ? "Permission granted — periodic popups are active."
        : "Permission not yet granted — periodic popups won't appear until you grant it.";
      return granted;
    });
  }

  function onSettingsChanged() {
    if (suppressSave) return;
    const next = {
      selectedCategories: selectedCategoryIds(),
      autoPopupEnabled: autoPopupToggle.checked,
      intervalMinutes: Math.min(240, Math.max(5, Number(intervalInput.value) || 30)),
    };
    storage.setSettings(next).then(() => {
      flashSaved();
      refreshPermissionUI();
      return api.runtime.sendMessage({ type: "UPDATE_ALARM" });
    });
  }

  grantPermissionBtn.addEventListener("click", () => {
    api.permissions.request(HOST_PERMISSIONS).then(() => {
      refreshPermissionUI();
      api.runtime.sendMessage({ type: "UPDATE_ALARM" });
    });
  });

  resetStatsBtn.addEventListener("click", () => {
    if (!window.confirm("Reset all quiz stats (correct/incorrect/streak)?")) return;
    storage.resetStats().then(renderStats);
  });

  autoPopupToggle.addEventListener("change", onSettingsChanged);
  intervalInput.addEventListener("change", onSettingsChanged);

  function renderStats() {
    return storage.getStats().then((stats) => {
      statsSummary.textContent = `${stats.correctCount} correct · ${stats.incorrectCount} incorrect · best streak ${stats.bestStreak}`;
    });
  }

  function formatRelativeTime(ts) {
    const diffMs = Date.now() - ts;
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function renderSyncStatus() {
    return api.storage.local.get("lastSyncAt").then((res) => {
      syncStatus.textContent = res.lastSyncAt
        ? `Question bank last synced ${formatRelativeTime(res.lastSyncAt)}. Updates happen automatically in the background — nothing to do here.`
        : "No sync yet — will happen automatically in the background shortly.";
    });
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.stats) renderStats();
    if (changes.lastSyncAt) renderSyncStatus();
  });

  function init() {
    storage.getSettings().then((settings) => {
      buildCategoryCheckboxes(settings.selectedCategories);
      autoPopupToggle.checked = settings.autoPopupEnabled;
      intervalInput.value = settings.intervalMinutes;
      suppressSave = false;
      refreshPermissionUI();
    });
    renderStats();
    renderSyncStatus();
  }

  init();
})();
