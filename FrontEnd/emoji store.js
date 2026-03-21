// ================================================================
//  FIX 3: Tienda de Emojis Personalizados (estilo Discord/Twitch)
//
//  INSTRUCCIÓN: Pega este bloque en tu app.js, al lado de donde
//  están definidos tus STORE_ITEMS actuales y las funciones de tienda.
// ================================================================

// ── 1. DEFINICIÓN DE EMOJIS EN LA TIENDA ────────────────────────
// Agrégalos a tu objeto STORE_ITEMS o crea este nuevo objeto:

const EMOJI_STORE = {
    // ── PACK FIFA 2026 ────────────────────────────────────────
    emoji_gol: {
        id: 'emoji_gol',
        name: '⚽ GOL!',
        description: 'Emoji de gol animado para el chat',
        price: 150,
        category: 'emoji',
        emoji: '⚽',
        shortcode: ':gol:',
        css: 'spin-emoji'           // clase CSS de animación
    },
    emoji_fire: {
        id: 'emoji_fire',
        name: '🔥 Fuego',
        description: 'Para mensajes épicos',
        price: 100,
        category: 'emoji',
        emoji: '🔥',
        shortcode: ':fire:',
        css: 'pulse-emoji'
    },
    emoji_mvp: {
        id: 'emoji_mvp',
        name: '🏆 MVP',
        description: 'Eres el mejor del grupo',
        price: 300,
        category: 'emoji',
        emoji: '🏆',
        shortcode: ':mvp:',
        css: 'bounce-emoji'
    },
    emoji_monterrey: {
        id: 'emoji_monterrey',
        name: '🦌 MTY',
        description: 'Orgullo regiomontano',
        price: 200,
        category: 'emoji',
        emoji: '🦌',
        shortcode: ':mty:',
        css: 'shake-emoji'
    },
    emoji_whistle: {
        id: 'emoji_whistle',
        name: '📯 Pitido',
        description: 'El árbitro pitó',
        price: 80,
        category: 'emoji',
        emoji: '📯',
        shortcode: ':pito:',
        css: ''
    },
    emoji_vamos: {
        id: 'emoji_vamos',
        name: '💪 VAMOS',
        description: 'Hype máximo',
        price: 120,
        category: 'emoji',
        emoji: '💪',
        shortcode: ':vamos:',
        css: 'pulse-emoji'
    },
    emoji_penalty: {
        id: 'emoji_penalty',
        name: '🥅 Penalty',
        description: 'Drama garantizado',
        price: 175,
        category: 'emoji',
        emoji: '🥅',
        shortcode: ':penalty:',
        css: ''
    },
    emoji_crown: {
        id: 'emoji_crown',
        name: '👑 Corona',
        description: 'Solo para campeones',
        price: 500,
        category: 'emoji',
        emoji: '👑',
        shortcode: ':corona:',
        css: 'glow-emoji'
    },
};

// ── 2. GESTIÓN DE EMOJIS COMPRADOS ──────────────────────────────

function getOwnedEmojis() {
    try {
        return JSON.parse(localStorage.getItem('ownedEmojis') || '[]');
    } catch(e) { return []; }
}

function ownsEmoji(emojiId) {
    return getOwnedEmojis().includes(emojiId);
}

function buyEmoji(emojiId) {
    const emoji = EMOJI_STORE[emojiId];
    if (!emoji) return;

    if (ownsEmoji(emojiId)) {
        showToast('Ya tienes este emoji ✨', 'info');
        return;
    }
    if (userPoints < emoji.price) {
        showToast(`Necesitas ${emoji.price - userPoints} puntos más 😢`, 'error');
        return;
    }

    // Descontar puntos
    userPoints -= emoji.price;
    currentUser.points = userPoints;
    saveUser();

    // Guardar emoji comprado
    const owned = getOwnedEmojis();
    owned.push(emojiId);
    localStorage.setItem('ownedEmojis', JSON.stringify(owned));

    // Guardar en Firestore
    if (window.db_saveReward) {
        window.db_saveReward(currentUser.name, `Compró emoji ${emoji.name}`, -emoji.price, userPoints);
    }

    showToast(`${emoji.emoji} ${emoji.name} desbloqueado!`, 'success');
    renderEmojiStore();
    updatePointsDisplay();
}

// ── 3. RENDER DE LA TIENDA DE EMOJIS ────────────────────────────
// Llama a esta función cuando se abra el tab de Tienda

function renderEmojiStore() {
    const container = document.getElementById('emoji-store-grid');
    if (!container) return;

    container.innerHTML = '';
    const owned = getOwnedEmojis();

    Object.values(EMOJI_STORE).forEach(item => {
        const isOwned = owned.includes(item.id);
        const canAfford = userPoints >= item.price;

        const card = document.createElement('div');
        card.className = `emoji-store-card ${isOwned ? 'owned' : ''} ${!canAfford && !isOwned ? 'cant-afford' : ''}`;
        card.innerHTML = `
            <div class="emoji-store-icon ${item.css}">${item.emoji}</div>
            <div class="emoji-store-name">${item.name}</div>
            <div class="emoji-store-code">${item.shortcode}</div>
            <div class="emoji-store-desc">${item.description}</div>
            ${isOwned
                ? `<div class="emoji-store-owned-badge">✅ Tienes</div>`
                : `<button class="emoji-buy-btn ${!canAfford ? 'disabled' : ''}"
                     onclick="buyEmoji('${item.id}')"
                     ${!canAfford ? 'disabled' : ''}>
                     💰 ${item.price} pts
                   </button>`
            }
        `;
        container.appendChild(card);
    });
}

// ── 4. PICKER DE EMOJIS EN EL CHAT ──────────────────────────────
// Al hacer clic en el botón 😊 del chat, muestra solo los emojis comprados

function toggleEmojiPicker() {
    let picker = document.getElementById('custom-emoji-picker');

    if (picker) {
        picker.remove();
        return;
    }

    const owned = getOwnedEmojis();
    if (owned.length === 0) {
        showToast('¡Compra emojis en la Tienda para usarlos! 🛒', 'info');
        return;
    }

    picker = document.createElement('div');
    picker.id = 'custom-emoji-picker';
    picker.className = 'emoji-picker-popup';

    picker.innerHTML = `
        <div class="emoji-picker-title">Tus emojis</div>
        <div class="emoji-picker-grid">
            ${owned.map(id => {
                const e = EMOJI_STORE[id];
                if (!e) return '';
                return `<button class="emoji-pick-btn ${e.css}" 
                            title="${e.shortcode}"
                            onclick="insertEmojiToChat('${e.shortcode}', '${e.emoji}')">
                            ${e.emoji}
                        </button>`;
            }).join('')}
        </div>
    `;

    // Posicionar cerca del input de chat
    const inputArea = document.getElementById('chat-input-area') 
                   || document.querySelector('.chat-input-area');
    if (inputArea) {
        inputArea.appendChild(picker);
    } else {
        document.body.appendChild(picker);
    }

    // Cerrar al hacer clic fuera
    setTimeout(() => {
        document.addEventListener('click', function closePickerOnOutside(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerOnOutside);
            }
        });
    }, 100);
}

function insertEmojiToChat(shortcode, emojiChar) {
    const input = document.getElementById('message-input')
                || document.querySelector('.chat-input input')
                || document.querySelector('.chat-input textarea');
    if (input) {
        const pos   = input.selectionStart;
        const before = input.value.substring(0, pos);
        const after  = input.value.substring(pos);
        input.value = before + emojiChar + ' ' + after;
        input.focus();
        input.selectionStart = input.selectionEnd = pos + emojiChar.length + 1;
    }
    document.getElementById('custom-emoji-picker')?.remove();
}

// ── 5. RENDERIZAR EMOJIS EN MENSAJES RECIBIDOS ──────────────────
// Envuelve los emojis conocidos con animación CSS cuando se muestran en el chat

function renderEmojisInMessage(text) {
    const owned = getOwnedEmojis();
    let result = text;

    // Reemplazar shortcodes con emojis animados
    Object.values(EMOJI_STORE).forEach(item => {
        if (owned.includes(item.id) && item.css) {
            const regex = new RegExp(item.shortcode.replace(':', '\\:'), 'g');
            result = result.replace(
                item.emoji,
                `<span class="chat-emoji ${item.css}" title="${item.shortcode}">${item.emoji}</span>`
            );
        }
    });
    return result;
}

// Exponer para que appendMessage() lo llame si quieres:
window.renderEmojisInMessage = renderEmojisInMessage;
window.toggleEmojiPicker     = toggleEmojiPicker;
window.renderEmojiStore      = renderEmojiStore;
window.buyEmoji              = buyEmoji;

console.log('😊 Sistema de emojis cargado —', Object.keys(EMOJI_STORE).length, 'emojis disponibles');