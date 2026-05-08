// firestore_integration.js — VERSIÓN CORREGIDA
// FIXES:
//   1. Mensajes privados aislados por conversación (no se mezclan)
//   2. Upload a Firebase Storage con manejo de errores mejorado
//   3. Funciones de tienda en tiempo real
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
    updateDoc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ── Configuración Firebase ───────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyBQCxLixqM8qDquL3-xkMjkyupBlcgl2ek",
    authDomain:        "standup-fifa-5f423.firebaseapp.com",
    projectId:         "standup-fifa-5f423",
    storageBucket:     "standup-fifa-5f423.appspot.com",
    messagingSenderId: "823333890415",
    appId:             "1:112092859394:web:acaf19a3ed635667d3ab1b"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);
const storage_fs  = getStorage(firebaseApp);

console.log('🔥 Firestore conectado:', firebaseConfig.projectId);

// ================================================================
//  FUNCIÓN CLAVE: ID de conversación privada ÚNICA entre dos usuarios
//  Ordenar alfabéticamente garantiza que A→B y B→A usen el mismo ID
// ================================================================
window.getConversationId = function(userA, userB) {
    // Tipo grupo: usar directamente el groupId
    if (!userB) return userA;
    // Tipo privado: combinar ambos nombres de forma canónica
    const sorted = [userA, userB].sort();
    return `conv_${sorted[0]}__${sorted[1]}`;
};

// ================================================================
//  FUNCIÓN 1: Guardar mensaje en Firestore
//  Para chats PRIVADOS usa getConversationId(sender, receiver)
//  Para chats GRUPALES usa el groupId directamente
// ================================================================
window.db_saveMessage = async function(chatId, msgData) {
    // chatId ya viene procesado desde app.js (puede ser conversationId o groupId)
    try {
        await addDoc(collection(db, 'messages'), {
            chatId:      chatId,
            senderId:    msgData.senderId    || 'Anónimo',
            message:     msgData.message     || '',
            type:        msgData.type        || 'text',
            msgType:     msgData.msgType     || 'sent',
            isEncrypted: msgData.isEncrypted || false,
            fileUrl:     msgData.fileUrl     || null,
            fileName:    msgData.fileName    || null,
            locationUrl: msgData.locationUrl || null,
            time:        msgData.time        || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            createdAt:   serverTimestamp()
        });
        // Respaldo en localStorage
        const arr = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
        arr.push(msgData);
        if (arr.length > 200) arr.splice(0, arr.length - 200); // límite 200 mensajes
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(arr));
    } catch(e) {
        console.error('❌ Error guardando mensaje en Firestore:', e.message);
        // Fallback solo localStorage
        const arr = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
        arr.push(msgData);
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(arr));
    }
};

// ================================================================
//  FUNCIÓN 2: Cargar historial de mensajes desde Firestore
//  Filtra por chatId (que ya es el ID de conversación único)
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
        console.log(`📂 ${msgs.length} mensajes cargados para chatId: ${chatId}`);
        return msgs;
    } catch(e) {
        console.warn('⚠️ Firestore sin acceso, usando localStorage:', e.message);
        try { return JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]'); }
        catch(e2) { return []; }
    }
};

// ================================================================
//  FUNCIÓN 3: Listener en tiempo real para un chat
// ================================================================
window.db_listenMessages = function(chatId, callback) {
    try {
        const q = query(
            collection(db, 'messages'),
            where('chatId', '==', chatId),
            orderBy('createdAt', 'asc')
        );
        const unsubscribe = onSnapshot(q, (snap) => {
            const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(msgs);
        });
        console.log('👂 Listener activo para:', chatId);
        return unsubscribe;
    } catch(e) {
        console.warn('⚠️ No se pudo iniciar listener de Firestore:', e.message);
        return () => {};
    }
};

// ================================================================
//  FUNCIÓN 4: Subir archivo a Firebase Storage
//  Con fallback a base64 si falla el Storage
// ================================================================
window.db_uploadFile = async function(file, folder = 'chat-files') {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.size > 10 * 1024 * 1024) throw new Error('Archivo mayor a 10MB');

    const timestamp = Date.now();
    // Sanitizar nombre de archivo (eliminar caracteres problemáticos)
    const safeName  = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // eliminar acentos
        .replace(/[^a-zA-Z0-9._-]/g, '_'); // reemplazar caracteres especiales
    const path      = `${folder}/${timestamp}_${safeName}`;

    try {
        const storageRef  = ref(storage_fs, path);
        const snapshot    = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        console.log('✅ Archivo subido a Storage:', downloadURL);
        return { url: downloadURL, name: file.name, size: file.size, type: file.type };
    } catch(storageErr) {
        console.error('❌ Error en Firebase Storage:', storageErr.code, storageErr.message);
        
        // Clasificar el error para dar mejor feedback
        if (storageErr.code === 'storage/unauthorized') {
            throw new Error('Sin permisos en Storage. Revisa las reglas de Firebase.');
        } else if (storageErr.code === 'storage/cors-error' || storageErr.message.includes('CORS')) {
            throw new Error('Error de CORS en Storage. Aplica cors.json con gsutil.');
        } else {
            throw new Error(`Storage error: ${storageErr.message}`);
        }
    }
};

// ================================================================
//  FUNCIÓN 5: Guardar tarea en Firestore
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
        console.log('📋 Tarea guardada:', docRef.id);
        return docRef.id;
    } catch(e) {
        console.error('❌ Error guardando tarea:', e.message);
        return null;
    }
};

// ================================================================
//  FUNCIÓN 6: Marcar tarea como completada
// ================================================================
window.db_completeTask = async function(firestoreId, userId) {
    if (!firestoreId) return;
    try {
        await updateDoc(doc(db, 'tasks', firestoreId), {
            done:   true,
            doneBy: userId,
            doneAt: serverTimestamp()
        });
    } catch(e) {
        console.error('❌ Error completando tarea:', e.message);
    }
};

// ================================================================
//  FUNCIÓN 7: Guardar recompensa en Firestore
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
        console.log(`🏆 Recompensa: ${userId} +${points}pts (${reason})`);
    } catch(e) {
        console.error('❌ Error guardando recompensa:', e.message);
    }
};

// ================================================================
//  FUNCIÓN 8: Guardar/actualizar perfil de usuario en Firestore
//  Incluye inventario y ítems equipados de la tienda
// ================================================================
window.db_saveUserProfile = async function(userId, userData) {
    try {
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
            name:      userData.name      || userId,
            email:     userData.email     || '',
            status:    userData.status    || 'online',
            level:     userData.level     || 'Rookie',
            points:    userData.points    || 0,
            country:   userData.country   || '',
            avatar:    userData.avatar    || null,
            inventory: userData.inventory || [],
            equipped:  userData.equipped  || {},
            friends:   userData.friends   || [],
            updatedAt: serverTimestamp()
        }, { merge: true });
        console.log('👤 Perfil guardado en Firestore:', userId);
    } catch(e) {
        console.error('❌ Error guardando perfil:', e.message);
    }
};

// ================================================================
//  FUNCIÓN 9: Cargar perfil de usuario desde Firestore
//  Restaura inventario y tienda al recargar la app
// ================================================================
window.db_loadUserProfile = async function(userId) {
    try {
        const userRef  = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return { id: userSnap.id, ...userSnap.data() };
        }
        return null;
    } catch(e) {
        console.error('❌ Error cargando perfil:', e.message);
        return null;
    }
};

// ================================================================
//  FUNCIÓN 10: Obtener todos los usuarios
// ================================================================
window.db_getAllUsers = async function() {
    try {
        const snap = await getDocs(collection(db, 'users'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error('❌ Error cargando usuarios:', e);
        return [];
    }
};

// Indicador de que Firestore está listo
window.__FIRESTORE_READY__ = true;
console.log('✅ Todas las funciones de Firestore listas');
console.log('🔑 getConversationId disponible globalmente');
