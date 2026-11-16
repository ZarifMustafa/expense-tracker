// Price search on Daraz and Bikroy, with filtering that keeps only the exact product asked for.
//
// Daraz:  https://www.daraz.com.bd/catalog/?ajax=true&q=...  returns the search page's JSON.
//         When Daraz blocks plain requests (bot check), we load the search page in a hidden
//         browser window and run the same request from inside it, with the page's cookies.
// Bikroy: https://bikroy.com/api_web/v1/listing?query=...      public JSON listing API.
const { GROQ_MODEL, answerText } = require('./groq');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 40 items per page. Relevance alone is often all accessories, so also take the most popular items.
const DARAZ_REQUESTS = [{ page: 1, sort: '' }, { page: 2, sort: '' }, { page: 1, sort: 'popularity' }];
const BIKROY_PAGES = 3;  // 14 items per page

// Inside Electron use its Chromium network stack; in plain Node (tests) use global fetch.
function getFetch() {
  try {
    const electron = require('electron');
    if (electron && typeof electron === 'object' && electron.net) return electron.net.fetch.bind(electron.net);
  } catch {}
  return fetch;
}

async function getJson(url) {
  const res = await getFetch()(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try { return JSON.parse(text); } catch { throw new Error('Not JSON (probably a bot check page)'); }
}

// Fallback for Daraz: open the search page in a hidden window, then fetch the JSON from inside it.
async function getJsonViaPage(pageUrl, jsonUrl) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:shops', contextIsolation: true } });
  try {
    win.webContents.setUserAgent(UA);
    await win.loadURL(pageUrl);
    const text = await win.webContents.executeJavaScript(
      `fetch(${JSON.stringify(jsonUrl)}, { headers: { Accept: 'application/json' }, credentials: 'include' }).then(r => r.text())`
    );
    try { return JSON.parse(text); } catch { throw new Error('Daraz asked for a human check. Open daraz.com.bd in your browser once, then try again.'); }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function searchDaraz(query) {
  const q = encodeURIComponent(query);
  const pages = await Promise.all(DARAZ_REQUESTS.map(async ({ page, sort }) => {
    const jsonUrl = `https://www.daraz.com.bd/catalog/?ajax=true&q=${q}&page=${page}${sort ? '&sort=' + sort : ''}`;
    let data;
    try { data = await getJson(jsonUrl); }
    catch { data = await getJsonViaPage(`https://www.daraz.com.bd/catalog/?q=${q}`, jsonUrl); }
    return data?.mods?.listItems || [];
  }));
  return pages.flat().map(x => ({
    site: 'daraz',
    id: String(x.itemId || x.nid),
    title: x.name || '',
    price: parseFloat(x.price) || 0,
    originalPrice: parseFloat(String(x.originalPrice || '').replace(/[^\d.]/g, '')) || null,
    url: x.itemUrl ? (x.itemUrl.startsWith('//') ? 'https:' + x.itemUrl : x.itemUrl) : '',
    image: x.image || '',
    location: x.location || '',
    seller: x.sellerName || '',
    condition: 'New',
    inStock: x.inStock !== false
  }));
}

async function searchBikroy(query) {
  const q = encodeURIComponent(query);
  const pages = await Promise.all(Array.from({ length: BIKROY_PAGES }, (_, i) =>
    getJson(`https://bikroy.com/api_web/v1/listing?query=${q}&page=${i + 1}`)
      .then(d => d?.adverts_list?.adverts || [])
      .catch(e => { if (i === 0) throw e; return []; })   // later pages may not exist
  ));
  return pages.flat().map(x => ({
    site: 'bikroy',
    id: String(x.guid || x.id),
    title: x.title || '',
    price: x.price_obj?.value || 0,
    originalPrice: null,
    url: x.url ? 'https://bikroy.com' + x.url.split('?')[0] : '',
    image: x.image_obj?.url || '',
    location: x.region_name || '',
    seller: '',
    condition: (x.attrs || []).find(a => a.name === 'Condition')?.value || '',
    inStock: true
  }));
}

/* ------------------------------------------------------------------
   Rule-based filtering (always runs, no API key needed)
   ------------------------------------------------------------------ */

// Words that mark a listing as an accessory or spare part rather than the product itself.
// Words that also show up in real product specs ("battery", "fast charging", "camera lens")
// are deliberately left out; the "for <product>" rule, price check and AI pass catch those.
const ACCESSORY_WORDS = [
  'case', 'cases', 'cover', 'covers', 'protector', 'protective', 'guard', 'tempered', 'film',
  'bumper', 'skin', 'sticker', 'pouch', 'sleeve', 'holder', 'mount', 'strap',
  'charger', 'cable', 'adapter', 'adaptor', 'dock', 'magsafe', 'stylus',
  'spare', 'parts', 'module', 'housing', 'replacement', 'flex',
  'connector', 'motherboard', 'earphone', 'earphones', 'headphone', 'headphones', 'earbuds', 'headset',
  'airpods', 'powerbank', 'tripod', 'gimbal', 'selfie', 'cleaner', 'compatible', 'backdoor', 'folio',
  'wallet', 'dummy', 'empty'
];
// Words that mark a different variant of the same model (e.g. S23 vs S23 Ultra)
const VARIANT_WORDS = ['ultra', 'plus', 'pro', 'max', 'mini', 'lite', 'fe', 'edge', 'neo', 'prime', 'fold', 'flip', 'note', 'se', 'air', 'slim'];
// Tokens with digits that are specs, not model codes
const SPEC_TOKEN = /^(\d+(\.\d+)?(gb|tb|mb|mah|mp|hz|w|mm|inch|in|g|k|p|th|nd|rd|st))$|^[2345]g$|^\d+$/;

// Words sellers use interchangeably
const SYNONYMS = { fridge: 'refrigerator', television: 'tv', notebook: 'laptop', mobile: 'phone', smartphone: 'phone', cellphone: 'phone' };

function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/(\d)\s*\+\s*(\d)/g, '$1 $2')                             // "6+128GB" is RAM+storage, not "Plus"
    .replace(/\+/g, ' plus ')
    .replace(/\b([a-z]{3,})(\d)/g, '$1 $2')                            // "iphone15" -> "iphone 15" (keeps "s23")
    .replace(/(\d)(ultra|plus|pro|max|mini|lite|fe|edge)\b/g, '$1 $2') // "s23ultra" -> "s23 ultra"
    .split(/[^a-z0-9.]+/).map(t => t.replace(/^\.+|\.+$/g, '')).filter(Boolean)
    .map(t => SYNONYMS[t] || t);
}
// Model codes: "s23", "a54", "x1", or a bare model number like the "15" in "iPhone 15"
const isModelToken = t => /\d/.test(t) && (/^\d{2,4}$/.test(t) || (/[a-z]/.test(t) && !SPEC_TOKEN.test(t)));
const modelPrefix = t => (t.match(/^[a-z]*/) || [''])[0];

// Returns { kept, hidden } where hidden items carry a `reason`
function ruleFilter(query, items) {
  const qTokens = tokenize(query);
  const qSet = new Set(qTokens);
  const qModels = qTokens.filter(isModelToken);
  const qWords = qTokens.filter(t => !isModelToken(t) && !VARIANT_WORDS.includes(t));
  const kept = [], hidden = [];

  for (const item of items) {
    const tTokens = tokenize(item.title);
    const tSet = new Set(tTokens);
    let reason = null;

    if (!item.price || item.price <= 0) reason = 'No price';
    else if (qModels.some(m => !tSet.has(m))) reason = 'Different model';
    // With a model code the code already pins the product, so half the other words is enough
    // ("Samsung S23" for "galaxy s23"); without one, every word must match.
    else if (qWords.length && qWords.filter(w => tSet.has(w)).length < (qModels.length ? Math.ceil(qWords.length / 2) : qWords.length)) reason = 'Not a match';
    else if (tTokens.some(t => ACCESSORY_WORDS.includes(t) && !qSet.has(t))) reason = 'Accessory or part';
    else if (tTokens.some((t, i) => t === 'for' && qSet.has(tTokens[i + 1]))) reason = 'Accessory or part'; // "... for iPhone 15"
    else if (qModels.length && tTokens.some(t => VARIANT_WORDS.includes(t) && !qSet.has(t))) reason = 'Other variant';
    else if (qModels.length) {
      // Another model code in the same family (e.g. "S22" in a listing for "S23") means a
      // multi-model accessory or a different phone.
      const prefixes = new Set(qModels.map(modelPrefix));
      if (tTokens.some(t => isModelToken(t) && !qSet.has(t) && prefixes.has(modelPrefix(t)) && modelPrefix(t) !== '')) reason = 'Other model listed';
    }
    (reason ? hidden : kept).push(reason ? { ...item, reason } : item);
  }

  // Drop price outliers far below the typical price: almost always accessories that slipped through
  if (kept.length >= 4) {
    const sorted = kept.map(i => i.price).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].price < median * 0.3) hidden.push({ ...kept.splice(i, 1)[0], reason: 'Price too low for this item' });
    }
  }
  return { kept, hidden };
}

/* ------------------------------------------------------------------
   AI filtering (when a Groq key is saved): catches what the rules miss
   ------------------------------------------------------------------ */
async function aiFilter(query, items, apiKey) {
  if (!apiKey || items.length === 0) return null;
  const list = items.map((it, i) => `${i}: ${it.title} — Tk ${it.price}`).join('\n');
  const res = await getFetch()('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      reasoning_effort: 'none',
      temperature: 0,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `A shopper wants to buy exactly this product: "${query.replace(/"/g, "'")}".
Below are marketplace listings. Return ONLY a JSON array of the index numbers of listings that ARE that exact product.
- Any storage size, colour or condition (new/used) is fine.
- EXCLUDE accessories, cases, covers, screen protectors, chargers, spare parts, boxes.
- EXCLUDE other models or variants (for "Galaxy S23", exclude S23 Ultra, S23 Plus, S23 FE, S22, S24).
- EXCLUDE listings that are clearly not a real sale of the product.

Listings:
${list}

Example answer: [0, 3, 7]`
      }]
    })
  });
  if (!res.ok) return null;
  const text = answerText(await res.json());
  const m = text.match(/\[[\d,\s]*\]/);
  if (!m) return null;
  return new Set(JSON.parse(m[0]).filter(n => Number.isInteger(n)));
}

async function filterResults(query, items, apiKey) {
  const { kept, hidden } = ruleFilter(query, items);
  let usedAI = false;
  let finalKept = kept;
  try {
    const keep = await aiFilter(query, kept, apiKey);
    if (keep) {
      usedAI = true;
      finalKept = [];
      kept.forEach((it, i) => keep.has(i) ? finalKept.push(it) : hidden.push({ ...it, reason: 'AI: not this exact item' }));
    }
  } catch { /* AI is optional; keep rule-based result */ }
  finalKept.sort((a, b) => a.price - b.price);
  return { items: finalKept, hidden, usedAI };
}

// Search both sites and filter. Each site reports its own error so one failing doesn't hide the other.
async function searchAll(query, apiKey) {
  const run = async (fn) => {
    try {
      const raw = await fn(query);
      // De-duplicate (Daraz repeats sponsored items across pages)
      const seen = new Set();
      const unique = raw.filter(i => { const k = i.site + i.id; if (seen.has(k)) return false; seen.add(k); return true; });
      return { ok: true, total: unique.length, ...(await filterResults(query, unique, apiKey)) };
    } catch (e) {
      return { ok: false, error: e.message || String(e), items: [], hidden: [], total: 0 };
    }
  };
  const [daraz, bikroy] = await Promise.all([run(searchDaraz), run(searchBikroy)]);
  const all = [...daraz.items, ...bikroy.items].sort((a, b) => a.price - b.price);
  return { query, checkedAt: new Date().toISOString(), daraz, bikroy, cheapest: all[0] || null };
}

module.exports = { searchAll, searchDaraz, searchBikroy, ruleFilter, tokenize };
