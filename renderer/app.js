/* ============================================================
   CONSTANTS
   ============================================================ */
const COLORS = [
  { name: 'Indigo',  val: '#6366f1' },
  { name: 'Blue',    val: '#3b82f6' },
  { name: 'Teal',    val: '#14b8a6' },
  { name: 'Green',   val: '#22c55e' },
  { name: 'Lime',    val: '#84cc16' },
  { name: 'Yellow',  val: '#eab308' },
  { name: 'Orange',  val: '#f97316' },
  { name: 'Red',     val: '#ef4444' },
  { name: 'Rose',    val: '#f43f5e' },
  { name: 'Pink',    val: '#ec4899' },
  { name: 'Purple',  val: '#a855f7' },
  { name: 'Slate',   val: '#64748b' },
];

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];

const PRIORITIES = ['low', 'medium', 'high'];
const EXPENSE_STATUSES = ['pending', 'in-progress', 'completed'];

const MISC_ID_PREFIX = '__misc__';

/* ============================================================
   STATE
   ============================================================ */
const now = new Date();
let state = {
  page: 'budget',
  budgetMonth: now.getMonth() + 1,
  budgetYear: now.getFullYear(),
  analysisMonth: now.getMonth() + 1,
  analysisYear: now.getFullYear(),
  logsMonth: 0,
  logsYear: 0,
  data: { budgetItems: [], expenses: [], wishItems: [] }
};

/* ============================================================
   DATA LAYER
   ============================================================ */
async function loadData() {
  const d = await window.api.getData();
  state.data = { budgetItems: d.budgetItems || [], expenses: d.expenses || [], wishItems: d.wishItems || [] };
}

async function persist() {
  await window.api.saveData(state.data);
}

async function genId() {
  return await window.api.genId();
}

function getMiscId(month, year) {
  return `${MISC_ID_PREFIX}${year}-${month}`;
}

async function ensureMisc(month, year) {
  const id = getMiscId(month, year);
  if (!state.data.budgetItems.find(b => b.id === id)) {
    state.data.budgetItems.push({
      id,
      name: 'Miscellaneous',
      estimatedCost: 0,
      priority: 'low',
      status: 'pending',
      color: '#64748b',
      month,
      year,
      note: 'Auto-created for uncategorized expenses',
      isSystem: true,
      wishItemId: null
    });
    await persist();
  }
  return id;
}

function getBudgetItems(month, year) {
  return state.data.budgetItems.filter(b => b.month === month && b.year === year);
}

function getExpenses(month, year) {
  if (!month) return [...state.data.expenses];
  return state.data.expenses.filter(e => {
    const d = new Date(e.date);
    return (d.getMonth() + 1) === month && d.getFullYear() === year;
  });
}

function getWishSpent(wishItemId) {
  return state.data.expenses
    .filter(e => e.wishItemId === wishItemId)
    .reduce((s, e) => s + (e.actualCost || 0), 0);
}

function getBudgetActual(budgetItemId) {
  return state.data.expenses
    .filter(e => e.budgetItemId === budgetItemId)
    .reduce((s, e) => s + (e.actualCost || 0), 0);
}

function getWishItem(id) { return state.data.wishItems.find(w => w.id === id); }
function getBudgetItem(id) { return state.data.budgetItems.find(b => b.id === id); }

/* ============================================================
   UI HELPERS
   ============================================================ */
function fmtCurrency(n) {
  if (n == null || isNaN(n)) return 'Tk 0';
  return 'Tk ' + Number(n).toLocaleString('en-IN');
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function colorBadge(text, color, extraClass = '') {
  const safe = color || '#64748b';
  return `<span class="badge badge-color ${extraClass}" style="background:${safe}">${escHtml(text)}</span>`;
}

function priorityBadge(p) {
  return `<span class="badge badge-priority-${p}">${p.charAt(0).toUpperCase()+p.slice(1)}</span>`;
}

function statusBadge(s) {
  return `<span class="badge badge-status-${s}">${s.replace('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function colorPickerHtml(selectedColor, name) {
  return `<div class="color-picker" data-picker="${name}">
    ${COLORS.map(c => `<div class="color-swatch${c.val===selectedColor?' selected':''}"
      style="background:${c.val}" data-color="${c.val}" data-picker="${name}" title="${c.name}"></div>`).join('')}
  </div>`;
}

function monthYearOptions(selMonth, selYear) {
  const years = [];
  const curYear = new Date().getFullYear();
  for (let y = curYear - 3; y <= curYear + 2; y++) years.push(y);
  const mo = MONTHS.map((m,i) => `<option value="${i+1}"${i+1===selMonth?' selected':''}>${m}</option>`).join('');
  const yr = years.map(y => `<option value="${y}"${y===selYear?' selected':''}>${y}</option>`).join('');
  return { mo, yr };
}

function getSelectedColor(containerEl) {
  const sel = containerEl.querySelector('.color-swatch.selected');
  return sel ? sel.dataset.color : COLORS[0].val;
}

function toast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ============================================================
   ROUTER / NAVIGATION
   ============================================================ */
function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  renderPage();
}

function renderPage() {
  const el = document.getElementById('page-content');
  switch (state.page) {
    case 'budget':   el.innerHTML = renderBudget(); break;
    case 'analysis': el.innerHTML = renderAnalysis(); initCharts(); break;
    case 'wishlist': el.innerHTML = renderWishlist(); break;
    case 'logs':     el.innerHTML = renderLogs(); break;
  }
}

/* ============================================================
   BUDGET PAGE
   ============================================================ */
function renderBudget() {
  const { budgetMonth: m, budgetYear: y } = state;
  const items = getBudgetItems(m, y).sort((a,b) => {
    if (a.isSystem && !b.isSystem) return 1;
    if (!a.isSystem && b.isSystem) return -1;
    return 0;
  });

  const totalEst = items.reduce((s,i) => s + (i.estimatedCost||0), 0);
  let totalActual = 0;
  const itemsWithActual = items.map(item => {
    const actual = getBudgetActual(item.id);
    totalActual += actual;
    return { ...item, actual };
  });
  const diff = totalEst - totalActual;

  const summaryBar = `
    <div class="budget-summary-bar">
      <div class="summary-item">
        <span class="summary-item-label">Total Budget</span>
        <span class="summary-item-value">${fmtCurrency(totalEst)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <span class="summary-item-label">Total Spent</span>
        <span class="summary-item-value">${fmtCurrency(totalActual)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <span class="summary-item-label">${diff >= 0 ? 'Remaining' : 'Overspent'}</span>
        <span class="summary-item-value ${diff < 0 ? 'over' : 'under'}">${fmtCurrency(Math.abs(diff))}</span>
      </div>
    </div>`;

  const listHtml = itemsWithActual.length === 0
    ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <h3>No budget items</h3>
        <p>Add your first budget item for ${MONTHS[m-1]} ${y}</p>
      </div>`
    : `<div class="budget-list">${itemsWithActual.map(item => budgetItemCard(item)).join('')}</div>`;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Monthly Budget</div>
        <div class="page-subtitle">Plan and track your monthly spending</div>
      </div>
      <div class="header-actions">
        <div class="month-nav">
          <button data-action="budget-prev-month">&#8249;</button>
          <span class="month-nav-label">${MONTHS[m-1]} ${y}</span>
          <button data-action="budget-next-month">&#8250;</button>
        </div>
        <button class="btn btn-primary" data-action="open-add-budget-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Item
        </button>
      </div>
    </div>
    ${totalEst > 0 || totalActual > 0 ? summaryBar : ''}
    ${listHtml}`;
}

function budgetItemCard(item) {
  const diff = (item.estimatedCost || 0) - item.actual;
  const wishItem = item.wishItemId ? getWishItem(item.wishItemId) : null;
  const diffHtml = item.estimatedCost > 0
    ? `<div class="cost-diff ${diff < 0 ? 'over' : 'under'}">${diff < 0 ? '▲ over' : '▼ under'} ${fmtCurrency(Math.abs(diff))}</div>`
    : '';
  return `
    <div class="budget-item-card${item.isSystem ? ' is-misc' : ''}">
      <div class="budget-item-main">
        <div class="budget-item-name-row">
          ${colorBadge(item.name, item.color)}
          ${priorityBadge(item.priority)}
          ${statusBadge(item.status)}
          ${wishItem ? `<span class="budget-item-wish-tag">★ ${escHtml(wishItem.name)}</span>` : ''}
        </div>
        ${item.note ? `<div class="budget-item-note">${escHtml(item.note)}</div>` : ''}
      </div>
      <div class="budget-item-costs">
        <div class="cost-estimated">Budget: ${fmtCurrency(item.estimatedCost)}</div>
        <div class="cost-actual">${fmtCurrency(item.actual)}</div>
        ${diffHtml}
      </div>
      <div class="budget-item-actions">
        <button class="btn btn-ghost btn-icon" data-action="edit-budget-item" data-id="${item.id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${!item.isSystem ? `<button class="btn btn-ghost btn-icon danger" data-action="delete-budget-item" data-id="${item.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>` : ''}
      </div>
    </div>`;
}

/* ============================================================
   ANALYSIS PAGE
   ============================================================ */
let analysisChartInstance = null;

function renderAnalysis() {
  const { analysisMonth: m, analysisYear: y } = state;
  const items = getBudgetItems(m, y);
  const expenses = getExpenses(m, y);

  const totalEst = items.reduce((s,i) => s + (i.estimatedCost||0), 0);
  const totalActual = expenses.reduce((s,e) => s + (e.actualCost||0), 0);
  const diff = totalEst - totalActual;

  const { mo, yr } = monthYearOptions(m, y);

  const tableRows = items.map(item => {
    const actual = getBudgetActual(item.id);
    const d = (item.estimatedCost||0) - actual;
    return `<tr>
      <td>${colorBadge(item.name, item.color)}</td>
      <td class="num">${fmtCurrency(item.estimatedCost)}</td>
      <td class="num">${fmtCurrency(actual)}</td>
      <td class="num" style="color:${d<0?'#ef4444':'#22c55e'}">${d<0?'▲':'▼'} ${fmtCurrency(Math.abs(d))}</td>
      <td>${statusBadge(item.status)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8">No budget items for this month</td></tr>`;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Expenditure Analysis</div>
        <div class="page-subtitle">Compare budget vs actual spending</div>
      </div>
      <div class="header-actions">
        <select class="form-select" id="analysis-month-sel" style="width:140px">${mo}</select>
        <select class="form-select" id="analysis-year-sel" style="width:90px">${yr}</select>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card accent">
        <div class="stat-label">Total Budget</div>
        <div class="stat-value">${fmtCurrency(totalEst)}</div>
        <div class="stat-sub">${items.length} categories</div>
      </div>
      <div class="stat-card ${totalActual > totalEst ? 'danger' : 'success'}">
        <div class="stat-label">Total Spent</div>
        <div class="stat-value">${fmtCurrency(totalActual)}</div>
        <div class="stat-sub">${expenses.length} transactions</div>
      </div>
      <div class="stat-card ${diff < 0 ? 'danger' : 'success'}">
        <div class="stat-label">${diff >= 0 ? 'Remaining' : 'Overspent'}</div>
        <div class="stat-value" style="color:${diff<0?'#ef4444':'#22c55e'}">${fmtCurrency(Math.abs(diff))}</div>
        <div class="stat-sub">${totalEst > 0 ? Math.round((totalActual/totalEst)*100) : 0}% of budget used</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-title">Budget vs Actual by Category</div>
      <div class="chart-wrapper"><canvas id="analysis-chart"></canvas></div>
    </div>

    <div class="card" style="overflow:hidden">
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Category</th>
            <th class="num">Budgeted</th>
            <th class="num">Actual</th>
            <th class="num">Difference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

function initCharts() {
  setTimeout(() => {
    const canvas = document.getElementById('analysis-chart');
    if (!canvas) return;
    if (analysisChartInstance) { analysisChartInstance.destroy(); analysisChartInstance = null; }

    const { analysisMonth: m, analysisYear: y } = state;
    const items = getBudgetItems(m, y).filter(i => !i.isSystem || getBudgetActual(i.id) > 0);

    if (items.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data for this month', canvas.width / 2, 120);
      return;
    }

    analysisChartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map(i => i.name),
        datasets: [
          {
            label: 'Budgeted',
            data: items.map(i => i.estimatedCost || 0),
            backgroundColor: 'rgba(99,102,241,.25)',
            borderColor: 'rgba(99,102,241,1)',
            borderWidth: 1.5,
            borderRadius: 4
          },
          {
            label: 'Actual',
            data: items.map(i => getBudgetActual(i.id)),
            backgroundColor: items.map(i => {
              const a = getBudgetActual(i.id);
              return a > (i.estimatedCost||0) ? 'rgba(239,68,68,.7)' : 'rgba(34,197,94,.7)';
            }),
            borderColor: items.map(i => {
              const a = getBudgetActual(i.id);
              return a > (i.estimatedCost||0) ? '#ef4444' : '#22c55e';
            }),
            borderWidth: 1.5,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            ticks: { callback: v => 'Tk ' + Number(v).toLocaleString('en-IN') },
            grid: { color: 'rgba(0,0,0,.05)' }
          }
        }
      }
    });
  }, 50);
}

/* ============================================================
   WISHLIST PAGE
   ============================================================ */
function renderWishlist() {
  const items = state.data.wishItems;

  const listHtml = items.length === 0
    ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <h3>No wish items yet</h3>
        <p>Add things you want to save up for</p>
      </div>`
    : `<div class="wish-grid">${items.map(w => wishCard(w)).join('')}</div>`;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Wishlist</div>
        <div class="page-subtitle">Track your savings goals and installments</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" data-action="open-add-wish">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Wish
        </button>
      </div>
    </div>
    ${listHtml}`;
}

function wishCard(w) {
  const spent = getWishSpent(w.id);
  const remaining = (w.estimatedCost || 0) - spent;
  const pct = w.estimatedCost > 0 ? Math.min(100, Math.round((spent / w.estimatedCost) * 100)) : 0;
  const status = spent <= 0 ? 'pending' : spent >= w.estimatedCost ? 'completed' : 'in-progress';

  return `
    <div class="wish-card">
      <div class="wish-card-top">
        <div class="wish-card-main">
          <div class="wish-card-name-row">
            ${colorBadge(w.name, w.color)}
            ${priorityBadge(w.priority)}
            ${statusBadge(status)}
          </div>
          ${w.note ? `<div class="wish-card-note">${escHtml(w.note)}</div>` : ''}
        </div>
        <div class="wish-card-actions">
          <button class="btn btn-ghost btn-icon" data-action="edit-wish" data-id="${w.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon danger" data-action="delete-wish" data-id="${w.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>

      <div class="wish-progress">
        <div class="wish-amounts">
          <div class="wish-amount-item">
            <span class="wish-amount-label">Target</span>
            <span class="wish-amount-value">${fmtCurrency(w.estimatedCost)}</span>
          </div>
          <div class="wish-amount-item">
            <span class="wish-amount-label">Spent</span>
            <span class="wish-amount-value spent">${fmtCurrency(spent)}</span>
          </div>
          <div class="wish-amount-item">
            <span class="wish-amount-label">${remaining >= 0 ? 'Remaining' : 'Exceeded by'}</span>
            <span class="wish-amount-value ${remaining < 0 ? 'over' : 'remaining'}">${fmtCurrency(Math.abs(remaining))}</span>
          </div>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill${pct >= 100 ? ' complete' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="progress-pct">${pct}% complete</div>

        <div class="wish-card-btns">
          <button class="btn btn-secondary btn-sm" data-action="wish-add-to-budget" data-id="${w.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>
            Add to Monthly Budget
          </button>
          <button class="btn btn-secondary btn-sm" data-action="wish-add-expense" data-id="${w.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Record Expense
          </button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   LOGS PAGE
   ============================================================ */
function renderLogs() {
  const { logsMonth: m, logsYear: y } = state;
  const curYear = new Date().getFullYear();

  const allExpenses = getExpenses(m || null, y || null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const mo = `<option value="0">All Months</option>` +
    MONTHS.map((mn, i) => `<option value="${i+1}"${i+1===m?' selected':''}>${mn}</option>`).join('');

  const years = [];
  for (let yr2 = curYear - 3; yr2 <= curYear + 1; yr2++) years.push(yr2);
  const yr = `<option value="0">All Years</option>` +
    years.map(yr2 => `<option value="${yr2}"${yr2===y?' selected':''}>${yr2}</option>`).join('');

  const listHtml = allExpenses.length === 0
    ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <h3>No expenses found</h3>
        <p>Expenses you record will appear here</p>
      </div>`
    : `<div class="log-list">${allExpenses.map(e => logItem(e)).join('')}</div>`;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Expense Logs</div>
        <div class="page-subtitle">All recorded expenses</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" data-action="open-add-expense">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Expense
        </button>
      </div>
    </div>
    <div class="logs-filters">
      <select id="logs-month-sel">${mo}</select>
      <select id="logs-year-sel">${yr}</select>
      <span class="logs-count">${allExpenses.length} expense${allExpenses.length !== 1 ? 's' : ''}</span>
    </div>
    ${listHtml}`;
}

function logItem(e) {
  const budgetItem = getBudgetItem(e.budgetItemId);
  const wishItem = e.wishItemId ? getWishItem(e.wishItemId) : null;
  return `
    <div class="log-item">
      <div class="log-date">${fmtDate(e.date)}</div>
      <div class="log-main">
        <div class="log-name-row">
          ${colorBadge(e.name, e.color)}
          ${budgetItem ? `<span class="text-muted" style="font-size:12px">in ${escHtml(budgetItem.name)}</span>` : ''}
          ${wishItem ? `<span class="badge badge-status-in-progress" style="font-size:11px">★ ${escHtml(wishItem.name)}</span>` : ''}
        </div>
        ${e.note ? `<div class="log-meta">${escHtml(e.note)}</div>` : ''}
      </div>
      <div class="log-amount">${fmtCurrency(e.actualCost)}</div>
      <div class="log-actions">
        <button class="btn btn-ghost btn-icon" data-action="edit-expense" data-id="${e.id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-icon danger" data-action="delete-expense" data-id="${e.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
}

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
function openModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-box').innerHTML = '';
}

/* ============================================================
   MODAL: ADD / EDIT BUDGET ITEM
   ============================================================ */
function openAddBudgetItemModal(editId = null) {
  const { budgetMonth: m, budgetYear: y } = state;
  const editing = editId ? state.data.budgetItems.find(b => b.id === editId) : null;
  const def = editing || { name: '', estimatedCost: '', priority: 'medium', status: 'pending', color: COLORS[0].val, note: '', month: m, year: y };

  const { mo, yr } = monthYearOptions(def.month, def.year);
  const priorityOpts = PRIORITIES.map(p => `<option value="${p}"${p===def.priority?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('');
  const statusOpts = EXPENSE_STATUSES.map(s => `<option value="${s}"${s===def.status?' selected':''}>${s.replace('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">${editing ? 'Edit' : 'Add'} Budget Item</div>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name <span class="req">*</span></label>
        <input id="bi-name" class="form-input" value="${escHtml(def.name)}" placeholder="e.g. Groceries, Rent...">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Estimated Cost</label>
          <input id="bi-cost" class="form-input" type="number" min="0" value="${def.estimatedCost || ''}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="bi-priority" class="form-select">${priorityOpts}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Status</label>
          <select id="bi-status" class="form-select">${statusOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Month / Year</label>
          <div style="display:flex;gap:6px">
            <select id="bi-month" class="form-select">${mo}</select>
            <select id="bi-year" class="form-select">${yr}</select>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Badge Color</label>
        ${colorPickerHtml(def.color, 'bi-color')}
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <textarea id="bi-note" class="form-textarea" placeholder="Optional note...">${escHtml(def.note)}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-budget-item" data-id="${editId || ''}">
        ${editing ? 'Save Changes' : 'Add Item'}
      </button>
    </div>`);
}

async function saveBudgetItem(editId) {
  const name = document.getElementById('bi-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  const color = getSelectedColor(document.querySelector('[data-picker="bi-color"]').parentElement);
  const item = {
    id: editId || await genId(),
    name,
    estimatedCost: parseFloat(document.getElementById('bi-cost').value) || 0,
    priority: document.getElementById('bi-priority').value,
    status: document.getElementById('bi-status').value,
    color,
    month: parseInt(document.getElementById('bi-month').value),
    year: parseInt(document.getElementById('bi-year').value),
    note: document.getElementById('bi-note').value.trim(),
    isSystem: false,
    wishItemId: editId ? (state.data.budgetItems.find(b => b.id === editId)?.wishItemId || null) : null
  };

  if (editId) {
    const idx = state.data.budgetItems.findIndex(b => b.id === editId);
    if (idx > -1) state.data.budgetItems[idx] = item;
  } else {
    state.data.budgetItems.push(item);
  }
  await persist();
  closeModal();
  toast(editId ? 'Budget item updated' : 'Budget item added', 'success');
  renderPage();
}

/* ============================================================
   MODAL: ADD / EDIT EXPENSE
   ============================================================ */
async function openAddExpenseModal(defaults = {}) {
  const editing = defaults._editId ? state.data.expenses.find(e => e.id === defaults._editId) : null;
  const def = editing || {
    name: defaults.name || '',
    actualCost: defaults.actualCost || '',
    color: defaults.color || COLORS[0].val,
    date: defaults.date || todayISO(),
    note: defaults.note || '',
    budgetItemId: defaults.budgetItemId || '',
    wishItemId: defaults.wishItemId || null
  };

  const expDate = new Date(def.date);
  const expMonth = expDate.getMonth() + 1;
  const expYear = expDate.getFullYear();

  await ensureMisc(expMonth, expYear);
  const budgetItems = getBudgetItems(expMonth, expYear);

  const budgetOpts = budgetItems.map(b =>
    `<option value="${b.id}"${b.id===def.budgetItemId?' selected':''}>${escHtml(b.name)}</option>`
  ).join('');

  const wishOpts = `<option value="">— None —</option>` +
    state.data.wishItems.map(w =>
      `<option value="${w.id}"${w.id===def.wishItemId?' selected':''}>${escHtml(w.name)}</option>`
    ).join('');

  const hasWish = !!def.wishItemId;

  openModal(`
    <div class="modal-header">
      <div class="modal-title">${editing ? 'Edit' : 'Add'} Expense</div>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Expense Name</label>
        <input id="ex-name" class="form-input" value="${escHtml(def.name)}" placeholder="Leave blank to use budget item name">
        <div class="form-hint">Leave empty to use the budget item name</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount <span class="req">*</span></label>
          <input id="ex-cost" class="form-input" type="number" min="0" value="${def.actualCost || ''}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">Date <span class="req">*</span></label>
          <input id="ex-date" class="form-input" type="date" value="${def.date}" max="${todayISO()}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Badge Color</label>
        ${colorPickerHtml(def.color, 'ex-color')}
      </div>
      <div class="form-group">
        <label class="form-label">Budget Category <span class="req">*</span></label>
        <select id="ex-budget-item" class="form-select">${budgetOpts}</select>
        <div class="form-hint">Categories from the expense's month</div>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">Link to Wish Item</span>
        <label class="toggle">
          <input type="checkbox" id="ex-wish-toggle" ${hasWish ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div id="ex-wish-section" style="${hasWish ? '' : 'display:none'}">
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Wish Item</label>
          <select id="ex-wish-item" class="form-select">${wishOpts}</select>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Note</label>
        <textarea id="ex-note" class="form-textarea" placeholder="Optional note...">${escHtml(def.note)}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-expense" data-id="${editing ? editing.id : ''}">
        ${editing ? 'Save Changes' : 'Add Expense'}
      </button>
    </div>`);
}

async function saveExpense(editId) {
  const costVal = parseFloat(document.getElementById('ex-cost').value);
  const dateVal = document.getElementById('ex-date').value;
  if (!costVal || isNaN(costVal)) { toast('Amount is required', 'error'); return; }
  if (!dateVal) { toast('Date is required', 'error'); return; }

  const budgetItemId = document.getElementById('ex-budget-item').value;
  if (!budgetItemId) { toast('Budget category is required', 'error'); return; }

  const budgetItem = getBudgetItem(budgetItemId);
  let name = document.getElementById('ex-name').value.trim();
  if (!name && budgetItem) name = budgetItem.name;

  const wishToggle = document.getElementById('ex-wish-toggle').checked;
  const wishItemId = wishToggle ? (document.getElementById('ex-wish-item').value || null) : null;

  const color = getSelectedColor(document.querySelector('[data-picker="ex-color"]').parentElement);

  const expense = {
    id: editId || await genId(),
    name,
    actualCost: costVal,
    color,
    date: dateVal,
    note: document.getElementById('ex-note').value.trim(),
    budgetItemId,
    wishItemId: wishItemId || null
  };

  if (editId) {
    const idx = state.data.expenses.findIndex(e => e.id === editId);
    if (idx > -1) state.data.expenses[idx] = expense;
  } else {
    state.data.expenses.push(expense);
  }
  await persist();
  closeModal();
  toast(editId ? 'Expense updated' : 'Expense recorded', 'success');
  renderPage();
}

/* ============================================================
   MODAL: ADD / EDIT WISH ITEM
   ============================================================ */
function openAddWishModal(editId = null) {
  const editing = editId ? state.data.wishItems.find(w => w.id === editId) : null;
  const def = editing || { name: '', estimatedCost: '', priority: 'medium', color: COLORS[4].val, note: '' };
  const priorityOpts = PRIORITIES.map(p => `<option value="${p}"${p===def.priority?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">${editing ? 'Edit' : 'Add'} Wish Item</div>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name <span class="req">*</span></label>
        <input id="wi-name" class="form-input" value="${escHtml(def.name)}" placeholder="e.g. New Laptop, Vacation...">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Target Cost <span class="req">*</span></label>
          <input id="wi-cost" class="form-input" type="number" min="0" value="${def.estimatedCost || ''}" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="wi-priority" class="form-select">${priorityOpts}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Badge Color</label>
        ${colorPickerHtml(def.color, 'wi-color')}
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <textarea id="wi-note" class="form-textarea" placeholder="What is this for?">${escHtml(def.note)}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-wish" data-id="${editId || ''}">
        ${editing ? 'Save Changes' : 'Add to Wishlist'}
      </button>
    </div>`);
}

async function saveWishItem(editId) {
  const name = document.getElementById('wi-name').value.trim();
  const cost = parseFloat(document.getElementById('wi-cost').value);
  if (!name) { toast('Name is required', 'error'); return; }
  if (!cost || isNaN(cost)) { toast('Target cost is required', 'error'); return; }

  const color = getSelectedColor(document.querySelector('[data-picker="wi-color"]').parentElement);
  const item = {
    id: editId || await genId(),
    name,
    estimatedCost: cost,
    priority: document.getElementById('wi-priority').value,
    color,
    note: document.getElementById('wi-note').value.trim()
  };

  if (editId) {
    const idx = state.data.wishItems.findIndex(w => w.id === editId);
    if (idx > -1) state.data.wishItems[idx] = item;
  } else {
    state.data.wishItems.push(item);
  }
  await persist();
  closeModal();
  toast(editId ? 'Wish item updated' : 'Wish item added', 'success');
  renderPage();
}

/* ============================================================
   MODAL: ADD WISH TO MONTHLY BUDGET
   ============================================================ */
function openWishToBudgetModal(wishId) {
  const wish = getWishItem(wishId);
  if (!wish) return;

  const { mo, yr } = monthYearOptions(state.budgetMonth, state.budgetYear);
  const spent = getWishSpent(wishId);
  const remaining = wish.estimatedCost - spent;

  openModal(`
    <div class="modal-header">
      <div class="modal-title">Add Installment to Budget</div>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--accent-light);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-weight:600;color:var(--accent);margin-bottom:4px">${escHtml(wish.name)}</div>
        <div style="font-size:12px;color:var(--text-muted)">
          Target: ${fmtCurrency(wish.estimatedCost)} &nbsp;•&nbsp;
          Spent: ${fmtCurrency(spent)} &nbsp;•&nbsp;
          Remaining: ${fmtCurrency(remaining > 0 ? remaining : 0)}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Month</label>
          <select id="wtb-month" class="form-select">${mo}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Year</label>
          <select id="wtb-year" class="form-select">${yr}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Installment Amount <span class="req">*</span></label>
        <input id="wtb-amount" class="form-input" type="number" min="0" placeholder="How much to allocate this month?">
        <div class="form-hint">This becomes the budget for this wish item in the selected month</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-wish-to-budget" data-wish-id="${wishId}">
        Add to Budget
      </button>
    </div>`);
}

async function saveWishToBudget(wishId) {
  const amount = parseFloat(document.getElementById('wtb-amount').value);
  if (!amount || isNaN(amount)) { toast('Installment amount is required', 'error'); return; }

  const month = parseInt(document.getElementById('wtb-month').value);
  const year = parseInt(document.getElementById('wtb-year').value);
  const wish = getWishItem(wishId);

  const existing = state.data.budgetItems.find(b => b.wishItemId === wishId && b.month === month && b.year === year);
  if (existing) {
    existing.estimatedCost += amount;
    await persist();
    closeModal();
    toast('Installment added to existing budget entry', 'success');
    if (state.page === 'budget') {
      state.budgetMonth = month;
      state.budgetYear = year;
    }
    renderPage();
    return;
  }

  const budgetItem = {
    id: await genId(),
    name: wish.name,
    estimatedCost: amount,
    priority: wish.priority,
    status: 'pending',
    color: wish.color,
    month,
    year,
    note: `Monthly installment for wish: ${wish.name}`,
    isSystem: false,
    wishItemId: wishId
  };
  state.data.budgetItems.push(budgetItem);
  await persist();
  closeModal();
  toast(`Added ${fmtCurrency(amount)} installment to ${MONTHS[month-1]} ${year} budget`, 'success');
  if (state.page === 'budget') {
    state.budgetMonth = month;
    state.budgetYear = year;
  }
  renderPage();
}

/* ============================================================
   EVENT DELEGATION
   ============================================================ */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    // Navigation
    case 'close-modal': closeModal(); break;

    // Budget page
    case 'budget-prev-month': {
      state.budgetMonth--;
      if (state.budgetMonth < 1) { state.budgetMonth = 12; state.budgetYear--; }
      renderPage(); break;
    }
    case 'budget-next-month': {
      state.budgetMonth++;
      if (state.budgetMonth > 12) { state.budgetMonth = 1; state.budgetYear++; }
      renderPage(); break;
    }
    case 'open-add-budget-item': openAddBudgetItemModal(); break;
    case 'edit-budget-item': openAddBudgetItemModal(id); break;
    case 'save-budget-item': await saveBudgetItem(el.dataset.id || null); break;
    case 'delete-budget-item': {
      if (!confirm('Delete this budget item? Associated expenses will remain.')) break;
      state.data.budgetItems = state.data.budgetItems.filter(b => b.id !== id);
      await persist();
      toast('Budget item deleted');
      renderPage(); break;
    }

    // Expense
    case 'open-add-expense': await openAddExpenseModal(); break;
    case 'edit-expense': {
      const ex = state.data.expenses.find(e2 => e2.id === id);
      if (ex) await openAddExpenseModal({ ...ex, _editId: id });
      break;
    }
    case 'save-expense': await saveExpense(el.dataset.id || null); break;
    case 'delete-expense': {
      if (!confirm('Delete this expense?')) break;
      state.data.expenses = state.data.expenses.filter(e2 => e2.id !== id);
      await persist();
      toast('Expense deleted');
      renderPage(); break;
    }

    // Wishlist
    case 'open-add-wish': openAddWishModal(); break;
    case 'edit-wish': openAddWishModal(id); break;
    case 'save-wish': await saveWishItem(el.dataset.id || null); break;
    case 'delete-wish': {
      if (!confirm('Delete this wish item?')) break;
      state.data.wishItems = state.data.wishItems.filter(w => w.id !== id);
      await persist();
      toast('Wish item deleted');
      renderPage(); break;
    }
    case 'wish-add-to-budget': openWishToBudgetModal(id); break;
    case 'save-wish-to-budget': await saveWishToBudget(el.dataset.wishId); break;
    case 'wish-add-expense': {
      const wish = getWishItem(id);
      if (!wish) break;
      const expMonth = state.budgetMonth;
      const expYear = state.budgetYear;
      await ensureMisc(expMonth, expYear);
      const linkedBudget = state.data.budgetItems.find(b => b.wishItemId === id && b.month === expMonth && b.year === expYear);
      await openAddExpenseModal({
        name: wish.name,
        color: wish.color,
        wishItemId: id,
        budgetItemId: linkedBudget ? linkedBudget.id : getMiscId(expMonth, expYear)
      });
      break;
    }
  }
});

// Sidebar nav
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// Analysis month/year change
document.addEventListener('change', async (e) => {
  if (e.target.id === 'analysis-month-sel') {
    state.analysisMonth = parseInt(e.target.value);
    renderPage();
  } else if (e.target.id === 'analysis-year-sel') {
    state.analysisYear = parseInt(e.target.value);
    renderPage();
  } else if (e.target.id === 'logs-month-sel') {
    state.logsMonth = parseInt(e.target.value);
    renderPage();
  } else if (e.target.id === 'logs-year-sel') {
    state.logsYear = parseInt(e.target.value);
    renderPage();
  } else if (e.target.id === 'ex-date') {
    // Reload budget items for the new date's month/year
    const modal = document.getElementById('modal-box');
    if (!modal.querySelector('#ex-budget-item')) return;
    const d = new Date(e.target.value);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    await ensureMisc(m, y);
    const items = getBudgetItems(m, y);
    document.getElementById('ex-budget-item').innerHTML =
      items.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  } else if (e.target.id === 'ex-wish-toggle') {
    const section = document.getElementById('ex-wish-section');
    if (section) section.style.display = e.target.checked ? '' : 'none';
  }
});

// Color swatch selection
document.addEventListener('click', (e) => {
  const swatch = e.target.closest('.color-swatch');
  if (!swatch) return;
  const picker = swatch.dataset.picker;
  document.querySelectorAll(`.color-swatch[data-picker="${picker}"]`).forEach(s => s.classList.remove('selected'));
  swatch.classList.add('selected');
});

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  await loadData();
  navigate('budget');
}

init();
