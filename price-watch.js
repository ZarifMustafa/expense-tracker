// Price alerts: periodically searches Daraz/Bikroy for wishlist items that have an alert set,
// and shows a Windows notification when the cheapest exact match is at or below the target.
//
// The alert settings live on each wish item (data file, owned by the renderer):
//   wishItem.priceAlert = { query, below, enabled }
// The results and notification history live in their own file (owned by this module), so the
// background checker never overwrites the renderer's data:
//   price-watch.json = { [wishId]: { checkedAt, query, cheapest, daraz: {...}, bikroy: {...}, notified: { [url]: price } } }
const { app, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { searchAll } = require('./price-search');

const FIRST_CHECK_DELAY_MS = 60 * 1000;   // let the app settle after start
const DEFAULT_INTERVAL_HOURS = 6;

let timer = null;
let running = false;
let onUpdate = () => {};
let readAppData = () => ({});

const storePath = () => path.join(app.getPath('userData'), 'price-watch.json');

function readStore() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return {}; }
}
function writeStore(store) {
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
}

// Keep only what the UI and alerts need (full result lists are only shown live in the search window)
function summarize(result) {
  const site = s => ({
    ok: s.ok, error: s.error || null, total: s.total, matches: s.items.length,
    cheapest: s.items[0] ? pick(s.items[0]) : null
  });
  return { checkedAt: result.checkedAt, query: result.query, cheapest: result.cheapest ? pick(result.cheapest) : null, daraz: site(result.daraz), bikroy: site(result.bikroy) };
}
const pick = i => ({ site: i.site, title: i.title, price: i.price, url: i.url, condition: i.condition });

// Save the outcome of a search for a wish item (from the background check or a manual search)
function recordResult(wishId, result) {
  const store = readStore();
  store[wishId] = { ...(store[wishId] || {}), ...summarize(result) };
  writeStore(store);
  onUpdate();
  return store[wishId];
}

function notify(wish, alert, cheapest) {
  if (!Notification.isSupported()) return;
  const siteName = cheapest.site === 'daraz' ? 'Daraz' : 'Bikroy';
  const n = new Notification({
    title: `Price drop: ${wish.name}`,
    body: `Tk ${Math.round(cheapest.price).toLocaleString('en-US')} on ${siteName} (your target: Tk ${Number(alert.below).toLocaleString('en-US')})\n${cheapest.title}`,
    icon: path.join(__dirname, 'assets', 'icon.png')
  });
  n.on('click', () => { if (cheapest.url) shell.openExternal(cheapest.url); });
  n.show();
}

async function checkWish(wish, apiKey) {
  const alert = wish.priceAlert;
  const result = await searchAll(alert.query || wish.name, apiKey);
  const entry = recordResult(wish.id, result);
  const cheapest = result.cheapest;
  if (alert.enabled !== false && alert.below > 0 && cheapest && cheapest.price <= alert.below) {
    // Notify once per listing per price, so a listing that stays cheap doesn't repeat every check
    const store = readStore();
    const notified = store[wish.id].notified || {};
    if (notified[cheapest.url] !== cheapest.price) {
      notify(wish, alert, cheapest);
      notified[cheapest.url] = cheapest.price;
      store[wish.id].notified = notified;
      writeStore(store);
    }
  }
  return entry;
}

// Check every wish item with an active alert. Returns how many were checked.
async function checkAll() {
  if (running) return 0;
  running = true;
  try {
    const data = readAppData();
    const apiKey = data.settings?.groqApiKey || '';
    const wishes = (data.wishItems || []).filter(w => w.priceAlert && w.priceAlert.enabled !== false && w.priceAlert.below > 0);
    for (const wish of wishes) {
      try { await checkWish(wish, apiKey); } catch (e) { console.error('Price check failed for', wish.name, e); }
    }
    return wishes.length;
  } finally {
    running = false;
  }
}

function hasActiveAlerts() {
  const data = readAppData();
  return (data.wishItems || []).some(w => w.priceAlert && w.priceAlert.enabled !== false && w.priceAlert.below > 0);
}

function schedule() {
  if (timer) clearInterval(timer);
  const hours = Number(readAppData().settings?.priceCheckHours) || DEFAULT_INTERVAL_HOURS;
  timer = setInterval(checkAll, hours * 60 * 60 * 1000);
}

function start(opts) {
  readAppData = opts.readData;
  onUpdate = opts.onUpdate || onUpdate;
  setTimeout(checkAll, FIRST_CHECK_DELAY_MS);
  schedule();
}

function setMeta(key, value) {
  const store = readStore();
  store[key] = value;
  writeStore(store);
}

module.exports = { start, schedule, checkAll, recordResult, readStore, setMeta, hasActiveAlerts };
