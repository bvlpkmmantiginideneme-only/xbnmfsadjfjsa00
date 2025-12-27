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
    try {
      await LogYonetim.error('state_load_hata', '❌ State dosyası bozuk', {
        klasor: 'panel',
        key: 'state',
        dosya: path.basename(stateFile),
        hata: e && e.message
      });
      await fsp.unlink(stateFile);
    } catch (_) {}
  }
  return null;
}

async function saveState(stateFile, state) {
  try {
    const dir = path.dirname(stateFile);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (e) {
    await LogYonetim.error('state_save_hata', '❌ State kaydedilemedi', {
      klasor: 'panel',
      key: 'state',
      dosya:  path.basename(stateFile),
      hata: e && e.message
    });
    return false;
  }
}

/* ==================== SAYFA YÖNETİMİ ====================*/

async function getSayfalarCount(sayfalarDir) {
  try {
    const files = await fsp.readdir(sayfalarDir).catch(() => []);
    const count = files.filter(f => {
      const isJs = f.endsWith('.js') || f.endsWith('.cjs');
      const isSayfa = /^\d+\. /.test(f);
      return isJs && isSayfa;
    }).length;
    return Math.max(count, 1);
  } catch (e) {
    return 1;
  }
}

async function loadSayfa(pageNum, sayfalarDir) {
  try {
    const dosyaAdi = `${pageNum}. js`;
    const full = path.join(sayfalarDir, dosyaAdi);

    if (!fs.existsSync(full)) {
      return null;
    }

    delete require.cache[require.resolve(full)];
    const sayfa = require(full);

    if (!sayfa || typeof sayfa.getPageNumber !== 'function') {
      return null;
    }

    return sayfa;
  } catch (e) {
    await LogYonetim.error('sayfa_load_hata', `❌ Sayfa ${pageNum} yüklenemedi`, {
      klasor: 'panel',
      key: 'sayfa',
      sayfa: pageNum,
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
  const hours = Math. floor((s % 86400) / 3600);
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
    let pageDesc = '📝 Açıklama yok';
    let pageContent = '📄 İçerik yok';

    if (sayfa) {
      if (typeof sayfa.getPageName === 'function') {
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
          pageContent = await sayfa.getPageContent(userId);
        } catch (_) {}
      }
    }

    const remaining = computeRemaining(Date.now(), state.timeoutAt);
    const remainingStr = formatRemaining(remaining);
    const sayfalarCount = await getSayfalarCount(sayfalarDir);

    const embed = new EmbedBuilder()
      .setColor('#4a9eff')
      .setTitle(`📊 ${pageTitle}`)
      .setDescription(pageDesc)
      .addFields(
        { name: '📄 İçerik', value:  pageContent || '❌ İçerik yok', inline: false },
        { name: '👤 Kullanıcı', value: `<@${userId}>`, inline: true },
        { name: '🔢 Sayfa', value: `${pageNum}/${sayfalarCount}`, inline: true },
        { name:  '⏳ Kalan Süre', value: `${remainingStr}`, inline: false }
      )
      .setFooter({ text: `📅 ${new Date().toLocaleTimeString('tr-TR')}` })
      .setTimestamp();

    return embed;
  } catch (e) {
    await LogYonetim.error('panel_embed_hata', '❌ Panel embed oluşturulamadı', {
      klasor: 'panel',
      key: 'embed',
      kullaniciID: userId,
      sayfa: pageNum,
      hata: e && (e.stack || e.message),
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
    .setLabel('⬅️ Önceki')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage <= 1);

  const pageDisplay = new ButtonBuilder()
    .setCustomId('panel_page_display')
    .setLabel(`📌 ${currentPage}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`panel_next_${currentPage}`)
    .setLabel('Sonraki ➡️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage >= maxPage);

  const selectPageBtn = new ButtonBuilder()
    .setCustomId('panel_select_page')
    .setLabel('📑 Sayfa Seç')
    .setStyle(ButtonStyle.Primary);

  const refreshBtn = new ButtonBuilder()
    .setCustomId('panel_refresh')
    .setLabel('🔄 Yenile')
    .setStyle(ButtonStyle.Secondary);

  const queryBtn = new ButtonBuilder()
    .setCustomId('panel_query')
    .setLabel('🔍 Sorgula')
    .setStyle(ButtonStyle.Success);

  const closeBtn = new ButtonBuilder()
    .setCustomId('panel_close')
    .setLabel('❌ Kapat')
    .setStyle(ButtonStyle. Danger);

  row.addComponents(prevBtn, pageDisplay, nextBtn, selectPageBtn, refreshBtn, queryBtn, closeBtn);
  return row;
}

function buildPageSelectModal(maxPage) {
  const modal = new ModalBuilder()
    .setCustomId('panel_page_select_modal')
    .setTitle('📄 Sayfa Seçin');

  const pageInput = new TextInputBuilder()
    .setCustomId('page_number')
    .setLabel('Sayfa Numarası')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`1 ile ${maxPage} arasında`)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(pageInput);
  modal.addComponents(row);
  return modal;
}

async function safeReplyToInteraction(interaction, payload) {
  if (! interaction) return null;

  try {
    if (! interaction.replied && ! interaction.deferred) {
      try {
        return await interaction.reply(payload);
      } catch (e1) {
        try {
          return await interaction.editReply(payload);
        } catch (e2) {
          try {
            return await interaction.followUp(Object.assign({}, payload, { ephemeral: true }));
          } catch (e3) {
            return null;
          }
        }
      }
    } else {
      try {
        return await interaction.editReply(payload);
      } catch (e1) {
        try {
          return await interaction. followUp(Object.assign({}, payload, { ephemeral: true }));
        } catch (e2) {
          return null;
        }
      }
    }
  } catch (e) {
    return null;
  }
}

async function updateAndSendPanelEmbed(interaction, userId, state, pageNum, stateFile, sayfalarDir, db, traceId) {
  try {
    const embed = await buildPanelEmbed(userId, state, pageNum, sayfalarDir, db, traceId);
    const sayfalarCount = await getSayfalarCount(sayfalarDir);
    const buttons = buildPanelButtons(pageNum, sayfalarCount);

    if (embed) {
      await safeReplyToInteraction(interaction, { embeds: [embed], components: [buttons] });
    }
  } catch (e) {
    await LogYonetim.error('panel_update_hata', '❌ Panel güncelleme hatası', {
      klasor:  'panel',
      key:  'update',
      kullaniciID: userId,
      sayfa: pageNum,
      hata: e && (e.stack || e.message),
      traceID: traceId
    });
  }
}

function startPanelRefreshTimer(userId, stateFile, sayfalarDir, db, interaction, traceId) {
  const refreshTimer = setInterval(async () => {
    try {
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        clearInterval(refreshTimer);
        return;
      }

      const now = Date.now();

      // Timeout kontrolü
      if (now >= state.timeoutAt) {
        state. status = 'dead';
        await saveState(stateFile, state);
        clearInterval(refreshTimer);

        await LogYonetim.panelKapandi(userId, 'timeout', state.guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⏰ Panel Süresi Doldu')
          .setDescription('Panelin süresi doldu. Yeni bir panel açmak için `/sorgula` yazın.')
          .setTimestamp();

        try {
          await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        } catch (_) {}

        return;
      }

      // 5 saniyede bir embed yenile
      if (now - state.embedLastUpdatedAt >= 5000) {
        state.embedLastUpdatedAt = now;
        await saveState(stateFile, state);

        try {
          const sayfalarCount = await getSayfalarCount(sayfalarDir);
          const embed = await buildPanelEmbed(userId, state, state.currentPage, sayfalarDir, db, state.traceId || traceId);
          const buttons = buildPanelButtons(state.currentPage, sayfalarCount);

          if (embed && interaction) {
            try {
              await interaction.editReply({ embeds: [embed], components: [buttons] });
            } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (e) {
      await LogYonetim.error('panel_refresh_hata', '❌ Panel refresh hatası', {
        klasor: 'panel',
        key: 'timer',
        kullaniciID:  userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });
      clearInterval(refreshTimer);
    }
  }, 1000);

  return refreshTimer;
}

const panelTimers = new Map();

/* ==================== KOMUT ====================*/

module.exports = {
  data:  new SlashCommandBuilder()
    .setName('sorgula')
    .setDescription('📊 Panel açar ve sorgu yapmanızı sağlar'),

  permission: 'user',

  execute:  async (interaction, context) => {
    const { client, db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let existingState = await loadState(stateFile);

      // Aktif panel kontrolü
      if (existingState && existingState. status === 'active') {
        await LogYonetim. warn('panel_acik', '⚠️ Zaten aktif panel var', {
          klasor: 'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('⚠️ Panel Zaten Açık')
          .setDescription('Sizin zaten bir aktif paneliniz var. Lütfen onu kapatıp tekrar deneyin.')
          .addFields({ name: '💡 İpucu', value: 'Paneli kapatmak için "❌ Kapat" butonuna tıklayın.' })
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      // Eski paneli temizle
      if (existingState && existingState.status === 'dead') {
        try {
          await fsp.unlink(stateFile);
        } catch (_) {}
      }

      // Yeni panel oluştur
      const now = Date.now();
      const panelSuresi = Math.max(10, Number(process.env.PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));

      const newState = {
        userId,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        traceId,
        status: 'active',
        currentPage: 1,
        createdAt: now,
        lastActionAt: now,
        timeoutAt: now + (panelSuresi * 1000),
        embedLastUpdatedAt: now,
        panelSuresi
      };

      const saved = await saveState(stateFile, newState);

      if (!saved) {
        await LogYonetim.error('panel_state_yazma_hata', '❌ Panel state yazılamadı', {
          klasor: 'panel',
          key: 'execute',
          kullaniciID: userId,
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❌ Hata')
          .setDescription('Panel açılırken hata oluştu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      await LogYonetim.panelAcildi(userId, 1, interaction.guildId, traceId);

      // Paneli oluştur
      const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
      const panelEmbed = await buildPanelEmbed(userId, newState, 1, SAYFALAR_DIR, db, traceId);
      const panelButtons = buildPanelButtons(1, sayfalarCount);

      if (! panelEmbed) {
        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❌ Hata')
          .setDescription('Panel oluşturulamadı.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      await safeReplyToInteraction(interaction, { embeds: [panelEmbed], components: [panelButtons], ephemeral: true });

      // Refresh timer başlat
      const timer = startPanelRefreshTimer(userId, stateFile, SAYFALAR_DIR, db, interaction, traceId);
      panelTimers.set(userId, timer);

      await LogYonetim.kullaniciKomut(userId, 'sorgula', interaction.guildId, traceId);

    } catch (e) {
      await LogYonetim.error('panel_execute_hata', '❌ Panel execute hatası', {
        klasor: 'panel',
        key: 'execute',
        kullaniciID: userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Hata')
        .setDescription('Panel açılırken hata oluştu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  },

  handleButton: async (interaction, buttonId, context) => {
    const { db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path. join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⚠️ Panel Kapalı')
          .setDescription('Bu panel artık aktif değil. Yeni bir panel açmak için `/sorgula` yazın.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      const now = Date.now();

      // Timeout kontrolü
      if (now >= state.timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);

        await LogYonetim.panelKapandi(userId, 'timeout', state.guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⏰ Panel Süresi Doldu')
          .setDescription('Panelin süresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      // Süreyi yenile
      state.lastActionAt = now;
      const yeniPanelSuresi = Math. max(10, Number(process. env.PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      // Buton işlemleri
      if (buttonId. startsWith('panel_prev_')) {
        const currentPage = parseInt(buttonId.split('_')[2]);
        const newPage = Math.max(1, currentPage - 1);
        state.currentPage = newPage;
        await updateAndSendPanelEmbed(interaction, userId, state, newPage, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

      } else if (buttonId.startsWith('panel_next_')) {
        const currentPage = parseInt(buttonId.split('_')[2]);
        const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
        const newPage = Math.min(sayfalarCount || 1, currentPage + 1);
        state.currentPage = newPage;
        await updateAndSendPanelEmbed(interaction, userId, state, newPage, stateFile, SAYFALAR_DIR, db, state. traceId || traceId);

      } else if (buttonId === 'panel_select_page') {
        const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
        const modal = buildPageSelectModal(sayfalarCount || 1);
        try {
          await interaction.showModal(modal);
        } catch (e) {
          await LogYonetim.error('modal_show_hata', '❌ Modal gösterilirken hata', {
            klasor: 'panel',
            key: 'button',
            kullaniciID:  userId,
            hata: e && (e.stack || e. message),
            traceID:  state.traceId || traceId
          });
        }
        await saveState(stateFile, state);
        return;

      } else if (buttonId === 'panel_refresh') {
        state.embedLastUpdatedAt = now;
        await updateAndSendPanelEmbed(interaction, userId, state, state.currentPage, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

      } else if (buttonId === 'panel_query') {
        const sayfa = await loadSayfa(state.currentPage, SAYFALAR_DIR);
        if (sayfa && typeof sayfa.getQueryModal === 'function') {
          const modal = await sayfa.getQueryModal();
          try {
            await interaction.showModal(modal);
          } catch (e) {
            await LogYonetim.error('sorgu_modal_hata', '❌ Sorgu modal hatası', {
              klasor: 'panel',
              key: 'button',
              kullaniciID:  userId,
              sayfa: state.currentPage,
              hata: e && (e.stack || e.message),
              traceID: state.traceId || traceId
            });
          }
        } else {
          const embed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('⚠️ Sorgu Yok')
            .setDescription('Bu sayfada sorgu yapılamaz.')
            .setTimestamp();
          await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        }
        await saveState(stateFile, state);
        return;

      } else if (buttonId === 'panel_close') {
        await LogYonetim. panelKapandi(userId, 'kullanici', state.guildId, state. traceId || traceId);
        try {
          await fsp.unlink(stateFile);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor('#4a9eff')
          .setTitle('👋 Panel Kapatıldı')
          .setDescription('Panel başarıyla kapatıldı.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
        return;
      }

      await saveState(stateFile, state);

    } catch (e) {
      await LogYonetim.error('button_handler_hata', '❌ Button handler hatası', {
        klasor: 'panel',
        key: 'button',
        kullaniciID: userId,
        buttonId,
        hata: e && (e.stack || e. message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Hata')
        .setDescription('Buton işlenirken hata oluştu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
    }
  },

  handleModal: async (interaction, modalId, context) => {
    const { db, LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⚠️ Panel Kapalı')
          .setDescription('Panel artık aktif değil.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      const now = Date.now();
      if (now >= state.timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);

        await LogYonetim.panelKapandi(userId, 'timeout', state.guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⏰ Panel Süresi Doldu')
          .setDescription('Panelin süresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      state.lastActionAt = now;
      const yeniPanelSuresi = Math.max(10, Number(process.env. PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      // Modal işlemleri
      if (modalId === 'panel_page_select_modal') {
        try {
          const pageNumber = interaction.fields.getTextInputValue('page_number');
          const page = parseInt(pageNumber);

          if (isNaN(page) || page < 1) {
            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('⚠️ Geçersiz Sayfa')
              .setDescription('Lütfen geçerli bir sayfa numarası girin.')
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
            return;
          }

          const sayfalarCount = await getSayfalarCount(SAYFALAR_DIR);
          if (page > sayfalarCount) {
            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('⚠️ Sayfa Bulunamadı')
              .setDescription(`Maximum sayfa:  ${sayfalarCount}`)
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
            return;
          }

          state.currentPage = page;
          await updateAndSendPanelEmbed(interaction, userId, state, page, stateFile, SAYFALAR_DIR, db, state.traceId || traceId);

        } catch (e) {
          await LogYonetim.error('page_select_hata', '❌ Sayfa seç hatası', {
            klasor: 'panel',
            key: 'modal',
            kullaniciID:  userId,
            hata: e && (e.stack || e.message),
            traceID: state.traceId || traceId
          });

          const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Hata')
            .setDescription('Sayfa seçilirken hata oluştu.')
            .setTimestamp();

          await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
        }

      } else if (modalId. startsWith('sayfa_') && modalId.endsWith('_sorgu_modal')) {
        const sayfa = await loadSayfa(state.currentPage, SAYFALAR_DIR);

        if (sayfa && typeof sayfa.handleQueryModal === 'function') {
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
            await LogYonetim.error('sorgu_execute_hata', '❌ Sorgu execute hatası', {
              klasor: 'panel',
              key: 'modal',
              kullaniciID:  userId,
              sayfa: state.currentPage,
              hata: e && (e.stack || e.message),
              traceID: state.traceId || traceId
            });

            const embed = new EmbedBuilder()
              .setColor('#ff0000')
              .setTitle('❌ Sorgu Hatası')
              .setDescription('Sorgu işlenirken hata oluştu.')
              .setTimestamp();

            await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral:  true });
          }
        }
      }

      await saveState(stateFile, state);

    } catch (e) {
      await LogYonetim. error('modal_handler_hata', '❌ Modal handler hatası', {
        klasor: 'panel',
        key: 'modal',
        kullaniciID: userId,
        modalId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Hata')
        .setDescription('Modal işlenirken hata oluştu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  },

  handleSelectMenu: async (interaction, menuId, context) => {
    const { LogYonetim, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR } = context;
    const userId = interaction.user.id;

    try {
      const stateFile = path.join(STATELER_DIR, `${userId}.json`);
      let state = await loadState(stateFile);

      if (!state || state.status !== 'active') {
        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⚠️ Panel Kapalı')
          .setDescription('Panel artık aktif değil.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      const now = Date.now();
      if (now >= state.timeoutAt) {
        state.status = 'dead';
        await saveState(stateFile, state);

        await LogYonetim.panelKapandi(userId, 'timeout', state.guildId, state.traceId || traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('⏰ Panel Süresi Doldu')
          .setDescription('Panelin süresi doldu.')
          .setTimestamp();

        await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      state.lastActionAt = now;
      const yeniPanelSuresi = Math.max(10, Number(process.env. PANEL_DEAKTIF_SANIYE || PANEL_DEAKTIF_SANIYE));
      state.timeoutAt = now + (yeniPanelSuresi * 1000);

      try {
        const selected = interaction.values[0] || 'unknown';
        await LogYonetim.info('selectmenu_secildi', `📌 SelectMenu seçimi: ${selected}`, {
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
      await LogYonetim.error('selectmenu_handler_hata', '❌ SelectMenu handler hatası', {
        klasor: 'panel',
        key: 'button',
        kullaniciID: userId,
        menuId,
        hata: e && (e. stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Hata')
        .setDescription('SelectMenu işlenirken hata oluştu.')
        .setTimestamp();

      await safeReplyToInteraction(interaction, { embeds: [embed], ephemeral: true });
    }
  }
};