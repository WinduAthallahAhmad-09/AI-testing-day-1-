let allVehicles = [];
let editingVehicleId = null;
let reminderData = [];

document.addEventListener('DOMContentLoaded', () => {
    loadVehicles();
    setupEventListeners();
});

function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterVehicles(e.target.value);
        });
    }
}

async function loadVehicles() {
    try {
        const vehiclesResponse = await fetchAPI('/vehicles');
        allVehicles = vehiclesResponse || [];

        try {
            const remindersResponse = await fetchAPI('/reminders');
            reminderData = remindersResponse || [];
        } catch (e) {
            console.warn('Failed to load reminders', e);
        }

        renderVehicles(allVehicles);
    } catch (error) {
        console.error('Error loading vehicles:', error);
    }
}

function renderVehicles(vehicles) {
    const grid = document.getElementById('vehicles-grid');
    const emptyState = document.getElementById('empty-state');
    if (!grid || !emptyState) return;

    if (vehicles.length === 0) {
        grid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    grid.classList.remove('hidden');
    emptyState.classList.add('hidden');

    grid.innerHTML = vehicles.map(vehicle => {
        const typeIcon = getVehicleIcon(vehicle.type);

        // Count reminders for this vehicle
        const vehicleReminders = reminderData.filter(r => r.vehicle && r.vehicle.id === vehicle.id);
        const overdueCount = vehicleReminders.filter(r => r.status === 'overdue').length;
        const dueSoonCount = vehicleReminders.filter(r => r.status === 'due_soon').length;

        let badgesHtml = '';
        if (overdueCount > 0) {
            badgesHtml += `<span class="bg-red-100 text-red-800 text-xs font-semibold px-2 py-0.5 rounded-full border border-red-200">${overdueCount} Terlambat</span>`;
        }
        if (dueSoonCount > 0) {
            badgesHtml += `<span class="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full border border-yellow-200">${dueSoonCount} Segera</span>`;
        }

        return `
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group flex flex-col">
                <div class="p-5 flex-grow">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-2xl">
                                ${typeIcon}
                            </div>
                            <div>
                                <h3 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">${escapeHTML(vehicle.name)}</h3>
                                <p class="text-sm font-medium text-gray-500 uppercase tracking-wider">${escapeHTML(vehicle.plate_number || '-')}</p>
                            </div>
                        </div>
                        <div class="flex gap-1 flex-col items-end">
                            ${badgesHtml}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 mt-4 bg-gray-50 p-3 rounded-lg">
                        <div>
                            <p class="text-xs text-gray-500 font-medium">TAHUN</p>
                            <p class="font-semibold text-gray-800">${vehicle.year || '-'}</p>
                        </div>
                        <div>
                            <p class="text-xs text-gray-500 font-medium">ODOMETER</p>
                            <p class="font-semibold text-gray-800">${formatNumber(vehicle.current_odometer)} <span class="text-xs text-gray-500 font-normal">KM</span></p>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 border-t border-gray-100 p-3 flex justify-between items-center">
                    <a href="/vehicle-detail.html?id=${vehicle.id}" class="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors">
                        Lihat Detail <i data-lucide="arrow-right" class="w-4 h-4"></i>
                    </a>
                    <div class="flex gap-2">
                        <button onclick='openEditModal(${JSON.stringify(vehicle).replace(/'/g, "&#39;")})' class="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Edit">
                            <i data-lucide="pencil" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteVehicle(${vehicle.id}, '${escapeHTML(vehicle.name)}')" class="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Hapus">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openAddModal() {
    editingVehicleId = null;
    document.getElementById('modal-title').textContent = 'Tambah Kendaraan';
    document.getElementById('vehicle-form').reset();
    openModal('vehicle-modal');
}

function openEditModal(vehicle) {
    editingVehicleId = vehicle.id;
    document.getElementById('modal-title').textContent = 'Edit Kendaraan';
    document.getElementById('name').value = vehicle.name || '';
    document.getElementById('type').value = vehicle.type || 'motor';
    document.getElementById('plate_number').value = vehicle.plate_number || '';
    document.getElementById('year').value = vehicle.year || '';
    document.getElementById('current_km').value = vehicle.current_odometer || '';
    openModal('vehicle-modal');
}

async function handleSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('vehicle-form');
    const formData = new FormData(form);
    const data = {
        name: formData.get('name'),
        type: formData.get('type'),
        plate_number: formData.get('plate_number'),
        year: formData.get('year') ? parseInt(formData.get('year')) : null,
        current_odometer: formData.get('current_km') ? parseInt(formData.get('current_km')) : 0
    };

    try {
        if (editingVehicleId) {
            await fetchAPI(`/vehicles/${editingVehicleId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Kendaraan berhasil diperbarui', 'success');
        } else {
            await fetchAPI('/vehicles', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Kendaraan berhasil ditambahkan', 'success');
        }
        closeModal('vehicle-modal');
        loadVehicles();
    } catch (error) {
        console.error('Error saving vehicle:', error);
    }
}

async function deleteVehicle(id, name) {
    const confirmed = await showConfirm(`Apakah Anda yakin ingin menghapus kendaraan "${name}"? Semua data perawatan juga akan terhapus.`);
    if (!confirmed) return;

    try {
        await fetchAPI(`/vehicles/${id}`, { method: 'DELETE' });
        showToast(`Kendaraan "${name}" berhasil dihapus`, 'success');
        loadVehicles();
    } catch (error) {
        console.error('Error deleting vehicle:', error);
    }
}

function filterVehicles(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) { renderVehicles(allVehicles); return; }
    const filtered = allVehicles.filter(v =>
        (v.name || '').toLowerCase().includes(term) ||
        (v.plate_number || '').toLowerCase().includes(term)
    );
    renderVehicles(filtered);
}
