// Player configuration
const playersConfig = [
    { id: 'hayashi', name: '林', color: '#eab308' },     // Yellow
    { id: 'kishikawa', name: '岸川', color: '#a855f7' }, // Purple
    { id: 'takeda', name: '武田', color: '#38bdf8' },    // Light Blue
    { id: 'machi', name: '町', color: '#ef4444' },       // Red
    { id: 'imamaki', name: '今牧', color: '#84cc16' },   // Yellow-Green
    { id: 'sasajima', name: '篠島', color: '#f97316' },  // Orange
    { id: 'imayoshi', name: '今吉', color: '#9ca3af' }   // Gray
];

const YEN_RATE_APP = 100; // 1 point = 100 yen
const YEN_RATE_IN_PERSON = 200; // 1 point = 200 yen
const YEN_RATE_YAKUMAN_SHUGI = 100; // 1 point = 100 yen
const STORAGE_KEY = 'mahjong_tracker_data';

const JSONBIN_URL = "https://api.jsonbin.io/v3/b/69c07493b7ec241ddc923cc7";
const JSONBIN_MASTER_KEY = "$2a$10$SH0Dl/2I/zgez6q9CE8qd.ysiVJh6voELxDp.eaa/h2nNichKakbW";

// Safe Storage Wrapper (Mobile WebViews often block localStorage and throw an error)
const safeStorage = {
    getItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('localStorage access denied. Running in memory mode.', e);
            return null;
        }
    },
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('localStorage access denied. Data will not be saved permanently.', e);
        }
    }
};

// App State
let appState = {
    matches: [],
    yakuman: {},
    settlements: {} // Stores completed settlement keys
};

// Filter State
let currentFilter = 'all'; // 'all', 'app', 'in-person'
let filterStartMonth = ''; // YYYY-MM
let filterEndMonth = '';   // YYYY-MM

// Chart Instance
let chartInstance = null;

// Pagination State
window.weeklyPage = 1;

async function initApp() {
    try {
        // Safe Date Setting (Avoid valueAsDate compatibility issues on iOS)
        const dateInput = document.getElementById('match-date');
        if (dateInput) {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateInput.value = `${yyyy}-${mm}-${dd}`;
        }

        // Load Data
        await loadData();

        // Initial Render
        renderYakuman();
        renderHistory();
        renderResults();

        try {
            renderChart();
        } catch (chartErr) {
            console.error("Chart Render Error:", chartErr);
        }

        // Event Listeners
        document.getElementById('match-form').addEventListener('submit', handleMatchSubmit);
        document.getElementById('yakuman-form').addEventListener('submit', handleYakumanSubmit);
        document.getElementById('clear-data-btn').addEventListener('click', handleClearData);

        document.getElementById('btn-latest').addEventListener('click', () => {
            document.getElementById('filter-end-month').value = '';
            filterEndMonth = '';
            triggerRender();
        });

        document.getElementById('btn-all-dates').addEventListener('click', () => {
            document.getElementById('filter-start-month').value = '';
            document.getElementById('filter-end-month').value = '';
            filterStartMonth = '';
            filterEndMonth = '';
            triggerRender();
        });

        document.getElementById('filter-start-month').addEventListener('input', (e) => {
            filterStartMonth = e.target.value;
            triggerRender();
        });

        document.getElementById('filter-end-month').addEventListener('input', (e) => {
            filterEndMonth = e.target.value;
            triggerRender();
        });

        // Filter Buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentFilter = e.target.dataset.filter;
                triggerRender();
            });
        });
    } catch (err) {
        alert("アプリ初期化エラー: " + err.message + "\n端末やブラウザが対応していない可能性があります。");
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function triggerRender() {
    window.weeklyPage = 1;
    renderYakuman();
    renderHistory();
    renderResults();
    renderChart();
    renderWeekly();
}

// Load/Save Data
async function loadData() {
    try {
        const response = await fetch(JSONBIN_URL + "/latest", {
            headers: {
                "X-Master-Key": JSONBIN_MASTER_KEY
            }
        });
        
        if (!response.ok) throw new Error("Network response was not ok");
        
        const jsonResponse = await response.json();
        let cloudData = jsonResponse.record;

        const localDataRaw = safeStorage.getItem(STORAGE_KEY);
        if (localDataRaw) {
            try {
                const localData = JSON.parse(localDataRaw);
                // Migrating old local data to cloud on first load
                if ((!cloudData || !cloudData.matches || cloudData.matches.length === 0) &&
                    Array.isArray(localData.matches) && localData.matches.length > 0) {
                    appState = processDataMigrations(localData);
                    await saveData(); 
                    return;
                }
            } catch (e) {
                console.error("Local data parse error during migration", e);
            }
        }

        appState = processDataMigrations(cloudData || { matches: [], yakuman: {}, settlements: {} });
        safeStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); // Cache locally
        
    } catch (error) {
        console.error("Cloud Load Error:", error);
        const local = safeStorage.getItem(STORAGE_KEY);
        if (local) appState = processDataMigrations(JSON.parse(local));
    }
}

function processDataMigrations(parsed) {
    let state = { matches: [], yakuman: {}, settlements: {} };
    if (Array.isArray(parsed)) {
        state.matches = parsed;
    } else if (parsed && typeof parsed === 'object') {
        state = parsed;
        if (!state.matches || !Array.isArray(state.matches)) state.matches = [];
        if (!state.yakuman) state.yakuman = {};
        if (!state.settlements) state.settlements = {};

        const keys = Object.keys(state.yakuman);
        if (keys.length > 0 && typeof state.yakuman[keys[0]] === 'number') {
            const currentYear = new Date().getFullYear().toString();
            state.yakuman = { [currentYear]: state.yakuman };
        }

        const newSettlements = {};
        Object.keys(state.settlements).forEach(k => {
            const parts = k.split('_');
            if (parts.length === 5 && parts[0] === 'settle') {
                const newKey = `settle_${parts[1]}_${parts[2]}_${parts[3]}`;
                newSettlements[newKey] = true;
            } else {
                newSettlements[k] = true;
            }
        });
        state.settlements = newSettlements;
    }
    return state;
}

let isSaving = false;
async function saveData() {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    
    if (isSaving) return;
    isSaving = true;
    
    // UI indicator
    const titleEl = document.querySelector('.logo h1');
    const originalTitle = titleEl ? titleEl.innerText : 'Mahjong Tracker';
    if (titleEl) titleEl.innerText = '保存中...';
    
    try {
        const response = await fetch(JSONBIN_URL, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-Master-Key": JSONBIN_MASTER_KEY
            },
            body: JSON.stringify(appState)
        });
        
        if (!response.ok) {
            console.error("Cloud save failed");
            alert("クラウドへの保存に失敗しました。時間をおいて再試行してください。");
        }
    } catch (error) {
        console.error("Save Error:", error);
    } finally {
        isSaving = false;
        if (titleEl) titleEl.innerText = originalTitle;
    }
}

// Form Handlers
function handleMatchSubmit(e) {
    e.preventDefault();

    const date = document.getElementById('match-date').value;
    const scores = {};
    let totalScore = 0;

    const formData = new FormData(e.target);

    playersConfig.forEach(p => {
        const val = formData.get(p.id);
        if (val && val.trim() !== '') {
            const num = parseFloat(val);
            if (!isNaN(num)) {
                scores[p.id] = num;
                totalScore += num;
            }
        }
    });

    // Warning if sum is not extremely close to 0, but still allow save
    if (Math.abs(totalScore) > 0.1 && Object.keys(scores).length > 0) {
        const proceed = confirm(`入力されたスコアの合計が ${totalScore.toFixed(1)} になっています。\n合計が0ではないようですが、このまま保存しますか？`);
        if (!proceed) return;
    }

    if (Object.keys(scores).length === 0) {
        alert("少なくとも1人以上のスコアを入力してください。");
        return;
    }

    const type = formData.get('game-type') || 'app';

    const newMatch = {
        id: Date.now().toString(),
        date: date,
        type: type,
        scores: scores
    };

    // Append and sort matches chronologically
    appState.matches.push(newMatch);
    appState.matches.sort((a, b) => new Date(a.date) - new Date(b.date));

    saveData();

    // Reset inputs but keep date
    playersConfig.forEach(p => {
        document.querySelector(`input[name="${p.id}"]`).value = '';
    });

    // Update UI
    renderHistory();
    renderResults();
    renderChart();
}

function handleYakumanSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('yakuman-player');
    const playerId = select.value;
    const yearSelect = document.getElementById('yakuman-year-input');
    const year = yearSelect ? yearSelect.value : new Date().getFullYear().toString();

    if (!playerId) return;

    if (!appState.yakuman[year]) {
        appState.yakuman[year] = {};
    }
    if (!appState.yakuman[year][playerId]) {
        appState.yakuman[year][playerId] = 0;
    }
    appState.yakuman[year][playerId]++;

    saveData();
    select.value = "";

    renderYakuman();
}

function deleteMatch(id) {
    if (confirm("この対局記録を削除しますか？")) {
        appState.matches = appState.matches.filter(m => m.id !== id);
        saveData();
        renderHistory();
        renderResults();
        renderChart();
    }
}

window.decYakuman = function (playerId, year) {
    if (appState.yakuman[year] && appState.yakuman[year][playerId] > 0) {
        appState.yakuman[year][playerId]--;
        if (appState.yakuman[year][playerId] === 0) {
            delete appState.yakuman[year][playerId];
        }
        // Clean up empty years
        if (Object.keys(appState.yakuman[year]).length === 0) {
            delete appState.yakuman[year];
        }
        saveData();
        renderYakuman();
    }
}

function handleClearData() {
    if (confirm("⚠️ 注意: 全ての対局記録と役満記録を完全に消去します。\nよろしいですか？")) {
        appState = { matches: [], yakuman: {}, settlements: {} };
        saveData();
        renderYakuman();
        triggerRender();
    }
}

// Render Functions
function renderYakuman() {
    // Populate year dropdowns if needed
    const viewSelect = document.getElementById('yakuman-view-year');
    const inputSelect = document.getElementById('yakuman-year-input');

    // Get unique years from matches and yakumans, plus a healthy buffer of past/future years
    const yearsSet = new Set();
    const currentYObj = new Date().getFullYear();
    const currentY = currentYObj.toString();

    // Add current year +/- 5 years so users can always pick past/future explicitly
    for (let y = currentYObj - 5; y <= currentYObj + 5; y++) {
        yearsSet.add(y.toString());
    }

    Object.keys(appState.yakuman).forEach(y => yearsSet.add(y));
    appState.matches.forEach(m => yearsSet.add(m.date.substring(0, 4)));

    const sortedYears = Array.from(yearsSet).sort().reverse();

    // Always rebuild dropdowns to catch new years
    const currentViewVal = viewSelect ? viewSelect.value : null;
    const currentInputVal = inputSelect ? inputSelect.value : null;

    if (viewSelect) viewSelect.innerHTML = '';
    if (inputSelect) inputSelect.innerHTML = '';

    sortedYears.forEach(y => {
        if (viewSelect) viewSelect.appendChild(new Option(`${y}年`, y));
        if (inputSelect) inputSelect.appendChild(new Option(`${y}年`, y));
    });

    if (viewSelect) viewSelect.value = currentViewVal && sortedYears.includes(currentViewVal) ? currentViewVal : currentY;
    if (inputSelect) inputSelect.value = currentInputVal && sortedYears.includes(currentInputVal) ? currentInputVal : currentY;

    const list = document.getElementById('yakuman-list');
    list.innerHTML = '';

    const selectedYear = viewSelect ? viewSelect.value : currentY;
    const yearData = appState.yakuman[selectedYear] || {};

    // Sort descending by count
    const ranked = Object.entries(yearData)
        .map(([id, count]) => {
            const player = playersConfig.find(p => p.id === id);
            return { id, name: player ? player.name : id, count };
        })
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count);

    if (ranked.length === 0) {
        list.innerHTML = '<li class="text-muted" style="grid-column: 1/-1; text-align: center;">記録なし</li>';
        return;
    }

    ranked.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'yakuman-item';

        let medal = '';
        if (index === 0) { li.classList.add('rank-1'); medal = '<span class="yakuman-medal">🥇</span>'; }
        else if (index === 1) { li.classList.add('rank-2'); medal = '<span class="yakuman-medal">🥈</span>'; }
        else if (index === 2) { li.classList.add('rank-3'); medal = '<span class="yakuman-medal">🥉</span>'; }

        li.innerHTML = `
            <div style="display:flex; align-items:center; gap:4px; word-break:keep-all; line-height:1.2; padding-right:8px;">
                ${medal} ${item.name}
            </div>
            <div style="flex-shrink:0;">
                <span class="count">${item.count}</span>
                <span class="del-yakuman" title="減らす" onclick="decYakuman('${item.id}', '${selectedYear}')">✖</span>
            </div>
        `;
        list.appendChild(li);
    });
}

function getMatchesByType() {
    return appState.matches.filter(m => {
        // App/In-person filter
        const typeMatch = currentFilter === 'all' || m.type === currentFilter || (currentFilter === 'app' && !m.type);
        return typeMatch;
    });
}

function getFilteredMatches() {
    return getMatchesByType().filter(m => {
        // Date Filter (YYYY-MM to YYYY-MM)
        const matchMonth = m.date.substring(0, 7); // extract YYYY-MM

        if (filterStartMonth && matchMonth < filterStartMonth) return false;
        if (filterEndMonth && matchMonth > filterEndMonth) return false;

        return true;
    });
}

function renderHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';

    const filteredMatches = getFilteredMatches();

    if (filteredMatches.length === 0) {
        list.innerHTML = '<li class="history-item text-muted">記録がありません</li>';
        return;
    }

    // Show newest first visually
    const sorted = [...filteredMatches].reverse();

    sorted.forEach(match => {
        const li = document.createElement('li');
        li.className = 'history-item';

        let scoresHtml = '';
        for (const [id, score] of Object.entries(match.scores)) {
            const player = playersConfig.find(p => p.id === id);
            const name = player ? player.name : id;
            const sign = score > 0 ? '+' : '';
            const colorClass = score > 0 ? 'val-positive' : (score < 0 ? 'val-negative' : 'val-zero');
            scoresHtml += `<span>${name}: <span class="${colorClass}">${sign}${score}</span></span>`;
        }

        let typeBadge = '';
        if (match.type === 'yakuman-shugi') {
            typeBadge = '<span class="type-badge type-yakuman-shugi">🎉 役満祝儀</span>';
        } else if (match.type === 'in-person') {
            typeBadge = '<span class="type-badge type-in-person">🀄 対面</span>';
        } else {
            typeBadge = '<span class="type-badge type-app">📱 アプリ</span>';
        }

        li.innerHTML = `
            <div>
                <div class="history-item-header">
                    <span class="date">${match.date}</span>
                    ${typeBadge}
                </div>
                <div class="scores">${scoresHtml}</div>
            </div>
            <button class="del-btn" onclick="deleteMatch('${match.id}')">🗑</button>
        `;
        list.appendChild(li);
    });
}

// Calculate cumulative stats based on filtered matches
function getCumulativeStats() {
    const stats = {};
    playersConfig.forEach(p => {
        stats[p.id] = { point: 0, yen: 0, rankSum: 0, playCount: 0, participationDates: new Set() };
    });

    const matches = getFilteredMatches();

    matches.forEach(match => {
        let rate = YEN_RATE_APP;
        if (match.type === 'in-person') rate = YEN_RATE_IN_PERSON;
        else if (match.type === 'yakuman-shugi') rate = YEN_RATE_YAKUMAN_SHUGI;

        const isYakumanShugi = match.type === 'yakuman-shugi';

        // Calculate ranks for this match
        // Sort participants by score descending
        const matchScores = Object.entries(match.scores).sort((a, b) => b[1] - a[1]);

        for (let i = 0; i < matchScores.length; i++) {
            const playerId = matchScores[i][0];
            const score = matchScores[i][1];

            // Handle ties: if same score as previous, same rank
            let rank = i + 1;
            if (i > 0 && matchScores[i][1] === matchScores[i - 1][1]) {
                // Find actual top rank of tied group. Simple approach: just use i+1
                // Better approach with actual tied rank (e.g. 1, 2, 2, 4) could be done
                // but since scoring gives decimals often, ties are rare. Let's just use simple i+1 for now,
                // or search back for first tie. Let's search back to be precise:
                let sameCounter = 0;
                for (let j = i - 1; j >= 0; j--) {
                    if (matchScores[j][1] === score) sameCounter++;
                    else break;
                }
                rank = i + 1 - sameCounter;
            }

            if (stats.hasOwnProperty(playerId)) {
                stats[playerId].point += score;
                stats[playerId].yen += Math.round(score * rate);

                if (!isYakumanShugi) {
                    stats[playerId].rankSum += rank;
                    stats[playerId].playCount += 1;
                }
                
                if (match.date >= '2026-03-23') {
                    stats[playerId].participationDates.add(match.date);
                }
            }
        }
    });

    return stats;
}

function renderResults() {
    const body = document.getElementById('results-body');
    body.innerHTML = '';

    const stats = getCumulativeStats();

    // Sort array by yen descending (or points)
    const ranked = playersConfig.map(p => {
        const avgRank = stats[p.id].playCount > 0 ? (stats[p.id].rankSum / stats[p.id].playCount) : 0;
        return {
            ...p,
            point: stats[p.id].point,
            yen: stats[p.id].yen,
            avgRank: avgRank,
            playCount: stats[p.id].playCount,
            participationDays: stats[p.id].participationDates ? stats[p.id].participationDates.size : 0
        };
    }).sort((a, b) => b.point - a.point);

    ranked.forEach((item, index) => {
        const tr = document.createElement('tr');

        // Rank visual formatting
        const rankStr = index + 1;
        let rankClass = '';
        if (rankStr === 1) rankClass = 'rank-1';
        else if (rankStr === 2) rankClass = 'rank-2';
        else if (rankStr === 3) rankClass = 'rank-3';

        // Value signs
        const ptStr = (item.point > 0 ? '+' : '') + item.point.toFixed(1);
        const yenStr = (item.yen > 0 ? '+' : '') + item.yen.toLocaleString() + ' Point';
        const valClass = item.point > 0 ? 'val-positive' : (item.point < 0 ? 'val-negative' : 'val-zero');

        tr.innerHTML = `
            <td class="${rankClass}">${rankStr}位</td>
            <td>
                <span class="color-dot" style="background: ${item.color}"></span>
                ${item.name}
            </td>
            <td class="text-right">${item.participationDays}</td>
            <td class="text-right ${valClass}">${ptStr} jan</td>
            <td class="text-right ${valClass}">${yenStr}</td>
        `;
        body.appendChild(tr);
    });

    renderWeekly();
}

// ISO Week Helper
function getMondayOfDate(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function renderWeekly() {
    const container = document.getElementById('weekly-container');
    container.innerHTML = '';

    // Clear the tracking array for settlements
    window.currentSettlements = [];

    const baseMatches = getMatchesByType();
    if (baseMatches.length === 0) {
        container.innerHTML = '<div class="text-muted text-center" style="padding: 1rem;">記録がありません</div>';
        return;
    }

    // 1. Group ALL type-filtered matches into weeks (Calculate chronologically)
    const weeks = {};
    baseMatches.forEach(match => {
        const matchDate = new Date(match.date);
        const monday = getMondayOfDate(matchDate);

        // End of week (Sunday)
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);

        // Standardize key formatting (YYYY/MM/DD)
        const formatStr = d => `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
        const weekKey = `${formatStr(monday)} - ${formatStr(sunday)}`;
        const weekMonth = `${monday.getFullYear()}-${(monday.getMonth() + 1).toString().padStart(2, '0')}`;

        if (!weeks[weekKey]) {
            weeks[weekKey] = {
                weekLabel: weekKey,
                sortKey: monday.getTime(),
                weekMonth: weekMonth,
                matchesCount: 0,
                stats: {} // this week's net
            };
            playersConfig.forEach(p => weeks[weekKey].stats[p.id] = { point: 0, yen: 0 });
        }

        let rate = YEN_RATE_APP;
        if (match.type === 'in-person') rate = YEN_RATE_IN_PERSON;
        else if (match.type === 'yakuman-shugi') rate = YEN_RATE_YAKUMAN_SHUGI;

        if (match.type !== 'yakuman-shugi') {
            weeks[weekKey].matchesCount++;
        }
        for (const [id, score] of Object.entries(match.scores)) {
            weeks[weekKey].stats[id].point += score;
            weeks[weekKey].stats[id].yen += Math.round(score * rate);
        }
    });

    // 2. Sort chronologically to calculate rolling settlements
    const sortedWeeksChronological = Object.values(weeks).sort((a, b) => a.sortKey - b.sortKey);
    const runningBalances = {};
    playersConfig.forEach(p => runningBalances[p.id] = 0);

    sortedWeeksChronological.forEach(weekData => {
        // Add this week's yen into runningBalances
        playersConfig.forEach(p => {
            runningBalances[p.id] += weekData.stats[p.id].yen;
        });

        // Greedy match for settlements from the running balances
        const balancesForSettle = [];
        playersConfig.forEach(p => {
            if (runningBalances[p.id] !== 0) {
                balancesForSettle.push({ id: p.id, name: p.name, yen: runningBalances[p.id] });
            }
        });

        const losers = balancesForSettle.filter(b => b.yen <= -1).sort((a, b) => a.yen - b.yen);
        const winners = balancesForSettle.filter(b => b.yen >= 1).sort((a, b) => b.yen - a.yen);

        const settlements = [];
        let i = 0, j = 0;

        const l_yen = losers.map(l => l.yen);
        const w_yen = winners.map(w => w.yen);

        while (i < losers.length && j < winners.length) {
            const loser = losers[i];
            const winner = winners[j];

            const amount = Math.min(Math.abs(l_yen[i]), w_yen[j]);
            if (amount > 0) {
                const key = `settle_${weekData.sortKey}_${loser.id}_${winner.id}`;
                const st = {
                    payer: loser,
                    receiver: winner,
                    amount: amount,
                    key: key,
                    sortKey: weekData.sortKey
                };
                settlements.push(st);
                window.currentSettlements.push(st);

                l_yen[i] += amount;
                w_yen[j] -= amount;
            }
            if (Math.abs(l_yen[i]) < 0.1) i++;
            if (Math.abs(w_yen[j]) < 0.1) j++;
        }

        weekData.settlements = settlements;

        // Apply checked settlements to reduce the running debt
        settlements.forEach(s => {
            if (appState.settlements[s.key]) {
                runningBalances[s.payer.id] += s.amount;
                runningBalances[s.receiver.id] -= s.amount;
            }
        });
    });

    // 3. Display the weeks in descending order, applying the Date Filter
    const sortedWeeksDescending = [...sortedWeeksChronological].reverse();
    const displayWeeks = sortedWeeksDescending.filter(w => {
        if (filterStartMonth && w.weekMonth < filterStartMonth) return false;
        if (filterEndMonth && w.weekMonth > filterEndMonth) return false;
        return true;
    });

    if (displayWeeks.length === 0) {
        container.innerHTML = '<div class="text-muted text-center" style="padding: 1rem;">指定期間の記録がありません</div>';
        return;
    }

    // 4. Pagination
    const WEEKS_PER_PAGE = 3;
    const totalPages = Math.ceil(displayWeeks.length / WEEKS_PER_PAGE);
    const paginatedWeeks = displayWeeks.slice(0, window.weeklyPage * WEEKS_PER_PAGE);

    paginatedWeeks.forEach((weekData, index) => {
        const div = document.createElement('div');
        const isPastWeek = index > 0 || window.weeklyPage > 1; // Anything after first displayed block
        const blockClass = isPastWeek ? 'week-block past-week-block fadeIn' : 'week-block fadeIn';
        div.className = blockClass;

        // If it's a past week, span the full width of the grid so it's not constrained to 280px
        if (isPastWeek) {
            div.style.gridColumn = "1 / -1";
        }

        let playersHtml = '';

        // Display ONLY this week's individual scores
        const weekPlayers = playersConfig.map(p => ({
            name: p.name,
            color: p.color,
            yen: weekData.stats[p.id].yen
        })).filter(p => p.yen !== 0).sort((a, b) => b.yen - a.yen);

        if (weekPlayers.length === 0) {
            playersHtml = '<span class="text-muted">該当者なし</span>';
        } else {
            if (isPastWeek) {
                // Formatting for past weeks: one compact line taking full width advantage
                const inlineSnips = weekPlayers.map(p => {
                    const ptStr = (p.yen > 0 ? '+' : '') + p.yen.toLocaleString();
                    const valClass = p.yen > 0 ? 'val-positive' : (p.yen < 0 ? 'val-negative' : 'val-zero');
                    return `<span style="white-space:nowrap;"><span class="color-dot" style="background: ${p.color}; width:8px; height:8px; margin-right:4px; display:inline-block;"></span>${p.name}: <span class="${valClass}">${ptStr} Point</span></span>`;
                });

                playersHtml = `
                    <div style="display:flex; flex-wrap:nowrap; overflow-x:auto; gap:16px; font-size:0.85rem; padding:6px 0; margin-bottom:4px; line-height:1.4;">
                        ${inlineSnips.join('')}
                    </div>
                `;
            } else {
                // Current latest week: full view
                weekPlayers.forEach(p => {
                    const yenStr = (p.yen > 0 ? '+' : '') + p.yen.toLocaleString() + ' Point';
                    const valClass = p.yen > 0 ? 'val-positive' : (p.yen < 0 ? 'val-negative' : 'val-zero');
                    playersHtml += `
                        <div class="week-player">
                            <span><span class="color-dot" style="background: ${p.color}"></span>${p.name}</span>
                            <span class="${valClass}">${yenStr}</span>
                        </div>
                    `;
                });
            }
        }

        // Display the accumulated settlements ONLY for the latest displayed week
        let settlementsHtml = '';
        if (!isPastWeek) {
            if (weekData.settlements.length > 0) {
                settlementsHtml += `<div class="settlement-list">`;
                settlementsHtml += `<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">📋 累計未払い・清算額 (チェックで支払い完了)</div>`;
                weekData.settlements.forEach(s => {
                    const isChecked = appState.settlements[s.key] ? 'checked' : '';
                    const textClass = isChecked ? 'settlement-checked' : '';

                    settlementsHtml += `
                        <label class="settlement-item ${textClass}">
                            <input type="checkbox" class="settlement-checkbox" 
                                data-key="${s.key}" 
                                data-payer="${s.payer.id}" 
                                data-receiver="${s.receiver.id}" 
                                data-sortkey="${s.sortKey}"
                                onchange="toggleSettlement(this)" ${isChecked}>
                            <div class="settlement-grid">
                                <span class="s-payer">${s.payer.name}</span>
                                <span class="s-arrow">➡️</span>
                                <span class="s-receiver">${s.receiver.name}</span>
                                <span class="s-amount">${s.amount.toLocaleString()} Point</span>
                            </div>
                        </label>
                    `;
                });
                settlementsHtml += `</div>`;
            } else {
                settlementsHtml += `<div class="settlement-list text-muted" style="font-size:0.8rem;">📋 清算なし（残高ゼロ）</div>`;
            }
        }

        const summaryClass = isPastWeek ? 'week-summary-past' : 'week-summary';
        const summaryStyle = isPastWeek ? 'margin-bottom: 1rem;' : '';

        div.innerHTML = `
            <div class="week-header">
                ${weekData.weekLabel}
                <span class="badge" style="font-weight: normal; font-size: 0.75rem;">その週の対局: ${weekData.matchesCount}</span>
            </div>
            <div class="${summaryClass}" style="${summaryStyle}">
                ${playersHtml}
            </div>
            ${settlementsHtml}
        `;
        container.appendChild(div);
    });

    // Pagination Controls
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '0.5rem';
    btnContainer.style.marginTop = '0.5rem';

    if (window.weeklyPage < totalPages) {
        btnContainer.innerHTML += `<button class="btn-secondary" style="flex:1;" onclick="loadMoreWeeks()">過去の週をもっと見る</button>`;
    }

    // Show 'Close' button if user has loaded past the first page
    if (window.weeklyPage > 1) {
        btnContainer.innerHTML += `<button class="btn-secondary" style="flex:1; background:var(--bg-lighter);" onclick="resetWeekly()">閉じる（最新週に戻す）</button>`;
    }

    if (btnContainer.innerHTML !== '') {
        container.appendChild(btnContainer);
    }
}

window.loadMoreWeeks = function () {
    window.weeklyPage++;
    renderWeekly();
}

window.resetWeekly = function () {
    window.weeklyPage = 1;
    renderWeekly();
    // Scroll smoothly to the weekly section
    document.querySelector('.section-weekly').scrollIntoView({ behavior: 'smooth' });
}

// Global function to handle toggle
window.toggleSettlement = function (checkbox) {
    const isChecked = checkbox.checked;
    const key = checkbox.dataset.key;
    const payer = checkbox.dataset.payer;
    const receiver = checkbox.dataset.receiver;
    const sortKey = parseInt(checkbox.dataset.sortkey, 10);

    // Apply to current
    if (isChecked) {
        appState.settlements[key] = true;
    } else {
        delete appState.settlements[key];
    }

    // Apply to historical/future matching settlements
    if (window.currentSettlements) {
        window.currentSettlements.forEach(s => {
            if (s.payer.id === payer && s.receiver.id === receiver) {
                if (isChecked && s.sortKey <= sortKey) {
                    appState.settlements[s.key] = true;
                } else if (!isChecked && s.sortKey >= sortKey) {
                    delete appState.settlements[s.key];
                }
            }
        });
    }

    saveData();
    triggerRender();
};

function renderChart() {
    const ctx = document.getElementById('scoreChart').getContext('2d');

    // Prepare Data
    // X-axis: Dates (cumulative)
    // Create an initial state of 0 points for everyone before the first match
    const labels = ['開始時'];
    const datasets = playersConfig.map(p => ({
        label: p.name,
        data: [0], // Initial point is 0
        borderColor: p.color,
        backgroundColor: p.color,
        tension: 0.3, // smooth curves
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4
    }));

    const runningTotals = {};
    playersConfig.forEach(p => runningTotals[p.id] = 0);

    const matches = getFilteredMatches();

    // Process matches in chronological order
    matches.forEach((match, idx) => {
        // Label could be date or match number. "MM/DD" is compact.
        const dateObj = new Date(match.date);
        labels.push(`${dateObj.getMonth() + 1}/${dateObj.getDate()}`);

        let rate = YEN_RATE_APP;
        if (match.type === 'in-person') rate = YEN_RATE_IN_PERSON;
        else if (match.type === 'yakuman-shugi') rate = YEN_RATE_YAKUMAN_SHUGI;

        for (const [id, score] of Object.entries(match.scores)) {
            if (runningTotals.hasOwnProperty(id)) {
                runningTotals[id] += Math.round(score * rate);
            }
        }

        // Push current cumulative state to each dataset
        datasets.forEach(ds => {
            // find player id for this dataset
            const player = playersConfig.find(p => p.name === ds.label);
            ds.data.push(runningTotals[player.id]);
        });
    });

    if (chartInstance) {
        chartInstance.destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', 'Noto Sans JP', sans-serif";

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const valStr = context.parsed.y.toLocaleString() + ' Point';
                                label += context.parsed.y > 0 ? '+' + valStr : valStr;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        }
    });
}
