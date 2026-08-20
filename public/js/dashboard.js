document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    setupEventListeners();
});

let allReminders = [];

function setupEventListeners() {
    const vehicleSelect = document.getElementById('vehicle_id');
    if (vehicleSelect) {
        vehicleSelect.addEventListener('change', async (e) => {
            const vehicleId = e.target.value;
            if (vehicleId) {
                const vehicle = window.vehiclesData?.find(v => v.id == vehicleId);
                if (vehicle) {
                    await loadMaintenanceTypes(vehicle.type);
                    // Set odometer default
                    document.getElementById('odometer').value = vehicle.current_odometer || '';
                }
            } else {
                const typeSelect = document.getElementById('type_id');
                typeSelect.innerHTML = '<option value="">Pilih Jenis (Pilih kendaraan dulu)</option>';
                typeSelect.disabled = true;
            }
        });
    }

    const form = document.getElementById('quick-maintenance-form');
    if (form) {
        form.addEventListener('submit', submitQuickMaintenance);
    }
}

async function loadDashboard() {
    try {
        await Promise.all([loadStats(), loadReminders(), loadVehicles()]);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadStats() {
    try {
        const stats = await fetchAPI('/stats');
        if (stats) {
            document.getElementById('stat-total-vehicles').textContent = stats.total_vehicles || 0;
            document.getElementById('stat-overdue').textContent = stats.total_overdue_reminders || 0;
            document.getElementById('stat-month-count').textContent = '-'; // Not provided by API
            document.getElementById('stat-month-cost').textContent = formatRupiah(stats.total_cost_this_month || 0);
        }
    } catch (error) {
        console.error('Failed to load stats', error);
    }
}

async function loadReminders() {
    try {
        const reminders = await fetchAPI('/reminders');
        allReminders = reminders || [];
        const container = document.getElementById('alert-container');
        const emptyState = document.getElementById('alert-empty-state');
        container.innerHTML = '';

        const urgentReminders = allReminders.filter(r => r.status === 'overdue' || r.status === 'due_soon');

        if (urgentReminders.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-4">Semua perawatan dalam kondisi baik! ✅</div>';
            return;
        }

        urgentReminders.forEach(reminder => {
            const isOverdue = reminder.status === 'overdue';
            const bgColor = isOverdue ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
            const iconColor = isOverdue ? 'text-red-500' : 'text-yellow-500';
            const textColor = isOverdue ? 'text-red-800' : 'text-yellow-800';

            let messageParts = [];
            if (reminder.km_remaining !== null) {
                if (reminder.km_remaining <= 0) {
                    messageParts.push(`Lewat ${formatKM(Math.abs(reminder.km_remaining))}`);
                } else {
                    messageParts.push(`Sisa ${formatKM(reminder.km_remaining)}`);
                }
            }
            if (reminder.months_remaining !== null) {
                if (reminder.months_remaining <= 0) {
                    messageParts.push(`Lewat ${Math.abs(reminder.months_remaining)} bulan`);
                } else {
                    messageParts.push(`Sisa ${reminder.months_remaining} bulan`);
                }
            }

            const alertDiv = document.createElement('div');
            alertDiv.className = `border rounded-md p-4 flex items-start gap-4 cursor-pointer hover:shadow-md transition-shadow ${bgColor}`;
            alertDiv.onclick = () => window.location.href = `/vehicle-detail.html?id=${reminder.vehicle.id}`;

            alertDiv.innerHTML = `
                <div class="flex-shrink-0 mt-0.5">
                    <i data-lucide="${isOverdue ? 'alert-octagon' : 'alert-triangle'}" class="h-5 w-5 ${iconColor}"></i>
                </div>
                <div class="flex-1">
                    <h4 class="text-sm font-semibold ${textColor}">
                        ${reminder.vehicle.name} - ${reminder.maintenance_type.name}
                    </h4>
                    <p class="mt-1 text-sm ${textColor} opacity-90">
                        ${messageParts.length > 0 ? messageParts.join(' • ') : 'Perlu diperhatikan'}
                    </p>
                </div>
                <div class="flex items-center">
                    <i data-lucide="chevron-right" class="h-5 w-5 ${iconColor}"></i>
                </div>
            `;
            container.appendChild(alertDiv);
        });
    } catch (error) {
        console.error('Failed to load reminders', error);
    }
}

async function loadVehicles() {
    try {
        const vehicles = await fetchAPI('/vehicles');
        window.vehiclesData = vehicles;

        const container = document.getElementById('vehicles-container');
        const addCard = document.getElementById('add-vehicle-card');

        // Remove existing vehicle cards (keep add card)
        Array.from(container.children).forEach(child => {
            if (child.id !== 'add-vehicle-card') container.removeChild(child);
        });

        if (!vehicles || vehicles.length === 0) return;

        for (const vehicle of vehicles) {
            // Get reminders for this vehicle from cached data
            const vehicleReminders = allReminders.filter(r => r.vehicle && r.vehicle.id === vehicle.id);

            // Sort: overdue first, then due_soon, then ok
            const statusOrder = { 'overdue': 0, 'due_soon': 1, 'no_data': 2, 'ok': 3 };
            vehicleReminders.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

            const topReminders = vehicleReminders.slice(0, 4);

            let remindersHtml = '';
            if (topReminders.length > 0) {
                remindersHtml = '<ul class="mt-4 space-y-3">';
                topReminders.forEach(r => {
                    let progress = 0;
                    if (r.km_remaining !== null && r.next_due_km !== null && r.last_log) {
                        const intervalKm = r.next_due_km - r.last_log.odometer;
                        if (intervalKm > 0) {
                            const elapsed = intervalKm - (r.km_remaining || 0);
                            progress = Math.min(100, Math.max(0, (elapsed / intervalKm) * 100));
                        }
                    }
                    if (r.status === 'overdue') progress = 100;

                    let colorClass = 'bg-green-500';
                    if (r.status === 'due_soon') colorClass = 'bg-yellow-400';
                    if (r.status === 'overdue') colorClass = 'bg-red-500';

                    remindersHtml += `
                        <li>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="font-medium text-gray-700 truncate" style="max-width:140px" title="${r.maintenance_type.name}">${r.maintenance_type.icon || '🔧'} ${r.maintenance_type.name}</span>
                                ${getStatusBadge(r.status)}
                            </div>
                            <div class="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div class="${colorClass} h-1.5 rounded-full transition-all duration-500" style="width: ${progress}%"></div>
                            </div>
                        </li>
                    `;
                });
                remindersHtml += '</ul>';
            } else {
                remindersHtml = '<p class="text-sm text-gray-400 mt-4 text-center italic">Belum ada data perawatan.</p>';
            }

            const icon = getVehicleIcon(vehicle.type);

            const card = document.createElement('div');
            card.className = 'bg-white overflow-hidden shadow rounded-lg flex flex-col justify-between hover:shadow-md transition-shadow';
            card.innerHTML = `
                <div class="p-5">
                    <div class="flex items-center gap-4 mb-4">
                        <div class="bg-blue-100 p-3 rounded-full flex-shrink-0 text-2xl">
                            ${icon}
                        </div>
                        <div class="overflow-hidden">
                            <h4 class="text-lg font-bold text-gray-900 truncate" title="${vehicle.name}">${vehicle.name}</h4>
                            <p class="text-sm text-gray-500 font-mono font-medium">${vehicle.plate_number || '-'}</p>
                        </div>
                    </div>
                    <div class="flex items-center text-sm text-gray-600 mb-2 gap-2 bg-gray-50 p-2 rounded">
                        <span class="font-medium">${formatKM(vehicle.current_odometer)}</span>
                    </div>
                    <div class="border-t border-gray-100 pt-2 mt-2">
                        ${remindersHtml}
                    </div>
                </div>
                <div class="bg-gray-50 px-5 py-3 border-t border-gray-200 mt-auto">
                    <a href="vehicle-detail.html?id=${vehicle.id}" class="text-sm font-semibold text-blue-600 hover:text-blue-700 flex justify-center items-center gap-1">
                        Lihat Detail <i data-lucide="arrow-right" class="h-4 w-4"></i>
                    </a>
                </div>
            `;
            container.insertBefore(card, addCard);
        }
    } catch (error) {
        console.error('Failed to load vehicles', error);
    }
}

async function openQuickAction() {
    openModal('quick-action-modal');
    document.getElementById('date').valueAsDate = new Date();
    await loadVehiclesForSelect();
}

async function loadVehiclesForSelect() {
    const select = document.getElementById('vehicle_id');
    select.innerHTML = '<option value="">Pilih Kendaraan</option>';
    try {
        let vehicles = window.vehiclesData;
        if (!vehicles) {
            vehicles = await fetchAPI('/vehicles');
            window.vehiclesData = vehicles;
        }
        if (vehicles) {
            vehicles.forEach(v => {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = `${v.name} (${v.plate_number || '-'})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load vehicles for dropdown', error);
    }
}

async function loadMaintenanceTypes(vehicleType) {
    const select = document.getElementById('type_id');
    select.innerHTML = '<option value="">Memuat...</option>';
    select.disabled = true;
    try {
        const types = await fetchAPI('/maintenance-types');
        let applicable = (types || []).filter(t =>
            t.applicable_to === 'semua' || t.applicable_to === vehicleType
        );
        select.innerHTML = '<option value="">Pilih Jenis Perawatan</option>';
        applicable.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.icon || '🔧'} ${t.name}`;
            select.appendChild(option);
        });
        select.disabled = false;
    } catch (error) {
        select.innerHTML = '<option value="">Gagal memuat</option>';
    }
}

async function submitQuickMaintenance(e) {
    e.preventDefault();
    const vehicleId = document.getElementById('vehicle_id').value;
    if (!vehicleId) { showToast('Pilih kendaraan terlebih dahulu', 'warning'); return; }

    const data = {
        maintenance_type_id: parseInt(document.getElementById('type_id').value),
        log_date: document.getElementById('date').value,
        odometer: parseInt(document.getElementById('odometer').value),
        workshop: document.getElementById('workshop').value,
        cost: parseInt(document.getElementById('cost').value) || 0,
        parts_used: document.getElementById('parts_replaced').value,
        notes: document.getElementById('notes').value
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Menyimpan...';
    submitBtn.disabled = true;

    try {
        await fetchAPI(`/vehicles/${vehicleId}/maintenance`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        showToast('Perawatan berhasil dicatat!', 'success');
        closeModal('quick-action-modal');
        e.target.reset();
        await loadDashboard();
    } catch (error) {
        console.error('Failed to save maintenance', error);
    } finally {
        submitBtn.textContent = 'Simpan';
        submitBtn.disabled = false;
    }
}
