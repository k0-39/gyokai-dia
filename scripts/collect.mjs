// BUSTA(バスタ) — collects RSS headlines and writes news.json (run by GitHub Actions)
import { readFile, writeFile } from "node:fs/promises";
const OUT = new URL("../news.json", import.meta.url);

const KAGO_TOPICS =
  /観光|旅行|交通|バス|道路|通行|国道|県道|空港|港|クルーズ|フェリー|鉄道|イベント|祭|インバウンド|宿泊|運休|誘客|ツアー|航路|便/;

const SOURCES = [
  {
    id: "mlit", name: "国土交通省 報道発表", region: "national",
    url: "https://www.mlit.go.jp/pressrelease.rdf", home: "https://www.mlit.go.jp/report/press/",
    filter: (t, l) =>
      /バス|自動車|旅客|運輸|観光|旅行|ホテル|宿泊|空港|航空|鉄道|インバウンド|訪日|運転者/.test(t) || /jidosha|kanko/.test(l),
  },
  { id: "travelvoice", name: "トラベルボイス", region: "national",
    url: "https://www.travelvoice.jp/feed", home: "https://www.travelvoice.jp/" },
  { id: "kankokeizai", name: "観光経済新聞", region: "national",
    url: "https://www.kankokeizai.com/feed/", home: "https://www.kankokeizai.com/" },
  { id: "travelnews", name: "トラベルニュースat", region: "national",
    url: "https://www.travelnews.co.jp/feed", home: "https://www.travelnews.co.jp/" },
  { id: "prtimes", name: "PR TIMES", region: "national",
    url: "https://prtimes.jp/index.rdf", home: "https://prtimes.jp/",
    filter: (t) => /バス|旅行|ツアー|観光|インバウンド|訪日|修学旅行|ホテル|旅館|宿泊|温泉|空港|航空|鉄道|新幹線|クルーズ|フェリー|鹿児島/.test(t) },
  { id: "bestcar", name: "ベストカーWeb", region: "national",
    url: "https://bestcarweb.jp/feed", home: "https://bestcarweb.jp/",
    filter: (t) => /バス|観光|運転士|運転手|旅客/.test(t) },
  { id: "response", name: "レスポンス", region: "national",
    url: "https://response.jp/rss/index.rdf", home: "https://response.jp/",
    filter: (t) => /バス|観光|旅行|運転士|運転手|旅客|運賃|鹿児島/.test(t) },
  { id: "jnto", name: "日本政府観光局(JNTO)", region: "national",
    url: "https://www.jnto.go.jp/news/rss.xml", home: "https://www.jnto.go.jp/",
    filter: (t) => !/入札|公告|採用/.test(t) },
  { id: "qsr", name: "九州地方整備局 記者発表", region: "kagoshima",
    url: "https://www.qsr.mlit.go.jp/nt_list/nt1/rss.xml", home: "https://www.qsr.mlit.go.jp/",
    filter: (t) => /鹿児島|大隅|薩摩|霧島|国道3号|国道10号|国道220号|国道225号|国道226号|国道269号/.test(t) },
  { id: "pref-emergency", name: "鹿児島県 緊急情報", region: "kagoshima",
    url: "http://www.pref.kagoshima.jp/kinkyuu/emergency.xml", home: "https://www.pref.kagoshima.jp/", alert: true },
  { id: "pref", name: "鹿児島県 最新情報", region: "kagoshima",
    url: "http://www.pref.kagoshima.jp/saishin/saishin.xml", home: "https://www.pref.kagoshima.jp/",
    filter: (t) => KAGO_TOPICS.test(t) },
  { id: "city-emergency", name: "鹿児島市 緊急・災害情報", region: "kagoshima",
    url: "https://www.city.kagoshima.lg.jp/kinkyu/kinkyu_saigai.xml", home: "https://www.city.kagoshima.lg.jp/", alert: true },
  { id: "city-kanko", name: "鹿児島市 観光新着", region: "kagoshima",
    url: "https://www.city.kagoshima.lg.jp/shinchaku/kanko_shinchaku.xml", home: "https://www.city.kagoshima.lg.jp/" },
  { id: "city-kanko-pick", name: "鹿児島市 観光注目", region: "kagoshima",
    url: "https://www.city.kagoshima.lg.jp/chumoku/kanko_chumoku.xml", home: "https://www.city.kagoshima.lg.jp/" },
  { id: "kirishima", name: "霧島市 新着情報", region: "kagoshima",
    url: "https://www.city-kirishima.jp/shinchaku.xml", home: "https://www.city-kirishima.jp/",
    filter: (t) => KAGO_TOPICS.test(t) },
  { id: "city", name: "鹿児島市 新着情報", region: "kagoshima",
    url: "https://www.city.kagoshima.lg.jp/shinchaku/shinchaku.xml", home: "https://www.city.kagoshima.lg.jp/",
    filter: (t) => KAGO_TOPICS.test(t) },
];

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1];
  }
  return null;
}

function toIso(raw) {
  if (!raw) return null;
  const d = new Date(decodeEntities(raw));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseFeed(xml, base) {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = decodeEntities(tag(b, ["title"]) || "");
    let link = decodeEntities(tag(b, ["link"]) || "");
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); if (h) link = h[1]; }
    if (!link) { const a = b.match(/rdf:about="([^"]+)"/i); if (a) link = a[1]; }
    const date = toIso(tag(b, ["pubDate", "dc:date", "updated", "published"]));
    if (link) { try { link = new URL(link, base).toString(); } catch { link = ""; } }
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, date });
  }
  return out;
}

function decodeBody(buf, contentType) {
  const head = new TextDecoder("utf-8").decode(buf.slice(0, 200));
  const enc =
    (head.match(/encoding=["']([^"']+)["']/i) || [])[1] ||
    ((contentType || "").match(/charset=([^;\s]+)/i) || [])[1] ||
    "utf-8";
  try { return new TextDecoder(enc.toLowerCase()).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

function categorize(t) {
  if (/行政処分|法改正|省令|告示|公示|制度|予算|規制|監査|通達|条例|改正/.test(t)) return "行政・制度";
  if (/貸切|バス|運転者|乗務員|旅客自動車/.test(t)) return "貸切バス";
  if (/通行止|国道|県道|道路|鉄道|運休|運転再開|新幹線|JR|空港|航空|就航|フェリー|航路|渋滞|交通規制/.test(t)) return "交通・道路";
  if (/インバウンド|訪日|外国人|クルーズ|免税|JNTO|海外/.test(t)) return "インバウンド";
  if (/統計|調査結果|万人|前年比|速報|ランキング|決算/.test(t)) return "統計";
  return "旅行・観光";
}

function isImportant(t) {
  return /行政処分|通行止|全面|運休|欠航|義務|改正|災害|警報|緊急/.test(t);
}

async function fetchSource(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(src.url, {
      headers: { "User-Agent": "BustaNewsBot/1.0 (+headline aggregator)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = decodeBody(await res.arrayBuffer(), res.headers.get("content-type"));
    const all = parseFeed(xml, src.url);
    const items = all
      .filter((e) => !src.filter || src.filter(e.title, e.link))
      .slice(0, 30)
      .map((e) => ({
        title: e.title, link: e.link, date: e.date, source: src.name, sourceId: src.id,
        cat: categorize(e.title), important: src.alert ? true : isImportant(e.title), alert: !!src.alert,
      }));
    items.raw = all.length; // headlines in the feed before filtering (for diagnosis)
    return items;
  } finally { clearTimeout(timer); }
}

const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");
const ALERT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function collectAll() {
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const sources = [];
  const byRegion = { national: [], kagoshima: [] };
  results.forEach((r, i) => {
    const s = SOURCES[i];
    if (r.status === "fulfilled") {
      byRegion[s.region].push(...r.value);
      sources.push({ id: s.id, name: s.name, home: s.home, region: s.region, ok: true, count: r.value.length, raw: r.value.raw });
    } else {
      sources.push({ id: s.id, name: s.name, home: s.home, region: s.region, ok: false, count: 0,
        error: String((r.reason && r.reason.message) || r.reason).slice(0, 120) });
    }
  });

  // National headlines about Kagoshima also appear in the Kagoshima edition.
  const KAGO_WORDS = /鹿児島|桜島|霧島|指宿|奄美|屋久島|種子島|薩摩|大隅|南九州/;
  byRegion.kagoshima.push(...byRegion.national.filter((n) => KAGO_WORDS.test(n.title)));

  // Keep the previous items of a source that failed this time.
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  if (prev) {
    for (const s of sources.filter((x) => !x.ok)) {
      byRegion[s.region].push(...(prev.regions[s.region].items || []).filter((n) => n.sourceId === s.id));
    }
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Remember when each headline was first collected, so the page can mark fresh arrivals as NEW.
  // Items from before this feature existed count as old.
  const firstSeen = new Map();
  if (prev) {
    for (const r of Object.values(prev.regions || {})) {
      for (const n of r.items || []) firstSeen.set(n.link, n.firstSeen || "2000-01-01T00:00:00.000Z");
    }
  }
  // A source collected for the first time does not flood the page with NEW badges.
  const prevSourceIds = new Set(((prev && prev.sources) || []).filter((s) => s.ok).map((s) => s.id));
  const regions = {};
  for (const region of ["national", "kagoshima"]) {
    const seen = new Set();
    const items = byRegion[region]
      .filter((n) => (seen.has(n.link) ? false : (seen.add(n.link), true)))
      .sort(byDateDesc).slice(0, 80)
      .map((n) => Object.assign({}, n, { firstSeen: firstSeen.get(n.link) || (prevSourceIds.has(n.sourceId) ? nowIso : "2000-01-01T00:00:00.000Z") }));
    const alerts = region === "kagoshima"
      ? items.filter((n) => (n.alert || (n.cat === "交通・道路" && n.important)) &&
          (!n.date || now - new Date(n.date).getTime() < ALERT_WINDOW_MS)).slice(0, 6)
      : [];
    regions[region] = { items, alerts };
  }
  const data = { updatedAt: nowIso, regions, sources };
  await writeFile(OUT, JSON.stringify(data));
  return data;
}


const data = await collectAll();
const ok = data.sources.filter((s) => s.ok).length;
console.log(`collected ${ok}/${data.sources.length} sources`);
for (const s of data.sources) console.log(`  ${s.ok ? "OK " : "NG "} ${s.name}: ${s.ok ? s.count + "件" : s.error}`);
