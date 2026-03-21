// ================================================================
//  FIX 1: server-config.js  — URL del servidor configurable
//  
//  INSTRUCCIÓN: Crea este archivo nuevo en tu carpeta del proyecto.
//  Luego en INDEX.html, agrégalo ANTES de app.js:
//
//  <script src="server-config.js"></script>
//  <script src="app.js"></script>
// ================================================================

// ── Cambia esta URL según dónde estés corriendo el servidor ──────
//
//  🖥️  PRUEBA LOCAL (mismo dispositivo):
//      const SERVER_URL = 'http://localhost:3000';
//
//  📱  DOS DISPOSITIVOS EN LA MISMA RED WIFI (red local):
//      Abre CMD y escribe: ipconfig  (Windows) / ifconfig (Mac/Linux)
//      Copia tu IPv4 (ej: 192.168.1.105) y úsala aquí:
//      const SERVER_URL = 'http://192.168.1.105:3000';
//
//  🌐  DOS DISPOSITIVOS EN REDES DISTINTAS (ngrok - más fácil):
//      1. Instala ngrok: https://ngrok.com/download
//      2. Corre tu server: node server.js
//      3. En otra terminal: ngrok http 3000
//      4. Copia la URL que aparece (ej: https://abc123.ngrok-free.app)
//      5. Pégala aquí:
//      const SERVER_URL = 'https://abc123.ngrok-free.app';
//
// ────────────────────────────────────────────────────────────────

const SERVER_URL = 'https://wormless-sheryll-spinosely.ngrok-free.dev'; 

// No toques lo de abajo — detecta automáticamente si estás en ngrok
window.__FIFA_SERVER__ = SERVER_URL;
console.log('🌐 Servidor configurado en:', SERVER_URL);