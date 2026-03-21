// ════════════════════════════════════════════════════════════════
//  ai_assistant.js  — Asistente IA con Claude API (Anthropic)
//  FIFA 2026 Tourist Hub
//
//  INSTRUCCIONES DE INTEGRACIÓN:
//  1. Agrega en INDEX.html ANTES de app.js:
//     <script src="ai_assistant.js"></script>
//
//  2. En app.js, dentro de sendMessage(), reemplaza el bloque
//     "🤖 LÓGICA DEL ASISTENTE IA" por:
//
//       if (currentChat.id === 'asistente_ia') {
//           handleAIMessage(text);
//           return;
//       }
//
//  3. La función handleAIMessage() está definida aquí y se
//     expone en window para que app.js pueda llamarla.
//
//  NOTAS:
//  - El historial de conversación se guarda en memoria por sesión.
//  - El sistema prompt incluye contexto de FIFA 2026 + Monterrey.
//  - Se usa el endpoint de Anthropic directamente desde el navegador.
//    (Funciona dentro del ambiente claude.ai via el proxy integrado)
// ════════════════════════════════════════════════════════════════

'use strict';

// ── HISTORIAL DE CONVERSACIÓN (en memoria por sesión) ────────────
const aiConversationHistory = [];

// ── LÍMITE DE HISTORIAL (últimos N turnos para no exceder tokens) ─
const MAX_HISTORY_TURNS = 20;

// ── SYSTEM PROMPT RICO CON CONTEXTO FIFA 2026 + MTY ──────────────
function buildSystemPrompt() {
    // Intentar leer el usuario actual de window (definido en app.js)
    const user = window.currentUser || {};
    const name   = user.name    || 'turista';
    const pts    = user.points  || 0;
    const level  = user.level   || 'Rookie';
    const country= user.country || 'México';

    return `Eres el Asistente IA oficial del FIFA 2026 Tourist Hub, una aplicación de comunicación en tiempo real para turistas que visitan Monterrey, México durante la Copa Mundial de la FIFA 2026.

## Tu personalidad
- Eres amigable, entusiasta del fútbol y experto en Monterrey.
- Hablas en español (aunque respondes en el idioma del usuario si escribe en otro).
- Usas emojis con moderación para dar energía a tus respuestas.
- Eres conciso pero informativo. Respuestas de 2-4 párrafos como máximo.

## Contexto del usuario actual
- Nombre: ${name}
- País: ${country}
- Puntos acumulados: ${pts} pts
- Nivel: ${level}
- Niveles del sistema: Rookie (0-999) → Explorer (1000-2499) → Champion (2500-2999) → Elite (3000-4999) → Legend (5000+)

## Información FIFA 2026 en Monterrey
- Sede principal: Estadio BBVA (Rayados), capacidad ~53,000 personas
- Dirección: Av. Pablo Livas, Guadalupe, N.L.
- Partidos en MTY: Fase de grupos y posibles octavos de final
- Transporte al estadio: Metro Línea 2 → Estación "Estadio"

## Transporte en Monterrey
- Metro: 2 líneas (L1 Este-Oeste, L2 Norte-Sur). $7.50 MXN por viaje.
- Metrobús/Ecovía: Conecta Av. Morones Prieto y Lincoln
- Uber/DiDi: Ampliamente disponible
- Aeropuerto MTY (General Mariano Escobedo): ~20 min al centro en taxi/Uber

## Lugares turísticos clave
- Macroplaza: Plaza principal, gratis, visitable todo el día
- Parque Fundidora: Parque industrial convertido en espacio cultural (gratis)
- Paseo Santa Lucía: Canal peatonal que conecta Fundidora con el centro
- Barrio Antiguo: Zona de bares, restaurantes y vida nocturna
- Cerro de la Silla: Símbolo de MTY, senderismo (gratis)
- Museo de Historia Mexicana: En el centro, muy recomendable

## Gastronomía regiomontana
- Cabrito al pastor: Platillo típico más famoso
- Machaca con huevo: Desayuno tradicional
- Arrachera: Corte de carne típico del norte
- Elotes locos y esquites: Street food popular
- Restaurantes recomendados: La Biferia (carnes), El Rey del Cabrito (tradicional), Solomillo (casual)

## Sistema de recompensas de la app
- Enviar mensaje: +1 pt (máx 50/día)
- Completar tarea del grupo: +5 pts (máx 1/grupo/día)
- Videollamada: +2 pts (máx 10/día)
- Compartir info del Mundial: +8 pts (máx 5/día)
- Iniciar sesión: +5 pts (1/día)
- La tienda tiene: Marcos de perfil (500 pts), Fondos MTY (800 pts), burbujas de chat, etc.
- Gastar puntos en la tienda NO retrasa el nivel del usuario

## Funcionalidades de la app que puedes explicar
- Chat grupal: Grupos de mínimo 3 personas para coordinar tours
- Chat privado: Mensajes 1 a 1, con videollamada disponible
- Compartir ubicación: Envía tu posición GPS como link de Google Maps
- Tareas del grupo: Crea y asigna tareas, gana puntos al completarlas
- Envío de archivos: Imágenes y documentos hasta 10MB vía Firebase Storage
- Encriptación: Toggle para cifrar mensajes en tránsito

## Reglas de negocio importantes
- Registro con correo electrónico único
- Grupos necesitan mínimo 3 integrantes
- El admin puede expulsar miembros, cambiar nombre del grupo y crear tareas
- Cada grupo tiene 15 puntos en total para repartir entre sus tareas

## Tus capacidades
- Recomendar lugares turísticos en Monterrey y cómo llegar
- Explicar cómo usar las funcionalidades de la app
- Dar información sobre los partidos del Mundial 2026
- Ayudar a planear itinerarios para días de partido
- Responder preguntas de cultura mexicana/regiomontana
- Motivar al usuario para ganar más puntos y subir de nivel
- NO puedes: hacer reservaciones reales, comprar boletos, ni acceder a datos externos en tiempo real

Sé útil, preciso y entusiasta. ¡Vamos México! ⚽🇲🇽`;
}

// ── FUNCIÓN PRINCIPAL: maneja un mensaje del usuario ─────────────
window.handleAIMessage = async function(userText) {
    if (!userText || !userText.trim()) return;

    const msgs        = document.getElementById('chat-messages');
    const replyTime   = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Mostrar indicador "Escribiendo..."
    const typingDiv = document.createElement('div');
    typingDiv.id = 'ai-typing-indicator';
    typingDiv.classList.add('ai-typing');
    typingDiv.innerHTML = `
        <div class="ai-typing-dots">
            <i></i><i></i><i></i>
        </div>
        <span>Asistente escribiendo...</span>
    `;
    msgs.appendChild(typingDiv);
    msgs.scrollTop = msgs.scrollHeight;

    // 2. Añadir mensaje del usuario al historial
    aiConversationHistory.push({ role: 'user', content: userText });

    // Recortar historial si excede el límite
    while (aiConversationHistory.length > MAX_HISTORY_TURNS * 2) {
        aiConversationHistory.splice(0, 2); // eliminar el turno más antiguo
    }

    try {
        // 3. Llamar al API de Anthropic (Claude)
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                system: buildSystemPrompt(),
                messages: [...aiConversationHistory]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // 4. Extraer respuesta del modelo
        const aiReply = data.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim();

        // 5. Añadir respuesta de la IA al historial
        aiConversationHistory.push({ role: 'assistant', content: aiReply });

        // 6. Quitar indicador y mostrar respuesta
        document.getElementById('ai-typing-indicator')?.remove();

        const time = replyTime();

        // Usar appendMessage de app.js (disponible en window scope)
        if (window.appendMessage) {
            window.appendMessage(aiReply, 'received', '🤖 Asistente IA', time);
        } else {
            // Fallback si appendMessage no está en window
            _appendAIMessage(aiReply, time);
        }

        // 7. Guardar en historial de chat local
        if (window.saveMessage) {
            window.saveMessage('asistente_ia', {
                senderId: 'Asistente IA',
                message:  aiReply,
                type:     'received',
                time
            });
        }

        // 8. Actualizar preview en sidebar
        if (window.updateContactPreview) {
            window.updateContactPreview('asistente_ia', aiReply.substring(0, 50));
        }

        // 9. Pequeña recompensa por usar el asistente
        if (window.awardPoints) {
            window.awardPoints(2, 'Usaste el Asistente IA');
        }

    } catch (error) {
        console.error('❌ Error en Asistente IA:', error);

        document.getElementById('ai-typing-indicator')?.remove();

        // Mensaje de error amigable
        const errorMsg = _getErrorMessage(error);
        const time = replyTime();

        if (window.appendMessage) {
            window.appendMessage(errorMsg, 'received', '🤖 Asistente IA', time);
        } else {
            _appendAIMessage(errorMsg, time);
        }
    }
};

// ── MENSAJES DE ERROR AMIGABLES ──────────────────────────────────
function _getErrorMessage(error) {
    if (error.message.includes('401') || error.message.includes('403')) {
        return '⚠️ No pude conectarme al servicio de IA en este momento. ¿Tienes alguna pregunta sobre Monterrey o el Mundial que yo pueda responder con mis datos locales? ⚽';
    }
    if (error.message.includes('429')) {
        return '⏳ Hay muchas solicitudes en este momento. Espera unos segundos e intenta de nuevo.';
    }
    if (error.message.includes('fetch') || error.message.includes('network') || error.message.toLowerCase().includes('failed')) {
        return '📡 Sin conexión al servidor de IA. Verifica tu internet e intenta de nuevo.';
    }
    return '⚠️ Ocurrió un error inesperado. Por favor intenta de nuevo en un momento.';
}

// ── FALLBACK: appendMessage sin depender de app.js ───────────────
function _appendAIMessage(text, time) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.classList.add('message', 'received');
    div.innerHTML = `
        <div class="msg-sender">🤖 Asistente IA</div>
        <p>${_escHtml(text)}</p>
        <span class="time">${time}</span>
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function _escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

// ── LIMPIAR HISTORIAL (útil al cambiar de chat) ──────────────────
window.clearAIHistory = function() {
    aiConversationHistory.length = 0;
    console.log('🤖 Historial del Asistente IA limpiado');
};

// ── SUGERENCIAS RÁPIDAS (para mostrar en el chat de la IA) ────────
window.AI_QUICK_SUGGESTIONS = [
    '⚽ ¿Cuándo juega México?',
    '🚇 ¿Cómo llego al estadio?',
    '🌮 ¿Dónde comer cerca del BBVA?',
    '🏆 ¿Cómo subo de nivel?',
    '🗺️ ¿Qué visitar en Monterrey?',
    '🏨 ¿Dónde hospedarme cerca del estadio?',
    '📍 ¿Cómo comparto mi ubicación?',
    '👥 ¿Cómo creo un grupo?',
];

console.log('🤖 Asistente IA con Claude API cargado y listo.');