// komutlar/sorgula.js
// PANEL KOMUTU - TAM VE EKSIKSIZ IMPLEMENTASYON
// Panel açma, state yönetimi, buton/modal/menu handlers

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const LogYonetim = require('../log_yonetim');

/* ==================== STATE YÖNETİMİ ====================*/

async function loadState(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      const data = fs.readFileSync(stateFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console. warn('[WARN] loadState', 'State dosyasi bozuk:', path.basename(stateFile));
    try {
      await LogYonetim.error('state_load_hata', 'State dosyasi bozuk', {
        klasor:  'panel',
        key: 'state',
        dosya: path.basename(stateFile),
        hata:  e && e.message
      });
      await fsp.unlink(stateFile);
    } catch (_) {}
  }
  return null;
}

async function saveState(stateFile, state) {
  try {
    const dir = path.dirname(stateFile);
    await fsp.mkdir(dir, { recursive:  true });
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[ERROR] saveState', 'State kaydedilemedi:', e && e.message);
    await LogYonetim.error('state_save_hata', 'State kaydedilemedi', {
      klasor:  'panel',
      key: 'state',
      dosya: path.basename(stateFile),
      hata:  e && e.message
    });
    return false;
  }
}

/* ==================== SAYFA YÖNETİMİ ====================*/

async function getSayfalarCount(sayfalarDir) {
  try {
    const files = await fsp. readdir(sayfalarDir).catch(() => []);
    const count = files.filter(f => {
      return /^\d+\.(js|cjs)$/i.test(f);
    }).length;
    return Math.max(count, 1);
  } catch (e) {
    console.warn('[WARN] getSayfalarCount', e && e.message);
    return 1;
  }
}

async function loadSayfa(pageNum, sayfalarDir) {
  try {
    const dosyaAdi = `${pageNum}. js`;
    const full = path.join(sayfalarDir, dosyaAdi);

    if (!fs.existsSync(full)) {
      console.warn('[WARN] loadSayfa', `Sayfa bulunamadi:  ${dosyaAdi}`);
      await LogYonetim.warn('sayfa_bulunamadi', `Sayfa bulunamadi: ${dosyaAdi}`, {
        klasor: 'panel',
        key: 'sayfa',
        sayfa: pageNum
      });
      return null;
    }

    delete require.cache[require.resolve(full)];
    const sayfa = require(full);

    if (!sayfa || typeof sayfa.getPageNumber !== 'function') {
      console. warn('[WARN] loadSayfa', `Sayfa gecersiz: ${dosyaAdi}`);
      await LogYonetim. warn('sayfa_gecersiz', `Sayfa gecersiz: ${dosyaAdi}`, {
        klasor: 'panel',
        key: 'sayfa',
        sayfa: pageNum
      });
      return null;
    }

    return sayfa;
  } catch (e) {
    console. error('[ERROR] loadSayfa', `Sayfa ${pageNum} yuklenemedi:`, e && e.message);
    await LogYonetim. error('sayfa_load_hata', `Sayfa ${pageNum} yuklenemedi`, {
      klasor: 'panel',
      key:  'sayfa',
      sayfa:  pageNum,
      hata: e && e.message
    });
    return null;
  }
}

/* ==================== HELPER FONKSİYONLAR ====================*/

function computeRemaining(nowMs, timeoutMs) {
  const diff = Math.max(0, timeoutMs - nowMs);
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return { days, hours, minutes, seconds, totalSeconds: s };
}

function formatRemaining(remaining) {
  const { days, hours, minutes, seconds } = remaining;
  if (days > 0) return `${days}g ${hours}s ${minutes}d`;
  if (hours > 0) return `${hours}s ${minutes}d ${seconds}sn`;
  if (minutes > 0) return `${minutes}d ${seconds}sn`;
  return `${seconds}sn`;
}

async function buildPanelEmbed(userId, state, pageNum, sayfalarDir, db, traceId) {
  try {
    const sayfa = await loadSayfa(pageNum, sayfalarDir);

    let pageTitle = `Sayfa ${pageNum}`;
    let pageDesc = 'Aciklama yok';
    let pageContent = 'Icerik yok';

    if (sayfa) {
      if (typeof sayfa. getPageName === 'function') {
        try {
          pageTitle = await sayfa.getPageName();
        } catch (_) {}
      }
      if (typeof sayfa.getPageDescription === 'function') {
        try {
          pageDesc = await sayfa.getPageDescription();
        } catch (_) {}
      }
      if (typeof sayfa.getPageContent === 'function') {
        try {
          pageContent = await sayfa. getPageContent(userId);
        } catch (_) {}
      }
    } else {
      pageContent = 'Bu sayfa yuklenemedi.  Lutfen yoneticiye basvurun.';
    }

    const remaining = computeRemaining(Date.now(), state.timeoutAt);
    const remainingStr = formatRemaining(remaining);
    const sayfalarCount = await getSayfalarCount(sayfalarDir);

    const embed = new EmbedBuilder()
      .setColor('#4a9eff')
      .setTitle(`${pageTitle}`)
      .setDescription(pageDesc)
      .addFields(
        { name:  'Icerik', value: pageContent || 'Icerik yok', inline: false },
        { name: 'Kullanici', value: `<@${userId}>`, inline: true },
        { name: 'Sayfa', value: `${pageNum}/${sayfalarCount}`, inline: true },
        { name: 'Kalan Sure', value: `${remainingStr}`, inline: false }
      )
      .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      .setTimestamp();

    return embed;
  } catch (e) {
    console.error('[ERROR] buildPanelEmbed', e && e.message);
    await LogYonetim.error('panel_embed_hata', 'Panel embed olusturulamadi', {
      klasor: 'panel',
      key:  'embed',
      kullaniciID: userId,
      sayfa: pageNum,
      hata:  e && (e.stack || e.message),
      traceID: traceId
    });
    return null;
  }
}

function buildPanelButtons(currentPage, sayfalarCount) {
  const row = new ActionRowBuilder();
  const maxPage = sayfalarCount || 1;

  const prevBtn = new ButtonBuilder()
    .setCustomId(`panel_prev_${currentPage}`)
    .setLabel('Onceki')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage <= 1);

  const pageDisplay = new ButtonBuilder()
    .setCustomId('panel_page_display')
    .setLabel(`${currentPage}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`panel_next_${currentPage}`)
    .setLabel('Sonraki')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage >= maxPage);

  const selectPageBtn = new ButtonBuilder()
    .setCustomId('panel_select_page')
    .setLabel('Sayfa Sec')
    .setStyle(ButtonStyle. Primary);

  const refreshBtn = new ButtonBuilder()
    .setCustomId('panel_refresh')
    .setLabel('Yenile')
    .setStyle(ButtonStyle. Secondary);

  const queryBtn = new ButtonBuilder()
    .setCustomId('panel_query')
    .setLabel('Sorgula')
    .setStyle(ButtonStyle.Success);

  const closeBtn = new ButtonBuilder()
    .setCustomId('panel_close')
    .setLabel('Kapat')
    .setStyle(ButtonStyle.Danger);

  row.addComponents(prevBtn, pageDisplay, nextBtn, selectPageBtn, refreshBtn, queryBtn, closeBtn);
  return row;
}

function buildPageSelectModal(maxPage) {
  const modal = new ModalBuilder()
    .setCustomId('panel_page_select_modal')
    .setTitle('Sayfa Secin');

  const pageInput = new TextInputBuilder()
    .setCustomId('page_number')
    .setLabel('Sayfa Numarasi')
    .setStyle(TextInputStyle. Short)
    .setPlaceholder(`1 ile ${maxPage} arasinda`)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(pageInput);
  modal.addComponents(row);
  return modal;
}

async function safeReplyToInteraction(interaction, payload) {
  if (!interaction) return null;

  try {
    if (! interaction.replied && ! interaction.deferred) {
      try {
        return await interaction.reply(payload);
      } catch (e1) {
        console.warn('[WARN] safeReply reply failed:', e1 && e1.message);
        try {
          return await interaction.editReply(payload);
        } catch (e2) {
          console.warn('[WARN] safeReply editReply failed:', e2 && e2.message);
          try {
            return await interaction.followUp(Object.assign({}, payload, { ephemeral: true }));
          } catch (e3) {
            console.error('[ERROR] safeReply all methods failed:', e3 && e3.message);
            return null;
          }
        }
      }
    } else {
      try {
        return await interaction.editReply(payload);
      } catch (e1) {
        console.warn('[WARN] safeReply editReply failed (deferred):', e1 && e1.message);
        try {
          return await interaction.followUp(Object.assign({}, payload, { ephemeral: true }));
        } catch (e2) {
          console.error('[ERROR] safeReply followUp failed:', e2 && e2.message);
          return null;
        }
      }
    }
  } catch (e) {
    console. error('[ERROR] safeReplyToInteraction:', e && e.message);
    return null;
  }
}

async function updateAndSendPanelEmbed(interaction, userId, state, pageNum, stateFile, sayfalarDir, db, traceId) {
  try {
    const embed = await buildPanelEmbed(userId, state, pageNum, sayfalarDir, db, traceId);
    const sayfalarCount = await getSayfalarCount(sayfalarDir);
    const buttons = buildPanelButtons(pageNum, sayfalarCount);

    if (embed) {
      const result = await safeReplyToInteraction(interaction, { embeds: [embed], components: [buttons] });
      if (! result) {
        console.error('[ERROR] updateAndSendPanelEmbed', 'Embed gonderilemedi');
        await LogYonetim.error('panel_embed_gonderim_hata', 'Panel embed gonderilemedi', {
          klasor: 'panel',
          key: 'update',
          kullaniciID: userId,
          sayfa: pageNum,
          traceID: traceId
        });
      }
      return result;
    } else {
      const errorEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Panel Hatasi')
        .setDescription('Panel icerigi olusturulamadi.  Lutfen tekrar deneyin.')
        .setTimestamp();
      
      await safeReplyToInteraction(interaction, { embeds: [errorEmbed], ephemeral: true });
      return null;
    }
  } catch (e) {
    console. error('[ERROR] updateAndSendPanelEmbed:', e && e.message);
    await LogYonetim. error('panel_update_hata', 'Panel guncelleme hatasi', {
      klasor: 'panel',
      key: 'update',
      kullaniciID: userId,
      sayfa: pageNum,
      hata: e && (e.stack || e.message),
      traceID: traceId
    });
    return null;
  }
}

const panelTimers = new Map();

function clearPanelTimer(userId) {
  if (panelTimers. has(userId)) {
    clearInterval(panelTimers.get(userId));
    panelTimers.delete(userId);
  }
}

function startPanelRefreshTimer(userId, stateFile, sayfalarDir, db, interaction, traceId) {
  const refreshTimer = setInterval(async () => {
    try {
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        clearInterval(refreshTimer);
        panelTimers.delete(userId);
        return;
      }

      const now = Date.now();

      if (now >= state.timeoutAt) {
        state. status = 'dead';
        await saveState(stateFile, state);
        clearInterval(refreshTimer);
        panelTimers.delete(userId);

        await LogYonetim. panelKapandi(userId, 'timeout', state.guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Suresi Doldu')
          .setDescription('Panelin suresi doldu.  Yeni bir panel acmak icin /sorgula yazin.')
          .setTimestamp();

        try {
          await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
        } catch (_) {}

        return;
      }

      if (now - state.embedLastUpdatedAt >= 5000) {
        state.embedLastUpdatedAt = now;
        await saveState(stateFile, state);

        try {
          const sayfalarCount = await getSayfalarCount(sayfalarDir);
          const embed = await buildPanelEmbed(userId, state, state. currentPage, sayfalarDir, db, state.traceId || traceId);
          const buttons = buildPanelButtons(state. currentPage, sayfalarCount);

          if (embed && interaction) {
            try {
              await interaction.editReply({ embeds: [embed], components: [buttons] });
            } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('[ERROR] panelRefreshTimer:', e && e.message);
      await LogYonetim.error('panel_refresh_hata', 'Panel refresh hatasi', {
        klasor: 'panel',
        key: 'timer',
        kullaniciID: userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });
      clearInterval(refreshTimer);
      panelTimers.delete(userId);
    }
  }, 1000);

  return refreshTimer;
}

/* ==================== KOMUT ====================*/

module.exports = {
  data:  new SlashCommandBuilder()
    .setName('sorgula')
    .setDescription('Panel acar ve sorgu yapmanizi saglar'),

  permission: 'user',

  execute:  async (interaction, context) => {
    const { client, db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let existingState = await loadState(stateFile);

      if (existingState && existingState.status === 'active') {
        await LogYonetim.warn('panel_acik', 'Zaten aktif panel var', {
          klasor: 'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('Panel Zaten Acik')
          .setDescription('Sizin zaten bir aktif paneliniz var.  Lutfen onu kapatip tekrar deneyin.')
          .addFields({ name: 'Ipucu', value: 'Paneli kapatmak icin Kapat butonuna tiklayin.' })
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      clearPanelTimer(userId);
      if (existingState && existingState.status === 'dead') {
        try {
          await fsp.unlink(stateFile);
        } catch (_) {}
      }

      const now = Date.now();
      const panelSuresi = Math.max(10, Number(process.env.PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));

      const newState = {
        userId,
        guildId: interaction.guildId,
        channelId: interaction. channelId,
        traceId,
        status: 'active',
        currentPage: 1,
        createdAt: now,
        lastActionAt: now,
        timeoutAt:  now + (panelSuresi * 1000),
        embedLastUpdatedAt: now,
        panelSuresi
      };

      const saved = await saveState(stateFile, newState);

      if (! saved) {
        console.error('[ERROR] execute', 'Panel state yazilamadi');
        await LogYonetim.error('panel_state_yazma_hata', 'Panel state yazilamadi', {
          klasor: 'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('Hata')
          .setDescription('Panel acilirken hata olustu. State dosyasi kaydedilemedi.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      await LogYonetim.panelAcildi(userId, 1, interaction.guildId, traceId);

      const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
      if (sayfalarCount === 0) {
        console.warn('[WARN] execute', 'Hic sayfa bulunamadi');
        await LogYonetim.warn('sayfa_yok', 'Hic sayfa bulunamadi', {
          klasor: 'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });
      }

      const panelEmbed = await buildPanelEmbed(userId, newState, 1, SAYFALAR_DIR, db, traceId);
      const panelButtons = buildPanelButtons(1, sayfalarCount);

      if (! panelEmbed) {
        console. error('[ERROR] execute', 'Panel embed olusturulamadi');
        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('Hata')
          .setDescription('Panel olusturulamadi. Sayfa dosyalarini kontrol edin.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
        return;
      }

      const result = await safeReplyToInteraction(interaction, { embeds: [panelEmbed], components: [panelButtons], ephemeral: true });
      
      if (! result) {
        console.error('[ERROR] execute', 'Panel gonderilemedi');
        await LogYonetim.error('panel_gonderim_hata', 'Panel gonderilemedi', {
          klasor:  'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });
        return;
      }

      const timer = startPanelRefreshTimer(userId, stateFile, SAYFALAR_DIR, db, interaction, traceId);
      panelTimers.set(userId, timer);

      await LogYonetim. kullaniciKomut(userId, 'sorgula', interaction.guildId, traceId);

    } catch (e) {
      console. error('[ERROR] execute:', e && e.message);
      await LogYonetim. error('panel_execute_hata', 'Panel execute hatasi', {
        klasor: 'panel',
        key:  'execute',
        kullaniciID: userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Hata')
        .setDescription('Panel acilirken beklenmeyen bir hata olustu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  },

  handleButton: async (interaction, buttonId, context) => {
    const { db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user. id;

    try {
      const stateFile = path. join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (! state || state.status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Kapali')
          .setDescription('Bu panel artik aktif degil. Yeni bir panel acmak icin /sorgula yazin.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      const now = Date.now();

      if (now >= state.timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);
        clearPanelTimer(userId);

        await LogYonetim.panelKapandi(userId, 'timeout', state.guildId, state. traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Suresi Doldu')
          .setDescription('Panelin suresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      state.lastActionAt = now;
      const yeniPanelSuresi = Math.max(10, Number(process.env.PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      if (buttonId. startsWith('panel_prev_')) {
        const currentPage = parseInt(buttonId.split('_')[2]);
        const newPage = Math.max(1, currentPage - 1);
        state.currentPage = newPage;
        await saveState(stateFile, state);
        await updateAndSendPanelEmbed(interaction, userId, state, newPage, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

      } else if (buttonId.startsWith('panel_next_')) {
        const currentPage = parseInt(buttonId.split('_')[2]);
        const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
        const newPage = Math.min(sayfalarCount || 1, currentPage + 1);
        state.currentPage = newPage;
        await saveState(stateFile, state);
        await updateAndSendPanelEmbed(interaction, userId, state, newPage, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

      } else if (buttonId === 'panel_select_page') {
        const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
        const modal = buildPageSelectModal(sayfalarCount || 1);
        try {
          await interaction.showModal(modal);
        } catch (e) {
          console.error('[ERROR] showModal:', e && e.message);
          await LogYonetim.error('modal_show_hata', 'Modal gosterilirken hata', {
            klasor: 'panel',
            key: 'button',
            kullaniciID: userId,
            hata: e && (e.stack || e.message),
            traceID: state.traceId || traceId
          });
        }
        await saveState(stateFile, state);
        return;

      } else if (buttonId === 'panel_refresh') {
        state.embedLastUpdatedAt = now;
        await saveState(stateFile, state);
        await updateAndSendPanelEmbed(interaction, userId, state, state.currentPage, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

      } else if (buttonId === 'panel_query') {
        const sayfa = await loadSayfa(state. currentPage, SAYFALAR_DIR);
        if (sayfa && typeof sayfa.getQueryModal === 'function') {
          const modal = await sayfa.getQueryModal();
          if (modal) {
            try {
              await interaction.showModal(modal);
            } catch (e) {
              console. error('[ERROR] showModal query:', e && e. message);
              await LogYonetim.error('sorgu_modal_hata', 'Sorgu modal hatasi', {
                klasor: 'panel',
                key:  'button',
                kullaniciID: userId,
                sayfa: state.currentPage,
                hata: e && (e.stack || e.message),
                traceID: state.traceId || traceId
              });
            }
          } else {
            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('Modal Olusturulamadi')
              .setDescription('Sorgu modali olusturulamadi.')
              .setTimestamp();
            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
          }
        } else {
          const embed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('Sorgu Yok')
            .setDescription('Bu sayfada sorgu yapilamaz.')
            .setTimestamp();
          await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        }
        await saveState(stateFile, state);
        return;

      } else if (buttonId === 'panel_close') {
        await LogYonetim. panelKapandi(userId, 'kullanici', state.guildId, state.traceId || traceId);
        clearPanelTimer(userId);
        try {
          await fsp.unlink(stateFile);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor('#4a9eff')
          .setTitle('Panel Kapatildi')
          .setDescription('Panel basariyla kapatildi.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      await saveState(stateFile, state);

    } catch (e) {
      console. error('[ERROR] handleButton:', e && e.message);
      await LogYonetim.error('button_handler_hata', 'Button handler hatasi', {
        klasor:  'panel',
        key: 'button',
        kullaniciID: userId,
        buttonId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Hata')
        .setDescription('Buton islenirken hata olustu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  },

  handleModal: async (interaction, modalId, context) => {
    const { db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (!state || state. status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Kapali')
          .setDescription('Panel artik aktif degil.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      const now = Date.now();
      if (now >= state. timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);
        clearPanelTimer(userId);

        await LogYonetim.panelKapandi(userId, 'timeout', state. guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Suresi Doldu')
          .setDescription('Panelin suresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      state.lastActionAt = now;
      const yeniPanelSuresi = Math.max(10, Number(process.env. PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      if (modalId === 'panel_page_select_modal') {
        try {
          const pageNumber = interaction.fields.getTextInputValue('page_number');
          const page = parseInt(pageNumber);

          if (isNaN(page) || page < 1) {
            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('Gecersiz Sayfa')
              .setDescription('Lutfen gecerli bir sayfa numarasi girin.')
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
            return;
          }

          const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
          if (page > sayfalarCount) {
            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('Sayfa Bulunamadi')
              .setDescription(`Maximum sayfa:  ${sayfalarCount}`)
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
            return;
          }

          state.currentPage = page;
          await saveState(stateFile, state);
          await updateAndSendPanelEmbed(interaction, userId, state, page, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

        } catch (e) {
          console.error('[ERROR] page_select:', e && e.message);
          await LogYonetim. error('page_select_hata', 'Sayfa sec hatasi', {
            klasor: 'panel',
            key: 'modal',
            kullaniciID: userId,
            hata: e && (e.stack || e.message),
            traceID: state.traceId || traceId
          });

          const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Hata')
            .setDescription('Sayfa secilirken hata olustu.')
            .setTimestamp();

          await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        }

      } else if (modalId. startsWith('sayfa_') && modalId.endsWith('_sorgu_modal')) {
        const sayfa = await loadSayfa(state.currentPage, SAYFALAR_DIR);

        if (sayfa && typeof sayfa. handleQueryModal === 'function') {
          try {
            await sayfa.handleQueryModal(interaction, {
              db,
              safeReply: safeReplyToInteraction,
              LogYonetim,
              traceId:  state.traceId || traceId,
              userId,
              state
            });
          } catch (e) {
            console.error('[ERROR] handleQueryModal:', e && e.message);
            await LogYonetim.error('sorgu_execute_hata', 'Sorgu execute hatasi', {
              klasor: 'panel',
              key: 'modal',
              kullaniciID: userId,
              sayfa:  state.currentPage,
              hata:  e && (e. stack || e.message),
              traceID: state.traceId || traceId
            });

            const embed = new EmbedBuilder()
              .setColor('#ff0000')
              .setTitle('Sorgu Hatasi')
              .setDescription('Sorgu islenirken hata olustu.')
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
          }
        } else {
          const embed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('Sorgu Islenemedi')
            .setDescription('Bu sayfa icin sorgu handler bulunamadi.')
            .setTimestamp();

          await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
        }
      }

      await saveState(stateFile, state);

    } catch (e) {
      console.error('[ERROR] handleModal:', e && e.message);
      await LogYonetim.error('modal_handler_hata', 'Modal handler hatasi', {
        klasor: 'panel',
        key:  'modal',
        kullaniciID: userId,
        modalId,
        hata: e && (e.stack || e.message),
        traceID:  traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Hata')
        .setDescription('Modal islenirken hata olustu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  },

  handleSelectMenu: async (interaction, menuId, context) => {
    const { LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR } = context;
    const userId = interaction. user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Kapali')
          .setDescription('Panel artik aktif degil.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      const now = Date. now();
      if (now >= state. timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);
        clearPanelTimer(userId);

        await LogYonetim.panelKapandi(userId, 'timeout', state. guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Panel Suresi Doldu')
          .setDescription('Panelin suresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      state.lastActionAt = now;
      const yeniPanelSuresi = Math.max(10, Number(process.env. PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      try {
        const selected = interaction.values[0] || 'unknown';
        await LogYonetim.info('selectmenu_secildi', `SelectMenu secimi: ${selected}`, {
          klasor: 'panel',
          key: 'button',
          kullaniciID: userId,
          menuId,
          secenek: selected,
          traceID: state.traceId || traceId
        });
      } catch (_) {}

      await saveState(stateFile, state);

    } catch (e) {
      console.error('[ERROR] handleSelectMenu:', e && e.message);
      await LogYonetim.error('selectmenu_handler_hata', 'SelectMenu handler hatasi', {
        klasor: 'panel',
        key: 'button',
        kullaniciID: userId,
        menuId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Hata')
        .setDescription('SelectMenu islenirken hata olustu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
    }
  }
};