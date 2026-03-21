//
//  Este archivo conecta tu app a Firestore y expone funciones
//  globales que app.js puede usar para guardar y leer datos.
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    serverTimestamp,
    onSnapshot,
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Tus credenciales de Firebase (ya las tienes correctas) ───────
const firebaseConfig = {
    apiKey:            "AIzaSyBQCxLixqM8qDquL3-xkMjkyupBlcgl2ek",
    authDomain:        "standup-fifa.firebaseapp.com",
    projectId:         "standup-fifa",
    storageBucket:     "standup-fifa.firebasestorage.app",
    messagingSenderId: "112092859394",
    appId:             "1:112092859394:web:acaf19a3ed635667d3ab1b"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);

console.log('🔥 Firestore conectado:', firebaseConfig.projectId);

// ================================================================
//  FUNCIÓN 1: Guardar mensaje en Firestore
//  Reemplaza el localStorage — ahora los mensajes se guardan en la nube
// ================================================================
window.db_saveMessage = async function(chatId, msgData) {
    try {
        await addDoc(collection(db, 'messages'), {
            chatId:      chatId,
            senderId:    msgData.senderId    || 'Anónimo',
            message:     msgData.message     || '',
            type:        msgData.type        || 'text',     // 'text' | 'file' | 'location'
            msgType:     msgData.msgType     || 'sent',     // 'sent' | 'received'
            isEncrypted: msgData.isEncrypted || false,
            fileUrl:     msgData.fileUrl     || null,
            fileName:    msgData.fileName    || null,
            locationUrl: msgData.locationUrl || null,
            time:        msgData.time        || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            createdAt:   serverTimestamp()
        });
        // También guarda en localStorage como respaldo
        const arr = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
        arr.push(msgData);
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(arr));
    } catch(e) {
        console.error('❌ Error guardando mensaje en Firestore:', e.message);
        // Fallback: solo localStorage
        const arr = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
        arr.push(msgData);
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(arr));
    }
};

// ================================================================
//  FUNCIÓN 2: Cargar historial de mensajes desde Firestore
// ================================================================
window.db_loadMessages = async function(chatId) {
    try {
        const q    = query(
            collection(db, 'messages'),
            where('chatId', '==', chatId),
            orderBy('createdAt', 'asc')
        );
        const snap = await getDocs(q);
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`📂 Cargados ${msgs.length} mensajes de Firestore para: ${chatId}`);
        return msgs;
    } catch(e) {
        console.warn('⚠️ Firestore sin acceso, usando localStorage:', e.message);
        // Fallback a localStorage
        try { return JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]'); }
        catch(e2) { return []; }
    }
};

// ================================================================
//  FUNCIÓN 3: Escuchar mensajes EN TIEMPO REAL desde Firestore
//  (Esto permite que 2 dispositivos se vean los mensajes al instante)
// ================================================================
window.db_listenMessages = function(chatId, callback) {
    try {
        const q = query(
            collection(db, 'messages'),
            where('chatId', '==', chatId),
            orderBy('createdAt', 'asc')
        );
        // onSnapshot dispara el callback cada vez que hay un cambio
        const unsubscribe = onSnapshot(q, (snap) => {
            const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(msgs);
        });
        console.log('👂 Escuchando cambios en tiempo real para:', chatId);
        return unsubscribe; // Llama a esto para dejar de escuchar
    } catch(e) {
        console.warn('⚠️ No se pudo iniciar listener de Firestore:', e.message);
        return () => {}; // Función vacía para no romper el código
    }
};

// ================================================================
//  FUNCIÓN 4: Guardar tarea en Firestore
// ================================================================
window.db_saveTask = async function(groupId, taskData) {
    try {
        const docRef = await addDoc(collection(db, 'tasks'), {
            groupId:   groupId,
            text:      taskData.text,
            assignee:  taskData.assignee  || 'Todos',
            creator:   taskData.creator   || 'Anónimo',
            done:      false,
            createdAt: serverTimestamp()
        });
        console.log('📋 Tarea guardada en Firestore:', docRef.id);
        return docRef.id;
    } catch(e) {
        console.error('❌ Error guardando tarea:', e.message);
        return null;
    }
};

// ================================================================
//  FUNCIÓN 5: Marcar tarea como completada en Firestore
// ================================================================
window.db_completeTask = async function(firestoreId, userId) {
    if (!firestoreId) return;
    try {
        await updateDoc(doc(db, 'tasks', firestoreId), {
            done:   true,
            doneBy: userId,
            doneAt: serverTimestamp()
        });
        console.log('✅ Tarea marcada como completada en Firestore:', firestoreId);
    } catch(e) {
        console.error('❌ Error completando tarea:', e.message);
    }
};

// ================================================================
//  FUNCIÓN 6: Guardar recompensa en Firestore
// ================================================================
window.db_saveReward = async function(userId, reason, points, total) {
    try {
        await addDoc(collection(db, 'rewards'), {
            userId:    userId,
            reason:    reason,
            points:    points,
            total:     total,
            createdAt: serverTimestamp()
        });
        console.log(`🏆 Recompensa guardada: ${userId} +${points}pts (${reason})`);
    } catch(e) {
        console.error('❌ Error guardando recompensa:', e.message);
    }
};

// ================================================================
//  FUNCIÓN 7: Subir archivo a Firebase Storage
//  Devuelve la URL permanente accesible desde cualquier dispositivo
// ================================================================
import { getStorage, ref, uploadBytes, getDownloadURL }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const storage_fs = getStorage(firebaseApp);

window.db_uploadFile = async function(file, folder = 'chat-files') {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.size > 10 * 1024 * 1024) throw new Error('Archivo mayor a 10MB');

    const timestamp = Date.now();
    const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path      = `${folder}/${timestamp}_${safeName}`;
    const storageRef = ref(storage_fs, path);

    const snapshot    = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    console.log('✅ Archivo subido a Storage:', downloadURL);
    return { url: downloadURL, name: file.name, size: file.size, type: file.type };
};

// Indicador visual de que Firestore está listo
window.__FIRESTORE_READY__ = true;
console.log('✅ Todas las funciones de Firestore listas en window.db_*');
console.log('📦 Firebase Storage listo en window.db_uploadFile');

// ── Obtener todos los usuarios ──────────────────────────
window.db_getAllUsers = async function() {
    try {
        const snap = await getDocs(collection(db, 'users'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error('❌ Error cargando usuarios:', e);
        return [];
    }
};
console.log('👥 db_getAllUsers listo');
