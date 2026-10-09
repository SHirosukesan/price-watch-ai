// Price Watch シンプルshiro_AI — 画面の動き
// 構成: 1) データ読み込み 2) 商品画面 3) セール画面 4) 設定画面 5) 通知 6) 動作チェック
"use strict";

const REFRESH_MINUTES = 10;           // アプリを開いている間の自動更新間隔
const STALE_HOURS = 2;                // これより古い取得結果は「止まっているかも」と表示
const STORE_NAMES = { rakuten: "楽天", yahoo: "Yahoo!", amazon: "Amazon" };
const LS = { targets: "pw.targets", notified: "pw.notified" };

const state = { products: [], sales: [], prices: null, loadError: null };
const $ = (s) => document.querySelector(s);
const yen = (n) => (n == null ? "—" : n.toLocaleString("ja-JP") + "円");

// ---------- 端末への保存（読み書きに失敗しても動くように） ----------
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function targetOf(p) {
  const t = load(LS.targets, {})[p.id];
  return Number.isFinite(t) && t > 0 ? t : p.target;
}

// ---------- 1) データ読み込み ----------
async function getJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

async function loadAll() {
  const btn = $("#refresh");
  btn.classList.add("spin");
  try {
    const [p, s, pr] = await Promise.all([getJson("data/products.json"), getJson("data/sales.json"), getJson("data/prices.json")]);
    state.products = p.products;
    state.sales = s.sales;
    state.prices = pr;
    state.loadError = null;
  } catch (e) {
    state.loadError = navigator.onLine ? e.message : "オフラインです。電波の良い場所で ↻ を押してください。";
  } finally {
    btn.classList.remove("spin");
  }
  renderAll();
  checkTargetsAndNotify();
}

// ---------- 共通表示 ----------
function timeText(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  const ago = mins < 1 ? "たった今" : mins < 60 ? `${mins}分前` : mins < 1440 ? `${Math.floor(mins / 60)}時間前` : `${Math.floor(mins / 1440)}日前`;
  const md = d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${md}（${ago}）`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderNotice() {
  const el = $("#notice");
  let msg = "";
  if (state.loadError) msg = `データを読み込めませんでした：${state.loadError}`;
  else if (state.prices?.mode === "sample") msg = "いま表示している価格は【サンプル】です。実際の価格ではありません。各サイトのキーを登録すると実価格と商品画像に切り替わります（README 参照）。";
  else if (state.prices?.mode === "error") msg = "価格を1件も取得できませんでした。各商品の「状態」を確認してください。";
  else if (state.prices && Date.now() - new Date(state.prices.generatedAt) > STALE_HOURS * 3600e3) msg = `最後の取得から${STALE_HOURS}時間以上たっています。GitHub の Actions が止まっていないか確認してください。`;
  el.hidden = !msg;
  el.textContent = msg;
}

// ---------- セールの状態 ----------
function saleStatus(s, now = Date.now()) {
  const st = new Date(s.start).getTime(), en = new Date(s.end).getTime();
  if (now < st) return { kind: "soon", ms: st - now };
  if (now <= en) return { kind: "live", ms: en - now };
  return { kind: "ended", ms: 0 };
}
function countdown(ms) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}日 ${h}時間 ${mm}分` : `${h}時間 ${mm}分`;
}
function fmtRange(s) {
  const o = { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" };
  return `${new Date(s.start).toLocaleString("ja-JP", o)} 〜 ${new Date(s.end).toLocaleString("ja-JP", o)}`;
}

function renderSaleBanner() {
  const el = $("#sale-banner");
  const live = state.sales.find((s) => saleStatus(s).kind === "live");
  const next = state.sales.filter((s) => saleStatus(s).kind === "soon").sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const s = live || next;
  el.hidden = !s;
  if (!s) return;
  const st = saleStatus(s);
  el.classList.toggle("live", st.kind === "live");
  el.innerHTML = st.kind === "live"
    ? `<b>開催中</b>　${esc(s.shop)} ${esc(s.name)}　終了まで ${countdown(st.ms)}`
    : `次のセール　${esc(s.shop)} ${esc(s.name)}　開始まで <b>${countdown(st.ms)}</b>`;
}

function renderSales() {
  const list = [...state.sales].sort((a, b) => new Date(a.start) - new Date(b.start));
  $("#sales").innerHTML = list.length ? list.map((s) => {
    const st = saleStatus(s);
    const label = st.kind === "live" ? `開催中・終了まで ${countdown(st.ms)}` : st.kind === "soon" ? `開始まで ${countdown(st.ms)}` : "終了しました";
    return `<div class="sale ${st.kind}">
      <div class="meta">${esc(s.shop)}</div>
      <div class="name">${esc(s.name)}</div>
      <div class="when">${fmtRange(s)}</div>
      <div class="count">${label}</div>
      ${s.note ? `<p>${esc(s.note)}</p>` : ""}
      ${s.url ? `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">セール会場を開く</a></p>` : ""}
    </div>`;
  }).join("") : `<p class="hint">登録されたセールはありません。</p>`;
}

// ---------- 2) 商品画面 ----------
function storeRow(key, s, isSample, p, links) {
  const name = STORE_NAMES[key];
  if (!s) return "";
  if (s.status === "ok" || s.status === "sample") {
    const extra = [s.shop, s.shipping].filter(Boolean).join("・");
    return `<li><span class="sname">${name}</span>
      <span class="sinfo"><span class="sprice ${isSample ? "sample" : ""}">${yen(s.price)}</span>${isSample ? ' <span class="badge sample">サンプル</span>' : ""}<small>${esc(extra)}</small></span>
      <a class="go" href="${esc(s.url)}" target="_blank" rel="noopener">${isSample ? "検索" : "販売ページ"}</a></li>`;
  }
  // Amazon（無料版）：価格は自動取得せず、Amazon と Keepa（無料の価格推移サイト）へのボタンを出す
  if (key === "amazon" && s.status === "free_link") {
    const keepa = links?.keepa || `https://keepa.com/#!search/5-${encodeURIComponent(p.name)}`;
    return `<li><span class="sname">${name}</span>
      <span class="sinfo"><span class="msg">価格は Keepa で確認</span><small>無料・値動きも見られます</small></span>
      <span class="acts"><a class="go ghost" href="${esc(keepa)}" target="_blank" rel="noopener">Keepa</a><a class="go" href="${esc(s.url)}" target="_blank" rel="noopener">Amazon</a></span></li>`;
  }
  // 価格が無いときも、その店の検索ページへは行けるようにする
  const url = s.url || links?.[key];
  const err = s.status === "error";
  return `<li><span class="sname">${name}</span>
    <span class="sinfo"><span class="msg ${err ? "err" : ""}">${esc(s.message || "取得できませんでした")}</span></span>
    ${url ? `<a class="go ghost" href="${esc(url)}" target="_blank" rel="noopener">検索</a>` : "<span></span>"}</li>`;
}

function productImage(p, d) {
  return d?.image
    ? `<img class="thumb" src="${esc(d.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb ph',textContent:'${esc(p.brand)}'}))">`
    : `<div class="thumb ph">${esc(p.brand)}</div>`;
}

function renderProducts() {
  const box = $("#products");
  if (!state.products.length) {
    box.innerHTML = `<div class="card"><p>商品データがありません。${state.loadError ? esc(state.loadError) : ""}</p></div>`;
    return;
  }
  const isSample = state.prices?.mode === "sample";
  box.innerHTML = state.products.map((p) => {
    const d = state.prices?.products?.[p.id];
    const target = targetOf(p);
    const best = d?.best;
    const hit = best && !isSample && best.price <= target;
    let targetText = `目標 ${yen(target)}`;
    if (best && isSample) targetText += "　（サンプルのため判定しません）";
    else if (best) targetText += hit ? "　→ 目標達成！" : `　→ あと ${yen(best.price - target)}`;
    let diff = "";
    if (!isSample && best && d.previousBest) {
      const delta = best.price - d.previousBest;
      if (delta < 0) diff = `<span class="down">↓ 前回より ${yen(-delta)} 安い</span>`;
      else if (delta > 0) diff = `<span class="up">↑ 前回より ${yen(delta)} 高い</span>`;
      else diff = "前回から変化なし";
    }
    if (!isSample && d?.lowest) diff += `${diff ? "　・　" : ""}記録上の最安 ${yen(d.lowest.price)}（${STORE_NAMES[d.lowest.store]}）`;
    const stale = d && Date.now() - new Date(d.fetchedAt) > STALE_HOURS * 3600e3;
    const badge = !best ? '<span class="badge err">価格なし</span>' : isSample ? '<span class="badge sample">サンプル価格</span>' : `<span class="badge real">実価格・${STORE_NAMES[best.store]}</span>`;
    return `<article class="card ${hit ? "hit" : ""}">
      <div class="head">
        ${productImage(p, d)}
        <div class="head-text">
          <div class="meta">${esc(p.brand)} ・ ${esc(p.kind)}</div>
          <div class="name">${esc(p.name)}</div>
          <div class="price-line"><span class="price ${isSample ? "sample" : ""}">${best ? yen(best.price) : "—"}</span>${badge}</div>
        </div>
      </div>
      <div class="target ${hit ? "hit" : ""}">${targetText}</div>
      ${diff ? `<div class="diff">${diff}</div>` : ""}
      <ul class="stores">
        ${["amazon", "rakuten", "yahoo"].map((k) => storeRow(k, d?.stores?.[k], isSample, p, d?.links)).join("")}
      </ul>
      <div class="fetched ${stale ? "stale" : ""}">取得：${d ? timeText(d.fetchedAt) : "まだ取得していません"}${stale ? "　※古い情報です" : ""}</div>
    </article>`;
  }).join("");
}

// ---------- 4) 設定画面 ----------
function renderTargetsForm() {
  const form = $("#targets-form");
  form.innerHTML = state.products.map((p) => `
    <div class="t-row">
      <label for="t-${p.id}">${esc(p.name)}<small>初期値 ${yen(p.target)}</small></label>
      <span class="t-input"><input id="t-${p.id}" name="${p.id}" type="number" inputmode="numeric" min="1" step="100" value="${targetOf(p)}">円</span>
    </div>`).join("") + `
    <div class="row-btns">
      <button type="submit" class="btn">保存する</button>
      <button type="button" id="t-reset" class="btn ghost">初期値に戻す</button>
      <span id="t-saved" class="saved" hidden>保存しました</span>
    </div>`;
  $("#t-reset").onclick = () => {
    save(LS.targets, {});
    renderTargetsForm();
    flashSaved("初期値に戻しました");
    renderProducts();
  };
}
function flashSaved(text) {
  const el = $("#t-saved");
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2500);
}
$("#targets-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const targets = {};
  for (const p of state.products) {
    const v = Math.round(Number($(`#t-${p.id}`).value));
    if (!Number.isFinite(v) || v <= 0) {
      alert(`「${p.name}」の目標価格は 1 以上の数字で入力してください。`);
      return;
    }
    targets[p.id] = v;
  }
  if (!save(LS.targets, targets)) {
    alert("保存できませんでした。ブラウザのシークレットモードでは保存できない場合があります。");
    return;
  }
  flashSaved("保存しました");
  renderProducts();
  checkTargetsAndNotify();
});

function renderDataInfo() {
  const pr = state.prices;
  const mode = { live: "実価格", sample: "サンプル価格", error: "取得エラー" }[pr?.mode] || "不明";
  $("#data-info").textContent = pr ? `データ：${mode}　／　最終取得：${timeText(pr.generatedAt)}` : "データ：未読み込み";
}

// ---------- 5) 通知 ----------
function notifySupported() { return "Notification" in window && "serviceWorker" in navigator; }
function renderNotifyStatus() {
  const el = $("#notify-status");
  if (!notifySupported()) {
    el.textContent = "このブラウザは通知に対応していません。iPhone の場合は「ホーム画面に追加」してから開いてください。";
    $("#notify-allow").disabled = true;
    return;
  }
  const p = Notification.permission;
  el.textContent = p === "granted" ? "通知：オン" : p === "denied" ? "通知：ブロックされています（ブラウザのサイト設定から「通知」を許可に変えてください）" : "通知：まだ許可されていません";
  $("#notify-allow").disabled = p !== "default";
}
async function showNotice(title, body, url) {
  if (!notifySupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url }, tag: title });
    return true;
  } catch {
    try { new Notification(title, { body, icon: "icons/icon-192.png" }); return true; } catch { return false; }
  }
}
$("#notify-allow").onclick = async () => {
  if (!notifySupported()) return;
  await Notification.requestPermission();
  renderNotifyStatus();
};
$("#notify-test").onclick = async () => {
  const ok = await showNotice("テスト通知", "Price Watch シンプルshiro_AI の通知は正常です。", location.href);
  if (!ok) alert("通知を表示できませんでした。先に「通知を許可する」を押してください。");
};

// 目標価格以下になった商品を通知（同じ価格では繰り返さない。目標を上回ったら記録をリセット）
async function checkTargetsAndNotify() {
  const pr = state.prices;
  if (!pr || pr.mode !== "live") return;
  const notified = load(LS.notified, {});
  for (const p of state.products) {
    const d = pr.products?.[p.id];
    const best = d?.best;
    if (!best) continue;
    const target = targetOf(p);
    if (best.price <= target) {
      if (notified[p.id] == null || best.price < notified[p.id]) {
        const sent = await showNotice(`目標価格に到達：${p.name}`, `${STORE_NAMES[best.store]}で ${yen(best.price)}（目標 ${yen(target)}）`, d.stores[best.store]?.url || location.href);
        if (sent) notified[p.id] = best.price;
      }
    } else {
      delete notified[p.id];
    }
  }
  save(LS.notified, notified);
}

// ---------- 6) 動作チェック ----------
$("#run-check").onclick = async () => {
  const out = $("#check-result");
  out.innerHTML = "<li>チェック中…</li>";
  const items = [];
  const add = (ok, title, hint = "") => items.push(`<li>${ok === true ? "✅" : ok === "warn" ? "⚠️" : "❌"} ${title}${hint ? `<small>${hint}</small>` : ""}</li>`);

  add(navigator.onLine, navigator.onLine ? "インターネットに接続しています" : "オフラインです", navigator.onLine ? "" : "Wi-Fi やモバイル通信を確認してください。");
  try {
    const t = Date.now();
    await getJson("data/prices.json");
    add(true, `価格データを読み込めました（${Date.now() - t}ミリ秒）`);
  } catch (e) {
    add(false, "価格データを読み込めません", esc(e.message));
  }
  const pr = state.prices;
  if (pr) {
    if (pr.mode === "sample") add("warn", "表示中の価格はサンプルです", "GitHub の Secrets に各サイトのキーを登録すると実価格になります。");
    else if (pr.mode === "error") add(false, "前回の取得で価格を1件も取れませんでした", "下の各サイトの結果を確認してください。");
    else add(true, `実価格を取得済み（${timeText(pr.generatedAt)}）`);
    const fresh = Date.now() - new Date(pr.generatedAt) < STALE_HOURS * 3600e3;
    add(fresh ? true : "warn", fresh ? "取得は定期的に動いています" : "取得が2時間以上止まっています", fresh ? "" : "GitHub の Actions タブで失敗していないか確認してください。");
    for (const key of ["rakuten", "yahoo"]) {
      const sts = state.products.map((p) => pr.products?.[p.id]?.stores?.[key]?.status);
      const okN = sts.filter((s) => s === "ok").length;
      const msg = state.products.map((p) => pr.products?.[p.id]?.stores?.[key]).find((s) => s?.message)?.message || "";
      if (pr.mode === "sample") continue;
      add(okN > 0 ? true : sts.includes("not_configured") ? "warn" : false, `${STORE_NAMES[key]}：${okN}/${sts.length} 商品の価格を取得`, okN === sts.length ? "" : esc(msg));
    }
  }
  const saved = save("pw.check", Date.now());
  add(saved, saved ? "この端末に設定を保存できます" : "設定を保存できません", saved ? "" : "シークレットモードを使っていないか確認してください。");
  if (notifySupported()) add(Notification.permission === "granted" ? true : "warn", `通知の許可：${{ granted: "許可済み", denied: "ブロック中", default: "未設定" }[Notification.permission]}`, Notification.permission === "granted" ? "" : "上の「通知を許可する」を押してください。");
  else add("warn", "このブラウザでは通知が使えません");
  const swOk = "serviceWorker" in navigator && !!(await navigator.serviceWorker.getRegistration().catch(() => null));
  add(swOk ? true : "warn", swOk ? "アプリとしてインストールできる状態です（PWA）" : "PWAの準備ができていません", swOk ? "" : "GitHub Pages（https）で開くと有効になります。");
  const installed = matchMedia("(display-mode: standalone)").matches;
  add(installed ? true : "warn", installed ? "ホーム画面から起動しています" : "ブラウザで開いています", installed ? "" : "Chrome のメニュー「︙」→「ホーム画面に追加」（PCはアドレスバー右のインストールアイコン）で、アプリのように使えます。");
  out.innerHTML = items.join("");
};

// ---------- 画面切り替え ----------
function show(view) {
  for (const v of ["products", "sales", "settings"]) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "settings") { renderTargetsForm(); renderNotifyStatus(); renderDataInfo(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => show(b.dataset.view)));
$("#refresh").onclick = loadAll;

function renderAll() {
  renderNotice();
  renderSaleBanner();
  renderSales();
  renderProducts();
  if (!$("#view-settings").hidden) renderDataInfo();
}

// ---------- 起動 ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* プレビュー環境などでは登録できないことがある */ });
}
loadAll();
setInterval(() => { if (document.visibilityState === "visible") loadAll(); }, REFRESH_MINUTES * 60000);
setInterval(renderSaleBanner, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadAll(); });
