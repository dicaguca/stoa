let appData = {
    folders: [
        { id: 'f1', name: 'Work Project', isOpen: true }
    ],
    lists: [
        { id: '1', name: 'General', folderId: null },
        { id: '2', name: 'Tasks', folderId: 'f1' },
        { id: '3', name: 'Meeting Notes', folderId: 'f1' }
    ],
    activeListId: '1',
    tasks: []
};

let currentEditingTaskId = null;
let currentNotesTaskId = null;
let currentChecklistTaskId = null;
let currentNotesLinksDraft = [];
let currentNotesEditingLinkId = null;
let currentModalDatePickerMonth = null;
let activeDatePickerContext = null;
let activeDatePickerAnchorId = null;
let currentInlineDateTaskId = null;
let bulkMode = false;
let bulkSelection = new Set();
let pendingDialogResolver = null;
let activeDialogOptions = null;
let recurrenceDraft = createDefaultRecurrence();

const RECURRENCE_WEEKDAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];
const RECURRENCE_WEEKDAY_SHORT = {
    '0': 'Sun',
    '1': 'Mon',
    '2': 'Tue',
    '3': 'Wed',
    '4': 'Thu',
    '5': 'Fri',
    '6': 'Sat'
};
const RECURRENCE_WEEKDAY_LONG = {
    '0': 'Sunday',
    '1': 'Monday',
    '2': 'Tuesday',
    '3': 'Wednesday',
    '4': 'Thursday',
    '5': 'Friday',
    '6': 'Saturday'
};
const RECURRENCE_ORDINAL_LABELS = {
    '1': '1st',
    '2': '2nd',
    '3': '3rd',
    '4': '4th',
    'last': 'last'
};
const CLOUD_STORAGE_API_URL = 'https://api.sadhanas.app';
const APP_STORAGE_KEY = 'stoa:data';
const LOCAL_STORAGE_KEY = 'stoa:backup';
const SIDEBAR_WIDTH_STORAGE_KEY = 'stoa:sidebar-width';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 420;

function createDefaultRecurrence(overrides = {}) {
    return {
        enabled: false,
        unit: 'day',
        interval: 1,
        recurringDays: [],
        monthlyMode: 'dayOfMonth',
        dayOfMonth: null,
        ordinal: null,
        weekday: null,
        createOnComplete: true,
        recurForever: true,
        updateStatusTo: null,
        ...overrides
    };
}

function cloneRecurrence(recurrence) {
    const normalized = normalizeRecurrence(recurrence);
    return {
        ...normalized,
        recurringDays: [...normalized.recurringDays]
    };
}

function parseDateString(dateString) {
    if (!dateString) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getBaseTaskDate(task, dueDateOverride = null) {
    const dueDate = dueDateOverride !== null ? dueDateOverride : task?.dueDate;
    const parsedDueDate = parseDateString(dueDate);
    if (parsedDueDate) return parsedDueDate;

    const createdAt = task?.createdAt ? new Date(task.createdAt) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
        return new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
    }

    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function clampInteger(value, fallback, min, max = null) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    const clampedMin = Math.max(parsed, min);
    return max === null ? clampedMin : Math.min(clampedMin, max);
}

function sortRecurringDays(days) {
    const uniqueDays = Array.from(new Set((Array.isArray(days) ? days : []).map(String)));
    return RECURRENCE_WEEKDAY_ORDER.filter(day => uniqueDays.includes(day));
}

function getOrdinalForDate(date) {
    const sameWeekdayNextWeek = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
    if (sameWeekdayNextWeek.getMonth() !== date.getMonth()) {
        return 'last';
    }

    return String(Math.min(4, Math.ceil(date.getDate() / 7)));
}

function normalizeRecurrence(recurrenceValue, task = null) {
    const baseDate = getBaseTaskDate(task);
    const fallbackWeekday = String(baseDate.getDay());
    const fallbackDayOfMonth = baseDate.getDate();
    const fallbackOrdinal = getOrdinalForDate(baseDate);

    if (!recurrenceValue || recurrenceValue === 'none') {
        return createDefaultRecurrence();
    }

    if (typeof recurrenceValue === 'string') {
        const legacyDays = sortRecurringDays(task?.recurringDays || []);
        switch (recurrenceValue) {
            case 'daily':
                return createDefaultRecurrence({
                    enabled: true,
                    unit: 'day',
                    interval: 1
                });
            case 'weekly':
                return createDefaultRecurrence({
                    enabled: true,
                    unit: 'week',
                    interval: 1,
                    recurringDays: legacyDays.length ? legacyDays : [fallbackWeekday]
                });
            case 'biweekly':
                return createDefaultRecurrence({
                    enabled: true,
                    unit: 'week',
                    interval: 2,
                    recurringDays: legacyDays.length ? legacyDays : [fallbackWeekday]
                });
            case 'monthly':
                return createDefaultRecurrence({
                    enabled: true,
                    unit: 'month',
                    interval: 1,
                    monthlyMode: 'dayOfMonth',
                    dayOfMonth: fallbackDayOfMonth
                });
            case 'yearly':
                return createDefaultRecurrence({
                    enabled: true,
                    unit: 'year',
                    interval: 1
                });
            default:
                return createDefaultRecurrence();
        }
    }

    const normalized = createDefaultRecurrence();
    normalized.enabled = !!recurrenceValue.enabled;
    normalized.unit = ['day', 'week', 'month', 'year'].includes(recurrenceValue.unit)
        ? recurrenceValue.unit
        : 'day';
    normalized.interval = clampInteger(recurrenceValue.interval, 1, 1);
    normalized.recurringDays = sortRecurringDays(recurrenceValue.recurringDays);
    normalized.monthlyMode = recurrenceValue.monthlyMode === 'ordinalWeekday' ? 'ordinalWeekday' : 'dayOfMonth';
    normalized.dayOfMonth = recurrenceValue.dayOfMonth == null
        ? null
        : clampInteger(recurrenceValue.dayOfMonth, fallbackDayOfMonth, 1, 31);
    normalized.ordinal = ['1', '2', '3', '4', 'last'].includes(recurrenceValue.ordinal)
        ? recurrenceValue.ordinal
        : null;
    normalized.weekday = Object.prototype.hasOwnProperty.call(RECURRENCE_WEEKDAY_LONG, String(recurrenceValue.weekday))
        ? String(recurrenceValue.weekday)
        : null;
    normalized.createOnComplete = recurrenceValue.createOnComplete !== false;
    normalized.recurForever = recurrenceValue.recurForever !== false;
    normalized.updateStatusTo = STATUS_VALUES.includes(recurrenceValue.updateStatusTo)
        ? recurrenceValue.updateStatusTo
        : null;

    if (normalized.unit === 'week' && normalized.enabled && normalized.recurringDays.length === 0) {
        normalized.recurringDays = [fallbackWeekday];
    }

    if (normalized.unit === 'month') {
        if (normalized.monthlyMode === 'dayOfMonth') {
            normalized.dayOfMonth = normalized.dayOfMonth || fallbackDayOfMonth;
            normalized.ordinal = null;
            normalized.weekday = null;
        } else {
            normalized.dayOfMonth = null;
            normalized.ordinal = normalized.ordinal || fallbackOrdinal;
            normalized.weekday = normalized.weekday || fallbackWeekday;
        }
    } else {
        normalized.monthlyMode = 'dayOfMonth';
        normalized.dayOfMonth = normalized.dayOfMonth ?? null;
        normalized.ordinal = null;
        normalized.weekday = null;
    }

    return normalized;
}

function normalizeTask(task) {
    return {
        ...task,
        taskType: normalizeTaskType(task.taskType),
        links: normalizeTaskLinks(task.links),
        checklist: Array.isArray(task.checklist) ? task.checklist : [],
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        isExpanded: typeof task.isExpanded === 'boolean' ? task.isExpanded : false,
        recurrence: normalizeRecurrence(task.recurrence, task)
    };
}

function normalizeTaskType(taskType) {
    return TASK_TYPE_OPTIONS.some(option => option.value === taskType) ? taskType : '';
}

function normalizeTaskLinks(links) {
    if (!Array.isArray(links)) return [];

    return links
        .filter(link => link && typeof link === 'object')
        .map(link => {
            const title = typeof link.title === 'string' ? link.title.trim() : '';
            const url = typeof link.url === 'string' ? link.url.trim() : '';
            if (!title || !url) return null;

            return {
                id: typeof link.id === 'string' && link.id.trim() ? link.id : Date.now().toString() + Math.random(),
                title,
                url
            };
        })
        .filter(Boolean);
}

function hasTaskNotesContent(task) {
    return !!(task?.description && task.description.trim()) ||
        normalizeTaskLinks(task?.links).length > 0;
}

function getChecklistStats(task) {
    const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
    return {
        total: checklist.length,
        completed: checklist.filter(item => item?.done).length
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ensureUrlProtocol(url) {
    const trimmed = url.trim();
    if (!trimmed) return '';
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getLinkDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
        return '';
    }
}

function isRecurringTask(task) {
    return !!normalizeRecurrence(task?.recurrence, task).enabled;
}

function joinReadableList(values) {
    if (values.length <= 1) return values[0] || '';
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function getRecurrenceSummary(recurrenceValue, dueDate = '', task = null) {
    const recurrence = normalizeRecurrence(recurrenceValue, task ? { ...task, dueDate: dueDate || task.dueDate } : { dueDate });
    if (!recurrence.enabled) return 'No recurrence';

    if (recurrence.unit === 'day') {
        return recurrence.interval === 1 ? 'Every day' : `Every ${recurrence.interval} days`;
    }

    if (recurrence.unit === 'week') {
        const base = recurrence.interval === 1 ? 'Every week' : `Every ${recurrence.interval} weeks`;
        const selectedDays = recurrence.recurringDays.map(day => RECURRENCE_WEEKDAY_SHORT[day]).filter(Boolean);
        return selectedDays.length ? `${base} on ${joinReadableList(selectedDays)}` : base;
    }

    if (recurrence.unit === 'month') {
        const base = recurrence.interval === 1 ? 'Monthly' : `Every ${recurrence.interval} months`;
        if (recurrence.monthlyMode === 'ordinalWeekday') {
            const ordinal = RECURRENCE_ORDINAL_LABELS[recurrence.ordinal] || 'last';
            const weekday = RECURRENCE_WEEKDAY_LONG[recurrence.weekday] || 'day';
            return `${base} on the ${ordinal} ${weekday}`;
        }

        const baseDate = getBaseTaskDate(task, dueDate);
        const dayOfMonth = recurrence.dayOfMonth || baseDate.getDate();
        return `${base} on day ${dayOfMonth}`;
    }

    const baseDate = getBaseTaskDate(task, dueDate);
    const formattedDate = baseDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
    return recurrence.interval === 1
        ? `Yearly on ${formattedDate}`
        : `Every ${recurrence.interval} years on ${formattedDate}`;
}

function startOfWeek(date) {
    const result = new Date(date);
    const day = result.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    result.setDate(result.getDate() + offset);
    result.setHours(0, 0, 0, 0);
    return result;
}

function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function resolveMonthOffset(date, monthsToAdd) {
    const totalMonths = (date.getFullYear() * 12) + date.getMonth() + monthsToAdd;
    return {
        year: Math.floor(totalMonths / 12),
        monthIndex: totalMonths % 12
    };
}

function getMonthlyDayOccurrence(date, monthsToAdd, targetDay) {
    const targetMonth = resolveMonthOffset(date, monthsToAdd);
    const clampedDay = Math.min(targetDay, getDaysInMonth(targetMonth.year, targetMonth.monthIndex));
    return new Date(targetMonth.year, targetMonth.monthIndex, clampedDay);
}

function getOrdinalWeekdayOccurrence(year, monthIndex, ordinal, weekday) {
    const matches = [];
    const targetWeekday = Number(weekday);
    const daysInMonth = getDaysInMonth(year, monthIndex);

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthIndex, day);
        if (date.getDay() === targetWeekday) {
            matches.push(day);
        }
    }

    if (!matches.length) {
        return new Date(year, monthIndex, daysInMonth);
    }

    if (ordinal === 'last') {
        return new Date(year, monthIndex, matches[matches.length - 1]);
    }

    const ordinalIndex = Math.max(0, Number(ordinal) - 1);
    const chosenDay = matches[ordinalIndex] || matches[matches.length - 1];
    return new Date(year, monthIndex, chosenDay);
}

function getNextWeeklyOccurrence(baseDate, recurrence) {
    const selectedDays = recurrence.recurringDays.length
        ? recurrence.recurringDays
        : [String(baseDate.getDay())];
    const anchorWeekStart = startOfWeek(baseDate);
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    for (let offset = 1; offset <= 366 * Math.max(1, recurrence.interval); offset++) {
        const candidate = new Date(baseDate);
        candidate.setDate(candidate.getDate() + offset);

        if (!selectedDays.includes(String(candidate.getDay()))) {
            continue;
        }

        const weeksSinceAnchor = Math.round((startOfWeek(candidate) - anchorWeekStart) / oneWeekMs);
        if (weeksSinceAnchor % recurrence.interval === 0) {
            return candidate;
        }
    }

    const fallback = new Date(baseDate);
    fallback.setDate(fallback.getDate() + (recurrence.interval * 7));
    return fallback;
}

function getNextMonthlyOccurrence(baseDate, recurrence) {
    if (recurrence.monthlyMode === 'ordinalWeekday') {
        const targetMonth = resolveMonthOffset(baseDate, recurrence.interval);
        return getOrdinalWeekdayOccurrence(
            targetMonth.year,
            targetMonth.monthIndex,
            recurrence.ordinal || 'last',
            recurrence.weekday || String(baseDate.getDay())
        );
    }

    return getMonthlyDayOccurrence(baseDate, recurrence.interval, recurrence.dayOfMonth || baseDate.getDate());
}

function getNextYearlyOccurrence(baseDate, recurrence) {
    const targetYear = baseDate.getFullYear() + recurrence.interval;
    const monthIndex = baseDate.getMonth();
    const day = Math.min(baseDate.getDate(), getDaysInMonth(targetYear, monthIndex));
    return new Date(targetYear, monthIndex, day);
}

function calculateNextRecurrenceDate(task, recurrenceValue) {
    const recurrence = normalizeRecurrence(recurrenceValue, task);
    if (!recurrence.enabled) return null;

    const baseDate = getBaseTaskDate(task);

    switch (recurrence.unit) {
        case 'day': {
            const nextDate = new Date(baseDate);
            nextDate.setDate(nextDate.getDate() + recurrence.interval);
            return nextDate;
        }
        case 'week':
            return getNextWeeklyOccurrence(baseDate, recurrence);
        case 'month':
            return getNextMonthlyOccurrence(baseDate, recurrence);
        case 'year':
            return getNextYearlyOccurrence(baseDate, recurrence);
        default:
            return null;
    }
}

// --- BOOTSTRAP ---

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    updateOverdueBadge();
    renderSidebarDate();
    setupSidebarResize();
    // Start on the Dashboard by default like ClickUp
    showDashboard(); 
    setupEventListeners();
});

function renderSidebarDate() {
    const dateEl = document.getElementById('sidebar-today-date');
    if (!dateEl) return;

    const today = new Date();
    dateEl.textContent = today.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });
}

function clampSidebarWidth(width) {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function applySidebarWidth(width) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    sidebar.style.width = `${clampSidebarWidth(width)}px`;
}

function loadSavedSidebarWidth() {
    try {
        const savedWidth = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY), 10);
        if (!Number.isNaN(savedWidth)) {
            applySidebarWidth(savedWidth);
        }
    } catch (error) {
        console.warn('Unable to load sidebar width.', error);
    }
}

function saveSidebarWidth(width) {
    try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
    } catch (error) {
        console.warn('Unable to save sidebar width.', error);
    }
}

function setupSidebarResize() {
    const handle = document.getElementById('sidebar-resize-handle');
    const sidebar = document.querySelector('.sidebar');
    if (!handle || !sidebar) return;

    loadSavedSidebarWidth();

    handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        document.body.classList.add('sidebar-resizing');
        handle.setPointerCapture?.(event.pointerId);

        const resizeSidebar = (moveEvent) => {
            const nextWidth = clampSidebarWidth(moveEvent.clientX);
            sidebar.style.width = `${nextWidth}px`;
        };

        const stopResizing = (upEvent) => {
            const width = Math.round(sidebar.getBoundingClientRect().width);
            saveSidebarWidth(width);
            document.body.classList.remove('sidebar-resizing');
            handle.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', resizeSidebar);
            window.removeEventListener('pointerup', stopResizing);
            window.removeEventListener('pointercancel', stopResizing);
        };

        window.addEventListener('pointermove', resizeSidebar);
        window.addEventListener('pointerup', stopResizing);
        window.addEventListener('pointercancel', stopResizing);
    });
}

function setupEventListeners() {
    document.getElementById('add-task-btn').addEventListener('click', addTask);
    document.getElementById('new-task-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTask();
    });

    document.getElementById('add-list-btn').addEventListener('click', async () => {
        const name = await showPromptModal({
            title: 'New List',
            message: 'Enter list name:',
            confirmText: 'Create',
            inputPlaceholder: 'List name'
        });
        if (name) createList(name);
    });
    document.getElementById('export-data-btn').addEventListener('click', exportData);
    document.getElementById('import-data-btn').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);

    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('save-task-btn').addEventListener('click', saveTaskDetails);
    document.getElementById('task-modal').addEventListener('click', (e) => {
        if (e.target.id === 'task-modal') closeModal();
    });
    document.getElementById('close-recurrence-modal-btn').addEventListener('click', closeRecurrenceModal);
    document.getElementById('save-recurrence-btn').addEventListener('click', saveRecurrenceDetails);
    document.getElementById('recurrence-modal').addEventListener('click', (e) => {
        if (e.target.id === 'recurrence-modal') closeRecurrenceModal();
    });
    document.getElementById('recurrence-enabled').addEventListener('change', syncRecurrenceEditorVisibility);
    document.getElementById('recurrence-unit').addEventListener('change', syncRecurrenceEditorVisibility);
    document.getElementById('recurrence-monthly-mode').addEventListener('change', syncRecurrenceEditorVisibility);
    document.getElementById('close-notes-modal-btn').addEventListener('click', closeNotesModal);
    document.getElementById('save-notes-btn').addEventListener('click', saveTaskNotes);
    document.getElementById('add-task-link-btn').addEventListener('click', () => openTaskLinkForm());
    document.getElementById('save-task-link-btn').addEventListener('click', saveDraftTaskLink);
    document.getElementById('cancel-task-link-btn').addEventListener('click', closeTaskLinkForm);
    document.getElementById('notes-modal').addEventListener('click', (e) => {
        if (e.target.id === 'notes-modal') closeNotesModal();
    });
    document.getElementById('close-checklist-modal-btn').addEventListener('click', closeChecklistModal);
    document.getElementById('add-checklist-items-btn').addEventListener('click', addChecklistItems);
    document.getElementById('save-checklist-btn').addEventListener('click', saveChecklistModal);
    document.getElementById('checklist-modal').addEventListener('click', (e) => {
        if (e.target.id === 'checklist-modal') closeChecklistModal();
    });
    document.getElementById('checklist-bulk-input').addEventListener('input', autoResizeChecklistInput);
    document.getElementById('app-dialog-confirm').addEventListener('click', confirmDialog);
    document.getElementById('app-dialog-cancel').addEventListener('click', cancelDialog);
    document.getElementById('app-dialog-modal').addEventListener('click', (e) => {
        if (e.target.id === 'app-dialog-modal' && activeDialogOptions?.showCancel) {
            cancelDialog();
        }
    });
    document.getElementById('app-dialog-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') confirmDialog();
    });
    document.addEventListener('click', handleModalDatePickerClickOutside);

    // Custom dropdowns for Status and Triaging
    document.addEventListener('click', handleDropdownClicks);
   
    // Custom dropdowns for right-click menu
    document.getElementById('rename-option').addEventListener('click', renameItem);
    document.getElementById('delete-option').addEventListener('click', deleteItem);

    // Restoration of the Move logic
    document.getElementById('move-option').addEventListener('click', () => {
        if (contextMenuTarget.type === 'list') {
            moveListToFolder(contextMenuTarget.id);
        }
    });
}

function showAppDialog({
    title,
    message,
    confirmText = 'OK',
    cancelText = 'Cancel',
    showCancel = false,
    input = null
}) {
    const modal = document.getElementById('app-dialog-modal');
    const titleEl = document.getElementById('app-dialog-title');
    const messageEl = document.getElementById('app-dialog-message');
    const inputEl = document.getElementById('app-dialog-input');
    const confirmBtn = document.getElementById('app-dialog-confirm');
    const cancelBtn = document.getElementById('app-dialog-cancel');

    titleEl.textContent = title || 'Dialog';
    messageEl.textContent = message || '';
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    cancelBtn.classList.toggle('hidden', !showCancel);

    if (input) {
        inputEl.classList.remove('hidden');
        inputEl.value = input.value || '';
        inputEl.placeholder = input.placeholder || '';
    } else {
        inputEl.classList.add('hidden');
        inputEl.value = '';
        inputEl.placeholder = '';
    }

    activeDialogOptions = { showCancel, hasInput: !!input };
    modal.classList.remove('hidden');

    if (input) {
        setTimeout(() => inputEl.focus(), 0);
    } else {
        setTimeout(() => confirmBtn.focus(), 0);
    }

    return new Promise(resolve => {
        pendingDialogResolver = resolve;
    });
}

function resolveDialog(result) {
    const modal = document.getElementById('app-dialog-modal');
    modal.classList.add('hidden');

    if (pendingDialogResolver) {
        pendingDialogResolver(result);
    }

    pendingDialogResolver = null;
    activeDialogOptions = null;
}

function confirmDialog() {
    if (!activeDialogOptions) return;

    if (activeDialogOptions.hasInput) {
        const value = document.getElementById('app-dialog-input').value.trim();
        resolveDialog(value === '' ? null : value);
        return;
    }

    resolveDialog(true);
}

function cancelDialog() {
    if (!activeDialogOptions) return;
    resolveDialog(activeDialogOptions.hasInput ? null : false);
}

function showAlertModal({ title, message, confirmText = 'OK' }) {
    return showAppDialog({ title, message, confirmText });
}

function showConfirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
    return showAppDialog({ title, message, confirmText, cancelText, showCancel: true });
}

function showPromptModal({
    title,
    message,
    confirmText = 'Save',
    cancelText = 'Cancel',
    inputPlaceholder = '',
    initialValue = ''
}) {
    return showAppDialog({
        title,
        message,
        confirmText,
        cancelText,
        showCancel: true,
        input: {
            placeholder: inputPlaceholder,
            value: initialValue
        }
    });
}

// --- SMART DATE FORMATTING ---

function formatDate(dateString) {
    if (!dateString) return '-';

    const [year, month, day] = dateString.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';

    if (diffDays < -1 && diffDays >= -7) {
        return `${Math.abs(diffDays)} days ago`;
    }

    if (diffDays > 1 && diffDays <= 6) {
        return targetDate.toLocaleDateString('en-US', { weekday: 'long' });
    }

    return targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getSearchQuery() {
    const input = document.getElementById('global-search');
    return input ? input.value.trim().toLowerCase() : '';
}

function matchesTaskSearch(task) {
    const query = getSearchQuery();
    if (!query) return true;
    return (task.text || '').toLowerCase().includes(query);
}

function getDefaultAppData() {
    return {
        folders: [],
        lists: [],
        activeListId: 'dashboard',
        tasks: []
    };
}

function isValidImportedData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.folders) || !Array.isArray(data.lists) || !Array.isArray(data.tasks)) {
        return false;
    }

    const foldersValid = data.folders.every(folder =>
        folder &&
        typeof folder === 'object' &&
        typeof folder.id === 'string' &&
        typeof folder.name === 'string'
    );

    const listsValid = data.lists.every(list =>
        list &&
        typeof list === 'object' &&
        typeof list.id === 'string' &&
        typeof list.name === 'string' &&
        ('folderId' in list ? (typeof list.folderId === 'string' || list.folderId === null) : true)
    );

    const tasksValid = data.tasks.every(task =>
        task &&
        typeof task === 'object' &&
        typeof task.id === 'string' &&
        typeof task.listId === 'string' &&
        typeof task.text === 'string' &&
        (!('taskType' in task) || typeof task.taskType === 'string') &&
        (!('checklist' in task) || (
            Array.isArray(task.checklist) &&
            task.checklist.every(item =>
                item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.text === 'string' &&
                typeof item.done === 'boolean'
            )
        )) &&
        (!('isExpanded' in task) || typeof task.isExpanded === 'boolean') &&
        (!('subtasks' in task) || (
            Array.isArray(task.subtasks) &&
            task.subtasks.every(subtask =>
                subtask &&
                typeof subtask === 'object' &&
                typeof subtask.id === 'string' &&
                typeof subtask.text === 'string' &&
                typeof subtask.done === 'boolean'
            )
        )) &&
        (!('links' in task) || (
            Array.isArray(task.links) &&
            task.links.every(link =>
                link &&
                typeof link === 'object' &&
                typeof link.id === 'string' &&
                typeof link.title === 'string' &&
                typeof link.url === 'string'
            )
        ))
    );

    return foldersValid && listsValid && tasksValid;
}

function normalizeImportedData(data) {
    if (!isValidImportedData(data)) return null;

    const normalized = getDefaultAppData();
    normalized.folders = Array.isArray(data.folders) ? data.folders : [];
    normalized.lists = Array.isArray(data.lists) ? data.lists : [];
    normalized.tasks = Array.isArray(data.tasks)
        ? data.tasks.map(task => normalizeTask(task))
        : [];

    if (data.activeListId === 'dashboard') {
        normalized.activeListId = 'dashboard';
    } else if (normalized.lists.some(list => list.id === data.activeListId)) {
        normalized.activeListId = data.activeListId;
    } else if (normalized.lists.length > 0) {
        normalized.activeListId = normalized.lists[0].id;
    }

    return normalized;
}

function exportData() {
    const exportPayload = {
        exportedAt: new Date().toISOString(),
        appData
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `stoa-backup-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (loadEvent) {
        try {
            const parsed = JSON.parse(loadEvent.target.result);
            const rawData = parsed.appData || parsed;
            const importedState = normalizeImportedData(rawData);

            if (!importedState) {
                await showAlertModal({
                    title: 'Import Failed',
                    message: 'Invalid backup file. Expected folders, lists, and tasks in the correct format.'
                });
                return;
            }

            const shouldImport = await showConfirmModal({
                title: 'Import Backup',
                message: 'Importing a backup will replace your current data. Continue?',
                confirmText: 'Import'
            });
            if (!shouldImport) {
                return;
            }

            appData = importedState;
            saveData();

            if (appData.activeListId === 'dashboard') {
                showDashboard();
            } else {
                const activeList = appData.lists.find(l => l.id === appData.activeListId);
                if (activeList) {
                    switchList(appData.activeListId);
                } else {
                    showDashboard();
                }
            }

            await showAlertModal({
                title: 'Import Complete',
                message: 'Backup imported successfully.'
            });
        } catch (error) {
            await showAlertModal({
                title: 'Import Failed',
                message: 'Could not import that JSON file.'
            });
        } finally {
            event.target.value = '';
        }
    };

    reader.readAsText(file);
}

function getCloudStorageUrl(key) {
    const baseUrl = CLOUD_STORAGE_API_URL.replace(/\/$/, '');
    return `${baseUrl}/${encodeURIComponent(key)}`;
}

function extractStoredAppData(payload) {
    let extracted = payload;

    if (extracted && typeof extracted === 'object') {
        if ('appData' in extracted) extracted = extracted.appData;
        else if ('value' in extracted) extracted = extracted.value;
        else if ('data' in extracted) extracted = extracted.data;
    }

    if (typeof extracted === 'string') {
        try {
            return JSON.parse(extracted);
        } catch (error) {
            return extracted;
        }
    }

    return extracted;
}

function normalizeStoredAppData(payload) {
    return normalizeImportedData(extractStoredAppData(payload));
}

function loadFromLocalBackup() {
    try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!saved) return null;
        return JSON.parse(saved);
    } catch (error) {
        console.warn('Unable to parse local backup data.', error);
        return null;
    }
}

async function loadFromCloud(key) {
    const url = getCloudStorageUrl(key);

    try {
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) return null;

        const responseText = await response.text();
        if (!responseText) return null;

        return JSON.parse(responseText);
    } catch (error) {
        console.warn(`Cloud load failed for ${url}.`, error);
    }

    return null;
}

async function saveToCloud(key, data) {
    const url = getCloudStorageUrl(key);

    try {
        const response = await fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            return true;
        }
    } catch (error) {
        console.warn(`Cloud save failed for ${url}.`, error);
    }

    return false;
}

async function loadAppData() {
    const cloudPayload = await loadFromCloud(APP_STORAGE_KEY);
    const cloudData = normalizeStoredAppData(cloudPayload);
    if (cloudData) {
        return cloudData;
    }

    const localPayload = loadFromLocalBackup();
    const localData = normalizeStoredAppData(localPayload);
    if (localData) {
        return localData;
    }

    return getDefaultAppData();
}

async function saveAppData(data) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.warn('Unable to write local backup data.', error);
    }

    await saveToCloud(APP_STORAGE_KEY, data);
}

// --- LIST + TASK CREATION / UPDATES ---

async function createList(name) {
    let folderId = null;
    
    // If you have folders, ask if the user wants to put the list in one
    if (appData.folders && appData.folders.length > 0) {
        const folderNames = appData.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
        const choice = await showPromptModal({
            title: 'Assign Folder',
            message: `Put in a folder? Enter a number or leave blank for none.\n\n${folderNames}`,
            confirmText: 'Continue',
            inputPlaceholder: 'Folder number'
        });
        if (choice && appData.folders[parseInt(choice) - 1]) {
            folderId = appData.folders[parseInt(choice) - 1].id;
        }
    }

    const newList = { 
        id: Date.now().toString(), 
        name: name,
        folderId: folderId 
    };
    
    appData.lists.push(newList);
    appData.activeListId = newList.id;
    saveData();
    renderLists();
    refreshView();
}

function addTask() {
    const input = document.getElementById('new-task-input');
    const text = input.value.trim();
    if (text === '') return;

    const newTask = {
        id: Date.now().toString(),
        listId: appData.activeListId,
        text: text,
        status: 'Active',
        priority: '',
        taskType: '',
        timeEstimate: '',
        dueDate: '',
        description: '',
        links: [],
        checklist: [],
        createdAt: new Date().toISOString(),
        subtasks: [],
        isExpanded: false,
        recurrence: createDefaultRecurrence()
    };

    appData.tasks.push(normalizeTask(newTask));
    saveData();
    refreshView();
    input.value = '';
}

function toggleTaskComplete(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.recurrence = normalizeRecurrence(task.recurrence, task);
    const wasDone = task.status === 'Done';
    const previousStatus = task.status;
    task.status = wasDone ? 'Active' : 'Done';

    if (!wasDone && task.status === 'Done' && task.recurrence.enabled && task.recurrence.createOnComplete) {
        const nextDate = calculateNextRecurrenceDate(task, task.recurrence);

        if (nextDate) {
            const nextTask = normalizeTask({
                ...task,
                id: Date.now().toString() + Math.random(),
                status: task.recurrence.updateStatusTo || previousStatus || 'Active',
                dueDate: formatDateInputValue(nextDate),
                createdAt: new Date().toISOString(),
                checklist: Array.isArray(task.checklist)
                    ? task.checklist.map(item => ({ ...item }))
                    : [],
                subtasks: Array.isArray(task.subtasks)
                    ? task.subtasks.map(subtask => ({ ...subtask, done: false }))
                    : [],
                isExpanded: false,
                recurrence: task.recurrence.recurForever
                    ? cloneRecurrence(task.recurrence)
                    : createDefaultRecurrence()
            });

            appData.tasks.push(nextTask);
        }
    }

    saveData();
    refreshView();
    updateOverdueBadge();
}


function updateTaskProperty(taskId, property, value) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (task) {
        task[property] = value;
        saveData();
        refreshView();
    }
}

function toggleTaskExpanded(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.isExpanded = !task.isExpanded;
    saveData();
    refreshView();
}

async function addSubtask(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    const text = await showPromptModal({
        title: 'New Subtask',
        message: 'Enter subtask:',
        confirmText: 'Add',
        inputPlaceholder: 'Subtask name'
    });
    if (!text) return;

    if (!Array.isArray(task.subtasks)) {
        task.subtasks = [];
    }

    task.subtasks.push({
        id: Date.now().toString() + Math.random(),
        text: text.trim(),
        done: false
    });
    task.isExpanded = true;

    saveData();
    refreshView();
}

function toggleSubtaskDone(taskId, subtaskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return;

    const subtask = task.subtasks.find(st => st.id === subtaskId);
    if (!subtask) return;

    subtask.done = !subtask.done;
    saveData();
    refreshView();
}

async function editSubtask(taskId, subtaskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return;

    const subtask = task.subtasks.find(st => st.id === subtaskId);
    if (!subtask) return;

    const newText = await showPromptModal({
        title: 'Edit Subtask',
        message: 'Update subtask text:',
        confirmText: 'Save',
        inputPlaceholder: 'Subtask name',
        initialValue: subtask.text
    });

    if (!newText) return;

    subtask.text = newText;
    saveData();
    refreshView();
}

function deleteSubtask(taskId, subtaskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return;

    task.subtasks = task.subtasks.filter(st => st.id !== subtaskId);
    if (task.subtasks.length === 0) {
        task.isExpanded = false;
    }
    saveData();
    refreshView();
}

// --- DATE EDITING ---

function editDate(taskId) {
    currentInlineDateTaskId = taskId;
    openSharedDatePicker('inline', `date-container-${taskId}`);
}

// --- MODAL LOGIC ---

function getActiveDatePickerValue() {
    if (activeDatePickerContext === 'modal') {
        return document.getElementById('modal-duedate')?.value || '';
    }
    if (activeDatePickerContext === 'inline' && currentInlineDateTaskId) {
        const task = appData.tasks.find(t => t.id === currentInlineDateTaskId);
        return task?.dueDate || '';
    }
    return '';
}

function getActiveDatePickerRecurringTask() {
    if (activeDatePickerContext === 'modal' && currentEditingTaskId) {
        const task = appData.tasks.find(t => t.id === currentEditingTaskId);
        if (!task) return null;

        return {
            ...task,
            dueDate: document.getElementById('modal-duedate')?.value || task.dueDate || '',
            recurrence: cloneRecurrence(recurrenceDraft)
        };
    }

    if (activeDatePickerContext === 'inline' && currentInlineDateTaskId) {
        return appData.tasks.find(t => t.id === currentInlineDateTaskId) || null;
    }

    return null;
}

function getRecurringHighlightDatesForMonth(task, monthDate) {
    if (!task || !isRecurringTask(task)) return new Set();

    const highlightedDates = new Set();
    const recurrence = normalizeRecurrence(task.recurrence, task);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    monthEnd.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let occurrence = getBaseTaskDate(task, task.dueDate);
    occurrence.setHours(0, 0, 0, 0);

    for (let i = 0; i < 240 && occurrence <= monthEnd; i++) {
        if (occurrence > today && occurrence >= monthStart && occurrence <= monthEnd) {
            highlightedDates.add(formatDateInputValue(occurrence));
        }

        const nextOccurrence = calculateNextRecurrenceDate(
            {
                ...task,
                dueDate: formatDateInputValue(occurrence),
                recurrence
            },
            recurrence
        );

        if (!nextOccurrence) break;

        const normalizedNext = new Date(
            nextOccurrence.getFullYear(),
            nextOccurrence.getMonth(),
            nextOccurrence.getDate()
        );

        if (normalizedNext.getTime() <= occurrence.getTime()) break;
        occurrence = normalizedNext;
    }

    return highlightedDates;
}

function getModalDatePickerBaseDate() {
    const selectedDate = parseDateString(getActiveDatePickerValue());
    const baseDate = selectedDate || new Date();
    return new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
}

function formatModalDateLabel(dateString) {
    if (!dateString) return 'No due date';
    const parsed = parseDateString(dateString);
    if (!parsed) return 'No due date';

    return parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function syncModalDateTrigger() {
    const labelEl = document.getElementById('modal-date-trigger-label');
    const input = document.getElementById('modal-duedate');
    if (!labelEl || !input) return;
    labelEl.textContent = formatModalDateLabel(input.value);
}

function renderModalDatePicker() {
    const panel = document.getElementById('shared-date-picker');
    const grid = document.getElementById('modal-date-grid');
    const monthLabel = document.getElementById('modal-date-month-label');
    const clearBtn = document.getElementById('modal-date-clear-btn');
    if (!panel || !grid || !monthLabel || !clearBtn) return;

    if (!currentModalDatePickerMonth) {
        currentModalDatePickerMonth = getModalDatePickerBaseDate();
    }

    const monthDate = new Date(currentModalDatePickerMonth.getFullYear(), currentModalDatePickerMonth.getMonth(), 1);
    monthLabel.textContent = monthDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
    });

    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const mondayOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(firstDayOfMonth);
    gridStart.setDate(firstDayOfMonth.getDate() - mondayOffset);

    const selectedDate = getActiveDatePickerValue();
    const recurringHighlightDates = getRecurringHighlightDatesForMonth(getActiveDatePickerRecurringTask(), monthDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cells = [];
    for (let i = 0; i < 42; i++) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + i);
        const cellValue = formatDateInputValue(cellDate);
        const isSelected = cellValue === selectedDate;
        const isOutsideMonth = cellDate.getMonth() !== monthDate.getMonth();
        const isToday = cellDate.getTime() === today.getTime();
        const isRecurringFuture = recurringHighlightDates.has(cellValue);

        cells.push(`
            <button type="button"
                    class="modal-date-cell ${isSelected ? 'selected' : ''} ${isOutsideMonth ? 'outside-month' : ''} ${isToday ? 'today' : ''} ${isRecurringFuture ? 'recurring-future' : ''}"
                    onclick="selectModalDate('${cellValue}')">
                ${cellDate.getDate()}
            </button>
        `);
    }

    grid.innerHTML = cells.join('');
    clearBtn.classList.toggle('hidden', activeDatePickerContext !== 'modal');
}

function positionSharedDatePicker() {
    const panel = document.getElementById('shared-date-picker');
    const anchor = activeDatePickerAnchorId ? document.getElementById(activeDatePickerAnchorId) : null;
    if (!panel || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelWidth = Math.max(Math.min(rect.width, 360), 320);
    const panelHeight = 330;
    const spacing = 8;
    const openAbove = rect.bottom + spacing + panelHeight > window.innerHeight && rect.top - spacing - panelHeight > 0;
    const top = openAbove ? rect.top - panelHeight - spacing : rect.bottom + spacing;
    const preferredLeft = rect.right - panelWidth;
    const left = Math.min(
        Math.max(spacing, preferredLeft),
        window.innerWidth - panelWidth - spacing
    );

    panel.style.top = `${Math.max(spacing, top)}px`;
    panel.style.left = `${left}px`;
    panel.style.width = `${panelWidth}px`;
}

function openSharedDatePicker(context, anchorId) {
    const panel = document.getElementById('shared-date-picker');
    if (!panel) return;

    activeDatePickerContext = context;
    activeDatePickerAnchorId = anchorId;

    currentModalDatePickerMonth = getModalDatePickerBaseDate();
    renderModalDatePicker();
    positionSharedDatePicker();
    panel.classList.remove('hidden');
}

function closeModalDatePicker() {
    const panel = document.getElementById('shared-date-picker');
    if (!panel) return;

    panel.classList.add('hidden');
    activeDatePickerContext = null;
    activeDatePickerAnchorId = null;
    currentInlineDateTaskId = null;
}

function toggleModalDatePicker() {
    const panel = document.getElementById('shared-date-picker');
    if (!panel) return;

    if (panel.classList.contains('hidden') || activeDatePickerContext !== 'modal') {
        openSharedDatePicker('modal', 'modal-date-trigger');
    } else {
        closeModalDatePicker();
    }
}

function changeModalDateMonth(offset) {
    if (!currentModalDatePickerMonth) {
        currentModalDatePickerMonth = getModalDatePickerBaseDate();
    }

    currentModalDatePickerMonth = new Date(
        currentModalDatePickerMonth.getFullYear(),
        currentModalDatePickerMonth.getMonth() + offset,
        1
    );
    renderModalDatePicker();
}

function setModalDateValue(dateString) {
    const input = document.getElementById('modal-duedate');
    if (!input) return;

    input.value = dateString;
    syncModalDateTrigger();
    updateRecurrenceSummaryUI();
}

function selectModalDate(dateString) {
    if (activeDatePickerContext === 'bulk') {
        bulkApplySelectedDate(dateString);
        return;
    }

    if (activeDatePickerContext === 'inline' && currentInlineDateTaskId) {
        updateTaskProperty(currentInlineDateTaskId, 'dueDate', dateString);
        closeModalDatePicker();
        return;
    }

    setModalDateValue(dateString);
    closeModalDatePicker();
}

function clearModalDate() {
    if (activeDatePickerContext === 'inline' && currentInlineDateTaskId) {
        updateTaskProperty(currentInlineDateTaskId, 'dueDate', '');
        closeModalDatePicker();
        return;
    }

    if (activeDatePickerContext !== 'modal') {
        closeModalDatePicker();
        return;
    }

    setModalDateValue('');
    closeModalDatePicker();
}

function handleModalDatePickerClickOutside(event) {
    const sharedPicker = event.target.closest('#shared-date-picker');
    const modalTrigger = event.target.closest('#modal-date-trigger');
    const bulkTrigger = event.target.closest('#bulk-date-trigger');
    const inlineDateTrigger = event.target.closest('[id^="date-container-"]');
    if (sharedPicker || modalTrigger || bulkTrigger || inlineDateTrigger) return;

    closeModalDatePicker();
}

function openModal(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    currentEditingTaskId = taskId;
    task.recurrence = normalizeRecurrence(task.recurrence, task);
    recurrenceDraft = cloneRecurrence(task.recurrence);
    
    // Load standard fields
    document.getElementById('modal-status').value = task.status;
    document.getElementById('modal-priority').value = task.priority || '';
    document.getElementById('modal-task-type').value = task.taskType || '';
    document.getElementById('modal-time').value = task.timeEstimate || '';
    document.getElementById('modal-duedate').value = task.dueDate || '';
    syncModalDateTrigger();
    currentModalDatePickerMonth = getModalDatePickerBaseDate();
    updateRecurrenceSummaryUI();
    
    document.getElementById('task-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('task-modal').classList.add('hidden');
    closeModalDatePicker();
    closeRecurrenceModal();
    currentEditingTaskId = null;
}

function saveTaskDetails() {
    if (!currentEditingTaskId) return;

    const task = appData.tasks.find(t => t.id === currentEditingTaskId);
    if (task) {
        task.status = document.getElementById('modal-status').value;
        task.priority = document.getElementById('modal-priority').value;
        task.taskType = normalizeTaskType(document.getElementById('modal-task-type').value);
        task.timeEstimate = document.getElementById('modal-time').value;
        task.dueDate = document.getElementById('modal-duedate').value;
        task.recurrence = cloneRecurrence(recurrenceDraft);

        saveData();
        refreshView();
        closeModal();
        updateOverdueBadge();
    }
}

function updateRecurrenceSummaryUI() {
    const summaryEl = document.getElementById('modal-recurrence-summary');
    if (!summaryEl) return;

    const task = appData.tasks.find(t => t.id === currentEditingTaskId) || null;
    const dueDate = document.getElementById('modal-duedate')?.value || task?.dueDate || '';
    summaryEl.textContent = getRecurrenceSummary(recurrenceDraft, dueDate, task);
}

function populateRecurrenceForm(recurrenceValue) {
    const recurrence = normalizeRecurrence(recurrenceValue);

    document.getElementById('recurrence-enabled').checked = recurrence.enabled;
    document.getElementById('recurrence-interval').value = recurrence.interval;
    document.getElementById('recurrence-unit').value = recurrence.unit;
    document.getElementById('recurrence-monthly-mode').value = recurrence.monthlyMode;
    document.getElementById('recurrence-day-of-month').value = recurrence.dayOfMonth || 1;
    document.getElementById('recurrence-ordinal').value = recurrence.ordinal || '1';
    document.getElementById('recurrence-weekday').value = recurrence.weekday || '1';
    document.getElementById('recurrence-create-on-complete').checked = recurrence.createOnComplete;
    document.getElementById('recurrence-recur-forever').checked = recurrence.recurForever;
    document.getElementById('recurrence-update-status').value = recurrence.updateStatusTo || '';

    document.querySelectorAll('.recurrence-day-pill').forEach(pill => {
        pill.classList.toggle('selected', recurrence.recurringDays.includes(pill.dataset.day));
    });

    syncRecurrenceEditorVisibility();
}

function collectRecurrenceForm() {
    const enabled = document.getElementById('recurrence-enabled').checked;
    const task = appData.tasks.find(t => t.id === currentEditingTaskId) || null;
    const dueDate = document.getElementById('modal-duedate')?.value || task?.dueDate || '';
    const baseDate = getBaseTaskDate(task, dueDate);
    const unit = document.getElementById('recurrence-unit').value;
    const monthlyMode = document.getElementById('recurrence-monthly-mode').value;
    const selectedDays = sortRecurringDays(
        Array.from(document.querySelectorAll('.recurrence-day-pill.selected')).map(pill => pill.dataset.day)
    );

    return normalizeRecurrence(createDefaultRecurrence({
        enabled,
        unit,
        interval: clampInteger(document.getElementById('recurrence-interval').value, 1, 1),
        recurringDays: selectedDays,
        monthlyMode,
        dayOfMonth: clampInteger(document.getElementById('recurrence-day-of-month').value, baseDate.getDate(), 1, 31),
        ordinal: document.getElementById('recurrence-ordinal').value,
        weekday: document.getElementById('recurrence-weekday').value,
        createOnComplete: document.getElementById('recurrence-create-on-complete').checked,
        recurForever: document.getElementById('recurrence-recur-forever').checked,
        updateStatusTo: document.getElementById('recurrence-update-status').value || null
    }), { dueDate });
}

function syncRecurrenceEditorVisibility() {
    const enabled = document.getElementById('recurrence-enabled').checked;
    const unit = document.getElementById('recurrence-unit').value;
    const monthlyMode = document.getElementById('recurrence-monthly-mode').value;

    document.getElementById('recurrence-settings').classList.toggle('hidden', !enabled);
    document.getElementById('recurrence-weekly-section').classList.toggle('hidden', !enabled || unit !== 'week');
    document.getElementById('recurrence-monthly-section').classList.toggle('hidden', !enabled || unit !== 'month');
    document.getElementById('recurrence-yearly-section').classList.toggle('hidden', !enabled || unit !== 'year');
    document.getElementById('recurrence-day-of-month-row').classList.toggle('hidden', !enabled || unit !== 'month' || monthlyMode !== 'dayOfMonth');
    document.getElementById('recurrence-ordinal-row').classList.toggle('hidden', !enabled || unit !== 'month' || monthlyMode !== 'ordinalWeekday');
}

function openRecurrenceModal() {
    if (!currentEditingTaskId) return;

    populateRecurrenceForm(recurrenceDraft);
    document.getElementById('recurrence-modal').classList.remove('hidden');
}

function closeRecurrenceModal() {
    document.getElementById('recurrence-modal').classList.add('hidden');
}

function saveRecurrenceDetails() {
    recurrenceDraft = collectRecurrenceForm();
    updateRecurrenceSummaryUI();
    closeRecurrenceModal();
}

function openNotesModal(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    currentNotesTaskId = taskId;
    document.getElementById('notes-modal-text').value = task.description || '';
    currentNotesLinksDraft = normalizeTaskLinks(task.links).map(link => ({ ...link }));
    currentNotesEditingLinkId = null;
    closeTaskLinkForm();
    renderTaskLinksList();
    document.getElementById('notes-modal').classList.remove('hidden');
}

function closeNotesModal() {
    document.getElementById('notes-modal').classList.add('hidden');
    currentNotesLinksDraft = [];
    currentNotesEditingLinkId = null;
    closeTaskLinkForm();
    currentNotesTaskId = null;
}

function saveTaskNotes() {
    if (!currentNotesTaskId) return;

    const task = appData.tasks.find(t => t.id === currentNotesTaskId);
    if (!task) return;

    task.description = document.getElementById('notes-modal-text').value;
    task.links = normalizeTaskLinks(currentNotesLinksDraft);
    saveData();
    refreshView();
    closeNotesModal();
}

function renderTaskLinksList() {
    const container = document.getElementById('task-links-list');
    if (!container) return;

    if (!currentNotesLinksDraft.length) {
        container.innerHTML = '<div class="task-link-empty">No links yet. Add references, docs, or resources for this task.</div>';
        return;
    }

    container.innerHTML = currentNotesLinksDraft.map(link => {
        const safeTitle = escapeHtml(link.title);
        const safeUrl = escapeHtml(link.url);
        const domain = getLinkDomain(link.url);
        const domainHtml = domain ? `<div class="task-link-domain">${escapeHtml(domain)}</div>` : '';

        return `
            <div class="task-link-item">
                <div class="task-link-main">
                    <a class="task-link-title" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
                    ${domainHtml}
                </div>
                <div class="task-link-actions">
                    <button type="button"
                            class="task-link-action-btn"
                            onclick="openTaskLinkForm('${link.id}')"
                            title="Edit link">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button"
                            class="task-link-action-btn"
                            onclick="deleteDraftTaskLink('${link.id}')"
                            title="Delete link">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openTaskLinkForm(linkId = null) {
    const formEl = document.getElementById('task-link-form');
    const titleInput = document.getElementById('task-link-title');
    const urlInput = document.getElementById('task-link-url');
    if (!formEl || !titleInput || !urlInput) return;

    currentNotesEditingLinkId = linkId;
    const existingLink = linkId
        ? currentNotesLinksDraft.find(link => link.id === linkId)
        : null;

    titleInput.value = existingLink ? existingLink.title : '';
    urlInput.value = existingLink ? existingLink.url : '';
    formEl.classList.remove('hidden');
    titleInput.focus();
}

function closeTaskLinkForm() {
    const formEl = document.getElementById('task-link-form');
    const titleInput = document.getElementById('task-link-title');
    const urlInput = document.getElementById('task-link-url');
    if (formEl) formEl.classList.add('hidden');
    if (titleInput) titleInput.value = '';
    if (urlInput) urlInput.value = '';
    currentNotesEditingLinkId = null;
}

function saveDraftTaskLink() {
    const titleInput = document.getElementById('task-link-title');
    const urlInput = document.getElementById('task-link-url');
    if (!titleInput || !urlInput) return;

    const title = titleInput.value.trim();
    const normalizedUrl = ensureUrlProtocol(urlInput.value);
    if (!title || !normalizedUrl) return;

    try {
        new URL(normalizedUrl);
    } catch (error) {
        urlInput.focus();
        return;
    }

    if (currentNotesEditingLinkId) {
        currentNotesLinksDraft = currentNotesLinksDraft.map(link =>
            link.id === currentNotesEditingLinkId
                ? { ...link, title, url: normalizedUrl }
                : link
        );
    } else {
        currentNotesLinksDraft.push({
            id: Date.now().toString() + Math.random(),
            title,
            url: normalizedUrl
        });
    }

    closeTaskLinkForm();
    renderTaskLinksList();
}

function deleteDraftTaskLink(linkId) {
    currentNotesLinksDraft = currentNotesLinksDraft.filter(link => link.id !== linkId);
    if (currentNotesEditingLinkId === linkId) {
        closeTaskLinkForm();
    }
    renderTaskLinksList();
}

function openChecklistModal(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    if (!task) return;

    currentChecklistTaskId = taskId;
    if (!Array.isArray(task.checklist)) {
        task.checklist = [];
    }

    document.getElementById('checklist-bulk-input').value = '';
    autoResizeChecklistInput();
    renderChecklistItems();
    document.getElementById('checklist-modal').classList.remove('hidden');
}

function closeChecklistModal() {
    document.getElementById('checklist-modal').classList.add('hidden');
    currentChecklistTaskId = null;
}

function getCurrentChecklistTask() {
    if (!currentChecklistTaskId) return null;
    return appData.tasks.find(t => t.id === currentChecklistTaskId) || null;
}

function autoResizeChecklistInput() {
    const textarea = document.getElementById('checklist-bulk-input');
    if (!textarea) return;
    textarea.style.height = '40px';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function renderChecklistItems() {
    const container = document.getElementById('checklist-items-container');
    const summary = document.getElementById('checklist-summary');
    const task = getCurrentChecklistTask();
    if (!container || !task) return;

    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    const checklistStats = getChecklistStats(task);
    if (summary) {
        summary.textContent = `${checklistStats.completed} of ${checklistStats.total} completed`;
    }

    if (checklist.length === 0) {
        container.innerHTML = '<div class="checklist-empty">No checklist items yet.</div>';
        return;
    }

    container.innerHTML = checklist.map(item => `
        <div class="checklist-item ${item.done ? 'done' : ''}">
            <input type="checkbox"
                   ${item.done ? 'checked' : ''}
                   onchange="toggleChecklistItem('${item.id}')">
            <span class="checklist-item-text">${item.text}</span>
            <button class="checklist-delete-btn"
                    onclick="deleteChecklistItem('${item.id}')"
                    title="Delete checklist item">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function addChecklistItems() {
    const task = getCurrentChecklistTask();
    const textarea = document.getElementById('checklist-bulk-input');
    if (!task || !textarea) return;

    const lines = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return;

    if (!Array.isArray(task.checklist)) {
        task.checklist = [];
    }

    lines.forEach(text => {
        task.checklist.push({
            id: Date.now().toString() + Math.random(),
            text,
            done: false
        });
    });

    textarea.value = '';
    autoResizeChecklistInput();
    renderChecklistItems();
}

function toggleChecklistItem(itemId) {
    const task = getCurrentChecklistTask();
    if (!task || !Array.isArray(task.checklist)) return;

    const item = task.checklist.find(entry => entry.id === itemId);
    if (!item) return;

    item.done = !item.done;
    renderChecklistItems();
}

function deleteChecklistItem(itemId) {
    const task = getCurrentChecklistTask();
    if (!task || !Array.isArray(task.checklist)) return;

    task.checklist = task.checklist.filter(entry => entry.id !== itemId);
    renderChecklistItems();
}

function saveChecklistModal() {
    if (!currentChecklistTaskId) return;

    saveData();
    refreshView();
    closeChecklistModal();
}

// --- LIST SWITCHING ---

function switchList(listId) {
    appData.activeListId = listId;
    
    // UI Updates: Show task input, hide dashboard tabs
    document.getElementById('task-input-section').classList.remove('hidden');
    document.getElementById('dashboard-tabs').classList.add('hidden');
    document.getElementById('nav-home').classList.remove('active');
    document.querySelector('.top-bar')?.classList.remove('dashboard-home');

    const activeList = appData.lists.find(l => l.id === listId);
    const titleEl = document.getElementById('current-list-title');
    titleEl.classList.remove('dashboard-title');
    titleEl.textContent = activeList ? activeList.name : 'Tasks';
    
    renderLists();
    renderTasks();
}

// --- COLOR HELPERS ---

function getStatusColor(status) {
    switch (status) {
        case 'Important': return 'var(--status-important)';
        case 'Active': return 'var(--status-active)';
        case 'Structure': return 'var(--status-structure)';
        case 'Inactive': return 'var(--status-inactive)';
        case 'Conservation': return 'var(--status-conservation)';
        case 'Done': return 'var(--status-done)';
        default: return 'var(--status-active)';
    }
}

function getPriorityColor(priority) {
    switch (priority) {
        case 'Must do':    return 'var(--prio-must)';
        case 'Should do':  return 'var(--prio-should)';
        case 'Want to do': return 'var(--prio-want)';
        case 'Could do':   return 'var(--prio-could)';
        case 'Get to do':  return 'var(--prio-get)';
        case "Won't do":   return 'var(--prio-wont)';
        default:           return 'transparent';
    }
}

// --- CUSTOM DROPDOWN DATA ---

const STATUS_VALUES = [
    'Important',
    'Active',
    'Structure',
    'Inactive',
    'Conservation',
    'Done'
];

const PRIORITY_OPTIONS = [
    { value: 'Must do',    label: 'Must do' },
    { value: 'Should do',  label: 'Should do' },
    { value: 'Want to do', label: 'Want to do' },
    { value: 'Could do',   label: 'Could do' },
    { value: 'Get to do',  label: 'Get to do' },
    { value: "Won't do",   label: "Won't do" },
    { value: '',           label: '-' }
];

const TASK_TYPE_OPTIONS = [
    { value: 'Meeting', label: 'Meeting', icon: 'fa-user-group' },
    { value: 'Appointment', label: 'Appointment', icon: 'fa-calendar-check' },
    { value: 'ASAP', label: 'ASAP', icon: 'fa-triangle-exclamation' },
    { value: 'Starred', label: 'Starred', icon: 'fa-star' },
    { value: 'Email & Messages', label: 'Email & Messages', icon: 'fa-envelope' },
    { value: 'CBF', label: 'CBF', icon: 'fa-leaf' },
    { value: 'Zen Habits', label: 'Zen Habits', icon: 'fa-spa' },
    { value: 'Birthday', label: 'Birthday', icon: 'fa-cake-candles' }
];

function getTaskTypeOption(taskType) {
    return TASK_TYPE_OPTIONS.find(option => option.value === taskType) || null;
}

function getPriorityRank(priority) {
    const rank = PRIORITY_OPTIONS.findIndex(option => option.value === (priority || ''));
    return rank === -1 ? PRIORITY_OPTIONS.length : rank;
}

// --- DROPDOWN RENDERERS ---

function renderStatusDropdown(task) {
    const statusColor = getStatusColor(task.status);
    const taskTypeOption = getTaskTypeOption(task.taskType);
    const triggerInner = taskTypeOption
        ? `<i class="fa-solid ${taskTypeOption.icon}"></i>`
        : '';
    const triggerClass = taskTypeOption
        ? 'dropdown-toggle dropdown-toggle-status compact has-task-type'
        : 'dropdown-toggle dropdown-toggle-status compact';
    const triggerStyle = taskTypeOption
        ? `color:${statusColor};`
        : `background-color:${statusColor};`;

    return `
        <div class="dropdown dropdown-status" data-task-id="${task.id}" data-field="status">
            <button type="button"
                    class="${triggerClass}"
                    style="${triggerStyle}"
                    title="${task.status}${taskTypeOption ? ` • ${taskTypeOption.label}` : ''}">
                ${triggerInner}
            </button>
            <div class="dropdown-menu">
                ${STATUS_VALUES.map(status => `
                    <div class="dropdown-option" data-value="${status}">
                        <span class="dropdown-dot" style="background-color:${getStatusColor(status)}"></span>
                        <span>${status}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderPriorityDropdown(task) {
    const isEmpty = !task.priority;
    const label = task.priority || '-';
    const color = getPriorityColor(task.priority);

    return `
        <div class="dropdown dropdown-priority" data-task-id="${task.id}" data-field="priority">
            <button type="button" class="dropdown-toggle dropdown-toggle-priority ${isEmpty ? 'priority-empty' : ''}" style="background-color:${isEmpty ? 'transparent' : color};">
                ${label}
            </button>
            <div class="dropdown-menu">
                ${PRIORITY_OPTIONS.map(opt => `
                    <div class="dropdown-option" data-value="${opt.value}">
                        <span class="dropdown-dot" style="background-color:${getPriorityColor(opt.value)}"></span>
                        <span>${opt.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// --- DROPDOWN INTERACTION ---

function positionDropdownMenu(dropdown) {
    if (!dropdown) return;

    dropdown.classList.remove('open-above');
    const menu = dropdown.querySelector('.dropdown-menu');
    const toggle = dropdown.querySelector('.dropdown-toggle, [data-dropdown-trigger]');
    if (!menu || !toggle) return;

    const spacing = 6;
    menu.style.top = '';
    menu.style.bottom = 'auto';
    menu.style.left = '';
    menu.style.right = 'auto';
    menu.style.maxHeight = '';
    menu.style.overflowY = '';

    const toggleRect = toggle.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const menuLeft = Math.max(
        spacing,
        Math.min(toggleRect.left, window.innerWidth - menuWidth - spacing)
    );
    const spaceBelow = window.innerHeight - toggleRect.bottom - spacing;
    const spaceAbove = toggleRect.top - spacing;
    const shouldOpenAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = Math.max(120, shouldOpenAbove ? spaceAbove : spaceBelow);

    menu.style.left = `${menuLeft}px`;
    menu.style.maxHeight = `${availableHeight}px`;
    menu.style.overflowY = 'auto';

    if (shouldOpenAbove) {
        dropdown.classList.add('open-above');
        menu.style.top = `${Math.max(spacing, toggleRect.top - menuHeight - spacing)}px`;
    } else {
        menu.style.top = `${toggleRect.bottom + spacing}px`;
    }
}

function closeDropdown(dropdown) {
    if (!dropdown) return;

    const menu = dropdown.querySelector('.dropdown-menu');
    if (menu) {
        menu.style.top = '';
        menu.style.bottom = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.maxHeight = '';
        menu.style.overflowY = '';
    }

    dropdown.classList.remove('open');
    dropdown.classList.remove('open-above');
}

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown.open').forEach(closeDropdown);
}

function handleDropdownClicks(e) {
    const toggle = e.target.closest('.dropdown-toggle, [data-dropdown-trigger]');
    const option = e.target.closest('.dropdown-option');

    // Open / close menu
    if (toggle) {
        const dropdown = toggle.closest('.dropdown');
        const isOpen = dropdown.classList.contains('open');

        closeAllDropdowns();

        if (!isOpen) {
            dropdown.classList.add('open');
            positionDropdownMenu(dropdown);
        }
        return;
    }

    // Choose option
    if (option) {
        const dropdown = option.closest('.dropdown');
        const taskId = dropdown.dataset.taskId;
        const field = dropdown.dataset.field;
        const value = option.dataset.value;

        if (field === 'bulk-status') {
            bulkApplySelectedStatus(value);
            closeDropdown(dropdown);
            return;
        }

        updateTaskProperty(taskId, field, value);
        closeDropdown(dropdown);
        return;
    }

    // Click outside → close all
    if (!e.target.closest('.dropdown')) {
        closeAllDropdowns();
    }
}

// --- LIST RENDERING ---

function renderLists() {
    const container = document.getElementById('list-container');
    if (!container) return;
    container.innerHTML = '';

    // 1. Render Folders
    if (appData.folders) {
        appData.folders.forEach(folder => {
            const folderDiv = document.createElement('div');
            folderDiv.className = `folder-wrapper ${folder.isOpen ? 'open' : ''}`;
            
folderDiv.innerHTML = `
    <div class="folder-header" 
         onclick="toggleFolder('${folder.id}')" 
         oncontextmenu="handleContextMenu(event, 'folder', '${folder.id}')">
        <i class="fa-solid fa-chevron-${folder.isOpen ? 'down' : 'right'}"></i>
                    <span>${folder.name}</span>
                </div>
                <div class="folder-content">
                    ${appData.lists
                        .filter(l => l.folderId === folder.id)
                        .map(l => generateListHtml(l))
                        .join('')}
                </div>
            `;
            container.appendChild(folderDiv);
        });
    }

    // 2. Render Standalone Lists (lists that are not in a folder)
    const standaloneLists = appData.lists.filter(l => !l.folderId);
    standaloneLists.forEach(l => {
        const div = document.createElement('div');
        div.innerHTML = generateListHtml(l);
        container.appendChild(div.firstElementChild);
    });
}

// Helper function to generate the HTML for a single list item
function generateListHtml(list) {
    const isActive = appData.activeListId === list.id ? 'active' : '';
    
    return `
        <div class="nav-item ${isActive}" 
             onclick="switchList('${list.id}')"
             oncontextmenu="handleContextMenu(event, 'list', '${list.id}')"
             ondragover="event.preventDefault()" 
             ondragenter="this.style.background='rgba(255,255,255,0.2)'"
             ondragleave="this.style.background=''"
             ondrop="this.style.background=''; handleDrop(event, '${list.id}')">
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-list-ul"></i> <span>${list.name}</span>
            </div>
        </div>
    `;
}

async function moveListToFolder(listId) {
    const list = appData.lists.find(l => l.id === listId);
    if (!list) return;

    if (!appData.folders || appData.folders.length === 0) {
        await showAlertModal({
            title: 'No Folders',
            message: 'Create a folder first!'
        });
        return;
    }

    // Prepare a list of folders for the prompt
    const folderOptions = appData.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
    const choice = await showPromptModal({
        title: 'Move to Folder',
        message:
            `Move "${list.name}" to which folder?\n\n` +
            `${folderOptions}\n` +
            `0. None (Make standalone)\n\n` +
            `Enter the number:`,
        confirmText: 'Move',
        inputPlaceholder: 'Folder number'
    });

    if (choice === null) return; // User cancelled

    if (choice === '0') {
        list.folderId = null;
    } else {
        const index = parseInt(choice) - 1;
        if (appData.folders[index]) {
            list.folderId = appData.folders[index].id;
        } else {
            await showAlertModal({
                title: 'Invalid Selection',
                message: 'Invalid selection.'
            });
            return;
        }
    }

    saveData();
    renderLists();
}


// Function to open/close folders
function toggleFolder(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (folder) {
        folder.isOpen = !folder.isOpen;
        saveData();
        renderLists();
    }
}


async function createFolder() {
    const name = await showPromptModal({
        title: 'New Folder',
        message: 'Enter folder name:',
        confirmText: 'Create',
        inputPlaceholder: 'Folder name'
    });
    if (!name) return;
    
    const newFolder = {
        id: 'f' + Date.now().toString(), // Adding 'f' prefix for folder IDs
        name: name,
        isOpen: true
    };
    
    if (!appData.folders) appData.folders = [];
    appData.folders.push(newFolder);
    
    saveData();
    renderLists();
}


async function deleteList(listId) {
    const shouldDelete = await showConfirmModal({
        title: 'Delete List',
        message: 'Delete this list and all its tasks?',
        confirmText: 'Delete'
    });
    if (!shouldDelete) return;

    // Remove all tasks that belong to this list
    appData.tasks = appData.tasks.filter(t => t.listId !== listId);

    // Remove the list itself
    appData.lists = appData.lists.filter(l => l.id !== listId);

    // If we were on this list, pick a new active list or go to dashboard
    if (appData.activeListId === listId) {
        if (appData.lists.length > 0) {
            appData.activeListId = appData.lists[0].id;
        } else {
            appData.activeListId = 'dashboard';
        }
    }

    saveData();
    renderLists();
    refreshView();
}


// --- TASK RENDERING (REFACTORED) ---

function getSortedTasksForActiveList() {
    const statusRank = {
        'Important': 1,
        'Active': 2,
        'Structure': 3,
        'Conservation': 4,
        'Inactive': 5,
        'Done': 6
    };

    return appData.tasks
        .filter(t => t.listId === appData.activeListId)
        .filter(matchesTaskSearch)
        .sort((a, b) => {
            // 1) Status group
            const rankA = statusRank[a.status] || 99;
            const rankB = statusRank[b.status] || 99;
            if (rankA !== rankB) return rankA - rankB;

            // 2) Priority inside that status
            const prioA = getPriorityRank(a.priority);
            const prioB = getPriorityRank(b.priority);
            if (prioA !== prioB) return prioA - prioB;

            // 3) Due date: oldest first, tasks without date go last
            const dateA = a.dueDate || '';
            const dateB = b.dueDate || '';

            if (dateA && dateB && dateA !== dateB) {
                return dateA.localeCompare(dateB); // YYYY-MM-DD works lexicographically
            }
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;

            // 4) If both missing or identical dueDate, keep relative order
            return 0;
        });
}


function createGroupHeader(status) {
    const header = document.createElement('div');
    header.className = 'group-header';
    const tasksInGroup = appData.tasks.filter(
        t => t.listId === appData.activeListId && t.status === status && matchesTaskSearch(t)
    );
    const totalMinutes = tasksInGroup.reduce(
        (sum, task) => sum + (parseTimeEstimate(task.timeEstimate) || 0),
        0
    );
    const timeString = formatMinutesToTime(totalMinutes);
    const totalTimeHtml = timeString
        ? `<span class="group-total-time">Total: ${timeString}</span>`
        : '';

    let bulkCheckboxHtml = '';

    if (bulkMode) {
        // All tasks in this list + status group
        const allSelected =
            tasksInGroup.length > 0 &&
            tasksInGroup.every(t => bulkSelection.has(t.id));

        bulkCheckboxHtml = `
            <input type="checkbox"
                   class="bulk-select-checkbox bulk-header-checkbox"
                   ${allSelected ? 'checked' : ''}
                   onclick="event.stopPropagation(); toggleBulkSelectByStatus('${status}')">
        `;
    }

    header.innerHTML = `
        ${bulkCheckboxHtml}
        <i class="fa-solid fa-chevron-down"></i>
        <span class="group-label" style="background-color:${getStatusColor(status)}">
            ${status}
        </span>
        ${totalTimeHtml}
        <span class="group-line"></span>
    `;
    return header;
}


function createTaskRow(task) {
    const taskDiv = document.createElement('div');
    const isDone = task.status === 'Done';
    const isBulkSelected = bulkMode && bulkSelection.has(task.id);
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const isExpanded = !!task.isExpanded;
    const showSubtaskPanel = subtasks.length > 0 && isExpanded;
    const subtaskPanelClass = showSubtaskPanel ? 'subtasks-panel' : 'subtasks-panel hidden';
    const showSubtaskToggle = subtasks.length > 0;
    const subtaskToggleHtml = showSubtaskToggle
        ? `
            <button class="subtask-toggle-btn"
                    onclick="event.stopPropagation(); toggleTaskExpanded('${task.id}')"
                    title="${isExpanded ? 'Hide subtasks' : 'Show subtasks'}">
                <i class="fa-solid fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
            </button>
        `
        : '<span class="subtask-toggle-spacer"></span>';

    taskDiv.className = `task-item ${isDone ? 'task-completed' : ''} ${isBulkSelected ? 'task-selected' : ''}`;
    taskDiv.setAttribute('data-id', task.id);

    // Make row draggable
    taskDiv.draggable = true;
    taskDiv.ondragstart = (e) => handleDragStart(e, task.id);

    const dateText = formatDate(task.dueDate);

    // ----- DATE COLOR LOGIC -----
    let dateClass = '';
    if (task.dueDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const target = new Date(task.dueDate + 'T00:00:00');
        const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            dateClass = 'date-overdue';      // overdue
        } else if (diffDays === 0) {
            dateClass = 'date-today';        // today
        } else if (diffDays === 1) {
            dateClass = 'date-tomorrow';     // tomorrow
            // future dates keep default color (no extra class)
        }
    }

    const recurrenceSummary = getRecurrenceSummary(task.recurrence, task.dueDate, task);
    const recurrenceIcon = isRecurringTask(task)
        ? `<span class="task-meta-item is-recurring" title="${escapeHtml(recurrenceSummary)}">
                <i class="fa-solid fa-arrows-rotate"></i>
           </span>`
        : '';
    const hasNotes = hasTaskNotesContent(task);
    const hasChecklistItems = Array.isArray(task.checklist) && task.checklist.length > 0;
    const subtaskCount = subtasks.length;
    const checklistStats = getChecklistStats(task);
    const subtaskCountHtml = subtaskCount > 0
        ? `<span class="task-meta-item" title="${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}">
                <i class="fa-solid fa-code-branch"></i>
                <span>${subtaskCount}</span>
           </span>`
        : '';
    const checklistCountHtml = checklistStats.total > 0
        ? `<span class="task-meta-item" title="${checklistStats.completed} of ${checklistStats.total} checklist items completed">
                <i class="fa-solid fa-list-check"></i>
                <span>${checklistStats.completed}/${checklistStats.total}</span>
           </span>`
        : '';
    const taskMetaHtml = recurrenceIcon || subtaskCountHtml || checklistCountHtml
        ? `<span class="task-meta">${recurrenceIcon}${subtaskCountHtml}${checklistCountHtml}</span>`
        : '';
    taskDiv.innerHTML = `
        <div class="task-name-col">
            ${subtaskToggleHtml}

            <input type="checkbox"
                   class="bulk-select-checkbox"
                   ${isBulkSelected ? 'checked' : ''}
                   onclick="event.stopPropagation(); toggleBulkSelection('${task.id}')">

            <input type="checkbox" class="task-checkbox" ${isDone ? 'checked' : ''} 
                   onchange="toggleTaskComplete('${task.id}')">

            ${renderStatusDropdown(task)}

            <span class="task-text" onclick="editTaskText('${task.id}')">
                <span class="task-title">${escapeHtml(task.text)}</span>
                ${taskMetaHtml}
            </span>

            <button class="task-edit-btn" onclick="openModal('${task.id}')">
                <i class="fa-solid fa-pen"></i>
            </button>

            <button class="task-edit-btn task-notes-btn ${hasNotes ? 'has-notes' : ''}"
                    onclick="openNotesModal('${task.id}')"
                    title="Task notes">
                <i class="fa-regular fa-note-sticky"></i>
            </button>

            <button class="task-edit-btn task-checklist-btn ${hasChecklistItems ? 'has-items' : ''}"
                    onclick="openChecklistModal('${task.id}')"
                    title="Task checklist">
                <i class="fa-solid fa-list-check"></i>
            </button>

            <button class="task-edit-btn" onclick="addSubtask('${task.id}')" title="Add subtask">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>

        <div class="col-center">
            ${renderPriorityDropdown(task)}
        </div>

        <div class="col-center">
            <input type="text" class="inline-input" 
                   value="${task.timeEstimate || ''}" 
                   placeholder="-"
                   onchange="saveTimeEstimate('${task.id}', this.value)">
        </div>

        <div class="col-center" id="date-container-${task.id}" 
             data-date="${task.dueDate || ''}" 
             onclick="editDate('${task.id}')">
            <span class="date-text ${dateClass}">${dateText}</span>
        </div>

        <div class="col-center" style="justify-content: flex-end;">
            <button onclick="deleteTask('${task.id}')"
                    style="border:none; background:none; color:#ddd; cursor:pointer;">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>

        ${subtasks.length > 0 ? `
            <div class="${subtaskPanelClass}">
                <div class="subtasks-list">
                    ${subtasks.map(subtask => `
                        <div class="subtask-item ${subtask.done ? 'subtask-done' : ''}">
                            <input type="checkbox"
                                   ${subtask.done ? 'checked' : ''}
                                   onchange="toggleSubtaskDone('${task.id}', '${subtask.id}')">
                            <button class="subtask-text-btn"
                                    onclick="editSubtask('${task.id}', '${subtask.id}')"
                                    title="Edit subtask">
                                ${subtask.text}
                            </button>
                            <button class="subtask-delete-btn"
                                    onclick="deleteSubtask('${task.id}', '${subtask.id}')"
                                    title="Delete subtask">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `;

    return taskDiv;
}


function renderTasks() {
    const container = document.getElementById('tasks-container');
    container.innerHTML = '';

    const tasksToRender = getSortedTasksForActiveList();
    let lastStatus = null;

    tasksToRender.forEach(task => {
        if (task.status !== lastStatus) {
            container.appendChild(createGroupHeader(task.status));
            lastStatus = task.status;
        }

        container.appendChild(createTaskRow(task));
    });
}

// --- BULK MODE HELPERS ---

function toggleBulkMode() {
    bulkMode = !bulkMode;
    bulkSelection.clear();

    // Visual state on the button
    const bulkBtn = document.getElementById('bulk-mode-toggle');
    if (bulkBtn) {
        bulkBtn.classList.toggle('active', bulkMode);
    }

    // Body class for CSS
    document.body.classList.toggle('bulk-mode-on', bulkMode);

    updateBulkActionsBar();
    refreshView();
}

function toggleBulkSelection(taskId) {
    if (!bulkMode) return;

    if (bulkSelection.has(taskId)) {
        bulkSelection.delete(taskId);
    } else {
        bulkSelection.add(taskId);
    }

    updateBulkActionsBar();
    refreshView();
}

function clearBulkSelection() {
    bulkSelection.clear();
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulk-actions-bar');
    const countSpan = document.getElementById('bulk-count');

    if (!bar || !countSpan) return;

    if (bulkMode && bulkSelection.size > 0) {
        bar.classList.remove('hidden');
        countSpan.textContent = `${bulkSelection.size} selected`;
    } else {
        bar.classList.add('hidden');
        countSpan.textContent = '';
    }
}

async function bulkDeleteSelectedTasks() {
    if (!bulkMode || bulkSelection.size === 0) return;

    const count = bulkSelection.size;
    const shouldDelete = await showConfirmModal({
        title: 'Delete Tasks',
        message: `Delete ${count} selected task${count === 1 ? '' : 's'}?`,
        confirmText: 'Delete'
    });
    if (!shouldDelete) {
        return;
    }

    appData.tasks = appData.tasks.filter(t => !bulkSelection.has(t.id));
    saveData();

    clearBulkSelection();
    refreshView();
}

async function bulkMoveSelectedTasks() {
    if (!bulkMode || bulkSelection.size === 0) return;

    const availableLists = appData.lists.filter(l => l.id !== appData.activeListId);
    if (availableLists.length === 0) {
        await showAlertModal({
            title: 'No Other Lists',
            message: 'Create another list first to move selected tasks.'
        });
        return;
    }

    const listOptions = availableLists.map((list, index) => `${index + 1}. ${list.name}`).join('\n');
    const choice = await showPromptModal({
        title: 'Move Selected Tasks',
        message: `Choose a destination list:\n\n${listOptions}`,
        confirmText: 'Move',
        inputPlaceholder: 'List number'
    });

    if (choice === null) return;

    const selectedList = availableLists[parseInt(choice, 10) - 1];
    if (!selectedList) {
        await showAlertModal({
            title: 'Invalid Selection',
            message: 'Please enter a valid list number.'
        });
        return;
    }

    appData.tasks.forEach(task => {
        if (bulkSelection.has(task.id)) {
            task.listId = selectedList.id;
        }
    });

    saveData();
    clearBulkSelection();
    refreshView();
}

async function bulkCopySelectedTasks() {
    if (!bulkMode || bulkSelection.size === 0) return;

    const selectedText = appData.tasks
        .filter(task => bulkSelection.has(task.id))
        .map(task => task.text)
        .join('\n');

    if (!selectedText) return;

    try {
        await navigator.clipboard.writeText(selectedText);
        await showAlertModal({
            title: 'Copied',
            message: 'Selected task text copied to clipboard.'
        });
    } catch (error) {
        await showAlertModal({
            title: 'Copy Failed',
            message: 'Could not copy selected task text to the clipboard.'
        });
    }
}

function bulkApplySelectedStatus(nextStatus) {
    if (!bulkMode || bulkSelection.size === 0) return;
    if (!STATUS_VALUES.includes(nextStatus) || nextStatus === 'Done') return;

    appData.tasks.forEach(task => {
        if (bulkSelection.has(task.id)) {
            task.status = nextStatus;
        }
    });

    saveData();
    clearBulkSelection();
    refreshView();
}

function openBulkDatePicker() {
    if (!bulkMode || bulkSelection.size === 0) return;

    const panel = document.getElementById('shared-date-picker');
    if (!panel) return;

    if (!panel.classList.contains('hidden') && activeDatePickerContext === 'bulk') {
        closeBulkDatePicker();
        return;
    }

    openSharedDatePicker('bulk', 'bulk-date-trigger');
}

function closeBulkDatePicker() {
    closeModalDatePicker();
}

function bulkApplySelectedDate(nextDate) {
    if (!bulkMode || bulkSelection.size === 0 || !nextDate) return;

    appData.tasks.forEach(task => {
        if (bulkSelection.has(task.id)) {
            task.dueDate = nextDate;
        }
    });

    saveData();
    clearBulkSelection();
    closeBulkDatePicker();
    refreshView();
}

function toggleBulkSelectByStatus(status) {
    if (!bulkMode) return;

    const tasksInGroup = appData.tasks.filter(
        t => t.listId === appData.activeListId && t.status === status
    );
    if (tasksInGroup.length === 0) return;

    const allAlreadySelected = tasksInGroup.every(t => bulkSelection.has(t.id));

    if (allAlreadySelected) {
        // Deselect all tasks in this group
        tasksInGroup.forEach(t => bulkSelection.delete(t.id));
    } else {
        // Select all tasks in this group
        tasksInGroup.forEach(t => bulkSelection.add(t.id));
    }

    updateBulkActionsBar();
    refreshView();
}

function toggleBulkSelectForSection(sectionKey) {
    if (!bulkMode) return;

    const now = new Date();
    const todayStr =
        now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
    const todayDate = new Date(todayStr + 'T00:00:00');

    let tasksInSection = [];

    if (sectionKey === 'overdue') {
        tasksInSection = appData.tasks.filter(
            t =>
                t.dueDate &&
                new Date(t.dueDate + 'T00:00:00') < todayDate &&
                t.status !== 'Done'
        );
    } else if (sectionKey.startsWith('day:')) {
        const dateStr = sectionKey.slice(4);
        tasksInSection = appData.tasks.filter(
            t => t.dueDate === dateStr && t.status !== 'Done'
        );
    } else if (sectionKey.startsWith('date:')) {
        const dateStr = sectionKey.slice(5);
        tasksInSection = appData.tasks.filter(
            t => t.dueDate === dateStr && t.status !== 'Done'
        );
    }

    if (tasksInSection.length === 0) return;

    const allAlreadySelected = tasksInSection.every(t => bulkSelection.has(t.id));

    if (allAlreadySelected) {
        tasksInSection.forEach(t => bulkSelection.delete(t.id));
    } else {
        tasksInSection.forEach(t => bulkSelection.add(t.id));
    }

    updateBulkActionsBar();
    refreshView();
}


// --- DELETE + STORAGE ---

async function deleteTask(taskId) {
    const shouldDelete = await showConfirmModal({
        title: 'Delete Task',
        message: 'Delete this task?',
        confirmText: 'Delete'
    });
    if (!shouldDelete) return;

    appData.tasks = appData.tasks.filter(t => t.id !== taskId);

    // If it was part of a bulk selection, keep things in sync
    if (bulkSelection && bulkSelection.has(taskId)) {
        bulkSelection.delete(taskId);
        updateBulkActionsBar();
    }

    saveData();
    refreshView();
}


// Replace your existing saveData to also update UI elements
function saveData() {
    saveAppData(appData).catch(error => {
        console.warn('Unable to complete app save.', error);
    });
    updateOverdueBadge();
}

// Create this helper to refresh whatever view is currently active
function refreshView() {
    if (appData.activeListId === 'dashboard') {
        // Find which tab is active (Day or Week)
        const activeTab = document.querySelector('.tab-btn.active').innerText.toLowerCase();
        renderDashboard(activeTab);
    } else {
        renderTasks();
    }
    renderLists();
}

async function loadData() {
    appData = await loadAppData();
}

// --- TIME HELPERS ---

function parseTimeEstimate(input) {
    if (!input) return 0;
    input = input.toLowerCase().replace(/\s/g, '');

    let totalMinutes = 0;

    const hours = input.match(/(\d+(\.\d+)?)h/);
    if (hours) {
        totalMinutes += parseFloat(hours[1]) * 60;
    }

    const minutes = input.match(/(\d+)m/);
    if (minutes) {
        totalMinutes += parseInt(minutes[1]);
    }

    if (!hours && !minutes && !isNaN(input)) {
        totalMinutes = parseInt(input);
    }

    return totalMinutes;
}

function formatMinutesToTime(totalMinutes) {
    if (!totalMinutes || totalMinutes === 0) return '';

    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function saveTimeEstimate(taskId, value) {
    const minutes = parseTimeEstimate(value);
    const cleanText = formatMinutesToTime(minutes);
    updateTaskProperty(taskId, 'timeEstimate', cleanText);
}

// --- INLINE TASK TEXT EDITING ---

function editTaskText(taskId) {
    const task = appData.tasks.find(t => t.id === taskId);
    const textElement = document.querySelector(`[data-id="${taskId}"] .task-text`);

    if (!task || !textElement) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    input.style.fontSize = '15px';
    input.style.fontWeight = '400';
    input.value = task.text;

    input.onblur = function () {
        const newText = this.value.trim();
        if (newText !== "") {
            updateTaskProperty(taskId, 'text', newText);
        } else {
            refreshView();
        }
    };

    input.onkeypress = function (e) {
        if (e.key === 'Enter') this.blur();
    };

    textElement.replaceWith(input);
    input.focus();
}

function handleDragStart(event, taskId) {
    event.dataTransfer.setData("taskId", taskId);
    // Visual feedback: make the row slightly transparent while dragging
    event.target.style.opacity = "0.4";
    
    // Reset opacity after a short delay so the "ghost" image isn't transparent
    setTimeout(() => { event.target.style.opacity = "1"; }, 0);
}

function handleDrop(event, targetListId) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("taskId");
    
    const task = appData.tasks.find(t => t.id === taskId);
    if (task && task.listId !== targetListId) {
        task.listId = targetListId;
        saveData();
        refreshView(); // Refresh the current list view
        renderLists(); // Update the counts in the sidebar
    }
}

// --- DASHBOARD LOGIC ---

function showDashboard() {
    appData.activeListId = 'dashboard';
    const titleEl = document.getElementById('current-list-title');
    titleEl.classList.add('dashboard-title');
    titleEl.innerHTML = '<img src="favicon.svg" alt="Stoa" class="stoa-header-logo">';
    document.querySelector('.top-bar')?.classList.add('dashboard-home');
    
    // UI Toggles
    document.getElementById('dashboard-tabs').classList.remove('hidden');
    document.getElementById('task-input-section').classList.add('hidden');
    document.getElementById('nav-home').classList.add('active');
    
    renderLists(); // Refresh sidebar to show active state
    renderDashboard('day');
}

function renderDashboard(viewType) {
    const container = document.getElementById('tasks-container');
    container.innerHTML = '';
    
    document.getElementById('tab-day').classList.toggle('active', viewType === 'day');
    document.getElementById('tab-tomorrow').classList.toggle('active', viewType === 'tomorrow');
    document.getElementById('tab-week').classList.toggle('active', viewType === 'week');

    // Local YYYY-MM-DD for "today"
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + 
                     String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(now.getDate()).padStart(2, '0');
    const todayDate = new Date(todayStr + 'T00:00:00');
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(todayDate.getDate() + 1);
    const tomorrowStr =
        tomorrowDate.getFullYear() + '-' +
        String(tomorrowDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(tomorrowDate.getDate()).padStart(2, '0');

    if (viewType === 'day') {
        const overdue = appData.tasks.filter(
            t => t.dueDate &&
                 new Date(t.dueDate + 'T00:00:00') < todayDate &&
                 t.status !== 'Done' &&
                 matchesTaskSearch(t)
        );
        const dueToday = appData.tasks.filter(
            t => t.dueDate === todayStr &&
                 t.status !== 'Done' &&
                 matchesTaskSearch(t)
        );

renderDashboardSection(container, 'Overdue', overdue, true, 'overdue');
renderDashboardSection(container, 'Today', dueToday, false, 'day:' + todayStr);
    } else if (viewType === 'tomorrow') {
        const dueTomorrow = appData.tasks.filter(
            t => t.dueDate === tomorrowStr &&
                 t.status !== 'Done' &&
                 matchesTaskSearch(t)
        );

        renderDashboardSection(container, 'Tomorrow', dueTomorrow, false, 'day:' + tomorrowStr);
    } else {
        renderWeekView(container, todayDate);
    }
}

function renderDashboardSection(container, title, tasks, isOverdue, sectionKey) {
    if (tasks.length === 0 && !isOverdue) return; // Hide empty non-overdue sections

    // Within a dashboard date bucket, keep tasks ordered by picker priority sequence.
    // Overdue can still span multiple dates, so use due date as a secondary key there.
    const sortedTasks = [...tasks].sort((a, b) => {
        const prioA = getPriorityRank(a.priority);
        const prioB = getPriorityRank(b.priority);
        if (prioA !== prioB) return prioA - prioB;

        const dateA = a.dueDate || '';
        const dateB = b.dueDate || '';

        if (dateA && dateB && dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }
        if (dateA && !dateB) return -1;
        if (!dateA && dateB) return 1;
        return 0; // same or both empty → keep relative order
    });

    // Total time for this group
    const totalMinutes = sortedTasks.reduce(
        (sum, t) => sum + (parseTimeEstimate(t.timeEstimate) || 0),
        0
    );
    const timeString = formatMinutesToTime(totalMinutes);

    // Fallback key if older calls do not pass one
    if (!sectionKey) {
        sectionKey = isOverdue ? 'overdue' : title.toLowerCase();
    }

    const allSectionSelected =
        bulkMode &&
        sortedTasks.length > 0 &&
        sortedTasks.every(t => bulkSelection.has(t.id));

    const headerCheckboxHtml =
        bulkMode && sortedTasks.length > 0
            ? `
                <input type="checkbox"
                       class="bulk-select-checkbox section-bulk-checkbox"
                       ${allSectionSelected ? 'checked' : ''}
                       onclick="event.stopPropagation(); toggleBulkSelectForSection('${sectionKey}')">
              `
            : '';

    const sectionWrap = document.createElement('div');
    sectionWrap.className = 'dashboard-section';
    
    sectionWrap.innerHTML = `
        <div class="section-header ${isOverdue ? 'overdue' : ''}">
            <div class="section-title">
                ${headerCheckboxHtml}
                <i class="fa-solid fa-chevron-down"></i> ${title} 
                <span class="count-badge">${sortedTasks.length}</span>
                ${timeString ? `<span class="section-total-time">Total: ${timeString}</span>` : ''}
            </div>
        </div>
        <div class="section-content"></div>
    `;

    const contentArea = sectionWrap.querySelector('.section-content');
    if (sortedTasks.length === 0) {
        contentArea.innerHTML = `<div class="empty-state">No ${title.toLowerCase()} tasks!</div>`;
    } else {
        sortedTasks.forEach(task => contentArea.appendChild(createTaskRow(task)));
    }

    container.appendChild(sectionWrap);
}


function renderWeekView(container, startDate) {
    for (let i = 0; i < 7; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);

        const dateString = date.toISOString().split('T')[0];

        // Tasks due on this specific calendar day, excluding Done
        const dayTasks = appData.tasks.filter(
            t => t.dueDate === dateString &&
                 t.status !== 'Done' &&
                 matchesTaskSearch(t)
        );

        // Label for that day
        let title = '';
        if (i === 0) {
            title = 'Today';
        } else if (i === 1) {
            title = 'Tomorrow';
        } else {
            title = date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
            });
        }

        // This call will show:
        // - the day name
        // - the count badge
        // - "Total: Xh Ym" for that day's tasks
        renderDashboardSection(container, title, dayTasks, false, 'date:' + dateString);
    }
}

// Update the Badge in Sidebar
function updateOverdueBadge() {
    const now = new Date();
    const todayStr =
        now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

    const overdueCount = appData.tasks.filter(t => {
        return t.status !== 'Done'
            && t.dueDate
            && t.dueDate < todayStr; // strictly before today
    }).length;

    const badge = document.getElementById('overdue-badge');
    if (overdueCount > 0) {
        badge.innerText = overdueCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

let contextMenuTarget = { type: null, id: null };

function handleContextMenu(e, type, id) {
    e.preventDefault();
    contextMenuTarget = { type, id };

    const menu = document.getElementById('context-menu');
    const moveOption = document.getElementById('move-option');

    // Only show "Move to Folder" if we right-clicked a LIST
    if (type === 'list') {
        moveOption.style.display = 'flex';
    } else {
        moveOption.style.display = 'none';
    }

    menu.classList.remove('hidden');
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;

    document.addEventListener('click', () => menu.classList.add('hidden'), { once: true });
}

async function renameItem() {
    const { type, id } = contextMenuTarget;
    let item;
    
    if (type === 'folder') {
        item = appData.folders.find(f => f.id === id);
    } else {
        item = appData.lists.find(l => l.id === id);
    }

    if (!item) return;

    const newName = await showPromptModal({
        title: `Rename ${type === 'folder' ? 'Folder' : 'List'}`,
        message: `Rename ${type}:`,
        confirmText: 'Save',
        inputPlaceholder: 'Name',
        initialValue: item.name
    });
    if (newName && newName.trim() !== "") {
        item.name = newName.trim();
        saveData();
        renderLists();
        
        // If it's the active list, update the header title
        if (type === 'list' && appData.activeListId === id) {
            document.getElementById('current-list-title').innerText = newName;
        }
    }
}

async function deleteItem() {
    const { type, id } = contextMenuTarget;

    if (type === 'folder') {
        const shouldDelete = await showConfirmModal({
            title: 'Delete Folder',
            message: 'Are you sure you want to delete this folder?',
            confirmText: 'Delete'
        });
        if (!shouldDelete) return;

        // 1. Remove the folder
        appData.folders = appData.folders.filter(f => f.id !== id);

        // 2. Move any lists inside this folder to "Standalone" (null folderId)
        appData.lists.forEach(l => {
            if (l.folderId === id) l.folderId = null;
        });

        saveData();
        renderLists();
    } else if (type === 'list') {
        // Let deleteList handle confirmation and UI updates
        deleteList(id);
    }
}

// --- COLLAPSIBLE GROUPS & SECTIONS ---

// Global click handler: recurrence pills + collapsible groups/sections
document.addEventListener('click', (e) => {
    // 1) Recurrence day pills
    if (e.target.classList.contains('day-pill')) {
        e.target.classList.toggle('selected');
        return; // Stop here so we do not also treat it as a header click
    }

    // 2) Collapse/expand status groups inside lists
    const groupHeader = e.target.closest('.group-header');
    if (groupHeader) {
        const isCollapsed = groupHeader.classList.toggle('collapsed');

        // Hide or show all task rows until the next group-header
        let sibling = groupHeader.nextElementSibling;
        while (sibling && !sibling.classList.contains('group-header')) {
            if (sibling.classList.contains('task-item')) {
                sibling.classList.toggle('hidden', isCollapsed);
            }
            sibling = sibling.nextElementSibling;
        }
        return; // Avoid also triggering section logic
    }

    // 3) Collapse/expand dashboard sections (Overdue, Today, each day in Week tab)
    const sectionHeader = e.target.closest('.section-header');
    if (sectionHeader) {
        const section = sectionHeader.parentElement;
        const content = section.querySelector('.section-content');
        const isCollapsed = sectionHeader.classList.toggle('collapsed');

        if (content) {
            content.classList.toggle('hidden', isCollapsed);
        }
    }
});
