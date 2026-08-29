const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5177);
const PUBLIC_DIR = path.join(__dirname, "public");
const EAUKSION_ORIGIN = "https://e-auksion.uz";
const DEFAULT_REFERER =
  "https://e-auksion.uz/lots?group=41&category=169&index=1&page=1&address=&lt=0&at=0&order=0&q=&hashtag=";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const NEW_LOT_POLL_INTERVAL_MS = Number(process.env.NEW_LOT_POLL_INTERVAL_MS || 60 * 60 * 1000);
const SEEN_LOTS_FILE = path.join(__dirname, "reports", "seen-sharq-lots.json");

// PoW token cache: { token: string, expiresAt: timestamp }
const powTokenCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function md5(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex");
}

function solvePow(nonce, difficulty, maxIterations = 50000000) {
  const prefix = nonce + ":";
  for (let i = 0; i < maxIterations; i++) {
    const hash = crypto.createHash("sha256").update(prefix + i).digest();
    let bits = 0;
    for (let j = 0; j < hash.length; j++) {
      const v = hash[j];
      if (v === 0) {
        bits += 8;
        continue;
      }
      for (let mask = 0x80; mask !== 0 && (v & mask) === 0; mask >>= 1) {
        bits++;
      }
      break;
    }
    if (bits >= difficulty) {
      return String(i);
    }
  }
  return null;
}

function toNullableInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: formatDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: formatDate(now),
  };
}

function buildLotPayload(query) {
  const tab = toStringValue(query.get("index"), "1");
  const lotTypeForSort = toNullableInt(tab, 1);
  const groupId = toNullableInt(query.get("group"), 41);
  const categoryId = toNullableInt(query.get("category"), 169);
  const page = Math.max(1, toNullableInt(query.get("page"), 1));
  const perPage = Math.min(100, Math.max(1, toNullableInt(query.get("perPage"), 12)));
  const bankId = toNullableInt(query.get("bank"), null);
  const completedDefaultRange = tab === "2" ? currentMonthRange() : { from: null, to: null };
  const dateFrom = query.get("datef") || completedDefaultRange.from;
  const dateTo = query.get("datet") || completedDefaultRange.to;

  const hashSource = {
    sort_type: lotTypeForSort,
    confiscant_groups_id: groupId,
    confiscant_categories_id: categoryId,
    regions_id: toNullableInt(query.get("region"), null),
    areas_id: toNullableInt(query.get("area"), null),
    mahallas_id: toNullableInt(query.get("mahalla"), null),
    address: toStringValue(query.get("address"), ""),
    lot_number1: toStringValue(query.get("q"), ""),
    hashtag: toStringValue(query.get("hashtag"), ""),
    date_from: dateFrom,
    date_to: dateTo,
    auction_date: query.get("date") || null,
    is_term_order: toNullableInt(query.get("is_term"), -1),
    exec_order_type: toNullableInt(query.get("eot"), 0),
    lot_type: toNullableInt(query.get("lt"), 0),
    auction_type: toNullableInt(query.get("at"), 0),
    finished_auction_status: toNullableInt(query.get("fas"), 0),
    filtered_auction_status: toNullableInt(query.get("fis"), 0),
    is_ownership: toNullableInt(query.get("is_own"), -1),
    orderby_: toNullableInt(query.get("order"), 0),
    current_page: page,
    per_page: perPage,
    dynamic_filters: [],
    bank_id: bankId,
  };

  const requestBody = {
    sort_type: hashSource.sort_type,
    confiscant_groups_id: hashSource.confiscant_groups_id,
    confiscant_categories_id: hashSource.confiscant_categories_id,
    regions_id: hashSource.regions_id,
    areas_id: hashSource.areas_id,
    mahallas_id: hashSource.mahallas_id,
    address: hashSource.address,
    lot_number: hashSource.lot_number1,
    hashtag: hashSource.hashtag,
    date_from: hashSource.date_from,
    date_to: hashSource.date_to,
    auction_date: hashSource.auction_date,
    is_term_order: hashSource.is_term_order,
    exec_order_type: hashSource.exec_order_type,
    lot_type: hashSource.lot_type,
    auction_type: hashSource.auction_type,
    finished_auction_status: hashSource.finished_auction_status,
    filtered_auction_status: hashSource.filtered_auction_status,
    is_ownership: hashSource.is_ownership,
    orderby_: hashSource.orderby_,
    current_page: hashSource.current_page,
    per_page: hashSource.per_page,
    dynamic_filters: hashSource.dynamic_filters,
    bank_id: hashSource.bank_id,
    zz_md5: md5(JSON.stringify(hashSource)),
  };

  const endpoint = tab === "3" ? "/api/front/curlots" : "/api/front/lots";
  return { endpoint, requestBody };
}

function eAuksionRequest(endpoint, method = "GET", body = null, lang = "uz") {
  return new Promise((resolve, reject) => {
    const target = new URL(`${EAUKSION_ORIGIN}${endpoint}`);
    if (!target.searchParams.has("lang")) target.searchParams.set("lang", lang);

    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const req = https.request(
      target,
      {
        method,
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: DEFAULT_REFERER,
          ...(payload
            ? {
                "Content-Type": "application/json;charset=UTF-8",
                "Content-Length": payload.length,
              }
            : {}),
        },
      },
      (apiRes) => {
        const chunks = [];
        apiRes.on("data", (chunk) => chunks.push(chunk));
        apiRes.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            // Keep the raw body for better debugging.
          }

          if (apiRes.statusCode >= 400) {
            reject({ status: apiRes.statusCode, body: parsed });
            return;
          }

          resolve(parsed);
        });
      }
    );

    req.setTimeout(30000, () => {
      req.destroy(new Error("E-AUKSION request timed out"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function eAuksionRequestWithPow(endpoint, method = "GET", body = null, lang = "uz") {
  return new Promise(async (resolve, reject) => {
    try {
      // Try initial request
      try {
        const result = await eAuksionRequest(endpoint, method, body, lang);
        return resolve(result);
      } catch (error) {
        // If not 428, just fail
        if (error.status !== 428 || !error.body || !error.body.challenge || !error.body.difficulty) {
          throw error;
        }
        
        // Handle 428 - solve PoW
        const { challenge, difficulty } = error.body;
        const nonce = challenge.split(".")[1];

        // Check cache
        const cached = powTokenCache.get("lot-detail");
        let token = null;
        if (cached && cached.expiresAt > Date.now()) {
          token = cached.token;
        } else {
          // Solve PoW
          const solution = solvePow(nonce, difficulty);
          if (!solution) throw new Error("Failed to solve PoW");

          // Get token
          const verifyResult = await eAuksionRequest("/api/front/proof/verify", "POST", { challenge, solution }, lang);
          if (!verifyResult.token) throw new Error("Failed to get PoW token");

          token = verifyResult.token;
          const expiresIn = verifyResult.expires_in || 1800;
          powTokenCache.set("lot-detail", {
            token,
            expiresAt: Date.now() + (expiresIn - 30) * 1000,
          });
        }

        // Retry with token
        return new Promise((res, rej) => {
          const target = new URL(`${EAUKSION_ORIGIN}${endpoint}`);
          if (!target.searchParams.has("lang")) target.searchParams.set("lang", lang);
          const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
          const req = https.request(target, {
            method,
            headers: {
              Accept: "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: DEFAULT_REFERER,
              "X-Proof-Token": token,
              ...(payload ? { "Content-Type": "application/json;charset=UTF-8", "Content-Length": payload.length } : {}),
            },
          }, (apiRes) => {
            const chunks = [];
            apiRes.on("data", (chunk) => chunks.push(chunk));
            apiRes.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              let parsed = raw;
              try { parsed = JSON.parse(raw); } catch (_) {}
              if (apiRes.statusCode >= 400) return rej({ status: apiRes.statusCode, body: parsed });
              res(parsed);
            });
          });
          req.setTimeout(30000, () => req.destroy(new Error("Request timed out")));
          req.on("error", rej);
          if (payload) req.write(payload);
          req.end();
        }).then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function telegramRequest(method, payload) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_BOT_TOKEN) {
      reject(new Error("TELEGRAM_BOT_TOKEN is not configured"));
      return;
    }

    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
      },
      (apiRes) => {
        const chunks = [];
        apiRes.on("data", (chunk) => chunks.push(chunk));
        apiRes.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            // Keep raw body for debugging.
          }
          if (apiRes.statusCode >= 400 || (parsed && parsed.ok === false)) {
            reject(new Error(`Telegram request failed: ${raw}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[new-lot-watch] Telegram not configured, skipping notification:\n" + text);
    return Promise.resolve();
  }
  return telegramRequest("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

function loadSeenLotKeys() {
  try {
    const raw = fs.readFileSync(SEEN_LOTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (_) {
    return new Set();
  }
}

function saveSeenLotKeys(keysSet) {
  fs.mkdirSync(path.dirname(SEEN_LOTS_FILE), { recursive: true });
  fs.writeFileSync(SEEN_LOTS_FILE, JSON.stringify([...keysSet].sort()));
}

// The apartment code (e.g. "44B/2/52") identifies the physical flat; lot.id changes
// whenever an unsold lot gets relisted, so it can't be used to detect genuinely new lots.
function lotIdentityKey(lot) {
  return lot.name || lot.lot_number || String(lot.id);
}

async function fetchAllSharqLots() {
  const rows = [];
  let page = 1;
  let totalPages = 1;

  do {
    const params = new URLSearchParams({ index: "1", page: String(page), perPage: "100" });
    const { endpoint, requestBody } = buildLotPayload(params);
    const data = await eAuksionRequest(endpoint, "POST", requestBody, "uz");
    rows.push(...(Array.isArray(data.rows) ? data.rows : []));
    totalPages = data.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return rows;
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value ?? "-");
}

async function fetchLotRoomsAndArea(lotId) {
  try {
    const detail = await eAuksionRequestWithPow(`/api/front/lot-info?lot_id=${encodeURIComponent(lotId)}`, "GET", null, "uz");
    const details = Array.isArray(detail.confiscant_details_list) ? detail.confiscant_details_list : [];
    const find = (shortName) => {
      const item = details.find((d) => d.short_name === shortName);
      return item?.detail_value_as_string || item?.detail_value_string || item?.detail_value || "";
    };
    const rooms = find("xona_umumiy_soni");
    const area = String(find("xonadon_umumiy_maydon")).replaceAll(",", ".");
    return { rooms, area };
  } catch (error) {
    console.error(`[new-lot-watch] Failed to load details for lot ${lotId}:`, error.message || error);
    return { rooms: "-", area: "" };
  }
}

async function notifyNewSharqLot(lot) {
  const { rooms, area } = await fetchLotRoomsAndArea(lot.id);
  const price = Number(lot.start_price || 0);
  const areaNum = Number(area || 0);
  const pricePerSqm = price && areaNum ? Math.round(price / areaNum) : null;

  const lines = [
    `🆕 New Sharq Bahori lot: <b>${lot.name || lot.lot_number}</b>`,
    `Rooms: ${rooms || "-"}`,
    `Area: ${area ? `${area} m²` : "-"}`,
    `Price: ${formatNumber(price)} UZS`,
    `Price/m²: ${pricePerSqm ? `${formatNumber(pricePerSqm)} UZS` : "-"}`,
    `Link: https://e-auksion.uz/lot-view?lot_id=${lot.id}`,
  ];

  await sendTelegramMessage(lines.join("\n"));
}

async function checkForNewSharqLots() {
  try {
    const rows = await fetchAllSharqLots();
    const currentKeys = new Set(rows.map(lotIdentityKey));
    const seenKeys = loadSeenLotKeys();
    const isFirstRun = seenKeys.size === 0;
    const newRows = isFirstRun ? [] : rows.filter((row) => !seenKeys.has(lotIdentityKey(row)));

    for (const row of newRows) {
      await notifyNewSharqLot(row);
    }

    saveSeenLotKeys(currentKeys);

    if (isFirstRun) {
      console.log(`[new-lot-watch] Baseline established with ${currentKeys.size} existing lots.`);
    } else if (newRows.length) {
      console.log(`[new-lot-watch] Notified about ${newRows.length} new lot(s).`);
    }
  } catch (error) {
    console.error("[new-lot-watch] Check failed:", error.message || error);
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath =
    requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (requestUrl.pathname === "/api/lots") {
      const lang = requestUrl.searchParams.get("lang") || "uz";
      const { endpoint, requestBody } = buildLotPayload(requestUrl.searchParams);
      const data = await eAuksionRequest(endpoint, "POST", requestBody, lang);
      json(res, 200, data);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/lot/")) {
      const id = requestUrl.pathname.split("/").pop();
      const lang = requestUrl.searchParams.get("lang") || "uz";
      const data = await eAuksionRequestWithPow(`/api/front/lot-info?lot_id=${encodeURIComponent(id)}`, "GET", null, lang);
      json(res, 200, data);
      return;
    }

    if (requestUrl.pathname === "/api/groups") {
      const lang = requestUrl.searchParams.get("lang") || "uz";
      const data = await eAuksionRequest(
        "/api/front/dictionaries/get-confiscant-groups?with_meta=1",
        "GET",
        null,
        lang
      );
      json(res, 200, data);
      return;
    }

    if (requestUrl.pathname === "/api/check-new-lots" && req.method === "POST") {
      await checkForNewSharqLots();
      json(res, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/api/test-telegram" && req.method === "POST") {
      if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        json(res, 400, { ok: false, message: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set" });
        return;
      }
      await sendTelegramMessage("✅ Test notification from e-auksion filter (server is configured correctly).");
      json(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    json(res, error.status || 500, {
      message: "Request failed",
      detail: error.body || error.message || String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`E-AUKSION filter running at http://localhost:${PORT}`);

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    checkForNewSharqLots();
    setInterval(checkForNewSharqLots, NEW_LOT_POLL_INTERVAL_MS);
  } else {
    console.log("[new-lot-watch] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, new-lot notifications disabled.");
  }
});
