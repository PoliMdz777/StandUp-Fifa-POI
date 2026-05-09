// tasks_enhanced.js — VERSIÓN COMPLETA v2.0
// ✅ Tareas grupales y personales con Firestore en tiempo real
// ✅ Notificación en el chat al crear/completar
// ✅ Assignees dinámicos desde usuarios reales
// ✅ Compatible con sistema de recompensas
// ================================================================

'use strict';

// ── Estado de tareas ─────────────────────────────────────────────
let _taskCounter    = 10;
let _tasksCompleted = 0;
let _tasksUnsubscribe = null;   // para cancelar listener Firestore
const CURRENT_GROUP = 'grupo_tour';   // grupo por defecto

// ════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN — carga tareas al arrancar
// ════════════════════════════════════════════════════════════════
window.initTasks = async function() {
    await _loadTasksFromFirestore();
    _setupRealtimeListener();
    updateTaskCount();
    updateTaskAssigneeList();
    console.log('✅ Sistema de tareas iniciado');
};

// ── Cargar tareas desde Firestore ────────────────────────────────
async function _loadTasksFromFirestore() {
    if (!window.db_loadTasks) return;
    try {
        const tasks = await window.db_loadTasks(CURRENT_GROUP);
        if (tasks && tasks.length > 0) {
            const list = document.getElementById('task-list');
            if (!list) return;
            // Limpiar solo las tareas dinámicas (mantener las del HTML por defecto)
            list.querySelectorAll('.task-item[data-firestore-id]').forEach(el => el.remove());
            tasks.forEach(t => _renderTask(t, true));
            updateTaskCount();
        }
    } catch(e) {
        console.warn('⚠️ Tasks Firestore fallback:', e.message);
    }
}

// ── Listener en tiempo real ───────────────────────────────────────
function _setupRealtimeListener() {
    if (!window.db_listenTasks) return;
    if (_tasksUnsubscribe) _tasksUnsubscribe();

    _tasksUnsubscribe = window.db_listenTasks(CURRENT_GROUP, (tasks) => {
        const list = document.getElementById('task-list');
        if (!list) return;
        // Actualizar solo las que vienen de Firestore
        list.querySelectorAll('.task-item[data-firestore-id]').forEach(el => el.remove());
        tasks.forEach(t => _renderTask(t, true));
        updateTaskCount();
    });
}

// ── Renderizar una tarea en el DOM ───────────────────────────────
function _renderTask(taskData, fromFirestore = false) {
    const list = document.getElementById('task-list');
    if (!list) return;

    const id = fromFirestore ? taskData.id : taskData.localId;
    const isDone = taskData.done || false;

    // Evitar duplicados
    if (fromFirestore && list.querySelector(`[data-firestore-id="${id}"]`)) {
        const existing = list.querySelector(`[data-firestore-id="${id}"]`);
        // Actualizar estado si cambió
        const cb = existing.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = isDone;
        existing.classList.toggle('done', isDone);
        return;
    }

    const taskType = taskData.taskType || taskData.type || 'group';
    const assignee = taskData.assignee || 'Todos';
    const creator  = taskData.creator  || 'Anónimo';
    const text     = taskData.text     || taskData.label || '';
    const typeLabel = taskType === 'personal' ? '👤 Personal' : '👥 Grupal';
    const typeBadgeClass = taskType === 'personal' ? 'personal-badge' : 'group-badge';

    const item = document.createElement('div');
    item.className = `task-item${isDone ? ' done' : ''}`;
    item.dataset.id = id;
    if (fromFirestore) item.dataset.firestoreId = id;

    item.innerHTML = `
        <div class="task-check-wrap">
            <input type="checkbox" id="task-cb-${id}" ${isDone ? 'checked' : ''}
                onchange="toggleTask('${id}', this, ${fromFirestore})">
            <label for="task-cb-${id}" class="task-label">${escHtml ? escHtml(text) : text}</label>
        </div>
        <div class="task-meta">
            <span class="task-type-badge ${typeBadgeClass}">
                ${typeLabel}
            </span>
            <span class="task-assignee-badge">
                <i class="fas fa-user"></i> ${escHtml ? escHtml(assignee) : assignee}
            </span>
            <button class="task-del" onclick="deleteTask('${id}', ${fromFirestore})"
                title="Eliminar tarea">
                <i class="fas fa-trash"></i>
            </button>
        </div>`;

    list.appendChild(item);
}

// ════════════════════════════════════════════════════════════════
//  FUNCIONES PÚBLICAS — reemplaza las del app.js original
// ════════════════════════════════════════════════════════════════

// ── Agregar tarea ────────────────────────────────────────────────
window.addTask = async function() {
    const input    = document.getElementById('new-task-input');
    const typeEl   = document.getElementById('task-type');
    const assignEl = document.getElementById('task-assignee');

    const text     = input?.value.trim();
    const taskType = typeEl?.value  || 'group';
    const assignee = assignEl?.value || 'Todos';

    if (!text) {
        if (typeof showToast === 'function') showToast('Escribe el nombre de la tarea', 'error');
        return;
    }

    _taskCounter++;
    const localId = String(_taskCounter);
    const time    = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    // Optimistic UI — mostrar inmediatamente
    _renderTask({ id: localId, text, taskType, assignee, done: false }, false);
    if (input) input.value = '';
    updateTaskCount();

    // Guardar en Firestore
    let firestoreId = null;
    if (window.db_saveTask) {
        firestoreId = await window.db_saveTask(CURRENT_GROUP, {
            text,
            taskType,
            assignee,
            creator: (window.currentUser?.name) || 'Anónimo',
            done:    false
        });
    }

    // Notificar en el chat grupal vía Socket.io
    if (window.socket?.connected) {
        window.socket.emit('send_group_message', {
            groupId:  CURRENT_GROUP,
            senderId: window.currentUser?.name || 'Sistema',
            message:  `📋 Nueva tarea: "${text}" → ${assignee}`,
            type:     'text',
            time
        });
        // Emitir evento de tarea
        window.socket.emit('task_created', {
            groupId:     CURRENT_GROUP,
            text,
            taskType,
            assignee,
            senderId:    window.currentUser?.name,
            firestoreId: firestoreId || localId
        });
    }

    // Recompensas: crear una tarea = +25 pts
    if (typeof awardPoints === 'function') {
        awardPoints(25, 'Creaste una tarea grupal');
    }

    // Badge de notificación en la pestaña de tareas
    const tasksSection = document.getElementById('tasks-section');
    if (tasksSection?.style.display === 'none') {
        const badge = document.getElementById('tasks-notif');
        if (badge) {
            badge.style.display = 'flex';
            badge.textContent = String((parseInt(badge.textContent) || 0) + 1);
        }
    }

    if (typeof showToast === 'function') showToast('✅ Tarea agregada al grupo', 'success');
};

// ── Marcar tarea como completada / incompleta ────────────────────
window.toggleTask = async function(id, checkbox, fromFirestore = false) {
    const item = document.querySelector(
        fromFirestore ? `[data-firestore-id="${id}"]` : `[data-id="${id}"]`
    );
    if (!item) return;

    const isDone = checkbox.checked;
    item.classList.toggle('done', isDone);
    updateTaskCount();

    if (isDone) {
        _tasksCompleted++;
        if (typeof showToast === 'function') showToast('🎉 ¡Tarea completada!', 'success');

        // Recompensas: completar tarea = +75 pts
        if (typeof awardPoints === 'function') {
            awardPoints(75, 'Completaste una tarea');
        }

        // Logro al completar 3+ tareas
        if (_tasksCompleted >= 3) {
            document.getElementById('badge-tasks')?.classList.add('unlocked');
        }

        // Notificar via Socket.io
        const label = item.querySelector('.task-label')?.textContent || '';
        if (window.socket?.connected) {
            window.socket.emit('send_group_message', {
                groupId:  CURRENT_GROUP,
                senderId: window.currentUser?.name || 'Sistema',
                message:  `✅ Tarea completada: "${label}" por ${window.currentUser?.name || 'alguien'}`,
                type:     'text',
                time:     new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
            });
        }

        // Actualizar en Firestore
        if (fromFirestore && window.db_completeTask) {
            await window.db_completeTask(id, window.currentUser?.name);
        }
    }
};

// ── Eliminar tarea ───────────────────────────────────────────────
window.deleteTask = function(id, fromFirestore = false) {
    const sel  = fromFirestore ? `[data-firestore-id="${id}"]` : `[data-id="${id}"]`;
    const item = document.querySelector(sel);
    if (!item) return;

    item.style.transition = 'all .2s';
    item.style.opacity    = '0';
    item.style.transform  = 'translateX(20px)';

    setTimeout(() => {
        item.remove();
        updateTaskCount();
    }, 200);

    // Eliminar de Firestore
    if (fromFirestore && window.db_deleteTask) {
        window.db_deleteTask(id);
    }
};

// ── Actualizar contador de tareas ────────────────────────────────
window.updateTaskCount = function() {
    const all  = document.querySelectorAll('.task-item').length;
    const done = document.querySelectorAll('.task-item.done').length;
    const el   = document.getElementById('task-count');
    if (el) el.textContent = `${done} de ${all} completadas`;
};

// ── Actualizar lista de assignees ────────────────────────────────
window.updateTaskAssigneeList = function() {
    const sel = document.getElementById('task-assignee');
    if (!sel) return;

    // Mantener "Todos" como primera opción
    const current = sel.value;
    sel.innerHTML = '<option value="">Todos</option>';

    // Agregar usuario actual
    if (window.currentUser?.name) {
        const opt = document.createElement('option');
        opt.value = window.currentUser.name;
        opt.textContent = window.currentUser.name + ' (yo)';
        sel.appendChild(opt);
    }

    // Agregar usuarios de Firestore si están disponibles
    if (window.allDBUsers && window.allDBUsers.length > 0) {
        window.allDBUsers.forEach(u => {
            if (u.name === window.currentUser?.name) return;
            const opt = document.createElement('option');
            opt.value = u.name;
            opt.textContent = u.name;
            sel.appendChild(opt);
        });
    } else {
        // Fallback estático
        ['Turista 23', 'Guía Carlos', 'María González'].forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    }

    // Restaurar selección si es posible
    if (current) sel.value = current;
};

// ════════════════════════════════════════════════════════════════
//  FUNCIONES ADICIONALES EN FIRESTORE (añadir a firestore_integration.js)
// ════════════════════════════════════════════════════════════════

// Estas funciones deben existir en firestore_integration.js.
// Si no las tienes, se usan aquí como stubs con localStorage.

if (!window.db_loadTasks) {
    window.db_loadTasks = async function(groupId) {
        try {
            const stored = JSON.parse(localStorage.getItem(`tasks_${groupId}`) || '[]');
            return stored;
        } catch(e) { return []; }
    };
}

if (!window.db_listenTasks) {
    window.db_listenTasks = function(groupId, callback) {
        // Fallback: load once from localStorage
        const stored = JSON.parse(localStorage.getItem(`tasks_${groupId}`) || '[]');
        callback(stored);
        return () => {}; // unsubscribe no-op
    };
}

if (!window.db_deleteTask) {
    window.db_deleteTask = function(taskId) {
        console.log('db_deleteTask no implementado en Firestore, ignorando:', taskId);
    };
}

// Escuchar tareas de otros usuarios via Socket.io
if (window.socket) {
    window.socket.on('task_created', (data) => {
        if (data.senderId === window.currentUser?.name) return; // ya lo mostramos
        _renderTask({
            id:       data.firestoreId || String(Date.now()),
            text:     data.text,
            taskType: data.taskType || 'group',
            assignee: data.assignee,
            done:     false
        }, false);
        updateTaskCount();
        if (typeof showToast === 'function') {
            showToast(`📋 ${data.senderId} agregó: "${data.text}"`, 'info');
        }
    });
} else {
    // Si socket no está listo, esperar
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.socket) {
                window.socket.on('task_created', (data) => {
                    if (data.senderId === window.currentUser?.name) return;
                    _renderTask({
                        id:       data.firestoreId || String(Date.now()),
                        text:     data.text,
                        taskType: data.taskType || 'group',
                        assignee: data.assignee,
                        done:     false
                    }, false);
                    updateTaskCount();
                });
            }
        }, 2000);
    });
}

// ── Auto-init cuando el DOM esté listo ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof window.initTasks === 'function') window.initTasks();
    }, 1500); // Esperar a que Firestore cargue
});

console.log('📋 tasks_enhanced.js v2.0 cargado');
