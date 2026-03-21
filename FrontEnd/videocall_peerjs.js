// ================================================================
//  FIX VIDEOLLAMADA REAL — videocall_peerjs.js
//
//  INSTRUCCIONES DE INTEGRACIÓN:
//
//  1. En INDEX.html, agrega el script de PeerJS ANTES de app.js:
//     <script src="https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js"></script>
//
//  2. En el modal de videollamada (videocall-modal), agrega un
//     <video> para el stream remoto dentro de .remote-video:
//
//     <div class="remote-video">
//         <!-- AGREGAR ESTA LÍNEA (quita el video-placeholder o ponlo encima) -->
//         <video id="remote-stream" autoplay playsinline
//                style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:none;"></video>
//         <div class="video-placeholder" id="vc-placeholder">
//             <img src="..." class="vc-avatar" id="vc-remote-avatar">
//             <p id="vc-remote-name">Guía Carlos</p>
//             <div class="vc-connecting" id="vc-connecting">...</div>
//         </div>
//     </div>
//
//  3. REEMPLAZA las funciones openVideoCall(), endCall(), toggleMic()
//     y toggleCam() en app.js por las de este archivo.
//
//  4. AGREGA initPeer() y los listeners de socket al final del
//     bloque try { socket = io(...) } de app.js, junto con los
//     socket.on existentes.
//
// ================================================================

// ── Variables globales de videollamada (reemplazan las que ya tienes) ─
let vcTimerInterval = null;
let vcSeconds       = 0;
let localStream     = null;
let currentCall     = null;    // ← objeto PeerJS call activo
let myPeer          = null;    // ← instancia PeerJS del usuario local
let micActive       = true;
let camActive       = true;

// ================================================================
//  1. INICIALIZAR PEERJS
//  Llama a initPeer() justo después de socket.on('connect', ...)
//  dentro del bloque try de socket en app.js.
// ================================================================
function initPeer() {
    if (myPeer) return; // Evitar duplicados

    // Usa el nombre del usuario como Peer ID (sin espacios ni caracteres especiales)
    const safePeerId = (currentUser.name || 'turista')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        + '_' + Date.now(); // sufijo para evitar colisiones si reconecta

    // Conéctate al servidor PeerJS que ya tienes en server.js en /peerjs
    myPeer = new Peer(safePeerId, {
        host:   window.__FIFA_SERVER__
                    ? new URL(window.__FIFA_SERVER__).hostname
                    : 'localhost',
        port:   window.__FIFA_SERVER__
                    ? (new URL(window.__FIFA_SERVER__).port || 443)
                    : 3000,
        path:   '/peerjs',
        secure: window.__FIFA_SERVER__?.startsWith('https') ?? false,
        debug:  1
    });

    myPeer.on('open', (id) => {
        console.log('📹 PeerJS listo. Mi Peer ID:', id);
        // Registrar el Peer ID en el servidor vía Socket.io
        // para que otros usuarios sepan cómo llamarte
        if (socket?.connected) {
            socket.emit('register_peer_id', {
                userId: currentUser.name,
                peerId: id
            });
        }
    });

    // ── Llamada ENTRANTE ─────────────────────────────────────
    myPeer.on('call', (call) => {
        // Pedir cámara/micrófono al usuario local
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((stream) => {
                localStream = stream;
                currentCall = call;

                // Responder con nuestro stream local
                call.answer(stream);

                // Cuando llega el stream del que nos llama, mostrarlo
                call.on('stream', (remoteStream) => {
                    showRemoteStream(remoteStream);
                });

                call.on('close', () => {
                    endCall();
                });

                // Abrir el modal de videollamada
                openModal('videocall-modal');
                document.getElementById('vc-connecting').style.display = 'none';
                document.getElementById('local-stream').srcObject = stream;
                startCallTimer();
                showToast('📹 Llamada entrante conectada', 'success');
                awardPoints(200, 'Realizaste una videollamada');
            })
            .catch((err) => {
                console.error('❌ No se pudo acceder a cámara/micrófono:', err);
                showToast('No se pudo acceder a cámara o micrófono', 'error');
            });
    });

    myPeer.on('error', (err) => {
        console.warn('⚠️ PeerJS error:', err.type, err.message);
        if (err.type === 'peer-unavailable') {
            showToast('El usuario no está disponible para videollamada', 'error');
            closeModal('videocall-modal');
        }
    });
}

// ================================================================
//  2. LISTENERS DE SOCKET PARA SEÑALIZACIÓN DE LLAMADAS
//  Pega estos socket.on() dentro del bloque try { socket = io(...) }
//  de app.js, junto con los demás socket.on que ya tienes.
// ================================================================

// ── Pega esto dentro del bloque try de socket en app.js ─────────
//
//  socket.on('incoming_call', (data) => {
//      // Mostrar notificación de llamada entrante
//      const accept = confirm(`📹 Llamada de ${data.callerName}. ¿Aceptar?`);
//      if (accept) {
//          socket.emit('call_accepted', {
//              callerId: data.callerId,
//              peerId:   myPeer?.id || ''
//          });
//          // El evento myPeer.on('call') de PeerJS manejará el resto
//      } else {
//          socket.emit('call_rejected', { callerId: data.callerId });
//          showToast('Llamada rechazada', 'info');
//      }
//  });
//
//  socket.on('call_accepted', (data) => {
//      // El otro usuario aceptó — ahora sí hacemos la llamada PeerJS
//      if (myPeer && localStream) {
//          const call = myPeer.call(data.peerId, localStream);
//          currentCall = call;
//          call.on('stream', (remoteStream) => {
//              showRemoteStream(remoteStream);
//              document.getElementById('vc-connecting').style.display = 'none';
//          });
//          call.on('close', () => endCall());
//      }
//  });
//
//  socket.on('call_rejected', () => {
//      showToast('📵 Llamada rechazada por el otro usuario', 'info');
//      endCall();
//  });
//
//  socket.on('call_ended', () => {
//      showToast('📵 El otro usuario colgó', 'info');
//      endCall();
//  });
//
// ────────────────────────────────────────────────────────────────

// ================================================================
//  3. FUNCIÓN openVideoCall() — REEMPLAZA LA QUE YA TIENES
// ================================================================
function openVideoCall() {
    if (currentChat.type !== 'private') {
        showToast('Las videollamadas son solo en chats privados', 'info');
        return;
    }

    openModal('videocall-modal');
    document.getElementById('vc-connecting').style.display = 'block';
    document.getElementById('vc-timer').textContent = '00:00';

    // Pedir cámara y micrófono
    if (!navigator.mediaDevices?.getUserMedia) {
        showToast('Tu navegador no soporta videollamadas', 'error');
        closeModal('videocall-modal');
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
            localStream = stream;
            document.getElementById('local-stream').srcObject = stream;

            // Señalizar al otro usuario vía Socket.io
            if (socket?.connected) {
                socket.emit('call_user', {
                    callerId:   currentUser.name,
                    callerName: currentUser.name,
                    receiverId: currentChat.id,
                    peerId:     myPeer?.id || ''
                });
                showToast(`📞 Llamando a ${currentChat.name}...`, 'info');
            } else {
                // Demo: sin servidor, simular conexión local
                console.warn('Socket no conectado — simulando llamada local');
                setTimeout(() => {
                    document.getElementById('vc-connecting').style.display = 'none';
                    startCallTimer();
                    showToast('📹 Videollamada (modo demo)', 'success');
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

// ================================================================
//  4. MOSTRAR EL STREAM REMOTO
// ================================================================
function showRemoteStream(remoteStream) {
    const remoteVideo  = document.getElementById('remote-stream');
    const placeholder  = document.getElementById('vc-placeholder');

    if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.style.display = 'block';
    }
    if (placeholder) {
        placeholder.style.display = 'none';
    }
    startCallTimer();
    showToast('📹 Videollamada conectada', 'success');
    awardPoints(200, 'Realizaste una videollamada');
    document.getElementById('badge-vc')?.classList.add('unlocked');
}

// ================================================================
//  5. endCall() — REEMPLAZA LA QUE YA TIENES
// ================================================================
function endCall() {
    clearInterval(vcTimerInterval);

    // Detener stream local
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    // Cerrar llamada PeerJS
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }

    // Limpiar elementos del DOM
    const localVid  = document.getElementById('local-stream');
    const remoteVid = document.getElementById('remote-stream');
    if (localVid)  localVid.srcObject  = null;
    if (remoteVid) { remoteVid.srcObject = null; remoteVid.style.display = 'none'; }

    const placeholder = document.getElementById('vc-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    // Notificar al otro usuario
    if (socket?.connected && currentChat.id) {
        socket.emit('call_ended', { receiverId: currentChat.id });
    }

    closeModal('videocall-modal');
    showToast('Llamada finalizada', 'info');
}

// ================================================================
//  6. toggleMic() y toggleCam() — REEMPLAZAN LAS QUE YA TIENES
//  (Son iguales, solo aseguran que usen la variable localStream)
// ================================================================
function toggleMic(btn) {
    micActive = !micActive;
    btn.classList.toggle('muted', !micActive);
    btn.innerHTML = micActive
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = micActive);
}

function toggleCam(btn) {
    camActive = !camActive;
    btn.classList.toggle('muted', !camActive);
    btn.innerHTML = camActive
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
    if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = camActive);
}

// ================================================================
//  7. startCallTimer() — igual que la tuya, se deja aquí para claridad
// ================================================================
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

console.log('📹 Módulo PeerJS de videollamada cargado.');