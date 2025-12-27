// sayfalar/1.js
// IO7R Veritabanı Sayfa - Eksiksiz Sorgulaması
// TC, AD, SOYAD - DM Fallback Sistemi

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require('discord.js');

const LogYonetim = require('../log_yonetim');

module.exports = {
  getPageNumber: function() {
    return 1;
  },

  getPageName: async function() {
    return '🔍 IO7R Sorgulaması';
  },

  getPageDescription: async function() {
    return 'Kimlik numarası ile kişi bilgisi sorgulaması yapabilirsiniz';
  },

  getPageContent: async function(userId) {
    try {
      return '**📋 Mevcut Kolon Bilgisi:**\n' +
        '- 🆔 TC Kimlik Numarası\n' +
        '- 👤 Ad\n' +
        '- 👤 Soyadı\n\n' +
        '**💡 Sorgula butonuna tıklayarak modalı açın ve TC kimlik numarası girin. ';
    } catch (e) {
      return '❌ İçerik yüklenirken hata oluştu.';
    }
  },

  getQueryModal: async function() {
    try {
      const modal = new ModalBuilder()
        .setCustomId('sayfa_1_sorgu_modal')
        .setTitle('🔍 IO7R Sorgu Modal');

      const tcInput = new TextInputBuilder()
        .setCustomId('io7r_tc')
        .setLabel('TC Kimlik Numarası')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('11 haneli TC numarası')
        .setRequired(true);

      const tcRow = new ActionRowBuilder().addComponents(tcInput);
      modal.addComponents(tcRow);

      return modal;
    } catch (e) {
      console.error('❌ Modal oluşturma hatası:', e && e.message);
      return null;
    }
  },

  handleQueryModal: async function(interaction, context) {
    const { db, safeReply, LogYonetim, traceId, userId, state } = context;

    try {
      let tc = '';

      try {
        tc = interaction.fields.getTextInputValue('io7r_tc');
      } catch (_) {
        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('⚠️ Geçersiz İnput')
          .setDescription('Lütfen TC kimlik numarası girin.')
          .setTimestamp();

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      tc = tc.trim();
      if (! tc || tc.length !== 11 || !/^\d+$/.test(tc)) {
        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('⚠️ Geçersiz TC')
          .setDescription('TC kimlik numarası 11 haneli rakam olmalıdır.')
          .setTimestamp();

        await safeReply(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      await LogYonetim.info('sorgu_basladi', '🟢 IO7R sorgusu başladı', {
        klasor:  'database',
        key: 'sorgu',
        kullaniciID: userId,
        tc:  tc. substring(0, 3) + '***',
        traceID: traceId
      });

      let results = [];
      const start = Date.now();

      try {
        const sql = 'SELECT tc, ad, soyad FROM io7r WHERE tc = ?  LIMIT 1';
        const params = [tc];

        results = await db.query('main', sql, params, {
          queue: true,
          timeoutMs: 10000,
          traceId
        });

        const duration = Date.now() - start;

        await LogYonetim.sorguBasarili(userId, 'io7r', duration, results && results. length ?  results. length : 0, state. guildId, traceId);

      } catch (dbError) {
        const duration = Date.now() - start;

        await LogYonetim.sorguHatasi(userId, 'io7r', dbError && (dbError.message || String(dbError)), state.guildId, traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('❌ Veritabanı Hatası')
          .setDescription('Sorgu sırasında veritabanı hatası oluştu.  Lütfen daha sonra tekrar deneyiniz.')
          .addFields(
            { name: '📝 Hata Detayı', value: `\`\`\`${dbError && (dbError.message || 'Bilinmeyen hata')}\`\`\``, inline: false }
          )
          .setTimestamp();

        await safeReply(interaction, { embeds:  [embed], ephemeral: true });
        return;
      }

      if (! results || results.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('🔍 Sonuç Bulunamadı')
          .setDescription(`TC Kimlik Numarası: **${tc}** ile eşleşen kayıt bulunamadı.`)
          .setTimestamp();

        try {
          await safeReply(interaction, { embeds: [embed], ephemeral: true });
        } catch (_) {}

        return;
      }

      const kayit = results[0];

      const embed = new EmbedBuilder()
        .setColor('#4a9eff')
        .setTitle('✅ Sorgu Sonucu')
        .setDescription('IO7R Veritabanı - Kişi Bilgisi')
        .addFields(
          { name: '🆔 TC Kimlik Numarası', value: `\`\`\`${kayit.tc || 'N/A'}\`\`\``, inline: true },
          { name: '👤 Ad', value: `\`\`\`${kayit.ad || 'N/A'}\`\`\``, inline: true },
          { name: '👤 Soyadı', value: `\`\`\`${kayit.soyad || 'N/A'}\`\`\``, inline: true }
        )
        .setFooter({ text: `📅 Sorgu Zamanı: ${new Date().toLocaleTimeString('tr-TR')}` })
        .setTimestamp();

      try {
        await interaction.user.send({ embeds: [embed] });

        await LogYonetim.dmGonderildi(userId, 'IO7R Sorgu Sonucu', state.guildId, traceId);

        const confirmEmbed = new EmbedBuilder()
          .setColor('#4a9eff')
          .setTitle('✅ Sonuç Gönderildi')
          .setDescription('Sorgu sonucu DM olarak gönderilmiştir.')
          .setTimestamp();

        await safeReply(interaction, { embeds:  [confirmEmbed], ephemeral: true });

      } catch (dmError) {
        await LogYonetim.dmGonderimHatasi(userId, 'dmKapali', state.guildId, traceId);

        const dmErrorEmbed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('⚠️ DM Gönderilemedi')
          .setDescription('Özel mesaj alabilmesi için DM\'lerinizi açmış olmanız gerekmektedir.  Sonuç aşağıda gösterilmiştir: ')
          .addFields(
            { name: '🆔 TC Kimlik Numarası', value: `\`\`\`${kayit.tc || 'N/A'}\`\`\``, inline: true },
            { name:  '👤 Ad', value: `\`\`\`${kayit.ad || 'N/A'}\`\`\``, inline: true },
            { name: '👤 Soyadı', value: `\`\`\`${kayit.soyad || 'N/A'}\`\`\``, inline: true }
          )
          .setFooter({ text: `📅 Sorgu Zamanı: ${new Date().toLocaleTimeString('tr-TR')}` })
          .setTimestamp();

        await safeReply(interaction, { embeds: [dmErrorEmbed], ephemeral: true });
      }

    } catch (e) {
      await LogYonetim.error('sayfa1_execute_hata', '❌ Sayfa 1 execute hatası', {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID: userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Hata')
        .setDescription('Modal işlenirken hata oluştu.')
        .setTimestamp();

      try {
        await safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (_) {}
    }
  }
};