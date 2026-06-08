const form = document.querySelector("#filterForm");
const resultsEl = document.querySelector("#results");
const loadingStateEl = document.querySelector("#loadingState");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const pageInfoEl = document.querySelector("#pageInfo");
const prevPageButton = document.querySelector("#prevPage");
const nextPageButton = document.querySelector("#nextPage");
const resetButton = document.querySelector("#resetButton");
const searchButton = form.querySelector('button[type="submit"]');
const localFilterInput = document.querySelector("#localFilter");
const exportJsonButton = document.querySelector("#exportJson");
const exportCsvButton = document.querySelector("#exportCsv");
const loadAllButton = document.querySelector("#loadAll");
const loadDetailsButton = document.querySelector("#loadDetails");
const copyLinksButton = document.querySelector("#copyLinks");
const toggleViewButton = document.querySelector("#toggleView");
const saveSearchButton = document.querySelector("#saveSearch");
const savedSearchesEl = document.querySelector("#savedSearches");
const statsEl = document.querySelector("#stats");
const autoRefreshInput = document.querySelector("#autoRefresh");
const refreshIntervalSelect = document.querySelector("#refreshInterval");
const lastUpdatedEl = document.querySelector("#lastUpdated");
const minPriceInput = document.querySelector("#minPrice");
const maxPriceInput = document.querySelector("#maxPrice");
const minApplicationsInput = document.querySelector("#minApplications");
const maxApplicationsInput = document.querySelector("#maxApplications");
const indexSelect = document.querySelector("#index");
const dateFromInput = document.querySelector("#dateFrom");
const dateToInput = document.querySelector("#dateTo");
const finishedStatusSelect = document.querySelector("#finishedStatus");

const LOCAL_FILTER_NAMES = new Set(["minPrice", "maxPrice", "minApplications", "maxApplications"]);
const STORAGE_KEY = "e-auksion-filter-saved-searches";
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

function parseFormattedNumber(value) {
  const normalized = String(value || "").replace(/[^\d.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumberInput(input) {
  const value = parseFormattedNumber(input.value);
  input.value = value === null ? "" : money(value);
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

function updateBusyControls() {
  searchButton.disabled = state.isLoadingLots;
  resetButton.disabled = state.isLoadingLots;
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

function setDateRange(from, to) {
  dateFromInput.value = formatDate(from);
  dateToInput.value = formatDate(to);
}

function setCompletedDefaultDates() {
  if (indexSelect.value !== "2" || dateFromInput.value || dateToInput.value) return;
  const now = new Date();
  setDateRange(new Date(now.getFullYear(), now.getMonth(), 1), now);
}

function lotStatus(lot) {
  const statusId = Number(lot.lot_statuses_id);
  const applications = Number(lot.user_order_cnt || lot.user_orders_apply_cnt || 0);

  if (statusId === 32) return "Failed / not held";
  if ([19, 29, 34].includes(statusId)) return "Successful";
  if (statusId === 2) return "On sale";
  if (statusId === 11) return "Current bidding";
  if (applications > 0 && indexSelect.value === "2") return "Successful";
  if (indexSelect.value === "2") return "Completed";
  return `Status ID ${statusId || "-"}`;
}

function statusClass(label) {
  if (label === "Successful") return "success";
  if (label === "Failed / not held") return "failed";
  if (label === "On sale") return "sale";
  if (label === "Current bidding") return "bidding";
  return "neutral";
}

function applications(lot) {
  const raw = lot.user_order_cnt ?? lot.user_orders_apply_cnt ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function lotUrl(lot) {
  return `${LOT_URL}${encodeURIComponent(lot.id)}`;
}

function detailValue(details, shortName) {
  const item = details.find((detail) => detail.short_name === shortName);
  return item?.detail_value_as_string || item?.detail_value_string || item?.detail_value || "";
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
    totalArea: detailValue(details, "xonadon_umumiy_maydon"),
    livingArea: detailValue(details, "xona_umumiy_maydoni"),
    kitchenArea: detailValue(details, "oshxona_maydoni"),
    auxiliaryArea: detailValue(details, "yordamchi_xonalar_maydoni"),
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

  const price = Number(lot.start_price || 0);
  const minPrice = parseFormattedNumber(minPriceInput.value);
  const maxPrice = parseFormattedNumber(maxPriceInput.value);
  const minApplications = numberOrNull(minApplicationsInput.value);
  const maxApplications = numberOrNull(maxApplicationsInput.value);

  if (minPrice !== null && price < minPrice) return false;
  if (maxPrice !== null && price > maxPrice) return false;
  if (minApplications !== null && applications(lot) < minApplications) return false;
  if (maxApplications !== null && applications(lot) > maxApplications) return false;

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
    price: Number(lot.start_price || 0),
    applications: applications(lot),
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
  return sortedRows(state.rows.filter((lot) => lotMatchesLocalFilter(lot, localFilterInput.value.trim())));
}

function renderStats(rows) {
  const prices = rows.map((lot) => Number(lot.start_price || 0)).filter((price) => price > 0);
  const totalApplications = rows.reduce((sum, lot) => sum + applications(lot), 0);
  const statusCounts = rows.reduce((acc, lot) => {
    const status = lotStatus(lot);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const avgPrice = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;

  const stats = [
    ["Filtered lots", rows.length],
    ["Total applications", totalApplications],
    ["Average price", `${money(avgPrice)} UZS`],
    ["Min price", `${money(prices.length ? Math.min(...prices) : 0)} UZS`],
    ["Max price", `${money(prices.length ? Math.max(...prices) : 0)} UZS`],
    ["Successful", statusCounts.Successful || 0],
    ["Failed / not held", statusCounts["Failed / not held"] || 0],
    ["On sale", statusCounts["On sale"] || 0],
  ];

  statsEl.innerHTML = stats
    .map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderResults() {
  const rows = filteredRows();
  resultsEl.innerHTML = "";
  resultsEl.className = `results ${state.isTableView ? "table-mode" : "card-mode"}`;
  toggleViewButton.textContent = state.isTableView ? "Card view" : "Table view";
  renderStats(rows);

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
  const price = Number(lot.start_price || 0);
  const area = Number(lotDetails(lot).totalArea || 0);
  if (!price || !area) return "-";
  return money(Math.round(price / area));
}

function tableRow(lot) {
  const status = lotStatus(lot);
  const details = lotDetails(lot);
  return `
    <tr>
      <td>${escapeHtml(lot.lot_number || lot.id)}</td>
      <td class="name-cell">${escapeHtml(lot.name || "-")}</td>
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
  setCompletedDefaultDates();
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
  setCompletedDefaultDates();
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

  const rows = state.rows;
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

function exportJson() {
  downloadFile("e-auksion-lots.json", JSON.stringify(filteredRows(), null, 2), "application/json");
}

function exportCsv() {
  const rows = filteredRows();
  const headers = ["lot_number", "name", "price", "price_per_sqm", "deposit", "applications", "status", "auction_end", "unit_floor", "building_floors", "total_area", "rooms", "completion_term", "handover_status", "living_area", "kitchen_area", "auxiliary_area", "views", "url"];
  const csvRows = [headers.join(",")];

  for (const lot of rows) {
    const status = lotStatus(lot);
    const details = lotDetails(lot);
    csvRows.push(
      [
        lot.lot_number || lot.id,
        lot.name || "",
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

async function copyLinks() {
  const links = filteredRows().map(lotUrl).join("\n");
  if (!links) {
    setStatus("There are no links to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(links);
    setStatus(`Copied ${filteredRows().length} links.`);
  } catch (_) {
    setStatus("Copy failed in this browser. Export CSV still includes links.", true);
  }
}

function savedSearchValues() {
  const data = new FormData(form);
  const values = {};
  for (const [key, value] of data.entries()) values[key] = value;
  values.localFilter = localFilterInput.value;
  return values;
}

function applySavedSearch(values) {
  for (const [key, value] of Object.entries(values)) {
    if (key === "localFilter") {
      localFilterInput.value = value;
      continue;
    }
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  }
  state.page = 1;
  loadLots();
}

function getSavedSearches() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function setSavedSearches(searches) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}

function renderSavedSearches() {
  const searches = getSavedSearches();
  if (!searches.length) {
    savedSearchesEl.innerHTML = `<p class="empty-note">No saved searches yet.</p>`;
    return;
  }

  savedSearchesEl.innerHTML = searches
    .map((search, index) => `
      <div class="saved-item">
        <button type="button" data-load-search="${index}">${escapeHtml(search.name)}</button>
        <button type="button" data-delete-search="${index}" aria-label="Delete saved search">Delete</button>
      </div>
    `)
    .join("");

  savedSearchesEl.querySelectorAll("[data-load-search]").forEach((button) => {
    button.addEventListener("click", () => applySavedSearch(searches[Number(button.dataset.loadSearch)].values));
  });
  savedSearchesEl.querySelectorAll("[data-delete-search]").forEach((button) => {
    button.addEventListener("click", () => {
      searches.splice(Number(button.dataset.deleteSearch), 1);
      setSavedSearches(searches);
      renderSavedSearches();
    });
  });
}

function saveCurrentSearch() {
  const searches = getSavedSearches();
  const name = `Search ${new Date().toLocaleString()}`;
  searches.unshift({ name, values: savedSearchValues() });
  setSavedSearches(searches.slice(0, 12));
  renderSavedSearches();
}

function setPreset(name) {
  const now = new Date();
  if (name === "today") setDateRange(now, now);
  if (name === "this-month") setDateRange(new Date(now.getFullYear(), now.getMonth(), 1), now);
  if (name === "last-month") setDateRange(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0));
  if (name === "last-90") {
    const from = new Date(now);
    from.setDate(from.getDate() - 90);
    setDateRange(from, now);
  }
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
  state.page = 1;
  loadLots();
});

resetButton.addEventListener("click", () => {
  form.reset();
  document.querySelector("#group").value = "41";
  document.querySelector("#category").value = "169";
  document.querySelector("#index").value = "1";
  document.querySelector("#perPage").value = "12";
  document.querySelector("#order").value = "0";
  finishedStatusSelect.value = "0";
  localFilterInput.value = "";
  dateFromInput.value = "";
  dateToInput.value = "";
  minPriceInput.value = "";
  maxPriceInput.value = "";
  minApplicationsInput.value = "";
  maxApplicationsInput.value = "";
  state.page = 1;
  state.sortKey = null;
  state.sortDirection = "asc";
  loadLots();
});

indexSelect.addEventListener("change", () => {
  if (indexSelect.value === "2") {
    setCompletedDefaultDates();
  } else {
    finishedStatusSelect.value = "0";
  }
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

[localFilterInput, minApplicationsInput, maxApplicationsInput].forEach((input) => {
  input.addEventListener("input", renderResults);
});

[minPriceInput, maxPriceInput].forEach((input) => {
  input.addEventListener("input", renderResults);
  input.addEventListener("blur", () => {
    formatNumberInput(input);
    renderResults();
  });
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => setPreset(button.dataset.preset));
});

toggleViewButton.addEventListener("click", () => {
  state.isTableView = !state.isTableView;
  renderResults();
});
loadAllButton.addEventListener("click", loadAllPages);
loadDetailsButton.addEventListener("click", loadDetailsForRows);
exportJsonButton.addEventListener("click", exportJson);
exportCsvButton.addEventListener("click", exportCsv);
copyLinksButton.addEventListener("click", copyLinks);
saveSearchButton.addEventListener("click", saveCurrentSearch);
autoRefreshInput.addEventListener("change", updateAutoRefresh);
refreshIntervalSelect.addEventListener("change", updateAutoRefresh);

renderSavedSearches();
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
  } catch (error) {
    console.warn("Using embedded Sharq candidate fallback.", error);
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
  selectLot(sharqState.lotId);
  renderTypeButtons();
  renderTypePlanButtons();
  renderTypeSketch();
  renderFlatPreview();
  renderFlatThumbnails();
}

function initSharqMap() {
  workspaceButtons.forEach((button) => {
    button.addEventListener("click", () => setWorkspace(button.dataset.workspace));
  });
  resetSharqMapButton.addEventListener("click", resetSharqMap);
  openFlatPlanButton.addEventListener("click", openSelectedFlatPlan);
  flatImageEl.addEventListener("click", openSelectedFlatPlan);
  closeFlatPlanButton.addEventListener("click", () => flatPlanDialog.close());
  flatPlanDialog.addEventListener("click", (event) => {
    if (event.target === flatPlanDialog) flatPlanDialog.close();
  });
  resetSharqMap();
  loadSharqCandidates();
}

initSharqMap();
