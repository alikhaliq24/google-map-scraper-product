const API_BASE = '/api';

// ── DOM Elements: Auth & Shells ────────────────────────────────────────────
const authShell       = document.getElementById('authShell');
const paywallShell    = document.getElementById('paywallShell');
const appShell        = document.getElementById('appShell');

const authForm        = document.getElementById('authForm');
const authEmail       = document.getElementById('authEmail');
const authPassword    = document.getElementById('authPassword');
const authSubmitBtn   = document.getElementById('authSubmitBtn');
const authTitle       = document.getElementById('authTitle');
const authSubtitle    = document.getElementById('authSubtitle');
const toggleSignupLink= document.getElementById('toggleSignupLink');
const toggleForgotLink= document.getElementById('toggleForgotLink');

let isAppShellAttached = true;

const paywallBtn      = document.getElementById('paywallBtn');
const paywallLogoutBtn= document.getElementById('paywallLogoutBtn');

const navDashboard    = document.getElementById('navDashboard');
const navSettings     = document.getElementById('navSettings');
const dashboardView   = document.getElementById('dashboardView');
const settingsView    = document.getElementById('settingsView');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const changePwdBtn    = document.getElementById('changePwdBtn');
const manageBillingBtn= document.getElementById('manageBillingBtn');
const logoutBtn       = document.getElementById('logoutBtn');
const openaiKeyInput  = document.getElementById('openaiKey');

// ── DOM Elements: Main App ─────────────────────────────────────────────────
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
const filterDropdown    = document.getElementById('filterDropdown');
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

// Edit group button
const editGroupBtn = document.createElement('i');
editGroupBtn.className = 'fa-solid fa-pen';
editGroupBtn.title = 'Edit group name';
editGroupBtn.style.cssText = 'cursor:pointer;font-size:16px;margin-left:12px;color:var(--text-muted);opacity:0.6;transition:opacity 0.2s;';
editGroupBtn.onmouseover = () => editGroupBtn.style.opacity = '1';
editGroupBtn.onmouseout  = () => editGroupBtn.style.opacity = '0.6';
editGroupBtn.onclick = handleEditGroup;

// State
let currentGroupId = null;
let pollInterval   = null;
let currentUser    = null;
let authMode       = 'login'; // login, signup, forgot

// Table Sort & Filter State
let currentLeadsData = [];
let currentSortColumn = null;
let currentSortDir = 'asc';
let currentFilter = 'all';

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    // Wire up Filtering
    if (filterDropdown) {
        filterDropdown.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            applyFiltersAndRender();
        });
    }

    // Wire up column sorting
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            if (currentSortColumn === sortKey) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = sortKey;
                currentSortDir = 'asc';
            }
            
            // update UI arrows
            document.querySelectorAll('th.sortable').forEach(h => {
                h.classList.remove('active');
                if (h.querySelector('span')) h.querySelector('span').innerText = '';
            });
            th.classList.add('active');
            if (th.querySelector('span')) {
                th.querySelector('span').innerText = currentSortDir === 'asc' ? '↑' : '↓';
            }

            applyFiltersAndRender();
        });
    });
});

// ── Auth Logic ─────────────────────────────────────────────────────────────
function getAuthHeaders() {
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (!(options.body instanceof URLSearchParams)) {
        options.headers = { ...options.headers, ...getAuthHeaders() };
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
        logout(); // Token expired or invalid
        throw new Error('Unauthorized');
    }
    return res;
}

async function checkAuth() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        showAuthShell();
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
        if (res.ok) {
            currentUser = await res.json();
            resolveUserView();
        } else {
            logout();
        }
    } catch (e) {
        logout();
    }
}

function showAuthShell() {
    if (isAppShellAttached) { appShell.remove(); isAppShellAttached = false; }
    paywallShell.classList.add('hidden');
    authShell.classList.remove('hidden');
    setAuthMode('login');
}

function resolveUserView() {
    authShell.classList.add('hidden');
    if (!currentUser.is_subscribed) {
        if (isAppShellAttached) { appShell.remove(); isAppShellAttached = false; }
        paywallShell.classList.remove('hidden');
    } else {
        paywallShell.classList.add('hidden');
        if (!isAppShellAttached) { document.body.appendChild(appShell); isAppShellAttached = true; }
        appShell.classList.remove('hidden');
        openaiKeyInput.value = currentUser.openai_api_key || '';
        
        // Trigger initial routing hydration
        handleHashChange();
        fetchGroups();
    }
}

// ── SPA Routing Logic ──────────────────────────────────────────────────────
window.addEventListener('hashchange', handleHashChange);

function handleHashChange() {
    if (!currentUser || !currentUser.is_subscribed) return;

    const hash = window.location.hash || '#/dashboard';
    
    if (hash === '#/settings') {
        navSettings.classList.add('active');
        dashboardView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        // Clear active styles from group list implicitly
        document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
    } else if (hash.startsWith('#/group/')) {
        navSettings.classList.remove('active');
        settingsView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        
        const idStr = hash.replace('#/group/', '');
        const id = parseInt(idStr);
        if (!isNaN(id)) {
            // Note: selectGroup implicitly clears active items and applies to the matched one
            selectGroupById(id);
        }
    } else {
        // Fallback to empty dashboard
        navSettings.classList.remove('active');
        settingsView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
    }
}

function logout() {
    localStorage.removeItem('access_token');
    currentUser = null;
    showAuthShell();
}

function setAuthMode(mode) {
    authMode = mode;
    authPassword.required = mode !== 'forgot';
    authPassword.style.display = mode === 'forgot' ? 'none' : 'block';
    authEmail.style.display = mode === 'reset' ? 'none' : 'block';
    authEmail.required = mode !== 'reset';
    
    if (mode === 'login') {
        authTitle.innerHTML = '<i class="fa-solid fa-map-location-dot gradient-text"></i> MapScraper Pro';
        authSubtitle.innerText = 'Sign in to your account';
        authSubmitBtn.innerText = 'Log In';
        toggleSignupLink.innerText = 'Create an account';
        toggleForgotLink.style.display = 'inline';
    } else if (mode === 'signup') {
        authTitle.innerText = 'Create Account';
        authSubtitle.innerText = 'Sign up to continue';
        authSubmitBtn.innerText = 'Sign Up';
        toggleSignupLink.innerText = 'Back to login';
        toggleForgotLink.style.display = 'none';
    } else if (mode === 'forgot') {
        authTitle.innerText = 'Reset Password';
        authSubtitle.innerText = 'Enter your email to receive a reset link';
        authSubmitBtn.innerText = 'Send Reset Link';
        toggleSignupLink.innerText = 'Back to login';
        toggleForgotLink.style.display = 'none';
    }
}

toggleSignupLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
});

toggleForgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode('forgot');
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value;
    const password = authPassword.value;
    
    try {
        authSubmitBtn.disabled = true;
        authSubmitBtn.innerText = 'Loading...';
        
        if (authMode === 'login') {
            const formData = new URLSearchParams();
            formData.append('username', email);
            formData.append('password', password);
            const res = await fetch(`${API_BASE}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });
            if (!res.ok) throw new Error('Invalid credentials');
            const data = await res.json();
            localStorage.setItem('access_token', data.access_token);
            await checkAuth();
        } else if (authMode === 'signup') {
            const res = await fetch(`${API_BASE}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (!res.ok) throw new Error('Signup failed. Email may exist.');
            // Auto login
            const formData = new URLSearchParams();
            formData.append('username', email);
            formData.append('password', password);
            const loginRes = await fetch(`${API_BASE}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });
            const data = await loginRes.json();
            localStorage.setItem('access_token', data.access_token);
            await checkAuth();
        } else if (authMode === 'forgot') {
            const res = await fetch(`${API_BASE}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            if (!res.ok) throw new Error('Request failed');
            showToast('If registered, a reset link was sent (check console).', 'success');
            setAuthMode('login');
        } else if (authMode === 'reset') {
            const resetToken = new URLSearchParams(window.location.search).get('reset_token');
            const res = await fetch(`${API_BASE}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: resetToken, new_password: password })
            });
            if (!res.ok) throw new Error('Invalid or expired token');
            showToast('Password updated successfully. Please log in.', 'success');
            window.history.replaceState({}, document.title, "/"); // clear URL param
            setAuthMode('login');
            authForm.reset();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        authSubmitBtn.disabled = false;
        if (authMode === 'login') authSubmitBtn.innerText = 'Log In';
        if (authMode === 'signup') authSubmitBtn.innerText = 'Sign Up';
        if (authMode === 'forgot') authSubmitBtn.innerText = 'Send Reset Link';
    }
});

paywallLogoutBtn.addEventListener('click', logout);
logoutBtn.addEventListener('click', logout);

paywallBtn.addEventListener('click', () => {
    // Replace heavily with real Lemon Squeezy later. Add custom_data=user.id
    if (currentUser) {
        window.open(`https://[YOUR_STORE].lemonsqueezy.com/checkout/buy/12345?checkout[custom][user_id]=${currentUser.id}`, '_blank');
        showToast('Waiting for payment confirmation...', 'info');
        // Simple poll to check if subscription updated
        const verifyPoll = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
                if (res.ok) {
                    const user = await res.json();
                    if (user.is_subscribed) {
                        clearInterval(verifyPoll);
                        currentUser = user;
                        resolveUserView();
                        showToast('Payment successful!', 'success');
                    }
                }
            } catch(e){}
        }, 5000);
    }
});


// ── Sidebar Navigation & Settings Logic ────────────────────────────────────
navSettings.addEventListener('click', () => {
    window.location.hash = '#/settings';
});

// Helper to switch to dashboard view (called when hitting New Search)
function showDashboardView() {
    window.location.hash = '#/dashboard';
}

saveSettingsBtn.addEventListener('click', async () => {
    try {
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.innerText = 'Saving...';
        const res = await authFetch(`${API_BASE}/auth/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openai_api_key: openaiKeyInput.value })
        });
        const updatedUser = await res.json();
        currentUser = updatedUser;
        showToast('Settings saved successfully', 'success');
        ifSelectedFetchLeads(currentGroupId); // Refresh UI (buttons disable/enable)
    } catch (e) {
        showToast('Failed to save settings', 'error');
    } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.innerText = 'Save Configuration';
    }
});

changePwdBtn.addEventListener('click', async () => {
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    if (!oldPassword || !newPassword) {
        return showToast('Both fields are required', 'error');
    }
    try {
        changePwdBtn.disabled = true;
        changePwdBtn.innerText = 'Updating...';
        const res = await authFetch(`${API_BASE}/auth/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
        });
        showToast('Password changed successfully!', 'success');
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
    } catch (e) {
        showToast(e.message || 'Failed to change password. Is old password correct?', 'error');
    } finally {
        changePwdBtn.disabled = false;
        changePwdBtn.innerText = 'Change Password';
    }
});

manageBillingBtn.addEventListener('click', () => {
    if (currentUser?.customer_portal_url) {
        window.open(currentUser.customer_portal_url, '_blank');
    } else {
        // Fallback or generic store link
        window.open('https://app.lemonsqueezy.com/my-orders', '_blank');
    }
});


// ── Main App Events ────────────────────────────────────────────────────────
newSearchBtn.addEventListener('click', () => {
    showDashboardView();
    searchModal.classList.remove('hidden');
});
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

// ── Groups & Loading ───────────────────────────────────────────────────────
async function fetchGroups() {
    try {
        const res = await authFetch(`${API_BASE}/groups`);
        const groups = await res.json();
        renderGroupSidebar(groups);
    } catch (e) {
        // authFetch handles token errors
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
        li.addEventListener('click', () => {
            window.location.hash = `#/group/${group.id}`;
        });
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
        const res = await authFetch(`${API_BASE}/groups`, {
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
    if (!group) return;
    currentGroupId = group.id;
    dashboardTitle.innerText = group.name;
    dashboardTitle.appendChild(editGroupBtn);
    
    // Visually update sidebar
    document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
    // We cannot easily target the specific li without data attributes, but re-fetching fetchGroups handles it.
    
    try {
        fetchGroups(); // updates active state via currentGroupId comparison
        groupActions.classList.remove('hidden');
        ifSelectedFetchLeads(group.id, group.status);
    } catch(e) {}
}

async function selectGroupById(id) {
    if (!id) return;
    try {
        const groupRes = await authFetch(`${API_BASE}/groups`);
        const groups   = await groupRes.json();
        const group    = groups.find(g => g.id === id);
        if (group) {
            selectGroup(group);
        }
    } catch (e) {}
}

async function ifSelectedFetchLeads(id, fallbackStatus = 'unknown') {
    if (!id) return;
    try {
        const groupRes = await authFetch(`${API_BASE}/groups`);
        const groups   = await groupRes.json();
        const group    = groups.find(g => g.id === id);
        if (!group) return;

        updateStatusIndicator(group.status);

        if (group.status === 'scraping' || group.status === 'pending') {
            if (!pollInterval) pollInterval = setInterval(() => ifSelectedFetchLeads(id), 3000);
        } else {
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        }

        const res   = await authFetch(`${API_BASE}/groups/${id}/leads`);
        currentLeadsData = await res.json();
        applyFiltersAndRender();
    } catch (e) {
        console.error(e);
    }
}

// ── Sorting & Filtering Orchestrator ───────────────────────────────────────
function applyFiltersAndRender() {
    let list = [...currentLeadsData];

    // Filter
    if (currentFilter === 'has_website') {
        list = list.filter(l => l.website);
    } else if (currentFilter === 'has_email') {
        list = list.filter(l => l.email);
    } else if (currentFilter === 'has_socials') {
        list = list.filter(l => l.facebook_url || l.instagram_url || l.linkedin_url || l.twitter_url || l.tiktok_url || l.youtube_url);
    } else if (currentFilter === 'claimed') {
        list = list.filter(l => l.is_claimed === true);
    } else if (currentFilter === 'unclaimed') {
        list = list.filter(l => l.is_claimed === false);
    } else if (currentFilter === 'high_rating') {
        list = list.filter(l => (l.rating || 0) >= 4.0);
    }

    // Sort
    if (currentSortColumn) {
        list.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];

            // Normalize missing values
            if (valA == null) valA = '';
            if (valB == null) valB = '';

            // Number conversions for math metrics
            if (currentSortColumn === 'rating' || currentSortColumn === 'reviews_count' || currentSortColumn === 'lead_score') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = (valB || '').toLowerCase();
            }

            if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderLeads(list);
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
        await authFetch(`${API_BASE}/groups/${currentGroupId}/append`, {
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
    if (!currentUser || !currentUser.openai_api_key) {
        showToast("OpenAI API Key needed in Settings first", "error");
        navSettings.click();
        return;
    }
    if (!confirm('This will visit every lead\'s website to extract emails, social links, and tech stack. Continue?')) return;
    try {
        autoEnrichBtn.disabled = true;
        autoEnrichBtn.innerHTML = '<div class="loader"></div> Enriching...';
        await authFetch(`${API_BASE}/groups/${currentGroupId}/auto-enrich`, { method: 'POST' });
        showToast('Auto-enrichment started in background!', 'success');
        // Poll
        const enrichPoll = setInterval(async () => {
            const res = await authFetch(`${API_BASE}/groups/${currentGroupId}/leads`);
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
    if (!confirm('This will re-visit Google Maps for all leads in this group to fill in Hours, Location, and Claimed status. It opens a browser and may take several minutes. Continue?')) return;
    try {
        backfillMapsBtn.disabled = true;
        backfillMapsBtn.innerHTML = '<div class="loader"></div> Backfilling...';
        await authFetch(`${API_BASE}/groups/${currentGroupId}/backfill-maps`, { method: 'POST' });
        showToast('Maps backfill started! This runs in the background.', 'success');
        const poll = setInterval(async () => {
            await ifSelectedFetchLeads(currentGroupId);
        }, 5000);
        setTimeout(() => {
            clearInterval(poll);
            backfillMapsBtn.disabled = false;
            backfillMapsBtn.innerHTML = '<i class="fa-solid fa-map-location-dot"></i> Backfill Maps';
        }, 120000);
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
function formatHours(hoursStr) {
    if (!hoursStr) return '—';
    
    // Attempt to match the first generic time range, e.g. "9 AM–5 PM" or "08:00–18:00"
    const m = hoursStr.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*(?:–|-|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/);
    if (m && m[1]) {
        return `<span style="font-size:0.82rem">${m[1].trim()}</span>`;
    }
    
    // Fallback if no clear time range is found
    return `<span style="font-size:0.82rem">${hoursStr.substring(0, 16)}...</span>`;
}

function renderLeads(leads) {
    emptyState.classList.add('hidden');
    leadsTable.classList.remove('hidden');
    leadsCountContainer.classList.remove('hidden');
    leadsCount.innerText = leads.length;
    leadsTableBody.innerHTML = '';

    const hasGlobalKey = Boolean(currentUser && currentUser.openai_api_key);
    
    if (!hasGlobalKey && currentGroupId) {
        autoEnrichBtn.title = "Go to Settings to add OpenAI Key to enable enrichment.";
        autoEnrichBtn.className = "btn btn-enrich btn-disabled";
    } else {
        autoEnrichBtn.title = "Enrich all leads with website data";
        autoEnrichBtn.className = "btn btn-enrich";
    }

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

        // 1. Business
        const businessHTML = `
            <strong>${lead.name}</strong><br>
            <small style="color:var(--accent-primary)">${lead.category || 'Local Business'}</small><br>
            <small style="color:var(--text-muted)">${lead.address || '—'}</small>
        `;

        // 2. Contact
        const emailLink = lead.email ? `<br><a href="mailto:${lead.email}" style="color:var(--accent-primary);font-size:0.82rem">${lead.email}</a>` : '';
        const waLink = lead.whatsapp_link ? ` <a href="${lead.whatsapp_link}" target="_blank" title="WhatsApp" style="color:#25d366"><i class="fa-brands fa-whatsapp"></i></a>` : '';
        const contactHTML = `${lead.phone || '—'}${emailLink}${waLink}`;

        // 3. Website
        const websiteHTML = lead.website ? `<a href="${lead.website}" target="_blank" style="color:var(--accent-primary)">Visit</a>` : '—';

        // 4. Social
        const socials = [
            { url: lead.facebook_url,  cls: 'si-fb', icon: 'fa-brands fa-facebook-f',  label: 'Facebook' },
            { url: lead.instagram_url, cls: 'si-ig', icon: 'fa-brands fa-instagram',    label: 'Instagram' },
            { url: lead.linkedin_url,  cls: 'si-li', icon: 'fa-brands fa-linkedin-in',  label: 'LinkedIn' },
            { url: lead.twitter_url,   cls: 'si-tw', icon: 'fa-brands fa-x-twitter',    label: 'Twitter/X' },
            { url: lead.tiktok_url,    cls: 'si-tt', icon: 'fa-brands fa-tiktok',       label: 'TikTok' },
            { url: lead.youtube_url,   cls: 'si-yt', icon: 'fa-brands fa-youtube',      label: 'YouTube' },
        ].filter(s => s.url);
        let socialHTML = '—';
        if (socials.length) {
            socialHTML = `<div class="social-icons">${socials.map(s => `<a href="${s.url}" target="_blank" class="social-icon ${s.cls}" title="${s.label}"><i class="${s.icon}"></i></a>`).join('')}</div>`;
        } else if (lead.auto_enrichment_status === 'done') {
            socialHTML = `<span class="badge" title="Website analyzed natively, but no socials detected" style="font-size:0.7rem; padding:3px 6px; background:var(--bg-panel); color:var(--text-muted); border:1px solid var(--border-color); border-radius:4px;">No Socials Found</span>`;
        }

        // 5. Rating
        const ratingHTML = lead.rating ? `<i class="fa-solid fa-star" style="color:#fbbf24;font-size:11px;"></i> <strong>${lead.rating}</strong><br><small style="color:var(--text-muted)">${lead.reviews_count || 0} reviews</small>` : '—';

        // 6. Hours (Mon-Thu specific mapping)
        const hoursHTML = formatHours(lead.hours_of_operation);

        // 7. Location
        const locChip     = lead.location_type ? `<span class="chip ${lead.location_type === 'Multi-Location' ? 'chip-multi' : 'chip-single'}">${lead.location_type}</span>` : '';
        const claimedChip = lead.is_claimed === true ? `<span class="chip chip-claimed">✓ Claimed</span>` : '';
        const closedChip  = lead.is_permanently_closed ? `<span class="chip chip-closed">Closed</span>` : '';
        const locationHTML = `<div class="tech-chips">${locChip}${claimedChip}${closedChip}</div>` || '—';

        // 8. Score
        let scoreBadge = `<div class="score-badge score-none">N/A</div>`;
        if (lead.lead_score != null) {
            const cls = lead.lead_score >= 70 ? 'score-high' : lead.lead_score >= 40 ? 'score-medium' : 'score-low';
            scoreBadge = `<div class="score-badge ${cls}">${lead.lead_score}</div>`;
        }
        const enrichStatus = lead.llm_enrichment_status;
        const enrichStatusHTML = enrichStatus === 'enriching'
            ? `<div class="enrich-row-status enriching"><div class="loader" style="display:inline-block;width:10px;height:10px;margin-right:4px"></div>Analyzing...</div>`
            : enrichStatus === 'done'   ? `<div class="enrich-row-status done">✓ Done</div>`
            : enrichStatus === 'failed' ? `<div class="enrich-row-status failed">✗ Failed</div>` : '';

        // 9. Actions
        let enrichLabel = '✨ Enrich';
        let enrichDisabledAttrs = '';
        
        if (!hasGlobalKey && enrichStatus !== 'done') {
            enrichDisabledAttrs = 'class="btn btn-sm btn-enrich-sm btn-disabled" title="Go to Settings to add OpenAI Key to enable enrichment."';
        } else if (enrichStatus === 'enriching') { 
            enrichLabel = '<div class="loader" style="width:12px;height:12px"></div>'; 
            enrichDisabledAttrs = 'class="btn btn-sm btn-enrich-sm btn-disabled"'; 
        } else if (enrichStatus === 'done') { 
            enrichLabel = '✨ View'; 
            enrichDisabledAttrs = 'class="btn btn-sm btn-enrich-sm"';
        } else {
            enrichDisabledAttrs = 'class="btn btn-sm btn-enrich-sm"';
        }

        // 10. AI Semantic Insights
        const emptyAI = '<span style="color:var(--text-muted);font-style:italic;font-size:0.8rem">Not enriched</span>';
        
        const sentimentHTML = lead.review_sentiment_trend 
            ? `<div style="max-height: 80px; overflow-y: auto; font-size: 0.82rem; line-height: 1.4; font-weight: 500;">${lead.review_sentiment_trend}</div>` 
            : emptyAI;

        const enrichBtnHTML = `<button ${enrichDisabledAttrs}
            onclick="hasGlobalKeyBtnTrigger(${lead.id}, '${escapeSingle(lead.name)}', '${enrichStatus}', ${hasGlobalKey})"
        >${enrichLabel}</button>`;

        tr.innerHTML = `
            <td style="vertical-align:top">${businessHTML}</td>
            <td style="vertical-align:top">${contactHTML}</td>
            <td>${websiteHTML}</td>
            <td>${socialHTML}</td>
            <td>${ratingHTML}</td>
            <td>${hoursHTML}</td>
            <td>${locationHTML}</td>
            <td style="min-width: 140px; vertical-align: top;">${sentimentHTML}</td>
            <td>${scoreBadge}${enrichStatusHTML}</td>
            <td>${enrichBtnHTML}</td>
        `;
        leadsTableBody.appendChild(tr);
    });
}

async function hasGlobalKeyBtnTrigger(leadId, businessName, currentStatus, hasGlobalKey) {
    if (!hasGlobalKey && currentStatus !== 'done') {
        showToast("Add OpenAI API key in Settings first.", "error");
        navSettings.click();
        return;
    }
    await handleLeadEnrich(leadId, businessName, currentStatus);
}

// ── Per-Lead LLM Enrich ────────────────────────────────────────────────────
async function handleLeadEnrich(leadId, businessName, currentStatus) {
    drawerBusinessName.textContent = businessName;

    if (currentStatus === 'done') {
        const res = await authFetch(`${API_BASE}/leads/${leadId}`);
        const lead = await res.json();
        openLLMDrawer(lead);
        return;
    }

    openDrawerLoading(businessName);

    try {
        await authFetch(`${API_BASE}/leads/${leadId}/llm-enrich`, { method: 'POST' });
    } catch (e) {
        drawerBody.innerHTML = `<div class="drawer-failed"><i class="fa-solid fa-circle-exclamation" style="font-size:2rem;margin-bottom:12px"></i><p>Failed to start enrichment.</p></div>`;
        return;
    }

    const pollId = setInterval(async () => {
        try {
            const res = await authFetch(`${API_BASE}/leads/${leadId}`);
            const lead = await res.json();
            if (lead.llm_enrichment_status === 'done') {
                clearInterval(pollId);
                openLLMDrawer(lead);
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

    let scoreClass = 'score-none';
    let scoreLabel = 'N/A';
    if (lead.lead_score !== null && lead.lead_score !== undefined) {
        scoreClass = lead.lead_score >= 70 ? 'score-high' : lead.lead_score >= 40 ? 'score-medium' : 'score-low';
        scoreLabel = lead.lead_score;
    }

    const painList = (lead.pain_points || '').split('|').filter(Boolean);
    const positiveList = (lead.positive_themes || '').split('|').filter(Boolean);

    drawerBody.innerHTML = `
        <div class="drawer-section">
            <div class="drawer-section-title">Lead Score</div>
            <div class="drawer-score-row">
                <div class="score-badge ${scoreClass}" style="width:60px;height:60px;font-size:1.4rem;border-width:3px">${scoreLabel}</div>
                <p class="drawer-score-reason">${lead.lead_score_reason || 'No score reason available.'}</p>
            </div>
        </div>

        ${lead.business_summary ? `
        <div class="drawer-section">
            <div class="drawer-section-title">Business Summary</div>
            <div class="drawer-summary">${lead.business_summary}</div>
        </div>` : ''}

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
    exportCSV();
}

async function exportCSV() {
    try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`${API_BASE}/groups/${currentGroupId}/export?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const groupName = dashboardTitle.innerText || 'Leads';
        a.download = `${groupName.replace(' ', '_')}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    } catch(e) {
        showToast('Export failed', 'error');
    }
}


async function handleDeleteGroup() {
    if (!currentGroupId) return;
    if (!confirm('Delete this group and all its leads?')) return;
    try {
        await authFetch(`${API_BASE}/groups/${currentGroupId}`, { method: 'DELETE' });
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
        await authFetch(`${API_BASE}/groups/${currentGroupId}`, {
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
