const form = document.querySelector("#filterForm");
const resultsEl = document.querySelector("#results");
const loadingStateEl = document.querySelector("#loadingState");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const pageInfoEl = document.querySelector("#pageInfo");
const prevPageButton = document.querySelector("#prevPage");
const nextPageButton = document.querySelector("#nextPage");
const localFilterInput = document.querySelector("#localFilter");
const roomsFilterInput = document.querySelector("#roomsFilter");
const minPricePerSqmInput = document.querySelector("#minPricePerSqm");
const maxPricePerSqmInput = document.querySelector("#maxPricePerSqm");
const exportCsvButton = document.querySelector("#exportCsv");
const checkNewLotsButton = document.querySelector("#checkNewLots");
const loadAllButton = document.querySelector("#loadAll");
const loadDetailsButton = document.querySelector("#loadDetails");
const toggleViewButton = document.querySelector("#toggleView");
const autoRefreshInput = document.querySelector("#autoRefresh");
const refreshIntervalSelect = document.querySelector("#refreshInterval");
const lastUpdatedEl = document.querySelector("#lastUpdated");
const indexSelect = document.querySelector("#index");
const finishedStatusSelect = document.querySelector("#finishedStatus");

const LOCAL_FILTER_NAMES = new Set(["minPrice", "maxPrice", "minApplications", "maxApplications"]);
const LOT_URL = "https://e-auksion.uz/lot-view?lot_id=";

let state = {
  page: 1,
  totalPages: 0,
  totalRows: 0,
  rows: [],
  lastQuery: null,
  isTableView: true,
  sortKey: null,
  sortDirection: "asc",
  loadedAll: false,
  refreshTimer: null,
  detailCache: new Map(),
  isLoadingLots: false,
};

function money(value) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function numberOrNull(value) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setStatus(message, isError = false) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", isError);
}

async function checkNewLots() {
  checkNewLotsButton.disabled = true;
  setStatus("Checking for new Sharq Bahori lots...");
  try {
    const response = await fetch("/api/check-new-lots", { method: "POST" });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    setStatus("Check complete. Telegram will notify you if any new lots were found.");
  } catch (error) {
    setStatus(`Check failed: ${error.message}`, true);
  } finally {
    checkNewLotsButton.disabled = false;
  }
}

function updateBusyControls() {
  loadAllButton.disabled = state.isLoadingLots;
  loadDetailsButton.disabled = state.isLoadingLots;
}

function setLoadingState(message = "") {
  loadingStateEl.hidden = !message;
  loadingStateEl.textContent = message;
  resultsEl.classList.toggle("is-busy", Boolean(message));
  resultsEl.setAttribute("aria-busy", message ? "true" : "false");
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formParams(page = state.page, forcePerPage = null) {
  const data = new FormData(form);
  const params = new URLSearchParams();

  for (const [key, value] of data.entries()) {
    if (value !== "" && !LOCAL_FILTER_NAMES.has(key)) params.set(key, value);
  }

  params.set("page", String(page));
  if (forcePerPage) params.set("perPage", String(forcePerPage));
  params.set("lang", "uz");
  return params;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function lotStatus(lot) {
  const statusId = Number(lot.lot_statuses_id);
  const applications = applicationsCount(lot);

  if (statusId === 32) return "Failed / not held";
  if ([19, 29, 34].includes(statusId)) return "Successful";
  if (statusId === 30) return "Cancelled";
  if (statusId === 2) return "On sale";
  if (statusId === 11) return "Current bidding";
  if (applications > 0 && indexSelect.value === "2") return "Successful";
  if (indexSelect.value === "2") return "Completed";
  return `Status ID ${statusId || "-"}`;
}

function statusClass(label) {
  if (label === "Successful") return "success";
  if (label === "Failed / not held") return "failed";
  if (label === "Cancelled") return "failed";
  if (label === "On sale") return "sale";
  if (label === "Current bidding") return "bidding";
  return "neutral";
}

// user_order_cnt can be "1+" (server caps/anonymizes the count), so parse the leading digits.
function applicationsCount(lot) {
  const raw = String(lot.user_order_cnt ?? lot.user_orders_apply_cnt ?? 0);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function applications(lot) {
  const raw = lot.user_order_cnt ?? lot.user_orders_apply_cnt;
  if (raw === null || raw === undefined || raw === "") return 0;
  return String(raw);
}

function lotUrl(lot) {
  return `${LOT_URL}${encodeURIComponent(lot.id)}`;
}

function extractLotNumber(name) {
  if (!name) return "-";
  return String(name).substring(0, 3);
}

function extractBuildingNumber(name) {
  if (!name) return "-";
  const nameStr = String(name);
  return nameStr.length > 4 ? nameStr[4] : "-";
}

function detailValue(details, shortName) {
  const item = details.find((detail) => detail.short_name === shortName);
  return item?.detail_value_as_string || item?.detail_value_string || item?.detail_value || "";
}

function detailAreaValue(details, shortName) {
  const value = detailValue(details, shortName);
  return typeof value === "string" ? value.replaceAll(",", ".") : value;
}

function lotDetails(lot) {
  return lot.details || {};
}

function extractLotDetails(detailPayload) {
  const details = Array.isArray(detailPayload.confiscant_details_list)
    ? detailPayload.confiscant_details_list
    : [];

  return {
    buildingLot: detailPayload.name || detailPayload.lot_number || "",
    buildingFloors: detailValue(details, "floors_count_in_object"),
    unitFloor: detailValue(details, "which_floors_in_object"),
    handoverStatus: detailValue(details, "state_handover_to_investor"),
    completionTerm: detailValue(details, "term_handover_to_investor"),
    rooms: detailValue(details, "xona_umumiy_soni"),
    totalArea: detailAreaValue(details, "xonadon_umumiy_maydon"),
    livingArea: detailAreaValue(details, "xona_umumiy_maydoni"),
    kitchenArea: detailAreaValue(details, "oshxona_maydoni"),
    auxiliaryArea: detailAreaValue(details, "yordamchi_xonalar_maydoni"),
  };
}

function lotMatchesLocalFilter(lot, term) {
  const status = lotStatus(lot);
  const details = lotDetails(lot);
  const haystack = [
    lot.lot_number,
    lot.name,
    lot.confiscant_categories_name,
    lot.auction_date_str,
    lot.order_end_time_str,
    status,
    details.buildingLot,
    details.buildingFloors,
    details.unitFloor,
    details.handoverStatus,
    details.completionTerm,
    details.rooms,
    details.totalArea,
  ].join(" ").toLowerCase();

  if (term && !haystack.includes(term.toLowerCase())) return false;

  return true;
}

function pricePerSqmValue(lot) {
  const price = Number(lot.start_price || 0);
  const area = Number(lotDetails(lot).totalArea || 0);
  return price && area ? price / area : null;
}

function lotMatchesNumericFilters(lot) {
  const rooms = numberOrNull(roomsFilterInput.value);
  const minPricePerSqm = numberOrNull(minPricePerSqmInput.value);
  const maxPricePerSqm = numberOrNull(maxPricePerSqmInput.value);

  if (rooms !== null && Number(lotDetails(lot).rooms || 0) !== rooms) return false;

  if (minPricePerSqm !== null || maxPricePerSqm !== null) {
    const value = pricePerSqmValue(lot);
    if (value === null) return false;
    if (minPricePerSqm !== null && value < minPricePerSqm) return false;
    if (maxPricePerSqm !== null && value > maxPricePerSqm) return false;
  }

  return true;
}

function sortedRows(rows) {
  if (!state.sortKey) return rows;

  return [...rows].sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    const direction = state.sortDirection === "asc" ? 1 : -1;

    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

function sortValue(lot, key) {
  const map = {
    lot: lot.lot_number || "",
    name: lot.name || "",
    lotNumber: extractLotNumber(lot.name),
    buildingNumber: extractBuildingNumber(lot.name),
    price: Number(lot.start_price || 0),
    applications: applicationsCount(lot),
    status: lotStatus(lot),
    pricePerSqm: (() => { const p = Number(lot.start_price || 0); const a = Number(lotDetails(lot).totalArea || 0); return (p && a) ? p / a : 0; })(),
    auctionEnd: lot.order_end_time_str || "",
    views: Number(lot.view_count || 0),
    buildingLot: lotDetails(lot).buildingLot || "",
    buildingFloors: Number(lotDetails(lot).buildingFloors || 0),
    unitFloor: Number(lotDetails(lot).unitFloor || 0),
    totalArea: Number(lotDetails(lot).totalArea || 0),
    rooms: Number(lotDetails(lot).rooms || 0),
    completionTerm: lotDetails(lot).completionTerm || "",
  };
  return map[key] ?? "";
}

function filteredRows() {
  return sortedRows(
    state.rows
      .filter((lot) => lotMatchesLocalFilter(lot, localFilterInput.value.trim()))
      .filter(lotMatchesNumericFilters)
  );
}

function renderResults() {
  const rows = filteredRows();
  resultsEl.innerHTML = "";
  resultsEl.className = `results ${state.isTableView ? "table-mode" : "card-mode"}`;
  toggleViewButton.textContent = state.isTableView ? "Card view" : "Table view";

  if (!rows.length) {
    summaryEl.textContent = `${state.totalRows} lots found. Showing 0 of ${state.rows.length} loaded rows after local filters.`;
    setStatus("No loaded lots match the active filters.");
    return;
  }

  setStatus("");
  summaryEl.textContent = `${state.totalRows} lots found. Showing ${rows.length} of ${state.rows.length} loaded rows after local filters.${state.loadedAll ? " All pages loaded." : ""}`;

  if (state.isTableView) {
    renderTable(rows);
  } else {
    renderCards(rows);
  }
}

function renderTable(rows) {
  const columns = [
    ["lot", "Lot"],
    ["name", "Name"],
    ["lotNumber", "Lot #"],
    ["buildingNumber", "Building #"],
    ["price", "Price"],
    ["pricePerSqm", "Price/sq.m"],
    ["applications", "Apps"],
    ["status", "Status"],
    ["auctionEnd", "Auction end"],
    ["unitFloor", "Floor"],
    ["buildingFloors", "Floors"],
    ["totalArea", "Area"],
    ["rooms", "Rooms"],
    ["completionTerm", "Completion"],
    ["views", "Views"],
  ];

  resultsEl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${columns.map(([key, label]) => `<th><button type="button" data-sort="${key}">${label}${sortMarker(key)}</button></th>`).join("")}
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(tableRow).join("")}
        </tbody>
      </table>
    </div>
  `;

  resultsEl.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => setSort(button.dataset.sort));
  });
}

function pricePerSqm(lot) {
  const value = pricePerSqmValue(lot);
  return value === null ? "-" : money(Math.round(value));
}

function tableRow(lot) {
  const status = lotStatus(lot);
  const details = lotDetails(lot);
  return `
    <tr>
      <td>${escapeHtml(lot.lot_number || lot.id)}</td>
      <td class="name-cell">${escapeHtml(lot.name || "-")}</td>
      <td>${escapeHtml(extractLotNumber(lot.name))}</td>
      <td>${escapeHtml(extractBuildingNumber(lot.name))}</td>
      <td>${money(lot.start_price)}</td>
      <td>${pricePerSqm(lot)}</td>
      <td>${applications(lot)}</td>
      <td><span class="badge ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(lot.order_end_time_str || "-")}</td>
      <td>${escapeHtml(details.unitFloor || "-")}</td>
      <td>${escapeHtml(details.buildingFloors || "-")}</td>
      <td>${escapeHtml(details.totalArea || "-")}</td>
      <td>${escapeHtml(details.rooms || "-")}</td>
      <td>${escapeHtml(details.completionTerm || "-")}</td>
      <td>${escapeHtml(lot.view_count ?? "0")}</td>
      <td><a href="${lotUrl(lot)}" target="_blank" rel="noreferrer">Open</a></td>
    </tr>
  `;
}

function renderCards(rows) {
  resultsEl.innerHTML = `<div class="lot-grid">${rows.map(cardMarkup).join("")}</div>`;
}

function cardMarkup(lot) {
  const status = lotStatus(lot);
  const details = lotDetails(lot);
  return `
    <article class="lot-card">
      <div class="lot-card-body">
        <div class="lot-card-head">
          <div>
            <div class="lot-number">Lot No. ${escapeHtml(lot.lot_number || lot.id)}</div>
            <div class="lot-name">${escapeHtml(lot.name || "-")}</div>
          </div>
          <span class="badge ${statusClass(status)}">${escapeHtml(status)}</span>
        </div>
        <div class="meta-list">
          <div class="meta-row"><span>Lot #</span><strong>${escapeHtml(extractLotNumber(lot.name))}</strong></div>
          <div class="meta-row"><span>Building #</span><strong>${escapeHtml(extractBuildingNumber(lot.name))}</strong></div>
          <div class="meta-row"><span>Price</span><strong>${money(lot.start_price)} UZS</strong></div>
          <div class="meta-row"><span>Price/sq.m</span><strong>${pricePerSqm(lot)} UZS</strong></div>
          <div class="meta-row"><span>Deposit</span><strong>${money(lot.zaklad_summa)} UZS</strong></div>
          <div class="meta-row"><span>Auction end</span><strong>${escapeHtml(lot.order_end_time_str || "-")}</strong></div>
          <div class="meta-row"><span>Floor / floors</span><strong>${escapeHtml(details.unitFloor || "-")} / ${escapeHtml(details.buildingFloors || "-")}</strong></div>
          <div class="meta-row"><span>Total area</span><strong>${escapeHtml(details.totalArea || "-")} sq.m</strong></div>
          <div class="meta-row"><span>Rooms</span><strong>${escapeHtml(details.rooms || "-")}</strong></div>
          <div class="meta-row"><span>Completion</span><strong>${escapeHtml(details.completionTerm || "-")}</strong></div>
          <div class="meta-row"><span>Applications</span><strong>${applications(lot)}</strong></div>
          <div class="meta-row"><span>Views</span><strong>${escapeHtml(lot.view_count ?? "0")}</strong></div>
        </div>
        <div class="card-actions">
          <a href="${lotUrl(lot)}" target="_blank" rel="noreferrer">Open site</a>
        </div>
      </div>
    </article>
  `;
}

function sortMarker(key) {
  if (state.sortKey !== key) return "";
  return state.sortDirection === "asc" ? " +" : " -";
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = "asc";
  }
  renderResults();
}

function updateSummary() {
  summaryEl.textContent = `${state.totalRows} lots found. Showing ${state.rows.length} loaded rows.`;
  pageInfoEl.textContent = state.loadedAll
    ? `All ${state.rows.length} loaded`
    : `Page ${state.page}${state.totalPages ? ` of ${state.totalPages}` : ""}`;
  prevPageButton.disabled = state.loadedAll || state.page <= 1;
  nextPageButton.disabled = state.loadedAll || (state.totalPages > 0 && state.page >= state.totalPages);
}

async function fetchLots(page = state.page, forcePerPage = null) {
  const params = formParams(page, forcePerPage);
  const response = await fetch(`/api/lots?${params.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail?.ERROR?.message || data.message || "Request failed");
  }

  return data;
}

async function loadLots({ silent = false } = {}) {
  state.loadedAll = false;
  state.lastQuery = formParams().toString();
  state.isLoadingLots = true;
  updateBusyControls();
  setLoadingState(silent ? "Refreshing results..." : "Loading lots...");

  if (!silent) {
    setStatus("Loading lots...");
    resultsEl.innerHTML = "";
  }
  updateSummary();

  try {
    const data = await fetchLots(state.page);
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.totalPages = data.totalPages || 0;
    state.totalRows = data.totalRows || 0;
    state.page = data.currentPage || state.page;
    setLastUpdated();
    updateSummary();
    renderResults();
  } catch (error) {
    state.rows = [];
    state.totalPages = 0;
    state.totalRows = 0;
    updateSummary();
    setStatus(error.message || String(error), true);
  } finally {
    state.isLoadingLots = false;
    updateBusyControls();
    setLoadingState("");
  }
}

async function loadAllPages() {
  const previousText = loadAllButton.textContent;
  loadAllButton.disabled = true;
  loadAllButton.textContent = "Loading...";
  setStatus("Loading all pages...");
  setLoadingState("Loading all pages...");

  try {
    const first = await fetchLots(1, 100);
    const totalPages = first.totalPages || 1;
    const rows = Array.isArray(first.rows) ? [...first.rows] : [];

    for (let page = 2; page <= totalPages; page += 1) {
      setStatus(`Loading all pages... ${page} of ${totalPages}`);
      const data = await fetchLots(page, 100);
      rows.push(...(Array.isArray(data.rows) ? data.rows : []));
    }

    state.rows = rows;
    state.page = 1;
    state.totalPages = totalPages;
    state.totalRows = first.totalRows || rows.length;
    state.loadedAll = true;
    setLastUpdated();
    updateSummary();
    renderResults();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    loadAllButton.disabled = false;
    loadAllButton.textContent = previousText;
    setLoadingState("");
  }
}

async function fetchLotDetails(id, attempt = 0) {
  const response = await fetch(`/api/lot/${encodeURIComponent(id)}?lang=uz`);
  const detailPayload = await response.json();

  if (response.ok) return detailPayload;

  const message = detailPayload.detail?.ERROR?.message || detailPayload.message || "Detail request failed";
  const shouldRetry = response.status === 429 || response.status >= 500;

  if (shouldRetry && attempt < 4) {
    await wait(1200 * (attempt + 1));
    return fetchLotDetails(id, attempt + 1);
  }

  throw new Error(message);
}

async function loadDetailsForRows() {
  if (state.isLoadingLots) {
    setStatus("Wait for the lot search to finish before loading details.");
    return;
  }

  const rows = filteredRows();
  if (!rows.length) {
    setStatus("Load lots before loading details.");
    return;
  }

  const previousText = loadDetailsButton.textContent;
  loadDetailsButton.disabled = true;
  loadDetailsButton.textContent = "Loading details...";
  setLoadingState("Loading lot details...");

  try {
    let pendingRows = rows.filter((lot) => !state.detailCache.has(lot.id));
    let completedCount = rows.length - pendingRows.length;

    for (let pass = 1; pass <= 3 && pendingRows.length; pass += 1) {
      const failedRows = [];

      for (const lot of pendingRows) {
        setStatus(`Loading details... ${completedCount + 1} of ${rows.length}`);
        setLoadingState(`Loading details... ${completedCount + 1} of ${rows.length}`);

        try {
          const detailPayload = await fetchLotDetails(lot.id);
          const extracted = extractLotDetails(detailPayload);
          state.detailCache.set(lot.id, extracted);
          lot.details = extracted;
          completedCount += 1;
        } catch (_) {
          failedRows.push(lot);
        }

        await wait(250);
      }

      pendingRows = failedRows;
      if (pendingRows.length && pass < 3) {
        setStatus(`Cooling down before retry ${pass + 1} for ${pendingRows.length} lot${pendingRows.length === 1 ? "" : "s"}...`);
        setLoadingState(`Cooling down before retry ${pass + 1} for ${pendingRows.length} lot${pendingRows.length === 1 ? "" : "s"}...`);
        await wait(6000 * pass);
      }
    }

    setStatus(
      pendingRows.length
        ? `Details loaded with ${pendingRows.length} skipped lot${pendingRows.length === 1 ? "" : "s"}. You can click again to retry them.`
        : "Details loaded."
    );
    renderResults();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    loadDetailsButton.disabled = false;
    loadDetailsButton.textContent = previousText;
    setLoadingState("");
  }
}

function setLastUpdated() {
  lastUpdatedEl.textContent = `Last updated ${new Date().toLocaleTimeString()}`;
}

function exportCsv() {
  const rows = filteredRows();
  const headers = ["lot_number", "name", "lot_number_extracted", "building_number", "price", "price_per_sqm", "deposit", "applications", "status", "auction_end", "unit_floor", "building_floors", "total_area", "rooms", "completion_term", "handover_status", "living_area", "kitchen_area", "auxiliary_area", "views", "url"];
  const csvRows = [headers.join(",")];

  for (const lot of rows) {
    const status = lotStatus(lot);
    const details = lotDetails(lot);
    csvRows.push(
      [
        lot.lot_number || lot.id,
        lot.name || "",
        extractLotNumber(lot.name),
        extractBuildingNumber(lot.name),
        lot.start_price || "",
        (() => { const p = Number(lot.start_price || 0); const a = Number(details.totalArea || 0); return (p && a) ? Math.round(p / a) : ""; })(),
        lot.zaklad_summa || "",
        applications(lot),
        status,
        lot.order_end_time_str || "",
        details.unitFloor || "",
        details.buildingFloors || "",
        details.totalArea || "",
        details.rooms || "",
        details.completionTerm || "",
        details.handoverStatus || "",
        details.livingArea || "",
        details.kitchenArea || "",
        details.auxiliaryArea || "",
        lot.view_count ?? "",
        lotUrl(lot),
      ].map(csvCell).join(",")
    );
  }

  downloadFile("e-auksion-lots.csv", csvRows.join("\r\n"), "text/csv;charset=utf-8");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function updateAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (!autoRefreshInput.checked) return;

  const ms = Number(refreshIntervalSelect.value) * 1000;
  state.refreshTimer = setInterval(() => loadLots({ silent: true }), ms);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

[indexSelect, document.querySelector("#perPage"), finishedStatusSelect, document.querySelector("#order")].forEach((select) => {
  select.addEventListener("change", () => {
    if (select === indexSelect && indexSelect.value !== "2") {
      finishedStatusSelect.value = "0";
    }
    state.page = 1;
    loadLots();
  });
});

prevPageButton.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    loadLots();
  }
});

nextPageButton.addEventListener("click", () => {
  if (!state.totalPages || state.page < state.totalPages) {
    state.page += 1;
    loadLots();
  }
});

[localFilterInput, roomsFilterInput, minPricePerSqmInput, maxPricePerSqmInput].forEach((input) => {
  input.addEventListener("input", renderResults);
});

toggleViewButton.addEventListener("click", () => {
  state.isTableView = !state.isTableView;
  renderResults();
});
loadAllButton.addEventListener("click", loadAllPages);
loadDetailsButton.addEventListener("click", loadDetailsForRows);
exportCsvButton.addEventListener("click", exportCsv);
checkNewLotsButton.addEventListener("click", checkNewLots);
autoRefreshInput.addEventListener("change", updateAutoRefresh);
refreshIntervalSelect.addEventListener("change", updateAutoRefresh);

loadLots();

const workspaceButtons = document.querySelectorAll("[data-workspace]");
const filterWorkspace = document.querySelector("#filterWorkspace");
const sharqWorkspace = document.querySelector("#sharqWorkspace");
const filterWorkspaceControls = document.querySelectorAll(".filter-workspace");
const sharqWorkspaceControls = document.querySelectorAll(".sharq-workspace");
const projectMapStage = document.querySelector("#projectMapStage");
const typeButtonsEl = document.querySelector("#typeButtons");
const selectedLotTitleEl = document.querySelector("#selectedLotTitle");
const selectedLotMetaEl = document.querySelector("#selectedLotMeta");
const auctionCandidatesEl = document.querySelector("#auctionCandidates");
const activeTypeTitleEl = document.querySelector("#activeTypeTitle");
const typePlanButtonsEl = document.querySelector("#typePlanButtons");
const typeSketchStage = document.querySelector("#typeSketchStage");
const typeSketchImage = document.querySelector("#typeSketchImage");
const sketchVariantControlsEl = document.querySelector("#sketchVariantControls");
const flatTitleEl = document.querySelector("#flatTitle");
const flatMetaEl = document.querySelector("#flatMeta");
const flatImageEl = document.querySelector("#flatImage");
const flatEmptyEl = document.querySelector("#flatEmpty");
const flatThumbnailsEl = document.querySelector("#flatThumbnails");
const openFlatPlanButton = document.querySelector("#openFlatPlan");
const resetSharqMapButton = document.querySelector("#resetSharqMap");
const blockLayoutTitleEl = document.querySelector("#blockLayoutTitle");
const blockLayoutMetaEl = document.querySelector("#blockLayoutMeta");
const blockLayoutImageEl = document.querySelector("#blockLayoutImage");
const buildingMixEl = document.querySelector("#buildingMix");
const flatPlanDialog = document.querySelector("#flatPlanDialog");
const dialogTitleEl = document.querySelector("#dialogTitle");
const dialogImageEl = document.querySelector("#dialogImage");
const closeFlatPlanButton = document.querySelector("#closeFlatPlan");
const flatAnalyzerForm = document.querySelector("#flatAnalyzerForm");
const flatCodeInput = document.querySelector("#flatCodeInput");
const flatAnalysisResultEl = document.querySelector("#flatAnalysisResult");
const rankingRoomsSelect = document.querySelector("#rankingRooms");
const rankingPrioritySelect = document.querySelector("#rankingPriority");
const flatRankingSummaryEl = document.querySelector("#flatRankingSummary");
const flatRankingResultsEl = document.querySelector("#flatRankingResults");
const newTashkentContextEl = document.querySelector("#newTashkentContext");
const officialLotContextEl = document.querySelector("#officialLotContext");

const SHARQ_ASSETS = "/sharq-assets/";

const flatPlans = {
  t1a: { title: "TIP I - 2 xonali", area: "57.94-58.20 m2", rooms: "2 rooms", image: "page-12.jpg" },
  t1b: { title: "TIP I - 2 xonali", area: "53.71-54.66 m2", rooms: "2 rooms", image: "page-13.jpg" },
  t1c: { title: "TIP I - 2 xonali", area: "62.27-63.58 m2", rooms: "2 rooms", image: "page-14.jpg" },
  t1d: { title: "TIP I - 3 xonali", area: "76.60-78.06 m2", rooms: "3 rooms", image: "page-15.jpg" },
  t1e: { title: "TIP I - 3 xonali", area: "81.77-82.84 m2", rooms: "3 rooms", image: "page-16.jpg" },
  t2a: { title: "TIP II - 3 xonali", area: "87.89-89.29 m2", rooms: "3 rooms", image: "page-18.jpg" },
  t2b: { title: "TIP II - 3 xonali", area: "79.70-80.12 m2", rooms: "3 rooms", image: "page-19.jpg" },
  t2c: { title: "TIP II - 2 xonali", area: "68.95-70.03 m2", rooms: "2 rooms", image: "page-20.jpg" },
  t34a: { title: "TIP III/IV - 3 xonali", area: "86.77-90.50 m2", rooms: "3 rooms", image: "page-22.jpg" },
  t34b: { title: "TIP III/IV - 2 xonali", area: "71.50-74.20 m2", rooms: "2 rooms", image: "page-23.jpg" },
  t34c: { title: "TIP III/IV - 2 xonali", area: "59.10-63.52 m2", rooms: "2 rooms", image: "page-24.jpg" },
};

const buildingTypes = [
  {
    id: "tip1",
    title: "TIP I - 12 qavat",
    note: "Five apartment plan variants are shown in the PDF after this sketch.",
    image: "tip-i-sketch-enhanced.png",
    imageVariants: [
      { id: "enhanced", label: "Clean", image: "tip-i-sketch-enhanced.png" },
      { id: "original", label: "Original", image: "page-11.jpg" },
    ],
    zones: [
      { plan: "t1a", label: "2 xonali", x: 31.5, y: 41.5, w: 19, h: 18 },
      { plan: "t1b", label: "2 xonali", x: 31.5, y: 76.5, w: 19, h: 25 },
      { plan: "t1c", label: "2 xonali", x: 50, y: 40.5, w: 18, h: 18 },
      { plan: "t1d", label: "3 xonali", x: 70.5, y: 40.5, w: 19, h: 18 },
      { plan: "t1e", label: "3 xonali", x: 72.5, y: 76.5, w: 20, h: 25 },
    ],
  },
  {
    id: "tip2",
    title: "TIP II - 9 qavat",
    note: "Repeated mirrored units point to the same matching plan slide.",
    image: "tip-ii-sketch-enhanced.png",
    imageVariants: [
      { id: "enhanced", label: "Clean", image: "tip-ii-sketch-enhanced.png" },
      { id: "original", label: "Original", image: "page-17.jpg" },
    ],
    zones: [
      { plan: "t2a", label: "3 xonali", x: 31, y: 57, w: 16, h: 25 },
      { plan: "t2c", label: "2 xonali", x: 47, y: 57, w: 13, h: 22 },
      { plan: "t2c", label: "2 xonali", x: 57.5, y: 57, w: 13, h: 22 },
      { plan: "t2a", label: "3 xonali", x: 78, y: 57, w: 16, h: 25 },
      { plan: "t2b", label: "3 xonali", x: 42, y: 79, w: 16, h: 23 },
      { plan: "t2b", label: "3 xonali", x: 66, y: 79, w: 16, h: 23 },
    ],
  },
  {
    id: "tip34",
    title: "TIP III - 7/9 qavat",
    note: "TIP III uses the same storey plan: 9 storeys in 10-building complexes, 7 storeys in 8-building complexes.",
    image: "tip-iii-sketch-enhanced.png",
    imageVariants: [
      { id: "enhanced", label: "Clean", image: "tip-iii-sketch-enhanced.png" },
      { id: "original", label: "Original", image: "page-21.jpg" },
    ],
    zones: [
      { plan: "t34a", label: "3 xonali", x: 30, y: 68, w: 17, h: 36 },
      { plan: "t34b", label: "2 xonali", x: 43, y: 50, w: 17, h: 24 },
      { plan: "t34b", label: "2 xonali", x: 62, y: 50, w: 17, h: 24 },
      { plan: "t34a", label: "3 xonali", x: 77, y: 68, w: 17, h: 36 },
      { plan: "t34c", label: "2 xonali", x: 47, y: 78, w: 16, h: 22 },
      { plan: "t34c", label: "2 xonali", x: 62, y: 78, w: 16, h: 22 },
    ],
  },
];

const layoutVariants = {
  full: {
    image: "layout-full.png",
    description: "Large complex: 10 buildings. Residential flats above commercial storey 1 are included in auction forecasting.",
    mix: [
      ["10", "buildings"],
      ["452", "expected residential flats"],
    ],
  },
  sideCenterRemoved: {
    image: "layout-small-44a-enhanced.png",
    description: "Small complex: 8 buildings. Residential flats above commercial storey 1 are included in auction forecasting.",
    mix: [
      ["8", "buildings"],
      ["344", "expected residential flats"],
    ],
  },
};

const lotMarkers = [
  { id: "34A", x: 39.5, y: 13.3, layout: "full", note: "Large 10-building complex." },
  { id: "43F", x: 36.2, y: 65.2, layout: "sideCenterRemoved", note: "Small 8-building complex." },
  { id: "43D", x: 42.7, y: 62.9, layout: "sideCenterRemoved", note: "Small 8-building complex." },
  { id: "45D", x: 50.9, y: 58.6, layout: "full", note: "Large 10-building complex." },
  { id: "44B", x: 49.3, y: 68.6, layout: "sideCenterRemoved", note: "Small 8-building complex." },
  { id: "46A", x: 57.8, y: 65.0, layout: "full", note: "Large 10-building complex." },
  { id: "44A", x: 54.6, y: 76.7, layout: "sideCenterRemoved", note: "Small 8-building complex." },
];

const blockLocationProfiles = {
  full: {
    "1": { place: "lower-right corner", exposure: "outer south/east edge with one courtyard-facing side", sun: "Strongest winter benefit is likely on south-facing rooms; east-facing rooms stay cooler than west rooms in summer.", wind: "Moderate. Outer east faces can feel the north-east wind more than courtyard-facing rooms.", typeId: "tip1" },
    "2": { place: "right lower side", exposure: "long outer/east side plus inner courtyard side", sun: "Good morning light is likely on east-facing rooms; west/courtyard rooms may get warmer late in the day.", wind: "Moderate to exposed on the outer side, calmer toward the courtyard.", typeId: "tip2" },
    "3": { place: "right upper side", exposure: "long outer/east side plus inner courtyard side", sun: "Morning light is the likely strength; winter sun is best if main rooms also open southward.", wind: "More exposed than central blocks because it sits on the project edge.", typeId: "tip2" },
    "4": { place: "upper-right corner", exposure: "outer north/east corner with a courtyard side", sun: "Cooler in summer, but north-facing rooms can be weak for winter sun. East-facing rooms get useful morning light without harsh afternoon heat.", wind: "Highest wind exposure in this complex because it sits near the north-east corner.", typeId: "tip1" },
    "5": { place: "upper center", exposure: "top outer edge plus inner courtyard side", sun: "Balanced if the flat has a south/courtyard side; north-facing rooms are cooler and darker in winter.", wind: "Outer side can be breezy, courtyard side is calmer.", typeId: "tip34" },
    "6": { place: "upper-left corner", exposure: "outer north/west corner", sun: "West-facing rooms can overheat on summer afternoons; north-facing rooms are weaker in winter.", wind: "Exposed on the top edge, with more dust and chill risk than inner buildings.", typeId: "tip1" },
    "7": { place: "left upper side", exposure: "long outer/west side plus inner courtyard side", sun: "Watch west-facing rooms for summer afternoon heat; courtyard/east rooms are usually easier to cool.", wind: "Generally more sheltered from north-east wind than building 4, but outer west can be dusty.", typeId: "tip2" },
    "8": { place: "left lower side", exposure: "long outer/west side plus inner courtyard side", sun: "Good winter value if rooms face south; west-facing rooms need shading in summer.", wind: "More sheltered from the north-east than the right/top edge.", typeId: "tip2" },
    "9": { place: "lower-left corner", exposure: "outer south/west corner", sun: "Strong winter sun potential, but summer afternoon heat can be high on west/south-west rooms.", wind: "Mostly sheltered from north-east wind, with more heat exposure than building 4.", typeId: "tip1" },
    "10": { place: "lower center", exposure: "bottom outer edge plus inner courtyard side", sun: "Usually one of the better winter-sun positions if main rooms face south.", wind: "Relatively sheltered from north-east wind by the block layout.", typeId: "tip34" },
  },
  sideCenterRemoved: {
    "1": { place: "lower-right corner", exposure: "outer south/east edge", sun: "Good winter sun potential if rooms face south; east rooms are gentler in summer.", wind: "Moderate exposure on the outer edge.", typeId: "tip1" },
    "2": { place: "right lower side", exposure: "outer/east side plus courtyard side", sun: "Likely morning light, with lower summer overheating than west-facing flats.", wind: "Moderate to exposed on the outer side.", typeId: "tip2" },
    "3": { place: "right upper side", exposure: "outer/east side plus courtyard side", sun: "Morning light is likely; confirm the exact window side on the flat plan.", wind: "More exposed to north-east wind than the lower-left buildings.", typeId: "tip1" },
    "4": { place: "upper-right corner", exposure: "outer north/east corner", sun: "Cooler in summer, weaker in winter if the main rooms face north.", wind: "One of the breezier positions in the small layout.", typeId: "tip34" },
    "5": { place: "upper-left corner", exposure: "outer north/west corner", sun: "West-facing rooms may be hot in summer; north-facing rooms get limited winter sun.", wind: "Exposed on the top edge.", typeId: "tip1" },
    "6": { place: "left lower side", exposure: "outer/west side plus courtyard side", sun: "West side can overheat in summer; courtyard/east side is milder.", wind: "More sheltered from north-east wind than the right/top edge.", typeId: "tip2" },
    "7": { place: "lower-left corner", exposure: "outer south/west corner", sun: "Strong winter sun potential, with summer heat risk on the west side.", wind: "Mostly sheltered from north-east wind.", typeId: "tip1" },
    "8": { place: "upper/lower inner edge", exposure: "edge block with mixed courtyard and outer exposure", sun: "Check whether main rooms face south/east for the best year-round balance.", wind: "Mixed. More comfortable on courtyard-facing rooms.", typeId: "tip34" },
  },
};

const typeDefaults = {
  tip1: { firstFlat: 11, perFloor: 5, firstResidentialFloor: 2, floors: 12, label: "TIP I" },
  tip2: { firstFlat: 13, perFloor: 6, firstResidentialFloor: 3, floors: 9, label: "TIP II" },
  tip34: { firstFlat: 13, perFloor: 6, firstResidentialFloor: 3, floors: 9, label: "TIP III/IV" },
  fourPerFloor: { firstFlat: 5, perFloor: 4, firstResidentialFloor: 2, floors: 12, label: "4 flats/storey" },
};

const cardinalProfiles = {
  full: {
    "1": { side: "South-east perimeter", mountain: "Partial/possible on east-facing rooms; stronger from higher floors.", note: "Good winter sun if rooms face south, with some east-facing view potential." },
    "2": { side: "East perimeter", mountain: "Good potential from east-facing rooms, especially on middle/high floors.", note: "Likely morning sun and a clearer outer-side view than courtyard rooms." },
    "3": { side: "East / north-east perimeter", mountain: "Very good potential from east/north-east-facing rooms.", note: "One of the better rows for mountain-facing outlook if windows face outwards." },
    "4": { side: "North-east corner", mountain: "Best potential in this lot from east/north-east-facing rooms.", note: "Strong view potential, but also the breeziest/coolest corner." },
    "5": { side: "North perimeter", mountain: "Possible from north-east-leaning rooms; less certain than buildings 3-4.", note: "Cooler side with weaker winter sun if rooms face north." },
    "6": { side: "North-west corner", mountain: "Low to medium; mountains are usually not the main outlook from west-facing rooms.", note: "Watch summer west heat and winter north shade." },
    "7": { side: "West perimeter", mountain: "Low; mountain view is unlikely unless the flat has a long diagonal view.", note: "Better for afternoon light than mountain view." },
    "8": { side: "West / south-west perimeter", mountain: "Low; outer rooms likely look away from the mountains.", note: "More sheltered from north-east wind." },
    "9": { side: "South-west corner", mountain: "Low; better for sun than mountain view.", note: "Strong summer heat risk on south/west rooms." },
    "10": { side: "South perimeter", mountain: "Low to medium only from high floors with an open diagonal view.", note: "Usually better winter sun than mountain view." },
  },
  sideCenterRemoved: {
    "1": { side: "South-east perimeter", mountain: "Partial/possible on east-facing rooms.", note: "Good balance if main rooms face south/east." },
    "2": { side: "East perimeter", mountain: "Good potential from east-facing rooms.", note: "Morning sun and likely outer-side view." },
    "3": { side: "East / north-east perimeter", mountain: "Very good potential from east/north-east-facing rooms.", note: "Good mountain-view candidate if windows face outwards." },
    "4": { side: "North-east corner", mountain: "Best potential in the small layout.", note: "Good view side, but cooler and windier." },
    "5": { side: "North-west corner", mountain: "Low to medium; depends on diagonal openness.", note: "Less winter sun on north-facing rooms." },
    "6": { side: "West perimeter", mountain: "Low; likely faces away from the mountains.", note: "Watch west-side summer heat." },
    "7": { side: "South-west corner", mountain: "Low; better for winter sun than mountain view.", note: "Summer afternoon heat is the main watch-out." },
    "8": { side: "North / mixed edge", mountain: "Medium if rooms face north-east; otherwise uncertain.", note: "Check the detailed flat plan before relying on view." },
  },
};

let futureAuctionCandidates = {
  "34A": {
    complex: "Large complex - 10 buildings",
    total: 452,
    sections: [
      { building: "1", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "3", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "4", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "5", type: "TIP III - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "6", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "7", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "8", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "9", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "10", type: "TIP III - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
    ],
  },
  "43D": { complex: "Small complex - 8 buildings", total: 0, sections: [] },
  "43F": {
    complex: "Small complex - 8 buildings",
    total: 294,
    sections: [
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "3", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "4", type: "TIP III - 7-storey", expected: 30, sold: 0, onSale: 0, later: 30, flats: "13-42" },
      { building: "5", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "6", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "7", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 0, later: 50, flats: "11-60" },
      { building: "8", type: "TIP III - 7-storey", expected: 30, sold: 0, onSale: 0, later: 30, flats: "13-42" },
    ],
  },
  "44A": {
    complex: "Small complex - 8 buildings",
    total: 115,
    sections: [
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "5", type: "TIP I - 12-storey", expected: 50, sold: 33, onSale: 16, later: 1, flats: "21" },
      { building: "6", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "8", type: "TIP III - 7-storey", expected: 30, sold: 0, onSale: 0, later: 30, flats: "13-42" },
    ],
  },
  "44B": {
    complex: "Small complex - 8 buildings",
    total: 7,
    sections: [
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 10, onSale: 26, later: 6, flats: "14, 28, 31-32, 34, 43" },
      { building: "6", type: "TIP II - 9-storey", expected: 42, sold: 14, onSale: 27, later: 1, flats: "29" },
    ],
  },
  "45D": {
    complex: "Large complex - 10 buildings",
    total: 119,
    sections: [
      { building: "1", type: "TIP I - 12-storey", expected: 50, sold: 31, onSale: 0, later: 19, flats: "12-14, 17-18, 22-23, 27-28, 32-33, 37-38, 42-43, 47-48, 52, 57" },
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 41, onSale: 0, later: 1, flats: "14" },
      { building: "3", type: "TIP II - 9-storey", expected: 42, sold: 40, onSale: 0, later: 2, flats: "18, 25" },
      { building: "4", type: "TIP I - 12-storey", expected: 50, sold: 18, onSale: 0, later: 32, flats: "12-14, 17-19, 22-24, 26-29, 31-35, 37-39, 42-44, 47-49, 52, 56-59" },
      { building: "5", type: "TIP III - 9-storey", expected: 42, sold: 8, onSale: 0, later: 34, flats: "13-19, 21-36, 39-40, 43, 45-46, 49-54" },
      { building: "6", type: "TIP I - 12-storey", expected: 50, sold: 19, onSale: 0, later: 31, flats: "12-14, 17-19, 22-24, 27-29, 32-34, 37-39, 42-44, 47-49, 52-54, 56-59" },
    ],
  },
  "46A": {
    complex: "Large complex - 10 buildings",
    total: 242,
    sections: [
      { building: "1", type: "TIP I - 12-storey", expected: 50, sold: 37, onSale: 10, later: 3, flats: "18, 47, 52" },
      { building: "2", type: "TIP II - 9-storey", expected: 42, sold: 9, onSale: 29, later: 4, flats: "8, 19, 27, 36" },
      { building: "3", type: "TIP II - 9-storey", expected: 42, sold: 9, onSale: 19, later: 14, flats: "9, 11, 13, 18, 21-22, 24, 28-29, 31-32, 35, 37, 39" },
      { building: "4", type: "12-storey, 4 flats/storey", expected: 40, sold: 0, onSale: 4, later: 36, flats: "5-24, 26-28, 30-32, 34-36, 38-44" },
      { building: "5", type: "TIP III - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "7", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "8", type: "TIP II - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
      { building: "9", type: "TIP I - 12-storey", expected: 50, sold: 0, onSale: 33, later: 17, flats: "8, 12-13, 17-18, 22-23, 27, 33, 38, 42-44, 48-49, 54, 56" },
      { building: "10", type: "TIP III - 9-storey", expected: 42, sold: 0, onSale: 0, later: 42, flats: "13-54" },
    ],
  },
};

let onSaleFlatDetails = {};
let newTashkentContext = null;
let officialLotContext = null;

let sharqState = {
  lotId: "46A",
  typeId: "tip1",
  planId: null,
  sketchVariantId: "enhanced",
};

function assetUrl(filename) {
  return `${SHARQ_ASSETS}${filename}`;
}

async function loadSharqCandidates() {
  try {
    const response = await fetch("/sharq-candidates.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Candidates request failed with ${response.status}`);
    futureAuctionCandidates = await response.json();
    renderAuctionCandidates();
    renderFlatAnalysis();
  } catch (error) {
    console.warn("Using embedded Sharq candidate fallback.", error);
  }
}

async function loadOnSaleFlatDetails() {
  try {
    const response = await fetch("/sharq-onsale-flats.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`On-sale flat request failed with ${response.status}`);
    const payload = await response.json();
    onSaleFlatDetails = payload.flats || {};
    renderFlatAnalysis();
    renderFlatRanking();
  } catch (error) {
    console.warn("On-sale flat details are unavailable.", error);
  }
}

async function loadNewTashkentContext() {
  try {
    const response = await fetch("/newtashkent-context.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`New Tashkent context request failed with ${response.status}`);
    newTashkentContext = await response.json();
    renderNewTashkentContext();
  } catch (error) {
    console.warn("New Tashkent context is unavailable.", error);
    renderNewTashkentContext();
  }
}

async function loadOfficialLotContext() {
  try {
    const response = await fetch("/sharq-official-lot-context.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Sharq official lot context request failed with ${response.status}`);
    officialLotContext = await response.json();
    renderOfficialLotContext();
  } catch (error) {
    console.warn("Sharq official lot context is unavailable.", error);
    renderOfficialLotContext();
  }
}

function setWorkspace(workspace) {
  const showSharq = workspace === "sharq";
  filterWorkspace.hidden = showSharq;
  sharqWorkspace.hidden = !showSharq;
  filterWorkspaceControls.forEach((el) => {
    el.hidden = showSharq;
  });
  sharqWorkspaceControls.forEach((el) => {
    el.hidden = !showSharq;
  });
  workspaceButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.workspace === workspace);
  });
}

function renderProjectMarkers() {
  projectMapStage.querySelectorAll(".map-marker").forEach((marker) => marker.remove());
  lotMarkers.forEach((lot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-marker";
    button.textContent = lot.id;
    button.style.left = `${lot.x}%`;
    button.style.top = `${lot.y}%`;
    button.title = lot.note;
    button.classList.toggle("active", lot.id === sharqState.lotId);
    button.addEventListener("click", () => selectLot(lot.id));
    projectMapStage.appendChild(button);
  });
}

function renderTypeButtons() {
  typeButtonsEl.innerHTML = buildingTypes
    .map((type) => `
      <article class="type-info-card">
        <strong>${escapeHtml(type.title)}</strong>
        <span>${escapeHtml(type.note)}</span>
      </article>
    `)
    .join("");
}

function renderTypePlanButtons() {
  typePlanButtonsEl.innerHTML = buildingTypes
    .map((type) => `
      <button type="button" data-type-plan="${type.id}" class="${type.id === sharqState.typeId ? "active" : ""}">
        ${escapeHtml(type.title)}
      </button>
    `)
    .join("");

  typePlanButtonsEl.querySelectorAll("[data-type-plan]").forEach((button) => {
    button.addEventListener("click", () => selectType(button.dataset.typePlan));
  });
}

function renderTypeSketch() {
  const type = buildingTypes.find((item) => item.id === sharqState.typeId) || buildingTypes[0];
  const variant = selectedSketchVariant(type);
  activeTypeTitleEl.textContent = type.title;
  typeSketchImage.src = assetUrl(variant.image);
  typeSketchImage.alt = `${type.title} sketch from presentation`;
  renderSketchVariantControls(type);
  typeSketchStage.querySelectorAll(".zone-marker").forEach((zone) => zone.remove());

  type.zones.forEach((zone, index) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "zone-marker";
    label.textContent = `${index + 1}. ${zone.label}`;
    label.style.left = `${zone.x}%`;
    label.style.top = `${Math.max(8, zone.y - zone.h / 2 - 4)}%`;
    label.classList.toggle("active", zone.plan === sharqState.planId);
    label.addEventListener("click", () => selectFlat(zone.plan));
    typeSketchStage.appendChild(label);
  });
}

function selectedSketchVariant(type) {
  if (!type.imageVariants?.length) return { id: "default", label: "Default", image: type.image };
  return type.imageVariants.find((item) => item.id === sharqState.sketchVariantId) || type.imageVariants[0];
}

function renderSketchVariantControls(type) {
  if (!type.imageVariants?.length) {
    sketchVariantControlsEl.hidden = true;
    sketchVariantControlsEl.innerHTML = "";
    return;
  }

  sketchVariantControlsEl.hidden = false;
  sketchVariantControlsEl.innerHTML = type.imageVariants
    .map((variant) => `
      <button type="button" data-sketch-variant="${variant.id}" class="${variant.id === selectedSketchVariant(type).id ? "active" : ""}">
        ${escapeHtml(variant.label)}
      </button>
    `)
    .join("");

  sketchVariantControlsEl.querySelectorAll("[data-sketch-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      sharqState.sketchVariantId = button.dataset.sketchVariant;
      renderTypeSketch();
    });
  });
}

function renderFlatThumbnails() {
  flatThumbnailsEl.innerHTML = Object.entries(flatPlans)
    .map(([id, plan]) => `
      <button type="button" class="flat-thumb ${id === sharqState.planId ? "active" : ""}" data-plan="${id}">
        <img src="${assetUrl(plan.image)}" alt="${escapeHtml(plan.title)} thumbnail" loading="lazy" />
        <strong>${escapeHtml(plan.title)}</strong>
        <span>${escapeHtml(plan.area)}</span>
      </button>
    `)
    .join("");

  flatThumbnailsEl.querySelectorAll("[data-plan]").forEach((button) => {
    button.addEventListener("click", () => selectFlat(button.dataset.plan));
  });
}

function selectLot(lotId) {
  sharqState.lotId = lotId;
  const marker = lotMarkers.find((item) => item.id === lotId);
  selectedLotTitleEl.textContent = `Lot ${lotId}`;
  selectedLotMetaEl.textContent = marker?.note || "Shown in the overview map.";
  renderProjectMarkers();
  renderAuctionCandidates();
  renderBlockLayout();
  renderOfficialLotContext();
}

function renderAuctionCandidates() {
  const candidates = futureAuctionCandidates[sharqState.lotId] || { total: 0, sections: [] };
  const sections = candidates.sections || [];
  const total = sections.reduce((sum, item) => sum + item.later, 0);

  if (!sections.length) {
    auctionCandidatesEl.innerHTML = `
      <div class="candidate-head">
        <strong>Building status</strong>
        <span>0 flats</span>
      </div>
      <p>${escapeHtml(candidates.complex || "No complex data")} - no building inventory available.</p>
    `;
    return;
  }

  auctionCandidatesEl.innerHTML = `
    <div class="candidate-head">
      <strong>${escapeHtml(sharqState.lotId)} building status</strong>
      <span>${total} flats</span>
    </div>
    <p>${escapeHtml(candidates.complex)}. Every building is listed; storey 1 commercial space is excluded.</p>
    <div class="candidate-list">
      ${sections
        .map((item) => `
          <div class="candidate-row ${item.later ? "" : "is-complete"}">
            <span>${escapeHtml(sharqState.lotId)}/${escapeHtml(item.building)}</span>
            <strong>${escapeHtml(item.type)}</strong>
            <em>${escapeHtml(item.later ? `${item.later} later` : "0 later")}</em>
            <small>${escapeHtml(item.later ? `Expected ${item.expected}, sold ${item.sold}, on sale ${item.onSale}` : item.message || "All expected residential flats are sold or on sale.")}</small>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function renderBlockLayout() {
  const marker = lotMarkers.find((item) => item.id === sharqState.lotId) || lotMarkers.find((item) => item.id === "46A");
  const layout = layoutVariants[marker.layout] || layoutVariants.full;
  blockLayoutTitleEl.textContent = `${marker.id} block layout`;
  blockLayoutMetaEl.textContent = layout.description;
  blockLayoutImageEl.src = assetUrl(layout.image);
  blockLayoutImageEl.alt = `${marker.id} block layout`;
  buildingMixEl.innerHTML = layout.mix
    .map(([count, label]) => `
      <div class="mix-item">
        <strong>${escapeHtml(count)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
    `)
    .join("");
}

function parseFlatCode(value) {
  const match = String(value || "").trim().toUpperCase().match(/^([0-9]{2}[A-Z])\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,3})$/);
  if (!match) return null;
  return {
    lotId: match[1],
    building: match[2],
    flat: Number(match[3]),
  };
}

function typeIdFromSection(section, profile) {
  const type = String(section?.type || "").toLowerCase();
  if (type.includes("4 flats/storey")) return "fourPerFloor";
  if (type.includes("tip ii")) return "tip2";
  if (type.includes("tip iii") || type.includes("tip iv")) return "tip34";
  if (type.includes("tip i")) return "tip1";
  return profile?.typeId || "tip1";
}

function estimateFlatPosition(section, profile, flatNumber) {
  const typeId = typeIdFromSection(section, profile);
  const defaults = typeDefaults[typeId] || typeDefaults.tip1;
  const firstFlat = typeId === "fourPerFloor" ? 5 : defaults.firstFlat;
  const offset = flatNumber - firstFlat;

  if (offset < 0) {
    return {
      typeId,
      label: defaults.label,
      floor: "Below expected residential range",
      stack: "-",
      confidence: "low",
      note: `This flat number is lower than the usual first residential flat (${firstFlat}) for ${defaults.label}.`,
    };
  }

  const floor = defaults.firstResidentialFloor + Math.floor(offset / defaults.perFloor);
  const stack = (offset % defaults.perFloor) + 1;

  return {
    typeId,
    label: defaults.label,
    floor,
    stack,
    confidence: section ? "medium" : "low",
    note: `Estimated from ${defaults.perFloor} flats per residential floor, starting at flat ${firstFlat}.`,
  };
}

function flatNumberIsInList(flatNumber, listText) {
  return String(listText || "")
    .split(",")
    .some((part) => {
      const token = part.trim();
      if (!token) return false;
      const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) return flatNumber >= Number(range[1]) && flatNumber <= Number(range[2]);
      return Number(token) === flatNumber;
    });
}

function buildFlatAnalysis(parsed) {
  const code = `${parsed.lotId}/${parsed.building}/${parsed.flat}`;
  const flatRecord = onSaleFlatDetails[code] || null;
  const marker = lotMarkers.find((item) => item.id === parsed.lotId);
  const candidates = futureAuctionCandidates[parsed.lotId];
  const section = candidates?.sections?.find((item) => String(item.building) === String(parsed.building));
  const layoutKey = marker?.layout || "full";
  const profile = blockLocationProfiles[layoutKey]?.[parsed.building];
  const cardinal = cardinalProfiles[layoutKey]?.[parsed.building];
  const position = estimateFlatPosition(section, profile, parsed.flat);
  if (flatRecord?.unitFloor) {
    position.floor = flatRecord.unitFloor;
    position.confidence = "high";
    position.note = `Exact floor and flat details were loaded from the OnSale sheet for lot ${flatRecord.lotNumber || code}.`;
  }
  const topFloor = typeof position.floor === "number" && position.floor >= (typeDefaults[position.typeId]?.floors || 12) - 1;
  const lowFloor = typeof position.floor === "number" && position.floor <= (typeDefaults[position.typeId]?.firstResidentialFloor || 2) + 1;
  const isListedForLater = section ? flatNumberIsInList(parsed.flat, section.flats) : false;
  const availability = flatRecord
    ? `Currently on sale${flatRecord.lotNumber ? ` - lot ${flatRecord.lotNumber}` : ""}`
    : section
    ? (isListedForLater ? "Listed among later auction flats" : "Not listed in the current later-auction list")
    : "No building inventory found";
  const pros = [
    profile?.sun || "Use the exact flat plan to confirm the main room orientation.",
    cardinal ? `Mountain view: ${cardinal.mountain}` : "Mountain view is uncertain without a mapped building position.",
    flatRecord ? `${flatRecord.rooms || "-"} room, ${flatRecord.totalArea || "-"} m2 flat; price/sq.m data is available from the workbook.` : typeof position.floor === "number" && position.floor >= 5 ? "Middle/high floor should receive better daylight and less direct street noise." : "Lower floor can be easier for access and may stay cooler in summer.",
    profile?.wind?.includes("sheltered") ? "More sheltered from the historical north-east wind pattern." : "Corner/edge exposure can improve ventilation when windows are placed on different sides.",
  ];
  const cons = [
    profile?.wind || "Wind exposure depends on the exact side of the flat.",
    topFloor ? "Near-top floors can be hotter in summer and more dependent on roof insulation quality." : "Check neighboring-building shade on winter mornings and afternoons.",
    lowFloor ? "Lower floors can lose winter sun faster because of courtyard shade and nearby buildings." : "Higher floors may feel wind more strongly during cold months.",
  ];
  const watch = [
    cardinal ? `${cardinal.note} Confirm the actual room/window side on the flat plan.` : "Confirm the actual window direction from the detailed flat plan before bidding.",
    "Check whether bedroom windows face the courtyard, road, or outer perimeter.",
    "Ask for wall/roof insulation and ventilation details; they matter a lot in Tashkent's hot summer and cold winter.",
  ];

  return { marker, candidates, section, profile, cardinal, position, availability, pros, cons, watch, flatRecord };
}

function analysisList(title, items, tone) {
  return `
    <section class="analysis-list ${tone}">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderFlatAnalysis() {
  const parsed = parseFlatCode(flatCodeInput.value);
  if (!parsed) {
    flatAnalysisResultEl.innerHTML = `<div class="analysis-empty">Enter a code like 46A/4/25.</div>`;
    return;
  }

  const analysis = buildFlatAnalysis(parsed);
  if (analysis.marker && sharqState.lotId !== parsed.lotId) selectLot(parsed.lotId);
  const confidence = analysis.flatRecord ? "high" : analysis.position.confidence === "medium" && analysis.profile ? "medium" : "low";
  const confidenceClass = confidence === "high" ? "confidence-high" : confidence === "medium" ? "confidence-medium" : "confidence-low";
  const exactMetrics = analysis.flatRecord
    ? `
      <div><span>Price</span><strong>${money(analysis.flatRecord.price)} UZS</strong></div>
      <div><span>Area / rooms</span><strong>${escapeHtml(analysis.flatRecord.totalArea || "-")} m2 / ${escapeHtml(analysis.flatRecord.rooms || "-")}</strong></div>
      <div><span>Auction end</span><strong>${escapeHtml(analysis.flatRecord.auctionEnd || "-")}</strong></div>
      <div><span>Applications</span><strong>${escapeHtml(analysis.flatRecord.applications ?? "-")}</strong></div>
    `
    : "";

  flatAnalysisResultEl.innerHTML = `
    <div class="analysis-summary">
      <div>
        <span class="section-label">Selected flat</span>
        <strong>${escapeHtml(parsed.lotId)}/${escapeHtml(parsed.building)}/${escapeHtml(parsed.flat)}</strong>
        <p>${escapeHtml(analysis.profile?.place || "Location unknown")} - ${escapeHtml(analysis.profile?.exposure || "exact exposure needs plan confirmation")}.</p>
      </div>
      <span class="badge ${confidenceClass}">${escapeHtml(confidence)} confidence</span>
    </div>
    <div class="analysis-metrics">
      <div><span>Building type</span><strong>${escapeHtml(analysis.section?.type || analysis.position.label)}</strong></div>
      <div><span>Estimated floor</span><strong>${escapeHtml(analysis.position.floor)}</strong></div>
      <div><span>Cardinal side</span><strong>${escapeHtml(analysis.cardinal?.side || "Unknown")}</strong></div>
      <div><span>Mountain view</span><strong>${escapeHtml(analysis.cardinal?.mountain || "Needs exact window direction")}</strong></div>
      <div><span>Flat stack</span><strong>${escapeHtml(analysis.position.stack)}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(analysis.availability)}</strong></div>
      ${exactMetrics}
    </div>
    <div class="analysis-columns">
      ${analysisList("Pros", analysis.pros, "pros")}
      ${analysisList("Cons", analysis.cons, "cons")}
      ${analysisList("Check", analysis.watch, "watch")}
    </div>
    <p class="analysis-note">${escapeHtml(analysis.position.note)} Layout direction assumes the architectural north arrow: top is north, right is east, bottom is south, left is west. Mountain-view notes assume the Tashkent/Chimgan mountain horizon is generally east to north-east.</p>
  `;
}

function flatRecords() {
  return Object.values(onSaleFlatDetails || {}).filter((record) => record?.code);
}

function normalizedScore(value, min, max, higherIsBetter = true) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return 50;
  const ratio = (value - min) / (max - min);
  return (higherIsBetter ? ratio : 1 - ratio) * 100;
}

function viewScore(cardinal) {
  const text = `${cardinal?.side || ""} ${cardinal?.mountain || ""}`.toLowerCase();
  if (text.includes("best")) return 100;
  if (text.includes("very good")) return 92;
  if (text.includes("good potential")) return 82;
  if (text.includes("partial") || text.includes("medium")) return 62;
  if (text.includes("low to medium")) return 45;
  if (text.includes("low")) return 25;
  return 50;
}

function sunScore(cardinal, profile) {
  const text = `${cardinal?.side || ""} ${profile?.sun || ""}`.toLowerCase();
  let score = 50;
  if (text.includes("south-east")) score += 28;
  else if (text.includes("south")) score += 24;
  if (text.includes("east")) score += 15;
  if (text.includes("west")) score -= 12;
  if (text.includes("north")) score -= 14;
  if (text.includes("cooler in summer")) score += 8;
  if (text.includes("overheat") || text.includes("heat")) score -= 12;
  return Math.max(0, Math.min(100, score));
}

function windScore(profile) {
  const text = String(profile?.wind || "").toLowerCase();
  if (text.includes("highest") || text.includes("breezier")) return 35;
  if (text.includes("exposed")) return 45;
  if (text.includes("moderate")) return 62;
  if (text.includes("sheltered")) return 82;
  return 60;
}

function floorScore(record) {
  const floor = Number(record.unitFloor);
  const floors = Number(record.buildingFloors || 12);
  if (!floor || !floors) return 55;
  if (floor <= 3) return 48;
  if (floor >= floors) return 50;
  if (floor >= floors - 1) return 60;
  if (floor >= 5 && floor <= Math.max(7, floors - 3)) return 88;
  return 72;
}

function scoreFlat(record, priceStats, priority) {
  const marker = lotMarkers.find((item) => item.id === record.lotId);
  const layoutKey = marker?.layout || "full";
  const profile = blockLocationProfiles[layoutKey]?.[record.building];
  const cardinal = cardinalProfiles[layoutKey]?.[record.building];
  const pricePerSqm = Number(record.pricePerSqm || (Number(record.price) && Number(record.totalArea) ? Number(record.price) / Number(record.totalArea) : 0));
  const value = normalizedScore(pricePerSqm, priceStats.min, priceStats.max, false);
  const view = viewScore(cardinal);
  const sun = sunScore(cardinal, profile);
  const wind = windScore(profile);
  const floor = floorScore(record);
  const weights = {
    balanced: { value: 0.38, view: 0.2, sun: 0.18, wind: 0.1, floor: 0.14 },
    value: { value: 0.62, view: 0.12, sun: 0.1, wind: 0.06, floor: 0.1 },
    view: { value: 0.22, view: 0.34, sun: 0.22, wind: 0.08, floor: 0.14 },
  }[priority] || { value: 0.38, view: 0.2, sun: 0.18, wind: 0.1, floor: 0.14 };
  const score = Math.round(value * weights.value + view * weights.view + sun * weights.sun + wind * weights.wind + floor * weights.floor);

  return {
    record,
    score,
    pricePerSqm,
    profile,
    cardinal,
    reasons: [
      `${money(Math.round(pricePerSqm))} UZS/sq.m`,
      cardinal?.side || "Unknown side",
      cardinal?.mountain || "View needs window check",
      `${record.unitFloor || "-"} / ${record.buildingFloors || "-"} floor`,
    ],
  };
}

function renderFlatRanking() {
  const roomFilter = rankingRoomsSelect.value;
  const priority = rankingPrioritySelect.value;
  const records = flatRecords().filter((record) => roomFilter === "all" || String(record.rooms) === roomFilter);

  if (!records.length) {
    flatRankingSummaryEl.textContent = "No on-sale flat data loaded for this room filter.";
    flatRankingResultsEl.innerHTML = "";
    return;
  }

  const priceValues = records
    .map((record) => Number(record.pricePerSqm || (Number(record.price) && Number(record.totalArea) ? Number(record.price) / Number(record.totalArea) : 0)))
    .filter((value) => value > 0);
  const priceStats = { min: Math.min(...priceValues), max: Math.max(...priceValues) };
  const ranked = records
    .map((record) => scoreFlat(record, priceStats, priority))
    .sort((a, b) => b.score - a.score || a.pricePerSqm - b.pricePerSqm)
    .slice(0, 12);
  const avgPrice = priceValues.reduce((sum, value) => sum + value, 0) / priceValues.length;

  flatRankingSummaryEl.textContent = `${records.length} current on-sale flat${records.length === 1 ? "" : "s"} ranked. Price/sq.m range: ${money(Math.round(priceStats.min))} - ${money(Math.round(priceStats.max))} UZS. Average: ${money(Math.round(avgPrice))} UZS.`;
  flatRankingResultsEl.innerHTML = ranked.map(rankingCardMarkup).join("");

  flatRankingResultsEl.querySelectorAll("[data-rank-code]").forEach((button) => {
    button.addEventListener("click", () => {
      flatCodeInput.value = button.dataset.rankCode;
      renderFlatAnalysis();
      document.querySelector(".flat-analysis-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function rankingCardMarkup(item) {
  const record = item.record;
  return `
    <article class="ranking-card">
      <div class="ranking-rank">
        <strong>${escapeHtml(item.score)}</strong>
        <span>score</span>
      </div>
      <div class="ranking-body">
        <div class="ranking-title">
          <button type="button" data-rank-code="${escapeHtml(record.code)}">${escapeHtml(record.code)}</button>
          <span>${escapeHtml(record.rooms || "-")} rooms | ${escapeHtml(record.totalArea || "-")} m2</span>
        </div>
        <div class="ranking-facts">
          <span>${money(record.price)} UZS</span>
          <span>${money(Math.round(item.pricePerSqm))} UZS/sq.m</span>
          <span>Floor ${escapeHtml(record.unitFloor || "-")}/${escapeHtml(record.buildingFloors || "-")}</span>
          <span>${escapeHtml(record.applications ?? "-")} apps</span>
        </div>
        <p>${item.reasons.map(escapeHtml).join(" | ")}</p>
      </div>
    </article>
  `;
}

function renderNewTashkentContext() {
  if (!newTashkentContext) {
    newTashkentContextEl.innerHTML = `<div class="analysis-empty">Official planning context has not been generated yet.</div>`;
    return;
  }

  const nearest = (newTashkentContext.nearMapCenter || []).slice(0, 8);
  const topFunctions = (newTashkentContext.topFunctions || []).slice(0, 8);

  newTashkentContextEl.innerHTML = `
    <div class="context-metrics">
      <div><span>Planning polygons</span><strong>${escapeHtml(newTashkentContext.featureCount || "-")}</strong></div>
      <div><span>2D map center</span><strong>${escapeHtml((newTashkentContext.mapCenter || []).join(", "))}</strong></div>
      <div><span>Map zoom</span><strong>${escapeHtml(newTashkentContext.mapZoom || "-")}</strong></div>
    </div>
    <div class="context-grid">
      <section>
        <h4>Nearest official functions</h4>
        <div class="context-list">
          ${nearest
            .map((item) => `
              <div class="context-row">
                <strong>${escapeHtml(item.function1 || "-")}</strong>
                <span>${escapeHtml(item.block || "-")} | ${escapeHtml(item.transekt || "-")} | ${escapeHtml(item.distanceMeters)} m</span>
              </div>
            `)
            .join("")}
        </div>
      </section>
      <section>
        <h4>Most common functions</h4>
        <div class="context-list">
          ${topFunctions
            .map((item) => `
              <div class="context-row">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.count)} polygons</span>
              </div>
            `)
            .join("")}
        </div>
      </section>
    </div>
    <p class="analysis-note">${escapeHtml((newTashkentContext.insights || []).join(" "))}</p>
  `;
}

function renderOfficialLotContext() {
  if (!officialLotContext) {
    officialLotContextEl.innerHTML = "";
    return;
  }

  const lot = (officialLotContext.lots || []).find((item) => item.id === sharqState.lotId);
  if (!lot) {
    officialLotContextEl.innerHTML = "";
    return;
  }

  const nearest = (lot.nearest || []).slice(0, 5);
  officialLotContextEl.innerHTML = `
    <div class="official-lot-head">
      <div>
        <span class="section-label">Selected lot on official 2D map</span>
        <strong>${escapeHtml(lot.id)} estimated planning context</strong>
        <p>${escapeHtml(officialLotContext.projectionNote || "")}</p>
      </div>
      <span class="badge confidence-low">${escapeHtml(officialLotContext.projectionConfidence || "low")} confidence</span>
    </div>
    <div class="context-metrics">
      <div><span>Estimated coordinate</span><strong>${escapeHtml((lot.estimatedCoordinate || []).join(", "))}</strong></div>
      <div><span>Yandex Sharq point</span><strong>${escapeHtml((officialLotContext.sharqBahoriYandexPoint || []).join(", "))}</strong></div>
      <div><span>Nearest source</span><strong>Official 2D GeoJSON</strong></div>
    </div>
    <div class="context-list official-lot-list">
      ${nearest
        .map((item) => `
          <div class="context-row">
            <strong>${escapeHtml(item.function1 || "-")}${item.function2 && item.function2 !== "Boshqa foydalanish yo'q" ? ` + ${escapeHtml(item.function2)}` : ""}</strong>
            <span>${escapeHtml(item.block || "-")} | ${escapeHtml(item.transekt || "-")} | ${escapeHtml(item.distanceMeters)} m | ${escapeHtml(item.areaHa || "-")} ha | ${escapeHtml(item.floors ?? "-")} floors</span>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function selectType(typeId) {
  sharqState.typeId = typeId;
  sharqState.planId = null;
  const type = buildingTypes.find((item) => item.id === typeId);
  sharqState.sketchVariantId = type?.imageVariants?.[0]?.id || "default";
  renderTypePlanButtons();
  renderTypeSketch();
  renderFlatPreview();
  renderFlatThumbnails();
}

function selectFlat(planId) {
  sharqState.planId = planId;
  renderTypeSketch();
  renderFlatPreview();
  renderFlatThumbnails();
}

function renderFlatPreview() {
  const plan = sharqState.planId ? flatPlans[sharqState.planId] : null;

  if (!plan) {
    flatTitleEl.textContent = "Choose a flat on the sketch";
    flatMetaEl.textContent = "The matching plan image will appear here.";
    flatImageEl.hidden = true;
    flatEmptyEl.hidden = false;
    openFlatPlanButton.disabled = true;
    return;
  }

  flatTitleEl.textContent = plan.title;
  flatMetaEl.textContent = `${plan.rooms} | ${plan.area}`;
  flatImageEl.src = assetUrl(plan.image);
  flatImageEl.alt = `${plan.title} plan`;
  flatImageEl.hidden = false;
  flatEmptyEl.hidden = true;
  openFlatPlanButton.disabled = false;
}

function openSelectedFlatPlan() {
  const plan = flatPlans[sharqState.planId];
  if (!plan) return;
  dialogTitleEl.textContent = `${plan.title} | ${plan.area}`;
  dialogImageEl.src = assetUrl(plan.image);
  dialogImageEl.alt = `${plan.title} large plan`;
  flatPlanDialog.showModal();
}

function resetSharqMap() {
  sharqState = { lotId: "46A", typeId: "tip1", planId: null, sketchVariantId: "enhanced" };
  flatCodeInput.value = "46A/4/25";
  selectLot(sharqState.lotId);
  renderTypeButtons();
  renderTypePlanButtons();
  renderTypeSketch();
  renderFlatPreview();
  renderFlatThumbnails();
  renderFlatAnalysis();
  renderFlatRanking();
}

function initSharqMap() {
  workspaceButtons.forEach((button) => {
    button.addEventListener("click", () => setWorkspace(button.dataset.workspace));
  });
  flatAnalyzerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    renderFlatAnalysis();
  });
  rankingRoomsSelect.addEventListener("change", renderFlatRanking);
  rankingPrioritySelect.addEventListener("change", renderFlatRanking);
  resetSharqMapButton.addEventListener("click", resetSharqMap);
  openFlatPlanButton.addEventListener("click", openSelectedFlatPlan);
  flatImageEl.addEventListener("click", openSelectedFlatPlan);
  closeFlatPlanButton.addEventListener("click", () => flatPlanDialog.close());
  flatPlanDialog.addEventListener("click", (event) => {
    if (event.target === flatPlanDialog) flatPlanDialog.close();
  });
  resetSharqMap();
  loadSharqCandidates();
  loadOnSaleFlatDetails();
  loadNewTashkentContext();
  loadOfficialLotContext();
}

initSharqMap();
