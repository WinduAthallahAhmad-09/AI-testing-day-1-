// API Base URL
const API_BASE = '/api';

// Fetch wrapper with error handling
async function fetchAPI(endpoint, options = {}) {
    try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: headers
        });
        
        if (response.status === 401 || response.status === 403) {
            window.logout();
            return;
        }
        
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = { error: 'Invalid response from server' };
        }
        
        if (!response.ok) throw new Error(data.error || data.message || 'Terjadi kesalahan pada server');
        return data;
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

// Global logout function
window.logout = function() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login.html';
};

// Format to Indonesian Rupiah
function formatRupiah(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

// Format date to Indonesian format (e.g., 17 Agustus 2023)
function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Format short date (e.g., 17 Ags 2023)
function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Format datetime (e.g., 17 Agustus 2023 14:30)
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Format KM
function formatKM(km) {
    if (km === null || km === undefined || isNaN(km)) return '-';
    return new Intl.NumberFormat('id-ID').format(km) + ' KM';
}

// Toast notification system
function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Add icon based on type
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));
    
    // Remove toast after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300); // Wait for transition to finish
    }, 3000);
}

// Modal helpers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Animate in
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('opacity-0');
        modal.classList.remove('opacity-100');
        const content = modal.querySelector('.modal-content');
        if (content) {
            content.classList.add('scale-95');
            content.classList.remove('scale-100');
        }
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }, 200);
    }
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
        document.body.style.overflow = '';
    }
});

// Confirm dialog
function showConfirm(message, confirmText = 'Ya, Lanjutkan', confirmColor = 'bg-red-500 hover:bg-red-600') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-sm mx-4 shadow-2xl transform transition-all">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center text-xl">
                        ⚠️
                    </div>
                    <h3 class="text-lg font-bold text-gray-900">Konfirmasi</h3>
                </div>
                <p class="text-gray-600 mb-6 leading-relaxed">${message}</p>
                <div class="flex gap-3 justify-end">
                    <button class="px-4 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors cancel-btn">Batal</button>
                    <button class="px-4 py-2.5 rounded-lg ${confirmColor} text-white font-medium transition-colors shadow-sm confirm-btn">${confirmText}</button>
                </div>
            </div>`;
        
        document.body.appendChild(overlay);
        
        overlay.querySelector('.cancel-btn').onclick = () => { 
            overlay.remove(); 
            resolve(false); 
        };
        
        overlay.querySelector('.confirm-btn').onclick = () => { 
            overlay.remove(); 
            resolve(true); 
        };
    });
}

// Get status badge HTML
function getStatusBadge(status) {
    const map = {
        'ok': { class: 'badge-ok', text: '✅ Aman' },
        'due_soon': { class: 'badge-due-soon', text: '⚠️ Segera' },
        'overdue': { class: 'badge-overdue', text: '🔴 Terlambat' },
        'no_data': { class: 'badge-no-data', text: '⚪ Belum Ada Data' }
    };
    const s = map[status] || map['no_data'];
    return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${s.class}">${s.text}</span>`;
}

// Get progress bar HTML
function getProgressBar(percentage, status) {
    const clampedPct = Math.min(Math.max(percentage || 0, 0), 100);
    let colorClass = 'progress-ok';
    
    if (status === 'overdue' || clampedPct >= 100) {
        colorClass = 'progress-overdue';
    } else if (status === 'due_soon' || clampedPct >= 80) {
        colorClass = 'progress-due-soon';
    }
    
    return `<div class="progress-bar" title="${clampedPct.toFixed(1)}%"><div class="progress-fill ${colorClass}" style="width: ${clampedPct}%"></div></div>`;
}

// Get vehicle type icon
function getVehicleIcon(type) {
    const types = {
        'motor': '🏍️',
        'mobil': '🚗',
        'truk': '🚚',
        'bus': '🚌'
    };
    return types[type?.toLowerCase()] || '🚗';
}

// Debounce helper for search inputs
function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// Setup form serialization to JSON
function serializeForm(formElement) {
    const formData = new FormData(formElement);
    const data = {};
    for (const [key, value] of formData.entries()) {
        // Only add non-empty values or keep them empty strings based on your API needs
        data[key] = value;
    }
    return data;
}

// Set active nav link based on current URL
function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        // Exact match or match prefix for subpages (e.g. /vehicles and /vehicles/add)
        const isActive = href === path || 
                        (path === '/' && href === '/index.html') ||
                        (href !== '/' && path.startsWith(href) && href.length > 1);
        
        link.classList.toggle('active', isActive);
    });
}

// Setup tab functionality
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            const container = button.closest('.tabs-container') || document;
            
            // Remove active class from all buttons and content in this container
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            container.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and target content
            button.classList.add('active');
            const targetContent = container.querySelector(`#${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// Escape HTML to prevent XSS
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (match) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[match]);
}

// Format number with Indonesian locale
function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return new Intl.NumberFormat('id-ID').format(num);
}

// Initialize common functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setActiveNav();
    setupTabs();
});
