// sayfalar/1.js
// IO7R Veritabani Sayfa - Eksiksiz Sorgulamasi
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
    return 'IO7R Sorgulamasi';
  },

  getPageDescription: async function() {
    return 'Kimlik numarasi ile kisi bilgisi sorgulamasi yapabilirsiniz';
  },

  getPageContent: async function(userId) {
    try {
      return '**Mevcut Kolon Bilgisi:**\n' +
        '- TC Kimlik Numarasi\n' +
        '- Ad\n' +
        '- Soyadi\n\n' +
        '**Sorgula butonuna tiklayarak modali acin ve TC kimlik numarasi girin. ';
    } catch (e) {
      return 'Icerik yuklenirken hata olustu. ';
    }
  },

  getQueryModal: async function() {
    try {
      const modal = new ModalBuilder()
        .setCustomId('sayfa_1_sorgu_modal')
        .setTitle('IO7R Sorgu Modal');

      const tcInput = new TextInputBuilder()
        .setCustomId('io7r_tc')
        .setLabel('TC Kimlik Numarasi')
        .setStyle(TextInputStyle. Short)
        .setPlaceholder('11 haneli TC numarasi')
        .setRequired(true);

      const tcRow = new ActionRowBuilder().addComponents(tcInput);
      modal.addComponents(tcRow);

      return modal;
    } catch (e) {
      console.error('[ERROR] Modal olusturma hatasi:', e && e.message);
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
          .setTitle('Gecersiz Input')
          .setDescription('Lutfen TC kimlik numarasi girin.')
          .setTimestamp();

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      tc = tc.trim();
      if (! tc || tc.length !== 11 || !/^\d+$/.test(tc)) {
        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('Gecersiz TC')
          .setDescription('TC kimlik numarasi 11 haneli rakam olmalidir.')
          .setTimestamp();

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      await LogYonetim.info('sorgu_basladi', 'IO7R sorgusu basladi', {
        klasor: 'database',
        key:  'sorgu',
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

        await LogYonetim.sorguBasarili(userId, 'io7r', duration, results && results. length ?  results. length : 0, state.guildId, traceId);

      } catch (dbError) {
        const duration = Date.now() - start;

        await LogYonetim.sorguHatasi(userId, 'io7r', dbError && (dbError.message || String(dbError)), state.guildId, traceId);

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('Veritabani Hatasi')
          .setDescription('Sorgu sirasinda veritabani hatasi olustu.  Lutfen daha sonra tekrar deneyiniz.')
          .addFields(
            { name:  'Hata Detayi', value: `\`\`\`${dbError && (dbError.message || 'Bilinmeyen hata')}\`\`\``, inline: false }
          )
          .setTimestamp();

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
        return;
      }

      if (! results || results.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('Sonuc Bulunamadi')
          .setDescription(`TC Kimlik Numarasi:  **${tc}** ile eslesen kayit bulunamadi.`)
          .setTimestamp();

        try {
          await safeReply(interaction, { embeds:  [embed], ephemeral: true });
        } catch (_) {}

        return;
      }

      const kayit = results[0];

      const embed = new EmbedBuilder()
        .setColor('#4a9eff')
        .setTitle('Sorgu Sonucu')
        .setDescription('IO7R Veritabani - Kisi Bilgisi')
        .addFields(
          { name: 'TC Kimlik Numarasi', value:  `\`\`\`${kayit.tc || 'N/A'}\`\`\``, inline: true },
          { name: 'Ad', value: `\`\`\`${kayit.ad || 'N/A'}\`\`\``, inline: true },
          { name: 'Soyadi', value: `\`\`\`${kayit.soyad || 'N/A'}\`\`\``, inline: true }
        )
        .setFooter({ text: `Sorgu Zamani: ${new Date().toLocaleTimeString('tr-TR')}` })
        .setTimestamp();

      try {
        await interaction.user.send({ embeds: [embed] });

        await LogYonetim.dmGonderildi(userId, 'IO7R Sorgu Sonucu', state.guildId, traceId);

        const confirmEmbed = new EmbedBuilder()
          .setColor('#4a9eff')
          .setTitle('Sonuc Gonderildi')
          .setDescription('Sorgu sonucu DM olarak gonderilmistir.')
          .setTimestamp();

        await safeReply(interaction, { embeds: [confirmEmbed], ephemeral: true });

      } catch (dmError) {
        await LogYonetim.dmGonderimHatasi(userId, 'dmKapali', state.guildId, traceId);

        const dmErrorEmbed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('DM Gonderilemedi')
          .setDescription('Ozel mesaj alabilmesi icin DMlerinizi acmis olmaniz gerekmektedir.  Sonuc asagida gosterilmistir: ')
          .addFields(
            { name: 'TC Kimlik Numarasi', value:  `\`\`\`${kayit.tc || 'N/A'}\`\`\``, inline: true },
            { name:  'Ad', value: `\`\`\`${kayit.ad || 'N/A'}\`\`\``, inline: true },
            { name: 'Soyadi', value:  `\`\`\`${kayit.soyad || 'N/A'}\`\`\``, inline: true }
          )
          .setFooter({ text: `Sorgu Zamani: ${new Date().toLocaleTimeString('tr-TR')}` })
          .setTimestamp();

        await safeReply(interaction, { embeds:  [dmErrorEmbed], ephemeral:  true });
      }

    } catch (e) {
      console.error('[ERROR] sayfa1_execute_hata:', e && e.message);
      await LogYonetim. error('sayfa1_execute_hata', 'Sayfa 1 execute hatasi', {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID:  userId,
        hata: e && (e.stack || e.message),
        traceID: traceId
      });

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Hata')
        .setDescription('Modal islenirken hata olustu.')
        .setTimestamp();

      try {
        await safeReply(interaction, { embeds:  [embed], ephemeral: true });
      } catch (_) {}
    }
  }
};