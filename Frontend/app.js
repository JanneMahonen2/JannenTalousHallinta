// ----------------------------------------------------------------------------
// State + storage
// ----------------------------------------------------------------------------

const STATE_KEY = 'jth-state-v1';
const PRESETS_KEY = 'jth-presets-v1';

const PALETTE = [
    '#4f46e5', '#10b981', '#f59e0b', '#3b82f6',
    '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
    '#ef4444', '#06b6d4', '#84cc16', '#a855f7',
];

const DEFAULT_STATE = {
    income: 2500,
    period: 'month',
    categories: [
        { id: 'asuminen', name: 'Asuminen',    color: '#4f46e5', amount: 1000 },
        { id: 'ruoka',    name: 'Ruoka',       color: '#10b981', amount: 500  },
        { id: 'liikenne', name: 'Liikenne',    color: '#f59e0b', amount: 250  },
        { id: 'saastot',  name: 'Säästöt',     color: '#3b82f6', amount: 375  },
        { id: 'vapaa',    name: 'Vapaa-aika',  color: '#ec4899', amount: 250  },
        { id: 'muut',     name: 'Muut',        color: '#6b7280', amount: 125  },
    ],
    financialEntities: [
        {
            id: 'fe-asuntolaina',
            name: 'Asuntolaina OP',
            type: 'loan',
            linkedCategoryId: 'asuminen',
            principal: 150000,
            interestRate: 3.5,
            termMonths: 240,
            startDate: '2023-01-01',
        },
        {
            id: 'fe-saastot',
            name: 'Säästötili',
            type: 'savings',
            linkedCategoryId: 'saastot',
            balance: 2000,
            interestRate: 1.5,
        },
    ],
};

const PER_YEAR = { week: 52, month: 12, year: 1 };
const PERIOD_LABEL = { week: 'viikossa', month: 'kuukaudessa', year: 'vuodessa' };

// Sijoituksen volatiliteettiluokat. sigma = arvioitu vuosivolatiliteetti (%),
// historiallisten markkinatuottojen ja vakiintuneiden riskiluokitusten perusteella.
// Riskipreemio johdetaan tästä Sharpe-pohjaisella heuristiikalla (premium ≈ σ × 0.18).
// 'index_fund' on default, koska se on yleisin tavallisen sijoittajan kohde.
const VOLATILITY_CLASSES = {
    bond_fund:          { label: 'Korkorahasto',                 sigma: 5  },
    balanced_fund:      { label: 'Balanced-rahasto (50/50)',     sigma: 10 },
    index_fund:         { label: 'Indeksirahasto (laaja)',       sigma: 15 },
    sector_etf:         { label: 'Sektori-ETF',                  sigma: 20 },
    single_stock:       { label: 'Yksittäinen osake',            sigma: 30 },
    crypto_speculative: { label: 'Krypto / spekulatiivinen',     sigma: 60 },
};
const DEFAULT_VOLATILITY_CLASS = 'index_fund';
function getEntitySigma(entity) {
    if (!entity) return 0;
    if (entity.type === 'savings') return 0.5; // talletustilin pieni epävarmuus
    if (entity.type === 'loan') return 0;       // riskitön (deterministinen)
    const cls = VOLATILITY_CLASSES[entity.volatilityClass] || VOLATILITY_CLASSES[DEFAULT_VOLATILITY_CLASS];
    return cls.sigma;
}
function getEntityRiskPremium(entity) {
    // Sharpe-pohjainen heuristiikka: preemio ≈ σ × 0.18. Konservatiivinen.
    return getEntitySigma(entity) * 0.18;
}

function sanitizeState(raw) {
    const out = {
        income: Math.max(0, Math.round(Number(raw?.income) || 0)),
        period: PER_YEAR[raw?.period] ? raw.period : 'month',
        categories: Array.isArray(raw?.categories)
            ? raw.categories.map((c, idx) => ({
                id: String(c?.id ?? `cat-${Date.now()}-${idx}`),
                name: String(c?.name ?? 'Kategoria'),
                color: typeof c?.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : PALETTE[idx % PALETTE.length],
                amount: Math.max(0, Math.round(Number(c?.amount) || 0)),
                locked: !!c?.locked,
            }))
            : [],
        financialEntities: Array.isArray(raw?.financialEntities)
            ? raw.financialEntities.map((e, idx) => sanitizeEntity(e, idx))
            : [],
    };
    return out;
}

function sanitizeEntity(e, idx) {
    const entity = {
        id: String(e?.id ?? `fe-${Date.now()}-${idx}`),
        name: String(e?.name ?? 'Tili'),
        type: ['loan', 'savings', 'investment'].includes(e?.type) ? e.type : 'savings',
        linkedCategoryId: typeof e?.linkedCategoryId === 'string' ? e.linkedCategoryId : null,
    };
    if (entity.type === 'loan') {
        entity.principal = Math.max(0, Math.round(Number(e?.principal) || 0));
        entity.interestRate = Math.max(0, Number(e?.interestRate) || 0);
        entity.termMonths = Math.max(1, Math.round(Number(e?.termMonths) || 240));
        entity.startDate = typeof e?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.startDate)
            ? e.startDate
            : new Date().toISOString().slice(0, 10);
        entity.redistributeOnDone = !!e?.redistributeOnDone;
        entity.redistributeToId = typeof e?.redistributeToId === 'string' ? e.redistributeToId : null;
    } else if (entity.type === 'savings') {
        entity.balance = Math.max(0, Math.round(Number(e?.balance) || 0));
        entity.interestRate = Math.max(0, Number(e?.interestRate) || 0);
        entity.targetAmount = (e?.targetAmount === null || e?.targetAmount === undefined || e?.targetAmount === '')
            ? null
            : Math.max(0, Math.round(Number(e.targetAmount) || 0));
        entity.redistributeOnDone = !!e?.redistributeOnDone;
        entity.redistributeToId = typeof e?.redistributeToId === 'string' ? e.redistributeToId : null;
    } else if (entity.type === 'investment') {
        entity.currentValue = Math.max(0, Math.round(Number(e?.currentValue) || 0));
        entity.growthRate = Math.max(0, Number(e?.growthRate) || 0);
        entity.volatilityClass = VOLATILITY_CLASSES[e?.volatilityClass]
            ? e.volatilityClass
            : DEFAULT_VOLATILITY_CLASS;
    }
    return entity;
}

function loadState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.categories)) return sanitizeState(parsed);
        }
    } catch { /* fall through */ }
    return structuredClone(DEFAULT_STATE);
}

function loadPresets() {
    try {
        const raw = localStorage.getItem(PRESETS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch { /* fall through */ }
    return {};
}

function saveState() {
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        showSaveStatus('Tallennettu selaimeen ✓');
    } catch {
        showSaveStatus('Tallennus epäonnistui', true);
    }
}

function savePresets() {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

const state = loadState();
const presets = loadPresets();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const fmt = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 0 });
const euro = (n) => `${fmt.format(Math.round(n))} €`;
const periodFactor = (from, to) => PER_YEAR[from] / PER_YEAR[to];
const totalAllocated = () => state.categories.reduce((s, c) => s + c.amount, 0);
const escapeAttr = (s) =>
    String(s).replace(/&/g, '&').replace(/"/g, '"').replace(/</g, '<');

let saveStatusTimer = null;
function showSaveStatus(msg, isError = false) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

/**
 * Reduce `items` proportionally so their sum equals `newTotal`.
 * Lock-aware: items marked `locked` are not changed; the change is absorbed
 * entirely by the unlocked items. If locked items alone exceed `newTotal`,
 * unlocked items go to 0 and the sum stays at `lockedTotal`.
 */
function shrinkProportionally(items, newTotal) {
    const unlocked = items.filter(c => !c.locked);
    if (unlocked.length === 0) return;
    const lockedTotal = items.reduce((s, c) => s + (c.locked ? c.amount : 0), 0);
    const currentUnlockedTotal = unlocked.reduce((s, c) => s + c.amount, 0);
    if (currentUnlockedTotal <= 0) return;

    const safeNew = Math.max(0, newTotal);
    const unlockedTarget = Math.max(0, safeNew - lockedTotal);
    const scale = unlockedTarget / currentUnlockedTotal;
    unlocked.forEach((c) => { c.amount = Math.max(0, Math.round(c.amount * scale)); });

    let drift = unlocked.reduce((s, c) => s + c.amount, 0) - unlockedTarget;
    let guard = 1000;
    while (drift !== 0 && guard-- > 0) {
        const step = drift > 0 ? -1 : 1;
        let pick = -1, bestAmt = step > 0 ? Infinity : -1;
        unlocked.forEach((c, i) => {
            if (step < 0 && c.amount <= 0) return;
            if (step < 0 && c.amount > bestAmt) { bestAmt = c.amount; pick = i; }
            if (step > 0 && c.amount < bestAmt) { bestAmt = c.amount; pick = i; }
        });
        if (pick < 0) break;
        unlocked[pick].amount += step;
        drift += step;
    }
}

/**
 * Set a category to `requested` €.
 * - Uses the unallocated remainder (Jakamaton) as the buffer for increases.
 * - HARD CAP: does NOT shrink other categories to make room. If user wants more,
 *   they must reduce another category first. Tämä on käyttäjäystävällisempää
 *   kuin push-käyttäytyminen jossa pieni input-virhe sotki useamman kategorian.
 *   Returns true if the requested amount was capped (caller voi näyttää palautteen).
 */
function setCategoryAmount(catId, requested) {
    const cat = state.categories.find((c) => c.id === catId);
    if (!cat) return false;

    let target = Math.max(0, Math.min(state.income, Math.round(requested)));

    if (target <= cat.amount) {
        // Reduction is always allowed.
        const wasCapped = target !== Math.max(0, Math.round(requested)); // capped by income ceiling?
        cat.amount = target;
        return wasCapped;
    }

    const currentTotal = totalAllocated();
    const remainder = state.income - currentTotal;
    const increase = target - cat.amount;

    if (increase <= remainder) {
        cat.amount = target;
        return target !== Math.max(0, Math.round(requested));
    }

    // Hard cap: kasvata vain Jakamattomaan asti, älä kutista muita.
    cat.amount = cat.amount + remainder;
    return true;
}

/** If categories overflow income (e.g. after an income decrease), scale them down. */
function enforceCap() {
    const total = totalAllocated();
    if (total > state.income && total > 0) {
        shrinkProportionally(state.categories, state.income);
    }
}

// ----------------------------------------------------------------------------
// Projection calculators
// ----------------------------------------------------------------------------

/**
 * Simple loan amortization: given principal, annual interest rate, monthly payment,
 * calculate payoff time & total interest.
 * Returns { payoffMonths, totalInterest, payoffDate } or null if payment <= monthly interest.
 */
function projectLoan(principal, annualRate, monthlyPayment) {
    if (principal <= 0 || monthlyPayment <= 0) return null;
    const monthlyRate = annualRate / 100 / 12;
    const firstMonthInterest = principal * monthlyRate;

    if (monthlyPayment <= firstMonthInterest) {
        // Payment doesn't cover interest — loan never pays off
        return null;
    }

    // N = log(1 - (P * r / M)) / log(1 + r) where r = monthly rate, M = payment
    const n = Math.log(monthlyPayment / (monthlyPayment - principal * monthlyRate)) / Math.log(1 + monthlyRate);
    const payoffMonths = Math.ceil(n);
    const totalInterest = (monthlyPayment * payoffMonths) - principal;

    const now = new Date();
    const payoffDate = new Date(now);
    payoffDate.setMonth(payoffDate.getMonth() + payoffMonths);

    return {
        payoffMonths,
        totalInterest: Math.round(totalInterest),
        payoffDate: payoffDate.toISOString().slice(0, 7), // YYYY-MM
    };
}

function scheduledLoanMonthly(loan) {
    const principal = Math.max(0, loan?.principal || 0);
    const months = Math.max(1, loan?.termMonths || 1);
    const monthlyRate = (loan?.interestRate || 0) / 100 / 12;
    if (principal <= 0) return 0;
    if (monthlyRate === 0) return principal / months;
    return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}

function minimumCompareLoanMonthly(loan, currentMonthly) {
    const principal = Math.max(0, loan?.principal || 0);
    const monthlyRate = (loan?.interestRate || 0) / 100 / 12;
    const interestFloor = principal * monthlyRate + 1;
    const scheduled = scheduledLoanMonthly(loan);
    const floor = scheduled <= currentMonthly ? scheduled : interestFloor;
    return Math.max(0, Math.min(currentMonthly, floor));
}

/**
 * Investment/savings growth: compound growth with monthly contributions.
 * FV = P * (1+r)^n + C * ((1+r)^n - 1) / r
 * where P = current value, r = monthly rate, C = monthly contribution, n = months
 */
function projectGrowth(currentValue, annualRate, monthlyContribution, years) {
    const months = years * 12;
    const monthlyRate = annualRate / 100 / 12;
    if (monthlyRate === 0) return Math.round(currentValue + monthlyContribution * months);

    const fv = currentValue * Math.pow(1 + monthlyRate, months)
        + monthlyContribution * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
    return Math.round(fv);
}

/**
 * Get the monthly amount that is linked to an entity from the budget.
 * Returns 0 if no link or category doesn't exist.
 */
function getLinkedMonthlyAmount(entity) {
    if (!entity.linkedCategoryId) return 0;
    const cat = state.categories.find(c => c.id === entity.linkedCategoryId);
    if (!cat) return 0;
    // Convert to monthly if needed
    const factor = periodFactor(state.period, 'month');
    return cat.amount * factor;
}

// ----------------------------------------------------------------------------
// DOM references
// ----------------------------------------------------------------------------

const $bar = document.getElementById('bar');
const $categoryList = document.getElementById('categoryList');
const $income = document.getElementById('income');
const $sumIncome = document.getElementById('sumIncome');
const $sumExpenses = document.getElementById('sumExpenses');
const $sumRemaining = document.getElementById('sumRemaining');
const $presetSelect = document.getElementById('presetSelect');
const $deletePresetBtn = document.getElementById('deletePresetBtn');
const $renamePresetBtn = document.getElementById('renamePresetBtn');

// ----------------------------------------------------------------------------
// Tab navigation
// ----------------------------------------------------------------------------

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        const pageMap = { budget: 'budgetPage', future: 'futurePage', compare: 'comparePage' };
        const pageId = pageMap[tab.dataset.tab] || 'budgetPage';
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(pageId).classList.add('active');

        if (tab.dataset.tab === 'future') {
            renderFuturePage();
        } else if (tab.dataset.tab === 'compare') {
            renderComparePage();
        }
    });
});

document.getElementById('emptyGoToEntities')?.addEventListener('click', () => {
    // Switch to budget tab
    document.querySelector('[data-tab="budget"]').click();
    // Scroll to entity button
    document.getElementById('openEntityModal').scrollIntoView({ behavior: 'smooth' });
});

// ----------------------------------------------------------------------------
// Bar rendering
// ----------------------------------------------------------------------------

function buildBar() {
    $bar.innerHTML = '';
    state.categories.forEach((cat, i) => {
        const seg = document.createElement('div');
        seg.className = 'segment';
        seg.dataset.id = cat.id;
        $bar.appendChild(seg);

        const div = document.createElement('div');
        div.className = 'divider';
        div.dataset.index = String(i);
        const isLastIdx = i === state.categories.length - 1;
        const lockBlocked = cat.locked || (!isLastIdx && state.categories[i + 1].locked);
        if (isLastIdx) {
            div.classList.add('end-divider');
            div.title = lockBlocked ? 'Lukittu — ei voi vetää' : 'Vedä siirtääksesi euroja jakamattomaan';
        } else {
            div.title = lockBlocked ? 'Lukittu — ei voi vetää' : 'Vedä siirtääksesi euroja vierekkäisten kategorioiden välillä';
        }
        if (lockBlocked) div.classList.add('lock-blocked');
        $bar.appendChild(div);
    });
    const rem = document.createElement('div');
    rem.className = 'segment remainder';
    rem.dataset.role = 'remainder';
    $bar.appendChild(rem);
    refreshBar();
}

function refreshBar() {
    const income = state.income;
    const segs = $bar.querySelectorAll('.segment[data-id]');
    const divs = $bar.querySelectorAll('.divider');
    const rem = $bar.querySelector('.segment.remainder');

    if (income <= 0) {
        segs.forEach((s) => { s.style.width = '0%'; });
        divs.forEach((d) => { d.style.display = 'none'; });
        if (rem) {
            rem.style.width = '100%';
            rem.style.display = '';
            rem.textContent = 'Aseta käytettävät varat →';
            rem.title = 'Aseta käytettävät varat ensin';
        }
        return;
    }

    let acc = 0;
    state.categories.forEach((cat, i) => {
        const pct = (cat.amount / income) * 100;
        const seg = segs[i];
        if (seg) {
            seg.style.width = `${pct}%`;
            seg.style.background = cat.color;
            seg.title = `${cat.name}: ${euro(cat.amount)}`;
            seg.textContent = pct > 9 ? cat.name : '';
        }
        acc += cat.amount;
        const div = divs[i];
        if (div) {
            const leftPct = Math.max(0, Math.min(100, (acc / income) * 100));
            div.style.left = `${leftPct}%`;
            div.style.transform = 'translateX(-50%)';
            div.style.display = '';
        }
    });

    const remaining = income - acc;
    if (rem) {
        if (remaining > 0.5) {
            const pct = (remaining / income) * 100;
            rem.style.width = `${pct}%`;
            rem.style.display = '';
            rem.title = `Jakamaton: ${euro(remaining)}`;
            rem.textContent = pct > 12 ? `Jakamaton ${euro(remaining)}` : '';
        } else {
            rem.style.width = '0%';
            rem.style.display = 'none';
        }
    }
}

// ----------------------------------------------------------------------------
// List + summary rendering
// ----------------------------------------------------------------------------

function getEntityForCategory(catId) {
    return state.financialEntities.find(e => e.linkedCategoryId === catId);
}

function entityTypeLabel(type) {
    return { loan: 'Laina', savings: 'Säästö', investment: 'Sijoitus' }[type] || '';
}

function renderList() {
    $categoryList.innerHTML = '';
    const sliderMax = Math.max(state.income, 100);

    state.categories.forEach((cat) => {
        const li = document.createElement('li');
        li.className = 'category-item';
        li.dataset.id = cat.id;

        // Build link badge
        const linked = getEntityForCategory(cat.id);
        let badgeHtml = '';
        if (linked) {
            badgeHtml = `<button type="button" class="cat-link-badge ${linked.type}" data-action="edit-link" data-entity-id="${escapeAttr(linked.id)}" title="Muokkaa linkitettyä tiliä">${entityTypeLabel(linked.type)}: ${escapeAttr(linked.name)}</button>`;
        } else {
            badgeHtml = `<button type="button" class="cat-link-badge" data-action="edit-link" data-entity-id="" title="Linkitä tili tai velka">+ Tili</button>`;
        }

        const lockTitle = cat.locked
            ? 'Lukittu — toiset eivät voi pienentää tätä'
            : 'Lukitse — estä muita pienentämästä tätä';
        li.innerHTML = `
            <input type="color" value="${cat.color}" data-action="color" aria-label="Väri">
            <input type="text" class="cat-name" value="${escapeAttr(cat.name)}" data-action="name" aria-label="Nimi">
            ${badgeHtml}
            <input type="range" class="cat-slider" min="0" max="${sliderMax}" step="1" value="${cat.amount}" data-action="slider" aria-label="Määrä liukusäätimellä">
            <input type="number" class="cat-amount" min="0" step="10" value="${cat.amount}" data-action="amount" aria-label="Määrä euroina">
            <span class="cat-currency">€</span>
            <button type="button" class="cat-lock ${cat.locked ? 'locked' : ''}" data-action="lock" aria-label="Lukitse" aria-pressed="${cat.locked ? 'true' : 'false'}" title="${lockTitle}">${cat.locked ? '🔒' : '🔓'}</button>
            <button type="button" class="cat-remove" data-action="remove" aria-label="Poista">×</button>
        `;
        $categoryList.appendChild(li);
    });
}

function renderSummary() {
    const income = state.income;
    const expenses = totalAllocated();
    const remaining = income - expenses;
    const label = PERIOD_LABEL[state.period];

    $sumIncome.textContent = `${euro(income)} / ${label}`;
    $sumExpenses.textContent = `${euro(expenses)} / ${label}`;
    $sumRemaining.textContent = `${euro(remaining)} / ${label}`;
    $sumRemaining.classList.toggle('negative', remaining < 0);
    $sumRemaining.classList.toggle('positive', remaining > 0);
}

function renderAll() {
    $income.value = state.income;
    document.querySelectorAll('.period-switch button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.period === state.period);
    });
    buildBar();
    renderList();
    renderSummary();
}

function syncListRow(cat) {
    const li = $categoryList.querySelector(`li[data-id="${cat.id}"]`);
    if (!li) return;
    const slider = li.querySelector('[data-action="slider"]');
    const number = li.querySelector('[data-action="amount"]');
    if (slider && slider !== document.activeElement) slider.value = cat.amount;
    if (number && number !== document.activeElement) number.value = cat.amount;
}

function syncAllListRows() {
    state.categories.forEach(syncListRow);
}

// ----------------------------------------------------------------------------
// Divider drag
// ----------------------------------------------------------------------------

let dragging = null;

$bar.addEventListener('pointerdown', (e) => {
    if (!e.target.classList.contains('divider')) return;
    const i = parseInt(e.target.dataset.index, 10);
    if (Number.isNaN(i) || !state.categories[i]) return;

    const isEnd = !state.categories[i + 1];
    // Lock blocks drag in both directions: a locked category can't be shrunk OR grown by a divider drag,
    // because dragging always pairs two amounts.
    if (state.categories[i].locked) return;
    if (!isEnd && state.categories[i + 1].locked) return;
    const leftAcc = state.categories.slice(0, i).reduce((s, c) => s + c.amount, 0);
    // For inner dividers: the pair (i, i+1) shares a fixed total.
    // For the end divider: the last category shares "income - leftAcc" with the Jakamaton remainder.
    const pairTotal = isEnd
        ? Math.max(0, state.income - leftAcc)
        : state.categories[i].amount + state.categories[i + 1].amount;
    if (pairTotal <= 0) return;

    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }

    dragging = {
        i,
        isEnd,
        pointerId: e.pointerId,
        node: e.target,
        leftAcc,
        pairTotal,
    };
    e.target.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
});

window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const { i, isEnd, leftAcc, pairTotal } = dragging;
    const income = state.income || 1;

    const rect = $bar.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));

    let newA = pos * income - leftAcc;
    newA = Math.max(0, Math.min(pairTotal, Math.round(newA)));

    state.categories[i].amount = newA;
    if (!isEnd) {
        state.categories[i + 1].amount = pairTotal - newA;
    }
    // For end-divider: remainder is implicit (income - sum), so no other category needs updating.

    refreshBar();
    syncListRow(state.categories[i]);
    if (!isEnd) syncListRow(state.categories[i + 1]);
    renderSummary();
});

function endDrag(e) {
    if (!dragging || (e && e.pointerId !== dragging.pointerId)) return;
    try { dragging.node.releasePointerCapture(dragging.pointerId); } catch { /* ignore */ }
    dragging.node.classList.remove('dragging');
    document.body.style.cursor = '';
    dragging = null;
    saveState();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ----------------------------------------------------------------------------
// Income input
// ----------------------------------------------------------------------------

$income.addEventListener('input', () => {
    state.income = Math.max(0, Math.round(Number($income.value) || 0));
    enforceCap();
    refreshBar();
    const newMax = Math.max(state.income, 100);
    $categoryList.querySelectorAll('[data-action="slider"]').forEach((s) => { s.max = newMax; });
    syncAllListRows();
    renderSummary();
    saveState();
});

// ----------------------------------------------------------------------------
// Period switch
// ----------------------------------------------------------------------------

document.querySelectorAll('.period-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
        const next = btn.dataset.period;
        if (next === state.period) return;
        const factor = periodFactor(state.period, next);
        state.income = Math.round(state.income * factor);
        state.categories.forEach((c) => { c.amount = Math.round(c.amount * factor); });
        state.period = next;
        renderAll();
        saveState();
    });
});

// ----------------------------------------------------------------------------
// Category list events
// ----------------------------------------------------------------------------

$categoryList.addEventListener('input', (e) => {
    const t = e.target;
    const li = t.closest('.category-item');
    if (!li) return;
    const cat = state.categories.find((c) => c.id === li.dataset.id);
    if (!cat) return;

    const action = t.dataset.action;
    if (action === 'color') {
        cat.color = t.value;
        refreshBar();
        saveState();
    } else if (action === 'name') {
        cat.name = t.value;
        refreshBar();
        saveState();
    } else if (action === 'slider' || action === 'amount') {
        const requested = Math.max(0, Number(t.value) || 0);
        const wasCapped = setCategoryAmount(cat.id, requested);
        if (cat.amount !== requested) t.value = cat.amount;
        // Visuaalinen palaute kun budjetti on täynnä eikä kasvu mahtunut.
        if (wasCapped && requested > cat.amount) {
            li.classList.add('cat-capped');
            setTimeout(() => li.classList.remove('cat-capped'), 700);
            // Slider/input lukitsee max-arvoon, mutta kerro käyttäjälle. Käytetään
            // olemassa olevaa save-status-mekanismia kevyenä toast-viestinä.
            showSaveStatus('Budjetti on täynnä — vapauta tilaa toisesta kategoriasta');
        }
        refreshBar();
        syncAllListRows();
        renderSummary();
        saveState();
    }
});

$categoryList.addEventListener('click', (e) => {
    const t = e.target;
    const li = t.closest('.category-item');

    // Handle link badge click
    if (t.dataset.action === 'edit-link') {
        const entityId = t.dataset.entityId;
        if (entityId) {
            // Edit existing entity
            openEntityModal(entityId);
        } else {
            // Create new entity, pre-link to this category
            openEntityModal(null, li.dataset.id);
        }
        return;
    }

    // Handle lock toggle
    if (t.dataset.action === 'lock' && li) {
        const cat = state.categories.find((c) => c.id === li.dataset.id);
        if (!cat) return;
        cat.locked = !cat.locked;
        buildBar();
        renderList();
        saveState();
        return;
    }

    // Handle remove
    if (t.dataset.action !== 'remove') return;
    if (!li) return;

    const catId = li.dataset.id;
    // Unlink any entities linked to this category
    state.financialEntities.forEach(e => {
        if (e.linkedCategoryId === catId) e.linkedCategoryId = null;
    });

    state.categories = state.categories.filter((c) => c.id !== catId);
    renderAll();
    saveState();
});

function addNewCategory(opts = {}) {
    const used = new Set(state.categories.map((c) => c.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[state.categories.length % PALETTE.length];
    const newCat = {
        id: `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: 'Uusi kategoria',
        color,
        amount: 0,
    };
    state.categories.push(newCat);
    renderAll();
    saveState();
    // Skrollaa uuteen kategoriaan jos pyydetty (kun käyttäjä painoi listan
    // pohjassa olevaa nappia → uusi kategoria on alimpana eikä näy ruudulla).
    if (opts.scrollTo) {
        requestAnimationFrame(() => {
            const list = document.getElementById('categoryList');
            const last = list?.querySelector('li:last-child');
            if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
}

document.getElementById('addCategory').addEventListener('click', () => {
    addNewCategory();
});

document.getElementById('addCategoryBottom')?.addEventListener('click', () => {
    addNewCategory({ scrollTo: true });
});

// ----------------------------------------------------------------------------
// File export / import / reset
// ----------------------------------------------------------------------------

document.getElementById('exportBtn').addEventListener('click', () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taloushallinta-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showSaveStatus('Tila viety tiedostoon ✓');
});

const $importFile = document.getElementById('importFile');
document.getElementById('importBtn').addEventListener('click', () => $importFile.click());
$importFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || !Array.isArray(parsed.categories)) throw new Error('invalid');
        Object.assign(state, sanitizeState(parsed));
        enforceCap();
        renderAll();
        saveState();
        showSaveStatus('Tila tuotu tiedostosta ✓');
    } catch {
        showSaveStatus('Virheellinen tiedosto', true);
    }
    e.target.value = '';
});

document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Palauta oletukset? Nykyinen tila menetetään (esivalintoja ei poisteta).')) return;
    const reset = structuredClone(DEFAULT_STATE);
    state.income = reset.income;
    state.period = reset.period;
    state.categories = reset.categories;
    state.financialEntities = reset.financialEntities;
    renderAll();
    saveState();
});

// ----------------------------------------------------------------------------
// Presets
// ----------------------------------------------------------------------------

function renderPresetSelect(keepName = null) {
    const current = keepName ?? $presetSelect.value;
    $presetSelect.innerHTML = '<option value="">— Valitse —</option>';
    Object.keys(presets).sort((a, b) => a.localeCompare(b, 'fi')).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        $presetSelect.appendChild(opt);
    });
    if (current && presets[current]) $presetSelect.value = current;
    const hasSelection = !!$presetSelect.value;
    $deletePresetBtn.disabled = !hasSelection;
    $renamePresetBtn.disabled = !hasSelection;
}

$presetSelect.addEventListener('change', () => {
    const name = $presetSelect.value;
    $deletePresetBtn.disabled = !name;
    $renamePresetBtn.disabled = !name;
    if (!name || !presets[name]) return;
    Object.assign(state, sanitizeState(presets[name]));
    enforceCap();
    renderAll();
    saveState();
    showSaveStatus(`Esivalinta "${name}" ladattu ✓`);
});

document.getElementById('savePresetBtn').addEventListener('click', () => {
    const suggested = $presetSelect.value || '';
    const name = (prompt('Esivalinnan nimi:', suggested) || '').trim();
    if (!name) return;
    if (presets[name] && !confirm(`"${name}" on jo olemassa. Korvataanko?`)) return;
    presets[name] = structuredClone(state);
    savePresets();
    renderPresetSelect(name);
    showSaveStatus(`Esivalinta "${name}" tallennettu ✓`);
});

$renamePresetBtn.addEventListener('click', () => {
    const old = $presetSelect.value;
    if (!old || !presets[old]) return;
    const next = (prompt('Uusi nimi:', old) || '').trim();
    if (!next || next === old) return;
    if (presets[next] && !confirm(`"${next}" on jo olemassa. Korvataanko?`)) return;
    presets[next] = presets[old];
    delete presets[old];
    savePresets();
    renderPresetSelect(next);
    showSaveStatus(`Nimeksi vaihdettu "${next}" ✓`);
});

$deletePresetBtn.addEventListener('click', () => {
    const name = $presetSelect.value;
    if (!name) return;
    if (!confirm(`Poistetaanko esivalinta "${name}"?`)) return;
    delete presets[name];
    savePresets();
    renderPresetSelect(null);
    $presetSelect.value = '';
    $deletePresetBtn.disabled = true;
    $renamePresetBtn.disabled = true;
    showSaveStatus(`Esivalinta "${name}" poistettu ✓`);
});

// ============================================================================
// ENTITY MODAL
// ============================================================================

const $entityModal = document.getElementById('entityModal');

// --- Form fields ---
const $entityFormId = document.getElementById('entityFormId');
const $entityName = document.getElementById('entityName');
const $entityType = document.getElementById('entityType');
const $loanPrincipal = document.getElementById('loanPrincipal');
const $loanInterest = document.getElementById('loanInterest');
const $loanTerm = document.getElementById('loanTerm');
const $loanStartDate = document.getElementById('loanStartDate');
const $savingsBalance = document.getElementById('savingsBalance');
const $savingsInterest = document.getElementById('savingsInterest');
const $savingsTarget = document.getElementById('savingsTarget');
const $savingsRedistribute = document.getElementById('savingsRedistribute');
const $savingsRedistributeRow = document.getElementById('savingsRedistributeRow');
const $savingsRedistributeTarget = document.getElementById('savingsRedistributeTarget');
const $loanRedistribute = document.getElementById('loanRedistribute');
const $loanRedistributeRow = document.getElementById('loanRedistributeRow');
const $loanRedistributeTarget = document.getElementById('loanRedistributeTarget');
const $investValue = document.getElementById('investValue');
const $investGrowth = document.getElementById('investGrowth');
const $investVolClass = document.getElementById('investVolClass');
const $investVolHint = document.getElementById('investVolHint');

// Populate volatility-class dropdown once
(function populateVolClassSelect() {
    if (!$investVolClass) return;
    Object.entries(VOLATILITY_CLASSES).forEach(([key, cls]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${cls.label} (σ ~${cls.sigma} %)`;
        $investVolClass.appendChild(opt);
    });
    $investVolClass.value = DEFAULT_VOLATILITY_CLASS;
    $investVolClass.addEventListener('change', updateVolHint);
    updateVolHint();
})();

function updateVolHint() {
    if (!$investVolHint || !$investVolClass) return;
    const cls = VOLATILITY_CLASSES[$investVolClass.value] || VOLATILITY_CLASSES[DEFAULT_VOLATILITY_CLASS];
    const premium = (cls.sigma * 0.18).toFixed(1).replace('.', ',');
    $investVolHint.textContent = `σ ~${cls.sigma} % → riskipreemio ${premium} % (Sharpe-pohjainen). Käytetään Vertailu-näkymässä.`;
}
const $entityLinkedCategory = document.getElementById('entityLinkedCategory');
const $deleteEntityBtn = document.getElementById('deleteEntityBtn');
const $entityModalTitle = document.getElementById('entityModalTitle');

/** Show/hide type-specific fields */
function updateTypeFields() {
    const type = $entityType.value;
    document.querySelectorAll('.type-fields').forEach(el => {
        el.classList.toggle('visible', el.dataset.type === type);
    });
}

$entityType.addEventListener('change', updateTypeFields);

/** Populate the category link dropdown */
function populateCategorySelect(selectedId) {
    $entityLinkedCategory.innerHTML = '<option value="">— Ei linkitystä —</option>';
    state.categories.forEach(cat => {
        // Check if category is already linked to another entity
        const alreadyLinked = state.financialEntities.some(e =>
            e.linkedCategoryId === cat.id && e.id !== $entityFormId.value
        );
        if (alreadyLinked) return;

        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        if (cat.id === selectedId) opt.selected = true;
        $entityLinkedCategory.appendChild(opt);
    });
}

/** Populate the "redistribute to" dropdown with all entities except current */
function populateRedistributeTargets(currentEntityId, selectedId, selectEl) {
    selectEl.innerHTML = '<option value="">— Valitse —</option>';
    state.financialEntities.forEach(e => {
        if (e.id === currentEntityId) return;
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${entityTypeLabel(e.type)}: ${e.name}`;
        if (e.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

/** Reset form to defaults */
function resetEntityForm() {
    $entityFormId.value = '';
    $entityName.value = '';
    $entityType.value = '';
    $loanPrincipal.value = '';
    $loanInterest.value = '';
    $loanTerm.value = '';
    $loanStartDate.value = new Date().toISOString().slice(0, 10);
    $loanRedistribute.checked = false;
    $loanRedistributeRow.style.display = 'none';
    $loanRedistributeTarget.value = '';
    $savingsBalance.value = '';
    $savingsInterest.value = '';
    $savingsTarget.value = '';
    $savingsRedistribute.checked = false;
    $savingsRedistributeRow.style.display = 'none';
    $savingsRedistributeTarget.value = '';
    $investValue.value = '';
    $investGrowth.value = '';
    if ($investVolClass) {
        $investVolClass.value = DEFAULT_VOLATILITY_CLASS;
        updateVolHint();
    }
    $deleteEntityBtn.style.display = 'none';
    updateTypeFields();
}

$loanRedistribute.addEventListener('change', () => {
    $loanRedistributeRow.style.display = $loanRedistribute.checked ? '' : 'none';
});
$savingsRedistribute.addEventListener('change', () => {
    $savingsRedistributeRow.style.display = $savingsRedistribute.checked ? '' : 'none';
});

/** Open modal — pass entityId to edit, or null for new, optionally preLinkCategoryId */
function openEntityModal(entityId, preLinkCategoryId) {
    resetEntityForm();
    populateCategorySelect(preLinkCategoryId || '');
    populateRedistributeTargets(entityId || '', '', $loanRedistributeTarget);
    populateRedistributeTargets(entityId || '', '', $savingsRedistributeTarget);

    if (entityId) {
        // Edit mode
        const entity = state.financialEntities.find(e => e.id === entityId);
        if (!entity) return;

        $entityModalTitle.textContent = 'Muokkaa tiliä / velkaa';
        $entityFormId.value = entity.id;
        $entityName.value = entity.name;
        $entityType.value = entity.type;
        populateCategorySelect(entity.linkedCategoryId || '');
        $deleteEntityBtn.style.display = '';

        if (entity.type === 'loan') {
            $loanPrincipal.value = entity.principal;
            $loanInterest.value = entity.interestRate;
            $loanTerm.value = entity.termMonths;
            $loanStartDate.value = entity.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
            $loanRedistribute.checked = !!entity.redistributeOnDone;
            $loanRedistributeRow.style.display = entity.redistributeOnDone ? '' : 'none';
            populateRedistributeTargets(entity.id, entity.redistributeToId || '', $loanRedistributeTarget);
        } else if (entity.type === 'savings') {
            $savingsBalance.value = entity.balance;
            $savingsInterest.value = entity.interestRate;
            $savingsTarget.value = entity.targetAmount ?? '';
            $savingsRedistribute.checked = !!entity.redistributeOnDone;
            $savingsRedistributeRow.style.display = entity.redistributeOnDone ? '' : 'none';
            populateRedistributeTargets(entity.id, entity.redistributeToId || '', $savingsRedistributeTarget);
        } else if (entity.type === 'investment') {
            $investValue.value = entity.currentValue;
            $investGrowth.value = entity.growthRate;
            if ($investVolClass) {
                $investVolClass.value = VOLATILITY_CLASSES[entity.volatilityClass]
                    ? entity.volatilityClass
                    : DEFAULT_VOLATILITY_CLASS;
                updateVolHint();
            }
        }

        updateTypeFields();
    } else {
        $entityModalTitle.textContent = 'Uusi tili / velka';
    }

    $entityModal.showModal();
}

// Open modal from management button
document.getElementById('openEntityModal').addEventListener('click', () => openEntityModal(null));

// Close buttons
document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => $entityModal.close());
});

// Save entity
document.getElementById('saveEntityBtn').addEventListener('click', (e) => {
    e.preventDefault();

    const nameRaw = $entityName.value.trim();
    const type = $entityType.value;
    if (!type) {
        alert('Valitse tyyppi.');
        return;
    }
    // Nimi on optionaalin: jos käyttäjä jätti tyhjäksi, käytä tyypin oletusnimeä
    // ("Laina", "Säästö", "Sijoitus") + juokseva numero jotta ne erottuvat.
    let name = nameRaw;
    if (!name) {
        const typeLabel = type === 'loan' ? 'Laina' : type === 'savings' ? 'Säästö' : 'Sijoitus';
        const existingSameType = state.financialEntities.filter(e => e.type === type && (!$entityFormId.value || e.id !== $entityFormId.value));
        const num = existingSameType.length + 1;
        name = num > 1 ? `${typeLabel} ${num}` : typeLabel;
    }

    const linkedCategoryId = $entityLinkedCategory.value || null;
    const isEdit = !!$entityFormId.value;
    const id = isEdit ? $entityFormId.value : `fe-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Unlink old category if changing link
    if (isEdit) {
        const old = state.financialEntities.find(e => e.id === id);
        if (old && old.linkedCategoryId !== linkedCategoryId) {
            // Category freed up
        }
    }
    // Ensure no other entity uses this category
    if (linkedCategoryId) {
        state.financialEntities.forEach(e => {
            if (e.id !== id && e.linkedCategoryId === linkedCategoryId) {
                e.linkedCategoryId = null;
            }
        });
    }

    const base = { id, name, type, linkedCategoryId };

    if (type === 'loan') {
        base.principal = Math.max(0, Math.round(Number($loanPrincipal.value) || 0));
        base.interestRate = Math.max(0, Number($loanInterest.value) || 0);
        base.termMonths = Math.max(1, Math.round(Number($loanTerm.value) || 240));
        base.startDate = $loanStartDate.value || new Date().toISOString().slice(0, 10);
        base.redistributeOnDone = $loanRedistribute.checked;
        base.redistributeToId = $loanRedistribute.checked ? ($loanRedistributeTarget.value || null) : null;
        // Jos käyttäjä rastii redirectin mutta ei valitse kohdetta, tallennetaan
        // ilman redirectia hiljaisesti — älä pakota erillistä valintaa.
        if (base.redistributeOnDone && !base.redistributeToId) {
            base.redistributeOnDone = false;
        }
    } else if (type === 'savings') {
        base.balance = Math.max(0, Math.round(Number($savingsBalance.value) || 0));
        base.interestRate = Math.max(0, Number($savingsInterest.value) || 0);
        base.targetAmount = $savingsTarget.value === ''
            ? null
            : Math.max(0, Math.round(Number($savingsTarget.value) || 0));
        base.redistributeOnDone = $savingsRedistribute.checked;
        base.redistributeToId = $savingsRedistribute.checked ? ($savingsRedistributeTarget.value || null) : null;
        // Sama kuin lainassa: salli redirectin rastittaminen ilman kohteen
        // valintaa — tallennetaan ilman redirectia.
        if (base.redistributeOnDone && !base.redistributeToId) {
            base.redistributeOnDone = false;
        }
    } else if (type === 'investment') {
        base.currentValue = Math.max(0, Math.round(Number($investValue.value) || 0));
        base.growthRate = Math.max(0, Number($investGrowth.value) || 0);
        base.volatilityClass = VOLATILITY_CLASSES[$investVolClass?.value]
            ? $investVolClass.value
            : DEFAULT_VOLATILITY_CLASS;
    }

    if (isEdit) {
        const idx = state.financialEntities.findIndex(e => e.id === id);
        if (idx >= 0) state.financialEntities[idx] = base;
    } else {
        state.financialEntities.push(base);
    }

    $entityModal.close();
    renderAll();
    renderComparePage();
    refreshAssessmentIfOpen();
    saveState();
});

// Delete entity
document.getElementById('deleteEntityBtn').addEventListener('click', () => {
    const id = $entityFormId.value;
    if (!id) return;
    const entity = state.financialEntities.find(e => e.id === id);
    if (!entity) return;
    if (!confirm(`Poistetaanko "${entity.name}"?`)) return;

    state.financialEntities = state.financialEntities.filter(e => e.id !== id);
    $entityModal.close();
    renderAll();
    renderComparePage();
    refreshAssessmentIfOpen();
    saveState();
});

// ============================================================================
// FUTURE PLANNING PAGE
// ============================================================================

/**
 * Walk the redistribute chain to find an active recipient at month `m`.
 * Returns null if no active recipient exists (chain dead-ends or loops).
 */
function findActiveRedistributeTarget(simEntity, simById, m, visited = new Set()) {
    if (!simEntity.redistributeToId) return null;
    if (visited.has(simEntity.id)) return null;
    visited.add(simEntity.id);
    const target = simById.get(simEntity.redistributeToId);
    if (!target) return null;
    if (target.doneAtMonth === null || target.doneAtMonth >= m) return target;
    return findActiveRedistributeTarget(target, simById, m, visited);
}

/**
 * Simulate all financial entities month by month for `maxMonths` months.
 * Handles redistribution: when a loan is paid off or a savings target is
 * reached, the freed monthly contribution flows to the configured target.
 * Returns array of simulation records with snapshots at 5/10/20 years.
 */
function simulateAll(maxMonths = 480) {
    const sim = state.financialEntities.map(e => {
        const initialBalance = e.type === 'loan'
            ? e.principal
            : e.type === 'savings'
                ? e.balance
                : e.currentValue;
        const initialMonthly = getLinkedMonthlyAmount(e);
        return {
            id: e.id,
            type: e.type,
            name: e.name,
            rate: (e.type === 'investment' ? e.growthRate : e.interestRate) || 0,
            balance: initialBalance,
            initialMonthly,
            monthly: initialMonthly,
            targetAmount: e.type === 'savings' ? (e.targetAmount || null) : null,
            redistributeToId: e.redistributeOnDone ? (e.redistributeToId || null) : null,
            doneAtMonth: null,
            totalInterest: 0,
            totalPaid: 0,
            receivedFrom: [],
            snapshots: {},
        };
    });

    const simById = new Map(sim.map(s => [s.id, s]));
    const snapshotMonths = new Set([60, 120, 240]);

    for (let m = 1; m <= maxMonths; m++) {
        sim.forEach(s => {
            const monthlyRate = s.rate / 100 / 12;
            if (s.doneAtMonth !== null) {
                // Investments keep compounding even after target loans/savings finish;
                // loans/savings that are done sit at their final balance.
                if (s.type === 'investment') {
                    s.balance += s.balance * monthlyRate;
                }
                return;
            }

            if (s.type === 'loan') {
                const interest = s.balance * monthlyRate;
                s.totalInterest += interest;
                const payment = Math.min(s.monthly, s.balance + interest);
                s.balance = s.balance + interest - payment;
                s.totalPaid += payment;
                if (s.balance <= 0.01) {
                    s.balance = 0;
                    s.doneAtMonth = m;
                }
            } else if (s.type === 'savings') {
                const interest = s.balance * monthlyRate;
                s.balance += interest + s.monthly;
                if (s.targetAmount && s.balance >= s.targetAmount) {
                    s.balance = s.targetAmount;
                    s.doneAtMonth = m;
                }
            } else if (s.type === 'investment') {
                const growth = s.balance * monthlyRate;
                s.balance += growth + s.monthly;
            }
        });

        // Redistribute freed contributions to their chain target.
        sim.forEach(s => {
            if (s.doneAtMonth !== m) return;
            if (s.monthly <= 0) return;
            const target = findActiveRedistributeTarget(s, simById, m);
            if (target) {
                target.monthly += s.monthly;
                target.receivedFrom.push({ id: s.id, month: m, amount: s.monthly });
            }
            s.monthly = 0;
        });

        sim.forEach(s => {
            if (snapshotMonths.has(m)) s.snapshots[m] = Math.round(s.balance);
        });
    }

    return sim;
}

function monthsToDateLabel(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 7);
}

function renderFuturePage() {
    const container = document.getElementById('entityCards');
    const empty = document.getElementById('entityCardsEmpty');
    const entities = state.financialEntities;

    if (entities.length === 0) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = '';

    const sim = simulateAll(40 * 12);
    const simById = new Map(sim.map(s => [s.id, s]));
    const entityById = new Map(entities.map(e => [e.id, e]));

    entities.forEach(entity => {
        const s = simById.get(entity.id);
        const card = document.createElement('div');
        card.className = 'entity-card';

        const header = document.createElement('div');
        header.className = 'entity-card-header';
        header.innerHTML = `
            <h3>${escapeAttr(entity.name)}</h3>
            <span class="entity-type-tag ${entity.type}">${entityTypeLabel(entity.type)}</span>
            <button type="button" class="entity-card-edit" data-action="edit-entity" data-entity-id="${escapeAttr(entity.id)}" title="Muokkaa">✎</button>
        `;
        card.appendChild(header);

        const meta = document.createElement('div');
        meta.className = 'entity-card-meta';
        if (entity.type === 'loan') {
            meta.innerHTML = `
                <span>Pääoma: <strong>${euro(entity.principal)}</strong></span>
                <span>Korko: <strong>${entity.interestRate} %</strong></span>
                <span>Takaisinmaksuaika: <strong>${entity.termMonths} kk</strong></span>
            `;
        } else if (entity.type === 'savings') {
            meta.innerHTML = `
                <span>Saldo: <strong>${euro(entity.balance)}</strong></span>
                <span>Korko: <strong>${entity.interestRate} %</strong></span>
                ${entity.targetAmount ? `<span>Tavoite: <strong>${euro(entity.targetAmount)}</strong></span>` : ''}
            `;
        } else if (entity.type === 'investment') {
            meta.innerHTML = `
                <span>Arvo: <strong>${euro(entity.currentValue)}</strong></span>
                <span>Tuotto: <strong>${entity.growthRate} %</strong></span>
            `;
        }
        card.appendChild(meta);

        const proj = document.createElement('div');
        proj.className = 'entity-projection';

        const initialMonthly = s.initialMonthly;
        const hasIncoming = s.receivedFrom.length > 0;
        const hasContribution = initialMonthly > 0 || hasIncoming;

        if (entity.type === 'loan') {
            if (initialMonthly > 0) {
                if (s.doneAtMonth) {
                    proj.innerHTML = `
                        <div class="proj-row">
                            <span class="proj-label">Kuukausierä (budjetista)</span>
                            <span class="proj-value">${euro(initialMonthly)}</span>
                        </div>
                        <div class="proj-row">
                            <span class="proj-label">Laina maksettu</span>
                            <span class="proj-value positive">${monthsToDateLabel(s.doneAtMonth)} (${s.doneAtMonth} kk)</span>
                        </div>
                        <div class="proj-row">
                            <span class="proj-label">Maksettu yhteensä</span>
                            <span class="proj-value">${euro(s.totalPaid)}</span>
                        </div>
                        <div class="proj-row">
                            <span class="proj-label">Korkokulut yhteensä</span>
                            <span class="proj-value warning">${euro(s.totalInterest)}</span>
                        </div>
                    `;
                } else {
                    proj.innerHTML = `
                        <div class="proj-row">
                            <span class="proj-label">Kuukausierä (budjetista)</span>
                            <span class="proj-value">${euro(initialMonthly)}</span>
                        </div>
                        <div class="proj-row">
                            <span class="proj-label">⚠️</span>
                            <span class="proj-value negative">Erierä ei riitä kattamaan korkoja — laina ei lyhene</span>
                        </div>
                    `;
                }
            } else {
                proj.innerHTML = `<span class="no-link-note">Linkitä budjettiin nähdäksesi lainan lyhennysennusteen</span>`;
            }
        } else if (entity.type === 'savings') {
            if (hasContribution) {
                const years = [5, 10, 20];
                const yearsHtml = years.map(y => {
                    const val = s.snapshots[y * 12] ?? Math.round(s.balance);
                    return `<div class="proj-row"><span class="proj-label">${y} vuoden päästä</span><span class="proj-value positive">${euro(val)}</span></div>`;
                }).join('');
                const targetReachedHtml = (entity.targetAmount && s.doneAtMonth)
                    ? `<div class="proj-row"><span class="proj-label">Tavoite saavutettu</span><span class="proj-value positive">${monthsToDateLabel(s.doneAtMonth)} (${s.doneAtMonth} kk)</span></div>`
                    : '';
                proj.innerHTML = `
                    <div class="proj-row">
                        <span class="proj-label">Kuukausisäästö (budjetista)</span>
                        <span class="proj-value">${euro(initialMonthly)}</span>
                    </div>
                    ${targetReachedHtml}
                    ${yearsHtml}
                `;
            } else {
                proj.innerHTML = `<span class="no-link-note">Linkitä budjettiin nähdäksesi säästöennusteen</span>`;
            }
        } else if (entity.type === 'investment') {
            if (hasContribution) {
                const years = [5, 10, 20];
                const yearsHtml = years.map(y => {
                    const val = s.snapshots[y * 12] ?? Math.round(s.balance);
                    return `<div class="proj-row"><span class="proj-label">${y} vuoden päästä</span><span class="proj-value positive">${euro(val)}</span></div>`;
                }).join('');
                proj.innerHTML = `
                    <div class="proj-row">
                        <span class="proj-label">Kuukausisijoitus (budjetista)</span>
                        <span class="proj-value">${euro(initialMonthly)}</span>
                    </div>
                    ${yearsHtml}
                `;
            } else {
                proj.innerHTML = `<span class="no-link-note">Linkitä budjettiin nähdäksesi sijoitusennusteen</span>`;
            }
        }

        // Redistribution annotations
        const redistRows = [];
        if (entity.redistributeOnDone && entity.redistributeToId) {
            const target = entityById.get(entity.redistributeToId);
            if (target) {
                const whenLabel = entity.type === 'loan' ? 'maksun jälkeen' : 'tavoitteen jälkeen';
                redistRows.push(`<div class="proj-row redist-row"><span class="proj-label">↪ Ohjataan ${whenLabel}</span><span class="proj-value">${escapeAttr(target.name)} (${euro(initialMonthly)}/kk)</span></div>`);
            }
        }
        s.receivedFrom.forEach(r => {
            const src = entityById.get(r.id);
            if (src) {
                redistRows.push(`<div class="proj-row redist-row"><span class="proj-label">← Vastaanottaa: ${escapeAttr(src.name)}</span><span class="proj-value">${monthsToDateLabel(r.month)} (+${euro(r.amount)}/kk)</span></div>`);
            }
        });
        if (redistRows.length) {
            proj.insertAdjacentHTML('beforeend', redistRows.join(''));
        }

        card.appendChild(proj);
        container.appendChild(card);

        header.querySelector('[data-action="edit-entity"]').addEventListener('click', () => {
            openEntityModal(entity.id);
        });
    });
}

// ============================================================================
// COMPARE PAGE (Vertailu)
// ============================================================================

const $compareLoanSelect = document.getElementById('compareLoanSelect');
const $compareLoanInfo = document.getElementById('compareLoanInfo');
const $compareInvestList = document.getElementById('compareInvestList');
const $compareShiftSliderLoan = document.getElementById('compareShiftSliderLoan');
const $compareShiftSliderInvest = document.getElementById('compareShiftSliderInvest');
const $compareShiftValue = document.getElementById('compareShiftValue');
const $compareShiftMaxLoan = document.getElementById('compareShiftMaxLoan');
const $compareShiftMaxInvest = document.getElementById('compareShiftMaxInvest');
const $compareReleaseToggle = document.getElementById('compareReleaseToggle');
const $compareReleaseToggleWrap = document.getElementById('compareReleaseToggleWrap');
const $compareRiskSlider = document.getElementById('compareRiskSlider');
const $compareRiskValue = document.getElementById('compareRiskValue');
const $compareRiskLock = document.getElementById('compareRiskLock');
const $compareScenarios = document.getElementById('compareScenarios');
const $compareChart = document.getElementById('compareChart');
const $compareBody = document.getElementById('compareBody');
const $compareEmpty = document.getElementById('compareEmpty');
const $compareHorizonSlider = document.getElementById('compareHorizonSlider');
const $compareHorizonValue = document.getElementById('compareHorizonValue');
const $compareAssessBtn = document.getElementById('compareAssessBtn');
const $compareAssessment = document.getElementById('compareAssessment');
const $compareSummary = document.getElementById('compareSummary');
const $compareApplyCta = document.getElementById('compareApplyCta');
const $compareChartTitle = document.getElementById('compareChartTitle');

const COMPARE_LOAN_COLOR = '#f59e0b';
const COMPARE_NETWORTH_COLOR = '#4f46e5';
const COMPARE_GHOST_COLOR = '#94a3b8';

// Risk premium is now derived per-entity from its volatilityClass (see
// VOLATILITY_CLASSES and getEntityRiskPremium near the top of this file).

function getEntityColor(entity, fallbackIdx) {
    const cat = state.categories.find(c => c.id === entity?.linkedCategoryId);
    if (cat && cat.color) return cat.color;
    return PALETTE[fallbackIdx % PALETTE.length];
}

const compareState = {
    loanId: null,
    investIds: [],
    shift: 0,
    risk: 5,
    riskLocked: false,
    horizonYears: 20,
    releaseProtected: false,
};

function getInvestRate(entity) {
    if (!entity) return 0;
    return entity.type === 'savings' ? (entity.interestRate || 0) : (entity.growthRate || 0);
}

function getInvestBalance(entity) {
    if (!entity) return 0;
    return entity.type === 'savings' ? (entity.balance || 0) : (entity.currentValue || 0);
}

/**
 * Month-by-month simulation of one loan + N sijoitus/säästö entities.
 *
 * Honors the user-configured redistribution chain (entity.redistributeOnDone +
 * .redistributeToId) and savings.targetAmount caps:
 *   - Loan paid off → original loan monthly flows to its configured target.
 *     Temporary extra money shifted from investments to the loan returns to the
 *     original investment mix, so loan-focused scenarios don't silently turn
 *     every selected investment into the loan's redirect target.
 *   - Savings reaches target → balance capped; overshoot + future monthly
 *     flow to the configured target.
 *   - If no redistribution is configured, the freed monthly cash stops in this
 *     scenario (matching the Future page semantics).
 *   - If a configured target is NOT in the comparison, fall back to proportional
 *     split among remaining active investments so the comparison can still keep
 *     the selected budget in play.
 *
 * Investments get full risk adjustment; savings stay deterministic.
 * Returns { points: [{m, loan, inv, invs, interest}], payoffMonth, totalInterest }.
 */
function simulateScenario(loan, investments, loanMonthly, investMonthlies, riskAdj, maxMonths, options = {}) {
    // Build per-entity simulation state. Order is [loan, ...investments].
    const loanSim = {
        id: loan.id,
        isLoan: true,
        type: 'loan',
        balance: loan.principal,
        monthly: Math.max(0, loanMonthly),
        rate: (loan.interestRate || 0) / 100 / 12,
        targetAmount: null,
        redistributeToId: loan.redistributeOnDone ? (loan.redistributeToId || null) : null,
        redistributeMonthlyCap: Math.max(0, options.baseLoanMonthly ?? loanMonthly),
        doneAtMonth: null,
    };
    const investSims = investments.map((inv, i) => {
        const baseRate = getInvestRate(inv);
        const adj = typeof riskAdj === 'function' ? riskAdj(inv) : riskAdj;
        const adjRate = inv.type === 'investment' ? Math.max(0, baseRate + adj) : baseRate;
        return {
            id: inv.id,
            isLoan: false,
            type: inv.type,
            balance: getInvestBalance(inv),
            monthly: Math.max(0, investMonthlies[i]),
            rate: adjRate / 100 / 12,
            targetAmount: inv.type === 'savings' ? (inv.targetAmount || null) : null,
            redistributeToId: inv.redistributeOnDone ? (inv.redistributeToId || null) : null,
            doneAtMonth: null,
            idx: i, // preserve original array index for points.invs
        };
    });
    const simById = new Map([loanSim, ...investSims].map(s => [s.id, s]));
    const investSimById = new Set(investSims.map(s => s.id));

    let totalInterest = 0;

    // Resolve redistribute target chain to first active entity that IS in our
    // sim's investments. Returns null if target unreachable / not in sim.
    const resolveTarget = (fromSim, m) => {
        const visited = new Set();
        let cur = fromSim;
        while (cur && cur.redistributeToId && !visited.has(cur.id)) {
            visited.add(cur.id);
            const next = simById.get(cur.redistributeToId);
            if (!next) return null;
            if (investSimById.has(next.id) && (next.doneAtMonth === null || next.doneAtMonth >= m)) {
                return next;
            }
            cur = next;
        }
        return null;
    };

    // Fallback: split `amount` proportionally among still-active investments,
    // weighted by current monthly. Returns array of {sim, amount} for instant
    // balance bumps (used for same-month leftovers).
    const proportionalSplit = (amount, excludeId) => {
        const active = investSims.filter(s => s.doneAtMonth === null && s.id !== excludeId);
        const totalMonthly = active.reduce((sum, s) => sum + s.monthly, 0);
        if (active.length === 0) return [];
        if (totalMonthly > 0) {
            return active.map(s => ({ sim: s, amount: amount * (s.monthly / totalMonthly) }));
        }
        const each = amount / active.length;
        return active.map(s => ({ sim: s, amount: each }));
    };
    const routeToProportional = (amount, excludeId) => {
        proportionalSplit(amount, excludeId).forEach(({ sim, amount: a }) => {
            sim.balance += a;
        });
    };
    const addMonthlyProportional = (amount, excludeId) => {
        proportionalSplit(amount, excludeId).forEach(({ sim, amount: a }) => {
            sim.monthly += a;
        });
    };
    const returnShiftToOriginalInvests = (amount, mode) => {
        const weights = options.shiftReturnWeights || [];
        const active = investSims
            .map((sim, i) => ({ sim, weight: Math.max(0, weights[i] || 0) }))
            .filter(x => x.weight > 0 && x.sim.doneAtMonth === null);
        const totalWeight = active.reduce((sum, x) => sum + x.weight, 0);
        if (totalWeight <= 0) {
            if (mode === 'balance') routeToProportional(amount, null);
            else addMonthlyProportional(amount, null);
            return;
        }
        active.forEach(({ sim, weight }) => {
            const part = amount * (weight / totalWeight);
            if (mode === 'balance') sim.balance += part;
            else sim.monthly += part;
        });
    };
    const splitRedirectAmounts = (s, amount) => {
        if (!s.isLoan) return { configured: amount, proportional: 0 };
        const cap = Math.max(0, Math.min(s.redistributeMonthlyCap ?? s.monthly, s.monthly));
        if (s.monthly <= 0 || cap >= s.monthly) return { configured: amount, proportional: 0 };
        const configured = amount * (cap / s.monthly);
        return { configured, proportional: amount - configured };
    };

    const sumInvs = () => investSims.reduce((s, x) => s + x.balance, 0);
    const invsArr = () => investSims.map(x => x.balance);
    const points = [{ m: 0, loan: loanSim.balance, inv: sumInvs(), invs: invsArr(), interest: 0 }];

    for (let m = 1; m <= maxMonths; m++) {
        // 1) Run monthly cycle for each entity, collect "freed this month"
        //    items (loan leftover, savings overshoot) for immediate routing.
        const freedThisMonth = []; // { from, amount }
        const newlyDone = [];      // entities that finished this month

        // Loan
        if (loanSim.doneAtMonth === null) {
            const interest = loanSim.balance * loanSim.rate;
            totalInterest += interest;
            const payment = Math.min(loanSim.monthly, loanSim.balance + interest);
            loanSim.balance = loanSim.balance + interest - payment;
            if (loanSim.balance <= 0.01) {
                loanSim.balance = 0;
                loanSim.doneAtMonth = m;
                const leftover = loanSim.monthly - payment;
                if (leftover > 0) freedThisMonth.push({ from: loanSim, amount: leftover });
                newlyDone.push(loanSim);
            }
        }

        // Investments / savings
        investSims.forEach(s => {
            if (s.doneAtMonth !== null) {
                // Done savings sit at target; done investments keep compounding
                // (in this sim we don't mark investments "done", so this only
                // affects already-capped savings — they just sit at target).
                if (s.type === 'investment') s.balance += s.balance * s.rate;
                return;
            }
            const interest = s.balance * s.rate;
            const newBalance = s.balance + interest + s.monthly;
            if (s.type === 'savings' && s.targetAmount && newBalance >= s.targetAmount) {
                const overshoot = newBalance - s.targetAmount;
                s.balance = s.targetAmount;
                s.doneAtMonth = m;
                if (overshoot > 0) freedThisMonth.push({ from: s, amount: overshoot });
                newlyDone.push(s);
            } else {
                s.balance = newBalance;
            }
        });

        // 2) Route same-month freed cash to redistribute targets (or fallback)
        freedThisMonth.forEach(({ from, amount }) => {
            if (!from.redistributeToId) return;
            const split = splitRedirectAmounts(from, amount);
            const target = resolveTarget(from, m);
            if (target && split.configured > 0) {
                target.balance += split.configured;
            } else if (split.configured > 0) {
                routeToProportional(split.configured, from.id);
            }
            if (split.proportional > 0) {
                if (from.isLoan) returnShiftToOriginalInvests(split.proportional, 'balance');
                else routeToProportional(split.proportional, from.id);
            }
        });

        // 3) Hand off future monthly contributions for entities that finished
        //    this month (only after the same-month routing above — order matters
        //    so a newly-done entity's own monthly isn't sent to itself).
        newlyDone.forEach(s => {
            if (s.monthly <= 0) return;
            if (!s.redistributeToId) {
                s.monthly = 0;
                return;
            }
            const split = splitRedirectAmounts(s, s.monthly);
            const target = resolveTarget(s, m);
            if (target && split.configured > 0) {
                target.monthly += split.configured;
            } else if (split.configured > 0) {
                addMonthlyProportional(split.configured, s.id);
            }
            if (split.proportional > 0) {
                if (s.isLoan) returnShiftToOriginalInvests(split.proportional, 'monthly');
                else addMonthlyProportional(split.proportional, s.id);
            }
            s.monthly = 0;
        });

        points.push({ m, loan: loanSim.balance, inv: sumInvs(), invs: invsArr(), interest: totalInterest });
    }

    return {
        points,
        payoffMonth: loanSim.doneAtMonth,
        totalInterest: Math.round(totalInterest),
    };
}

function populateCompareLoanSelect() {
    const loans = state.financialEntities.filter(e => e.type === 'loan');
    $compareLoanSelect.innerHTML = '<option value="">— Valitse —</option>';
    loans.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.name;
        $compareLoanSelect.appendChild(opt);
    });
    if (!loans.some(l => l.id === compareState.loanId)) compareState.loanId = loans[0]?.id || null;
    $compareLoanSelect.value = compareState.loanId || '';

    const loan = state.financialEntities.find(e => e.id === compareState.loanId);
    $compareLoanInfo.textContent = loan
        ? `${loan.interestRate} % korko • ${euro(getLinkedMonthlyAmount(loan))}/kk budjetista`
        : 'Ei valittu';
}

function populateCompareInvestList() {
    const invests = state.financialEntities.filter(e => e.type === 'investment' || e.type === 'savings');
    if (invests.length === 0) {
        $compareInvestList.innerHTML = '<div class="compare-info">Lisää säästö- tai sijoitustili Budjetti-sivulla.</div>';
        return;
    }
    // Auto-select all on first load if nothing chosen
    if (compareState.investIds.length === 0) {
        compareState.investIds = invests.map(e => e.id);
    } else {
        // Prune any IDs that no longer exist
        compareState.investIds = compareState.investIds.filter(id => invests.some(e => e.id === id));
    }
    $compareInvestList.innerHTML = invests.map(e => {
        const monthly = getLinkedMonthlyAmount(e);
        const checked = compareState.investIds.includes(e.id);
        const rate = e.type === 'savings' ? e.interestRate : e.growthRate;
        return `
            <label class="compare-invest-item">
                <input type="checkbox" data-id="${escapeAttr(e.id)}" ${checked ? 'checked' : ''}>
                <span class="invest-item-name">${escapeAttr(e.name)}</span>
                <span class="invest-item-type ${e.type}">${entityTypeLabel(e.type)}</span>
                <span class="invest-item-meta">${rate} % • ${euro(monthly)}/kk</span>
            </label>
        `;
    }).join('');
}

function compareValueDelta(value, baseline, opts = {}) {
    const diff = value - baseline;
    if (Math.abs(diff) < 0.5) return '';
    const cls = (opts.invert ? -diff : diff) >= 0 ? 'positive' : 'negative';
    const sign = diff > 0 ? '+' : '−';
    return `<span class="compare-delta ${cls}">${sign}${euro(Math.abs(diff))} vs. nyk.</span>`;
}

function renderCompareSummary(loan, investments, baseLoanMonthly, baseInvMonthlies, signedShift, releaseProtected = false) {
    // Show the MONTHLY allocations under the current slider position
    // Signed shift convention: positive = move to investments, negative = move to loan
    const totalInvMonthly = baseInvMonthlies.reduce((s, m) => s + m, 0);
    const magnitude = Math.abs(signedShift);
    const monthlies = buildScenarioMonthlies(baseLoanMonthly, investments, baseInvMonthlies, magnitude, releaseProtected);
    const active = signedShift > 0
        ? monthlies.investFocus
        : signedShift < 0
            ? monthlies.loanFocus
            : monthlies.baseline;
    const newLoanMonthly = active.loan;
    const newInvMonthly = active.invs.reduce((s, m) => s + m, 0);
    const loanDelta = newLoanMonthly - baseLoanMonthly;
    const invDelta = newInvMonthly - totalInvMonthly;

    const fmtDelta = (d) => {
        if (Math.abs(d) < 0.5) return '';
        const cls = d > 0 ? 'positive' : 'negative';
        const sign = d > 0 ? '+' : '−';
        return `<span class="compare-summary-delta ${cls}">${sign}${euro(Math.abs(d))}/kk</span>`;
    };

    $compareSummary.innerHTML = `
        <div class="compare-summary-item loan">
            <span class="compare-summary-label">Laina (${escapeAttr(loan.name)})</span>
            <span class="compare-summary-value">${euro(newLoanMonthly)} /kk ${fmtDelta(loanDelta)}</span>
        </div>
        <div class="compare-summary-item invest">
            <span class="compare-summary-label">Sijoitukset yhteensä (${investments.length} kpl)</span>
            <span class="compare-summary-value">${euro(newInvMonthly)} /kk ${fmtDelta(invDelta)}</span>
        </div>
    `;
}

function renderImpactBox(scenarios, riskBands, signedShift, horizonYears, riskPct, investments) {
    const horizonMonths = horizonYears * 12;
    const activeKey = signedShift > 0 ? 'investFocus' : signedShift < 0 ? 'loanFocus' : 'baseline';
    const active = scenarios[activeKey];
    const baseline = scenarios.baseline;
    const activePoint = active.points[horizonMonths];
    const baselinePoint = baseline.points[horizonMonths];
    const lowPoint = riskBands[activeKey].low.points[horizonMonths];
    const highPoint = riskBands[activeKey].high.points[horizonMonths];
    const lowMult = riskBands[activeKey].lowMultiplier ?? 1;
    const highMult = riskBands[activeKey].highMultiplier ?? 1;

    const activeNet = activePoint.inv - activePoint.loan;
    const baselineNet = baselinePoint.inv - baselinePoint.loan;
    const lowNet = lowPoint.inv - lowPoint.loan;
    const highNet = highPoint.inv - highPoint.loan;

    // All three deltas measured at the SAME horizon point so the rows are
    // internally consistent. Earlier impl. used total lifetime interest, which
    // didn't add up with the other (horizon-based) rows.
    const interestDelta = (activePoint.interest || 0) - (baselinePoint.interest || 0);
    const investDelta = activePoint.inv - baselinePoint.inv;
    const loanBalanceDelta = activePoint.loan - baselinePoint.loan;
    const netDelta = activeNet - baselineNet;

    const shiftAbs = Math.abs(signedShift);
    const title = signedShift > 0
        ? `Skenaario: Sijoituksiin +${euro(shiftAbs)} /kk`
        : signedShift < 0
            ? `Skenaario: Lainaan +${euro(shiftAbs)} /kk`
            : 'Nykyinen jako';

    const payoffLabel = active.payoffMonth ? `${active.payoffMonth} kk` : '> 360 kk';
    const payoffDelta = (signedShift !== 0 && active.payoffMonth && baseline.payoffMonth)
        ? (() => {
            const diff = active.payoffMonth - baseline.payoffMonth;
            if (Math.abs(diff) < 1) return '';
            const cls = diff < 0 ? 'positive' : 'negative';
            const sign = diff > 0 ? '+' : '−';
            return `<span class="impact-delta ${cls}">${sign}${Math.abs(diff)} kk vs. nyk.</span>`;
        })()
        : '';

    const signedDelta = (val, opts = {}) => {
        const rounded = Math.round(val);
        if (rounded === 0) return `<span class="impact-value">0 €</span>`;
        const cls = (opts.invert ? -val : val) >= 0 ? 'positive' : 'negative';
        const sign = rounded > 0 ? '+' : '−';
        return `<span class="impact-value ${cls}">${sign}${euro(Math.abs(rounded))}</span>`;
    };

    // Trade-off rows only when there's a shift to compare.
    // Identity: netDelta = investDelta - loanBalanceDelta, so we show invest
    // change + loan-balance change (signed so reduction is positive for wealth)
    // → they add up cleanly to nettovaikutus. Korkokulujen muutos näytetään
    // informaatiomielessä (kertoo MIKSI saldo on muuttunut näin paljon — osa
    // maksuista meni korkoihin).
    let tradeOff = '';
    if (signedShift !== 0) {
        tradeOff = `
            <div class="impact-tradeoff">
                <div class="impact-tradeoff-title">Vaikutus vs. nykyinen jako (${horizonYears} v)</div>
                <div class="impact-row">
                    <span class="impact-label">Sijoitussaldon muutos</span>
                    ${signedDelta(investDelta)}
                </div>
                <div class="impact-row">
                    <span class="impact-label">Lainasaldon muutos</span>
                    ${signedDelta(-loanBalanceDelta)}
                </div>
                <div class="impact-row strong">
                    <span class="impact-label">Nettovaikutus</span>
                    ${signedDelta(netDelta)}
                </div>
                <div class="impact-row impact-row-note">
                    <span class="impact-label">josta lainan korkoja ${horizonYears} v aikana</span>
                    ${signedDelta(interestDelta, { invert: true })}
                </div>
            </div>
        `;
    }

    // Risk direction label
    const investExposure = activePoint.invs.reduce((s, v) => s + v, 0) / (activePoint.inv + 1);
    const directionLabel = signedShift > 0
        ? 'Sijoituspainotteinen'
        : signedShift < 0
            ? 'Lainanlyhennyspainotteinen'
            : 'Tasapainoinen';

    // Per-entity breakdown rows
    const entityRows = investments.map((inv, idx) => {
        const val = activePoint.invs[idx] || 0;
        const rate = getInvestRate(inv);
        const typeLabel = entityTypeLabel(inv.type);
        const color = typeLabel === 'Säästö' ? '#10b981' : '#3b82f6';
        return `<div class="impact-row"><span class="impact-label" style="color:${color}">${escapeAttr(inv.name)} <span class="entity-type-tag-sm">${typeLabel}</span></span><span class="impact-value">${euro(Math.round(val))}</span></div>`;
    });
    const totalInvVal = activePoint.inv;
    const entitySummary = entityRows.length > 0
        ? `<div class="impact-entity-breakdown">${entityRows.join('')}<div class="impact-row strong"><span class="impact-label">Sijoitukset yhteensä</span><span class="impact-value">${euro(Math.round(totalInvVal))}</span></div></div>`
        : '';

    const directionCls = signedShift > 0 ? 'invest' : signedShift < 0 ? 'loan' : 'neutral';

    $compareScenarios.innerHTML = `
        <div class="impact-box ${directionCls}">
            <div class="impact-header">
                <span class="impact-scenario-name">${title}</span>
                <span class="impact-scenario-horizon">${horizonYears} vuoden päästä</span>
            </div>
            <div class="impact-direction-tag">${directionLabel}</div>
            <div class="impact-headline">
                <div class="impact-net-label">Arvioitu nettovarallisuus</div>
                <div class="impact-net-value">${euro(Math.round(activeNet))}</div>
                <div class="impact-net-range">
                    <span class="impact-range-tag">${(() => {
                        const lowPct = (riskPct * lowMult).toFixed(1).replace(/\.0$/, '').replace('.', ',');
                        const highPct = (riskPct * highMult).toFixed(1).replace(/\.0$/, '').replace('.', ',');
                        if (Math.abs(lowMult - 1) < 0.01 && Math.abs(highMult - 1) < 0.01) {
                            return `Riskialue ±${riskPct} %`;
                        }
                        const leverageNote = lowMult > 1.01
                            ? ` <span class="impact-leverage-note" title="Velkavipu: pidät enemmän lainaa pidempään, joten alasuunta on vakavampi">⚠ vipu</span>`
                            : lowMult < 0.99
                                ? ` <span class="impact-leverage-note" title="Olet vähentänyt velkavipua">↓ vivutettu</span>`
                                : '';
                        return `Riskialue −${lowPct} % / +${highPct} %${leverageNote}`;
                    })()}</span>
                    <strong>${euro(Math.round(lowNet))}</strong>
                    <span class="impact-range-sep">–</span>
                    <strong>${euro(Math.round(highNet))}</strong>
                </div>
            </div>
            ${entitySummary}
            <div class="impact-meta">
                <div class="impact-row">
                    <span class="impact-label">Laina maksettu</span>
                    <span class="impact-value">${payoffLabel}${payoffDelta}</span>
                </div>
            </div>
            ${tradeOff}
        </div>
    `;
}

function renderCompareCta(signedShift) {
    const shift = Math.abs(signedShift);
    $compareApplyCta.classList.remove('loan-direction', 'invest-direction');
    if (shift === 0) {
        $compareApplyCta.disabled = true;
        $compareApplyCta.textContent = 'Liikuta liukuria nähdäksesi suunnitelma';
        $compareApplyCta.dataset.direction = '';
        return;
    }
    $compareApplyCta.disabled = false;
    if (signedShift > 0) {
        $compareApplyCta.classList.add('invest-direction');
        $compareApplyCta.textContent = `Toteuta: Sijoituksiin +${euro(shift)} /kk →`;
        $compareApplyCta.dataset.direction = 'invest';
    } else {
        $compareApplyCta.classList.add('loan-direction');
        $compareApplyCta.textContent = `Toteuta: Lainaan +${euro(shift)} /kk →`;
        $compareApplyCta.dataset.direction = 'loan';
    }
}

/**
 * Chart shows the breakdown of ONE active scenario:
 *   - loan balance trajectory (orange)
 *   - one line per selected investment (linked-category color)
 *   - total net worth (indigo, thick)
 *   - dashed gray ghost: baseline net worth (only when active != baseline)
 *   - risk band (filled polygon) on the total net worth of the active scenario
 *   - circle marker on the net-worth line at loan-payoff month
 */
function renderCompareChart(scenarios, riskBands, loan, investments, signedShift, horizonYears, riskPct) {
    const horizonMonths = horizonYears * 12;
    const activeKey = signedShift > 0 ? 'investFocus' : signedShift < 0 ? 'loanFocus' : 'baseline';
    const active = scenarios[activeKey];
    const activeBand = riskBands[activeKey];
    const baseline = scenarios.baseline;
    const showGhost = activeKey !== 'baseline';

    // Mobile-tilassa käytetään pienempää viewBoxia + suurempaa fonttia jotta
    // teksti pysyy luettavana kun chart skaalataan ~360px leveydeksi.
    const isMobile = window.innerWidth < 640;
    const W = isMobile ? 440 : 820;
    const H = isMobile ? 360 : 400;
    const margin = isMobile
        ? { top: 24, right: 12, bottom: 84, left: 56 }
        : { top: 28, right: 24, bottom: 70, left: 86 };
    const fs = {
        axis: isMobile ? 14 : 11,
        legend: isMobile ? 14 : 12,
        tip: isMobile ? 13 : 11,
    };
    const cw = W - margin.left - margin.right;
    const ch = H - margin.top - margin.bottom;

    const clip = (pts) => pts.filter(p => p.m <= horizonMonths);
    const activePts = clip(active.points);
    const baselinePts = clip(baseline.points);
    const bandHi = clip(activeBand.high.points);
    const bandLo = clip(activeBand.low.points);

    // Y range — net worth + each investment + ghost net worth + risk band
    // We deliberately don't include p.loan separately because the loan
    // balance line was dropped (user request: only show payoff, not curve).
    let yMin = 0, yMax = 0;
    const observe = (v) => { if (v < yMin) yMin = v; if (v > yMax) yMax = v; };
    activePts.forEach(p => {
        observe(p.inv - p.loan);
        p.invs.forEach(observe);
    });
    if (showGhost) baselinePts.forEach(p => observe(p.inv - p.loan));
    bandHi.forEach(p => observe(p.inv - p.loan));
    bandLo.forEach(p => observe(p.inv - p.loan));
    const yPad = Math.max(1, (yMax - yMin) * 0.06);
    yMin -= yPad;
    yMax += yPad;

    const xScale = m => margin.left + (m / horizonMonths) * cw;
    const yScale = v => margin.top + ch - ((v - yMin) / (yMax - yMin || 1)) * ch;
    const ptsAttr = (arr) => arr.map(p => `${xScale(p.m)},${yScale(p.value)}`).join(' ');

    const pieces = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="compare-chart-svg" preserveAspectRatio="xMidYMid meet">`];

    // Y gridlines + labels
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const v = yMin + ((yMax - yMin) * i) / yTicks;
        const y = yScale(v);
        pieces.push(`<line x1="${margin.left}" y1="${y}" x2="${W - margin.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`);
        pieces.push(`<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="${fs.axis}" fill="#64748b">${euro(Math.round(v))}</text>`);
    }
    if (yMin < 0 && yMax > 0) {
        const y0 = yScale(0);
        pieces.push(`<line x1="${margin.left}" y1="${y0}" x2="${W - margin.right}" y2="${y0}" stroke="#cbd5e1" stroke-width="1.2" stroke-dasharray="3 4"/>`);
    }

    // X gridlines + year labels
    const xStep = horizonYears <= 2 ? 1 : horizonYears <= 5 ? 1 : horizonYears <= 10 ? 2 : 5;
    for (let yr = 0; yr <= horizonYears; yr += xStep) {
        const x = xScale(yr * 12);
        pieces.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${H - margin.bottom}" stroke="#f1f5f9" stroke-width="1"/>`);
        pieces.push(`<text x="${x}" y="${H - margin.bottom + 16}" text-anchor="middle" font-size="${fs.axis}" fill="#64748b">${yr} v</text>`);
    }

    // Risk band on net worth of the active scenario
    if (bandHi.length > 1 && bandLo.length > 1) {
        const top = bandHi.map(p => `${xScale(p.m)},${yScale(p.inv - p.loan)}`);
        const bot = bandLo.slice().reverse().map(p => `${xScale(p.m)},${yScale(p.inv - p.loan)}`);
        pieces.push(`<polygon points="${top.concat(bot).join(' ')}" fill="${COMPARE_NETWORTH_COLOR}" fill-opacity="0.10" stroke="${COMPARE_NETWORTH_COLOR}" stroke-opacity="0.18" stroke-width="0.7"/>`);
    }

    // Per-investment lines (thin, colored from linked category)
    investments.forEach((inv, idx) => {
        const color = getEntityColor(inv, idx);
        const pts = activePts.map(p => ({ m: p.m, value: p.invs[idx] }));
        pieces.push(`<polyline points="${ptsAttr(pts)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`);
    });

    // Ghost: baseline net worth (only when active != baseline)
    if (showGhost) {
        const ghostPts = baselinePts.map(p => ({ m: p.m, value: p.inv - p.loan }));
        pieces.push(`<polyline points="${ptsAttr(ghostPts)}" fill="none" stroke="${COMPARE_GHOST_COLOR}" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>`);
    }

    // Net worth — headline line (indigo, thickest)
    const netPts = activePts.map(p => ({ m: p.m, value: p.inv - p.loan }));
    pieces.push(`<polyline points="${ptsAttr(netPts)}" fill="none" stroke="${COMPARE_NETWORTH_COLOR}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);

    // Loan-payoff marker — vertical dashed line + label (no balance line in chart)
    if (active.payoffMonth && active.payoffMonth <= horizonMonths) {
        const x = xScale(active.payoffMonth);
        const yrLabel = (active.payoffMonth / 12).toFixed(1) + ' v';
        pieces.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${H - margin.bottom}" stroke="${COMPARE_LOAN_COLOR}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.85"/>`);
        pieces.push(`<text x="${x + 6}" y="${margin.top + 14}" font-size="${fs.legend}" font-weight="600" fill="${COMPARE_LOAN_COLOR}">Laina maksettu · ${yrLabel}</text>`);
    }

    // Legend at bottom
    const legendY = H - 36;
    const legendY2 = H - 16;
    let lx = margin.left;
    let ly = legendY;
    const wrapIfNeeded = (estWidth) => {
        if (lx + estWidth > W - margin.right) {
            lx = margin.left;
            ly = legendY2;
        }
    };
    const addLine = (color, label, opts = {}) => {
        const w = 22 + 6 + label.length * 6.2 + 16;
        wrapIfNeeded(w);
        const dash = opts.dash ? `stroke-dasharray="${opts.dash}"` : '';
        const sw = opts.sw || 2.4;
        pieces.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 22}" y2="${ly}" stroke="${color}" stroke-width="${sw}" ${dash}/>`);
        pieces.push(`<text x="${lx + 26}" y="${ly + 4}" font-size="${fs.legend}" fill="#334155">${label}</text>`);
        lx += w;
    };
    const addSwatch = (color, label) => {
        const w = 22 + 6 + label.length * 6.2 + 16;
        wrapIfNeeded(w);
        pieces.push(`<rect x="${lx}" y="${ly - 5}" width="22" height="10" rx="2" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.4"/>`);
        pieces.push(`<text x="${lx + 26}" y="${ly + 4}" font-size="${fs.legend}" fill="#334155">${label}</text>`);
        lx += w;
    };

    addLine(COMPARE_NETWORTH_COLOR, 'Nettovarallisuus', { sw: 3 });
    addSwatch(COMPARE_NETWORTH_COLOR, `Riskialue ±${riskPct} %`);
    investments.slice(0, 4).forEach((inv, idx) => {
        addLine(getEntityColor(inv, idx), inv.name, { sw: 1.8 });
    });
    if (investments.length > 4) {
        wrapIfNeeded(80);
        pieces.push(`<text x="${lx}" y="${ly + 4}" font-size="${fs.legend}" fill="#94a3b8">+${investments.length - 4} muuta</text>`);
        lx += 80;
    }
    if (showGhost) {
        addLine(COMPARE_GHOST_COLOR, 'Nykyinen jako (vertailu)', { sw: 1.6, dash: '5 4' });
    }
    if (active.payoffMonth && active.payoffMonth <= horizonMonths) {
        addLine(COMPARE_LOAN_COLOR, 'Laina maksettu', { sw: 1.6, dash: '5 4' });
    }

    pieces.push('</svg>');
    $compareChart.innerHTML = pieces.join('');

    const svg = $compareChart.querySelector('svg');
    if (!svg) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'compare-chart-tooltip';
    tooltip.style.display = 'none';
    $compareChart.appendChild(tooltip);

    const ns = 'http://www.w3.org/2000/svg';
    const probe = document.createElementNS(ns, 'g');
    probe.setAttribute('class', 'compare-chart-probe');
    probe.style.display = 'none';
    const probeLine = document.createElementNS(ns, 'line');
    probeLine.setAttribute('y1', String(margin.top));
    probeLine.setAttribute('y2', String(H - margin.bottom));
    probeLine.setAttribute('stroke', '#0f172a');
    probeLine.setAttribute('stroke-width', '1');
    probeLine.setAttribute('stroke-dasharray', '3 3');
    probeLine.setAttribute('opacity', '0.45');
    probe.appendChild(probeLine);
    const probeDots = [];
    const addProbeDot = (color, r = 4) => {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('r', String(r));
        dot.setAttribute('fill', color);
        dot.setAttribute('stroke', 'white');
        dot.setAttribute('stroke-width', '2');
        probe.appendChild(dot);
        probeDots.push(dot);
        return dot;
    };
    addProbeDot(COMPARE_NETWORTH_COLOR, 5);
    investments.forEach((inv, idx) => addProbeDot(getEntityColor(inv, idx), 3.5));
    if (showGhost) addProbeDot(COMPARE_GHOST_COLOR, 4);
    svg.appendChild(probe);

    const monthLabel = (m) => {
        if (m === 0) return 'Nyt';
        const years = Math.floor(m / 12);
        const months = m % 12;
        if (years === 0) return `${months} kk`;
        if (months === 0) return `${years} v`;
        return `${years} v ${months} kk`;
    };
    const valuesForMonth = (m) => {
        const p = active.points[m] || active.points[active.points.length - 1];
        const base = baseline.points[m] || baseline.points[baseline.points.length - 1];
        return { p, base };
    };
    const renderProbe = (m, clientX, clientY) => {
        const { p, base } = valuesForMonth(m);
        const x = xScale(m);
        const net = p.inv - p.loan;
        probe.style.display = '';
        probeLine.setAttribute('x1', String(x));
        probeLine.setAttribute('x2', String(x));
        let dotIdx = 0;
        probeDots[dotIdx].setAttribute('cx', String(x));
        probeDots[dotIdx].setAttribute('cy', String(yScale(net)));
        dotIdx++;
        p.invs.forEach((val) => {
            const dot = probeDots[dotIdx++];
            dot.setAttribute('cx', String(x));
            dot.setAttribute('cy', String(yScale(val)));
        });
        if (showGhost) {
            const dot = probeDots[dotIdx++];
            dot.setAttribute('cx', String(x));
            dot.setAttribute('cy', String(yScale(base.inv - base.loan)));
        }

        const entityRows = investments.map((inv, idx) => {
            const color = getEntityColor(inv, idx);
            return `<div><span style="color:${color}">${escapeAttr(inv.name)}</span><strong>${euro(Math.round(p.invs[idx] || 0))}</strong></div>`;
        }).join('');
        const baseRow = showGhost
            ? `<div><span>Nykyinen jako</span><strong>${euro(Math.round(base.inv - base.loan))}</strong></div>`
            : '';
        tooltip.innerHTML = `
            <div class="chart-tip-title">${monthLabel(m)}</div>
            <div><span>Nettovarallisuus (sijoitukset - lainasaldo)</span><strong>${euro(Math.round(net))}</strong></div>
            <div><span>Sijoitukset yhteensä</span><strong>${euro(Math.round(p.inv))}</strong></div>
            <div><span>Lainasaldo</span><strong>${euro(Math.round(p.loan))}</strong></div>
            ${entityRows}
            ${baseRow}
        `;
        tooltip.style.display = '';

        const chartRect = $compareChart.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        let left = clientX - chartRect.left + 12;
        let top = clientY - chartRect.top + 12;
        if (left + tipRect.width > chartRect.width - 8) left = clientX - chartRect.left - tipRect.width - 12;
        if (top + tipRect.height > chartRect.height - 8) top = clientY - chartRect.top - tipRect.height - 12;
        tooltip.style.left = `${Math.max(8, left)}px`;
        tooltip.style.top = `${Math.max(8, top)}px`;
    };
    const pointerToMonth = (e) => {
        const rect = svg.getBoundingClientRect();
        const svgX = ((e.clientX - rect.left) / rect.width) * W;
        const ratio = (svgX - margin.left) / cw;
        return Math.max(0, Math.min(horizonMonths, Math.round(ratio * horizonMonths)));
    };
    const updateFromPointer = (e) => {
        renderProbe(pointerToMonth(e), e.clientX, e.clientY);
    };
    svg.addEventListener('pointermove', updateFromPointer);
    svg.addEventListener('pointerdown', updateFromPointer);
    svg.addEventListener('pointerleave', () => {
        tooltip.style.display = 'none';
        probe.style.display = 'none';
    });
}

function applyShiftToBudget(direction) {
    const shift = Math.abs(compareState.shift);
    if (shift <= 0) return;

    const loan = state.financialEntities.find(e => e.id === compareState.loanId);
    const investments = compareState.investIds
        .map(id => state.financialEntities.find(e => e.id === id))
        .filter(Boolean);
    if (!loan || investments.length === 0) return;

    const loanCat = state.categories.find(c => c.id === loan.linkedCategoryId);
    const investCats = investments
        .map(inv => state.categories.find(c => c.id === inv.linkedCategoryId))
        .filter(Boolean);
    if (!loanCat || investCats.length === 0) return;

    // shift is monthly euros; convert to period units to update cat.amount
    const periodShift = Math.round(shift * periodFactor('month', state.period));
    const totalInvAmount = investCats.reduce((s, c) => s + c.amount, 0);

    if (direction === 'loan') {
        // Move money from invest cats → loan cat
        const actualShift = Math.min(periodShift, totalInvAmount);
        loanCat.amount += actualShift;
        if (totalInvAmount > 0) {
            // Subtract proportionally; track drift
            let removed = 0;
            investCats.forEach((c, idx) => {
                const isLast = idx === investCats.length - 1;
                const share = isLast ? actualShift - removed : Math.round(actualShift * (c.amount / totalInvAmount));
                c.amount = Math.max(0, c.amount - share);
                removed += share;
            });
        }
    } else {
        // Move money from loan cat → invest cats
        const actualShift = Math.min(periodShift, loanCat.amount);
        loanCat.amount = Math.max(0, loanCat.amount - actualShift);
        if (totalInvAmount > 0) {
            let added = 0;
            investCats.forEach((c, idx) => {
                const isLast = idx === investCats.length - 1;
                const share = isLast ? actualShift - added : Math.round(actualShift * (c.amount / totalInvAmount));
                c.amount += share;
                added += share;
            });
        } else {
            // No baseline weights — split equally
            const each = Math.floor(actualShift / investCats.length);
            let rem = actualShift - each * investCats.length;
            investCats.forEach(c => {
                c.amount += each + (rem > 0 ? 1 : 0);
                if (rem > 0) rem--;
            });
        }
    }

    enforceCap();
    compareState.shift = 0;
    // Jätä suositus näkyviin jos se oli auki ennen toteutusta — refresh-
    // mekanismi (renderComparePage → refreshAssessmentIfOpen) ajaa sen uudelleen
    // uudella baselinella. Tällöin käyttäjä näkee onko toteutus riittävä
    // ('Tasapainoisin jako: nykyinen jako') vai onko vielä siirrettävää.
    saveState();
    renderAll();
    renderComparePage();
    showSaveStatus('Muutos kopioitu budjettiin ✓');
}

function isProtectedSavingsTarget(entity) {
    return entity?.type === 'savings' && entity.targetAmount && entity.targetAmount > 0;
}

// releaseProtected = true → ohitetaan suojattujen säästötavoitteiden suojaus
// vertailun aikana (käyttäjä haluaa testata aggressiivisemman skenaarion).
function isProtectedInThisCompare(entity, releaseProtected) {
    if (releaseProtected) return false;
    return isProtectedSavingsTarget(entity);
}

function getFlexibleInvestMonthly(investments, baseInvMonthlies, releaseProtected = false) {
    return baseInvMonthlies.reduce((sum, monthly, i) => {
        return isProtectedInThisCompare(investments[i], releaseProtected) ? sum : sum + monthly;
    }, 0);
}

function getFlexibleInvestWeights(investments, baseInvMonthlies, releaseProtected = false) {
    return baseInvMonthlies.map((monthly, i) => isProtectedInThisCompare(investments[i], releaseProtected) ? 0 : monthly);
}

function buildScenarioMonthlies(baseLoanMonthly, investments, baseInvMonthlies, shift, releaseProtected = false) {
    const flexibleTotal = getFlexibleInvestMonthly(investments, baseInvMonthlies, releaseProtected);
    const splitShift = (amount) => {
        if (flexibleTotal <= 0) return baseInvMonthlies.slice();
        return baseInvMonthlies.map((m, i) => {
            if (isProtectedInThisCompare(investments[i], releaseProtected)) return m;
            return Math.max(0, m + amount * (m / flexibleTotal));
        });
    };
    return {
        loanFocus: { loan: baseLoanMonthly + shift, invs: splitShift(-shift) },
        baseline:  { loan: baseLoanMonthly,         invs: baseInvMonthlies.slice() },
        investFocus:{ loan: baseLoanMonthly - shift, invs: splitShift(+shift) },
    };
}

function runCompareSimulations(loan, investments, baseLoanMonthly, baseInvMonthlies, shift, risk, maxMonths, releaseProtected = false) {
    const monthlies = buildScenarioMonthlies(baseLoanMonthly, investments, baseInvMonthlies, shift, releaseProtected);
    const simOptions = {
        baseLoanMonthly,
        shiftReturnWeights: getFlexibleInvestWeights(investments, baseInvMonthlies, releaseProtected),
    };

    // Velkavipu-epäsymmetria: skenaariossa jossa pidetään suurempi osuus
    // sijoituksissa (invest-heavy → enemmän lainaa pidempään) sijoitusten
    // alasuunta on vipuvaikutuksesta vakavampi — joudut maksamaan lainan
    // korkokuluja vaikka sijoitukset tuottaisivat huonosti. Vastaavasti
    // loan-heavy-skenaariossa olet vähentänyt velkavipua ja alasuunta on
    // lievempi. Ylasuunta (high band) pysyy baseline-riskinä koska sen
    // €-määrällinen kasvu skenaarion suuremmista panoksista tulee jo
    // simuloinnista itsestään.
    const baseTotalMonthly = monthlies.baseline.loan + monthlies.baseline.invs.reduce((s, v) => s + v, 0);
    const baseInvExposure = baseTotalMonthly > 0
        ? monthlies.baseline.invs.reduce((s, v) => s + v, 0) / baseTotalMonthly
        : 0;
    const scenarioInvExposure = (k) => {
        const total = monthlies[k].loan + monthlies[k].invs.reduce((s, v) => s + v, 0);
        const inv = monthlies[k].invs.reduce((s, v) => s + v, 0);
        return total > 0 ? inv / total : baseInvExposure;
    };

    const scenarios = {};
    const riskBands = {};
    ['loanFocus', 'baseline', 'investFocus'].forEach(k => {
        const m = monthlies[k];
        scenarios[k] = simulateScenario(loan, investments, m.loan, m.invs, 0, maxMonths, simOptions);

        // Kerroin: vaimennettu 0.7×, capped [0.5, 1.5]. Esim. baseline-exposure
        // 0.69, scenario 0.91 → exposureShift = +0.31 → lowMultiplier = 1.22.
        const exposureShift = baseInvExposure > 0
            ? (scenarioInvExposure(k) - baseInvExposure) / baseInvExposure
            : 0;
        const lowMultiplier = Math.max(0.5, Math.min(1.5, 1 + exposureShift * 0.7));

        riskBands[k] = {
            low: simulateScenario(loan, investments, m.loan, m.invs, -risk * lowMultiplier, maxMonths, simOptions),
            high: simulateScenario(loan, investments, m.loan, m.invs, +risk, maxMonths, simOptions),
            lowMultiplier,
            highMultiplier: 1,
        };
    });
    return { scenarios, riskBands };
}

function assessBestStrategy(loan, investments, baseLoanMonthly, baseInvMonthlies, maxLoanShift, maxInvestShift, horizonMonths, releaseProtected = false) {
    if ((maxLoanShift <= 0 && maxInvestShift <= 0) || investments.length === 0) return null;
    const totalInv = baseInvMonthlies.reduce((s, m) => s + m, 0);
    if (totalInv <= 0) return null;

    const loanRate = loan.interestRate || 0;
    let weightedAdjReturn = 0;
    let weightedRawReturn = 0;
    let weightedPremium = 0;
    let weightedSigma = 0;
    const perEntity = [];
    investments.forEach((inv, i) => {
        const rate = getInvestRate(inv);
        const premium = getEntityRiskPremium(inv);
        const sigma = getEntitySigma(inv);
        const adjRate = rate - premium;
        const weight = baseInvMonthlies[i] / totalInv;
        weightedAdjReturn += adjRate * weight;
        weightedRawReturn += rate * weight;
        weightedPremium += premium * weight;
        weightedSigma += sigma * weight;
        perEntity.push({ name: inv.name, type: inv.type, rate, premium, sigma, adjRate, weight });
    });

    // Multi-horizon scoring: simuloidaan jokainen kandidaatti 30v asti ja
    // sampleerataan netto useammassa horisontissa. Minimax-pohjainen valinta
    // suosii shiftia joka voittaa baselinen pahimmankin aikajakson yli — eli
    // suositus on robusti riippumatta siitä onko käyttäjän aikajakso 5 vai 30 v.
    //
    // TÄRKEÄ ERO: minimax-pisteytys käyttää RISKIKORJATTUA sijoituskorkoa
    // (rate − premium), jotta hyvin riskillinen sijoitus (esim. krypto, σ=60 %
    // → preemio 10,8 % → adj-rate 0...alle 0) ei näytä houkuttelevalta vain
    // nominaalisen 10 % tuoton perusteella. Tällä korjauksella kryptolla
    // suositus painottuu oikein lainan suuntaan, kun riskikorjattu tuotto on
    // lainakorkoa pienempi. Horisonttitaulukko ja muu UI näyttää silti
    // nominaaliset luvut jotta vastaa Vertailu-näkymän muita arvoja.
    const horizonsMonths = [60, 120, 180, 240, 300, 360];
    const maxSimMonths = Math.max(...horizonsMonths, horizonMonths);
    const simOptions = {
        baseLoanMonthly,
        shiftReturnWeights: getFlexibleInvestWeights(investments, baseInvMonthlies, releaseProtected),
    };
    const investRiskAdjFn = (inv) => -getEntityRiskPremium(inv);

    const simulateShiftAt = (signedShift, riskAdj) => {
        const monthlies = buildScenarioMonthlies(baseLoanMonthly, investments, baseInvMonthlies, Math.abs(signedShift), releaseProtected);
        const m = signedShift > 0
            ? monthlies.investFocus
            : signedShift < 0
                ? monthlies.loanFocus
                : monthlies.baseline;
        return simulateScenario(loan, investments, m.loan, m.invs, riskAdj, maxSimMonths, simOptions);
    };
    const simulateShift = (signedShift) => simulateShiftAt(signedShift, 0);
    const simulateShiftAdj = (signedShift) => simulateShiftAt(signedShift, investRiskAdjFn);
    const riskPctForBand = (typeof compareState.risk === 'number' && compareState.risk >= 0)
        ? compareState.risk
        : Math.max(0, Math.round(weightedSigma / 2));
    const simulateShiftLow = (signedShift) => simulateShiftAt(signedShift, -riskPctForBand);
    const simulateShiftHigh = (signedShift) => simulateShiftAt(signedShift, +riskPctForBand);
    const netAt = (sim, hm) => sim.points[hm].inv - sim.points[hm].loan;
    const riskHalfAt = (lowSim, highSim, hm) => Math.max(0, (netAt(highSim, hm) - netAt(lowSim, hm)) / 2);

    // Sample baseline (nominal — for display / current-horizon gain) and
    // adj-baseline (for minimax scoring).
    const baselineSim = simulateShift(0);
    const baselineNetAt = (hm) => netAt(baselineSim, hm);
    const baselineNet = baselineNetAt(horizonMonths);

    const baselineSimAdj = simulateShiftAdj(0);
    const baselineNetAtAdj = (hm) => netAt(baselineSimAdj, hm);

    // Nopein lainanlyhennyspolku toimii päätösriskin vertailupohjana. Sen
    // sisältämä sijoitusriski syntyy joka tapauksessa lainan jälkeen, joten
    // käyttäjälle arvokkain lisäluku on paljonko valittu jako kasvattaa sitä.
    const fastestLoanShift = -maxLoanShift;
    const fastestLoanSim = simulateShift(fastestLoanShift);
    const fastestLoanSimAdj = simulateShiftAdj(fastestLoanShift);
    const fastestLoanLow = simulateShiftLow(fastestLoanShift);
    const fastestLoanHigh = simulateShiftHigh(fastestLoanShift);
    const fastestRiskHalfAt = (hm) => riskHalfAt(fastestLoanLow, fastestLoanHigh, hm);
    const fastestInterestAt = (hm) => fastestLoanSim.points[hm].interest || 0;

    // Candidate grid across slider range.
    const span = maxLoanShift + maxInvestShift;
    const step = Math.max(1, Math.ceil(span / 60));
    const candidates = new Set([0, -maxLoanShift, maxInvestShift]);
    for (let shift = -maxLoanShift; shift <= maxInvestShift; shift += step) {
        candidates.add(Math.round(shift));
    }

    // For each candidate: ADJ-rate sim → relative gain vs adj-baseline at each
    // horizon, plus decision-risk metrics vs the fastest loan plan. The final
    // pick optimizes risk-adjusted benefit after penalizing extra volatility
    // and extra interest. This keeps "more investing" from winning only because
    // the total risk band is large for reasons the decision did not create.
    const riskEuroWeight = 0.35;
    const extraInterestWeight = 0.10;
    const candidateScores = [];
    candidates.forEach(shift => {
        const clamped = Math.max(-maxLoanShift, Math.min(maxInvestShift, shift));
        const sim = simulateShiftAdj(clamped);
        const nominalSim = simulateShift(clamped);
        const lowSim = simulateShiftLow(clamped);
        const highSim = simulateShiftHigh(clamped);
        const gainsAbs = horizonsMonths.map(hm => {
            const net = netAt(sim, hm);
            return net - baselineNetAtAdj(hm);
        });
        const gainsRel = horizonsMonths.map((hm, i) => {
            const base = Math.abs(baselineNetAtAdj(hm));
            return base > 1 ? gainsAbs[i] / base : 0;
        });
        const worstCaseRel = Math.min(...gainsRel);
        const avgCaseRel = gainsRel.reduce((s, g) => s + g, 0) / gainsRel.length;
        const decisionScores = horizonsMonths.map(hm => {
            const adjGainVsFastest = netAt(sim, hm) - netAt(fastestLoanSimAdj, hm);
            const extraRisk = Math.max(0, riskHalfAt(lowSim, highSim, hm) - fastestRiskHalfAt(hm));
            const extraInterest = Math.max(0, (nominalSim.points[hm].interest || 0) - fastestInterestAt(hm));
            const scoreAbs = adjGainVsFastest - extraRisk * riskEuroWeight - extraInterest * extraInterestWeight;
            const base = Math.max(1000, Math.abs(netAt(fastestLoanSimAdj, hm)));
            return {
                scoreRel: scoreAbs / base,
                adjGainVsFastest,
                extraRisk,
                extraInterest,
            };
        });
        const worstDecisionRel = Math.min(...decisionScores.map(s => s.scoreRel));
        const avgDecisionRel = decisionScores.reduce((s, row) => s + row.scoreRel, 0) / decisionScores.length;
        const totalDecisionGain = decisionScores.reduce((s, row) => s + row.adjGainVsFastest, 0);
        const totalDecisionCost = decisionScores.reduce((s, row) => s + row.extraRisk + row.extraInterest * extraInterestWeight, 0);
        const efficiency = totalDecisionGain / Math.max(1, totalDecisionCost);
        const avgExtraRisk = decisionScores.reduce((s, row) => s + row.extraRisk, 0) / decisionScores.length;
        candidateScores.push({
            shift: clamped,
            gainsAbs,
            gainsRel,
            worstCaseRel,
            avgCaseRel,
            worstDecisionRel,
            avgDecisionRel,
            efficiency,
            avgExtraRisk,
        });
    });

    // Robust pick: paras päätösriskikorjattu piste pahimmassa aikajaksossa.
    // Tie-break keskiarvo, tehokkuus ja lopuksi pienempi lisäriski.
    candidateScores.sort((a, b) =>
        (b.worstDecisionRel - a.worstDecisionRel)
        || (b.avgDecisionRel - a.avgDecisionRel)
        || (b.efficiency - a.efficiency)
        || (a.avgExtraRisk - b.avgExtraRisk)
    );
    const robust = candidateScores[0];
    const bestShift = robust.shift;
    // bestNet käyttää NOMINAL-simulaatiota (näytön johdonmukaisuutta varten).
    const bestNet = bestShift === 0
        ? baselineNet
        : (() => {
            const sim = simulateShift(bestShift);
            return sim.points[horizonMonths].inv - sim.points[horizonMonths].loan;
        })();

    const expectedSpread = weightedRawReturn - loanRate;
    const riskAdjustedSpread = weightedAdjReturn - loanRate;

    // Suositus: bestShift on päätösriskikorjatun pisteytyksen kohde. Se on
    // absoluuttinen tavoite samalla setupilla; nykyinen slider kertoo vain
    // kuinka kaukana käyttäjä on siitä.
    let balancedShift = bestShift;

    // Konvergenssikynnys: jos ehdotus on liian pieni (esim. käyttäjä on jo
    // optimin reunalla), tulkitaan 'nykyinen jako on riittävä'.
    const totalBudget = baseLoanMonthly + totalInv;
    const minMeaningfulShift = Math.max(20, Math.round(totalBudget * 0.02));
    if (Math.abs(balancedShift) < minMeaningfulShift) {
        balancedShift = 0;
    }

    // Absoluuttinen target — sama riippumatta nykyisestä jaosta samalla setupilla.
    // Tämä kerrotaan käyttäjälle UI:ssa jotta hän näkee mihin allokaatioon malli
    // tähtää, eikä vain "siirrä +X €/kk".
    const targetLoanMonthly = Math.max(0, Math.min(totalBudget, baseLoanMonthly + balancedShift));
    const targetInvestMonthly = Math.max(0, totalBudget - targetLoanMonthly);
    const targetLoanRatio = totalBudget > 0 ? targetLoanMonthly / totalBudget : 0;

    // Horisontti-taulukko: lasketaan nykyiselle sliderin asennolle (compareState.shift)
    // ja näytetään absoluuttiset taloudelliset arvot — ei vain "voitto vs nyk".
    // Tämä on käyttäjälle informatiivisempi: näkee nettovarallisuuden, korkokulut
    // ja riski-alueen leveyden joka horisontissa.
    const currentShift = Math.max(-maxLoanShift, Math.min(maxInvestShift, Number(compareState.shift) || 0));

    const currentSim = currentShift === 0 ? baselineSim : simulateShift(currentShift);
    const currentSimLow = simulateShiftLow(currentShift);
    const currentSimHigh = simulateShiftHigh(currentShift);

    const horizonBreakdown = horizonsMonths.map(hm => {
        const p = currentSim.points[hm];
        const pLow = currentSimLow.points[hm];
        const pHigh = currentSimHigh.points[hm];
        const net = p.inv - p.loan;
        const baselineNetH = baselineNetAt(hm);
        const lowNet = pLow.inv - pLow.loan;
        const highNet = pHigh.inv - pHigh.loan;
        const riskHalf = Math.max(0, (highNet - lowNet) / 2);
        const referenceRiskHalf = fastestRiskHalfAt(hm);
        const extraRiskHalf = riskHalf - referenceRiskHalf;
        const gainAbsH = net - baselineNetH;
        // Säästetty korko vs nykyinen jako: positiivinen kun skenaario maksaa
        // vähemmän korkoa kumulatiivisesti. Tämä on VARMA hyöty (lainakorko on
        // sopimuksellinen), toisin kuin sijoituksen compounding-tuotto.
        const baselineInterestH = baselineSim.points[hm].interest || 0;
        const scenarioInterest = p.interest || 0;
        const interestSavings = baselineInterestH - scenarioInterest;
        // Hyöty-pisteytys: netto-edge baselineen verrattuna + säästetty korko
        // (vain positiivinen — varma hyöty) − lisäriskin rangaistus.
        // Säästetty korko lasketaan erikseen koska NetChange:n compounding-osuus
        // on epävarma, mutta korkokuluerojen säästö on sopimuksellisesti varma.
        // Tämä antaa lainaa lyhentäville skenaarioille reilumman pisteytyksen
        // lyhyellä aikavälillä, ennen kuin compounding ehtii kompensoida.
        const edge = gainAbsH + Math.max(0, interestSavings) - 0.35 * Math.max(0, extraRiskHalf);
        return {
            years: Math.round(hm / 12),
            inv: p.inv,
            loanBalance: p.loan,
            interest: scenarioInterest,
            interestSavings,
            net,
            gainAbs: gainAbsH,
            gainRel: Math.abs(baselineNetH) > 1 ? gainAbsH / Math.abs(baselineNetH) : 0,
            riskLow: lowNet,
            riskHigh: highNet,
            riskBand: highNet - lowNet,
            riskHalf,
            referenceRiskHalf,
            extraRiskHalf,
            extraInterestVsFastest: scenarioInterest - fastestInterestAt(hm),
            edge,
        };
    });

    const gainsRelArr = horizonBreakdown.map(h => h.gainRel);
    const currentWorstCaseRel = Math.min(...gainsRelArr);
    const currentAvgCaseRel = gainsRelArr.reduce((s, g) => s + g, 0) / gainsRelArr.length;

    // Suosituksen omat luvut säilytetään erikseen (vaikka taulukossa näytetään
    // nykyinen slider) jos UI haluaa kertoa "suosituksen pahimman aikajakson voitto".
    const balancedSim = balancedShift === currentShift ? currentSim : (balancedShift === 0 ? baselineSim : simulateShift(balancedShift));
    const balancedGains = horizonsMonths.map(hm => {
        const net = balancedSim.points[hm].inv - balancedSim.points[hm].loan;
        const baseNet = baselineNetAt(hm);
        return Math.abs(baseNet) > 1 ? (net - baseNet) / Math.abs(baseNet) : 0;
    });
    const balancedWorstCaseRel = Math.min(...balancedGains);
    const balancedAvgCaseRel = balancedGains.reduce((s, g) => s + g, 0) / balancedGains.length;

    return {
        shift: balancedShift,
        currentShift,
        rawBestShift: bestShift,
        spread: riskAdjustedSpread,
        expectedSpread,
        riskAdjustedSpread,
        gain: bestNet - baselineNet,
        bestNet,
        baselineNet,
        loanRate,
        adjInvestReturn: weightedAdjReturn,
        rawInvestReturn: weightedRawReturn,
        weightedPremium,
        weightedSigma,
        perEntity,
        hasRiskyInvest: investments.some(inv => inv.type === 'investment'),
        horizonBreakdown,
        riskPctForBand,
        robustWorstCaseRel: currentWorstCaseRel,
        robustAvgCaseRel: currentAvgCaseRel,
        balancedWorstCaseRel,
        balancedAvgCaseRel,
        rawWorstCaseRel: robust.worstCaseRel,
        rawAvgCaseRel: robust.avgCaseRel,
        decisionWorstCaseRel: robust.worstDecisionRel,
        decisionAvgCaseRel: robust.avgDecisionRel,
        decisionEfficiency: robust.efficiency,
        targetLoanMonthly,
        targetInvestMonthly,
        targetLoanRatio,
        totalBudget,
    };
}

function renderAssessment(best) {
    if (!best) {
        $compareAssessment.style.display = 'none';
        return;
    }
    const shiftAbs = Math.abs(best.shift);
    const direction = best.shift > 0 ? 'sijoituksiin' : 'lainaan';
    const fmt = (n) => n.toFixed(2).replace('.', ',');
    const fmtSigned = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

    const title = '💡 Suositus (beta) — nettohyöty vs. lisäriski';

    // Per-entity breakdown so user sees WHERE the premium comes from
    const perEntityRows = best.perEntity.map(p => {
        if (p.type === 'savings') {
            return `<li><strong>${escapeAttr(p.name)}</strong> (säästö): ${fmt(p.rate)} %, σ ~${fmt(p.sigma)} % → adj ${fmt(p.adjRate)} %</li>`;
        }
        return `<li><strong>${escapeAttr(p.name)}</strong>: ${fmt(p.rate)} % − preemio ${fmt(p.premium)} % (σ ~${fmt(p.sigma)} %) = <strong>${fmt(p.adjRate)} %</strong></li>`;
    }).join('');

    const riskNote = `Painotettu tuotto <strong>${fmt(best.rawInvestReturn)} %</strong>, riskikorjattu <strong>${fmt(best.adjInvestReturn)} %</strong> (preemio ${fmt(best.weightedPremium)} %, σ ${fmt(best.weightedSigma)} %).`;

    // Horisonttitaulukko näyttää nyt absoluuttiset taloudelliset arvot nykyiselle
    // sliderin asennolle: nettovarallisuus, lainan jäljellä, kertynyt korkokulu,
    // ja riski-alueen leveys (±). Tämä on paljon informatiivisempi kuin pelkkä
    // "voitto vs. nyk." (joka oli aina 0 kun slider on nollassa).
    const fmtPctSigned = (rel) => {
        const pct = rel * 100;
        const sign = pct >= 0 ? '+' : '−';
        return `${sign}${Math.abs(pct).toFixed(1).replace('.', ',')} %`;
    };
    const horizonRows = (best.horizonBreakdown || []).map(h => {
        // Korkokulu on aina negatiivinen lopputulokselle → näytä −X €.
        // Lisäksi näytetään ero baselineen: 'säästöä +X' tai 'lisää −X' jotta
        // käyttäjä näkee selvästi paljonko kk-erää säätämällä vältetään korkoja.
        const interestStr = h.interest > 0 ? `−${euro(Math.round(h.interest))}` : '0 €';
        const savingsRounded = Math.round(h.interestSavings || 0);
        const savingsAnnotation = savingsRounded >= 1
            ? `<span class="interest-savings positive">säästöä +${euro(savingsRounded)}</span>`
            : savingsRounded <= -1
                ? `<span class="interest-savings negative">lisää −${euro(Math.abs(savingsRounded))}</span>`
                : '';
        // Riski-alue puolikkaana (±) jotta numero on luettavampi. Lisäriski
        // erottaa päätöksen tuoman heilunnan nopeimpaan lainapolkuun nähden.
        const riskHalf = Math.round(h.riskHalf ?? (h.riskBand / 2));
        const extraRiskHalf = Math.round(Math.max(0, h.extraRiskHalf || 0));
        const extraRiskStr = Math.abs(extraRiskHalf) < 1
            ? '±0 €'
            : `+±${euro(extraRiskHalf)}`;
        // Näytä delta-summa aina kun se on merkityksellinen (≥1 €). Aiempi
        // 0.1 %-kynnys piilotti deltan pitkillä horisonteilla joissa muutos
        // on absoluuttisesti pieni mutta käyttäjälle silti informatiivinen.
        const gainAbsRounded = Math.round(h.gainAbs);
        const deltaCls = gainAbsRounded > 0 ? 'positive' : gainAbsRounded < 0 ? 'negative' : '';
        const deltaSpan = Math.abs(gainAbsRounded) >= 1
            ? `<span class="assessment-horizon-delta ${deltaCls}"> (${gainAbsRounded > 0 ? '+' : '−'}${euro(Math.abs(gainAbsRounded))})</span>`
            : '';
        // Hyöty-sarake: yhteenveto netto-vaikutuksesta vähennettynä lisäriski-
        // sakolla. Positiivinen → liu'uttimen asento tuo enemmän nettohyötyä
        // kuin lisäriski maksaa; negatiivinen → menettää hyödyn riskin
        // tarkastelun jälkeen.
        const edgeRounded = Math.round(h.edge || 0);
        const edgeCls = edgeRounded > 0 ? 'positive' : edgeRounded < 0 ? 'negative' : '';
        const edgeStr = Math.abs(edgeRounded) < 1
            ? '0 €'
            : `${edgeRounded > 0 ? '+' : '−'}${euro(Math.abs(edgeRounded))}`;
        return `<tr>
            <td>${h.years} v</td>
            <td class="assessment-horizon-net">${euro(Math.round(h.net))}${deltaSpan}</td>
            <td class="assessment-horizon-interest">${interestStr}${savingsAnnotation ? `<br>${savingsAnnotation}` : ''}</td>
            <td class="assessment-horizon-risk">±${euro(riskHalf)}</td>
            <td class="assessment-horizon-extra-risk">${extraRiskStr}</td>
            <td class="assessment-horizon-edge ${edgeCls}" title="Netto-edge (vs. nykyinen jako) + säästetty korko − 0.35 × lisäriski">${edgeStr}</td>
        </tr>`;
    }).join('');
    // Taulukon otsikko reflektoi sliderin nykyistä asentoa (liikkuu sen mukana).
    const cur = Number(best.currentShift) || 0;
    const horizonTableSubtitle = cur === 0
        ? 'liu’utin: nykyinen jako'
        : (cur > 0
            ? `liu’utin: sijoituksiin +${euro(cur)}/kk`
            : `liu’utin: lainaan +${euro(Math.abs(cur))}/kk`);
    const riskPctLabel = best.riskPctForBand ? `±${best.riskPctForBand} %` : '';
    const noteLine = cur === 0
        ? `Nykyinen jako: nettovarallisuus 20v päästä <strong>${euro(Math.round(best.horizonBreakdown[3]?.net || 0))}</strong> · kumulatiiviset lainan korkokulut <strong>${euro(Math.round(best.horizonBreakdown[3]?.interest || 0))}</strong>.`
        : `Vrt. nykyiseen jakoon: voitto pahimmassa horisontissa <strong>${fmtPctSigned(best.robustWorstCaseRel)}</strong>, keskiarvo <strong>${fmtPctSigned(best.robustAvgCaseRel)}</strong>. Lisäriski on erotus nopeimpaan lainanlyhennyspolkuun.`;
    const horizonTable = horizonRows
        ? `<div class="assessment-horizon-section">
              <div class="assessment-horizon-title">Skenaarion luvut eri aikajaksoissa <span class="assessment-horizon-subtitle">(${horizonTableSubtitle})</span></div>
              <table class="assessment-horizon-table">
                  <thead><tr><th>Aika</th><th>Netto</th><th>Korkokulu</th><th>Riski ${riskPctLabel}</th><th>Lisäriski</th><th title="Netto-vaikutus vs. nykyinen jako miinus lisäriski-sakko (0.35×)">Hyöty</th></tr></thead>
                  <tbody>${horizonRows}</tbody>
              </table>
              <div class="assessment-horizon-note">${noteLine}</div>
          </div>`
        : '';

    const recommendedShift = best.shift; // signed: + = sijoituksiin, − = lainaan
    const recommendationIsNeutral = shiftAbs < 1 || Math.abs(best.gain) < 1;
    let recommendation;
    if (recommendationIsNeutral) {
        recommendation = `Optimaalinen jako tällä setupilla on <strong>nykyinen jako</strong>.`;
    } else {
        const targetPct = Math.round((best.targetLoanRatio || 0) * 100);
        const investPct = 100 - targetPct;
        recommendation = `Optimaalinen jako tällä setupilla: <strong>Laina ${euro(Math.round(best.targetLoanMonthly))}/kk (${targetPct} %)</strong>, <strong>Sijoitukset ${euro(Math.round(best.targetInvestMonthly))}/kk (${investPct} %)</strong>. → Nykyisestä tästä päästään siirtämällä <strong>${euro(shiftAbs)}/kk ${direction}</strong>.`;
    }

    // Vertaa nykyiseen liukurin asentoon → kerro käyttäjälle paljonko ja mihin
    // suuntaan tämän pitää liikkua päästäkseen suosituspisteeseen. Tämä päivittyy
    // automaattisesti aina kun käyttäjä liu'uttaa (refreshAssessmentIfOpen).
    const currentShift = Number(compareState.shift) || 0;
    const distance = recommendedShift - currentShift;
    const distanceAbs = Math.abs(distance);
    const atRecommendation = distanceAbs < 1;
    const fmtPos = (v) => v === 0
        ? 'nykyinen jako'
        : (v > 0 ? `sijoituksiin +${euro(v)}/kk` : `lainaan +${euro(Math.abs(v))}/kk`);
    let positionLine;
    if (atRecommendation) {
        positionLine = `<span class="assessment-position match">✓ Liukurisi on suosituspisteessä.</span>`;
    } else {
        const moveDir = distance > 0 ? 'oikealle (sijoituksiin)' : 'vasemmalle (lainaan)';
        positionLine = `<span class="assessment-position">Liukurisi: <strong>${fmtPos(currentShift)}</strong> → siirrä <strong>${euro(distanceAbs)}/kk ${moveDir}</strong> päästäksesi suositukseen.</span>`;
    }

    const body = `
        <div class="assessment-line">${riskNote} Odotustuoton erotus lainakorkoon <strong>${fmtSigned(best.expectedSpread)} %</strong>, riskikorjattu erotus <strong>${fmtSigned(best.riskAdjustedSpread)} %</strong>.</div>
        <ul class="assessment-breakdown">${perEntityRows}</ul>
        <div class="assessment-line">${recommendation}</div>
        ${horizonTable}
        <div class="assessment-line assessment-position-line">${positionLine}</div>
        <div class="assessment-footnote">Suunta valitaan <strong>riskikorjatulla</strong> pisteytyksellä: jokaisen sijoituksen tuotosta vähennetään σ-pohjainen preemio, ja kandidaatit pisteytetään nopeimpaan lainanlyhennyspolkuun verrattuna. Malli palkitsee riskikorjattua nettohyötyä mutta rankaisee päätöksen tuomasta lisäriskistä ja ylimääräisestä korkokulusta. Horisonttitaulukko näyttää nominaaliset projektiot (vastaa Vertailu-näkymää). Tämä ei ole henkilökohtaista sijoitusneuvontaa.</div>
    `;

    $compareAssessment.style.display = '';
    $compareAssessment.innerHTML = `
        <button type="button" class="compare-assessment-dismiss" data-action="dismiss-assess" aria-label="Sulje">×</button>
        <div class="compare-assessment-title">${title}</div>
        <div class="compare-assessment-body">${body}</div>
        ${!atRecommendation ? `
            <div class="compare-assessment-actions">
                <button type="button" data-action="apply-best" data-signed="${recommendedShift}">Siirrä liukuri suosituspisteeseen (${fmtPos(recommendedShift)})</button>
            </div>
        ` : ''}
    `;
}

function renderComparePage() {
    populateCompareLoanSelect();
    populateCompareInvestList();

    const loans = state.financialEntities.filter(e => e.type === 'loan');
    const invests = state.financialEntities.filter(e => e.type === 'investment' || e.type === 'savings');

    if (loans.length === 0 || invests.length === 0) {
        $compareEmpty.style.display = '';
        $compareBody.style.display = 'none';
        const missing = [];
        if (loans.length === 0) missing.push('laina');
        if (invests.length === 0) missing.push('sijoitus tai säästötili');
        $compareEmpty.innerHTML = `<p>Vertailu tarvitsee sekä lainan että sijoituksen/säästötilin. Lisää ${missing.join(' ja ')} Budjetti-sivulla.</p>`;
        return;
    }

    const loan = state.financialEntities.find(e => e.id === compareState.loanId);
    const selectedInvests = compareState.investIds
        .map(id => state.financialEntities.find(e => e.id === id))
        .filter(Boolean);

    if (!loan || selectedInvests.length === 0) {
        $compareEmpty.style.display = '';
        $compareBody.style.display = 'none';
        $compareEmpty.innerHTML = '<p>Valitse vertailtavat kohteet (yksi laina + vähintään yksi sijoitus/säästö).</p>';
        return;
    }

    const baseLoanMonthly = getLinkedMonthlyAmount(loan);
    const baseInvMonthlies = selectedInvests.map(inv => getLinkedMonthlyAmount(inv));
    const totalInvMonthly = baseInvMonthlies.reduce((s, m) => s + m, 0);

    if (baseLoanMonthly <= 0 || totalInvMonthly <= 0) {
        $compareEmpty.style.display = '';
        $compareBody.style.display = 'none';
        const issues = [];
        if (baseLoanMonthly <= 0) issues.push('Linkitä laina budjettikategoriaan.');
        if (totalInvMonthly <= 0) issues.push('Linkitä vähintään yksi valittu sijoitus/säästö budjettikategoriaan.');
        $compareEmpty.innerHTML = `<p>${issues.join(' ')}</p>`;
        return;
    }

    $compareEmpty.style.display = 'none';
    $compareBody.style.display = '';

    // Jos käyttäjä on vapauttanut suojatut säästöt, ne ovat osa joustavaa
    // budjettia — sallien aggressiivisemman vertailun (esim. hätävaroista lainaan).
    const hasProtected = selectedInvests.some(isProtectedSavingsTarget);
    const releaseProtected = compareState.releaseProtected && hasProtected;
    const flexibleInvMonthly = getFlexibleInvestMonthly(selectedInvests, baseInvMonthlies, releaseProtected);
    const minLoanMonthly = minimumCompareLoanMonthly(loan, baseLoanMonthly);
    const maxLoanShift = Math.floor(flexibleInvMonthly);
    const maxInvestShift = flexibleInvMonthly > 0
        ? Math.floor(Math.max(0, baseLoanMonthly - minLoanMonthly))
        : 0;
    if (compareState.shift < -maxLoanShift) {
        compareState.shift = -maxLoanShift;
    } else if (compareState.shift > maxInvestShift) {
        compareState.shift = maxInvestShift;
    }
    // Two-half slider: vasen = lainaan (0..maxLoanShift), oikea = sijoituksiin (0..maxInvestShift)
    // Yhdistetty compareState.shift: negatiivinen = lainaan, positiivinen = sijoituksiin.
    $compareShiftSliderLoan.min = '0';
    $compareShiftSliderLoan.max = String(Math.max(0, maxLoanShift));
    $compareShiftSliderLoan.disabled = maxLoanShift <= 0;
    $compareShiftSliderLoan.value = String(compareState.shift < 0 ? Math.abs(compareState.shift) : 0);

    $compareShiftSliderInvest.min = '0';
    $compareShiftSliderInvest.max = String(Math.max(0, maxInvestShift));
    $compareShiftSliderInvest.disabled = maxInvestShift <= 0;
    $compareShiftSliderInvest.value = String(compareState.shift > 0 ? compareState.shift : 0);

    if ($compareShiftMaxLoan) {
        $compareShiftMaxLoan.textContent = maxLoanShift > 0 ? `(max +${euro(maxLoanShift)}/kk)` : '';
    }
    if ($compareShiftMaxInvest) {
        $compareShiftMaxInvest.textContent = maxInvestShift > 0 ? `(max +${euro(maxInvestShift)}/kk)` : '';
    }

    // Toggle suojattujen säästöjen vapauttamiseen näytetään vain jos joukossa
    // on yksikin suojattu kohde — muuten siitä ei ole hyötyä.
    if ($compareReleaseToggleWrap) {
        $compareReleaseToggleWrap.style.display = hasProtected ? '' : 'none';
    }
    if ($compareReleaseToggle) {
        $compareReleaseToggle.checked = compareState.releaseProtected;
    }

    if (compareState.shift > 0) {
        $compareShiftValue.textContent = `Sijoituksiin +${euro(compareState.shift)} /kk`;
    } else if (compareState.shift < 0) {
        $compareShiftValue.textContent = `Lainaan +${euro(Math.abs(compareState.shift))} /kk`;
    } else {
        $compareShiftValue.textContent = 'Nykyinen jako';
    }

    // Auto-risk: σ-painotettu kaikkien valittujen sijoitusten kesken, skaalattuna
    // niiden osuudella kokonaisbudjetista. Käyttää BASELINE-allokaatiota — sama
    // tuottovaihteluprosentti sovelletaan kaikkiin skenaarioihin, jotta riski-
    // alueet ovat vertailukelpoisia (loan-heavy ei näytä keinotekoisen turvalliselta
    // pelkästään koska sijoitusosuus pienenee).
    //
    // Kaava: autoRisk = max(1, round((σ_w × exposure) / 2)) ; cap 20
    //   /2 antaa noin "1σ" rate-vaihtelun (σ=5 % korkorahastolle → ±2,5 %).
    //   Floor 1 kun sijoituksia on yhtään — koska mikään sijoitus ei ole täysin
    //   riskitön (esim. 200k€ korkorahasto ei voi näyttää ±0 % riskiä).
    //   Cap 20 vastaa sliderin max-arvoa, jotta krypto-tyyppiset pääsevät täysillä.
    if (!compareState.riskLocked) {
        const totalBudget = baseLoanMonthly + totalInvMonthly;
        const sigmaWeighted = totalInvMonthly > 0
            ? selectedInvests.reduce((s, inv, i) => s + getEntitySigma(inv) * baseInvMonthlies[i], 0) / totalInvMonthly
            : 0;
        const investExposure = totalBudget > 0 ? totalInvMonthly / totalBudget : 0;
        const raw = (sigmaWeighted * investExposure) / 2;
        const autoRisk = totalInvMonthly > 0
            ? Math.max(1, Math.round(raw))
            : 0;
        compareState.risk = Math.min(20, autoRisk);
    }
    $compareRiskSlider.value = String(compareState.risk);
    // Show concrete interpretation: what rate range each Sijoitus actually
    // simulates under this risk band. Säästö skipped (deterministic).
    const riskPctNum = compareState.risk;
    const investRanges = selectedInvests
        .filter(inv => inv.type === 'investment')
        .map(inv => {
            const r = getInvestRate(inv);
            const lo = Math.max(0, r - riskPctNum);
            const hi = r + riskPctNum;
            const f = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
            return `${escapeAttr(inv.name)} ${f(r)} % → ${f(lo)}…${f(hi)} %`;
        }).join(' · ');
    const rangeDetail = (riskPctNum > 0 && investRanges)
        ? `<span class="risk-range-detail">${investRanges}</span>`
        : '';
    $compareRiskValue.innerHTML = `±${riskPctNum} %${rangeDetail}`;
    $compareRiskLock.classList.toggle('locked', compareState.riskLocked);
    $compareRiskLock.textContent = compareState.riskLocked ? '🔒' : '🔓';
    $compareRiskLock.setAttribute('aria-pressed', String(compareState.riskLocked));

    if ($compareHorizonSlider) $compareHorizonSlider.value = String(compareState.horizonYears);
    if ($compareHorizonValue) $compareHorizonValue.textContent = `${compareState.horizonYears} v`;

    const maxMonths = 30 * 12;
    const magnitude = Math.abs(compareState.shift);
    const { scenarios, riskBands } = runCompareSimulations(
        loan, selectedInvests, baseLoanMonthly, baseInvMonthlies,
        magnitude, compareState.risk, maxMonths, releaseProtected
    );

    // Chart title reflects which scenario is being drawn in the breakdown view
    const titleSuffix = compareState.shift > 0
        ? `Sijoituksiin +${euro(magnitude)} /kk`
        : compareState.shift < 0
            ? `Lainaan +${euro(magnitude)} /kk`
            : 'Nykyinen jako';
    if ($compareChartTitle) {
        $compareChartTitle.textContent = `Skenaario: ${titleSuffix} — koostumus ajan myötä`;
    }

    renderCompareSummary(loan, selectedInvests, baseLoanMonthly, baseInvMonthlies, compareState.shift, releaseProtected);
    renderImpactBox(scenarios, riskBands, compareState.shift, compareState.horizonYears, compareState.risk, selectedInvests);
    renderCompareChart(scenarios, riskBands, loan, selectedInvests, compareState.shift, compareState.horizonYears, compareState.risk);
    renderCompareCta(compareState.shift);
    refreshAssessmentIfOpen();
}

// --- Event wiring ---

$compareLoanSelect.addEventListener('change', () => {
    compareState.loanId = $compareLoanSelect.value || null;
    compareState.shift = 0;
    renderComparePage();
});

$compareInvestList.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const id = e.target.dataset.id;
    if (e.target.checked) {
        if (!compareState.investIds.includes(id)) compareState.investIds.push(id);
    } else {
        compareState.investIds = compareState.investIds.filter(x => x !== id);
    }
    compareState.shift = 0;
    renderComparePage();
});

$compareShiftSliderLoan.addEventListener('input', () => {
    const v = Math.round(Number($compareShiftSliderLoan.value) || 0);
    compareState.shift = -v;
    renderComparePage();
});

$compareShiftSliderInvest.addEventListener('input', () => {
    const v = Math.round(Number($compareShiftSliderInvest.value) || 0);
    compareState.shift = v;
    renderComparePage();
});

if ($compareReleaseToggle) {
    $compareReleaseToggle.addEventListener('change', () => {
        compareState.releaseProtected = $compareReleaseToggle.checked;
        // Pidetään slider sallitun alueen sisällä — uusi max voi olla pienempi
        // (ei tässä) tai suurempi; clamping hoituu renderComparePage:ssa.
        compareState.shift = 0;
        renderComparePage();
    });
}

$compareRiskSlider.addEventListener('input', () => {
    compareState.risk = Math.max(0, Math.round(Number($compareRiskSlider.value) || 0));
    renderComparePage();
});

$compareRiskLock.addEventListener('click', () => {
    compareState.riskLocked = !compareState.riskLocked;
    renderComparePage();
});

$compareHorizonSlider.addEventListener('input', () => {
    const y = Math.max(1, Math.min(30, Math.round(Number($compareHorizonSlider.value) || 20)));
    compareState.horizonYears = y;
    renderComparePage();
});

$compareApplyCta.addEventListener('click', () => {
    const dir = $compareApplyCta.dataset.direction;
    if (!dir) return;
    applyShiftToBudget(dir);
});

function runAssessment() {
    const loan = state.financialEntities.find(e => e.id === compareState.loanId);
    const selectedInvests = compareState.investIds
        .map(id => state.financialEntities.find(e => e.id === id))
        .filter(Boolean);
    if (!loan || selectedInvests.length === 0) return;
    const baseLoanMonthly = getLinkedMonthlyAmount(loan);
    const baseInvMonthlies = selectedInvests.map(inv => getLinkedMonthlyAmount(inv));
    const hasProtected = selectedInvests.some(isProtectedSavingsTarget);
    const releaseProtected = compareState.releaseProtected && hasProtected;
    const flexibleInvMonthly = getFlexibleInvestMonthly(selectedInvests, baseInvMonthlies, releaseProtected);
    const minLoanMonthly = minimumCompareLoanMonthly(loan, baseLoanMonthly);
    const maxLoanShift = Math.floor(flexibleInvMonthly);
    const maxInvestShift = flexibleInvMonthly > 0
        ? Math.floor(Math.max(0, baseLoanMonthly - minLoanMonthly))
        : 0;
    const best = assessBestStrategy(
        loan,
        selectedInvests,
        baseLoanMonthly,
        baseInvMonthlies,
        maxLoanShift,
        maxInvestShift,
        compareState.horizonYears * 12,
        releaseProtected
    );
    renderAssessment(best);
}

// Re-run only if the assessment box is currently visible (so editing an entity,
// muuttamasta horisonttia, vapauttamasta säästöjä tai liu'uttamasta sliderin
// pitää suosituksen ajan tasalla — käyttäjä ei jää näkemään vanhentunutta
// tekstiä). Jos vertailun edellytykset eivät enää täyty (esim. käyttäjä otti
// kaikki sijoitukset pois), piilotetaan boxi siististi sen sijaan että
// jätettäisiin vanha sisältö paikoilleen.
function refreshAssessmentIfOpen() {
    if (!$compareAssessment) return;
    if ($compareAssessment.style.display === 'none' || $compareAssessment.innerHTML.trim() === '') return;
    const loan = state.financialEntities.find(e => e.id === compareState.loanId);
    const selectedInvests = compareState.investIds
        .map(id => state.financialEntities.find(e => e.id === id))
        .filter(Boolean);
    if (!loan || selectedInvests.length === 0) {
        $compareAssessment.style.display = 'none';
        return;
    }
    runAssessment();
}

$compareAssessBtn.addEventListener('click', runAssessment);

// Re-render Vertailu-sivu kun ikkunan koko muuttuu — chart käyttää eri viewBoxia
// ja fonttikokoa < 640px-leveydellä, joten puhelimen kääntö tarvitsee uuden
// renderöinnin. Debounce 150ms jotta resize-tapahtumat eivät jätä jälkeen.
{
    let resizeTimer = null;
    let prevIsMobile = window.innerWidth < 640;
    window.addEventListener('resize', () => {
        const nowIsMobile = window.innerWidth < 640;
        if (nowIsMobile === prevIsMobile) return; // ei breakpointin ylitystä
        prevIsMobile = nowIsMobile;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // renderComparePage on idempotentti — sen voi kutsua tarvittaessa.
            try { renderComparePage(); } catch (e) { /* ignore */ }
        }, 150);
    });
}

$compareAssessment.addEventListener('click', (e) => {
    if (e.target.matches('[data-action="dismiss-assess"]')) {
        $compareAssessment.style.display = 'none';
        return;
    }
    const apply = e.target.closest('[data-action="apply-best"]');
    if (apply) {
        compareState.shift = Number(apply.dataset.signed) || 0;
        // Älä piilota suosituslaatikkoa — refresh ajaa sen uudelleen ja
        // näyttää ✓ kun liu'utin on suosituspisteessä.
        renderComparePage();
    }
});

// ============================================================================
// Initial
// ============================================================================

enforceCap();
renderAll();
renderPresetSelect();
