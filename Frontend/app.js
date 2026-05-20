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
};

const PER_YEAR = { week: 52, month: 12, year: 1 };
const PERIOD_LABEL = { week: 'viikossa', month: 'kuukaudessa', year: 'vuodessa' };

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
            }))
            : [],
    };
    return out;
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
    String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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
 * Compensates rounding drift on the largest item so the sum is exact.
 */
function shrinkProportionally(items, newTotal) {
    const currentTotal = items.reduce((s, c) => s + c.amount, 0);
    if (currentTotal <= 0 || items.length === 0) return;
    const safeNew = Math.max(0, newTotal);
    const scale = safeNew / currentTotal;
    items.forEach((c) => { c.amount = Math.max(0, Math.round(c.amount * scale)); });

    // Fix rounding drift so the sum lands exactly on `safeNew`.
    let drift = items.reduce((s, c) => s + c.amount, 0) - safeNew;
    let guard = 1000;
    while (drift !== 0 && guard-- > 0) {
        const step = drift > 0 ? -1 : 1;
        // For decreases (drift > 0), pick the largest >0; for increases, pick the largest.
        let pick = -1, bestAmt = step > 0 ? Infinity : -1;
        items.forEach((c, i) => {
            if (step < 0 && c.amount <= 0) return;
            if (step < 0 && c.amount > bestAmt) { bestAmt = c.amount; pick = i; }
            if (step > 0 && c.amount < bestAmt) { bestAmt = c.amount; pick = i; }
        });
        if (pick < 0) break;
        items[pick].amount += step;
        drift += step;
    }
}

/**
 * Set a category to `requested` €, auto-shrinking the others (proportionally,
 * absorbing Jakamaton first) so the total never exceeds käytettävät varat.
 */
function setCategoryAmount(catId, requested) {
    const cat = state.categories.find((c) => c.id === catId);
    if (!cat) return;
    const others = state.categories.filter((c) => c.id !== catId);
    const othersTotal = others.reduce((s, c) => s + c.amount, 0);

    let target = Math.max(0, Math.min(state.income, Math.round(requested)));

    if (target + othersTotal > state.income) {
        if (othersTotal <= 0) {
            target = state.income;
        } else {
            shrinkProportionally(others, state.income - target);
        }
    }
    cat.amount = target;
}

/** If categories overflow income (e.g. after an income decrease), scale them down. */
function enforceCap() {
    const total = totalAllocated();
    if (total > state.income && total > 0) {
        shrinkProportionally(state.categories, state.income);
    }
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
// Bar rendering — split into structure rebuild vs. size refresh so the divider
// DOM is stable during drag (pointer capture survives) and drag stays smooth.
// ----------------------------------------------------------------------------

function buildBar() {
    $bar.innerHTML = '';
    state.categories.forEach((cat, i) => {
        const seg = document.createElement('div');
        seg.className = 'segment';
        seg.dataset.id = cat.id;
        $bar.appendChild(seg);

        if (i < state.categories.length - 1) {
            const div = document.createElement('div');
            div.className = 'divider';
            div.dataset.index = String(i);
            div.title = 'Vedä siirtääksesi euroja vierekkäisten kategorioiden välillä';
            $bar.appendChild(div);
        }
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
            const leftPct = Math.min(100, (acc / income) * 100);
            div.style.left = `${leftPct}%`;
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

function renderList() {
    $categoryList.innerHTML = '';
    const sliderMax = Math.max(state.income, 100);

    state.categories.forEach((cat) => {
        const li = document.createElement('li');
        li.className = 'category-item';
        li.dataset.id = cat.id;
        li.innerHTML = `
            <input type="color" value="${cat.color}" data-action="color" aria-label="Väri">
            <input type="text" class="cat-name" value="${escapeAttr(cat.name)}" data-action="name" aria-label="Nimi">
            <input type="range" class="cat-slider" min="0" max="${sliderMax}" step="1" value="${cat.amount}" data-action="slider" aria-label="Määrä liukusäätimellä">
            <input type="number" class="cat-amount" min="0" step="10" value="${cat.amount}" data-action="amount" aria-label="Määrä euroina">
            <span class="cat-currency">€</span>
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

/** Update slider + number inputs for one category without rebuilding the list. */
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
// Divider drag — Pointer Events + capture. We re-read the bar rect on every
// move (handles scroll/resize), don't snap during drag (drag is smooth, the
// number input lets you type exact values), and never rebuild the bar DOM
// while dragging.
// ----------------------------------------------------------------------------

let dragging = null;

$bar.addEventListener('pointerdown', (e) => {
    if (!e.target.classList.contains('divider')) return;
    const i = parseInt(e.target.dataset.index, 10);
    if (Number.isNaN(i) || !state.categories[i + 1]) return;

    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }

    dragging = {
        i,
        pointerId: e.pointerId,
        node: e.target,
        leftAcc: state.categories.slice(0, i).reduce((s, c) => s + c.amount, 0),
        pairTotal: state.categories[i].amount + state.categories[i + 1].amount,
    };
    e.target.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
});

window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const { i, leftAcc, pairTotal } = dragging;
    const income = state.income || 1;

    // Fresh rect each move — survives scroll, resize, layout shifts.
    const rect = $bar.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    pos = Math.max(0, Math.min(1, pos));

    let newA = pos * income - leftAcc;
    newA = Math.max(0, Math.min(pairTotal, Math.round(newA)));

    state.categories[i].amount = newA;
    state.categories[i + 1].amount = pairTotal - newA;

    refreshBar();
    syncListRow(state.categories[i]);
    syncListRow(state.categories[i + 1]);
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
// Käytettävät varat input
// ----------------------------------------------------------------------------

$income.addEventListener('input', () => {
    state.income = Math.max(0, Math.round(Number($income.value) || 0));
    enforceCap();
    refreshBar();
    // Slider max must follow income; update in place to preserve focus.
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
// Category list — slider/number use the auto-shrink rebalancer
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
        setCategoryAmount(cat.id, requested);
        // Sync the focused input only if the cap pulled the value back.
        if (cat.amount !== requested) t.value = cat.amount;
        refreshBar();
        syncAllListRows();
        renderSummary();
        saveState();
    }
});

$categoryList.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.action !== 'remove') return;
    const li = t.closest('.category-item');
    if (!li) return;
    state.categories = state.categories.filter((c) => c.id !== li.dataset.id);
    renderAll();
    saveState();
});

document.getElementById('addCategory').addEventListener('click', () => {
    const used = new Set(state.categories.map((c) => c.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[state.categories.length % PALETTE.length];
    state.categories.push({
        id: `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: 'Uusi kategoria',
        color,
        amount: 0,
    });
    renderAll();
    saveState();
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
    state.income = DEFAULT_STATE.income;
    state.period = DEFAULT_STATE.period;
    state.categories = structuredClone(DEFAULT_STATE.categories);
    renderAll();
    saveState();
});

// ----------------------------------------------------------------------------
// Presets — named slots in browser localStorage
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

// ----------------------------------------------------------------------------
// Initial
// ----------------------------------------------------------------------------

enforceCap();
renderAll();
renderPresetSelect();
