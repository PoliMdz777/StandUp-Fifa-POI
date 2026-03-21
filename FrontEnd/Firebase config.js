// ════════════════════════════════════════════════════════════
//  firebase-config.js
//  Configuración Firebase para el CLIENTE (navegador)
//
//  INSTRUCCIONES para obtener tu config:
//  1. Ve a https://console.firebase.google.com
//  2. Crea proyecto → "fifa-2026-tourist-hub"
//  3. Configuración del proyecto → Agregar app web (</>)
//  4. Copia los valores de firebaseConfig y pégalos abajo
//  5. Habilita en Firebase Console:
//     • Authentication → Correo/contraseña
//     • Firestore Database → Crear base de datos (modo prueba)
//     • Storage → Empezar (modo prueba)
// ════════════════════════════════════════════════════════════

import { initializeApp }         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         signOut,
         onAuthStateChanged,
         updateProfile }         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore,
         collection,
         addDoc,
         getDocs,
         getDoc,
         setDoc,
         updateDoc,
         deleteDoc,
         doc,
         query,
         where,
         orderBy,
         onSnapshot,
         serverTimestamp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage,
         ref,
         uploadBytes,
         getDownloadURL }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── ⚠️  REEMPLAZA CON TUS VALORES DE FIREBASE CONSOLE ────
//const firebaseConfig = {
  //  apiKey:            "TU_API_KEY_AQUI",
    //authDomain:        "TU_PROYECTO.firebaseapp.com",
    //projectId:         "TU_PROYECTO_ID",
    //storageBucket:     "TU_PROYECTO.appspot.com",
    //messagingSenderId: "TU_SENDER_ID",
  //  appId:             "TU_APP_ID"
//};
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey:            "AIzaSyBQCxLixqM8qDquL3-xkMjkyupBlcgl2ek",
    authDomain:        "standup-fifa-5f423.firebaseapp.com",
    projectId:         "standup-fifa-5f423",
    storageBucket:     "standup-fifa-5f423.appspot.com",
    messagingSenderId: "823333890415",
    appId:             "1:112092859394:web:acaf19a3ed635667d3ab1b"
};
// ─── FIN DE CONFIGURACIÓN ──────────────────────────────────

// Inicializar Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

// ══════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ══════════════════════════════════════════════════════════

// Registrar nuevo usuario con correo/contraseña
async function registerUser(email, password, displayName, country) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Guardar nombre de usuario
    await updateProfile(cred.user, { displayName });
    // Crear documento en Firestore
    await setDoc(doc(db, 'users', cred.user.uid), {
        uid:       cred.user.uid,
        name:      displayName,
        email,
        country:   country || '🇲🇽 México',
        points:    0,
        level:     'Rookie',
        status:    'online',
        bio:       '',
        avatar:    null,
        createdAt: serverTimestamp()
    });
    return cred.user;
}

// Iniciar sesión con correo/contraseña
async function loginUser(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Actualizar estado a "online"
    await updateDoc(doc(db, 'users', cred.user.uid), {
        status:   'online',
        lastSeen: serverTimestamp()
    }).catch(() => {}); // Ignorar si el doc no existe aún
    return cred.user;
}

// Cerrar sesión
async function logoutUser() {
    const uid = auth.currentUser?.uid;
    if (uid) {
        await updateDoc(doc(db, 'users', uid), { status: 'offline', lastSeen: serverTimestamp() }).catch(()=>{});
    }
    return signOut(auth);
}

// Obtener usuario actual
function getCurrentUser() {
    return auth.currentUser;
}

// Observer de sesión
function onUserSession(callback) {
    return onAuthStateChanged(auth, callback);
}

// ══════════════════════════════════════════════════════════
//  FIRESTORE: MENSAJES
// ══════════════════════════════════════════════════════════

// Guardar mensaje grupal
async function saveGroupMessage(groupId, msgData) {
    return addDoc(collection(db, 'messages'), {
        type:        'group',
        groupId,
        senderId:    msgData.senderId,
        senderName:  msgData.senderName || msgData.senderId,
        message:     msgData.message    || '',
        msgType:     msgData.msgType    || 'text',
        isEncrypted: msgData.isEncrypted|| false,
        fileUrl:     msgData.fileUrl    || null,
        fileName:    msgData.fileName   || null,
        locationUrl: msgData.locationUrl|| null,
        time:        msgData.time       || new Date().toLocaleTimeString(),
        delivered:   true,
        createdAt:   serverTimestamp()
    });
}

// Guardar mensaje privado
async function savePrivateMessage(msgData, delivered = true) {
    return addDoc(collection(db, 'messages'), {
        type:        'private',
        senderId:    msgData.senderId,
        receiverId:  msgData.receiverId,
        message:     msgData.message    || '',
        msgType:     msgData.msgType    || 'text',
        isEncrypted: msgData.isEncrypted|| false,
        fileUrl:     msgData.fileUrl    || null,
        fileName:    msgData.fileName   || null,
        locationUrl: msgData.locationUrl|| null,
        time:        msgData.time       || new Date().toLocaleTimeString(),
        delivered,
        createdAt:   serverTimestamp()
    });
}

// Cargar historial de mensajes de un grupo (una sola vez)
async function loadGroupHistory(groupId) {
    const q    = query(collection(db,'messages'), where('groupId','==',groupId), orderBy('createdAt','asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Escuchar mensajes de un grupo EN TIEMPO REAL
function listenGroupMessages(groupId, callback) {
    const q = query(collection(db,'messages'), where('groupId','==',groupId), orderBy('createdAt','asc'));
    return onSnapshot(q, (snap) => {
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(msgs);
    });
}

// Cargar mensajes privados entre dos usuarios
async function loadPrivateHistory(uid1, uid2) {
    // Firestore no soporta OR en where, hacemos dos queries
    const q1   = query(collection(db,'messages'), where('senderId','==',uid1), where('receiverId','==',uid2), orderBy('createdAt','asc'));
    const q2   = query(collection(db,'messages'), where('senderId','==',uid2), where('receiverId','==',uid1), orderBy('createdAt','asc'));
    const [s1,s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const all  = [...s1.docs, ...s2.docs].map(d => ({ id: d.id, ...d.data() }));
    all.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    return all;
}

// ══════════════════════════════════════════════════════════
//  FIRESTORE: TAREAS
// ══════════════════════════════════════════════════════════

async function saveTask(groupId, task) {
    return addDoc(collection(db,'tasks'), {
        groupId,
        text:      task.text,
        assignee:  task.assignee  || 'Todos',
        creator:   task.creator   || '',
        done:      false,
        createdAt: serverTimestamp()
    });
}

async function markTaskDone(taskId, userId) {
    return updateDoc(doc(db,'tasks', taskId), {
        done:   true,
        doneBy: userId,
        doneAt: serverTimestamp()
    });
}

async function deleteTask(taskId) {
    return deleteDoc(doc(db,'tasks', taskId));
}

async function loadTasks(groupId) {
    const q    = query(collection(db,'tasks'), where('groupId','==',groupId), orderBy('createdAt','asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Escuchar tareas en tiempo real
function listenTasks(groupId, callback) {
    const q = query(collection(db,'tasks'), where('groupId','==',groupId), orderBy('createdAt','asc'));
    return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ══════════════════════════════════════════════════════════
//  FIRESTORE: RECOMPENSAS Y USUARIO
// ══════════════════════════════════════════════════════════

async function saveReward(userId, reason, points, total, level) {
    await addDoc(collection(db,'rewards'), {
        userId, reason, points, total, level,
        createdAt: serverTimestamp()
    });
    await updateDoc(doc(db,'users', userId), { points: total, level });
}

async function getUserProfile(uid) {
    const snap = await getDoc(doc(db,'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function updateUserProfile(uid, data) {
    return setDoc(doc(db,'users', uid), data, { merge: true });
}

async function getAllUsers() {
    const snap = await getDocs(collection(db,'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Escuchar cambios de estado de TODOS los usuarios (para el indicador en tiempo real)
function listenUserStatuses(callback) {
    return onSnapshot(collection(db,'users'), snap => {
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(users);
    });
}

// ══════════════════════════════════════════════════════════
//  FIREBASE STORAGE: SUBIDA DE ARCHIVOS (PASO 3)
// ══════════════════════════════════════════════════════════

// Subir archivo y obtener URL pública permanente
async function uploadFile(file, folder = 'chat-files') {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.size > 10 * 1024 * 1024) throw new Error('Archivo mayor a 10MB');

    const uid       = auth.currentUser?.uid || 'anonymous';
    const timestamp = Date.now();
    const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path      = `${folder}/${uid}/${timestamp}_${safeName}`;
    const storageRef = ref(storage, path);

    const snapshot   = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    return { url: downloadURL, path, name: file.name, size: file.size, type: file.type };
}

// Subir avatar de perfil
async function uploadAvatar(file, userId) {
    const result = await uploadFile(file, 'avatars');
    await updateDoc(doc(db,'users', userId), { avatar: result.url }).catch(()=>{});
    return result.url;
}

// ══════════════════════════════════════════════════════════
//  EXPORTS  (disponibles globalmente vía window)
// ══════════════════════════════════════════════════════════
export {
    auth, db, storage,
    // Auth
    registerUser, loginUser, logoutUser, getCurrentUser, onUserSession,
    // Mensajes
    saveGroupMessage, savePrivateMessage, loadGroupHistory, loadPrivateHistory,
    listenGroupMessages,
    // Tareas
    saveTask, markTaskDone, deleteTask as deleteTaskFirestore, loadTasks, listenTasks,
    // Usuarios / Recompensas
    saveReward, getUserProfile, updateUserProfile, getAllUsers, listenUserStatuses,
    // Storage
    uploadFile, uploadAvatar,
    // Firestore helpers
    serverTimestamp, doc, updateDoc
};