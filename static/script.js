const API_BASE = '/api';

// DOM Elements
const newSearchBtn = document.getElementById('newSearchBtn');
const searchModal = document.getElementById('searchModal');
const closeModals = document.querySelectorAll('.close-modal');
const searchForm = document.getElementById('searchForm');
const groupList = document.getElementById('groupList');

const dashboardTitle = document.getElementById('dashboardTitle');
const groupActions = document.getElementById('groupActions');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const leadsTable = document.getElementById('leadsTable');
const leadsTableBody = document.getElementById('leadsTableBody');
const emptyState = document.getElementById('emptyState');
const leadsCountContainer = document.getElementById('leadsCountContainer');
const leadsCount = document.getElementById('leadsCount');
const appendBtn = document.getElementById('appendBtn');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const deleteGroupBtn = document.getElementById('deleteGroupBtn');
const toastContainer = document.getElementById('toastContainer');

const editGroupBtn = document.createElement('i');
editGroupBtn.className = 'fa-solid fa-pen';
editGroupBtn.title = 'Edit group name';
editGroupBtn.style.cssText = 'cursor:pointer; font-size:16px; margin-left:12px; color:var(--text-muted); opacity:0.6; transition:opacity 0.2s;';
editGroupBtn.onmouseover = () => editGroupBtn.style.opacity = '1';
editGroupBtn.onmouseout = () => editGroupBtn.style.opacity = '0.6';
editGroupBtn.onclick = handleEditGroup;

let currentGroupId = null;
let pollInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', fetchGroups);

// Events
newSearchBtn.addEventListener('click', () => searchModal.classList.remove('hidden'));
closeModals.forEach(btn => btn.addEventListener('click', () => searchModal.classList.add('hidden')));
searchForm.addEventListener('submit', handleNewSearch);
appendBtn.addEventListener('click', handleAppend);
refreshBtn.addEventListener('click', () => ifSelectedFetchLeads(currentGroupId));
exportBtn.addEventListener('click', handleExport);
deleteGroupBtn.addEventListener('click', handleDeleteGroup);

// Core Functions
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
        
        let statusClass = `status-${group.status}`;
        
        li.innerHTML = `
            <div class="group-title" title="${group.name}">${group.name}</div>
            <div class="status-badge ${statusClass}" title="${group.status}"></div>
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
    
    // Update active class in sidebar
    document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
    
    // Fetch fresh group details to see if status updated since last sidebar render
    try {
        // Technically we can just fetch groups again to update sidebar
        fetchGroups();
        groupActions.classList.remove('hidden');
        ifSelectedFetchLeads(group.id, group.status);
    } catch(e) {}
}

async function ifSelectedFetchLeads(id, fallbackStatus = 'unknown') {
    if (!id) return;
    
    // Find group in memory
    try {
        const groupRes = await fetch(`${API_BASE}/groups`);
        const groups = await groupRes.json();
        const group = groups.find(g => g.id === id);
        if (!group) return;

        updateStatusIndicator(group.status);
        
        // Polling if still scraping
        if (group.status === 'scraping' || group.status === 'pending') {
            if (!pollInterval) {
                pollInterval = setInterval(() => ifSelectedFetchLeads(id), 3000);
            }
        } else {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        }

        const res = await fetch(`${API_BASE}/groups/${id}/leads`);
        const leads = await res.json();
        renderLeads(leads);
    } catch (e) {
        console.error(e);
    }
}

async function handleAppend() {
    if (!currentGroupId) return;
    const limitStr = prompt("How many additional leads do you want to extract for this list? (e.g. 100, 250, 500, 1000)", "100");
    if (!limitStr) return;
    const limit = parseInt(limitStr);
    
    if (isNaN(limit) || limit <= 0) {
        showToast('Please enter a valid number', 'error');
        return;
    }

    try {
        appendBtn.disabled = true;
        appendBtn.innerHTML = '<div class="loader"></div>';

        await fetch(`${API_BASE}/groups/${currentGroupId}/append`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ limit })
        });
        
        showToast('Appended extraction started!', 'success');
        ifSelectedFetchLeads(currentGroupId, 'scraping');
        await fetchGroups();
    } catch (e) {
        showToast('Failed to append leads', 'error');
    } finally {
        appendBtn.disabled = false;
        appendBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Extract More';
    }
}

function updateStatusIndicator(status) {
    if (status === 'completed' || status === 'failed') {
        statusIndicator.classList.add('hidden');
    } else {
        statusIndicator.classList.remove('hidden');
        statusText.innerText = `Status: ${status}... fetching leads...`;
    }
}

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
        const webLink = lead.website ? `<a href="${lead.website}" target="_blank" style="color:var(--accent-primary)">Visit</a>` : '-';
        tr.innerHTML = `
            <td>
                <strong>${lead.name}</strong><br>
                <small style="color:var(--accent-primary)">${lead.category || 'Local Business'}</small><br>
                <small style="color:var(--text-muted)">${lead.address || '-'}</small>
            </td>
            <td>${lead.phone || '-'}</td>
            <td>${webLink}</td>
            <td>${lead.rating ? `<i class="fa-solid fa-star" style="color:#fbbf24;font-size:12px;"></i> ${lead.rating}` : '-'} (${lead.reviews_count || 0})</td>
        `;
        leadsTableBody.appendChild(tr);
    });
}

function handleExport() {
    if (!currentGroupId) return;
    window.location.href = `${API_BASE}/groups/${currentGroupId}/export`;
}

async function handleDeleteGroup() {
    if (!currentGroupId) return;
    if (!confirm('Are you sure you want to delete this group and all its leads?')) return;
    
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
        fetchGroups(); // update sidebar string
    } catch(e) {
        showToast('Failed to rename group', 'error');
    }
}

// Utils
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '<i class="fa-solid fa-check" style="color:var(--accent-success)"></i>' : 
                 type === 'error' ? '<i class="fa-solid fa-circle-exclamation" style="color:var(--accent-danger)"></i>' : '';
    
    toast.innerHTML = `${icon} <span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
