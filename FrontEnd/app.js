// ════════════════════════════════════════════════════════
//  FIFA 2026 Tourist Hub — app.js
//  Funcionalidad completa: Chat, Videollamada, Tareas,
//  Recompensas, Grupos, Archivos, Ubicación
// Lógica completa: gestión de sesión, Socket.io, tareas (agregar/completar/eliminar),
//  sistema de puntos y niveles que se actualiza en tiempo real, seguridad HTML (escape), y 
// conexión de todas las pantallas entre sí.
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
//  FIFA 2026 Tourist Hub — app.js  v2.0
//  Includes: Profile edit, Email, localStorage persistence,
//  Offline message queue, Real-time status, Responsive,
//  Per-chat badges, Video call, File sharing, Location
// ════════════════════════════════════════════════════════

'use strict';

// ══════════════════════════════════════════════════════════
//  GUARD DE SESIÓN — Si no hay usuario autenticado, ir al login
// ══════════════════════════════════════════════════════════
(function checkSession() {
    const ss = sessionStorage.getItem('fifa_user');
    const ls = localStorage.getItem('fifa_user_persist');
    const raw = ss || ls;

    if (!raw) {
        // Sin sesión → redirigir al login
        window.location.replace('login.html');
        throw new Error('Sin sesión — redirigiendo a login');
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.name) throw new Error('Datos de sesión inválidos');
        // Si vino de localStorage, sincronizar a sessionStorage
        if (!ss) sessionStorage.setItem('fifa_user', raw);
    } catch(e) {
        sessionStorage.removeItem('fifa_user');
        localStorage.removeItem('fifa_user_persist');
        window.location.replace('login.html');
        throw new Error('Sesión corrupta — redirigiendo a login');
    }
})();

// ── Leer usuario ya validado ──────────────────────────────
const sessionData = sessionStorage.getItem('fifa_user');
let currentUser   = JSON.parse(sessionData);

// Migración para usuarios antiguos (sin inventory/equipped)
if (!currentUser.inventory) currentUser.inventory = [];
if (!currentUser.equipped)  currentUser.equipped  = {};

// Asegurar que el usuario tenga el ítem por defecto "Marco Estadio"
if (!currentUser.inventory.includes('stadium_frame')) {
    currentUser.inventory.push('stadium_frame');
    currentUser.equipped.frame = 'stadium-frame';
}

// Persist user — sessionStorage (pestaña activa) + localStorage (recarga)
function saveUser() {
    const json = JSON.stringify(currentUser);
    sessionStorage.setItem('fifa_user', json);
    localStorage.setItem('fifa_user_persist', json);
}

// ─── LOCAL STORAGE HELPERS ───────────────────────────────
const LS = {
    get:    (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } },
    set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
    append: (k, v) => { const arr = LS.get(k) || []; arr.push(v); LS.set(k, arr); },
};

// ─── CONVERSATION PERSISTENCE ────────────────────────────
//function saveMessage(chatId, msg) {
  //  LS.append(`chat_${chatId}`, msg);
//}

 function saveMessage(chatId, msg) {
        // Guardar en Firestore si está disponible, sino solo localStorage
        if (window.db_saveMessage) {
            window.db_saveMessage(chatId, msg);
        } else {
            LS.append(`chat_${chatId}`, msg);
        }
    }

//function loadMessages(chatId) {
  //  return LS.get(`chat_${chatId}`) || [];
//}

 function loadMessages(chatId) {
        // Retorna localStorage mientras carga Firestore en background
        return LS.get(`chat_${chatId}`) || [];
    }

// ─── OFFLINE MESSAGE QUEUE ────────────────────────────────
// Messages sent to offline users queue in localStorage
function queueOfflineMsg(receiverId, msg) {
    LS.append(`offline_${receiverId}`, msg);
}
function flushOfflineQueue(userId) {
    const queue = LS.get(`offline_${userId}`) || [];
    if (queue.length === 0) return;
    queue.forEach(msg => {
        appendMessage(msg.message, 'received', msg.senderId, msg.time, msg.fileUrl, msg.fileName, msg.type, msg.locationUrl);
    });
    localStorage.removeItem(`offline_${userId}`);
    if (queue.length > 0) {
        showToast(`📬 ${queue.length} mensaje(s) pendiente(s) recibidos`, 'info');
    }
}

// ─── HYDRATE UI ───────────────────────────────────────────
function hydrateUI() {
    document.getElementById('sidebar-username').textContent    = currentUser.name  || 'Turista 1';
    document.getElementById('sidebar-level').textContent      = currentUser.level  || 'Explorer';
    document.getElementById('card-username').textContent      = (currentUser.name || 'TURISTA').toUpperCase().substring(0,10);
    document.getElementById('card-pts').textContent           = currentUser.points || 1500;
    document.getElementById('card-nation').textContent        = currentUser.country || '🇲🇽 México';
    document.getElementById('pts-display').innerHTML          = `<i class="fas fa-coins"></i> ${currentUser.points||1500} pts`;
    document.getElementById('level-name').textContent         = currentUser.level  || 'Explorer';
    document.getElementById('profile-name-display').textContent  = currentUser.name || 'Turista 1';
    document.getElementById('profile-email-display').textContent = currentUser.email || 'turista@demo.com';
    document.getElementById('profile-level-tag').textContent  = currentUser.level  || 'Explorer';
    document.getElementById('profile-pts-tag').textContent    = `${currentUser.points||1500} pts`;
    if (currentUser.avatar) {
        document.getElementById('user-avatar').src          = currentUser.avatar;
        document.getElementById('profile-avatar-img').src   = currentUser.avatar;
        document.getElementById('card-avatar').src          = currentUser.avatar;
    }
    // Profile form defaults
    const pname = document.getElementById('prof-name');
    if (pname) pname.value = currentUser.name || '';
    const pemail = document.getElementById('prof-email');
    if (pemail) pemail.value = currentUser.email || '';
    const pcountry = document.getElementById('prof-country');
    if (pcountry) pcountry.value = currentUser.country || '🇲🇽 México';
    const pbio = document.getElementById('prof-bio');
    if (pbio) pbio.value = currentUser.bio || '';
    const pstatus = document.getElementById('prof-status');
    if (pstatus) pstatus.value = currentUser.status || 'online';
    updateStatusDot(currentUser.status || 'online');
    updateLevelUI(currentUser.points || 1500);
}

// ─── SOCKET CONNECTION ───────────────────────────────────
let socket = null;
try {
//    socket = io('http://localhost:3000', { reconnectionAttempts: 5 });
//AHORA EL CLIENTE USA LA URL DE SERVER-config.JS
      //  socket = io(window.__FIFA_SERVER__ || 'http://localhost:3000', {
            const _serverUrl = window.__FIFA_SERVER__ || 'https://standup-fifa-poi.onrender.com';
socket = io(_serverUrl, {
            reconnectionAttempts: 5,
            transports: ['websocket', 'polling']
        });

    socket.on('connect', () => {
        console.log('✅ Socket conectado:', socket.id);
        socket.emit('user_connected', currentUser.name);
        socket.emit('join_group', 'grupo_tour');
        showToast('Conectado al servidor en tiempo real', 'success');
        // Flush pending offline messages for current user
        flushOfflineQueue(currentUser.name);
        // Inicializar PeerJS para videollamadas
        initPeer();
        loadRealUsers();
    });

    socket.on('connect_error', () => {
        console.warn('⚠️ Servidor no disponible — modo demo');
    });

    socket.on('receive_group_message', (data) => {
        const isCurrentChat = currentChat.type==='group' && currentChat.id===data.groupId;
        const time = data.time || new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        const msgObj = { ...data, time };
        saveMessage(data.groupId, msgObj);
        if (isCurrentChat) {
            appendMessage(data.message,'received',data.senderId,time,data.fileUrl,data.fileName,data.type,data.locationUrl);
            if (document.getElementById('chat-section').style.display==='none') {
                incrementChatBadge('chat-notif');
            }
        } else {
            incrementContactBadge(data.groupId);
            updateContactPreview(data.groupId, `${data.senderId}: ${data.message||'📎'}`);
            incrementChatBadge('chat-notif');
            document.getElementById('mobile-notif-dot').style.display = 'block';
        }
        const notifMsgs = document.getElementById('notif-msgs');
        if (!isCurrentChat && (!notifMsgs || notifMsgs.checked)) {
            pushToast(`💬 ${data.senderId}: ${(data.message||'Archivo').substring(0,40)}`, 'info');
        }
    });

    socket.on('receive_private_message', (data) => {
        const isCurrentChat = currentChat.type==='private' && currentChat.id===data.senderId;
        const time = data.time || new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
        const msgObj = { ...data, time };
        saveMessage(data.senderId, msgObj);
        if (isCurrentChat) {
            appendMessage(data.message,'received',data.senderId,time,data.fileUrl,data.fileName,data.type,data.locationUrl);
        } else {
            incrementContactBadge(data.senderId);
            updateContactPreview(data.senderId, data.message||'📎');
            incrementChatBadge('chat-notif');
            document.getElementById('mobile-notif-dot').style.display = 'block';
        }
        const notifMsgs = document.getElementById('notif-msgs');
        if (!isCurrentChat && (!notifMsgs || notifMsgs.checked)) {
            pushToast(`🔒 ${data.senderId}: ${(data.message||'Archivo').substring(0,40)}`, 'info');
        }
    });

    socket.on('status_update', ({ userId, status }) => {
        updateContactStatus(userId, status);
    });

    // ── VIDEOLLAMADA: señalización via Socket.io ────────────
    socket.on('incoming_call', (data) => {
        const accept = confirm(`📹 Llamada entrante de ${data.callerName}. ¿Aceptar?`);
        if (accept) {
            socket.emit('call_accepted', {
                callerId: data.callerId,
                peerId:   myPeer?.id || ''
            });
            // myPeer.on('call') en initPeer() maneja el resto
        } else {
            socket.emit('call_rejected', { callerId: data.callerId });
            showToast('Llamada rechazada', 'info');
        }
    });

    socket.on('call_accepted', (data) => {
        // El otro usuario aceptó — hacer la llamada PeerJS real
        if (myPeer && localStream) {
            const call = myPeer.call(data.peerId, localStream);
            currentCall = call;
            call.on('stream', (remoteStream) => {
                showRemoteStream(remoteStream);
                document.getElementById('vc-connecting').style.display = 'none';
            });
            call.on('close', () => endCall());
        }
    });

    socket.on('call_rejected', () => {
        showToast('📵 Llamada rechazada por el otro usuario', 'info');
        endCall();
    });

    socket.on('call_ended', () => {
        showToast('📵 El otro usuario colgó', 'info');
        endCall();
    });

} catch(e) {
    console.warn('Socket.io no cargado:', e);
}

// ─── CHAT STATE ───────────────────────────────────────────
let currentChat   = { type:'group', id:'grupo_tour', name:'Grupo Tour Estadio', avatarType:'group' };
let pendingFile   = null;
let pendingFileUrl = null;
let userPoints    = currentUser.points || 1500;
let taskIdCounter = 10;
let tasksCompleted = 0;

// ─── TAB NAVIGATION ──────────────────────────────────────
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(s => s.style.display='none');
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    const section = document.getElementById(`${tabId}-section`);
    if (section) section.style.display = 'flex';
    if (btn) btn.classList.add('active');
    if (tabId==='chat')    { clearBadge('chat-notif'); document.getElementById('mobile-notif-dot').style.display='none'; }
    if (tabId==='tasks')   { updateTaskCount(); clearBadge('tasks-notif'); }
    if (tabId==='rewards') { updateLevelUI(userPoints);  renderEmojiStore(); }
    closeSidebar();
}

// ─── RESPONSIVE SIDEBAR ──────────────────────────────────
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}
function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('show');
}

// ─── CHAT SELECTION ──────────────────────────────────────
function selectChat(type, id, name, avatarType, liEl) {
    currentChat = { type, id, name, avatarType };
    document.getElementById('current-chat-name').textContent = name;
    document.querySelectorAll('.contact-item').forEach(i => i.classList.remove('active-chat'));
    if (liEl) liEl.classList.add('active-chat');

    // Reset badge for this chat
    const badge = document.getElementById(`badge-${id}`);
    if (badge) { badge.style.display='none'; badge.textContent='0'; }

    const statusEl = document.getElementById('current-chat-status');
    const vcBtn    = document.getElementById('videocall-btn');
    const emailBtn = document.getElementById('email-chat-btn');
    const avatarEl = document.getElementById('current-chat-avatar');

    if (type==='group') {
        statusEl.innerHTML = '<i class="fas fa-circle pulse-dot"></i> 4 miembros en línea';
        vcBtn.style.display = 'none'; emailBtn.style.display = 'none';
        avatarEl.innerHTML = '<i class="fas fa-users"></i>';
    } else if (id === 'asistente_ia') {
        // Caso especial: Asistente IA
        statusEl.innerHTML = '<i class="fas fa-circle" style="color:var(--teal);font-size:.55rem"></i> IA activa 24/7';
        vcBtn.style.display  = 'none';   // No hay videollamada con la IA
        emailBtn.style.display = 'none';
        avatarEl.innerHTML = '<div style="width:100%;height:100%;background:linear-gradient(135deg,#00C9A7,#5B21B6);display:flex;align-items:center;justify-content:center;font-size:1.2rem;border-radius:10px;">🤖</div>';
    } else {
        
    const statusDot = document.getElementById(`status-${id}`);
    const uStatus   = statusDot?.classList.contains('online')  ? 'online'  :
                  statusDot?.classList.contains('away')    ? 'away'    :
                  statusDot?.classList.contains('busy')    ? 'busy'    : 'offline';

        const statusColors = { online:'var(--success)', offline:'var(--muted)', away:'var(--warning)', busy:'var(--danger)' };
        statusEl.innerHTML = `<i class="fas fa-circle" style="color:${statusColors[uStatus]};font-size:.55rem"></i> ${uStatus==='online'?'En línea':'Desconectado'}`;
        vcBtn.style.display = 'flex';
        emailBtn.style.display = 'flex';
        avatarEl.innerHTML = `<img src="https://api.dicebear.com/7.x/adventurer/svg?seed=${id}" style="width:100%;height:100%;border-radius:10px;" alt="">`;
        document.getElementById('vc-remote-name').textContent   = name;
        document.getElementById('vc-caller-name').textContent   = `Llamando a ${name}`;
        document.getElementById('vc-remote-avatar').src = `https://api.dicebear.com/7.x/adventurer/svg?seed=${id}`;
    }

     // Cargar historial desde Firestore (reemplaza los mensajes locales)
    if (window.db_loadMessages) {
        window.db_loadMessages(id).then(firestoreMsgs => {
            if (firestoreMsgs.length > 0) {
                const msgs = document.getElementById('chat-messages');
                msgs.innerHTML = '<div class="day-divider"><span>Hoy</span></div>';
                firestoreMsgs.forEach(m => appendMessage(
                    m.message, m.msgType || 'received', m.senderId,
                    m.time, m.fileUrl, m.fileName, m.type, m.locationUrl
                ));
            }
        });
    }

    // Load conversation from localStorage
    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = '<div class="day-divider"><span>Hoy</span></div>';
    const saved = loadMessages(id);
    if (saved.length > 0) {
        saved.forEach(m => appendMessage(m.message, m.type||'received', m.senderId, m.time, m.fileUrl, m.fileName, m.msgType, m.locationUrl));
    } else {
        // Demo messages
        if (type==='group' && id==='grupo_tour') {
            appendMessage('¡Hola a todos! ¿A qué hora nos vemos para ir al estadio? 🏟️','received','Turista 23','10:00 AM');
            appendMessage('Yo sugiero tomar el metro a las 12:00 PM ⚽','sent',null,'10:05 AM');
            appendMessage('Perfecto. Les comparto la ruta 📍','received','Guía Carlos','10:07 AM',null,null,'location','https://maps.google.com?q=25.6866,-100.3161');
        } else {
            appendMessage(`¡Hola! Soy ${name}. ¿En qué te puedo ayudar?`,'received',name,'09:30 AM');
            appendMessage('Hola! ¿Dónde nos encontramos?','sent',null,'09:31 AM');
        }
    }
    closeSidebar();
}

// ─── SEND MESSAGE ─────────────────────────────────────────
function sendMessage() {
    const input = document.getElementById('message-input');
    const text  = input.value.trim();
    const isEncrypted = document.getElementById('encryption-toggle').checked;
    if (!text && !pendingFile) return;

    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

    if (text) {
        appendMessage(text,'sent',null,time);
        const encMsg = isEncrypted ? btoa(unescape(encodeURIComponent(text))) : text;
        const payload = { groupId:currentChat.id, senderId:currentUser.name, message:encMsg, isEncrypted, time, type:'text' };
        saveMessage(currentChat.id, { ...payload, type:'sent' });

        if (socket?.connected) {
            if (currentChat.type==='group') {
                socket.emit('send_group_message', payload);
            } else {
                // Check if receiver is online via connectedUsers map
                socket.emit('send_private_message', { ...payload, receiverId:currentChat.id });
                // Also queue if offline (will be delivered on reconnect)
                queueOfflineMsg(currentChat.id, { senderId:currentUser.name, message:text, time });
            }
        }
        input.value = '';
    }

    // ═══════════════════════════════════════════════════════
        //  🤖 LÓGICA DEL ASISTENTE IA
        // ═══════════════════════════════════════════════════════
        if (currentChat.id === 'asistente_ia') {
            const msgs = document.getElementById('chat-messages');

            // 1. Mostrar indicador "Escribiendo..."
            const typingDiv = document.createElement('div');
            typingDiv.id = 'ai-typing-indicator';
            typingDiv.classList.add('ai-typing');
            typingDiv.innerHTML = `
                <div class="ai-typing-dots">
                    <i></i><i></i><i></i>
                </div>
                <span>Asistente escribiendo</span>
            `;
            msgs.appendChild(typingDiv);
            msgs.scrollTop = msgs.scrollHeight;

            // 2. Banco de respuestas contextuales según palabras clave
            const lowerText = text.toLowerCase();
            let aiReply = '';

            if (lowerText.includes('estadio') || lowerText.includes('partido')) {
                const respuestas = [
                    '¡El Estadio BBVA está increíble! Para llegar, toma el Metro Línea 2 hasta Estadio. 🚇',
                    'El partido más esperado es México vs Argentina en el BBVA. ¡Consigue tus boletos pronto! 🎟️',
                    'El estadio abre puertas 2 horas antes del partido. Te recomiendo llegar temprano. ⏰'
                ];
                aiReply = respuestas[Math.floor(Math.random()*respuestas.length)];
            } else if (lowerText.includes('metro') || lowerText.includes('transporte') || lowerText.includes('llegar')) {
                aiReply = 'Para moverte en Monterrey durante el Mundial: Metro Línea 2 es la más útil. El Metrobus también llega al centro. 🚌';
            } else if (lowerText.includes('comer') || lowerText.includes('restaurante') || lowerText.includes('comida')) {
                aiReply = '¡La comida regiomontana es espectacular! Te recomiendo probar cabrito y machaca cerca de la Macroplaza. 🌮';
            } else if (lowerText.includes('hotel') || lowerText.includes('hostal') || lowerText.includes('alojamiento')) {
                aiReply = 'Los mejores hoteles están en el Barrio Antiguo y San Pedro. Reserva con anticipación, ¡todo se llena! 🏨';
            } else if (lowerText.includes('macroplaza') || lowerText.includes('turismo') || lowerText.includes('visitar')) {
                aiReply = 'Visitar la Macroplaza te da +50 puntos de experiencia. También puedes ir al Museo de Historia Mexicana. ⭐';
            } else if (lowerText.includes('puntos') || lowerText.includes('recompensa') || lowerText.includes('nivel')) {
                aiReply = `Actualmente tienes ${currentUser.points} pts. Para subir a Champion necesitas 2500 pts. ¡Sigue explorando! 🏆`;
            } else if (lowerText.includes('hola') || lowerText.includes('buenos') || lowerText.includes('hi')) {
                aiReply = `¡Hola ${currentUser.name}! Soy tu Asistente IA del Mundial FIFA 2026 🤖⚽. ¿Pregúntame sobre estadios, transporte, comida o recompensas!`;
            } else if (lowerText.includes('tarea') || lowerText.includes('pendiente')) {
                aiReply = 'Puedes ver tus tareas del grupo en la pestaña "Tareas". Completarlas te da puntos de experiencia. ✅';
            } else {
                // Respuestas genéricas para cualquier otro mensaje
                const genericas = [
                    '¡Interesante pregunta! Para más información, te recomiendo revisar el mapa oficial de FIFA 2026. 🗺️',
                    'Recuerda que puedes ganar puntos explorando la ciudad y completando tareas del grupo. ⚽',
                    `¡Bienvenido al Mundial FIFA 2026 en México, ${currentUser.name}! ¿En qué más te puedo ayudar?`,
                    'El FIFA 2026 será la Copa del Mundo más grande de la historia con 48 equipos. 🌎',
                    'Si necesitas coordinar con tu grupo, usa el chat grupal o comparte tu ubicación. 📍',
                ];
                aiReply = genericas[Math.floor(Math.random()*genericas.length)];
            }

            // 3. Eliminar indicador y mostrar respuesta tras 1.5 segundos
            setTimeout(() => {
                const indicator = document.getElementById('ai-typing-indicator');
                if (indicator) indicator.remove();

                const replyTime = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
                appendMessage(aiReply, 'received', '🤖 Asistente IA', replyTime);

                // Guardar en historial local
                saveMessage('asistente_ia', {
                    senderId: 'Asistente IA',
                    message: aiReply,
                    type: 'received',
                    time: replyTime
                });

                // Preview en sidebar
                updateContactPreview('asistente_ia', aiReply);

                showToast('🤖 El Asistente IA respondió', 'info');
            }, 1500);
        }
        // ═══════════════════════════════════════════════════════
    

    if (pendingFile) {
        appendMessage('','sent',null,time,pendingFileUrl,pendingFile.name,'file');
        saveMessage(currentChat.id, { senderId:currentUser.name, type:'sent', msgType:'file', fileName:pendingFile.name, fileUrl:pendingFileUrl, time });
        pendingFile=null; pendingFileUrl=null;
        document.getElementById('file-preview').style.display='none';
    }
}

function appendMessage(text, type, sender, time, fileUrl, fileName, msgType, locationUrl) {
    const msgs = document.getElementById('chat-messages');
    const div  = document.createElement('div');
    div.classList.add('message', type);

    // Aplicar fondo de mensaje si es enviado y hay fondo equipado
     if (type === 'sent' && currentUser.equipped && currentUser.equipped['msg-bg']) {
        div.classList.add(currentUser.equipped['msg-bg']);
    }

    let inner = '';
    if (type==='received' && sender) inner += `<div class="msg-sender">${escHtml(sender)}</div>`;
    if (text) inner += `<p>${escHtml(text)}</p>`;
    if (msgType==='location' || locationUrl) {
        inner += `<div class="location-msg" onclick="openModal('view-loc-modal')">
            <i class="fas fa-map-marker-alt"></i><span>Ver ubicación en Google Maps</span><i class="fas fa-external-link-alt"></i>
        </div>`;
    }
    if ((msgType==='file'||fileName) && fileName) {
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        if (isImage && fileUrl) {
            inner += `<div class="msg-file"><img src="${fileUrl}" alt="${escHtml(fileName)}"></div>`;
        } else {
            inner += `<div class="msg-file"><i class="fas fa-file-alt" style="font-size:1.4rem;color:var(--gold)"></i>
                <div><strong>${escHtml(fileName)}</strong><br><small>Archivo adjunto</small></div></div>`;
        }
    }
    inner += `<span class="time">${time||''}</span>`;
    if (type==='sent') inner += `<span class="msg-status"><i class="fas fa-check-double"></i></span>`;
    div.innerHTML = inner;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

// ─── ENCRYPTION (listener se registra en DOMContentLoaded) ────

// ─── FILE HANDLING ────────────────────────────────────────
function clearFile() {
    pendingFile=null; pendingFileUrl=null;
    document.getElementById('file-preview').style.display='none';
}
function previewFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10*1024*1024) { showToast('Archivo muy grande (máx 10MB)','error'); return; }
    const isImage = file.type.startsWith('image/');
    const area    = document.getElementById('file-preview-area');
    area.style.display = 'block';
    document.getElementById('file-drop').style.display = 'none';
    if (isImage) {
        // Preview local solo para mostrar — no se envía esta URL
        const localUrl = URL.createObjectURL(file);
        document.getElementById('img-preview').src   = localUrl;
        document.getElementById('img-preview').style.display  = 'block';
        document.getElementById('file-info-row').style.display = 'none';
    } else {
        document.getElementById('img-preview').style.display  = 'none';
        document.getElementById('file-info-row').style.display = 'flex';
        document.getElementById('file-name2').textContent = file.name;
        document.getElementById('file-size').textContent  = (file.size/1024).toFixed(1)+' KB';
    }
    // Guardamos el archivo, NO la URL local
    pendingFile    = file;
    pendingFileUrl = null;
    document.getElementById('send-file-btn').disabled = false;
}
function handleDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt.files.length) previewFile({ target:{ files:dt.files } });
}
async function sendFile() {
    if (!pendingFile) return;
    const sendBtn = document.getElementById('send-file-btn');
    sendBtn.disabled  = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    try {
        let fileUrl = null;
        if (window.db_uploadFile) {
            // ✅ Firebase Storage — URL permanente visible en cualquier dispositivo
            const result = await window.db_uploadFile(pendingFile, 'chat-files');
            fileUrl = result.url;
            showToast('✅ Archivo subido a la nube', 'success');
        } else {
            // ⚠️ Fallback local (solo visible en este dispositivo)
            fileUrl = URL.createObjectURL(pendingFile);
            showToast('⚠️ Sin Storage: archivo solo visible localmente', 'info');
        }
        appendMessage('', 'sent', null, time, fileUrl, pendingFile.name, 'file');
        const msgData = { senderId:currentUser.name, type:'sent', msgType:'file', fileName:pendingFile.name, fileUrl, time };
        saveMessage(currentChat.id, msgData);
        if (socket?.connected) {
            const payload = { groupId:currentChat.id, receiverId:currentChat.id, senderId:currentUser.name, message:'', type:'file', fileName:pendingFile.name, fileUrl, time };
            if (currentChat.type === 'group') {
                socket.emit('send_group_message', payload);
            } else {
                socket.emit('send_private_message', { ...payload, groupId:undefined, receiverId:currentChat.id });
            }
        }
        closeModal('file-modal');
        resetFileModal();
        awardPoints(50, 'Enviaste un archivo');
    } catch(err) {
        console.error('❌ Error al subir archivo:', err);
        showToast('Error al subir el archivo: ' + err.message, 'error');
        sendBtn.disabled  = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
    }
}
function resetFileModal() {
    pendingFile = null; pendingFileUrl = null;
    document.getElementById('file-drop').style.display         = 'block';
    document.getElementById('file-preview-area').style.display  = 'none';
    document.getElementById('img-preview').style.display        = 'none';
    document.getElementById('send-file-btn').disabled           = true;
    document.getElementById('send-file-btn').innerHTML          = '<i class="fas fa-paper-plane"></i> Enviar';
}

// ─── LOCATION ─────────────────────────────────────────────
function shareLocation() {
    openModal('location-modal');
    document.getElementById('loc-loading').style.display = 'block';
    document.getElementById('loc-result').style.display  = 'none';
    document.getElementById('send-location-btn').disabled = true;
    const resolve = (lat,lng,label) => {
        const url = `https://maps.google.com?q=${lat},${lng}`;
        document.getElementById('loc-loading').style.display = 'none';
        document.getElementById('loc-result').style.display  = 'block';
        document.getElementById('loc-address').textContent   = label;
        document.getElementById('loc-link').href = url;
        document.getElementById('send-location-btn').disabled = false;
        document.getElementById('send-location-btn').dataset.url = url;
        awardPoints(50,'Compartiste tu ubicación');
        document.getElementById('badge-loc')?.classList.add('unlocked');
    };
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            p => resolve(p.coords.latitude.toFixed(4), p.coords.longitude.toFixed(4), 'Tu ubicación actual'),
            ()=> resolve('25.6866','-100.3161','Monterrey, N.L., México (demo)')
        );
    } else {
        resolve('25.6866','-100.3161','Monterrey, N.L., México (demo)');
    }
}
function sendLocation() {
    const url  = document.getElementById('send-location-btn').dataset.url || 'https://maps.google.com?q=25.6866,-100.3161';
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    appendMessage('📍 Ubicación compartida','sent',null,time,null,null,'location',url);
    saveMessage(currentChat.id, { senderId:currentUser.name, message:'📍 Ubicación', type:'sent', msgType:'location', locationUrl:url, time });
    if (socket?.connected) socket.emit('send_group_message', { groupId:currentChat.id, senderId:currentUser.name, message:'📍 Ubicación', locationUrl:url, type:'location', time });
    closeModal('location-modal');
    showToast('Ubicación enviada al chat','success');
}
function openLocation() { openModal('view-loc-modal'); }

// ─── STATUS MANAGEMENT ────────────────────────────────────
function changeMyStatus(val) {
    currentUser.status = val;
    saveUser();
    updateStatusDot(val);
    // Sync both selectors
    const selA = document.getElementById('my-status-select');
    const selB = document.getElementById('prof-status');
    if (selA) selA.value = val;
    if (selB) selB.value = val;
    if (socket?.connected) {
        socket.emit('status_update', { userId:currentUser.name, status:val });
    }
    const labels = { online:'En línea', away:'Ausente', busy:'Ocupado', offline:'Invisible' };
    showToast(`Estado: ${labels[val]||val}`, 'info');
}
function updateStatusDot(status) {
    const dot = document.getElementById('my-status-dot');
    if (!dot) return;
    const colors = { online:'var(--success)', away:'var(--warning)', busy:'var(--danger)', offline:'var(--muted)' };
    dot.style.background = colors[status] || colors.online;
}
function updateContactStatus(userId, status) {
    document.querySelectorAll('.contact-item').forEach(item => {
        const nameEl = item.querySelector('.contact-name');
        if (nameEl && nameEl.textContent.toLowerCase().includes(userId.toLowerCase())) {
            const dot = item.querySelector('.status-indicator');
            if (dot) dot.className = `status-indicator ${status}`;
        }
    });
}

// ─── CREATE GROUP ─────────────────────────────────────────
function createGroup() {
    const name     = document.getElementById('group-name-input').value.trim();
    const selected = [...document.querySelectorAll('.user-check-item input:checked')].map(cb=>cb.value);
    if (!name)            { showToast('Escribe el nombre del grupo','error'); return; }
    if (selected.length<2){ showToast('Selecciona al menos 2 integrantes','error'); return; }

    const groupId = 'group_'+Date.now();
    const li      = document.createElement('li');
    li.className  = 'contact-item';
    li.dataset.chatId = groupId;
    li.onclick = (e) => selectChat('group',groupId,name,'group',li);
    li.innerHTML = `
        <div class="contact-avatar group-av"><i class="fas fa-users"></i></div>
        <div class="contact-info">
            <span class="contact-name">${escHtml(name)}</span>
            <span class="contact-preview" id="preview-${groupId}">${selected.length+1} integrantes</span>
        </div>
        <span class="unread-badge" id="badge-${groupId}" style="display:none">0</span>`;
    document.getElementById('contacts').appendChild(li);
    if (socket?.connected) socket.emit('join_group', groupId);
    closeModal('create-group-modal');
    document.getElementById('group-name-input').value = '';
    document.querySelectorAll('.user-check-item input').forEach(cb=>cb.checked=false);
    showToast(`✅ Grupo "${name}" creado con ${selected.length+1} integrantes`,'success');
    awardPoints(100,'Creaste un grupo');
}

// ─── PROFILE ──────────────────────────────────────────────
function switchProfileTab(tab, btn) {
    document.querySelectorAll('.profile-tab-content').forEach(t=>t.style.display='none');
    document.querySelectorAll('.profile-tab-btn').forEach(b=>b.classList.remove('active'));
    const el = document.getElementById(`ptab-${tab}`);
    if (el) el.style.display = 'block';
    if (btn) btn.classList.add('active');
}
function changeAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const url = e.target.result;
        document.getElementById('profile-avatar-img').src = url;
        document.getElementById('user-avatar').src         = url;
        document.getElementById('card-avatar').src         = url;
        currentUser.avatar = url;
    };
    reader.readAsDataURL(file);
}
function saveProfile() {
    const name    = document.getElementById('prof-name').value.trim();
    const email   = document.getElementById('prof-email').value.trim();
    const country = document.getElementById('prof-country').value;
    const bio     = document.getElementById('prof-bio').value.trim();
    const status  = document.getElementById('prof-status').value;
    if (!name)  { showToast('El nombre es requerido','error'); return; }
    if (!email || !email.includes('@')) { showToast('Correo inválido','error'); return; }
    currentUser = { ...currentUser, name, email, country, bio, status };
    saveUser();
    hydrateUI();
    changeMyStatus(status);
    closeModal('profile-modal');
    showToast('✅ Perfil actualizado correctamente','success');
}
function checkPassStrength(val) {
    let score = 0;
    if (val.length>=8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    ['ps1','ps2','ps3','ps4'].forEach((id,i) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'strength-seg';
        if (i<score) el.classList.add(score<=1?'weak':score<=3?'medium':'strong');
    });
}
function changePassword() {
    const cur  = document.getElementById('pass-current').value;
    const nw   = document.getElementById('pass-new').value;
    const conf = document.getElementById('pass-confirm').value;
    if (!cur)         { showToast('Escribe tu contraseña actual','error'); return; }
    if (nw.length<8)  { showToast('La nueva contraseña debe tener mínimo 8 caracteres','error'); return; }
    if (nw!==conf)    { showToast('Las contraseñas no coinciden','error'); return; }
    // In production: call API to update password
    ['pass-current','pass-new','pass-confirm'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; });
    showToast('🔐 Contraseña actualizada','success');
}

// ─── EMAIL ────────────────────────────────────────────────
function toggleCustomEmail(val) {
    document.getElementById('email-custom-wrap').style.display = val==='custom' ? 'block' : 'none';
}
function prefillEmail() {
    openModal('email-modal');
    const recipientMap = { guia_local:'carlos@turistahub.com', turista_mx:'maria@turistahub.com' };
    const sel = document.getElementById('email-to');
    if (sel && recipientMap[currentChat.id]) sel.value = recipientMap[currentChat.id];
    document.getElementById('email-subject').value = `Mensaje de ${currentUser.name} - FIFA 2026 Tourist Hub`;
}
const EMAIL_TEMPLATES = {
    meet:    { subject:'📍 Punto de encuentro — FIFA 2026', body:`Hola,\n\nTe escribo para coordinarnos el punto de encuentro para el partido.\n\nNos encontramos a las [HORA] en [LUGAR].\n\nSaludos,\n${currentUser.name}` },
    ticket:  { subject:'🎟️ Información sobre boleto — FIFA 2026', body:`Hola,\n\nTe comparto la información de nuestro boleto para el partido:\n\n• Partido: [EQUIPO 1 vs EQUIPO 2]\n• Fecha: [FECHA]\n• Sector: [SECTOR]\n\nSaludos,\n${currentUser.name}` },
    welcome: { subject:'👋 Bienvenida al grupo — FIFA 2026 Tourist Hub', body:`¡Hola!\n\nBienvenido/a al grupo de turistas para la Copa Mundial FIFA 2026.\n\nEn este hub podrás coordinar visitas, compartir ubicación y chatear con el grupo.\n\n¡Nos vemos en el estadio!\n${currentUser.name}` },
};
function applyTemplate(key) {
    const t = EMAIL_TEMPLATES[key];
    if (!t) return;
    document.getElementById('email-subject').value = t.subject;
    document.getElementById('email-body').value    = t.body;
}
function sendEmail() {
    const toSelect = document.getElementById('email-to').value;
    const toCustom = document.getElementById('email-to-custom').value.trim();
    const to       = toSelect==='custom' ? toCustom : toSelect;
    const subject  = document.getElementById('email-subject').value.trim();
    const body     = document.getElementById('email-body').value.trim();

    if (!to)      { showToast('Selecciona o escribe un destinatario','error'); return; }
    if (!subject) { showToast('El asunto es requerido','error'); return; }
    if (!body)    { showToast('El mensaje no puede estar vacío','error'); return; }
    if (toSelect==='custom' && !to.includes('@')) { showToast('Correo inválido','error'); return; }

    // Open mailto: for real email client OR show success for demo
    const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl,'_blank');

    // Log email as sent message in chat
    const time = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    appendMessage(`📧 Correo enviado a ${to}: "${subject}"`, 'sent', null, time);

    closeModal('email-modal');
    document.getElementById('email-to').value      = '';
    document.getElementById('email-subject').value = '';
    document.getElementById('email-body').value    = '';

    showToast(`📧 Correo enviado a ${to}`,'success');
    awardPoints(75,'Enviaste un correo electrónico');
    document.getElementById('badge-email')?.classList.add('unlocked');
}

// ─── VIDEO CALL ───────────────────────────────────────────
let vcTimerInterval = null;
let vcSeconds       = 0;
let localStream     = null;
let currentCall     = null;   // objeto PeerJS call activo
let myPeer          = null;   // instancia PeerJS del usuario local
let micActive       = true;
let camActive       = true;

// ── INICIALIZAR PEERJS ────────────────────────────────────
function initPeer() {
    if (myPeer) return;

    const safePeerId = (currentUser.name || 'turista')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        + '_' + Date.now();

    const serverUrl = window.__FIFA_SERVER__ || 'http://localhost:3000';
    const parsed    = new URL(serverUrl);

    myPeer = new Peer(safePeerId, {
        host:   parsed.hostname,
        port:   parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:   '/peerjs',
        secure: parsed.protocol === 'https:',
        debug:  1
    });

    myPeer.on('open', (id) => {
        console.log('📹 PeerJS listo. Mi Peer ID:', id);
        if (socket?.connected) {
            socket.emit('register_peer_id', { userId: currentUser.name, peerId: id });
        }
    });

    // Llamada ENTRANTE — el receptor responde aquí
    myPeer.on('call', (call) => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((stream) => {
                localStream = stream;
                currentCall = call;
                call.answer(stream);
                call.on('stream', (remoteStream) => { showRemoteStream(remoteStream); });
                call.on('close', () => { endCall(); });
                openModal('videocall-modal');
                document.getElementById('vc-connecting').style.display = 'none';
                document.getElementById('local-stream').srcObject = stream;
                startCallTimer();
                showToast('📹 Llamada entrante conectada', 'success');
                awardPoints(200, 'Realizaste una videollamada');
            })
            .catch((err) => {
                console.error('❌ Cámara/mic denegados:', err);
                showToast('Activa cámara y micrófono en tu navegador', 'error');
            });
    });

    myPeer.on('error', (err) => {
        console.warn('⚠️ PeerJS error:', err.type);
        if (err.type === 'peer-unavailable') {
            showToast('El usuario no está disponible para videollamada', 'error');
            closeModal('videocall-modal');
        }
    });
}

function showRemoteStream(remoteStream) {
    const remoteVideo = document.getElementById('remote-stream');
    const placeholder = document.getElementById('vc-placeholder');
    if (remoteVideo) { remoteVideo.srcObject = remoteStream; remoteVideo.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    startCallTimer();
    showToast('📹 Videollamada conectada', 'success');
    awardPoints(200, 'Realizaste una videollamada');
    document.getElementById('badge-vc')?.classList.add('unlocked');
}

function openVideoCall() {
    if (currentChat.type !== 'private') {
        showToast('Las videollamadas son solo en chats privados', 'info');
        return;
    }
    openModal('videocall-modal');
    document.getElementById('vc-connecting').style.display = 'block';
    document.getElementById('vc-timer').textContent = '00:00';

    if (!navigator.mediaDevices?.getUserMedia) {
        showToast('Tu navegador no soporta videollamadas', 'error');
        closeModal('videocall-modal');
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
            localStream = stream;
            document.getElementById('local-stream').srcObject = stream;
            if (socket?.connected) {
                socket.emit('call_user', {
                    callerId:   currentUser.name,
                    callerName: currentUser.name,
                    receiverId: currentChat.id,
                    peerId:     myPeer?.id || ''
                });
                showToast(`📞 Llamando a ${currentChat.name}...`, 'info');
            } else {
                // Modo demo sin servidor
                setTimeout(() => {
                    document.getElementById('vc-connecting').style.display = 'none';
                    startCallTimer();
                    showToast('📹 Videollamada (modo demo local)', 'success');
                    awardPoints(200, 'Realizaste una videollamada');
                }, 2000);
            }
        })
        .catch((err) => {
            console.error('❌ Acceso denegado a cámara/mic:', err);
            showToast('Activa el permiso de cámara y micrófono en tu navegador', 'error');
            closeModal('videocall-modal');
        });
}

function startCallTimer() {
    vcSeconds = 0;
    clearInterval(vcTimerInterval);
    vcTimerInterval = setInterval(() => {
        vcSeconds++;
        const m = String(Math.floor(vcSeconds / 60)).padStart(2, '0');
        const s = String(vcSeconds % 60).padStart(2, '0');
        document.getElementById('vc-timer').textContent = `${m}:${s}`;
    }, 1000);
}

function endCall() {
    clearInterval(vcTimerInterval);
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (currentCall) { currentCall.close(); currentCall = null; }
    const localVid  = document.getElementById('local-stream');
    const remoteVid = document.getElementById('remote-stream');
    if (localVid)  localVid.srcObject = null;
    if (remoteVid) { remoteVid.srcObject = null; remoteVid.style.display = 'none'; }
    const placeholder = document.getElementById('vc-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    if (socket?.connected && currentChat.id) socket.emit('call_ended', { receiverId: currentChat.id });
    document.getElementById('videocall-modal')?.classList.remove('open');
    showToast('Llamada finalizada', 'info');
}

function toggleMic(btn) {
    micActive = !micActive;
    btn.classList.toggle('muted', !micActive);
    btn.innerHTML = micActive ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = micActive);
}

function toggleCam(btn) {
    camActive = !camActive;
    btn.classList.toggle('muted', !camActive);
    btn.innerHTML = camActive ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = camActive);
}
function toggleFullscreen() {
    const el = document.querySelector('.videocall-ui');
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.().catch(()=>{});
}

// ─── TASKS ────────────────────────────────────────────────
function addTask() {
    const input    = document.getElementById('new-task-input');
    const assignee = document.getElementById('task-assignee').value || 'Todos';
    const text     = input.value.trim();
    if (!text) { showToast('Escribe el nombre de la tarea','error'); return; }
    taskIdCounter++;
    const id   = taskIdCounter;
    const list = document.getElementById('task-list');
    const item = document.createElement('div');
    item.className = 'task-item';
    item.dataset.id = id;
    item.innerHTML = `
        <div class="task-check-wrap">
            <input type="checkbox" id="task${id}" onchange="toggleTask(${id},this)">
            <label for="task${id}" class="task-label">${escHtml(text)}</label>
        </div>
        <div class="task-meta">
            <span class="task-assignee-badge"><i class="fas fa-user"></i> ${escHtml(assignee)}</span>
            <button class="task-del" onclick="deleteTask(${id})"><i class="fas fa-trash"></i></button>
        </div>`;
    list.appendChild(item);
    input.value = '';
    updateTaskCount();
    showToast('✅ Tarea agregada al grupo','success');
    // Notify task in chat
    if (socket?.connected) {
        socket.emit('send_group_message', { groupId:currentChat.id, senderId:currentUser.name, message:`📋 Nueva tarea: "${text}" → ${assignee}`, type:'text', time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) });
    }
    // Tasks notif badge
    const tasksNotif = document.getElementById('tasks-notif');
    if (document.getElementById('tasks-section').style.display==='none') {
        tasksNotif.style.display = 'flex';
        tasksNotif.textContent = String((parseInt(tasksNotif.textContent)||0)+1);
    }
}
function toggleTask(id, checkbox) {
    const item = document.querySelector(`.task-item[data-id="${id}"]`);
    if (!item) return;
    item.classList.toggle('done', checkbox.checked);
    updateTaskCount();
    if (checkbox.checked) {
        tasksCompleted++;
        showToast('🎉 Tarea completada!','success');
        awardPoints(75,'Completaste una tarea');
        if (tasksCompleted >= 3) document.getElementById('badge-tasks')?.classList.add('unlocked');
    }
}
function deleteTask(id) {
    const item = document.querySelector(`.task-item[data-id="${id}"]`);
    if (!item) return;
    item.style.transition = 'all .2s';
    item.style.opacity    = '0';
    item.style.transform  = 'translateX(20px)';
    setTimeout(()=>{ item.remove(); updateTaskCount(); }, 200);
}
function updateTaskCount() {
    const all  = document.querySelectorAll('.task-item').length;
    const done = document.querySelectorAll('.task-item.done').length;
    const el   = document.getElementById('task-count');
    if (el) el.textContent = `${done} de ${all} completadas`;
}

// ─── REWARDS & POINTS ─────────────────────────────────────
function awardPoints(pts, reason) {
    userPoints += pts;
    currentUser.points = userPoints;
    saveUser();
     // Guardar recompensa en Firestore
        if (window.db_saveReward) {
            window.db_saveReward(currentUser.name, reason, pts, userPoints);
        }
    updatePtsDisplay();
    updateLevelUI(userPoints);
    const notifRewards = document.getElementById('notif-rewards');
    if (!notifRewards || notifRewards.checked) pushToast(`+${pts} pts — ${reason}`,'success');
}
function updatePtsDisplay() {
    document.querySelectorAll('[id="pts-display"], .pts-display').forEach(el=>{
        el.innerHTML = `<i class="fas fa-coins"></i> ${userPoints} pts`;
    });
    const cardPts = document.getElementById('card-pts');
    if (cardPts) cardPts.textContent = userPoints;
    const profPts = document.getElementById('profile-pts-tag');
    if (profPts) profPts.textContent = `${userPoints} pts`;
}
function updateLevelUI(pts) {
    let level='Rookie', fill=10, next=1000, nextLabel='Explorer';
    if      (pts>=5000) { level='Legend';   fill=100; next=5000; nextLabel='Nivel máximo'; }
    else if (pts>=3000) { level='Elite';    fill=80;  next=5000; nextLabel='Legend'; }
    else if (pts>=2500) { level='Champion'; fill=70;  next=3000; nextLabel='Elite'; }
    else if (pts>=1000) { level='Explorer'; fill=40;  next=2500; nextLabel='Champion'; }
    else               { level='Rookie';   fill=Math.round((pts/1000)*30)+5; next=1000; nextLabel='Explorer'; }

    document.getElementById('level-name').textContent         = level;
    document.getElementById('sidebar-level').textContent      = level;
    document.getElementById('profile-level-tag').textContent  = level;
    document.getElementById('progress-fill').style.width      = fill+'%';
    document.getElementById('progress-label').textContent     = `${pts} / ${next} XP para ${nextLabel}`;
    currentUser.level = level; saveUser();
}
// --- TIENDA: catálogo centralizado ---
const STORE_ITEMS = {
    // ── MARCOS ──────────────────────────────────────────────
    stadium_frame: { cost:0,   type:'frame',  css:'stadium-frame', label:'Marco Estadio'    },
    gold_frame:    { cost:500, type:'frame',  css:'gold-frame',    label:'Marco Gold'       },
    teal_frame:    { cost:350, type:'frame',  css:'teal-frame',    label:'Marco Teal'       },
    mty_frame:     { cost:600, type:'frame',  css:'mty-frame',     label:'Marco MTY'        },
    fire_frame:    { cost:900, type:'frame',  css:'fire-frame',    label:'Marco Fuego'      },
    // ── FONDOS ──────────────────────────────────────────────
    mty_bg:        { cost:800, type:'bg',     css:'mty-bg',        label:'Fondo MTY'        },
    fifa_gold_bg:  { cost:400, type:'bg',     css:'fifa-gold-bg',  label:'Fondo FIFA Gold'  },
    teal_night_bg: { cost:450, type:'bg',     css:'teal-night-bg', label:'Fondo Teal Night' },
    sunset_bg:     { cost:500, type:'bg',     css:'sunset-bg',     label:'Fondo Sunset MTY' },
    royal_bg:      { cost:400, type:'bg',     css:'royal-bg',      label:'Fondo Royal Blue' },
    forest_bg:     { cost:350, type:'bg',     css:'forest-bg',     label:'Fondo Forest'     },
    // ── INSIGNIAS ───────────────────────────────────────────
    mundial_badge: { cost:200, type:'badge',  css:'mundial-badge', label:'Insignia Mundial' },
    mty_badge:     { cost:250, type:'badge',  css:'mty-badge',     label:'Insignia MTY'     },
    gol_badge:     { cost:300, type:'badge',  css:'gol-badge',     label:'Insignia Goleador'},
    vip_badge:     { cost:750, type:'badge',  css:'vip-badge',     label:'Insignia VIP'     },
    // ── ICONOS ──────────────────────────────────────────────
    fan_icon:      { cost:150, type:'icon',   css:'fan-icon',      label:'Icono Fan'        },
    comm_icon:     { cost:200, type:'icon',   css:'comm-icon',     label:'Icono Comentarista'},
    guide_icon:    { cost:250, type:'icon',   css:'guide-icon',    label:'Icono Guía'       },
    eagle_icon:    { cost:400, type:'icon',   css:'eagle-icon',    label:'Icono Águila'     },
    ball_icon:     { cost:300, type:'icon',   css:'ball-icon',     label:'Icono Balón FIFA' },
    // ── BURBUJAS DE CHAT ────────────────────────────────────
    neon_sky:      { cost:300, type:'msg-bg', css:'bg-neon-sky',   label:'Burbuja Cielo Neón'},
    aurora_boreal: { cost:450, type:'msg-bg', css:'bg-aurora',     label:'Aurora Boreal'    },
    gold_bubble:   { cost:400, type:'msg-bg', css:'bg-gold-bubble',label:'Burbuja Gold'     },
    sunset_bubble: { cost:380, type:'msg-bg', css:'bg-sunset-bubble',label:'Burbuja Sunset' },
};

// ── switchStoreTab: cambiar entre categorías de la tienda ────────
window.switchStoreTab = function(tabId, btn) {
    document.querySelectorAll('.store-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.store-tab').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('store-tab-' + tabId);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
    // Renderizar emojis solo cuando se abre ese tab
    if (tabId === 'emojis' && window.renderEmojiStore) renderEmojiStore();
};

window.buyItem = function(itemId, cost, type, cssClass) {
    const btn  = document.getElementById('btn-' + itemId);
    if (!btn) return;

    const owned    = currentUser.inventory.includes(itemId);
    const equipped = owned && (currentUser.equipped[type] === cssClass);

    if (equipped) {
        // Ya está activo — no hacer nada
        showToast('ℹ️ Este ítem ya está equipado', 'info');
        return;
    }

    if (owned) {
        // Poseído pero sin equipar — sólo equipar, sin cobrar
        currentUser.equipped[type] = cssClass;
        saveUser();
        updateStoreButtons();
        showToast('✅ ' + (STORE_ITEMS[itemId] ? STORE_ITEMS[itemId].label : itemId) + ' equipado', 'success');
        return;
    }

    // No poseído — verificar puntos y comprar
    if (currentUser.points < cost) {
        showToast('❌ No tienes suficientes puntos (necesitas ' + cost + ' pts)', 'error');
        return;
    }
    currentUser.points -= cost;
    currentUser.inventory.push(itemId);
    currentUser.equipped[type] = cssClass;
    userPoints = currentUser.points;
    saveUser();
    updatePtsDisplay();
    updateStoreButtons();
    showToast('🎉 ¡Comprado! Te costó ' + cost + ' pts', 'success');
}

function updateStoreButtons() {
    Object.keys(STORE_ITEMS).forEach(function(id) {
        var item = STORE_ITEMS[id];
        var btn  = document.getElementById('btn-' + id);
        if (!btn) return;

        var owned    = currentUser.inventory.includes(id);
        var equipped = owned && (currentUser.equipped[item.type] === item.css);

        if (equipped) {
            btn.className  = 'btn-store equipped';
            btn.disabled   = true;
            btn.innerHTML  = '<i class="fas fa-check-circle"></i> Equipado';
        } else if (owned) {
            btn.className  = 'btn-store owned-item';
            btn.disabled   = false;
            btn.innerHTML  = '<i class="fas fa-arrow-up"></i> Equipar';
        } else {
            btn.className  = 'btn-store';
            btn.disabled   = false;
            btn.innerHTML  = item.cost === 0
                ? '<i class="fas fa-check-circle"></i> Gratis'
                : '<i class="fas fa-coins"></i> ' + item.cost;
        }
    });
}

// ─── NOTIFICATION BADGES ─────────────────────────────────
function incrementContactBadge(chatId) {
    const el = document.getElementById(`badge-${chatId}`);
    if (!el) return;
    el.style.display = 'flex';
    el.textContent   = String((parseInt(el.textContent)||0)+1);
}
function clearBadge(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display='none'; el.textContent='0'; }
}
function incrementChatBadge(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    el.textContent   = String((parseInt(el.textContent)||0)+1);
}
function updateContactPreview(chatId, text) {
    const el = document.getElementById(`preview-${chatId}`);
    if (el) el.textContent = text.substring(0,40);
}

// ─── MODAL CONTROLS ───────────────────────────────────────
function openModal(id) {
    document.getElementById(id)?.classList.add('open');
}
let _closingVideoCallModal = false;
function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    if (id === 'videocall-modal') {
        if (!_closingVideoCallModal) {
            _closingVideoCallModal = true;
            endCall();
            _closingVideoCallModal = false;
        }
    }
    if (id === 'file-modal') resetFileModal();
}
function closeModalOutside(event, id) {
    if (event.target.id===id) closeModal(id);
}

// ─── LOGOUT ───────────────────────────────────────────────
function logout() {
    sessionStorage.removeItem('fifa_user');
    localStorage.removeItem('fifa_user_persist');
    window.location.href = 'login.html';
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg, type='info') { pushToast(msg, type); }
function pushToast(msg, type='info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success:'fa-check-circle', info:'fa-circle-info', error:'fa-circle-exclamation' };
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type]||icons.info}"></i> ${escHtml(msg)}`;
    container.appendChild(toast);
    setTimeout(()=>{
        toast.style.transition='all .3s';
        toast.style.opacity='0';
        toast.style.transform='translateX(40px)';
        setTimeout(()=>toast.remove(),300);
    },3200);
}

// ─── UTIL ─────────────────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    hydrateUI();
    updateTaskCount();
    updatePtsDisplay();
    updateStoreButtons();

    // Listeners seguros: el DOM ya existe aquí
    const encToggle = document.getElementById('encryption-toggle');
    if (encToggle) {
        encToggle.addEventListener('change', (e) => {
            const banner  = document.getElementById('enc-banner');
            const encIcon = document.getElementById('enc-icon');
            if (banner) banner.style.display = e.target.checked ? 'flex' : 'none';
            if (encIcon) encIcon.style.color = e.target.checked ? 'var(--teal)' : 'var(--muted)';
            showToast(e.target.checked ? '🔒 Encriptación E2E activada' : '🔓 Encriptación desactivada', 'info');
        });
    }

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    const msgInput = document.getElementById('message-input');
    if (msgInput) msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    flushOfflineQueue(currentUser.name);
});

// ══════════════════════════════════════════════════════════
//  CERRAR SESIÓN
// ══════════════════════════════════════════════════════════
function logoutApp() {
    if (!confirm('¿Cerrar sesión?')) return;

    // Marcar offline en el servidor antes de desconectar
    if (typeof socket !== 'undefined' && socket?.connected) {
        socket.emit('user_disconnected', currentUser.name);
        socket.disconnect();
    }

    // Limpiar sesión
    sessionStorage.removeItem('fifa_user');
    localStorage.removeItem('fifa_user_persist');

    // Ir al login
    window.location.replace('login.html');
}
window.logoutApp = logoutApp;

//  CARGA DINÁMICA DE USUARIOS REALES DESDE FIREBASE

async function loadRealUsers() {
    try {
        // Esperar a que firestore_integration.js cargue
        let intentos = 0;
        while (!window.__FIRESTORE_READY__ && intentos < 20) {
            await new Promise(r => setTimeout(r, 300));
            intentos++;
        }

        // Leer usuarios directo de Firestore (sin necesitar serviceAccountKey)
        const { getFirestore, collection, getDocs } = await import(
            'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
        );
        const { initializeApp, getApps } = await import(
            'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
        );

        const firebaseConfig = {
            apiKey: "AIzaSyBQCxLixqM8qDquL3-xkMjkyupBlcgl2ek",
            authDomain: "standup-fifa-5f423.firebaseapp.com",
            projectId: "standup-fifa-5f423",
            storageBucket: "standup-fifa-5f423.appspot.com",
            messagingSenderId: "823333890415",
            appId: "1:112092859394:web:acaf19a3ed635667d3ab1b"
        };

        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db  = getFirestore(app);
        const snap = await getDocs(collection(db, 'users'));
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const list = document.getElementById('contacts');
        const selector = document.querySelector('.user-selector');
        if (selector) selector.innerHTML = '';

        users.forEach(u => {
            if (u.name === currentUser.name) return;

            // ── Agregar a lista de contactos ──────────────
            if (!document.querySelector(`[data-chat-id="${u.name}"]`)) {
                const li = document.createElement('li');
                li.className = 'contact-item';
                li.dataset.chatId = u.name;
                li.onclick = () => selectChat('private', u.name, u.name, 'user', li);
                li.innerHTML = `
                    <div class="contact-avatar">
                        <img src="${u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.name}`}" alt="">
                        <span class="status-indicator ${u.status || 'offline'}" id="status-${u.name}"></span>
                    </div>
                    <div class="contact-info">
                        <span class="contact-name">${escHtml(u.name)}</span>
                        <span class="contact-preview" id="preview-${u.name}">${escHtml(u.country || '')}</span>
                    </div>
                    <span class="unread-badge" id="badge-${u.name}" style="display:none">0</span>`;
                list.appendChild(li);
            }

            // ── Agregar al modal "Crear Grupo" ────────────
            if (selector) {
                const item = document.createElement('div');
                item.className = 'user-check-item';
                item.innerHTML = `
                    <img src="${u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.name}`}" alt="">
                    <div>
                        <strong>${escHtml(u.name)}</strong>
                        <span class="${u.status === 'online' ? 'online-tag' : 'offline-tag'}">
                            ${u.status === 'online' ? '🟢 En línea' : '🔴 Desconectado'}
                        </span>
                    </div>
                    <input type="checkbox" value="${escHtml(u.name)}">`;
                selector.appendChild(item);
            }
        });

        if (selector && selector.children.length === 0) {
            selector.innerHTML = '<p style="color:var(--muted);font-size:.82rem;padding:10px">No hay otros usuarios registrados aún.</p>';
        }

    } catch(e) {
        console.warn('No se pudieron cargar usuarios desde Firestore:', e);
    }
}
window.loadRealUsers = loadRealUsers;
