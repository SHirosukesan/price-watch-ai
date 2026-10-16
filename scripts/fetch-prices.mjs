// Price Watch シンプルshiro_AI — 価格取得スクリプト
// GitHub Actions から30分ごとに実行され、data/prices.json を作ります。
// 追加ライブラリは不要です（Node.js 20 以上の標準機能だけで動きます）。
//
// 使うキー（GitHub の Secrets に保存。コードには書かない）:
//   RAKUTEN_APP_ID      楽天のアプリID
//   RAKUTEN_ACCESS_KEY  楽天のアクセスキー
//   YAHOO_APP_ID        Yahoo! の Client ID
//   KEEPA_API_KEY       （任意・有料）Keepa の APIキー。入れると Amazon の価格も取得
//   NTFY_TOPIC          （任意）スマホ通知アプリ ntfy のトピック名
//
// 手元で試す:  node scripts/fetch-prices.mjs
//   キーが1つもない場合は「サンプル価格」を書き出します。

import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const PRODUCTS_FILE = new URL("data/products.json", ROOT);
const OUTPUT_FILE = new URL("data/prices.json", ROOT);

const env = process.env;
const RAKUTEN_URL = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";
const YAHOO_URL = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";
const KEEPA_URL = "https://api.keepa.com";
const KEEPA_JAPAN = 5; // Keepa での amazon.co.jp の番号

// 楽天は「登録したWebサイトURL」からの呼び出しかを確認するため、Referer を付けます。
function siteUrl() {
  if (env.SITE_URL) return env.SITE_URL;
  const repo = env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.split("/");
  return owner ? `https://${owner.toLowerCase()}.github.io/${name}/` : "https://example.github.io/";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 商品名の表記ゆれをそろえる（全角→半角、大文字化、空白・ハイフン削除）
export function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-‐−–—_・]/g, "");
}

// 本体の新品だけを残すための判定
export function isMatch(product, title, price, excludeWords) {
  const n = normalize(title);
  if (!price || price < product.minPrice) return false;
  if (!product.mustAll.every((w) => n.includes(normalize(w)))) return false;
  if (product.mustAny.length && !product.mustAny.some((w) => n.includes(normalize(w)))) return false;
  if (excludeWords.some((w) => n.includes(normalize(w)))) return false;
  return true;
}

function errorMessage(store, status, body) {
  const s = { rakuten: "楽天", yahoo: "Yahoo!", amazon: "Amazon(Keepa)" }[store];
  if (store === "amazon") {
    if (status === 400 || status === 401 || status === 403) return "Amazon(Keepa)：APIキーが正しくないか、APIの契約が有効ではありません";
    if (status === 402) return "Amazon(Keepa)：APIの支払いが確認できません（契約が切れている可能性）";
    if (status === 429) return "Amazon(Keepa)：トークン不足です。次回の取得で回復します";
  }
  if (status === 400) return `${s}：検索条件が正しくありません（${body?.error_description || "400"}）`;
  if (status === 401 || status === 403) {
    return store === "rakuten"
      ? "楽天：キーが違うか、楽天に登録した「WebサイトURL」がアプリのURLと一致しません"
      : "Yahoo!：Client ID が正しくありません";
  }
  if (status === 404) return `${s}：該当する商品が見つかりませんでした`;
  if (status === 429) return `${s}：アクセスが多すぎるため一時的に制限されています。次回の取得で回復します`;
  if (status >= 500) return `${s}：相手側のサーバーが混雑またはメンテナンス中です`;
  return `${s}：取得に失敗しました（コード ${status}）`;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "PriceWatch-shiro_AI/1.0", ...headers } });
  let body = null;
  try { body = await res.json(); } catch { /* 本文がJSONでない */ }
  return { ok: res.ok, status: res.status, body };
}

async function searchRakuten(product, excludeWords) {
  const found = [];
  const seen = []; // 診断用：楽天が返した件数と商品名（条件に合わなかった理由を調べるため）
  for (const q of product.queries) {
    const params = new URLSearchParams({
      applicationId: env.RAKUTEN_APP_ID,
      accessKey: env.RAKUTEN_ACCESS_KEY,
      keyword: q,
      NGKeyword: "中古 ケース カバー イヤーパッド",
      minPrice: String(product.minPrice),
      sort: "+itemPrice",
      hits: "30",
      availability: "1",
      formatVersion: "2",
      elements: "itemName,itemPrice,itemUrl,shopName,postageFlag,mediumImageUrls",
    });
    const r = await getJson(`${RAKUTEN_URL}?${params}`, { Referer: siteUrl(), Origin: new URL(siteUrl()).origin });
    await sleep(1200);
    if (!r.ok) {
      if (r.status === 404) { seen.push(`「${q}」404:${r.body?.error_description || ""}`); continue; }
      return { status: "error", message: errorMessage("rakuten", r.status, r.body) };
    }
    // 楽天の返事は「Items」「items」のどちらの書き方でも読めるようにする（形式の違いを吸収）
    const raw = r.body?.Items || r.body?.items || [];
    const items = raw.map((x) => x?.Item || x?.item || x);
    if (!raw.length) seen.push(`返事の項目:${Object.keys(r.body || {}).join(",")}`);
    seen.push(`「${q}」${items.length}件 例:${items.slice(0, 2).map((i) => `${String(i.itemName).slice(0, 40)}(${i.itemPrice})`).join(" / ")}`);
    for (const it of items) {
      if (isMatch(product, it.itemName, it.itemPrice, excludeWords)) {
        found.push({ price: it.itemPrice, title: it.itemName, url: it.itemUrl, shop: it.shopName, shipping: it.postageFlag === 0 ? "送料込み" : "送料別", image: rakutenImage(it.mediumImageUrls) });
      }
    }
  }
  const res = pickCheapest(found, "楽天");
  if (res.status === "not_found" && env.GITHUB_ACTIONS) console.log(`::warning title=楽天の診断 ${product.name}::${seen.join(" ｜ ")}`);
  return res;
}

async function searchYahoo(product, excludeWords) {
  const found = [];
  for (const q of product.queries) {
    const params = new URLSearchParams({
      appid: env.YAHOO_APP_ID,
      query: q,
      price_from: String(product.minPrice),
      sort: "+price",
      results: "30",
      in_stock: "true",
      condition: "new",
      image_size: "300",
    });
    const r = await getJson(`${YAHOO_URL}?${params}`);
    await sleep(1200);
    if (!r.ok) return { status: "error", message: errorMessage("yahoo", r.status, r.body) };
    for (const it of r.body?.hits || []) {
      if (isMatch(product, it.name, it.price, excludeWords)) {
        const code = it.shipping?.code;
        found.push({ price: it.price, title: it.name, url: it.url, shop: it.seller?.name || "", shipping: code === 2 ? "送料無料" : code === 3 ? "条件付き送料無料" : "送料は販売ページで確認", image: it.exImage?.url || it.image?.medium || "" });
      }
    }
  }
  return pickCheapest(found, "Yahoo!");
}

// 楽天の画像は128px。URLの _ex=128x128 を 300x300 に変えると大きい画像になる
function rakutenImage(urls) {
  const first = Array.isArray(urls) ? urls[0] : null;
  const u = typeof first === "string" ? first : first?.imageUrl;
  return u ? u.replace(/_ex=\d+x\d+/, "_ex=300x300") : "";
}

// ---------- Amazon（Keepa API。規約内で Amazon の価格を取る手段） ----------
// 1回目だけ商品検索で ASIN（Amazonの商品番号）を探し、以降は保存した ASIN で価格だけ取る。
async function findAmazonAsins(product, excludeWords) {
  const asins = [];
  for (const q of product.queries) {
    const params = new URLSearchParams({ key: env.KEEPA_API_KEY, domain: String(KEEPA_JAPAN), type: "product", term: q });
    const r = await getJson(`${KEEPA_URL}/search?${params}`);
    if (!r.ok) return { error: errorMessage("amazon", r.status, r.body) };
    for (const it of r.body?.products || []) {
      if (it.asin && isMatch(product, it.title, product.minPrice, excludeWords) && !asins.includes(it.asin)) asins.push(it.asin);
    }
    if (asins.length) break;
  }
  return { asins: asins.slice(0, 5) };
}

async function searchAmazon(product, excludeWords, cachedAsins) {
  let asins = cachedAsins;
  if (!asins?.length) {
    const f = await findAmazonAsins(product, excludeWords);
    if (f.error) return { status: "error", message: f.error };
    asins = f.asins;
  }
  if (!asins.length) return { status: "not_found", message: "Amazon：条件に合う商品が見つかりませんでした" };
  const params = new URLSearchParams({ key: env.KEEPA_API_KEY, domain: String(KEEPA_JAPAN), asin: asins.join(","), stats: "1", update: "1" });
  const r = await getJson(`${KEEPA_URL}/product?${params}`);
  if (!r.ok) return { status: "error", message: errorMessage("amazon", r.status, r.body), asins };
  const found = [];
  for (const it of r.body?.products || []) {
    const cur = it.stats?.current || [];
    const url = `https://www.amazon.co.jp/dp/${it.asin}`;
    const image = it.imagesCSV ? `https://m.media-amazon.com/images/I/${it.imagesCSV.split(",")[0]}` : "";
    // 0 = Amazon が販売、1 = マーケットプレイス新品。-1 は在庫なし
    if (cur[0] > 0 && isMatch(product, it.title, cur[0], excludeWords)) found.push({ price: cur[0], title: it.title, url, shop: "Amazon.co.jp 販売", shipping: "", image });
    if (cur[1] > 0 && isMatch(product, it.title, cur[1], excludeWords)) found.push({ price: cur[1], title: it.title, url, shop: "他の出品者（新品）", shipping: "", image });
  }
  const res = pickCheapest(found, "Amazon");
  return { ...res, asins };
}

function pickCheapest(found, label) {
  if (!found.length) return { status: "not_found", message: `${label}：条件に合う新品が見つかりませんでした` };
  found.sort((a, b) => a.price - b.price);
  return { status: "ok", ...found[0] };
}

const searchLinks = (q) => ({
  amazon: `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}`,
  rakuten: `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(q)}/`,
  yahoo: `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(q)}`,
  keepa: `https://keepa.com/#!search/5-${encodeURIComponent(q)}`, // Amazon の現在価格と推移を無料で見られる
});

// 前回の結果（公開中のサイト → 手元のファイルの順に探す）
async function loadPrevious() {
  try {
    const res = await fetch(`${siteUrl()}data/prices.json?t=${Date.now()}`);
    if (res.ok) return await res.json();
  } catch { /* 初回は無い */ }
  try { return JSON.parse(await readFile(OUTPUT_FILE, "utf8")); } catch { return null; }
}

// キーが1つも無いときの見本データ（画面確認用。実価格ではありません）
function samplePrices(products) {
  const now = new Date().toISOString();
  const out = {};
  const factors = [1.04, 0.97, 1.12, 1.02];
  products.forEach((p, i) => {
    const base = Math.round((p.target * factors[i % factors.length]) / 10) * 10;
    out[p.id] = {
      stores: {
        rakuten: { status: "sample", price: base, title: `${p.name}（サンプル）`, url: searchLinks(p.queries[0]).rakuten, shop: "", shipping: "" },
        yahoo: { status: "sample", price: base + 1200, title: `${p.name}（サンプル）`, url: searchLinks(p.queries[0]).yahoo, shop: "", shipping: "" },
        amazon: { status: "free_link", url: searchLinks(p.queries[0]).amazon, message: "Amazon の価格は Keepa（無料）で確認できます" },
      },
      best: { store: "rakuten", price: base },
      links: searchLinks(p.queries[0]),
      fetchedAt: now,
    };
  });
  return { generatedAt: now, mode: "sample", products: out };
}

async function notify(title, message, clickUrl) {
  if (!env.NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: "POST",
      body: message,
      headers: { Title: encodeURIComponent(title), Click: clickUrl, Tags: "chart_with_downwards_trend", "X-Title-Encoding": "url" },
    });
  } catch (e) {
    console.log("通知の送信に失敗:", e.message);
  }
}

export async function main() {
  const { products, excludeWords } = JSON.parse(await readFile(PRODUCTS_FILE, "utf8"));
  const hasRakuten = !!(env.RAKUTEN_APP_ID && env.RAKUTEN_ACCESS_KEY);
  const hasYahoo = !!env.YAHOO_APP_ID;
  const hasKeepa = !!env.KEEPA_API_KEY;

  if (!hasRakuten && !hasYahoo && !hasKeepa) {
    console.log("キーが未設定のため、サンプル価格を書き出します。");
    await writeFile(OUTPUT_FILE, JSON.stringify(samplePrices(products), null, 2) + "\n");
    return;
  }

  const previous = await loadPrevious();
  const result = { generatedAt: new Date().toISOString(), mode: "live", products: {} };

  for (const p of products) {
    const links = searchLinks(p.queries[0]);
    const stores = {};
    stores.rakuten = hasRakuten
      ? await searchRakuten(p, excludeWords).catch((e) => ({ status: "error", message: `楽天：通信エラー（${e.message}）` }))
      : { status: "not_configured", message: "楽天のキーが未設定です（README の手順を参照）" };
    stores.yahoo = hasYahoo
      ? await searchYahoo(p, excludeWords).catch((e) => ({ status: "error", message: `Yahoo!：通信エラー（${e.message}）` }))
      : { status: "not_configured", message: "Yahoo! のキーが未設定です（README の手順を参照）" };
    const prevLive = previous?.mode !== "sample" ? previous?.products?.[p.id] : null;
    stores.amazon = hasKeepa
      ? await searchAmazon(p, excludeWords, prevLive?.stores?.amazon?.asins).catch((e) => ({ status: "error", message: `Amazon(Keepa)：通信エラー（${e.message}）` }))
      : { status: "free_link", message: "Amazon の価格は Keepa（無料）で確認できます", url: links.amazon };

    const okStores = Object.entries(stores).filter(([, s]) => s.status === "ok");
    okStores.sort((a, b) => a[1].price - b[1].price);
    const best = okStores.length ? { store: okStores[0][0], price: okStores[0][1].price } : null;

    // 前回比と、これまでの最安値（前回が実価格のときだけ比較）
    const prev = previous?.mode !== "sample" ? previous?.products?.[p.id] : null;
    const previousBest = prev?.best?.price ?? null;
    let lowest = prev?.lowest ?? null;
    if (best && (!lowest || best.price < lowest.price)) lowest = { price: best.price, store: best.store, at: result.generatedAt };

    // 商品画像：最安の店の画像 → 他の店の画像 → 前回の画像 の順に使う
    const image = stores.yahoo.image || stores.rakuten.image || stores.amazon.image || prev?.image || previous?.products?.[p.id]?.image || "";

    result.products[p.id] = { stores, best, previousBest, lowest, image, links, fetchedAt: result.generatedAt };

    if (best && previousBest && best.price < previousBest) {
      const storeName = { rakuten: "楽天", yahoo: "Yahoo!", amazon: "Amazon" }[best.store];
      const hit = best.price <= p.target ? `（初期目標 ${p.target.toLocaleString()}円 以下！）` : "";
      await notify(`値下がり：${p.name}`, `${storeName}で ${best.price.toLocaleString()}円（前回 ${previousBest.toLocaleString()}円）${hit}`, stores[best.store].url);
    }
    // GitHub の実行画面に結果のメモを出す（キーは含まない）
    if (env.GITHUB_ACTIONS) {
      const fmt = (st) => st.status === "ok" ? `${st.price}円` : (st.message || st.status);
      const level = [stores.rakuten, stores.yahoo].some((st) => st.status === "error") ? "warning" : "notice";
      console.log(`::${level} title=${p.name}::楽天=${fmt(stores.rakuten)} / Yahoo!=${fmt(stores.yahoo)}`);
    }
    console.log(`${p.name}: Amazon=${stores.amazon.price ?? stores.amazon.status} / 楽天=${stores.rakuten.price ?? stores.rakuten.status} / Yahoo!=${stores.yahoo.price ?? stores.yahoo.status}`);
  }

  const anyOk = Object.values(result.products).some((x) => x.best);
  if (!anyOk) result.mode = "error";
  await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("価格取得で予期しないエラー:", e);
    process.exit(1);
  });
}
