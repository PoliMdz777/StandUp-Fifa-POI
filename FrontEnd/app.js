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
window.currentUser = currentUser; // exponer para videocall_enhanced.js

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
    window.currentUser = currentUser; // mantener sync con videocall_enhanced.js
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
    document.getElementById('card-pts').textContent           = currentUser.points || 0;
    document.getElementById('card-nation').textContent        = currentUser.country || '🇲🇽 México';
    document.getElementById('pts-display').innerHTML          = `<i class="fas fa-coins"></i> ${currentUser.points||0} pts`;
    document.getElementById('level-name').textContent         = currentUser.level  || 'Explorer';
    document.getElementById('profile-name-display').textContent  = currentUser.name || 'Turista 1';
    document.getElementById('profile-email-display').textContent = currentUser.email || 'turista@demo.com';
    document.getElementById('profile-level-tag').textContent  = currentUser.level  || 'Explorer';
    document.getElementById('profile-pts-tag').textContent    = `${currentUser.points||0} pts`;
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
    updateLevelUI(currentUser.points || 0);
}

// ─── SOCKET CONNECTION ───────────────────────────────────
let socket = null;
// Despertar Render antes de conectar Socket.io
fetch('https://standup-fifa-poi.onrender.com/api/users')
    .then(() => console.log('✅ Render despierto'))
    .catch(() => console.warn('⚠️ Render no responde'));
try {
//    socket = io('http://localhost:3000', { reconnectionAttempts: 5 });
//AHORA EL CLIENTE USA LA URL DE SERVER-config.JS
        //socket = io(window.__FIFA_SERVER__ || 'http://localhost:3000', 
          const _serverUrl = 'https://standup-fifa-poi.onrender.com';
socket = io(_serverUrl, {
    reconnectionAttempts: 5,
    transports: ['polling', 'websocket'],  // polling primero — más compatible con Render
    timeout: 20000,
    forceNew: true
});

    socket.on('connect', () => {
        console.log('✅ Socket conectado:', socket.id);
        socket.emit('user_connected', currentUser.name);
        socket.emit('join_group', 'grupo_tour');
        showToast('Conectado al servidor en tiempo real', 'success');
        // Flush pending offline messages for current user
        flushOfflineQueue(currentUser.name);

         // [AGREGAR] Iniciar PeerJS y registrar listeners de videollamada
    if (typeof window.initPeer === 'function') window.initPeer();
    if (typeof window.registerCallSocketListeners === 'function') {
        window.registerCallSocketListeners(socket);
    }

        // Inicializar PeerJS para videollamadas
      //  initPeer();
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

            // AGREGA justo después del appendMessage:
            if (data.msgType === 'file' || data.type === 'file') {
                saveMessage(data.groupId, {
                senderId:  data.senderId,
                message:   data.message || '',
                type:      'received',
                msgType:   'file',
                fileName:  data.fileName,
                fileUrl:   data.fileUrl,
                time:      time
              });
           }
            
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

            if (data.msgType === 'file' || data.type === 'file') {
                saveMessage(data.senderId, {
                senderId:  data.senderId,
                message:   data.message || '',
                type:      'received',
                msgType:   'file',
                fileName:  data.fileName,
                fileUrl:   data.fileUrl,
                time:      time
            });
        }
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
  /*   socket.on('incoming_call', (data) => {
        const accept = confirm(`📹 Llamada entrante de ${data.callerName}. ¿Aceptar?`);
         if (accept) {
        // Esperar a que myPeer esté listo antes de enviar call_accepted
        const waitForPeerId = () => {
            if (window.myPeerId) {
                socket.emit('call_accepted', {
                    callerId: data.callerId,
                    peerId: window.myPeerId
                });
            } else {
                setTimeout(waitForPeerId, 100);
            }
            };
        waitForPeerId();
        } else {
            socket.emit('call_rejected', { callerId: data.callerId });
            showToast('Llamada rechazada', 'info');
        }
    }); */

   /*  socket.on('call_accepted', (data) => {
        // El otro usuario aceptó — hacer la llamada PeerJS real
        if (myPeer && localStream && data.peerId) {
            const call = myPeer.call(data.peerId, localStream);
            currentCall = call;
            call.on('stream', (remoteStream) => {
                showRemoteStream(remoteStream);
                document.getElementById('vc-connecting').style.display = 'none';
            });
            call.on('close', () => endCall());
        } else {
        console.warn('No se pudo iniciar llamada: peerId o stream faltante');
        endCall();
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
 */
} catch(e) {
    console.warn('Socket.io no cargado:', e);
}

// ─── CHAT STATE ───────────────────────────────────────────
let currentChat   = { type:'group', id:'grupo_tour', name:'Grupo Tour Estadio', avatarType:'group' };
window.currentChat = currentChat; // exponer para videocall_enhanced.js
let pendingFile   = null;
let pendingFileUrl = null;
let userPoints    = currentUser.points || 0; // usar valor real de Firebase
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
    window.currentChat = currentChat; // sincronizar con videocall_enhanced.js
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
        
 // Si es chat privado (no grupo ni IA)
        const statusEl = document.getElementById(`status-${id}`);
        const uStatus = (statusEl && statusEl.classList.contains('online')) ? 'online' 
                       : (statusEl && statusEl.classList.contains('away'))   ? 'away' 
                       : (statusEl && statusEl.classList.contains('busy'))   ? 'busy' 
                       : 'offline';

        const statusColors = { online: 'var(--success)', offline: 'var(--muted)', away: 'var(--warning)', busy: 'var(--danger)' };
        const statusElText = document.getElementById('current-chat-status');
        if (statusElText) statusElText.innerHTML = `<i class="fas fa-circle" style="color:${statusColors[uStatus]};font-size:.55rem"></i> ${uStatus==='online'?'En línea':'Desconectado'}`;

        // Mostrar botón de videollamada SOLO si el contacto está en línea
        const vcBtn = document.getElementById('videocall-btn');
        const emailBtn = document.getElementById('email-chat-btn');
        if (vcBtn) vcBtn.style.display = uStatus === 'online' ? 'flex' : 'none';
        if (emailBtn) emailBtn.style.display = 'flex';

        // Avatar y nombres
        const avatarEl = document.getElementById('current-chat-avatar');
        if (avatarEl) avatarEl.innerHTML = `<img src="https://api.dicebear.com/7.x/adventurer/svg?seed=${id}" style="width:100%;height:100%;border-radius:10px;" alt="">`;
        const remoteNameEl = document.getElementById('vc-remote-name');
        const callerNameEl = document.getElementById('vc-caller-name');
        const remoteAvatarEl = document.getElementById('vc-remote-avatar');
        if (remoteNameEl) remoteNameEl.textContent = name;
        if (callerNameEl) callerNameEl.textContent = `Llamando a ${name}`;
        if (remoteAvatarEl) remoteAvatarEl.src = `https://api.dicebear.com/7.x/adventurer/svg?seed=${id}`;
    }

     // Cargar historial — Firestore tiene prioridad, localStorage como fallback
    if (window.db_loadMessages && id !== 'asistente_ia') {
        // Mostrar localStorage inmediatamente mientras carga Firestore
        const savedLocal = loadMessages(id);
        if (savedLocal.length > 0) {
            savedLocal.forEach(m => {
                const msgType = m.senderId === currentUser.name ? 'sent' : (m.type || 'received');
                appendMessage(m.message, msgType, m.senderId, m.time, m.fileUrl, m.fileName, m.msgType, m.locationUrl);
            });
        }
        // Luego cargar Firestore y reemplazar si hay más mensajes
        window.db_loadMessages(id).then(firestoreMsgs => {
            if (firestoreMsgs.length > 0) {
                const msgs = document.getElementById('chat-messages');
                msgs.innerHTML = '<div class="day-divider"><span>Hoy</span></div>';
                firestoreMsgs.forEach(m => {
                    // Determinar sent/received basado en quién envió, no en el campo guardado
                    const msgType = m.senderId === currentUser.name ? 'sent' : 'received';
                    appendMessage(
                        m.message, msgType, m.senderId,
                        m.time, m.fileUrl, m.fileName, m.type, m.locationUrl
                    );
                });
            }
        }).catch(() => {}); // ya está mostrando localStorage, no hacer nada en error
    } else {
        // Asistente IA — solo localStorage
        const saved = loadMessages(id);
        if (saved.length > 0) {
            saved.forEach(m => appendMessage(m.message, m.type||'received', m.senderId, m.time, m.fileUrl, m.fileName, m.msgType, m.locationUrl));
        } else if (id === 'asistente_ia') {
            appendMessage('¡Hola! Soy tu Asistente IA del FIFA 2026 🤖⚽. ¿En qué te puedo ayudar?','received','🤖 Asistente IA', new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
        } else if (type==='group' && id==='grupo_tour') {
            appendMessage('¡Hola a todos! ¿A qué hora nos vemos para ir al estadio? 🏟️','received','Turista 23','10:00 AM');
            appendMessage('Yo sugiero tomar el metro a las 12:00 PM ⚽','sent',null,'10:05 AM');
            appendMessage('Perfecto. Les comparto la ruta 📍','received','Guía Carlos','10:07 AM',null,null,'location','https://maps.google.com?q=25.6866,-100.3161');
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

    // ── Separador de fecha ──────────────────────────────────────
    const todayStr = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
    const lastDiv  = msgs.lastElementChild;
    const lastDate = lastDiv?.dataset?.date;
    if (lastDate !== todayStr) {
        const sep = document.createElement('div');
        sep.className   = 'day-divider';
        sep.dataset.date = todayStr;
        sep.innerHTML   = `<span>${todayStr}</span>`;
        // solo agregar si no hay ya uno con la misma fecha
        if (!msgs.querySelector(`.day-divider[data-date="${todayStr}"]`)) {
            msgs.appendChild(sep);
        }
    }

    const div = document.createElement('div');
    div.classList.add('message', type);

    if (type === 'sent' && currentUser.equipped && currentUser.equipped['msg-bg']) {
        div.classList.add(currentUser.equipped['msg-bg']);
    }

    let inner = '';

    // Nombre del remitente (para mensajes recibidos y grupos)
    if (type === 'received' && sender) {
        inner += `<div class="msg-sender">${escHtml(sender)}</div>`;
    }

    // Texto del mensaje
    if (text) inner += `<p>${escHtml(text)}</p>`;

    // Ubicación
    if (msgType === 'location' || locationUrl) {
        const url = locationUrl || '#';
        inner += `<div class="location-msg">
            <i class="fas fa-map-marker-alt"></i>
            <span>Ubicación</span>
            <a href="${escHtml(url)}" target="_blank" rel="noopener" style="color:var(--teal);font-size:0.8rem;display:flex;align-items:center;gap:4px;margin-top:4px;">
                <i class="fas fa-external-link-alt"></i> Ver ubicación en Google Maps
            </a>
        </div>`;
    }

    // Archivo adjunto — soporte para imagen, PDF, video, audio, otros
    if ((msgType === 'file' || fileName) && fileName) {
        const ext  = fileName.split('.').pop().toLowerCase();
        const isImg   = /^(jpg|jpeg|png|gif|webp|svg|bmp)$/.test(ext);
        const isPdf   = ext === 'pdf';
        const isVideo = /^(mp4|webm|mov|avi)$/.test(ext);
        const isAudio = /^(mp3|ogg|wav|m4a)$/.test(ext);

        if (isImg && fileUrl) {
            inner += `<div class="msg-file">
                <img src="${escHtml(fileUrl)}" alt="${escHtml(fileName)}"
                     style="max-width:220px;max-height:200px;border-radius:8px;cursor:pointer;object-fit:cover;"
                     onclick="window.open('${escHtml(fileUrl)}','_blank')">
                <div style="font-size:0.72rem;color:var(--muted);margin-top:4px;">${escHtml(fileName)}</div>
            </div>`;
        } else if (isVideo && fileUrl) {
            inner += `<div class="msg-file">
                <video src="${escHtml(fileUrl)}" controls style="max-width:220px;border-radius:8px;"></video>
                <div style="font-size:0.72rem;color:var(--muted);margin-top:4px;">${escHtml(fileName)}</div>
            </div>`;
        } else if (isAudio && fileUrl) {
            inner += `<div class="msg-file">
                <audio src="${escHtml(fileUrl)}" controls style="width:200px;"></audio>
                <div style="font-size:0.72rem;color:var(--muted);margin-top:4px;">${escHtml(fileName)}</div>
            </div>`;
        } else if (isPdf && fileUrl) {
            inner += `<div class="msg-file" style="display:flex;align-items:center;gap:10px;">
                <i class="fas fa-file-pdf" style="font-size:1.8rem;color:#e74c3c;flex-shrink:0;"></i>
                <div>
                    <strong style="font-size:0.85rem;">${escHtml(fileName)}</strong><br>
                    <a href="${escHtml(fileUrl)}" target="_blank" rel="noopener"
                       style="font-size:0.75rem;color:var(--teal);">Abrir PDF <i class="fas fa-external-link-alt"></i></a>
                </div>
            </div>`;
        } else {
            const icons = { zip:'fa-file-zipper', doc:'fa-file-word', docx:'fa-file-word',
                            xls:'fa-file-excel', xlsx:'fa-file-excel', ppt:'fa-file-powerpoint',
                            pptx:'fa-file-powerpoint', txt:'fa-file-lines' };
            const icon = icons[ext] || 'fa-file';
            inner += `<div class="msg-file" style="display:flex;align-items:center;gap:10px;">
                <i class="fas ${icon}" style="font-size:1.8rem;color:var(--gold);flex-shrink:0;"></i>
                <div>
                    <strong style="font-size:0.85rem;">${escHtml(fileName)}</strong><br>
                    ${fileUrl ? `<a href="${escHtml(fileUrl)}" target="_blank" rel="noopener"
                       style="font-size:0.75rem;color:var(--teal);">Descargar <i class="fas fa-download"></i></a>` : '<small style="color:var(--muted)">Archivo adjunto</small>'}
                </div>
            </div>`;
        }
    }

    // Hora + checkmarks
    inner += `<div class="msg-meta-row">
        <span class="time" style="font-size:0.67rem;color:var(--muted);">${escHtml(time||'')}</span>
        ${type==='sent' ? '<i class="fas fa-check-double" style="font-size:0.6rem;color:var(--teal);"></i>' : ''}
    </div>`;

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

    // Timeout de 30 segundos para no dejar congelado el botón
    const uploadTimeout = setTimeout(() => {
        sendBtn.disabled  = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
        showToast('⏱️ La subida tardó demasiado. Revisa tu conexión.', 'error');
    }, 30000);

    try {
        let fileUrl = null;
        let uploadedName = pendingFile.name;

        if (window.db_uploadFile) {
            try {
                const result = await window.db_uploadFile(pendingFile, 'chat-files');
                fileUrl = result.url;
                showToast('✅ Archivo subido a la nube', 'success');
            } catch(storageErr) {
                console.warn('⚠️ Firebase Storage falló, usando URL local como fallback:', storageErr.message);
                // Fallback: base64 para imágenes pequeñas, URL object para el resto
                if (pendingFile.type.startsWith('image/') && pendingFile.size < 500*1024) {
                    fileUrl = await new Promise(resolve => {
                        const r = new FileReader();
                        r.onload = e => resolve(e.target.result);
                        r.readAsDataURL(pendingFile);
                    });
                    showToast('⚠️ Sin Storage: imagen guardada localmente', 'info');
                } else {
                    fileUrl = URL.createObjectURL(pendingFile);
                    showToast('⚠️ Sin Storage: archivo solo visible en este dispositivo', 'info');
                }
            }
        } else {
            fileUrl = URL.createObjectURL(pendingFile);
            showToast('⚠️ Sin Storage configurado', 'info');
        }

        clearTimeout(uploadTimeout);

        appendMessage('', 'sent', null, time, fileUrl, uploadedName, 'file');
        const msgData = { senderId:currentUser.name, type:'sent', msgType:'file', fileName:uploadedName, fileUrl, time };
        saveMessage(currentChat.id, msgData);

        if (socket?.connected) {
            const payload = {
                groupId:currentChat.id, receiverId:currentChat.id,
                senderId:currentUser.name, message:'', type:'file',
                fileName:uploadedName, fileUrl, time
            };
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
        clearTimeout(uploadTimeout);
        console.error('❌ Error al subir archivo:', err);
        showToast('Error: ' + (err.message || 'No se pudo subir el archivo'), 'error');
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
    if (userPoints < cost) {
        showToast('❌ No tienes suficientes puntos (necesitas ' + (cost - userPoints) + ' pts más)', 'error');
        return;
    }
    userPoints -= cost;
    currentUser.points = userPoints;
    currentUser.inventory.push(itemId);
    currentUser.equipped[type] = cssClass;
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
/* function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    if (id === 'videocall-modal') {
        if (!_closingVideoCallModal) {
            _closingVideoCallModal = true;
            endCall();
            _closingVideoCallModal = false;
        }
    }
    if (id === 'file-modal') resetFileModal();
} */

// REEMPLAZA closeModal() en app.js con esta versión:
function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    if (id === 'videocall-modal') {
        // endCall ya maneja el cierre del modal internamente
        // así que solo lo llamamos si la llamada sigue activa
        if (typeof window.endCall === 'function') window.endCall();
    }
    if (id === 'file-modal') resetFileModal();
}

function closeModalOutside(event, id) {
    if (event.target.id===id) closeModal(id);
}

/* function openVideoCall() {
    if (typeof window.openVideoCall === 'function') {
        window.openVideoCall();
    }
} */

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
    window.currentUser = currentUser; // asegurar que videocall_enhanced.js lo vea
    window.currentChat = currentChat;

     setTimeout(loadRealUsers, 1500); // espera que Firestore cargue

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

// 1. Variables globales para mantener los datos en memoria
let allDBUsers = [];
let usersSnapshotUnsubscribe = null;

async function loadRealUsers() {
    // Asegurar que exista el array de amigos en la sesión actual
    if (!currentUser.friends) {
        currentUser.friends = ['Asistente IA 🤖']; // Amigo por defecto
        saveUser();
    }
    
    try {
        // Esperar a que firestore_integration.js cargue
        let intentos = 0;
        while (!window.__FIRESTORE_READY__ && intentos < 20) {
            await new Promise(r => setTimeout(r, 300));
            intentos++;
        }

        // Leer usuarios directo de Firestore — onSnapshot importado para tiempo real
        const { getFirestore, collection, getDocs, onSnapshot } = await import(
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

        // Carga inicial: llenar allDBUsers de inmediato para que addFriend funcione sin esperar
        const snap = await getDocs(collection(db, 'users'));
        allDBUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderFriendsList();

        // Si ya hay un listener activo, lo cancelamos para no duplicar
        if (usersSnapshotUnsubscribe) usersSnapshotUnsubscribe();

        // Listener en tiempo real: mantiene allDBUsers fresco y redibuja la UI
        usersSnapshotUnsubscribe = onSnapshot(collection(db, 'users'), (snap) => {
            allDBUsers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderFriendsList();
        });


    } catch(e) {
        console.warn('No se pudieron cargar usuarios desde Firestore:', e);
    }
}
window.loadRealUsers = loadRealUsers;

// 3. FUNCIÓN QUE DIBUJA LA LISTA EN PANTALLA
function renderFriendsList() {
    const list = document.getElementById('contacts');
    const selector = document.querySelector('.user-selector');
    
    if (list) list.innerHTML = ''; // Limpiamos la lista
    if (selector) selector.innerHTML = '';

    // A) Renderizar al Asistente IA SIEMPRE (Porque no vive en Firebase)
    if (list && currentUser.friends.includes('Asistente IA 🤖')) {
        const aiLi = document.createElement('li');
        aiLi.className = 'contact-item';
        if (currentChat.id === 'asistente_ia') aiLi.classList.add('active-chat');
        aiLi.onclick = () => selectChat('private', 'asistente_ia', 'Asistente IA 🤖', 'user', aiLi);
        aiLi.innerHTML = `
            <div class="contact-avatar">
                <div style="background:var(--teal); width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">🤖</div>
                <span class="status-indicator online"></span>
            </div>
            <div class="contact-info">
                <span class="contact-name">Asistente IA 🤖</span>
                <span class="contact-preview">Siempre disponible</span>
            </div>`;
        list.appendChild(aiLi);
    }

    // B) Recorrer todos los usuarios de la base de datos
    allDBUsers.forEach(u => {
        if (u.name === currentUser.name) return; // No mostrarse a uno mismo

        // Llenar el modal de "Crear Grupo"
        if (selector) {
            const item = document.createElement('div');
            item.className = 'user-check-item';
            item.innerHTML = `
                <img src="${u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.name}`}" alt="">
                <div>
                    <strong>${escHtml(u.name)}</strong>
                    <span class="${u.status === 'online' ? 'online-tag' : 'offline-tag'}">
                        ${u.status === 'online' ? '🟢 En línea' : (u.status === 'busy' ? '🔴 Ocupado' : '⚫ Desconectado')}
                    </span>
                </div>
                <input type="checkbox" value="${escHtml(u.name)}">`;
            selector.appendChild(item);
        }

        // C) Llenar la barra lateral SOLO si es amigo
        if (currentUser.friends && currentUser.friends.includes(u.name) && list) {
            const li = document.createElement('li');
            li.className = 'contact-item';
            if (currentChat.id === u.name) li.classList.add('active-chat');
            li.dataset.chatId = u.name;
            li.onclick = () => selectChat('private', u.name, u.name, 'user', li);
            
            li.innerHTML = `
                <div class="contact-avatar">
                    <img src="${u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.name}`}" alt="">
                  
                    <span class="status-indicator ${u.status || 'offline'}" id="status-${escHtml(u.name)}"></span>
                </div>
                <div class="contact-info">
                    <span class="contact-name">${escHtml(u.name)}</span>
                    <span class="contact-preview">${u.status === 'online' ? 'Disponible' : 'Desconectado'}</span>
                </div>
                <span class="unread-badge" id="badge-${u.name}" style="display:none">0</span>`;
            list.appendChild(li);
        }
    });
}

// ─── Función para agregar un amigo nuevo ───
window.addFriend = function() {
    const friendName = document.getElementById('friend-search-input').value.trim();
    if (!friendName) {
        showToast('Escribe un nombre de usuario', 'error');
        return;
    }
    
    if (friendName === currentUser.name) {
        showToast('No puedes agregarte a ti mismo', 'info');
        return;
    }

    // VALIDACIÓN CLAVE: Buscamos si el usuario existe ignorando mayúsculas/minúsculas
    const exactUser = allDBUsers.find(u => u.name.toLowerCase() === friendName.toLowerCase());

    if (!exactUser) {
        showToast(`El usuario "${friendName}" no existe en la app`, 'error');
        return;
    }
    
    if (!currentUser.friends.includes(exactUser.name)) {
        currentUser.friends.push(exactUser.name); // Nombre exacto tal como está en Firestore
        saveUser();
        // Forzamos la actualización guardando en Firestore si es posible
        if (window.db_updateUserProfile && window.auth?.currentUser?.uid) {
            window.db_updateUserProfile(window.auth.currentUser.uid, { friends: currentUser.friends });
        }
        showToast(`✅ ${exactUser.name} agregado a tus chats`, 'success');
        
        // Cierra el modal y redibuja la lista sin recargar de Firebase
        closeModal('add-friend-modal');
        document.getElementById('friend-search-input').value = '';
        renderFriendsList(); 
    } else {
        showToast('Este usuario ya está en tus chats', 'info');
    }
}
