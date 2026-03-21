// ================================================================
//  FIX ARCHIVOS CON FIREBASE STORAGE — storage_fix.js
//
//  PROBLEMA ACTUAL:
//  En app.js, cuando un usuario envía un archivo, se usa
//  URL.createObjectURL(file) que crea una URL TEMPORAL y LOCAL.
//  Esto significa que el receptor en el otro dispositivo NO puede
//  ver la imagen o descargar el archivo.
//
//  SOLUCIÓN:
//  Subir el archivo a Firebase Storage y usar la URL permanente
//  que devuelve getDownloadURL(). Tu Firebase_config.js ya tiene
//  la función uploadFile() que hace exactamente esto.
//
//  INSTRUCCIONES DE INTEGRACIÓN:
//
//  1. Firebase_config.js ya exporta uploadFile() pero como módulo ES6.
//     Para que app.js (que NO es módulo) pueda usarlo, necesitamos
//     exponer la función en window desde firestore_integration.js
//     O usar el snippet de abajo que re-inicializa Storage.
//
//  2. OPCIÓN MÁS SIMPLE (recomendada):
//     Agrega al final de firestore_integration.js (que ya tienes):
//
//     import { getStorage, ref, uploadBytes, getDownloadURL }
//         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
//     const storage = getStorage(firebaseApp);
//     window.db_uploadFile = async function(file) {
//         // (el código de uploadFile está abajo)
//     };
//
//  3. REEMPLAZA las funciones previewFile(), sendFile() y
//     handleDrop() en app.js por las de este archivo.
//
// ================================================================


// ================================================================
//  PASO A: Agrega esto al FINAL de firestore_integration.js
//  (el archivo que ya tienes en tu proyecto)
// ================================================================

/*
─── PEGA ESTO AL FINAL DE firestore_integration.js ─────────────

import { getStorage, ref, uploadBytes, getDownloadURL }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const storage_fs = getStorage(firebaseApp);

window.db_uploadFile = async function(file, folder = 'chat-files') {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.size > 10 * 1024 * 1024) throw new Error('Archivo mayor a 10MB');

    const uid       = 'user_' + Date.now();
    const timestamp = Date.now();
    const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path      = `${folder}/${uid}/${timestamp}_${safeName}`;
    const storageRef = ref(storage_fs, path);

    const snapshot    = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    console.log('✅ Archivo subido a Storage:', downloadURL);
    return { url: downloadURL, name: file.name, size: file.size, type: file.type };
};

console.log('📦 Firebase Storage listo en window.db_uploadFile');

─────────────────────────────────────────────────────────────── */


// ================================================================
//  PASO B: Reemplaza estas funciones en app.js
// ================================================================

// ── previewFile() — igual que antes, solo guarda la referencia al archivo ─
function previewFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        showToast('Archivo muy grande (máx 10MB)', 'error');
        return;
    }

    const isImage = file.type.startsWith('image/');
    const area    = document.getElementById('file-preview-area');
    area.style.display = 'block';
    document.getElementById('file-drop').style.display = 'none';

    if (isImage) {
        // Preview LOCAL solo para mostrar al usuario (no se envía esta URL)
        const localUrl = URL.createObjectURL(file);
        document.getElementById('img-preview').src          = localUrl;
        document.getElementById('img-preview').style.display      = 'block';
        document.getElementById('file-info-row').style.display    = 'none';
    } else {
        document.getElementById('img-preview').style.display      = 'none';
        document.getElementById('file-info-row').style.display    = 'flex';
        document.getElementById('file-name2').textContent = file.name;
        document.getElementById('file-size').textContent  = (file.size / 1024).toFixed(1) + ' KB';
    }

    // Guardar referencia al archivo (NO la URL local)
    pendingFile    = file;
    pendingFileUrl = null; // se llenará al subir a Storage
    document.getElementById('send-file-btn').disabled = false;
}

// ── handleDrop() — igual que antes ──────────────────────────────
function handleDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt.files.length) previewFile({ target: { files: dt.files } });
}

// ── sendFile() — NUEVA VERSIÓN con Firebase Storage ─────────────
async function sendFile() {
    if (!pendingFile) return;

    const sendBtn = document.getElementById('send-file-btn');
    sendBtn.disabled  = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
        let fileUrl = null;

        if (window.db_uploadFile) {
            // ✅ Subir a Firebase Storage → URL permanente y accesible desde cualquier dispositivo
            const result = await window.db_uploadFile(pendingFile, 'chat-files');
            fileUrl = result.url;
            showToast('✅ Archivo subido correctamente', 'success');
        } else {
            // ⚠️ Fallback: URL temporal local (solo funciona en este dispositivo)
            fileUrl = URL.createObjectURL(pendingFile);
            showToast('⚠️ Sin Storage: archivo solo visible localmente', 'info');
        }

        // Mostrar en el chat propio
        appendMessage('', 'sent', null, time, fileUrl, pendingFile.name, 'file');

        // Guardar en Firestore + enviar por Socket.io con la URL real
        const msgData = {
            senderId: currentUser.name,
            type:     'sent',
            msgType:  'file',
            fileName: pendingFile.name,
            fileUrl:  fileUrl,
            time
        };
        saveMessage(currentChat.id, msgData);

        if (socket?.connected) {
            const socketPayload = {
                groupId:    currentChat.id,
                receiverId: currentChat.id,
                senderId:   currentUser.name,
                message:    '',
                type:       'file',
                fileName:   pendingFile.name,
                fileUrl:    fileUrl,   // ← URL permanente de Firebase Storage
                time
            };

            if (currentChat.type === 'group') {
                socket.emit('send_group_message', socketPayload);
            } else {
                socket.emit('send_private_message', {
                    ...socketPayload,
                    groupId:    undefined,
                    receiverId: currentChat.id
                });
            }
        }

        closeModal('file-modal');
        resetFileModal();
        awardPoints(50, 'Enviaste un archivo');

    } catch (err) {
        console.error('❌ Error al subir archivo:', err);
        showToast('Error al subir el archivo: ' + err.message, 'error');
        sendBtn.disabled  = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
    }
}

// ── resetFileModal() — igual que antes ──────────────────────────
function resetFileModal() {
    pendingFile    = null;
    pendingFileUrl = null;
    document.getElementById('file-drop').style.display         = 'block';
    document.getElementById('file-preview-area').style.display  = 'none';
    document.getElementById('img-preview').style.display        = 'none';
    document.getElementById('send-file-btn').disabled           = true;
    document.getElementById('send-file-btn').innerHTML          = '<i class="fas fa-paper-plane"></i> Enviar';
}

console.log('📦 Módulo Storage Fix cargado.');