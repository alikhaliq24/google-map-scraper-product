const API_BASE = '/api';

// DOM Elements
const newSearchBtn      = document.getElementById('newSearchBtn');
const searchModal       = document.getElementById('searchModal');
const closeModals       = document.querySelectorAll('.close-modal');
const searchForm        = document.getElementById('searchForm');
const groupList         = document.getElementById('groupList');
const dashboardTitle    = document.getElementById('dashboardTitle');
const groupActions      = document.getElementById('groupActions');
const statusIndicator   = document.getElementById('statusIndicator');
const statusText        = document.getElementById('statusText');
const leadsTable        = document.getElementById('leadsTable');
const leadsTableBody    = document.getElementById('leadsTableBody');
const emptyState        = document.getElementById('emptyState');
const leadsCountContainer = document.getElementById('leadsCountContainer');
const leadsCount        = document.getElementById('leadsCount');
const appendBtn         = document.getElementById('appendBtn');
const autoEnrichBtn     = document.getElementById('autoEnrichBtn');
const backfillMapsBtn   = document.getElementById('backfillMapsBtn');
const refreshBtn        = document.getElementById('refreshBtn');
const exportBtn         = document.getElementById('exportBtn');
const deleteGroupBtn    = document.getElementById('deleteGroupBtn');
const toastContainer    = document.getElementById('toastContainer');
const enrichDrawer      = document.getElementById('enrichDrawer');
const drawerOverlay     = document.getElementById('drawerOverlay');
const closeDrawer       = document.getElementById('closeDrawer');
const drawerBody        = document.getElementById('drawerBody');
const drawerBusinessName = document.getElementById('drawerBusinessName');

// Edit group button (created dynamically)
const editGroupBtn = document.createElement('i');
editGroupBtn.className = 'fa-solid fa-pen';
editGroupBtn.title = 'Edit group name';
editGroupBtn.style.cssText = 'cursor:pointer;font-size:16px;margin-left:12px;color:var(--text-muted);opacity:0.6;transition:opacity 0.2s;';
editGroupBtn.onmouseover = () => editGroupBtn.style.opacity = '1';
editGroupBtn.onmouseout  = () => editGroupBtn.style.opacity = '0.6';
editGroupBtn.onclick = handleEditGroup;

let currentGroupId = null;
let pollInterval   = null;
// Track which leads are being LLM-enriched (polled per-row)
const enrichingLeads = new Map(); // leadId → intervalId

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', fetchGroups);

// Events
newSearchBtn.addEventListener('click', () => searchModal.classList.remove('hidden'));
closeModals.forEach(btn => btn.addEventListener('click', () => searchModal.classList.add('hidden')));
searchForm.addEventListener('submit', handleNewSearch);
appendBtn.addEventListener('click', handleAppend);
autoEnrichBtn.addEventListener('click', handleAutoEnrich);
backfillMapsBtn.addEventListener('click', handleBackfillMaps);
refreshBtn.addEventListener('click', () => ifSelectedFetchLeads(currentGroupId));
exportBtn.addEventListener('click', handleExport);
deleteGroupBtn.addEventListener('click', handleDeleteGroup);
closeDrawer.addEventListener('click', closeLLMDrawer);
drawerOverlay.addEventListener('click', closeLLMDrawer);

// ── Groups ─────────────────────────────────────────────────────────────────
async function fetchGroups() {
    try {
        const res = await fetch(`${API_BASE}/groups`);
        const groups = await res.json();
        renderGroupSidebar(groups);
    } catch (e) {
        showToast('Error fetching groups', 'error');
    }
}

function renderGroupSidebar(groups) {
    groupList.innerHTML = '';
    groups.forEach(group => {
        const li = document.createElement('li');
        li.className = `group-item ${currentGroupId === group.id ? 'active' : ''}`;
        li.innerHTML = `
            <div class="group-title" title="${group.name}">${group.name}</div>
            <div class="status-badge status-${group.status}" title="${group.status}"></div>
        `;
        li.onclick = () => selectGroup(group);
        groupList.appendChild(li);
    });
}

async function handleNewSearch(e) {
    e.preventDefault();
    const query = document.getElementById('query').value;
    const limit = parseInt(document.getElementById('limit').value);
    try {
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerHTML = '<div class="loader"></div> Starting...';
        const res = await fetch(`${API_BASE}/groups`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query, limit })
        });
        const data = await res.json();
        searchModal.classList.add('hidden');
        searchForm.reset();
        btn.disabled = false;
        btn.innerHTML = 'Start Scraping <i class="fa-solid fa-rocket"></i>';
        showToast('Scraping job started!', 'success');
        await fetchGroups();
        selectGroup(data);
    } catch (e) {
        showToast('Failed to start scrape job', 'error');
    }
}

async function selectGroup(group) {
    currentGroupId = group.id;
    dashboardTitle.innerText = group.name;
    dashboardTitle.appendChild(editGroupBtn);
    document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
    try {
        fetchGroups();
        groupActions.classList.remove('hidden');
        ifSelectedFetchLeads(group.id, group.status);
    } catch(e) {}
}

async function ifSelectedFetchLeads(id, fallbackStatus = 'unknown') {
    if (!id) return;
    try {
        const groupRes = await fetch(`${API_BASE}/groups`);
        const groups   = await groupRes.json();
        const group    = groups.find(g => g.id === id);
        if (!group) return;

        updateStatusIndicator(group.status);

        if (group.status === 'scraping' || group.status === 'pending') {
            if (!pollInterval) pollInterval = setInterval(() => ifSelectedFetchLeads(id), 3000);
        } else {
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        }

        const res   = await fetch(`${API_BASE}/groups/${id}/leads`);
        const leads = await res.json();
        renderLeads(leads);
    } catch (e) {
        console.error(e);
    }
}

async function handleAppend() {
    if (!currentGroupId) return;
    const limitStr = prompt("How many additional leads do you want to extract?", "100");
    if (!limitStr) return;
    const limit = parseInt(limitStr);
    if (isNaN(limit) || limit <= 0) { showToast('Please enter a valid number', 'error'); return; }
    try {
        appendBtn.disabled = true;
        appendBtn.innerHTML = '<div class="loader"></div>';
        await fetch(`${API_BASE}/groups/${currentGroupId}/append`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ limit })
        });
        showToast('Append started!', 'success');
        ifSelectedFetchLeads(currentGroupId, 'scraping');
        fetchGroups();
    } catch (e) {
        showToast('Failed to append leads', 'error');
    } finally {
        appendBtn.disabled = false;
        appendBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Extract More';
    }
}

async function handleAutoEnrich() {
    if (!currentGroupId) return;
    if (!confirm('This will visit every lead\'s website to extract emails, social links, and tech stack. Continue?')) return;
    try {
        autoEnrichBtn.disabled = true;
        autoEnrichBtn.innerHTML = '<div class="loader"></div> Enriching...';
        await fetch(`${API_BASE}/groups/${currentGroupId}/auto-enrich`, { method: 'POST' });
        showToast('Auto-enrichment started in background!', 'success');
        // Poll to refresh table as leads update
        const enrichPoll = setInterval(async () => {
            const res = await fetch(`${API_BASE}/groups/${currentGroupId}/leads`);
            const leads = await res.json();
            renderLeads(leads);
            const allDone = leads.every(l => l.auto_enrichment_status !== 'enriching');
            if (allDone) {
                clearInterval(enrichPoll);
                autoEnrichBtn.disabled = false;
                autoEnrichBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Auto-Enrich All';
                showToast('Auto-enrichment complete!', 'success');
            }
        }, 4000);
    } catch (e) {
        showToast('Failed to start enrichment', 'error');
        autoEnrichBtn.disabled = false;
        autoEnrichBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Auto-Enrich All';
    }
}

async function handleBackfillMaps() {
    if (!currentGroupId) return;
    if (!confirm('This will re-visit Google Maps for all leads in this group to fill in Hours, Location, Photos, and Claimed status. It opens a browser and may take several minutes. Continue?')) return;
    try {
        backfillMapsBtn.disabled = true;
        backfillMapsBtn.innerHTML = '<div class="loader"></div> Backfilling...';
        await fetch(`${API_BASE}/groups/${currentGroupId}/backfill-maps`, { method: 'POST' });
        showToast('Maps backfill started! This runs in the background.', 'success');
        // Poll to refresh as leads update
        const poll = setInterval(async () => {
            await ifSelectedFetchLeads(currentGroupId);
        }, 5000);
        setTimeout(() => {
            clearInterval(poll);
            backfillMapsBtn.disabled = false;
            backfillMapsBtn.innerHTML = '<i class="fa-solid fa-map-location-dot"></i> Backfill Maps';
        }, 120000); // stop polling after 2 min
    } catch (e) {
        showToast('Failed to start backfill', 'error');
        backfillMapsBtn.disabled = false;
        backfillMapsBtn.innerHTML = '<i class="fa-solid fa-map-location-dot"></i> Backfill Maps';
    }
}

function updateStatusIndicator(status) {
    if (status === 'completed' || status === 'failed') {
        statusIndicator.classList.add('hidden');
    } else {
        statusIndicator.classList.remove('hidden');
        statusText.innerText = `Status: ${status}...`;
    }
}


// ── Render Leads ───────────────────────────────────────────────────────────
function renderLeads(leads) {
    emptyState.classList.add('hidden');
    leadsTable.classList.remove('hidden');
    leadsCountContainer.classList.remove('hidden');
    leadsCount.innerText = leads.length;
    leadsTableBody.innerHTML = '';

    if (leads.length === 0) {
        leadsTable.classList.add('hidden');
        leadsCountContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.innerHTML = '<i class="fa-solid fa-ghost empty-icon"></i><p>No leads found yet.</p>';
        return;
    }

    leads.forEach(lead => {
        const tr = document.createElement('tr');
        if (lead.is_permanently_closed) tr.classList.add('closed-lead');

        // ── 1. Business (like original)
        const businessHTML = `
            <strong>${lead.name}</strong><br>
            <small style="color:var(--accent-primary)">${lead.category || 'Local Business'}</small><br>
            <small style="color:var(--text-muted)">${lead.address || '—'}</small>
        `;

        // ── 2. Contact
        const emailLink = lead.email
            ? `<br><a href="mailto:${lead.email}" style="color:var(--accent-primary);font-size:0.82rem">${lead.email}</a>`
            : '';
        const waLink = lead.whatsapp_link
            ? ` <a href="${lead.whatsapp_link}" target="_blank" title="WhatsApp" style="color:#25d366"><i class="fa-brands fa-whatsapp"></i></a>`
            : '';
        const contactHTML = `${lead.phone || '—'}${emailLink}${waLink}`;

        // ── 3. Website — "Visit" link or "—"
        const websiteHTML = lead.website
            ? `<a href="${lead.website}" target="_blank" style="color:var(--accent-primary)">Visit</a>`
            : '—';

        // ── 4. Social icons only (no globe here)
        const socials = [
            { url: lead.facebook_url,  cls: 'si-fb', icon: 'fa-brands fa-facebook-f',  label: 'Facebook' },
            { url: lead.instagram_url, cls: 'si-ig', icon: 'fa-brands fa-instagram',    label: 'Instagram' },
            { url: lead.linkedin_url,  cls: 'si-li', icon: 'fa-brands fa-linkedin-in',  label: 'LinkedIn' },
            { url: lead.twitter_url,   cls: 'si-tw', icon: 'fa-brands fa-x-twitter',    label: 'Twitter/X' },
            { url: lead.tiktok_url,    cls: 'si-tt', icon: 'fa-brands fa-tiktok',       label: 'TikTok' },
            { url: lead.youtube_url,   cls: 'si-yt', icon: 'fa-brands fa-youtube',      label: 'YouTube' },
        ].filter(s => s.url);

        const socialHTML = socials.length
            ? `<div class="social-icons">${socials.map(s =>
                `<a href="${s.url}" target="_blank" class="social-icon ${s.cls}" title="${s.label}"><i class="${s.icon}"></i></a>`
              ).join('')}</div>`
            : '—';

        // ── 5. Rating & Reviews
        const ratingHTML = lead.rating
            ? `<i class="fa-solid fa-star" style="color:#fbbf24;font-size:11px;"></i> <strong>${lead.rating}</strong><br><small style="color:var(--text-muted)">${lead.reviews_count || 0} reviews</small>`
            : '—';

        // ── 6. Hours
        const hoursHTML = lead.hours_of_operation
            ? `<span style="font-size:0.82rem">${lead.hours_of_operation.split('\n')[0]}</span>`
            : '—';

        // ── 7. Location (type + claimed + closed)
        const locChip     = lead.location_type
            ? `<span class="chip ${lead.location_type === 'Multi-Location' ? 'chip-multi' : 'chip-single'}">${lead.location_type}</span>`
            : '';
        const claimedChip = lead.is_claimed === true ? `<span class="chip chip-claimed">✓ Claimed</span>` : '';
        const closedChip  = lead.is_permanently_closed ? `<span class="chip chip-closed">Closed</span>` : '';
        const locationHTML = `<div class="tech-chips">${locChip}${claimedChip}${closedChip}</div>` || '—';

        // ── 8. Photos
        const photosHTML = lead.photos_count != null ? `${lead.photos_count}` : '—';

        // ── 9. Score
        let scoreBadge = `<div class="score-badge score-none">N/A</div>`;
        if (lead.lead_score != null) {
            const cls = lead.lead_score >= 70 ? 'score-high' : lead.lead_score >= 40 ? 'score-medium' : 'score-low';
            scoreBadge = `<div class="score-badge ${cls}">${lead.lead_score}</div>`;
        }
        const enrichStatus = lead.llm_enrichment_status;
        const enrichStatusHTML = enrichStatus === 'enriching'
            ? `<div class="enrich-row-status enriching"><div class="loader" style="display:inline-block;width:10px;height:10px;margin-right:4px"></div>Analyzing...</div>`
            : enrichStatus === 'done'   ? `<div class="enrich-row-status done">✓ Done</div>`
            : enrichStatus === 'failed' ? `<div class="enrich-row-status failed">✗ Failed</div>`
            : '';

        // ── 10. Actions — Enrich button only
        let enrichLabel = '✨ Enrich';
        let enrichDisabled = '';
        if (enrichStatus === 'enriching') { enrichLabel = '<div class="loader" style="width:12px;height:12px"></div>'; enrichDisabled = 'disabled'; }
        else if (enrichStatus === 'done') { enrichLabel = '✨ View'; }

        const enrichBtnHTML = `<button class="btn btn-sm btn-enrich-sm" ${enrichDisabled}
            onclick="handleLeadEnrich(${lead.id}, '${escapeSingle(lead.name)}', '${enrichStatus}')"
        >${enrichLabel}</button>`;

        tr.innerHTML = `
            <td style="vertical-align:top">${businessHTML}</td>
            <td style="vertical-align:top">${contactHTML}</td>
            <td>${websiteHTML}</td>
            <td>${socialHTML}</td>
            <td>${ratingHTML}</td>
            <td>${hoursHTML}</td>
            <td>${locationHTML}</td>
            <td>${photosHTML}</td>
            <td>${scoreBadge}${enrichStatusHTML}</td>
            <td>${enrichBtnHTML}</td>
        `;
        leadsTableBody.appendChild(tr);
    });
}

// ── Per-Lead LLM Enrich ────────────────────────────────────────────────────
async function handleLeadEnrich(leadId, businessName, currentStatus) {
    drawerBusinessName.textContent = businessName;

    if (currentStatus === 'done') {
        // Just open drawer with existing data
        const res = await fetch(`${API_BASE}/leads/${leadId}`);
        const lead = await res.json();
        openLLMDrawer(lead);
        return;
    }

    // Show loading drawer
    openDrawerLoading(businessName);

    try {
        await fetch(`${API_BASE}/leads/${leadId}/llm-enrich`, { method: 'POST' });
    } catch (e) {
        drawerBody.innerHTML = `<div class="drawer-failed"><i class="fa-solid fa-circle-exclamation" style="font-size:2rem;margin-bottom:12px"></i><p>Failed to start enrichment.</p></div>`;
        return;
    }

    // Poll until done
    const pollId = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/leads/${leadId}`);
            const lead = await res.json();

            if (lead.llm_enrichment_status === 'done') {
                clearInterval(pollId);
                openLLMDrawer(lead);
                // Refresh table row
                ifSelectedFetchLeads(currentGroupId);
            } else if (lead.llm_enrichment_status === 'failed') {
                clearInterval(pollId);
                drawerBody.innerHTML = `<div class="drawer-failed"><i class="fa-solid fa-circle-exclamation" style="font-size:2rem;margin-bottom:12px"></i><p>Enrichment failed. Try again.</p></div>`;
                ifSelectedFetchLeads(currentGroupId);
            }
        } catch(e) {}
    }, 2500);
}

function openDrawerLoading(name) {
    drawerBusinessName.textContent = name;
    drawerBody.innerHTML = `
        <div class="drawer-loading">
            <div class="loader"></div>
            <p>Reading reviews &amp; website…<br><small style="color:var(--text-muted)">This takes ~30 seconds</small></p>
        </div>`;
    enrichDrawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
}

function openLLMDrawer(lead) {
    drawerBusinessName.textContent = lead.name;

    // Score
    let scoreClass = 'score-none';
    let scoreLabel = 'N/A';
    if (lead.lead_score !== null && lead.lead_score !== undefined) {
        scoreClass = lead.lead_score >= 70 ? 'score-high' : lead.lead_score >= 40 ? 'score-medium' : 'score-low';
        scoreLabel = lead.lead_score;
    }

    const painList = (lead.pain_points || '').split('|').filter(Boolean);
    const positiveList = (lead.positive_themes || '').split('|').filter(Boolean);

    drawerBody.innerHTML = `
        <!-- Score -->
        <div class="drawer-section">
            <div class="drawer-section-title">Lead Score</div>
            <div class="drawer-score-row">
                <div class="score-badge ${scoreClass}" style="width:60px;height:60px;font-size:1.4rem;border-width:3px">${scoreLabel}</div>
                <p class="drawer-score-reason">${lead.lead_score_reason || 'No score reason available.'}</p>
            </div>
        </div>

        <!-- Summary -->
        ${lead.business_summary ? `
        <div class="drawer-section">
            <div class="drawer-section-title">Business Summary</div>
            <div class="drawer-summary">${lead.business_summary}</div>
        </div>` : ''}

        <!-- Pain Points -->
        ${painList.length ? `
        <div class="drawer-section">
            <div class="drawer-section-title">Customer Pain Points</div>
            <ul class="insight-list">
                ${painList.map(p => `
                <li class="insight-item insight-pain">
                    <span class="insight-icon">⚠️</span>
                    <span>${p.trim()}</span>
                </li>`).join('')}
            </ul>
        </div>` : ''}

        <!-- Positive Themes -->
        ${positiveList.length ? `
        <div class="drawer-section">
            <div class="drawer-section-title">What Customers Love</div>
            <ul class="insight-list">
                ${positiveList.map(p => `
                <li class="insight-item insight-positive">
                    <span class="insight-icon">✅</span>
                    <span>${p.trim()}</span>
                </li>`).join('')}
            </ul>
        </div>` : ''}

        <!-- Meta grid -->
        <div class="drawer-section">
            <div class="drawer-section-title">Business Intelligence</div>
            <div class="meta-grid">
                <div class="meta-item">
                    <div class="meta-item-label">Sentiment Trend</div>
                    <div class="meta-item-value">${lead.review_sentiment_trend || '—'}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-item-label">Owner Responds</div>
                    <div class="meta-item-value">${lead.owner_response_rate || '—'}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-item-label">Team Size</div>
                    <div class="meta-item-value">${lead.team_size_estimate ? lead.team_size_estimate + ' employees' : '—'}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-item-label">Maps Location Type</div>
                    <div class="meta-item-value">${lead.location_type || '—'}</div>
                </div>
            </div>
        </div>

        <!-- Locations Detail (AI-detected from website) -->
        ${lead.locations_summary ? `
        <div class="drawer-section">
            <div class="drawer-section-title">📍 Location Analysis (AI)</div>
            <div class="drawer-summary" style="border-left-color:#f59e0b">${lead.locations_summary}</div>
        </div>` : ''}
    `;

    enrichDrawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
}

function closeLLMDrawer() {
    enrichDrawer.classList.remove('open');
    drawerOverlay.classList.add('hidden');
}

// ── Export / Delete / Edit ─────────────────────────────────────────────────
function handleExport() {
    if (!currentGroupId) return;
    window.location.href = `${API_BASE}/groups/${currentGroupId}/export`;
}

async function handleDeleteGroup() {
    if (!currentGroupId) return;
    if (!confirm('Delete this group and all its leads?')) return;
    try {
        await fetch(`${API_BASE}/groups/${currentGroupId}`, { method: 'DELETE' });
        showToast('Group deleted', 'success');
        currentGroupId = null;
        dashboardTitle.innerText = 'Select a search group';
        groupActions.classList.add('hidden');
        leadsTable.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.innerHTML = '<i class="fa-solid fa-magnifying-glass-location empty-icon"></i><p>No data selected.</p>';
        if (pollInterval) clearInterval(pollInterval);
        fetchGroups();
    } catch (e) {
        showToast('Failed to delete group', 'error');
    }
}

async function handleEditGroup() {
    if (!currentGroupId) return;
    const currentName = dashboardTitle.innerText;
    const newName = prompt("Enter a new name for this search group:", currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    try {
        await fetch(`${API_BASE}/groups/${currentGroupId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: newName.trim() })
        });
        showToast('Group renamed', 'success');
        dashboardTitle.innerText = newName.trim();
        dashboardTitle.appendChild(editGroupBtn);
        fetchGroups();
    } catch(e) {
        showToast('Failed to rename group', 'error');
    }
}

// ── Utils ──────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success'
        ? '<i class="fa-solid fa-check" style="color:var(--accent-success)"></i>'
        : type === 'error'
        ? '<i class="fa-solid fa-circle-exclamation" style="color:var(--accent-danger)"></i>'
        : '';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeSingle(str) {
    return (str || '').replace(/'/g, "\\'");
}
