// ════════════════════════════════════════════════════════════
//  videocall_enhanced.js  v4.0
//  FIFA 2026 Tourist Hub
//
//  ARQUITECTURA DE FILTROS (definitiva):
//  ──────────────────────────────────────────────────────────
//  #local-stream (video SIEMPRE reproduciendo stream crudo)
//       │  ↓ drawImage cada frame
//  #filter-canvas (canvas SUPERPUESTO, visible cuando hay filtro)
//       │  ↓ captureStream(30)  → WebRTC (el otro ve el filtro)
//
//  Por qué funciona: el navegador siempre decodifica #local-stream
//  porque es el elemento visible principal. El canvas lee de él
//  sin ningún elemento oculto. Sin tricks de opacity ni 1px.
// ════════════════════════════════════════════════════════════

'use strict';

// ── Estado ──────────────────────────────────────────────────────
let _localStream     = null;  // stream crudo cámara+mic
let _canvasStream    = null;  // captureStream del canvas (WebRTC)
let _screenStream    = null;  // stream pantalla compartida
let _currentCall     = null;
let _myPeer          = null;
let _vcTimer         = null;
let _vcSeconds       = 0;
let _micActive       = true;
let _camActive       = true;
let _isSharingScreen = false;
let _currentFilter   = 'none';
let _frameId         = null;
let _filterCanvas    = null;  // el <canvas> superpuesto al video local
let _filterCtx       = null;

const GRADIENTS = [
    { name:'FIFA Gold',  a:'#0A0E1A', b:'#F0C040' },
    { name:'Teal Night', a:'#002B36', b:'#00C9A7' },
    { name:'Sunset MTY', a:'#6B1B8A', b:'#FF6B35' },
    { name:'Royal Blue', a:'#1b2a4a', b:'#3A86FF' },
    { name:'Forest',     a:'#1a4a2a', b:'#52B788' },
];
let _gradIdx = 0;

// ════════════════════════════════════════════════════════════
//  PEERJS
// ════════════════════════════════════════════════════════════
window.initPeer = function() {
    if (_myPeer) return;
    const user = window.currentUser || {};
    const safeId = (user.name || 'turista')
        .toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')
        + '_' + Date.now();

    const url = window.__FIFA_SERVER__ || 'http://localhost:3000';
    let p; try { p = new URL(url); } catch(e) { p = {hostname:'localhost',port:'3000',protocol:'http:'}; }

    _myPeer = new Peer(safeId, {
        host: p.hostname,
        port: Number(p.port) || (p.protocol === 'https:' ? 443 : 80),
        path: '/peerjs', secure: p.protocol === 'https:', debug: 1
    });

    _myPeer.on('open', id => {
        console.log('📹 PeerJS listo:', id);
        window.socket?.emit('register_peer_id', { userId: user.name, peerId: id });
    });

    _myPeer.on('call', call => {
        _startCamera().then(() => {
            call.answer(_getStreamForWebRTC());
            _currentCall = call;
            call.on('stream', rs => _showRemoteStream(rs));
            call.on('close',  () => window.endCall());
            window.openModal?.('videocall-modal');
            document.getElementById('vc-connecting').style.display = 'none';
            _startTimer();
            window.showToast?.('📹 Llamada entrante conectada', 'success');
            window.awardPoints?.(200, 'Realizaste una videollamada');
        }).catch(() => window.showToast?.('Activa cámara y micrófono', 'error'));
    });

    _myPeer.on('error', err => {
        if (err.type === 'peer-unavailable') {
            window.showToast?.('El usuario no está disponible', 'error');
            window.closeModal?.('videocall-modal');
        }
    });

    window.myPeer = _myPeer;
};

// ════════════════════════════════════════════════════════════
//  ABRIR VIDEOLLAMADA
// ════════════════════════════════════════════════════════════
window.openVideoCall = async function() {
    const chat = window.currentChat || {};
    if (chat.type !== 'private') {
        window.showToast?.('Las videollamadas son solo en chats privados', 'info');
        return;
    }
    window.openModal?.('videocall-modal');
    document.getElementById('vc-connecting').style.display = 'block';
    document.getElementById('vc-timer').textContent = '00:00';
    _resetUI();

    try {
        await _startCamera();
        if (window.socket?.connected) {
            const u = window.currentUser || {};
            window.socket.emit('call_user', {
                callerId: u.name, callerName: u.name,
                receiverId: chat.id, peerId: _myPeer?.id || ''
            });
            window.showToast?.(`📞 Llamando a ${chat.name}...`, 'info');
        } else {
            setTimeout(() => {
                document.getElementById('vc-connecting').style.display = 'none';
                _startTimer();
                window.showToast?.('📹 Modo demo activo', 'success');
                window.awardPoints?.(200, 'Realizaste una videollamada');
            }, 1500);
        }
    } catch(err) {
        console.error('Error cámara:', err);
        window.showToast?.('Activa cámara y micrófono en tu navegador', 'error');
        window.closeModal?.('videocall-modal');
    }
};

// ════════════════════════════════════════════════════════════
//  INICIAR CÁMARA
// ════════════════════════════════════════════════════════════
async function _startCamera() {
    if (_localStream) return;
    _localStream = await navigator.mediaDevices.getUserMedia({
        video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' },
        audio: { echoCancellation:true, noiseSuppression:true }
    });

    // Asignar al video local — este es el elemento VISIBLE que usamos como fuente
    const lv = document.getElementById('local-stream');
    if (lv) lv.srcObject = _localStream;

    // Crear el canvas de filtros superpuesto
    _ensureFilterCanvas();

    window.localStream = _localStream;
}

// ── Obtener el canvas del HTML (ya está en el DOM) ──────────────
function _ensureFilterCanvas() {
    if (_filterCanvas) return;
    _filterCanvas = document.getElementById('filter-canvas');
    if (!_filterCanvas) {
        console.error('❌ No se encontró #filter-canvas en el HTML');
        return;
    }
    _filterCtx = _filterCanvas.getContext('2d', { willReadFrequently: true });
    console.log('🎨 Canvas de filtros listo');
}

// ── Qué stream enviar por WebRTC ─────────────────────────────────
function _getStreamForWebRTC() {
    return _canvasStream || _localStream;
}

// ── Reemplazar track de video en WebRTC ──────────────────────────
function _replaceVideoTrack(track) {
    if (!track || !_currentCall?.peerConnection) return;
    const sender = _currentCall.peerConnection.getSenders()
        .find(s => s.track?.kind === 'video');
    sender?.replaceTrack(track).catch(e => console.warn('replaceTrack:', e));
}

// ════════════════════════════════════════════════════════════
//  FILTROS
// ════════════════════════════════════════════════════════════
window.setVCFilter = function(name) {
    _currentFilter = name;

    // Actualizar botones del panel
    document.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === name)
    );

    // Badge superior derecho
    const badge = document.getElementById('filter-badge');
    const labels = { blur:'✨ Desenfoque', gradient:'🎨 Gradiente', bw:'⬛ B&N', pixelate:'🎮 Pixelado' };
    if (badge) {
        badge.textContent = labels[name] || '';
        badge.style.display = (name !== 'none') ? 'inline-flex' : 'none';
    }

    if (name === 'none') {
        _stopFilters();
    } else {
        _startFilters();
    }
};

// ── Iniciar loop de filtros ──────────────────────────────────────
function _startFilters() {
    _ensureFilterCanvas();
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }

    const srcVid = document.getElementById('local-stream');
    if (!srcVid) { console.warn('No hay #local-stream'); return; }

    // Mostrar el canvas superpuesto
    if (_filterCanvas) _filterCanvas.style.display = 'block';

    // Crear canvas stream para WebRTC (una sola vez)
    if (!_canvasStream && _filterCanvas) {
        _canvasStream = _filterCanvas.captureStream(30);
        // Añadir audio del stream original
        _localStream?.getAudioTracks().forEach(t => {
            if (!_canvasStream.getAudioTracks().length) _canvasStream.addTrack(t);
        });
        // Enviar al otro usuario
        const vt = _canvasStream.getVideoTracks()[0];
        if (vt) { vt.enabled = _camActive; _replaceVideoTrack(vt); }
    }

    // Loop de renderizado
    const draw = () => {
        if (_currentFilter === 'none' || !_filterCtx || !_filterCanvas) return;
        if (srcVid.readyState < 2 || !srcVid.videoWidth) {
            _frameId = requestAnimationFrame(draw);
            return;
        }

        // Ajustar dimensiones si cambiaron
        if (_filterCanvas.width !== srcVid.videoWidth) {
            _filterCanvas.width  = srcVid.videoWidth  || 640;
            _filterCanvas.height = srcVid.videoHeight || 480;
        }

        // Dibujar frame crudo
        _filterCtx.drawImage(srcVid, 0, 0, _filterCanvas.width, _filterCanvas.height);

        // Aplicar filtro
        switch (_currentFilter) {
            case 'blur':      _fBlur();      break;
            case 'gradient':  _fGradient();  break;
            case 'bw':        _fBW();        break;
            case 'pixelate':  _fPixelate();  break;
        }

        _frameId = requestAnimationFrame(draw);
    };

    // Esperar a que el video tenga dimensiones reales
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

// ── Detener filtros ──────────────────────────────────────────────
function _stopFilters() {
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }

    // Ocultar canvas superpuesto (el video crudo vuelve a verse)
    if (_filterCanvas) _filterCanvas.style.display = 'none';

    // Limpiar canvas stream y restaurar track original en WebRTC
    _canvasStream = null;
    const ct = _localStream?.getVideoTracks()[0];
    if (ct) { ct.enabled = _camActive; _replaceVideoTrack(ct); }
}

// ── Filtro: Desenfoque de fondo ───────────────────────────────────
function _fBlur() {
    const c = _filterCanvas, ctx = _filterCtx;
    const w = c.width, h = c.height;
    const snap = ctx.getImageData(0, 0, w, h);
    ctx.filter = 'blur(20px)';
    ctx.drawImage(document.getElementById('local-stream'), 0, 0, w, h);
    ctx.filter = 'none';
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w*.5, h*.47, w*.32, h*.46, 0, 0, Math.PI*2);
    ctx.clip();
    ctx.putImageData(snap, 0, 0);
    ctx.restore();
    // Vignette
    const vg = ctx.createRadialGradient(w*.5,h*.47,h*.37, w*.5,h*.47,h*.52);
    vg.addColorStop(0,'transparent'); vg.addColorStop(1,'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg; ctx.fillRect(0,0,w,h);
}

// ── Filtro: Gradiente de fondo ────────────────────────────────────
function _fGradient() {
    const c = _filterCanvas, ctx = _filterCtx;
    const w = c.width, h = c.height;
    const g = GRADIENTS[_gradIdx];
    const snap = ctx.getImageData(0, 0, w, h);
    const grd = ctx.createLinearGradient(0,0,w,h);
    grd.addColorStop(0,g.a); grd.addColorStop(1,g.b);
    ctx.fillStyle = grd; ctx.fillRect(0,0,w,h);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w*.5,h*.47, w*.32,h*.46, 0,0,Math.PI*2);
    ctx.clip();
    ctx.putImageData(snap,0,0);
    ctx.restore();
    const fade = ctx.createRadialGradient(w*.5,h*.47,h*.35, w*.5,h*.47,h*.53);
    fade.addColorStop(0,'transparent'); fade.addColorStop(1,g.a);
    ctx.fillStyle = fade; ctx.fillRect(0,0,w,h);
    ctx.font='600 13px Outfit,Arial'; ctx.fillStyle='rgba(255,255,255,0.28)';
    ctx.fillText(g.name, 12, h-12);
}

// ── Filtro: B&N ───────────────────────────────────────────────────
function _fBW() {
    const id = _filterCtx.getImageData(0,0,_filterCanvas.width,_filterCanvas.height);
    const d = id.data;
    for (let i=0;i<d.length;i+=4){const v=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; d[i]=d[i+1]=d[i+2]=v;}
    _filterCtx.putImageData(id,0,0);
}

// ── Filtro: Pixelado ──────────────────────────────────────────────
function _fPixelate() {
    const ctx=_filterCtx, bs=14, w=_filterCanvas.width, h=_filterCanvas.height;
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
        const p=ctx.getImageData(x+(bs>>1),y+(bs>>1),1,1).data;
        ctx.fillStyle=`rgb(${p[0]},${p[1]},${p[2]})`; ctx.fillRect(x,y,bs,bs);
    }
}

// ════════════════════════════════════════════════════════════
//  COMPARTIR PANTALLA
// ════════════════════════════════════════════════════════════
window.toggleScreenShare = async function() {
    if (_isSharingScreen) { _stopScreen(); return; }
    try {
        _screenStream = await navigator.mediaDevices.getDisplayMedia({ video:{cursor:'always'}, audio:false });
        _isSharingScreen = true;

        const btn = document.getElementById('btn-screen');
        if (btn) { btn.classList.add('active'); btn.innerHTML='<i class="fas fa-desktop" style="color:var(--teal)"></i>'; }

        // Parar el loop de filtros mientras comparte pantalla
        if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
        if (_filterCanvas) _filterCanvas.style.display = 'none';

        // Mostrar pantalla en el video local
        const lv = document.getElementById('local-stream');
        if (lv) lv.srcObject = _screenStream;

        // Enviar pantalla por WebRTC
        _replaceVideoTrack(_screenStream.getVideoTracks()[0]);

        _screenStream.getVideoTracks()[0].addEventListener('ended', _stopScreen, { once:true });
        window.showToast?.('🖥️ Compartiendo pantalla', 'success');

    } catch(err) {
        if (err.name !== 'NotAllowedError') window.showToast?.('No se pudo compartir la pantalla', 'error');
    }
};

// ── Detener pantalla — restaurar cámara según estado exacto ──────
function _stopScreen() {
    if (!_isSharingScreen) return;
    _isSharingScreen = false;

    // 1. Detener tracks de pantalla
    _screenStream?.getTracks().forEach(t => t.stop());
    _screenStream = null;

    // 2. Resetear botón
    const btn = document.getElementById('btn-screen');
    if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fas fa-desktop"></i>'; }

    // 3. Ocultar canvas y detener loop de filtros
    if (_filterCanvas) _filterCanvas.style.display = 'none';
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
    _canvasStream = null;

    // 4. Sin stream de cámara → nada que restaurar
    if (!_localStream) {
        window.showToast?.('Dejaste de compartir pantalla', 'info');
        return;
    }

    const ct = _localStream.getVideoTracks()[0];

    // 5. Restaurar estado del track (encendido/apagado)
    if (ct) ct.enabled = _camActive;

    // 6. RESTAURAR VIDEO — la clave es muted:true para autoplay
    //    Usamos un timeout para dar tiempo al browser a limpiar el stream anterior
    setTimeout(() => {
        const vid = document.getElementById('local-stream');
        if (!vid) return;

        // Reset completo del elemento video
        vid.pause();
        vid.srcObject = null;

        // Pequeño delay adicional antes de reasignar
        setTimeout(() => {
            vid.muted    = true;        // OBLIGATORIO para autoplay
            vid.autoplay = true;
            vid.srcObject = _localStream;

            // Forzar reproducción
            vid.play()
                .then(() => {
                    console.log('✅ Cámara restaurada correctamente');
                    // Si había filtro activo, reiniciarlo
                    if (_camActive && _currentFilter !== 'none') {
                        setTimeout(() => _startFilters(), 100);
                    } else {
                        // Sin filtro: restaurar track en WebRTC
                        _replaceVideoTrack(ct);
                    }
                })
                .catch(err => {
                    // Último recurso: asignar sin play()
                    console.warn('play() bloqueado, asignando directo:', err);
                    vid.srcObject = _localStream;
                    if (_camActive) _replaceVideoTrack(ct);
                });
        }, 80);
    }, 200);

    window.showToast?.('Dejaste de compartir pantalla', 'info');
}

// ════════════════════════════════════════════════════════════
//  MIC / CAM
// ════════════════════════════════════════════════════════════
window.toggleMic = function(btn) {
    _micActive = !_micActive;
    btn = btn || document.getElementById('btn-mic');
    if (!btn) return;
    btn.classList.toggle('muted', !_micActive);
    btn.innerHTML = _micActive
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
    _localStream?.getAudioTracks().forEach(t => t.enabled = _micActive);
    window.showToast?.(_micActive ? '🎤 Micrófono activado' : '🔇 Silenciado', 'info');
};

window.toggleCam = function(btn) {
    if (_isSharingScreen) { window.showToast?.('Detén la pantalla compartida primero', 'info'); return; }
    _camActive = !_camActive;
    btn = btn || document.getElementById('btn-cam');
    if (!btn) return;
    btn.classList.toggle('muted', !_camActive);
    btn.innerHTML = _camActive ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    // Deshabilitar track en el stream crudo
    _localStream?.getVideoTracks().forEach(t => t.enabled = _camActive);
    // Deshabilitar también en el canvas stream si existe
    _canvasStream?.getVideoTracks().forEach(t => t.enabled = _camActive);
};

// ════════════════════════════════════════════════════════════
//  TERMINAR LLAMADA
// ════════════════════════════════════════════════════════════
window.endCall = function() {
    clearInterval(_vcTimer);
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }

    _localStream?.getTracks().forEach(t => t.stop());
    _screenStream?.getTracks().forEach(t => t.stop());

    _localStream=null; _canvasStream=null; _screenStream=null;
    _isSharingScreen=false; _currentFilter='none';
    _camActive=true; _micActive=true;

    // Limpiar canvas superpuesto
    if (_filterCanvas) { _filterCanvas.style.display='none'; _filterCtx?.clearRect(0,0,_filterCanvas.width,_filterCanvas.height); }
    _filterCanvas=null; _filterCtx=null;

    _currentCall?.close(); _currentCall=null;

    ['local-stream','remote-stream'].forEach(id => {
        const el=document.getElementById(id);
        if (!el) return; el.srcObject=null;
        if (id==='remote-stream') el.style.display='none';
    });

    const ph=document.getElementById('vc-placeholder');
    if (ph) ph.style.display='flex';

    _resetUI();

    window.socket?.emit('call_ended',{receiverId:(window.currentChat||{}).id});
    // Cerrar modal DIRECTAMENTE sin llamar closeModal() para evitar bucle infinito
    // (app.js closeModal llama endCall → endCall llama closeModal → bucle)
    document.getElementById('videocall-modal')?.classList.remove('open');
    window.showToast?.('Llamada finalizada','info');
    window.localStream=null;
};

// ── Mostrar stream remoto ─────────────────────────────────────────
function _showRemoteStream(rs) {
    const rv=document.getElementById('remote-stream'), ph=document.getElementById('vc-placeholder');
    if (rv) { rv.srcObject=rs; rv.style.display='block'; }
    if (ph) ph.style.display='none';
    _startTimer();
    window.showToast?.('📹 Videollamada conectada','success');
    window.awardPoints?.(200,'Realizaste una videollamada');
    document.getElementById('badge-vc')?.classList.add('unlocked');
}
window.showRemoteStream = _showRemoteStream;

// ── Timer ─────────────────────────────────────────────────────────
function _startTimer() {
    _vcSeconds=0; clearInterval(_vcTimer);
    _vcTimer=setInterval(()=>{
        _vcSeconds++;
        const el=document.getElementById('vc-timer');
        if(el) el.textContent=String(Math.floor(_vcSeconds/60)).padStart(2,'0')+':'+String(_vcSeconds%60).padStart(2,'0');
    },1000);
}
window.startCallTimer=_startTimer;

// ── Pantalla completa ─────────────────────────────────────────────
window.toggleFullscreen=function(){
    const el=document.querySelector('.videocall-ui');
    if(!el)return;
    if(!document.fullscreenElement)el.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.().catch(()=>{});
};

// ── Panel de filtros ──────────────────────────────────────────────
window.toggleFilterPanel=function(){
    const panel=document.getElementById('filter-panel');
    if(!panel)return;
    const open=panel.style.display==='block';
    panel.style.display=open?'none':'block';
    document.getElementById('btn-filter')?.classList.toggle('active',!open);
};

// ── Cambiar gradiente ─────────────────────────────────────────────
window.cycleGradient=function(){
    _gradIdx=(_gradIdx+1)%GRADIENTS.length;
    const g=GRADIENTS[_gradIdx];
    const prev=document.getElementById('gradient-preview');
    if(prev) prev.style.background=`linear-gradient(135deg,${g.a},${g.b})`;
    const nm=document.getElementById('gradient-name');
    if(nm) nm.textContent=g.name;
    if(_currentFilter!=='gradient') window.setVCFilter('gradient');
    window.showToast?.(`🎨 Fondo: ${g.name}`,'info');
};

// ── Reset UI ──────────────────────────────────────────────────────
function _resetUI(){
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter==='none'));
    const badge=document.getElementById('filter-badge'); if(badge) badge.style.display='none';
    const panel=document.getElementById('filter-panel'); if(panel) panel.style.display='none';
    [['btn-mic','<i class="fas fa-microphone"></i>'],['btn-cam','<i class="fas fa-video"></i>'],
     ['btn-screen','<i class="fas fa-desktop"></i>'],['btn-filter',null]
    ].forEach(([id,html])=>{
        const b=document.getElementById(id); if(!b)return;
        b.classList.remove('muted','active'); if(html) b.innerHTML=html;
    });
}

console.log('📹 videocall_enhanced.js v4.0 — canvas overlay approach');