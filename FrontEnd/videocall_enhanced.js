// ════════════════════════════════════════════════════════════
//  videocall_enhanced.js  v5.0  —  FIFA 2026 Tourist Hub
//
//  ARQUITECTURA:
//  ─────────────────────────────────────────────────────────
//  1. PeerJS con ICE servers (STUN múltiple) para atravesar NAT
//  2. Filtros vía canvas.captureStream() + replaceTrack()
//     → el usuario remoto VE los filtros en tiempo real
//  3. Screen-share vía getDisplayMedia() + replaceTrack()
//     → el usuario remoto VE la pantalla en tiempo real
//  4. Modal propio para llamadas entrantes (no confirm())
//  5. Al desconectarse cualquier usuario → ambos vuelven al chat
//  6. Reconexión automática si se cae la señal brevemente
// ════════════════════════════════════════════════════════════

'use strict';

// ── ICE servers (STUN público de Google + Twilio) ──────────────────
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302'  },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // ── TURN (descomenta y pon tus credenciales de metered.ca si tienes) ──
    // { urls: 'turn:relay.metered.ca:80',  username: 'TU_USER', credential: 'TU_PASS' },
    // { urls: 'turn:relay.metered.ca:443', username: 'TU_USER', credential: 'TU_PASS' },
];

// ── Estado global de la llamada ────────────────────────────────────
let _localStream        = null;   // stream crudo cámara+mic
let _canvasStream       = null;   // stream del canvas (con filtros)
let _screenStream       = null;   // stream de pantalla compartida
let _currentCall        = null;   // objeto PeerJS call activo
let _myPeer             = null;   // instancia PeerJS local
let _peerIdReady        = false;  // PeerJS ya tiene ID
let _vcTimerInterval    = null;
let _vcSeconds          = 0;
let _micActive          = true;
let _camActive          = true;
let _isSharingScreen    = false;
let _currentFilter      = 'none';
let _frameId            = null;
let _filterCanvas       = null;
let _filterCtx          = null;
let _callTimeout        = null;   // timeout "no respondió"
let _reconnectTimeout   = null;
let _remoteUserId       = null;   // ID del usuario remoto
let _isCallActive       = false;  // hay llamada activa
let _pendingCallData    = null;   // datos de llamada entrante pendiente

const GRADIENTS = [
    { name: 'FIFA Gold',  a: '#0A0E1A', b: '#F0C040' },
    { name: 'Teal Night', a: '#002B36', b: '#00C9A7' },
    { name: 'Sunset MTY', a: '#6B1B8A', b: '#FF6B35' },
    { name: 'Royal Blue', a: '#1b2a4a', b: '#3A86FF' },
    { name: 'Forest',     a: '#1a4a2a', b: '#52B788' },
];
let _gradIdx = 0;

// ════════════════════════════════════════════════════════════
//  INIT PEERJS  —  llamar desde socket.on('connect')
// ════════════════════════════════════════════════════════════
window.initPeer = function () {
    if (_myPeer && !_myPeer.destroyed) return;

    const user    = window.currentUser || {};
    const safeId  = (user.name || 'turista')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        + '_' + Date.now();

    let host, port, secure;
    try {
        const u  = new URL(window.__FIFA_SERVER__ || 'http://localhost:3000');
        host   = u.hostname;
        port   = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
        secure = u.protocol === 'https:';
    } catch {
        host   = 'localhost';
        port   = 3000;
        secure = false;
    }

    _myPeer = new Peer(safeId, {
        host, port, path: '/peerjs', secure, debug: 0,
        config: { iceServers: ICE_SERVERS }
    });

    _myPeer.on('open', (id) => {
        console.log('📹 PeerJS listo:', id);
        window.myPeerId = id;
        _peerIdReady    = true;
        window.socket?.emit('register_peer_id', { userId: user.name, peerId: id });
    });

    // ── Llamada PeerJS ENTRANTE (después de aceptar vía socket) ─────
    _myPeer.on('call', (call) => {
        if (!_localStream) {
            call.close();
            return;
        }
        _currentCall     = call;
        _remoteUserId    = call.peer;
        _isCallActive    = true;

        // Responder con el stream adecuado (con filtro si está activo)
        call.answer(_getStreamForWebRTC());

        call.on('stream', (remoteStream) => {
            _showRemoteStream(remoteStream);
        });

        call.on('close', () => {
            window.showToast?.('📵 La llamada fue cerrada', 'info');
            _handleCallEnded();
        });

        call.on('error', (err) => {
            console.warn('⚠️ Error en llamada entrante:', err);
            _handleCallEnded();
        });

        // Ocultar "Conectando…"
        const vc = document.getElementById('vc-connecting');
        if (vc) vc.style.display = 'none';
        _startTimer();
        window.awardPoints?.(200, 'Realizaste una videollamada');
        document.getElementById('badge-vc')?.classList.add('unlocked');
    });

    _myPeer.on('error', (err) => {
        console.warn('⚠️ PeerJS error:', err.type, err);
        if (err.type === 'peer-unavailable') {
            window.showToast?.('📵 El usuario no está disponible', 'error');
            _handleCallEnded();
        }
        if (err.type === 'disconnected') {
            // Intentar reconectar PeerJS
            setTimeout(() => { try { _myPeer?.reconnect(); } catch(e){} }, 2000);
        }
    });

    _myPeer.on('disconnected', () => {
        console.warn('⚠️ PeerJS desconectado — intentando reconectar...');
        setTimeout(() => { try { _myPeer?.reconnect(); } catch(e){} }, 1500);
    });

    window.myPeer = _myPeer;
};

// ════════════════════════════════════════════════════════════
//  SOCKET LISTENERS para videollamada
//  Registra estos listeners desde app.js una sola vez.
// ════════════════════════════════════════════════════════════
window.registerCallSocketListeners = function (socket) {
    if (socket._callListenersRegistered) return;
    socket._callListenersRegistered = true;

    // ── Llamada ENTRANTE ─────────────────────────────────────────
    socket.on('incoming_call', (data) => {
        if (_isCallActive) {
            // Ya estoy en llamada — rechazar automáticamente
            socket.emit('call_rejected', { callerId: data.callerId, reason: 'ocupado' });
            return;
        }
        _pendingCallData = data;
        _showIncomingCallModal(data);
    });

    // ── El otro aceptó → hacer la llamada PeerJS ─────────────────
    socket.on('call_accepted', (data) => {
        clearTimeout(_callTimeout);
        if (!_myPeer || !_localStream || !data.peerId) {
            window.showToast?.('No se pudo establecer la conexión', 'error');
            _handleCallEnded();
            return;
        }
        const call    = _myPeer.call(data.peerId, _getStreamForWebRTC(), {
            sdpTransform: (sdp) => sdp.replace('b=AS:30', 'b=AS:2000') // mayor bitrate
        });
        _currentCall  = call;
        _isCallActive = true;

        call.on('stream', (remoteStream) => {
            clearTimeout(_callTimeout);
            _showRemoteStream(remoteStream);
        });

        call.on('close', () => {
            window.showToast?.('📵 El otro usuario colgó', 'info');
            _handleCallEnded();
        });

        call.on('error', (err) => {
            console.warn('⚠️ Error en llamada:', err);
            _handleCallEnded();
        });
    });

    // ── Rechazó o no contestó ────────────────────────────────────
    socket.on('call_rejected', (data) => {
        clearTimeout(_callTimeout);
         let mensaje = 'rechazó la llamada';
         if (data?.reason === 'ocupado') mensaje = 'está en otra llamada';
    else if (data?.reason === 'offline') mensaje = 'no está en línea';
    window.showToast?.(`📵 El usuario ${mensaje}`, 'info');
    _handleCallEnded();
        /* 
        const reason = data?.reason === 'ocupado' ? 'está en otra llamada' : 'rechazó la llamada';
        window.showToast?.(`📵 El usuario ${reason}`, 'info');
        _handleCallEnded(); */
    });

    // ── El otro colgó ────────────────────────────────────────────
    socket.on('call_ended', () => {
        if (_isCallActive) {
            window.showToast?.('📵 El otro usuario colgó', 'info');
            _handleCallEnded();
        }
    });
};

// ════════════════════════════════════════════════════════════
//  ABRIR VIDEOLLAMADA (llama tú)
// ════════════════════════════════════════════════════════════
window.openVideoCall = async function () {
    const chat = window.currentChat || {};
    if (chat.type !== 'private') {
        window.showToast?.('Las videollamadas son solo en chats privados', 'info');
        return;
    }
    if (_isCallActive) {
        window.showToast?.('Ya estás en una llamada activa', 'info');
        return;
    }

    // Verificar que el contacto esté en línea
    const statusEl = document.getElementById(`status-${chat.id}`);
    if (statusEl && !statusEl.classList.contains('online')) {
        window.showToast?.(`📵 ${chat.name} no está en línea`, 'error');
        return;
    }
    /* else {
    // Fallback: si no tiene indicador, asumir offline (mejor prevenir)
    window.showToast?.(`📵 ${chat.name} no está en línea`, 'error');
    return;
 */
}

    // Pedir cámara ANTES de mostrar el modal
    try {
        await _startCamera();
    } catch (err) {
        window.showToast?.('Activa cámara y micrófono en tu navegador', 'error');
        return;
    }

    _remoteUserId = chat.id;
    _openCallModal(chat.name, chat.id);

    const vc = document.getElementById('vc-connecting');
    if (vc) { vc.style.display = 'flex'; }

    if (window.socket?.connected) {
        window.socket.emit('call_user', {
            callerId:   (window.currentUser || {}).name,
            callerName: (window.currentUser || {}).name,
            receiverId: chat.id,
            peerId:     window.myPeerId || _myPeer?.id || ''
        });
        window.showToast?.(`📞 Llamando a ${chat.name}…`, 'info');

        // Timeout de 35 s → cancelar si no responde
        _callTimeout = setTimeout(() => {
            window.showToast?.(`⏱️ ${chat.name} no respondió`, 'info');
            _handleCallEnded();
        }, 35000);
    } else {
        // Modo demo (sin servidor)
        setTimeout(() => {
            const c = document.getElementById('vc-connecting');
            if (c) c.style.display = 'none';
            _startTimer();
            window.showToast?.('📹 Modo demo activo (sin servidor)', 'info');
        }, 2000);
    }
};

// ════════════════════════════════════════════════════════════
//  MODAL DE LLAMADA ENTRANTE
// ════════════════════════════════════════════════════════════
function _showIncomingCallModal(data) {
    const modal = document.getElementById('incoming-call-modal');
    if (!modal) {
        // Fallback: confirm() si no existe el modal en el HTML
        const accept = confirm(`📹 Llamada de ${data.callerName}. ¿Aceptar?`);
        if (accept) _acceptCall(data);
        else _rejectCall(data);
        return;
    }

    const nameEl   = document.getElementById('ic-caller-name');
    const avatarEl = document.getElementById('ic-caller-avatar');
    if (nameEl)   nameEl.textContent = data.callerName || 'Usuario';
    if (avatarEl) avatarEl.src = `https://api.dicebear.com/7.x/adventurer/svg?seed=${data.callerId || 'user'}`;

    modal.classList.add('open');

    // Sonido de llamada entrante (breve)
    _playRingtone(true);

    // Auto-rechazar en 35 s si no hay respuesta
    window._incomingCallTimeout = setTimeout(() => {
        _rejectCall(data);
        window.showToast?.('Llamada perdida', 'info');
    }, 35000);
}

function _hideIncomingCallModal() {
    const modal = document.getElementById('incoming-call-modal');
    if (modal) modal.classList.remove('open');
    _playRingtone(false);
    clearTimeout(window._incomingCallTimeout);
}

// Botones del modal de llamada entrante
window.acceptIncomingCall = async function () {
    _hideIncomingCallModal();
    if (!_pendingCallData) return;
    const data = _pendingCallData;
    _pendingCallData = null;

    try {
        await _startCamera();
    } catch {
        window.showToast?.('No se pudo acceder a cámara/micrófono', 'error');
        _rejectCall(data);
        return;
    }

    _remoteUserId = data.callerId;
    _openCallModal(data.callerName, data.callerId);

    const waitForPeer = (attempts = 0) => {
        if (window.myPeerId) {
            window.socket?.emit('call_accepted', {
                callerId: data.callerId,
                peerId:   window.myPeerId
            });
        } else if (attempts < 20) {
            setTimeout(() => waitForPeer(attempts + 1), 150);
        } else {
            window.showToast?.('No se pudo iniciar la llamada', 'error');
            _handleCallEnded();
        }
    };
    waitForPeer();
};

window.rejectIncomingCall = function () {
    _hideIncomingCallModal();
    if (!_pendingCallData) return;
    _rejectCall(_pendingCallData);
    _pendingCallData = null;
};

function _rejectCall(data) {
    window.socket?.emit('call_rejected', { callerId: data.callerId });
    window.showToast?.('Llamada rechazada', 'info');
}

function _acceptCall(data) {
    window.acceptIncomingCall();
}

// ── Ringtone sencillo con Web Audio API ───────────────────────────
let _ringtoneInterval = null;
function _playRingtone(start) {
    if (!start) {
        clearInterval(_ringtoneInterval);
        return;
    }
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const play = () => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
            osc.start();
            osc.stop(ctx.currentTime + 0.6);
        };
        play();
        _ringtoneInterval = setInterval(play, 1500);
    } catch (e) { /* navegador sin AudioContext */ }
}

// ════════════════════════════════════════════════════════════
//  ABRIR/CONFIGURAR MODAL DE VIDEOLLAMADA ACTIVA
// ════════════════════════════════════════════════════════════
function _openCallModal(remoteName, remoteId) {
    const modal = document.getElementById('videocall-modal');
    if (modal) modal.classList.add('open');

    const nameEl   = document.getElementById('vc-remote-name');
    const callerEl = document.getElementById('vc-caller-name');
    const avatarEl = document.getElementById('vc-remote-avatar');

    if (nameEl)   nameEl.textContent   = remoteName || 'Usuario';
    if (callerEl) callerEl.textContent = `Llamando a ${remoteName}…`;
    if (avatarEl) avatarEl.src         = `https://api.dicebear.com/7.x/adventurer/svg?seed=${remoteId || 'user'}`;

    document.getElementById('vc-timer').textContent = '00:00';
    _resetControlsUI();
}

// ════════════════════════════════════════════════════════════
//  INICIAR CÁMARA Y MIC
// ════════════════════════════════════════════════════════════
async function _startCamera() {
    if (_localStream) return;
    _localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const lv = document.getElementById('local-stream');
    if (lv) { lv.muted = true; lv.srcObject = _localStream; }

    _ensureFilterCanvas();
    window.localStream = _localStream;
}

// ── Canvas de filtros ──────────────────────────────────────────────
function _ensureFilterCanvas() {
    if (_filterCanvas) return;
    _filterCanvas = document.getElementById('filter-canvas');
    if (_filterCanvas) {
        _filterCtx = _filterCanvas.getContext('2d', { willReadFrequently: true });
    }
}

// ── ¿Qué stream enviar por WebRTC? ───────────────────────────────
function _getStreamForWebRTC() {
    if (_isSharingScreen && _screenStream) return _screenStream;
    if (_canvasStream && _currentFilter !== 'none') return _canvasStream;
    return _localStream;
}

// ── Reemplazar track de video en conexión WebRTC activa ──────────
function _replaceVideoTrack(newTrack) {
    if (!newTrack || !_currentCall?.peerConnection) return;
    const sender = _currentCall.peerConnection
        .getSenders()
        .find(s => s.track?.kind === 'video');
    if (sender) {
        sender.replaceTrack(newTrack).catch(e =>
            console.warn('replaceTrack error:', e)
        );
    }
}

// ════════════════════════════════════════════════════════════
//  MOSTRAR STREAM REMOTO
// ════════════════════════════════════════════════════════════
function _showRemoteStream(remoteStream) {
    const rv  = document.getElementById('remote-stream');
    const ph  = document.getElementById('vc-placeholder');
    const vc  = document.getElementById('vc-connecting');

    if (rv)  { rv.srcObject = remoteStream; rv.style.display = 'block'; }
    if (ph)  ph.style.display = 'none';
    if (vc)  vc.style.display = 'none';

    const callerEl = document.getElementById('vc-caller-name');
    if (callerEl) callerEl.textContent = _remoteUserId || 'Conectado';

    _isCallActive = true;
    _startTimer();
    window.showToast?.('📹 Videollamada conectada', 'success');
    window.awardPoints?.(200, 'Realizaste una videollamada');
    document.getElementById('badge-vc')?.classList.add('unlocked');
}
window.showRemoteStream = _showRemoteStream;

// ════════════════════════════════════════════════════════════
//  FINALIZAR LLAMADA — limpieza completa
// ════════════════════════════════════════════════════════════
function _handleCallEnded() {
    if (!_isCallActive && !_currentCall && !_localStream) {
        // Ya limpiado, solo cerrar modal
        document.getElementById('videocall-modal')?.classList.remove('open');
        document.getElementById('incoming-call-modal')?.classList.remove('open');
        return;
    }
    _isCallActive = false;

    clearInterval(_vcTimerInterval);
    clearTimeout(_callTimeout);
    clearTimeout(_reconnectTimeout);

    // Detener loop de filtros
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }

    // Detener todos los tracks
    _localStream?.getTracks().forEach(t => t.stop());
    _screenStream?.getTracks().forEach(t => t.stop());

    _localStream     = null;
    _canvasStream    = null;
    _screenStream    = null;
    _isSharingScreen = false;
    _currentFilter   = 'none';
    _camActive       = true;
    _micActive       = true;
    _remoteUserId    = null;

    // Limpiar canvas
    if (_filterCanvas) {
        _filterCtx?.clearRect(0, 0, _filterCanvas.width, _filterCanvas.height);
        _filterCanvas.style.display = 'none';
    }
    _filterCanvas = null;
    _filterCtx    = null;

    // Cerrar llamada PeerJS
    try { _currentCall?.close(); } catch(e) {}
    _currentCall = null;

    // Limpiar elementos de video
    ['local-stream', 'remote-stream'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.pause?.();
        el.srcObject = null;
        if (id === 'remote-stream') el.style.display = 'none';
    });

    // Restaurar placeholder
    const ph = document.getElementById('vc-placeholder');
    if (ph) ph.style.display = 'flex';

    _resetControlsUI();
    _playRingtone(false);

    // Cerrar modales
    document.getElementById('videocall-modal')?.classList.remove('open');
    document.getElementById('incoming-call-modal')?.classList.remove('open');
    document.getElementById('filter-panel')?.style && (document.getElementById('filter-panel').style.display = 'none');

    const badge = document.getElementById('filter-badge');
    if (badge) badge.style.display = 'none';

    window.localStream = null;
}

// Función pública
window.endCall = function () {
    _handleCallEnded();
    window.socket?.emit('call_ended', { receiverId: _remoteUserId || window.currentChat?.id });
    window.showToast?.('Llamada finalizada', 'info');
};

// ════════════════════════════════════════════════════════════
//  FILTROS DE CÁMARA  —  visible para el usuario remoto
// ════════════════════════════════════════════════════════════
window.setVCFilter = function (name) {
    _currentFilter = name;

    document.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === name)
    );

    const badge  = document.getElementById('filter-badge');
    const labels = { blur: '✨ Desenfoque', gradient: '🎨 Gradiente', bw: '⬛ B&N', pixelate: '🎮 Pixelado' };
    if (badge) {
        badge.textContent   = labels[name] || '';
        badge.style.display = name !== 'none' ? 'inline-flex' : 'none';
    }

    if (name === 'none') {
        _stopFilterLoop();
    } else {
        _startFilterLoop();
    }
};

// ── Iniciar loop de canvas ────────────────────────────────────────
function _startFilterLoop() {
    _ensureFilterCanvas();
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
    if (!_filterCanvas || !_localStream) return;

    // Mostrar canvas superpuesto
    _filterCanvas.style.display = 'block';

    // Crear canvas stream UNA sola vez y mandarlo por WebRTC
    if (!_canvasStream) {
        _canvasStream = _filterCanvas.captureStream(30);
        // Añadir audio del stream original
        _localStream.getAudioTracks().forEach(t => {
            if (!_canvasStream.getAudioTracks().length) _canvasStream.addTrack(t);
        });
        // Reemplazar video track en WebRTC → el remoto ve el filtro
        const vt = _canvasStream.getVideoTracks()[0];
        if (vt) _replaceVideoTrack(vt);
    }

    const srcVid = document.getElementById('local-stream');
    const draw   = () => {
        if (_currentFilter === 'none' || !_filterCtx || !_filterCanvas || !srcVid) return;
        if (srcVid.readyState < 2 || !srcVid.videoWidth) {
            _frameId = requestAnimationFrame(draw);
            return;
        }

        if (_filterCanvas.width !== srcVid.videoWidth) {
            _filterCanvas.width  = srcVid.videoWidth  || 640;
            _filterCanvas.height = srcVid.videoHeight || 480;
        }
        _filterCtx.drawImage(srcVid, 0, 0, _filterCanvas.width, _filterCanvas.height);

        switch (_currentFilter) {
            case 'blur':     _fBlur();     break;
            case 'gradient': _fGradient(); break;
            case 'bw':       _fBW();       break;
            case 'pixelate': _fPixelate(); break;
        }
        _frameId = requestAnimationFrame(draw);
    };

    if (srcVid.videoWidth > 0) {
        _filterCanvas.width  = srcVid.videoWidth;
        _filterCanvas.height = srcVid.videoHeight;
        _frameId = requestAnimationFrame(draw);
    } else {
        srcVid.addEventListener('loadedmetadata', () => {
            _filterCanvas.width  = srcVid.videoWidth  || 640;
            _filterCanvas.height = srcVid.videoHeight || 480;
            _frameId = requestAnimationFrame(draw);
        }, { once: true });
    }
}

function _stopFilterLoop() {
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
    if (_filterCanvas) _filterCanvas.style.display = 'none';

    // Restaurar track de cámara en WebRTC
    _canvasStream = null;
    const ct = _localStream?.getVideoTracks()[0];
    if (ct) { ct.enabled = _camActive; _replaceVideoTrack(ct); }
}

// ── Implementaciones de filtros ───────────────────────────────────
function _fBlur() {
    const c = _filterCanvas, ctx = _filterCtx, w = c.width, h = c.height;
    const snap = ctx.getImageData(0, 0, w, h);
    ctx.filter = 'blur(22px)';
    ctx.drawImage(document.getElementById('local-stream'), 0, 0, w, h);
    ctx.filter = 'none';
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w * .5, h * .47, w * .32, h * .46, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.putImageData(snap, 0, 0);
    ctx.restore();
    const vg = ctx.createRadialGradient(w * .5, h * .47, h * .37, w * .5, h * .47, h * .52);
    vg.addColorStop(0, 'transparent'); vg.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

function _fGradient() {
    const c = _filterCanvas, ctx = _filterCtx, w = c.width, h = c.height;
    const g   = GRADIENTS[_gradIdx];
    const snap = ctx.getImageData(0, 0, w, h);
    const grd  = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, g.a); grd.addColorStop(1, g.b);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w * .5, h * .47, w * .32, h * .46, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.putImageData(snap, 0, 0);
    ctx.restore();
    const fade = ctx.createRadialGradient(w * .5, h * .47, h * .35, w * .5, h * .47, h * .53);
    fade.addColorStop(0, 'transparent'); fade.addColorStop(1, g.a);
    ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
    ctx.font = '600 13px Outfit,Arial'; ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(g.name, 12, h - 12);
}

function _fBW() {
    const id = _filterCtx.getImageData(0, 0, _filterCanvas.width, _filterCanvas.height);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    _filterCtx.putImageData(id, 0, 0);
}

function _fPixelate() {
    const ctx = _filterCtx, bs = 14, w = _filterCanvas.width, h = _filterCanvas.height;
    for (let y = 0; y < h; y += bs) for (let x = 0; x < w; x += bs) {
        const p = ctx.getImageData(x + (bs >> 1), y + (bs >> 1), 1, 1).data;
        ctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`; ctx.fillRect(x, y, bs, bs);
    }
}

// ════════════════════════════════════════════════════════════
//  COMPARTIR PANTALLA  —  visible para el usuario remoto
// ════════════════════════════════════════════════════════════
window.toggleScreenShare = async function () {
    if (_isSharingScreen) {
        _stopScreenShare();
        return;
    }
    try {
        _screenStream    = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always', frameRate: 30 },
            audio: false
        });
        _isSharingScreen = true;

        const btn = document.getElementById('btn-screen');
        if (btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fas fa-desktop" style="color:var(--teal)"></i>'; }

        // Pausar filtros si había alguno
        if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
        if (_filterCanvas) _filterCanvas.style.display = 'none';

        // Mostrar pantalla en el video local
        const lv = document.getElementById('local-stream');
        if (lv) { lv.muted = true; lv.srcObject = _screenStream; }

        // Enviar pantalla al usuario remoto
        _replaceVideoTrack(_screenStream.getVideoTracks()[0]);

        // Si el usuario detiene desde el navegador (botón "Dejar de compartir")
        _screenStream.getVideoTracks()[0].addEventListener('ended', _stopScreenShare, { once: true });
        window.showToast?.('🖥️ Compartiendo pantalla — el otro usuario la ve', 'success');
    } catch (err) {
        if (err.name !== 'NotAllowedError') {
            window.showToast?.('No se pudo compartir la pantalla', 'error');
        }
    }
};

function _stopScreenShare() {
    if (!_isSharingScreen) return;
    _isSharingScreen = false;

    _screenStream?.getTracks().forEach(t => t.stop());
    _screenStream = null;

    const btn = document.getElementById('btn-screen');
    if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fas fa-desktop"></i>'; }

    if (!_localStream) { window.showToast?.('Dejaste de compartir pantalla', 'info'); return; }

    // Restaurar cámara en el video local
    setTimeout(() => {
        const vid = document.getElementById('local-stream');
        if (!vid) return;
        vid.pause(); vid.srcObject = null;
        setTimeout(() => {
            vid.muted = true; vid.autoplay = true; vid.srcObject = _localStream;
            vid.play().catch(() => { vid.srcObject = _localStream; });

            if (_camActive) {
                const ct = _localStream.getVideoTracks()[0];
                if (ct) {
                    ct.enabled = true;
                    // Restaurar con o sin filtro
                    if (_currentFilter !== 'none') {
                        _canvasStream = null;
                        setTimeout(_startFilterLoop, 100);
                    } else {
                        _replaceVideoTrack(ct);
                    }
                }
            }
        }, 80);
    }, 200);

    window.showToast?.('Dejaste de compartir pantalla', 'info');
}

// ════════════════════════════════════════════════════════════
//  CONTROLES DE MIC Y CÁMARA
// ════════════════════════════════════════════════════════════
window.toggleMic = function (btn) {
    _micActive = !_micActive;
    btn = btn || document.getElementById('btn-mic');
    if (btn) {
        btn.classList.toggle('muted', !_micActive);
        btn.innerHTML = _micActive ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
    _localStream?.getAudioTracks().forEach(t => t.enabled = _micActive);
    _canvasStream?.getAudioTracks().forEach(t => t.enabled = _micActive);
    window.showToast?.(_micActive ? '🎤 Micrófono activado' : '🔇 Micrófono silenciado', 'info');
};

window.toggleCam = function (btn) {
    if (_isSharingScreen) { window.showToast?.('Detén la pantalla compartida primero', 'info'); return; }
    _camActive = !_camActive;
    btn = btn || document.getElementById('btn-cam');
    if (btn) {
        btn.classList.toggle('muted', !_camActive);
        btn.innerHTML = _camActive ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    }
    _localStream?.getVideoTracks().forEach(t => t.enabled = _camActive);
    _canvasStream?.getVideoTracks().forEach(t => t.enabled = _camActive);
};

// ════════════════════════════════════════════════════════════
//  TIMER, PANTALLA COMPLETA, PANEL DE FILTROS
// ════════════════════════════════════════════════════════════
function _startTimer() {
    _vcSeconds = 0; clearInterval(_vcTimerInterval);
    _vcTimerInterval = setInterval(() => {
        _vcSeconds++;
        const el = document.getElementById('vc-timer');
        const m  = String(Math.floor(_vcSeconds / 60)).padStart(2, '0');
        const s  = String(_vcSeconds % 60).padStart(2, '0');
        if (el) el.textContent = `${m}:${s}`;
    }, 1000);
}
window.startCallTimer = _startTimer;

window.toggleFullscreen = function () {
    const el = document.querySelector('.videocall-ui');
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
};

window.toggleFilterPanel = function () {
    const panel = document.getElementById('filter-panel');
    if (!panel) return;
    const open = panel.style.display === 'block';
    panel.style.display = open ? 'none' : 'block';
    document.getElementById('btn-filter')?.classList.toggle('active', !open);
};

window.cycleGradient = function () {
    _gradIdx = (_gradIdx + 1) % GRADIENTS.length;
    const g  = GRADIENTS[_gradIdx];
    const pr = document.getElementById('gradient-preview');
    const nm = document.getElementById('gradient-name');
    if (pr) pr.style.background = `linear-gradient(135deg,${g.a},${g.b})`;
    if (nm) nm.textContent      = g.name;
    if (_currentFilter !== 'gradient') window.setVCFilter('gradient');
    window.showToast?.(`🎨 Fondo: ${g.name}`, 'info');
};

// ── Reset de la UI de controles ───────────────────────────────────
function _resetControlsUI() {
    const controls = [
        ['btn-mic',    '<i class="fas fa-microphone"></i>'],
        ['btn-cam',    '<i class="fas fa-video"></i>'],
        ['btn-screen', '<i class="fas fa-desktop"></i>'],
        ['btn-filter', null],
    ];
    controls.forEach(([id, html]) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.remove('muted', 'active');
        if (html) b.innerHTML = html;
    });
    document.querySelectorAll('.filter-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.filter === 'none'));
}

console.log('📹 videocall_enhanced.js v5.0 — stable WebRTC with replaceTrack');
