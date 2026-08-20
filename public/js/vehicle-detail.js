let vehicleId = null;
let vehicleData = null;
let remindersData = [];
let maintenanceTypes = [];
let maintenanceLogs = [];
let settingsData = [];
let editingLogId = null;

document.addEventListener('DOMContentLoaded', () => {
    vehicleId = new URLSearchParams(window.location.search).get('id');
    if (!vehicleId) { window.location.href = '/vehicles.html'; return; }

    const today = new Date().toISOString().split('T')[0];
    const logDateEl = document.getElementById('log-date');
    if (logDateEl) logDateEl.value = today;

    loadVehicleDetail();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('odometer-form').addEventListener('submit', handleOdometerSubmit);
    document.getElementById('log-form').addEventListener('submit', handleLogSubmit);
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('history-filter').addEventListener('change', () => renderHistoryTab());
}

async function loadVehicleDetail() {
    try {
        const [typesRes, vData] = await Promise.all([
            fetchAPI('/maintenance-types'),
            fetchAPI(`/vehicles/${vehicleId}`)
        ]);

        if (typesRes) maintenanceTypes = typesRes;
        if (!vData) {
            showToast('Kendaraan tidak ditemukan', 'error');
            setTimeout(() => window.location.href = '/vehicles.html', 1500);
            return;
        }
        vehicleData = vData;

        populateMaintenanceTypeOptions();

        const [remindersRes, logsRes] = await Promise.all([
            fetchAPI(`/reminders?vehicle_id=${vehicleId}`),
            fetchAPI(`/vehicles/${vehicleId}/maintenance`)
        ]);

        if (remindersRes) remindersData = remindersRes;
        if (logsRes) maintenanceLogs = logsRes;

        renderHeader();
        renderStatusTab();
        renderHistoryTab();
        lucide.createIcons();
    } catch (error) {
        console.error('Error loading vehicle details:', error);
        showToast('Gagal memuat data kendaraan', 'error');
    }
}

function renderHeader() {
    const container = document.getElementById('vehicle-header-container');
    if (!vehicleData) return;

    const icon = getVehicleIcon(vehicleData.type);
    const totalCost = maintenanceLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
    const totalMaintenance = maintenanceLogs.length;

    let months = 1;
    if (maintenanceLogs.length > 1) {
        const oldest = new Date(maintenanceLogs[maintenanceLogs.length - 1].log_date);
        const newest = new Date(maintenanceLogs[0].log_date);
        months = Math.max(1, Math.ceil(Math.abs(newest - oldest) / (1000 * 60 * 60 * 24 * 30)));
    }
    const avgCost = Math.round(totalCost / months);

    container.innerHTML = `
        <div class="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div class="flex items-center gap-4">
                <div class="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center text-3xl shadow-inner shrink-0">
                    ${icon}
                </div>
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <h1 class="text-2xl font-bold text-gray-900">${vehicleData.name}</h1>
                        <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                            ${vehicleData.year || '-'}
                        </span>
                    </div>
                    <div class="flex items-center text-gray-500 text-sm">
                        <span class="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-800 font-medium tracking-wide border border-gray-200 mr-3">
                            ${vehicleData.plate_number || '-'}
                        </span>
                        <span class="capitalize">${vehicleData.type}</span>
                    </div>
                </div>
            </div>
            <div class="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-center justify-between gap-6 w-full md:w-auto">
                <div>
                    <p class="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">Odometer</p>
                    <div class="flex items-baseline gap-1">
                        <span class="text-3xl font-bold text-gray-900 tracking-tight" id="header-odometer">${formatNumber(vehicleData.current_odometer)}</span>
                        <span class="text-sm font-medium text-gray-500">KM</span>
                    </div>
                </div>
                <button onclick="openOdometerModal()" class="btn-secondary p-2 rounded-lg" title="Update Odometer">
                    <i data-lucide="edit-3" class="h-4 w-4"></i>
                </button>
            </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-100">
            <div>
                <p class="text-sm text-gray-500 mb-1">Total Perawatan</p>
                <p class="text-lg font-semibold text-gray-800">${totalMaintenance} <span class="text-sm font-normal text-gray-500">kali</span></p>
            </div>
            <div>
                <p class="text-sm text-gray-500 mb-1">Total Biaya</p>
                <p class="text-lg font-semibold text-gray-800">${formatRupiah(totalCost)}</p>
            </div>
            <div class="col-span-2 md:col-span-1">
                <p class="text-sm text-gray-500 mb-1">Rata-rata / Bulan</p>
                <p class="text-lg font-semibold text-gray-800">${formatRupiah(avgCost)}</p>
            </div>
        </div>
    `;
}

function renderStatusTab() {
    const container = document.getElementById('status-container');
    container.innerHTML = '';

    if (remindersData.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-12 text-center text-gray-500 bg-white rounded-xl border border-gray-100">
                <div class="text-4xl mb-3">📋</div>
                <p class="text-lg font-medium text-gray-700">Belum ada pemantauan</p>
                <p class="text-sm mt-1 mb-4">Aktifkan pemantauan di tab Pengaturan.</p>
                <button onclick="switchTab('settings')" class="btn-secondary py-2 px-4 inline-flex items-center">
                    <i data-lucide="settings" class="h-4 w-4 mr-2"></i> Buka Pengaturan
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    const statusOrder = { 'overdue': 1, 'due_soon': 2, 'no_data': 3, 'ok': 4 };
    const sorted = [...remindersData].sort((a, b) => (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99));

    sorted.forEach(reminder => {
        // Calculate progress
        let percentage = 0;
        if (reminder.status !== 'no_data' && reminder.last_log && reminder.next_due_km) {
            const intervalKm = reminder.next_due_km - reminder.last_log.odometer;
            if (intervalKm > 0) {
                const elapsed = vehicleData.current_odometer - reminder.last_log.odometer;
                percentage = Math.min(100, Math.max(0, (elapsed / intervalKm) * 100));
            }
        }
        if (reminder.status === 'overdue') percentage = 100;

        let progressColor = 'bg-gray-200';
        if (reminder.status === 'ok') progressColor = 'bg-green-500';
        else if (reminder.status === 'due_soon') progressColor = 'bg-yellow-500';
        else if (reminder.status === 'overdue') progressColor = 'bg-red-500';

        const badge = getStatusBadge(reminder.status);

        let lastDateText = 'Belum pernah';
        if (reminder.last_log) {
            lastDateText = `${formatDate(reminder.last_log.log_date)} di ${formatKM(reminder.last_log.odometer)}`;
        }

        let nextDueText = '-';
        if (reminder.next_due_date || reminder.next_due_km) {
            const parts = [];
            if (reminder.next_due_date) parts.push(formatDate(reminder.next_due_date));
            if (reminder.next_due_km) parts.push(formatKM(reminder.next_due_km));
            nextDueText = parts.join(' / ');
        }

        let remainingText = '-';
        if (reminder.status !== 'no_data') {
            const parts = [];
            if (reminder.km_remaining !== null) {
                parts.push(reminder.km_remaining <= 0 ? `Lewat ${formatKM(Math.abs(reminder.km_remaining))}` : `${formatKM(reminder.km_remaining)}`);
            }
            if (reminder.months_remaining !== null) {
                parts.push(reminder.months_remaining <= 0 ? `Lewat ${Math.abs(reminder.months_remaining)} bln` : `${reminder.months_remaining} bln`);
            }
            remainingText = parts.join(' / ') || '-';
        }

        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col';
        card.innerHTML = `
            <div class="p-5 flex-1">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">
                            ${reminder.maintenance_type.icon || '🔧'}
                        </div>
                        <div>
                            <h3 class="font-semibold text-gray-800 leading-tight">${reminder.maintenance_type.name}</h3>
                            <span class="text-xs text-gray-500">${reminder.maintenance_type.category}</span>
                        </div>
                    </div>
                    ${badge}
                </div>
                <div class="mb-4">
                    <div class="flex justify-between text-xs font-medium mb-1">
                        <span class="text-gray-500">Progres Penggunaan</span>
                        <span class="${reminder.status === 'overdue' ? 'text-red-600' : 'text-gray-700'}">${Math.round(percentage)}%</span>
                    </div>
                    <div class="w-full bg-gray-100 rounded-full h-2">
                        <div class="${progressColor} h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-y-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <div class="flex justify-between">
                        <span class="text-gray-500">Terakhir:</span>
                        <span class="font-medium text-right">${lastDateText}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-500">Berikutnya:</span>
                        <span class="font-medium text-right">${nextDueText}</span>
                    </div>
                    <div class="flex justify-between pt-2 mt-1 border-t border-gray-200">
                        <span class="text-gray-500">Sisa:</span>
                        <span class="font-medium text-right ${reminder.status === 'overdue' ? 'text-red-600' : ''}">${remainingText}</span>
                    </div>
                </div>
            </div>
            <div class="px-5 py-3 bg-gray-50 border-t border-gray-100">
                <button onclick="openAddLog(${reminder.maintenance_type.id})" class="w-full btn-primary py-2 text-sm flex justify-center items-center">
                    <i data-lucide="plus" class="h-4 w-4 mr-1"></i> Catat Perawatan Ini
                </button>
            </div>
        `;
        container.appendChild(card);
    });
    lucide.createIcons();
}

function renderHistoryTab() {
    const tbody = document.getElementById('history-table-body');
    const filterValue = document.getElementById('history-filter').value;
    tbody.innerHTML = '';

    let filtered = maintenanceLogs;
    if (filterValue) {
        filtered = maintenanceLogs.filter(log => log.maintenance_type_id == filterValue);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-12 text-center text-gray-500">
                    <div class="text-3xl mb-2">📭</div>
                    <p>Belum ada riwayat perawatan.</p>
                </td>
            </tr>
        `;
        return;
    }

    // Sort by date desc
    filtered.sort((a, b) => new Date(b.log_date) - new Date(a.log_date));

    filtered.forEach(log => {
        const typeName = log.name || 'Unknown';
        const typeCategory = log.category || '';
        const typeIcon = log.icon || '🔧';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors';
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${formatDate(log.log_date)}</div>
                <div class="text-sm text-gray-500 mt-0.5">${formatKM(log.odometer)}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <span class="mr-2">${typeIcon}</span>
                    <div>
                        <div class="text-sm font-medium text-gray-900">${typeName}</div>
                        <div class="text-xs text-gray-500">${typeCategory}</div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="text-sm text-gray-900">${log.workshop || '-'}</div>
                ${log.parts_used ? `<div class="text-xs text-gray-500 mt-1">${log.parts_used}</div>` : ''}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                ${log.cost ? formatRupiah(log.cost) : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button onclick='openEditLog(${JSON.stringify(log).replace(/'/g, "&#39;")})' class="text-blue-600 hover:text-blue-900 p-1" title="Edit">
                    <i data-lucide="edit-2" class="h-4 w-4"></i>
                </button>
                <button onclick="confirmDeleteLog(${log.id})" class="text-red-600 hover:text-red-900 p-1" title="Hapus">
                    <i data-lucide="trash-2" class="h-4 w-4"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('history-count-text').innerText = `Menampilkan ${filtered.length} data`;
    document.getElementById('history-pagination').classList.remove('hidden');
    lucide.createIcons();
}

async function renderSettingsTab() {
    const container = document.getElementById('settings-container');
    try {
        const settingsRes = await fetchAPI(`/vehicles/${vehicleId}/settings`);
        settingsData = settingsRes || [];
        container.innerHTML = '';

        // Filter maintenance types applicable to this vehicle
        const applicableTypes = maintenanceTypes.filter(t =>
            t.applicable_to === 'semua' || t.applicable_to === vehicleData.type
        );

        applicableTypes.forEach(type => {
            const setting = settingsData.find(s => s.maintenance_type_id === type.id);
            const isEnabled = setting ? !!setting.is_enabled : false;
            const intervalKm = setting ? (setting.interval_km || type.default_interval_km) : type.default_interval_km;
            const intervalMonths = setting ? (setting.interval_months || type.default_interval_months) : type.default_interval_months;

            const row = document.createElement('div');
            row.className = 'p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-gray-50 transition-colors';
            row.innerHTML = `
                <div class="flex items-center gap-4 flex-1">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer setting-toggle" data-type-id="${type.id}" ${isEnabled ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                    <div>
                        <h4 class="text-sm font-medium text-gray-900">${type.icon || '🔧'} ${type.name}</h4>
                        <p class="text-xs text-gray-500">${type.category}</p>
                    </div>
                </div>
                <div class="flex items-center gap-3 w-full sm:w-auto setting-inputs ${!isEnabled ? 'opacity-50 pointer-events-none' : ''}" id="setting-inputs-${type.id}">
                    <div class="relative w-32">
                        <input type="number" class="form-input w-full pr-10 text-right setting-km" data-type-id="${type.id}" value="${intervalKm || ''}" min="100" step="100">
                        <span class="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-gray-500 pointer-events-none">KM</span>
                    </div>
                    <span class="text-gray-400 text-sm">/</span>
                    <div class="relative w-28">
                        <input type="number" class="form-input w-full pr-10 text-right setting-months" data-type-id="${type.id}" value="${intervalMonths || ''}" min="1" max="60">
                        <span class="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-gray-500 pointer-events-none">Bln</span>
                    </div>
                </div>
            `;
            container.appendChild(row);
        });

        // Toggle listeners
        document.querySelectorAll('.setting-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const id = e.target.dataset.typeId;
                const div = document.getElementById(`setting-inputs-${id}`);
                div.classList.toggle('opacity-50', !e.target.checked);
                div.classList.toggle('pointer-events-none', !e.target.checked);
            });
        });
    } catch (error) {
        container.innerHTML = '<div class="p-5 text-red-500">Gagal memuat pengaturan.</div>';
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const settings = [];
    document.querySelectorAll('.setting-toggle').forEach(toggle => {
        const id = toggle.dataset.typeId;
        const kmInput = document.querySelector(`.setting-km[data-type-id="${id}"]`);
        const monthsInput = document.querySelector(`.setting-months[data-type-id="${id}"]`);
        settings.push({
            maintenance_type_id: parseInt(id),
            interval_km: kmInput.value ? parseInt(kmInput.value) : null,
            interval_months: monthsInput.value ? parseInt(monthsInput.value) : null,
            is_enabled: toggle.checked ? 1 : 0
        });
    });

    try {
        await fetchAPI(`/vehicles/${vehicleId}/settings`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        showToast('Pengaturan berhasil disimpan');

        // Reload reminders
        const rem = await fetchAPI(`/reminders?vehicle_id=${vehicleId}`);
        if (rem) { remindersData = rem; renderStatusTab(); }
    } catch (error) {
        showToast('Gagal menyimpan pengaturan', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" class="h-4 w-4 mr-2"></i>Simpan Pengaturan';
        lucide.createIcons();
    }
}

async function resetSettings() {
    const confirmed = await showConfirmModal('Reset Pengaturan', 'Kembalikan semua interval ke nilai default?');
    if (!confirmed) return;

    document.querySelectorAll('.setting-toggle').forEach(toggle => {
        const id = toggle.dataset.typeId;
        const type = maintenanceTypes.find(t => t.id == id);
        if (type) {
            const kmInput = document.querySelector(`.setting-km[data-type-id="${id}"]`);
            const monthsInput = document.querySelector(`.setting-months[data-type-id="${id}"]`);
            if (kmInput) kmInput.value = type.default_interval_km || '';
            if (monthsInput) monthsInput.value = type.default_interval_months || '';
        }
    });
    showToast('Interval dikembalikan ke default. Klik Simpan untuk menerapkan.', 'warning');
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        const isActive = b.dataset.tab === tabName;
        b.classList.toggle('active', isActive);
        b.classList.toggle('border-blue-500', isActive);
        b.classList.toggle('text-blue-600', isActive);
        b.classList.toggle('border-transparent', !isActive);
        b.classList.toggle('text-gray-500', !isActive);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        if (c.id === `tab-${tabName}`) {
            c.classList.remove('hidden');
            c.classList.add('active', 'block');
        } else {
            c.classList.add('hidden');
            c.classList.remove('active', 'block');
        }
    });
    if (tabName === 'settings') renderSettingsTab();
}

function populateMaintenanceTypeOptions() {
    const select = document.getElementById('log-type-id');
    const filter = document.getElementById('history-filter');
    const applicable = maintenanceTypes.filter(t =>
        t.applicable_to === 'semua' || t.applicable_to === vehicleData.type
    );
    const optsHTML = applicable.map(t => `<option value="${t.id}">${t.icon || '🔧'} ${t.name}</option>`).join('');
    select.innerHTML = '<option value="">Pilih Jenis Perawatan</option>' + optsHTML;
    filter.innerHTML = '<option value="">Semua Perawatan</option>' + optsHTML;
}

function openAddLog(maintenanceTypeId = null) {
    editingLogId = null;
    document.getElementById('log-form').reset();
    document.getElementById('log-modal-title').innerText = 'Catat Perawatan Baru';
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('log-odometer').value = vehicleData.current_odometer;
    if (maintenanceTypeId) document.getElementById('log-type-id').value = maintenanceTypeId;
    openModal('log-modal');
}

function openEditLog(log) {
    editingLogId = log.id;
    document.getElementById('log-modal-title').innerText = 'Edit Data Perawatan';
    document.getElementById('log-type-id').value = log.maintenance_type_id;
    document.getElementById('log-date').value = (log.log_date || '').split('T')[0];
    document.getElementById('log-odometer').value = log.odometer;
    document.getElementById('log-cost').value = log.cost || '';
    document.getElementById('log-workshop').value = log.workshop || '';
    document.getElementById('log-parts').value = log.parts_used || '';
    document.getElementById('log-notes').value = log.notes || '';
    openModal('log-modal');
}

async function handleLogSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const payload = {
        maintenance_type_id: parseInt(document.getElementById('log-type-id').value),
        log_date: document.getElementById('log-date').value,
        odometer: parseInt(document.getElementById('log-odometer').value),
        cost: document.getElementById('log-cost').value ? parseInt(document.getElementById('log-cost').value) : 0,
        workshop: document.getElementById('log-workshop').value,
        parts_used: document.getElementById('log-parts').value,
        notes: document.getElementById('log-notes').value
    };

    try {
        if (editingLogId) {
            // PUT /api/maintenance/:id (NOT /api/vehicles/:id/maintenance/:id)
            await fetchAPI(`/maintenance/${editingLogId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            await fetchAPI(`/vehicles/${vehicleId}/maintenance`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
        showToast(editingLogId ? 'Data berhasil diupdate' : 'Perawatan berhasil dicatat');
        closeModal('log-modal');

        // Reload all data
        const [remRes, logsRes, vData] = await Promise.all([
            fetchAPI(`/reminders?vehicle_id=${vehicleId}`),
            fetchAPI(`/vehicles/${vehicleId}/maintenance`),
            fetchAPI(`/vehicles/${vehicleId}`)
        ]);
        if (remRes) remindersData = remRes;
        if (logsRes) maintenanceLogs = logsRes;
        if (vData) vehicleData = vData;
        renderHeader();
        renderStatusTab();
        renderHistoryTab();
    } catch (error) {
        showToast('Terjadi kesalahan', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" class="h-4 w-4 mr-2"></i>Simpan';
        lucide.createIcons();
    }
}

async function confirmDeleteLog(id) {
    const confirmed = await showConfirmModal('Hapus Riwayat', 'Yakin ingin menghapus data ini?');
    if (!confirmed) return;
    try {
        // DELETE /api/maintenance/:id
        await fetchAPI(`/maintenance/${id}`, { method: 'DELETE' });
        showToast('Data berhasil dihapus');
        const logsRes = await fetchAPI(`/vehicles/${vehicleId}/maintenance`);
        if (logsRes) maintenanceLogs = logsRes;
        renderHistoryTab();
        renderHeader();
        fetchAPI(`/reminders?vehicle_id=${vehicleId}`).then(rem => {
            if (rem) { remindersData = rem; renderStatusTab(); }
        });
    } catch (e) {
        showToast('Gagal menghapus data', 'error');
    }
}

function openOdometerModal() {
    document.getElementById('current-odometer-input').value = vehicleData.current_odometer;
    document.getElementById('last-odometer-text').innerText = formatNumber(vehicleData.current_odometer);
    openModal('odometer-modal');
}

async function handleOdometerSubmit(e) {
    e.preventDefault();
    const newVal = parseInt(document.getElementById('current-odometer-input').value);
    if (newVal < vehicleData.current_odometer) {
        const confirmed = await showConfirmModal('Peringatan', `Odometer baru (${formatKM(newVal)}) lebih kecil dari sebelumnya. Lanjutkan?`);
        if (!confirmed) return;
    }
    try {
        await fetchAPI(`/vehicles/${vehicleId}/odometer`, {
            method: 'PUT',
            body: JSON.stringify({ current_odometer: newVal })
        });
        showToast('Odometer berhasil diupdate');
        closeModal('odometer-modal');
        vehicleData.current_odometer = newVal;
        document.getElementById('header-odometer').innerText = formatNumber(newVal);
        const rem = await fetchAPI(`/reminders?vehicle_id=${vehicleId}`);
        if (rem) { remindersData = rem; renderStatusTab(); }
    } catch (e) {
        showToast('Gagal update odometer', 'error');
    }
}

function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-message').innerText = message;
        const confirmBtn = document.getElementById('confirm-btn');
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        openModal('confirm-modal');
        newBtn.addEventListener('click', () => { closeModal('confirm-modal'); resolve(true); });
        // Cancel via Batal button
        const cancelBtn = newBtn.parentElement.querySelector('.btn-secondary');
        if (cancelBtn) {
            const newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', () => { closeModal('confirm-modal'); resolve(false); });
        }
    });
}
