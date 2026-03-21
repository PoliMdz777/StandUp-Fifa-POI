// ════════════════════════════════════════════════════════════════
//  PATCH para app.js — Bloque de Asistente IA actualizado
//
//  INSTRUCCIÓN: En app.js, dentro de la función sendMessage(),
//  busca el bloque que empieza con:
//
//      // ═══════════════════════════════════════════════════════
//      //  🤖 LÓGICA DEL ASISTENTE IA
//      // ═══════════════════════════════════════════════════════
//      if (currentChat.id === 'asistente_ia') {
//
//  Y reemplaza TODO ese bloque (hasta el comentario de cierre)
//  por el siguiente código:
// ════════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════
        //  🤖 ASISTENTE IA — Usa Claude API via ai_assistant.js
        // ═══════════════════════════════════════════════════════
        if (currentChat.id === 'asistente_ia') {
            if (window.handleAIMessage) {
                window.handleAIMessage(text);
            } else {
                // Fallback por si ai_assistant.js no cargó
                console.warn('⚠️ ai_assistant.js no está cargado.');
                const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                appendMessage(
                    '⚠️ El módulo del Asistente IA no está disponible. Asegúrate de incluir ai_assistant.js en INDEX.html.',
                    'received', '🤖 Asistente IA', time
                );
            }
            return; // No ejecutar la lógica de socket para la IA
        }
        // ═══════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
//  TAMBIÉN AGREGA esto en la función selectChat(),
//  después de que currentChat cambie, para limpiar historial IA:
//
//  Busca: currentChat = { type, id, name, avatarType };
//  Justo después añade:
// ════════════════════════════════════════════════════════════════

    // Limpiar historial de IA cuando se cambia a otro chat
    if (window.clearAIHistory && id !== 'asistente_ia') {
        window.clearAIHistory();
    }

    // Si se abre el chat de la IA, mostrar sugerencias rápidas
    if (id === 'asistente_ia' && window.AI_QUICK_SUGGESTIONS) {
        setTimeout(() => renderAIQuickSuggestions(), 100);
    }


// ════════════════════════════════════════════════════════════════
//  FUNCIÓN ADICIONAL: Sugerencias rápidas en el chat IA
//  Agrégala al final de app.js:
// ════════════════════════════════════════════════════════════════

function renderAIQuickSuggestions() {
    const msgs = document.getElementById('chat-messages');
    if (!msgs || document.getElementById('ai-suggestions')) return;

    const suggestions = window.AI_QUICK_SUGGESTIONS || [];
    if (!suggestions.length) return;

    const container = document.createElement('div');
    container.id = 'ai-suggestions';
    container.className = 'ai-suggestions-wrap';
    container.innerHTML = `
        <div class="ai-suggestions-label">💡 Preguntas frecuentes</div>
        <div class="ai-suggestions-grid">
            ${suggestions.map(s => `
                <button class="ai-suggestion-btn" onclick="sendAISuggestion(this, '${s.replace(/'/g, "\\'")}')">
                    ${s}
                </button>
            `).join('')}
        </div>
    `;
    msgs.appendChild(container);
    msgs.scrollTop = msgs.scrollHeight;
}

function sendAISuggestion(btn, text) {
    // Poner el texto en el input y enviarlo
    const input = document.getElementById('message-input');
    if (input) {
        input.value = text;
        sendMessage();
    }
    // Quitar sugerencias después del primer uso
    document.getElementById('ai-suggestions')?.remove();
}