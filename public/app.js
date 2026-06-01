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
    auctionStart: lot.auction_date_str || "",
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
    ["applications", "Apps"],
    ["status", "Status"],
    ["auctionStart", "Auction start"],
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

function tableRow(lot) {
  const status = lotStatus(lot);
  const details = lotDetails(lot);
  return `
    <tr>
      <td>${escapeHtml(lot.lot_number || lot.id)}</td>
      <td class="name-cell">${escapeHtml(lot.name || "-")}</td>
      <td>${money(lot.start_price)}</td>
      <td>${applications(lot)}</td>
      <td><span class="badge ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(lot.auction_date_str || "-")}</td>
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
          <div class="meta-row"><span>Deposit</span><strong>${money(lot.zaklad_summa)} UZS</strong></div>
          <div class="meta-row"><span>Auction start</span><strong>${escapeHtml(lot.auction_date_str || "-")}</strong></div>
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
  const headers = ["lot_number", "name", "price", "deposit", "applications", "status", "auction_start", "auction_end", "unit_floor", "building_floors", "total_area", "rooms", "completion_term", "handover_status", "living_area", "kitchen_area", "auxiliary_area", "views", "url"];
  const csvRows = [headers.join(",")];

  for (const lot of rows) {
    const status = lotStatus(lot);
    const details = lotDetails(lot);
    csvRows.push(
      [
        lot.lot_number || lot.id,
        lot.name || "",
        lot.start_price || "",
        lot.zaklad_summa || "",
        applications(lot),
        status,
        lot.auction_date_str || "",
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
