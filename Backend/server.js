// ════════════════════════════════════════════════════════════
//  FIFA 2026 Tourist Hub — server.js  v4.0
//  NUEVO: Endpoint de correo electrónico con Nodemailer
//
//  INSTALAR DEPENDENCIA NUEVA:
//  npm install nodemailer
//
//  CONFIGURAR .env (crear archivo .env en la raíz del proyecto):
//  GMAIL_USER=tucorreo@gmail.com
//  GMAIL_PASS=tu_contraseña_de_aplicacion
//
//  NOTA: Usa "Contraseñas de aplicación" de Google, NO tu contraseña normal.
//  Pasos: myaccount.google.com → Seguridad → Verificación en 2 pasos
//         → Contraseñas de aplicación → "Correo" → "Otro (nombre personalizado)"
// ════════════════════════════════════════════════════════════

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const admin      = require('firebase-admin');
const { ExpressPeerServer } = require('peer');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ─── INICIALIZAR FIREBASE ADMIN ────────────────────────────
let db = null;
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log('✅ Firebase Firestore conectado correctamente');
} catch (error) {
    console.warn('⚠️  serviceAccountKey.json no encontrado. Funcionando SIN base de datos.');
}

// ─── HELPER: guardar / leer en Firestore ───────────────────
async function saveToFirestore(collection, data) {
    if (!db) return null;
    try {
        const docRef = await db.collection(collection).add({
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    } catch (e) { console.error(`Error guardando en Firestore (${collection}):`, e.message); return null; }
}

async function updateFirestore(collection, docId, data) {
    if (!db) return;
    try { await db.collection(collection).doc(docId).set(data, { merge: true }); }
    catch (e) { console.error(`Error actualizando Firestore (${collection}/${docId}):`, e.message); }
}

async function getFromFirestore(collection, filters = []) {
    if (!db) return [];
    try {
        let query = db.collection(collection);
        filters.forEach(([field, op, val]) => { query = query.where(field, op, val); });
        const snap = await query.orderBy('createdAt', 'asc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error(`Error leyendo Firestore (${collection}):`, e.message); return []; }
}

// ─── NODEMAILER: Configurar transporter ────────────────────
// Usa Gmail con "Contraseña de aplicación".
// Si prefieres otro proveedor SMTP, cambia host/port/auth.
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER || '',
        pass: process.env.GMAIL_PASS || ''
    }
});

// Verificar conexión SMTP al iniciar (solo en desarrollo)
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    emailTransporter.verify((error) => {
        if (error) {
            console.warn('⚠️  SMTP no configurado:', error.message);
            console.warn('    Configura GMAIL_USER y GMAIL_PASS en el archivo .env');
        } else {
            console.log('📧 Nodemailer listo — correos habilitados');
        }
    });
} else {
    console.warn('⚠️  GMAIL_USER / GMAIL_PASS no definidos. El envío de correos usará modo demo.');
}

// ─── EXPRESS + HTTP ────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());

// ─── SERVIR ARCHIVOS ESTÁTICOS DEL FRONTEND ────────────────
// Esto permite que usuarios externos accedan al HTML via ngrok
const path = require('path');
app.use(express.static(path.join(__dirname, '../FrontEnd')));

// Ruta raíz → redirige al login.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../FrontEnd', 'login.html'));
});

// ─── SOCKET.IO ────────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const connectedUsers = new Map();
const offlineQueue   = new Map();
const peerIds        = new Map(); // userId → peerId  (global, no dentro del handler)

io.on('connection', (socket) => {
    console.log(`🔌 Conexión: ${socket.id}`);

    // ── 1. REGISTRO DE USUARIO ─────────────────────────────
    socket.on('user_connected', async (userId) => {
        connectedUsers.set(userId, socket.id);
        socket.userId = userId;
        console.log(`👤 ${userId} en línea`);

        io.emit('status_update', { userId, status: 'online' });
        await updateFirestore('users', userId, { status: 'online', lastSeen: new Date().toISOString() });

        // Entregar mensajes pendientes (cola en memoria)
        const pending = offlineQueue.get(userId) || [];
        if (pending.length > 0) {
            pending.forEach(msg => socket.emit('receive_private_message', { ...msg, isPending: true }));
            offlineQueue.delete(userId);
            console.log(`📬 ${pending.length} mensajes pendientes entregados a ${userId}`);
        }

        // Entregar mensajes pendientes desde Firestore (persistentes entre reinicios)
        if (db) {
            try {
                const snap = await db.collection('messages')
                    .where('type',       '==', 'private')
                    .where('receiverId', '==', userId)
                    .where('delivered',  '==', false)
                    .get();
                if (!snap.empty) {
                    snap.docs.forEach(d => {
                        socket.emit('receive_private_message', { id: d.id, ...d.data(), isPending: true });
                        d.ref.update({ delivered: true });
                    });
                    console.log(`📬 ${snap.size} mensajes Firestore entregados a ${userId}`);
                }
            } catch (e) { console.error('Error cargando pendientes de Firestore:', e.message); }
        }
    });

    // ── PEER ID ────────────────────────────────────────────
    socket.on('register_peer_id', ({ userId, peerId }) => {
        peerIds.set(userId, peerId);
        console.log(`📹 Peer ID registrado: ${userId} → ${peerId}`);
    });

    // ── 2. CHAT GRUPAL ─────────────────────────────────────
    socket.on('join_group', (groupId) => {
        socket.join(groupId);
        console.log(`👥 ${socket.userId || socket.id} se unió a sala: ${groupId}`);
    });

    socket.on('send_group_message', async (data) => {
        socket.to(data.groupId).emit('receive_group_message', data);
        const saved = await saveToFirestore('messages', {
            type:        'group',
            groupId:     data.groupId,
            senderId:    data.senderId,
            message:     data.message     || '',
            msgType:     data.type        || 'text',
            isEncrypted: data.isEncrypted || false,
            fileUrl:     data.fileUrl     || null,
            fileName:    data.fileName    || null,
            locationUrl: data.locationUrl || null,
            time:        data.time        || new Date().toLocaleTimeString(),
            delivered:   true
        });
        if (saved) console.log(`💾 Mensaje grupal guardado: ${saved}`);
    });

    // ── 3. CHAT PRIVADO ────────────────────────────────────
    socket.on('send_private_message', async (data) => {
        const receiverSocketId = connectedUsers.get(data.receiverId);

        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_private_message', data);
            await saveToFirestore('messages', {
                type: 'private', senderId: data.senderId, receiverId: data.receiverId,
                message: data.message || '', msgType: data.type || 'text',
                isEncrypted: data.isEncrypted || false,
                fileUrl: data.fileUrl || null, fileName: data.fileName || null,
                locationUrl: data.locationUrl || null,
                time: data.time || new Date().toLocaleTimeString(),
                delivered: true
            });
        } else {
            // Offline → cola + Firestore
            console.log(`📴 ${data.receiverId} offline. Mensaje encolado.`);
            const queue = offlineQueue.get(data.receiverId) || [];
            queue.push(data);
            offlineQueue.set(data.receiverId, queue);

            await saveToFirestore('messages', {
                type: 'private', senderId: data.senderId, receiverId: data.receiverId,
                message: data.message || '', msgType: data.type || 'text',
                isEncrypted: data.isEncrypted || false,
                fileUrl: data.fileUrl || null, fileName: data.fileName || null,
                locationUrl: data.locationUrl || null,
                time: data.time || new Date().toLocaleTimeString(),
                delivered: false
            });

            socket.emit('message_pending', {
                receiverId: data.receiverId,
                message: 'Mensaje encolado. Se entregará al reconectarse.'
            });
        }
    });

    // ── 4. TAREAS ──────────────────────────────────────────
    socket.on('task_created', async (data) => {
        const saved = await saveToFirestore('tasks', {
            groupId: data.groupId, text: data.text,
            assignee: data.assignee || 'Todos', creator: data.senderId, done: false
        });
        socket.to(data.groupId).emit('task_created', { ...data, firestoreId: saved });
        console.log(`📋 Tarea guardada: ${data.text}`);
    });

    socket.on('task_done', async (data) => {
        if (data.firestoreId) {
            await updateFirestore('tasks', data.firestoreId, {
                done: true, doneBy: data.userId, doneAt: new Date().toISOString()
            });
        }
        socket.to(data.groupId).emit('task_done', data);
    });

    // ── 5. RECOMPENSAS ─────────────────────────────────────
    socket.on('reward_earned', async (data) => {
        await saveToFirestore('rewards', {
            userId: data.userId, reason: data.reason, points: data.points,
            total: data.total, level: data.level
        });
        await updateFirestore('users', data.userId, { points: data.total, level: data.level });
    });

    // ── 6. VIDEOLLAMADA ────────────────────────────────────
    socket.on('call_user', (data) => {
        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('incoming_call', {
                callerId: data.callerId, callerName: data.callerName, peerId: data.peerId
            });
        } else {
            socket.emit('call_rejected', { reason: 'El usuario no está en línea' });
        }
    });

    socket.on('call_accepted', (data) => {
        const callerSocketId = connectedUsers.get(data.callerId);
        if (callerSocketId) io.to(callerSocketId).emit('call_accepted', { peerId: data.peerId });
    });

    socket.on('call_rejected', (data) => {
        const callerSocketId = connectedUsers.get(data.callerId);
        if (callerSocketId) io.to(callerSocketId).emit('call_rejected', { reason: 'Llamada rechazada' });
    });

    socket.on('call_ended', (data) => {
        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) io.to(receiverSocketId).emit('call_ended');
    });

    // ── 7. ESTADO ──────────────────────────────────────────
    socket.on('status_change', async (data) => {
        io.emit('status_update', { userId: data.userId, status: data.status });
        await updateFirestore('users', data.userId, { status: data.status });
    });

    // ── 8. DESCONEXIÓN ─────────────────────────────────────
    socket.on('disconnect', async () => {
        let disconnectedUser = null;
        for (const [userId, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                disconnectedUser = userId;
                connectedUsers.delete(userId);
                break;
            }
        }
        if (disconnectedUser) {
            console.log(`🔴 ${disconnectedUser} desconectado`);
            io.emit('status_update', { userId: disconnectedUser, status: 'offline' });
            await updateFirestore('users', disconnectedUser, {
                status: 'offline', lastSeen: new Date().toISOString()
            });
        }
    });
});

// ══════════════════════════════════════════════════════════
//  API REST
// ══════════════════════════════════════════════════════════

// GET /api/messages/:chatId
app.get('/api/messages/:chatId', async (req, res) => {
    if (!db) return res.json([]);
    const msgs = await getFromFirestore('messages', [['groupId', '==', req.params.chatId]]);
    res.json(msgs);
});

// GET /api/messages/private/:user1/:user2
app.get('/api/messages/private/:user1/:user2', async (req, res) => {
    if (!db) return res.json([]);
    const { user1, user2 } = req.params;
    try {
        const snap = await db.collection('messages')
            .where('type', '==', 'private')
            .where('senderId', 'in', [user1, user2])
            .orderBy('createdAt', 'asc').get();
        const msgs = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(m => (m.senderId===user1&&m.receiverId===user2)||(m.senderId===user2&&m.receiverId===user1));
        res.json(msgs);
    } catch(e) { res.json([]); }
});

// GET /api/tasks/:groupId
app.get('/api/tasks/:groupId', async (req, res) => {
    if (!db) return res.json([]);
    const tasks = await getFromFirestore('tasks', [['groupId', '==', req.params.groupId]]);
    res.json(tasks);
});

// GET /api/rewards/:userId
app.get('/api/rewards/:userId', async (req, res) => {
    if (!db) return res.json([]);
    const rewards = await getFromFirestore('rewards', [['userId', '==', req.params.userId]]);
    res.json(rewards);
});

// GET /api/users — Lista todos los usuarios (para el modal de crear grupo)
app.get('/api/users', async (req, res) => {
    if (!db) return res.json([]);
    try {
        const snap  = await db.collection('users').get();
        const users = snap.docs.map(d => ({
            id:      d.id,
            name:    d.data().name    || d.id,
            email:   d.data().email   || '',
            status:  d.data().status  || 'offline',
            level:   d.data().level   || 'Rookie',
            points:  d.data().points  || 0,
            country: d.data().country || '',
            avatar:  d.data().avatar  || null
        }));
        res.json(users);
    } catch(e) { res.json([]); }
});

// ══════════════════════════════════════════════════════════
//  📧 POST /api/send-email — Envío de correo con Nodemailer
//
//  Body esperado (JSON):
//  {
//    "to":      "destinatario@email.com",
//    "subject": "Asunto del correo",
//    "body":    "Cuerpo del mensaje",
//    "from":    "Nombre del remitente"  (opcional)
//  }
// ══════════════════════════════════════════════════════════
app.post('/api/send-email', async (req, res) => {
    const { to, subject, body, from } = req.body;

    // Validación básica
    if (!to || !subject || !body) {
        return res.status(400).json({ ok: false, error: 'Faltan campos: to, subject, body' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ ok: false, error: 'Correo destinatario inválido' });
    }

    // Si no hay credenciales SMTP, modo demo
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.log(`📧 [DEMO] Correo simulado → ${to} | Asunto: ${subject}`);
        return res.json({ ok: true, demo: true, message: 'Correo simulado (sin SMTP configurado)' });
    }

    const mailOptions = {
        from:    `"FIFA 2026 Tourist Hub${from ? ' — ' + from : ''}" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        text:    body,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0E1A;color:#E8EDF5;border-radius:12px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#F0C040,#E8A020);padding:20px 28px;">
                    <h2 style="margin:0;color:#0A0E1A;font-size:1.3rem;">⚽ FIFA 2026 Tourist Hub</h2>
                    <p style="margin:4px 0 0;color:#0A0E1A;font-size:0.85rem;opacity:0.8;">Mensaje de ${from || 'un usuario del Hub'}</p>
                </div>
                <div style="padding:28px;">
                    <p style="line-height:1.7;white-space:pre-wrap;">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
                </div>
                <div style="padding:16px 28px;background:rgba(255,255,255,0.04);font-size:0.78rem;color:#8896B0;">
                    Este correo fue enviado desde FIFA 2026 Tourist Hub.<br>
                    Copa Mundial de la FIFA 2026 · Monterrey, México
                </div>
            </div>
        `
    };

    try {
        const info = await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Correo enviado → ${to} (ID: ${info.messageId})`);
        res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
        console.error('❌ Error enviando correo:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── PEERJS SERVER ─────────────────────────────────────────
const peerServer = ExpressPeerServer(server, { debug: true, path: '/' });
app.use('/peerjs', peerServer);
peerServer.on('connection', (client) => console.log(`📹 PeerJS conectado: ${client.getId()}`));
peerServer.on('disconnect', (client) => console.log(`📹 PeerJS desconectado: ${client.getId()}`));

// ─── LEVANTAR SERVIDOR ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ════════════════════════════════════════════════');
    console.log(`🚀  FIFA 2026 Tourist Hub — Puerto: ${PORT}`);
    console.log('🚀 ════════════════════════════════════════════════');
    console.log(`📡  Socket.io    → http://localhost:${PORT}`);
    console.log(`📹  PeerJS       → http://localhost:${PORT}/peerjs`);
    console.log(`🔥  Firestore    → ${db ? 'CONECTADO ✅' : 'DESHABILITADO ⚠️'}`);
    console.log(`📧  Nodemailer   → ${process.env.GMAIL_USER ? process.env.GMAIL_USER + ' ✅' : 'SIN CONFIGURAR ⚠️'}`);
    console.log('');
    console.log('💡 Para prueba en 2 dispositivos:');
    console.log('   npx ngrok http 3000');
    console.log('');
});