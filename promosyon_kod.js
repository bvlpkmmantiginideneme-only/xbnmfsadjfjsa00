'use strict';

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PromoModul = require('@ozel_yapim_moduller/promosyon_kodlar_kontrol_modul.js');

/**
 * Bu komut:
 * /promosyon_kod kullan
 * /promosyon_kod listele
 * /promosyon_kod olustur
 *
 * - "kullan" herkes kullanabilir.
 * - "listele" ve "oluştur" sadece .env OWNER + ana dizin adminler.json içindeki kullanıcılar kullanabilir.
 */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promosyon_kod')
    .setDescription('🎁 Promosyon kod işlemleri')
    .addSubcommand(sub =>
      sub
        .setName('kullan')
        .setDescription('🎁 Promosyon kodunu kullanarak yetki kazanın')
        .addStringOption(option =>
          option
            .setName('kod')
            .setDescription('Kullanmak istediğiniz promosyon kodunu giriniz')
            .setRequired(true)
            .setMaxLength(100)
            .setMinLength(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('listele')
        .setDescription('📋 Kullanılabilir promosyon kodlarını listeler')
        .addBooleanOption(option =>
          option
            .setName('tum')
            .setDescription('true = tüm kodları (aktif + deaktif) gösterir (varsayılan: sadece aktif)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('olustur')
        .setDescription('🛠️ Yeni promosyon kodu oluşturur (sadece owner/admin)')
        .addStringOption(option =>
          option
            .setName('adi')
            .setDescription('Promosyon kod adı (benzersiz olmalı) Örn: KIS2026VIP1')
            .setRequired(true)
            .setMaxLength(100)
            .setMinLength(3)
        )
        .addStringOption(option =>
          option
            .setName('aciklama')
            .setDescription('Promosyon açıklaması')
            .setRequired(false)
            .setMaxLength(4000)
        )
        .addStringOption(option =>
          option
            .setName('durum')
            .setDescription('Kod durumu')
            .addChoices(
              { name: 'aktif', value: 'aktif' },
              { name: 'deaktif', value: 'deaktif' }
            )
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('siralama')
            .setDescription('Sıralama numarası (≥1). Boş ise otomatik verilir')
            .setRequired(false)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option
            .setName('baslangic')
            .setDescription('Başlangıç (YYYY-MM-DD HH:mm:ss). Boş ise şimdi')
            .setRequired(false)
            .setMaxLength(19)
        )
        .addStringOption(option =>
          option
            .setName('bitis')
            .setDescription('Bitiş (YYYY-MM-DD HH:mm:ss). Boş ise +30 gün')
            .setRequired(false)
            .setMaxLength(19)
        )
        .addStringOption(option =>
          option
            .setName('silinme')
            .setDescription('Silinme zamanı (YYYY-MM-DD HH:mm:ss) - boş bırakılabilir')
            .setRequired(false)
            .setMaxLength(19)
        )
        .addBooleanOption(option =>
          option
            .setName('vip')
            .setDescription('VIP yetkisi verilsin mi?')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('premium')
            .setDescription('Premium yetkisi verilsin mi?')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('admin')
            .setDescription('Admin yetkisi verilsin mi?')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('kullanim_limiti')
            .setDescription('Toplam kullanım limiti (0=sınırsız)')
            .setRequired(false)
            .setMinValue(0)
        )
        .addIntegerOption(option =>
          option
            .setName('ayni_kisi_limit')
            .setDescription('Aynı kişi kaç defa kullanabilir?')
            .setRequired(false)
            .setMinValue(1)
        )
        // Erişim kontrolleri: 0 devre dışı (herkese açık), 1 liste dahilinde kullanabilir
        .addIntegerOption(option =>
          option
            .setName('uye_kontrol')
            .setDescription('Üye kısıtı: 0=tüm üyeler, 1=sadece listede')
            .addChoices({ name: '0', value: 0 }, { name: '1', value: 1 })
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('uyeler')
            .setDescription('Kullanabilecek üye ID listesi (virgülle) (uye_kontrol=1 ise zorunlu)')
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addIntegerOption(option =>
          option
            .setName('rol_kontrol')
            .setDescription('Rol kısıtı: 0=tüm roller, 1=sadece listede')
            .addChoices({ name: '0', value: 0 }, { name: '1', value: 1 })
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('roller')
            .setDescription('Kullanabilecek rol ID listesi (virgülle) (rol_kontrol=1 ise zorunlu)')
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addIntegerOption(option =>
          option
            .setName('sunucu_kontrol')
            .setDescription('Sunucu kısıtı: 0=tüm sunucular, 1=sadece listede')
            .addChoices({ name: '0', value: 0 }, { name: '1', value: 1 })
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('sunucular')
            .setDescription('Kullanılabilir sunucu ID listesi (virgülle) (sunucu_kontrol=1 ise zorunlu)')
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addIntegerOption(option =>
          option
            .setName('kanal_kontrol')
            .setDescription('Kanal kısıtı: 0=tüm kanallar, 1=sadece listede')
            .addChoices({ name: '0', value: 0 }, { name: '1', value: 1 })
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('kanallar')
            .setDescription('Kullanılabilir kanal ID listesi (virgülle) (kanal_kontrol=1 ise zorunlu)')
            .setRequired(false)
            .setMaxLength(2000)
        )
    )
    .setDMPermission(false)
    .setContexts([0]),

  skipDefer: false,

  async execute(interaction, opts = {}) {
    const {
      client,
      db: dbManager,
      dbConnected,
      LogYonetim: SafeLog,
      createErrorEmbed,
      createSuccessEmbed,
      createWarningEmbed,
      createInfoEmbed,
      applyEmbedParameters
    } = opts;

    const fallbackTraceId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

    try {
      // ====== Helpers (local) ======

    const traceId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

    const userId = interaction.user.id;
    const userName = interaction.user.tag || interaction.user.username;
    const guildId = interaction.guildId;
    const guildName = interaction.guild?.name || 'Unknown Guild';
    const channelId = interaction.channelId;
    const channelName = interaction.channel?.name || 'Unknown Channel';
    const requestTime = PromoModul.nowDateTimeString();

    const withNoConsole = (obj = {}) => ({ ...obj, sendToConsole: false });

    const safeApply = (embed) => {
      try {
        if (typeof applyEmbedParameters === 'function') {
          // index.js imzası: (embed, guildId, userId)
          const out = applyEmbedParameters(embed, guildId, userId);
          return out || embed;
        }
      } catch (_) {}
      return embed;
    };

    const buildEmbed = ({ color = '#5865F2', title = 'Bilgilendirme', description = '', fields = [] } = {}) => {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: `TraceID: ${traceId}` })
        .setTimestamp();

      if (Array.isArray(fields) && fields.length > 0) {
        embed.addFields(fields);
      }

      return safeApply(embed);
    };

    const replyWithEmbed = async (options = {}) => {
      const embed = buildEmbed(options);
      return replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
    };

    const replyOrEdit = async (payload) => {
      try {
        if (!interaction.replied && !interaction.deferred) {
          // İstek: embed mesajları ephemeral olsun.
          // Ephemeral flag sadece ilk reply'da set edilebilir.
          if (payload && payload.embeds && payload.flags === undefined) {
            payload.flags = MessageFlags.Ephemeral;
          }
          await interaction.reply(payload);
        } else {
          // editReply tarafında flags gönderilmez.
          if (payload && payload.flags !== undefined) delete payload.flags;
          await interaction.editReply(payload);
        }
        return true;
      } catch (e) {
        try {
          await SafeLog?.error?.('promo_komut_reply_error', `Reply/EditReply hatası: ${e.message}`, withNoConsole({
            klasor: 'sunucular',
            key: 'promo',
            kullaniciID: userId,
            kullaniciTag: userName,
            sunucuID: guildId,
            sunucuAdi: guildName,
            kanalID: channelId,
            kanalAdi: channelName,
            traceID: traceId,
            hata: e.message,
            stack: e.stack?.split('\n')[0]
          }));
        } catch (_) { /* ignore */ }
        return false;
      }
    };

    const parseCsvIds = (input) => {
      if (!input || typeof input !== 'string') return [];
      return input
        .split(',')
        .map(s => (s || '').trim())
        .filter(Boolean)
        .filter(v => /^[0-9]{5,25}$/.test(v)); // Discord snowflake (yaklaşık)
    };

    const ensureDateTimeString = (val) => {
      // Beklenen format: YYYY-MM-DD HH:mm:ss
      // Basit doğrulama, parse edilemiyorsa null.
      if (!val || typeof val !== 'string') return null;
      const s = val.trim();
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return null;
      const d = new Date(s.replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return null;
      // normalize
      const yyyy = String(d.getFullYear()).padStart(4, '0');
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const HH = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
    };

    const addDaysToDateTimeString = (dateTimeStr, days = 30) => {
      try {
        const d = new Date(dateTimeStr.replace(' ', 'T'));
        if (Number.isNaN(d.getTime())) return PromoModul.nowDateTimeString();
        d.setDate(d.getDate() + days);
        const yyyy = String(d.getFullYear()).padStart(4, '0');
        const MM = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const HH = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
      } catch {
        return PromoModul.nowDateTimeString();
      }
    };

    const generate32Id = () => crypto.randomBytes(16).toString('hex').toUpperCase(); // 32 chars

    const readAdminsJson = () => {
      try {
        const p = path.resolve(process.cwd(), 'adminler.json');
        if (!fs.existsSync(p)) return [];
        const raw = fs.readFileSync(p, 'utf8');
        const json = JSON.parse(raw);
        if (!json || typeof json !== 'object') return [];
        const arr = Array.isArray(json.admins) ? json.admins : [];
        return arr.map(x => String(x)).filter(Boolean);
      } catch {
        return [];
      }
    };

    const getOwnerIdFromEnv = () => {
      // Olası env anahtarları
      const cand = [
        process.env.OWNER_ID,
        process.env.OWNER,
        process.env.BOT_OWNER_ID,
        process.env.BOT_OWNER,
        process.env.owner,
        process.env.owner_id
      ].filter(Boolean);
      return cand.length ? String(cand[0]) : null;
    };

    const isOwnerOrAdmin = () => {
      const ownerId = getOwnerIdFromEnv();
      const admins = readAdminsJson();
      return (ownerId && String(ownerId) === String(userId)) || admins.includes(String(userId));
    };

    const isCreateAllowed = () => isOwnerOrAdmin();
    const isListAllowed = () => isOwnerOrAdmin();

    const extractCodesArray = (raw) => {
      // PromoModul.loadPromosyonKodlar() -> { raw, byIdMap } bekleniyor.
      // Fakat farklı şemalar olabilir. Burada toleranslıyız.
      if (!raw) return [];

      if (Array.isArray(raw)) return raw;

      const likelyKeys = [
        'promosyon_kodlar',
        'promosyonKodlar',
        'kodlar',
        'codes',
        'items',
        'list'
      ];

      for (const k of likelyKeys) {
        if (Array.isArray(raw[k])) return raw[k];
      }

      // nested arama (tek seviye)
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === 'object') {
          for (const lk of likelyKeys) {
            if (Array.isArray(v[lk])) return v[lk];
          }
        }
      }

      return [];
    };

    const getCodeIdentity = (item) => {
      // Şema: item.kimlik_ve_durum.promosyon_kod_adı / id / durum vb
      const kd = item?.kimlik_ve_durum || {};
      return {
        id: kd.id || item?.id,
        siralama: Number(kd.siralama || item?.siralama || 0) || 0,
        ad: kd.promosyon_kod_adı || item?.promosyon_kod_adı || item?.adi || item?.ad,
        durum: kd.promosyon_kod_durum || item?.promosyon_kod_durum || item?.durum,
        aciklama: kd.promosyon_kod_aciklama || item?.promosyon_kod_aciklama || item?.aciklama || ''
      };
    };

    const normalizePromoCodeInput = (value) => String(value || '').trim();

    const isValidPromoCodeInput = (value) => /^[A-Za-z0-9_-]{1,100}$/.test(String(value || '').trim());

    const optionWasProvidedButInvalidDate = (optionName, parsedValue) => {
      const rawValue = interaction.options.getString(optionName);
      return rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '' && !parsedValue;
    };

    const toTimestampMs = (dateInput) => {
      try {
        const date = new Date(String(dateInput).replace(' ', 'T'));
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : Date.now();
      } catch {
        return Date.now();
      }
    };

    const getYetkiDosyaAyari = (yetkiTuru) => {
      const baseDir = path.resolve(process.cwd(), 'bot_yetki_kontrol_dosyalar');
      const map = {
        vip: {
          filePath: path.join(baseDir, 'vip_yetkililer.json'),
          // index.js (2026) kontrol dosyası varsayılan anahtarı
          listKey: 'vip_yetkililer',
          // eski/legacy şemalar (migrasyon için)
          legacyKeys: ['vip_uyeler', 'uyeler', 'yetkililer', 'list', 'data', 'users'],
          displayName: 'VIP'
        },
        premium: {
          filePath: path.join(baseDir, 'premium_yetkililer.json'),
          // index.js (2026) kontrol dosyası varsayılan anahtarı
          listKey: 'premium_yetkililer',
          legacyKeys: ['premium_uyeler', 'uyeler', 'yetkililer', 'list', 'data', 'users'],
          displayName: 'Premium'
        },
        admin: {
          filePath: path.join(baseDir, 'admin_yetkililer.json'),
          // index.js (2026) kontrol dosyası varsayılan anahtarı
          listKey: 'admin_yetkililer',
          legacyKeys: ['admin_uyeler', 'admins', 'uyeler', 'yetkililer', 'list', 'data', 'users'],
          displayName: 'Admin'
        }
      };

      return map[yetkiTuru] || null;
    };

    const readYetkiJson = (filePath, listKey, legacyKeys = []) => {
      const buildEmpty = () => ({ [listKey]: [] });

      if (!fs.existsSync(filePath)) {
        return buildEmpty();
      }

      const rawContent = fs.readFileSync(filePath, 'utf8');
      if (!rawContent || !rawContent.trim()) {
        return buildEmpty();
      }

      let parsed = null;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        return buildEmpty();
      }

      // Eğer dosya doğrudan array ise, index.js'in de desteklediği formatla uyum için
      // objeye migrate edip anahtar altına alıyoruz.
      if (Array.isArray(parsed)) {
        return { [listKey]: parsed };
      }

      const safeRoot = (!parsed || typeof parsed !== 'object') ? {} : parsed;

      const extractUid = (item) => {
        try {
          if (typeof item === 'string') return String(item).trim();
          if (item && typeof item === 'object') {
            return String(item.kullaniciId || item.userId || item.id || '').trim();
          }
        } catch {}
        return '';
      };

      const mergeUniqueByUser = (...lists) => {
        const out = [];
        const seen = new Set();
        for (const lst of lists) {
          for (const it of (Array.isArray(lst) ? lst : [])) {
            const uid = extractUid(it);
            if (!uid) continue;
            if (seen.has(uid)) continue;
            out.push(it);
            seen.add(uid);
          }
        }
        return out;
      };

      const desired = Array.isArray(safeRoot[listKey]) ? safeRoot[listKey] : [];

      const legacyFound = [];
      for (const k of (Array.isArray(legacyKeys) ? legacyKeys : [])) {
        if (!k || k === listKey) continue;
        if (Array.isArray(safeRoot[k])) legacyFound.push(safeRoot[k]);
      }

      // Bazı ortamlarda index.js dosyası varsayılan anahtarı boş kalıp,
      // eski anahtarda veri bulunabiliyor. Bu durumda merge ederek kaybı önlüyoruz.
      if (legacyFound.length > 0) {
        safeRoot[listKey] = mergeUniqueByUser(desired, ...legacyFound);
      } else if (!Array.isArray(safeRoot[listKey])) {
        safeRoot[listKey] = [];
      }

      return safeRoot;
    };

    const writeYetkiJsonAtomic = (filePath, payload) => {
      const dirName = path.dirname(filePath);
      fs.mkdirSync(dirName, { recursive: true });

      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, filePath);
      return true;
    };

    const addYetkiToTargetJson = ({ yetkiTuru, kullaniciId, baslangicTarihi, bitisTarihi }) => {
      const ayar = getYetkiDosyaAyari(yetkiTuru);
      if (!ayar) {
        return { ok: false, alreadyHad: false, error: 'Desteklenmeyen yetki türü.' };
      }

      const root = readYetkiJson(ayar.filePath, ayar.listKey, ayar.legacyKeys);
      const normalizedUserId = String(kullaniciId).trim();
      const currentList = Array.isArray(root[ayar.listKey]) ? root[ayar.listKey] : [];

      const extractUid = (item) => {
        try {
          if (typeof item === 'string') return String(item).trim();
          if (item && typeof item === 'object') {
            return String(item.kullaniciId || item.userId || item.id || '').trim();
          }
        } catch {}
        return '';
      };

      // Mevcut listeyi bozmadan, sadece geçerli kayıtları al + tekilleştir
      const list = [];
      const indexById = new Map();
      for (const item of currentList) {
        const uid = extractUid(item);
        if (!uid) continue;
        if (indexById.has(uid)) continue;
        indexById.set(uid, list.length);
        list.push(item);
      }

      const existingIndex = indexById.has(normalizedUserId) ? indexById.get(normalizedUserId) : -1;
      const alreadyHad = existingIndex !== -1;

      const yeniKayit = {
        kullaniciId: normalizedUserId,
        baslangic: toTimestampMs(baslangicTarihi),
        bitis: toTimestampMs(bitisTarihi),
        durum: 'aktif'
      };

      if (existingIndex !== -1) {
        const prev = list[existingIndex];
        // Eski kayıt obje ise alanlarını koru (ek metadata kaybolmasın)
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
          list[existingIndex] = {
            ...prev,
            ...yeniKayit,
            kullaniciId: normalizedUserId
          };
        } else {
          // String/bozuk kayıt ise normalize et
          list[existingIndex] = yeniKayit;
        }
      } else {
        list.push(yeniKayit);
      }

      root[ayar.listKey] = list;
      writeYetkiJsonAtomic(ayar.filePath, root);

      return {
        ok: true,
        alreadyHad,
        filePath: ayar.filePath,
        listKey: ayar.listKey,
        displayName: ayar.displayName
      };
    };

    // ====== Route by subcommand ======

    let sub = null;
    try {
      sub = interaction.options.getSubcommand();
    } catch (subErr) {
      await replyWithEmbed({
        color: '#ff4444',
        title: '❌ Komut Okunamadı',
        description: 'Komut seçenekleri okunurken bir sorun oluştu. Lütfen komutu tekrar deneyin.'
      });

      await SafeLog?.warn?.('promosyon_kod_subcommand_okunamadi', `Alt komut okunamadı: ${subErr.message}`, withNoConsole({
        klasor: 'sunucular',
        key: 'promo',
        kullaniciID: userId,
        kullaniciTag: userName,
        sunucuID: guildId,
        sunucuAdi: guildName,
        kanalID: channelId,
        kanalAdi: channelName,
        traceID: traceId,
        hata: subErr.message
      }));
      return;
    }

    // Başlangıç mesajı (defer yok)
    if (sub === 'kullan') {
      if (!(await replyOrEdit({ content: '⏳ Promosyon kodu kontrol ediliyor...', flags: MessageFlags.Ephemeral }))) return;
      await SafeLog?.info?.('promosyon_kod_kullan_basladi', 'Promosyon kodu kullan subcommand başladı', withNoConsole({
        klasor: 'sunucular',
        key: 'promo',
        kullaniciID: userId,
        kullaniciTag: userName,
        sunucuID: guildId,
        sunucuAdi: guildName,
        kanalID: channelId,
        kanalAdi: channelName,
        islemZamani: requestTime,
        traceID: traceId
      }));

      const girilenKodAdi = normalizePromoCodeInput(interaction.options.getString('kod'));

      // Input validation
      if (!girilenKodAdi) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Kod Girilmedi',
          description: 'Lütfen kullanmak istediğiniz promosyon kodunu yazın.\n\n**Örnek:** `/promosyon_kod kullan kod:KIS2026VIP1`'
        });

        await SafeLog?.warn?.('promosyon_kod_bos_kod', 'Boş promosyon kodu girildi', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          traceID: traceId
        }));
        return;
      }

      if (!isValidPromoCodeInput(girilenKodAdi)) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Geçersiz Kod Formatı',
          description: 'Promosyon kodunda sadece **harf**, **rakam**, **tire (-)** ve **alt çizgi (_)** kullanabilirsiniz.\n\nLütfen kodu kontrol edip tekrar deneyin.'
        });

        await SafeLog?.warn?.('promosyon_kod_gecersiz_format', 'Geçersiz promosyon kod formatı girildi', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          kodAdi: girilenKodAdi,
          traceID: traceId
        }));
        return;
      }

      // Rate limit
      const isRateLimited = !PromoModul.checkRateLimit(userId);
      if (isRateLimited) {
        const rateLimitEmbed = safeApply(
          new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🚫 Çok Hızlı İstekler')
            .setDescription(
              '⚠️ Çok fazla deneme yaptınız.\n\n' +
              '⏱️ Lütfen **1 dakika** sonra tekrar deneyin.\n\n' +
              '_Kısıtlama: Dakikada maksimum 3 deneme_'
            )
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [rateLimitEmbed] });

        await SafeLog?.warn?.('promosyon_kod_rate_limited', 'Kullanıcı rate limit\'e çarptı (olası brute force)', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          uyariTipi: 'RATE_LIMIT',
          maksDenemeSayisi: 3,
          traceID: traceId
        }));
        return;
      }

      // Member fetch & roles
      let member = null;
      let rolIdleri = [];
      try {
        member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('member fetch null');
        rolIdleri = Array.from(member.roles.cache.keys()).filter(id => typeof id === 'string');
        await SafeLog?.debug?.('promosyon_kod_member_ok', 'Üye bilgileri başarıyla alındı', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          rolSayisi: rolIdleri.length,
          traceID: traceId
        }));
      } catch (e) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Üye Bilgisi Bulunamadı')
            .setDescription('Üye bilgisi alınamadı. Lütfen daha sonra tekrar deneyin.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed] });

        await SafeLog?.error?.('promosyon_kod_member_fetch_exception', `Üye fetch exception: ${e.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          traceID: traceId,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        }));
        return;
      }

      // Validate via module (kullanım kural/erişim kontrol)
      await SafeLog?.info?.('promosyon_kod_validasyon_basladi', 'Promosyon kodu validasyonu başladı', withNoConsole({
        klasor: 'sunucular',
        key: 'promo',
        kullaniciID: userId,
        sunucuID: guildId,
        kodAdi: girilenKodAdi,
        rolSayisi: rolIdleri.length,
        traceID: traceId
      }));

      const validResult = await PromoModul.validatePromosyonKodKullanimi({
        kullaniciId: userId,
        girilenKodAdi,
        guildId,
        channelId,
        kullaniciRolIdListesi: rolIdleri
      }).catch(validErr => ({ ok: false, reason: 'ERROR', error: validErr.message }));

      const reasonMapping = {
        KOD_YOK: { title: 'Kod Bulunamadı', desc: 'Girdiğiniz promosyon kodu sistemde bulunamadı. Lütfen kodu kontrol edip tekrar deneyin.', color: '#ff4444', emoji: '🔍', shouldLog: true },
        STATE_SILINMIS: { title: 'Kod Kullanılamıyor', desc: 'Bu promosyon kodu artık kullanımda değil.', color: '#ff6666', emoji: '🗑️', shouldLog: true },
        STATE_DEAKTIF: { title: 'Kod Şu Anda Pasif', desc: 'Bu promosyon kodu şu anda aktif değil. Daha sonra tekrar deneyebilirsiniz.', color: '#ffaa00', emoji: '⏸️', shouldLog: true },
        KOD_DEAKTIF: { title: 'Kod Şu Anda Pasif', desc: 'Bu promosyon kodu şu anda aktif değil. Daha sonra tekrar deneyebilirsiniz.', color: '#ffaa00', emoji: '⏸️', shouldLog: true },
        TARIH_BASLAMADI: { title: 'Kodun Süresi Henüz Başlamadı', desc: 'Bu promosyon kodu henüz kullanım tarihine ulaşmadı.', color: '#ffaa00', emoji: '⏳', shouldLog: false },
        TARIH_BITTI: { title: 'Kodun Süresi Dolmuş', desc: 'Bu promosyon kodunun geçerlilik süresi sona ermiş.', color: '#ff4444', emoji: '⌛', shouldLog: false },
        LIMIT_DOLDU: { title: 'Kod Kullanım Limiti Dolmuş', desc: 'Bu promosyon kodu için tanımlanan toplam kullanım hakkı tamamlanmış.', color: '#ff6666', emoji: '⛔', shouldLog: false },
        ERISIM_UYE_RED: { title: 'Bu Kodu Kullanamıyorsunuz', desc: 'Bu promosyon kodu sizin hesabınız için uygun değil.', color: '#ff4444', emoji: '🔐', shouldLog: true },
        ERISIM_ROL_RED: { title: 'Gerekli Rol Bulunamadı', desc: 'Bu promosyon kodunu kullanabilmek için gerekli role sahip değilsiniz.', color: '#ff4444', emoji: '👥', shouldLog: true },
        ERISIM_SUNUCU_RED: { title: 'Bu Sunucuda Kullanılamaz', desc: 'Bu promosyon kodu yalnızca belirli sunucularda kullanılabilir.', color: '#ff4444', emoji: '🏰', shouldLog: true },
        ERISIM_KANAL_RED: { title: 'Bu Kanalda Kullanılamaz', desc: 'Bu promosyon kodu yalnızca belirli kanallarda kullanılabilir.', color: '#ff4444', emoji: '#️⃣', shouldLog: true },
        ERROR: { title: 'İşlem Tamamlanamadı', desc: 'Kod kontrolü sırasında bir sorun oluştu. Lütfen biraz sonra tekrar deneyin.', color: '#ff0000', emoji: '💥', shouldLog: true }
      };

      if (!validResult.ok) {
        const reason = validResult.reason || 'ERROR';
        const mapping = reasonMapping[reason] || reasonMapping.ERROR;

        const errorEmbed = safeApply(
          new EmbedBuilder()
            .setColor(mapping.color)
            .setTitle(`${mapping.emoji} ${mapping.title}`)
            .setDescription(mapping.desc + `\n\n**Kod:** \`${girilenKodAdi}\``)
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [errorEmbed] });

        const logFn = mapping.shouldLog ? SafeLog?.warn : SafeLog?.info;
        await logFn?.('promosyon_kod_validasyon_basarisiz', `Promosyon kodu reddedildi: ${reason}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          kodAdi: girilenKodAdi,
          redNedeni: reason,
          traceID: traceId
        }));
        return;
      }

      // Extract promo data
      const kodObj = validResult.kodObj;
      const kodId = validResult.kodId;
      const verilecekYetkiler = validResult.verilecekYetkiler || { vip: 'yetki_yok', premium: 'yetki_yok', admin: 'yetki_yok' };
      const kodAciklama = kodObj?.kimlik_ve_durum?.promosyon_kod_aciklama || 'Yetki promosyonu';
      const yetkiVerilisTarihi = PromoModul.nowDateTimeString();
      const yetkiBitisTarihi = calculateYetkiBitisTarihi(yetkiVerilisTarihi, 30);

      const yetkiTuru = (verilecekYetkiler.vip === 'yetki_var') ? 'vip'
        : (verilecekYetkiler.premium === 'yetki_var') ? 'premium'
          : (verilecekYetkiler.admin === 'yetki_var') ? 'admin'
            : 'hicbiri';

      if (yetkiTuru === 'hicbiri') {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Yetki Tanımı Bulunamadı',
          description: 'Bu promosyon kodu için verilecek yetki tanımı bulunamadı. Lütfen yetkili ekiple iletişime geçin.'
        });

        await SafeLog?.warn?.('promosyon_kod_yetki_tanimi_yok', 'Kod bulundu ancak verilecek yetki tanımı yok', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          kodAdi: girilenKodAdi,
          kodId,
          traceID: traceId
        }));
        return;
      }

      // Aktif yetki kontrolü (DB)
      if (!dbConnected || !dbManager) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('⚠️ Sistem Kontrolü Yapılamadı')
            .setDescription('Promosyon kodu kontrolü için veritabanı bağlantısı gerekiyor. Lütfen daha sonra tekrar deneyin.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed] });
        return;
      }

      try {
        const nowStr = PromoModul.nowDateTimeString();
        const rows = await dbManager.query(
          'main',
          `SELECT id, yetki_verildi_mi, yetki_bitis_tarihi, kullanici_kullanim_adet
           FROM promosyon_kodlar
           WHERE kullanici_id = ?
             AND kod_id = ?
             AND kullandigi_kod_adi = ?
           ORDER BY id DESC
           LIMIT 1`,
          [userId, kodId, girilenKodAdi],
          { queue: true, logQuery: false }
        );

        if (rows && rows.length > 0) {
          const r = rows[0];
          const activeCheck = await dbManager.query(
            'main',
            `SELECT COUNT(*) AS cnt
             FROM promosyon_kodlar
             WHERE id = ?
               AND yetki_verildi_mi = 1
               AND yetki_bitis_tarihi > ?`,
            [r.id, nowStr],
            { queue: true, logQuery: false }
          );

          const aktifYetkiVar = Number(activeCheck?.[0]?.cnt || 0) > 0;
          if (aktifYetkiVar) {
            const bitis = r.yetki_bitis_tarihi;
            const embed = safeApply(
              new EmbedBuilder()
                .setColor('#ff4444')
                .setTitle('🚫 Zaten Aktif Yetkiniz Var')
                .setDescription(
                  `Bu promosyon kodunu şu anda tekrar kullanamazsınız.\n\n` +
                  `✅ Yetkiniz hâlâ aktif.\n` +
                  `**Kod:** \`${girilenKodAdi}\`\n` +
                  `**Yetki Bitiş:** ${formatDateTRLong(bitis)}\n` +
                  `⏳ ${formatRemainingTR(bitis)}\n\n` +
                  `⏳ Yetkinizin süresi dolduğunda (ve kodun süresi de bitmemişse) tekrar kullanabilirsiniz.`
                )
                .setFooter({ text: `TraceID: ${traceId}` })
                .setTimestamp()
            );

            await replyOrEdit({ embeds: [embed] });

            await SafeLog?.info?.('promosyon_kod_aktif_yetki_var_red', 'Aktif yetki varken tekrar kullanım reddedildi', withNoConsole({
              klasor: 'sunucular',
              key: 'promo',
              kullaniciID: userId,
              kullaniciTag: userName,
              sunucuID: guildId,
              kodAdi: girilenKodAdi,
              kodId,
              yetkiBitisTarihi: bitis,
              traceID: traceId
            }));
            return;
          }
        }
      } catch (activeErr) {
        await SafeLog?.error?.('promosyon_kod_aktif_yetki_kontrol_hata', `Aktif yetki kontrol hatası: ${activeErr.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          kodId,
          traceID: traceId,
          hata: activeErr.message,
          stack: activeErr.stack?.split('\n')[0]
        }));

        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Sistem Hatası')
            .setDescription('Aktif yetki kontrolü sırasında hata oluştu. Lütfen daha sonra tekrar deneyin.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [embed] });
        return;
      }

      // Tekrar kullanım limiti ön kontrolü
      try {
        const tekrarLimit = Math.max(1, Number(kodObj?.kullanim?.ayni_kisi_tekrar_kullanim_limit || 1));
        const oncekiKayitlar = await dbManager.query(
          'main',
          `SELECT id, kullanici_kullanim_adet
           FROM promosyon_kodlar
           WHERE kullanici_id = ?
             AND kod_id = ?
             AND kullandigi_kod_adi = ?
           LIMIT 1`,
          [userId, kodId, girilenKodAdi],
          { queue: true, logQuery: false }
        );

        if (oncekiKayitlar && oncekiKayitlar.length > 0) {
          const currentUse = Number(oncekiKayitlar[0]?.kullanici_kullanim_adet || 0);
          if (currentUse >= tekrarLimit) {
            await replyWithEmbed({
              color: '#ff4444',
              title: '🚫 Kullanım Hakkınız Dolmuş',
              description:
                `Bu promosyon kodu için size tanımlanan kullanım hakkı dolmuş görünüyor.\n\n` +
                `**Kod:** \`${girilenKodAdi}\`\n` +
                `**İzin verilen kullanım:** ${tekrarLimit}\n` +
                `**Mevcut kullanımınız:** ${currentUse}`
            });

            await SafeLog?.warn?.('promosyon_kod_tekrar_limit_asildi_on_kontrol', 'Kullanıcı tekrar kullanım limitini aştı (ön kontrol)', withNoConsole({
              klasor: 'sunucular',
              key: 'promo',
              kullaniciID: userId,
              kullaniciTag: userName,
              sunucuID: guildId,
              kodAdi: girilenKodAdi,
              kodId,
              tekrarLimit,
              kullanmaSayisi: currentUse,
              traceID: traceId
            }));
            return;
          }
        }
      } catch (preCheckErr) {
        await SafeLog?.error?.('promosyon_kod_tekrar_limit_on_kontrol_hata', `Tekrar limit ön kontrol hatası: ${preCheckErr.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          kodId,
          traceID: traceId,
          hata: preCheckErr.message,
          stack: preCheckErr.stack?.split('\n')[0]
        }));

        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ İşlem Kontrolü Yapılamadı',
          description: 'Promosyon kodu kullanım hakkınız kontrol edilirken bir sorun oluştu. Lütfen tekrar deneyin.'
        });
        return;
      }

      // Yetki verme (hedef JSON dosyaları)
      const yetkiSonuclari = {
        vip: { basarili: false, hata: null, onceyenvar: false },
        premium: { basarili: false, hata: null, onceyenvar: false },
        admin: { basarili: false, hata: null, onceyenvar: false }
      };

      const grantOne = async (type) => {
        try {
          const addRes = addYetkiToTargetJson({
            yetkiTuru: type,
            kullaniciId: userId,
            baslangicTarihi: yetkiVerilisTarihi,
            bitisTarihi: yetkiBitisTarihi
          });

          if (addRes.ok) {
            yetkiSonuclari[type].basarili = true;
            yetkiSonuclari[type].onceyenvar = !!addRes.alreadyHad;

            await SafeLog?.success?.(`promosyon_kod_${type}_eklendi`, `${type.toUpperCase()} yetkisi hedef JSON dosyasına yazıldı`, withNoConsole({
              klasor: 'sunucular',
              key: 'promo',
              kullaniciID: userId,
              kullaniciTag: userName,
              sunucuID: guildId,
              kodAdi: girilenKodAdi,
              onceyenvar: !!addRes.alreadyHad,
              hedefDosya: addRes.filePath,
              hedefListe: addRes.listKey,
              traceID: traceId
            }));
          } else {
            yetkiSonuclari[type].hata = addRes.error || 'Yetki dosyasına yazılamadı';
            await SafeLog?.error?.(`promosyon_kod_${type}_hatasi`, `${type.toUpperCase()} yetkisi eklenemedi`, withNoConsole({
              klasor: 'sunucular',
              key: 'promo',
              kullaniciID: userId,
              kullaniciTag: userName,
              sunucuID: guildId,
              kodAdi: girilenKodAdi,
              traceID: traceId,
              hata: yetkiSonuclari[type].hata
            }));
          }
        } catch (e) {
          yetkiSonuclari[type].hata = e.message;
          await SafeLog?.error?.(`promosyon_kod_${type}_exception`, `${type.toUpperCase()} eklemede exception: ${e.message}`, withNoConsole({
            klasor: 'sunucular',
            key: 'promo',
            kullaniciID: userId,
            sunucuID: guildId,
            kodAdi: girilenKodAdi,
            traceID: traceId,
            hata: e.message,
            stack: e.stack?.split('\n')[0]
          }));
        }
      };

      if (verilecekYetkiler.vip === 'yetki_var') await grantOne('vip');
      if (verilecekYetkiler.premium === 'yetki_var') await grantOne('premium');
      if (verilecekYetkiler.admin === 'yetki_var') await grantOne('admin');

      const anyYetkiGrantedAfterWrite = yetkiSonuclari.vip.basarili || yetkiSonuclari.premium.basarili || yetkiSonuclari.admin.basarili;
      if (!anyYetkiGrantedAfterWrite) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Yetki Kaydı Oluşturulamadı',
          description: 'Promosyon kodu doğrulandı ancak yetki kayıt dosyasına yazma işlemi tamamlanamadı. Lütfen daha sonra tekrar deneyin.'
        });

        await SafeLog?.error?.('promosyon_kod_yetki_yazma_tamamen_basarisiz', 'Hiçbir yetki hedef JSON dosyasına yazılamadı', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          kodId,
          traceID: traceId,
          vipHata: yetkiSonuclari.vip.hata,
          premiumHata: yetkiSonuclari.premium.hata,
          adminHata: yetkiSonuclari.admin.hata
        }));
        return;
      }

      // DB write (UPDATE / INSERT + tekrar limit)
      let dbWriteSuccess = false;
      let dbError = null;

      try {
        const existingRows = await dbManager.query(
          'main',
          `SELECT id, kullanici_kullanim_adet
           FROM promosyon_kodlar
           WHERE kullanici_id = ?
             AND kod_id = ?
             AND kullandigi_kod_adi = ?
           LIMIT 1`,
          [userId, kodId, girilenKodAdi],
          { queue: true, logQuery: false }
        );

        const tekrarLimit = Math.max(1, Number(kodObj?.kullanim?.ayni_kisi_tekrar_kullanim_limit || 1));
        const nowStr = PromoModul.nowDateTimeString();

        if (existingRows && existingRows.length > 0) {
          const existing = existingRows[0];
          const currentUse = Number(existing.kullanici_kullanim_adet || 0);

          if (currentUse >= tekrarLimit) {
            const embed = safeApply(
              new EmbedBuilder()
                .setColor('#ff4444')
                .setTitle('🚫 Tekrar Kullanım Limiti Aşıldı')
                .setDescription(
                  `Bu promosyon kodunu daha fazla kullanamazsınız.\n\n` +
                  `**Kod:** \`${girilenKodAdi}\`\n` +
                  `**Limit:** ${tekrarLimit}\n` +
                  `**Sizin kullanımınız:** ${currentUse}`
                )
                .setFooter({ text: `TraceID: ${traceId}` })
                .setTimestamp()
            );

            await replyOrEdit({ embeds: [embed] });

            await SafeLog?.warn?.('promosyon_kod_tekrar_limit_asildi', 'Kullanıcı tekrar kullanım limitini aştı', withNoConsole({
              klasor: 'sunucular',
              key: 'promo',
              kullaniciID: userId,
              kullaniciTag: userName,
              sunucuID: guildId,
              kodAdi: girilenKodAdi,
              kodId,
              tekrarLimit,
              kullanmaSayisi: currentUse,
              traceID: traceId
            }));
            return;
          }

          await dbManager.query(
            'main',
            `UPDATE promosyon_kodlar
             SET kullanici_kullanim_adet = kullanici_kullanim_adet + 1,
                 yetki_verildi_mi = 1,
                 islem_durumu = 'basarili',
                 hata_mesaji = 'yok',
                 son_kontrol_tarihi = NOW(),
                 yetki_verilis_tarihi = ?,
                 yetki_bitis_tarihi = ?,
                 verilecek_yetki_turu = ?,
                 iptal_tarihi = 'yok',
                 iptal_sebebi = 'yok'
             WHERE id = ?`,
            [yetkiVerilisTarihi, yetkiBitisTarihi, yetkiTuru, existing.id],
            { queue: true, timeoutMs: 10000 }
          );

          dbWriteSuccess = true;

          await SafeLog?.success?.('promosyon_kod_db_update_basarili', 'Promosyon kaydı UPDATE edildi (+1)', withNoConsole({
            klasor: 'sunucular',
            key: 'promo',
            kullaniciID: userId,
            kullaniciTag: userName,
            sunucuID: guildId,
            sunucuAdi: guildName,
            kodId,
            kodAdi: girilenKodAdi,
            yetkiTuru,
            yetkiBitisTarihi,
            oncekiKullanim: currentUse,
            yeniKullanim: currentUse + 1,
            traceID: traceId
          }));
        } else {
          await dbManager.query(
            'main',
            `INSERT INTO promosyon_kodlar 
             (kullanici_id, kod_id, kullandigi_kod_adi, kullandigi_kod_aciklama, 
              yetki_verilis_tarihi, yetki_bitis_tarihi, verilecek_yetki_turu, 
              islem_durumu, yetki_verildi_mi, hata_mesaji, son_kontrol_tarihi, 
              iptal_tarihi, iptal_sebebi, kullanici_kullanim_adet)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              kodId,
              girilenKodAdi,
              kodAciklama,
              yetkiVerilisTarihi,
              yetkiBitisTarihi,
              yetkiTuru,
              'basarili',
              1,
              'yok',
              nowStr,
              'yok',
              'yok',
              1
            ],
            { queue: true, timeoutMs: 10000 }
          );

          dbWriteSuccess = true;

          await SafeLog?.success?.('promosyon_kod_db_insert_basarili', 'Promosyon kaydı DB\'ye INSERT edildi', withNoConsole({
            klasor: 'sunucular',
            key: 'promo',
            kullaniciID: userId,
            kullaniciTag: userName,
            sunucuID: guildId,
            sunucuAdi: guildName,
            kodId,
            kodAdi: girilenKodAdi,
            yetkiTuru,
            yetkiBitisTarihi,
            kullaniciKullanimAdet: 1,
            traceID: traceId
          }));
        }
      } catch (e) {
        dbError = e.message;
        await SafeLog?.error?.('promosyon_kod_db_yazma_hatasi', `DB yazma hatası: ${e.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodId,
          kodAdi: girilenKodAdi,
          traceID: traceId,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        }));
      }

      // JSON usage increment (best effort)
      let jsonUpdateSuccess = false;
      try {
        const promo = await PromoModul.loadPromosyonKodlar();
        const kodItem = promo?.byIdMap?.get?.(kodId);

        if (kodItem && kodItem.kullanim && typeof kodItem.kullanim === 'object') {
          const currentUsage = Number(kodItem.kullanim.promosyon_kod_kullanma_adet) || 0;
          kodItem.kullanim.promosyon_kod_kullanma_adet = currentUsage + 1;

          if (promo.raw?.global && typeof promo.raw.global === 'object') {
            const currentGlobal = Number(promo.raw.global.promosyon_kod_kullanma_toplam_adet) || 0;
            promo.raw.global.promosyon_kod_kullanma_toplam_adet = currentGlobal + 1;
          }

          const saveOk = await PromoModul.savePromosyonKodlar(promo.raw);
          if (saveOk) jsonUpdateSuccess = true;
        }
      } catch (e) {
        await SafeLog?.error?.('promosyon_kod_json_guncelleme_exception', `JSON güncelleme exception: ${e.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kodId,
          kodAdi: girilenKodAdi,
          traceID: traceId,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        }));
      }

      // Build response
      const vipStatus = verilecekYetkiler.vip === 'yetki_var'
        ? (yetkiSonuclari.vip.basarili ? (yetkiSonuclari.vip.onceyenvar ? '✅ VIP (Yenilendi)' : '✅ VIP (Yeni)') : `❌ VIP (${yetkiSonuclari.vip.hata || 'Hata'})`)
        : '⚪ VIP (Verilmez)';

      const premiumStatus = verilecekYetkiler.premium === 'yetki_var'
        ? (yetkiSonuclari.premium.basarili ? (yetkiSonuclari.premium.onceyenvar ? '✅ Premium (Yenilendi)' : '✅ Premium (Yeni)') : `❌ Premium (${yetkiSonuclari.premium.hata || 'Hata'})`)
        : '⚪ Premium (Verilmez)';

      const adminStatus = verilecekYetkiler.admin === 'yetki_var'
        ? (yetkiSonuclari.admin.basarili ? (yetkiSonuclari.admin.onceyenvar ? '✅ Admin (Yenilendi)' : '✅ Admin (Yeni)') : `❌ Admin (${yetkiSonuclari.admin.hata || 'Hata'})`)
        : '⚪ Admin (Verilmez)';

      const dbStatus = dbWriteSuccess ? '✅ DB Kaydı (Başarılı)' : `❌ DB Kaydı (${dbError || 'Bilinmiyor'})`;
      const jsonStatus = jsonUpdateSuccess ? '✅ JSON Güncelleme' : '⚠️ JSON Güncelleme (Kısmi)';

      const anyYetkiGranted = yetkiSonuclari.vip.basarili || yetkiSonuclari.premium.basarili || yetkiSonuclari.admin.basarili;
      const isSuccess = anyYetkiGranted && dbWriteSuccess;
      const isPartial = anyYetkiGranted && !dbWriteSuccess;

      const responseEmbed = safeApply(
        new EmbedBuilder()
          .setColor(isSuccess ? '#00ff88' : isPartial ? '#ffaa00' : '#ff4444')
          .setTitle(isSuccess ? '✅ Promosyon Kodu Başarıyla Kullanıldı!' : isPartial ? '⚠️ Promosyon Kodu Kısmen Uygulandı' : '❌ Promosyon Kodu Uygulanamadı')
          .setDescription(
            isSuccess
              ? `🎉 Yetkilendirilmeniz tamamlandı.\n\n**Kod:** \`${girilenKodAdi}\`\n**Açıklama:** ${kodAciklama}`
              : isPartial
                ? `⚠️ Yetki verildi ancak bazı işlemler tamamlanamadı.\n\n**Kod:** \`${girilenKodAdi}\``
                : `❌ Yetkilendirme işlemi başarısız oldu.\n\n**Kod:** \`${girilenKodAdi}\``
          )
          .addFields(
            { name: '🎖️ Yetki Durumları', value: `${vipStatus}\n${premiumStatus}\n${adminStatus}`, inline: false },
            { name: '💾 Sistem Durumu', value: `${dbStatus}\n${jsonStatus}`, inline: false },
            { name: '⏰ Geçerlilik', value: `**Başlangıç:** ${yetkiVerilisTarihi}\n**Bitiş:** ${yetkiBitisTarihi}`, inline: false }
          )
          .setFooter({ text: `TraceID: ${traceId}` })
          .setTimestamp()
      );

      await replyOrEdit({ embeds: [responseEmbed] });

      // Final log
      if (isSuccess) {
        await SafeLog?.success?.('promosyon_kod_tamamlandi_tamamen', 'Promosyon kodu tamamen başarılı', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          kodAdi: girilenKodAdi,
          kodId,
          yetkiTuru,
          yetkiBitisTarihi,
          dbBasarili: dbWriteSuccess,
          jsonBasarili: jsonUpdateSuccess,
          traceID: traceId
        }));
      } else if (anyYetkiGranted) {
        await SafeLog?.warn?.('promosyon_kod_kismen_basarili', 'Promosyon kodu kısmen başarılı', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kodAdi: girilenKodAdi,
          kodId,
          dbBasarili: dbWriteSuccess,
          dbHatasi: dbError,
          traceID: traceId
        }));
      } else {
        await SafeLog?.error?.('promosyon_kod_basarısız_tamamen', 'Promosyon kodu tamamen başarısız', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          kodAdi: girilenKodAdi,
          kodId,
          dbHatasi: dbError,
          traceID: traceId
        }));
      }

      return;
    }

    // ====== LISTE ======
    if (sub === 'listele') {
      await replyOrEdit({ content: '⏳ Promosyon kodları hazırlanıyor...', flags: MessageFlags.Ephemeral });

      const allowed = isListAllowed();
      if (!allowed) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('🚫 Yetkiniz Yok')
            .setDescription(
              'Bu komutu sadece **OWNER** veya **Bot uzerındeki adminler** kullanabilir.'
            )
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const tum = interaction.options.getBoolean('tum') === true;

      try {
        const promo = await PromoModul.loadPromosyonKodlar();
        const raw = promo?.raw;
        const list = extractCodesArray(raw);

        const now = new Date();
        const nowStr = PromoModul.nowDateTimeString();
        const nowDate = new Date(nowStr.replace(' ', 'T'));

        const mapped = list
          .map(item => ({ item, idt: getCodeIdentity(item) }))
          .filter(x => x.idt.ad);

        // filtre: silinmiş değil + tum değilse aktif + tarih aralığında
        const filtered = mapped.filter(x => {
          const item = x.item;
          const idt = x.idt;

          const silinme = item?.zamanlar?.kod_silinme_zamani;
          // kod_silinme_zamani gelecekteyse kod hâlâ gösterilebilir;
          // sadece silinme zamanı geçmişse filtrele.
          if (silinme && String(silinme).trim() && String(silinme).trim() !== 'yok') {
            const silDate = new Date(String(silinme).replace(' ', 'T'));
            if (!Number.isNaN(silDate.getTime()) && nowDate >= silDate) return false;
          }

          if (!tum) {
            const durum = String(idt.durum || '').toLowerCase();
            if (durum && durum !== 'aktif') return false;

            const bas = item?.zamanlar?.promosyon_baslangic_zamani;
            const bit = item?.zamanlar?.promosyon_bitis_zamani;
            const basOk = bas ? (new Date(String(bas).replace(' ', 'T')) <= nowDate) : true;
            const bitOk = bit ? (new Date(String(bit).replace(' ', 'T')) >= nowDate) : true;
            if (!basOk || !bitOk) return false;
          }

          return true;
        });

        // sıralama
        filtered.sort((a, b) => (a.idt.siralama || 999999) - (b.idt.siralama || 999999));

        const top = filtered.slice(0, 10);

        if (!top.length) {
          const embed = safeApply(
            new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('📋 Promosyon Kodu Listesi')
              .setDescription(tum ? 'Sistemde gösterilecek kod bulunamadı.' : 'Şu anda aktif ve kullanılabilir kod bulunamadı.')
              .setFooter({ text: `TraceID: ${traceId}` })
              .setTimestamp()
          );
          await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }

        const lines = top.map((x, idx) => {
          const item = x.item;
          const idt = x.idt;

          const lim = Number(item?.kullanim?.kullanim_limiti ?? 0) || 0;
          const used = Number(item?.kullanim?.promosyon_kod_kullanma_adet ?? 0) || 0;
          const rem = lim > 0 ? Math.max(0, lim - used) : null;

          const bas = item?.zamanlar?.promosyon_baslangic_zamani || '—';
          const bit = item?.zamanlar?.promosyon_bitis_zamani || '—';

          const limText = lim > 0 ? `Limit: ${used}/${lim} (Kalan: ${rem})` : `Limit: sınırsız (Kullanım: ${used})`;
          const dur = idt.durum ? String(idt.durum) : '—';

          return (
            `**${idx + 1}.** \`${idt.ad}\`  _(Durum: ${dur})_\n` +
            `${idt.aciklama ? `> ${idt.aciklama}\n` : ''}` +
            `• ${limText}\n` +
            `• Başlangıç: ${bas}\n` +
            `• Bitiş: ${bit}`
          );
        });

        const embed = safeApply(
  new EmbedBuilder()
    .setColor('#00aaff')
    .setTitle('📋 Promosyon Kodları')
    .setDescription(lines.join('\n\n') + `\n\n🧩 Kullanmak için: \`/promosyon_kod kullan kod:KOD\``)
    .setFooter({ text: `TraceID: ${traceId}` })
    .setTimestamp()
);

// DM gönder
try {
  await interaction.user.send({ embeds: [embed] });

  await replyOrEdit({
    content: "📩 Promosyon kod listesi DM'inize gönderildi.",
    flags: MessageFlags.Ephemeral
  });

} catch (err) {

  await replyOrEdit({
    content: "❌ DM gönderilemedi. Lütfen DM'lerinizi açın.",
    flags: MessageFlags.Ephemeral
  });

}

        await SafeLog?.info?.('promosyon_kod_listele_ok', 'Promosyon kodları listelendi', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          sunucuID: guildId,
          tum,
          adet: top.length,
          traceID: traceId
        }));
      } catch (e) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Listeleme Hatası')
            .setDescription('Promosyon kodları listelenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });

        await SafeLog?.error?.('promosyon_kod_listele_hata', `Listele exception: ${e.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          sunucuID: guildId,
          traceID: traceId,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        }));
      }

      return;
    }

    // ====== OLUSTUR ======
    if (sub === 'olustur') {
      await replyOrEdit({ content: '⏳ Yetki kontrolü yapılıyor...', flags: MessageFlags.Ephemeral });

      const allowed = isCreateAllowed();
      if (!allowed) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('🚫 Yetkiniz Yok')
            .setDescription(
              'Bu komutu sadece **owner** veya **adminler.json** içindeki kişiler kullanabilir.\n\n' +
              '📌 Eğer yetkili olduğunuzu düşünüyorsanız, yöneticiyle iletişime geçin.'
            )
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });

        await SafeLog?.warn?.('promosyon_kod_olustur_yetkisiz', 'Yetkisiz promosyon oluşturma denemesi', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          traceID: traceId
        }));
        return;
      }

      // Parametreler
      const adi = (interaction.options.getString('adi') || '').trim();
      const aciklama = (interaction.options.getString('aciklama') || '').trim();
      const durum = (interaction.options.getString('durum') || 'aktif').trim();

      const siralamaIn = interaction.options.getInteger('siralama');
      const basIn = ensureDateTimeString(interaction.options.getString('baslangic'));
      const bitIn = ensureDateTimeString(interaction.options.getString('bitis'));
      const silIn = ensureDateTimeString(interaction.options.getString('silinme'));

      const vip = interaction.options.getBoolean('vip') === true;
      const premium = interaction.options.getBoolean('premium') === true;
      const admin = interaction.options.getBoolean('admin') === true;

      const kullanimLimiti = interaction.options.getInteger('kullanim_limiti');
      const ayniKisiLimit = interaction.options.getInteger('ayni_kisi_limit');

      const uyeKontrol = interaction.options.getInteger('uye_kontrol');
      const uyeler = parseCsvIds(interaction.options.getString('uyeler'));

      const rolKontrol = interaction.options.getInteger('rol_kontrol');
      const roller = parseCsvIds(interaction.options.getString('roller'));

      const sunucuKontrol = interaction.options.getInteger('sunucu_kontrol');
      const sunucular = parseCsvIds(interaction.options.getString('sunucular'));

      const kanalKontrol = interaction.options.getInteger('kanal_kontrol');
      const kanallar = parseCsvIds(interaction.options.getString('kanallar'));

      if (!isValidPromoCodeInput(adi)) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Geçersiz Kod Adı',
          description: 'Promosyon kod adı yalnızca **harf**, **rakam**, **tire (-)** ve **alt çizgi (_)** içerebilir.'
        });
        return;
      }

      if (optionWasProvidedButInvalidDate('baslangic', basIn)) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Geçersiz Başlangıç Tarihi',
          description: '`baslangic` değeri **YYYY-MM-DD HH:mm:ss** formatında olmalıdır.\n\nÖrnek: `2026-03-04 14:30:00`'
        });
        return;
      }

      if (optionWasProvidedButInvalidDate('bitis', bitIn)) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Geçersiz Bitiş Tarihi',
          description: '`bitis` değeri **YYYY-MM-DD HH:mm:ss** formatında olmalıdır.\n\nÖrnek: `2026-04-03 14:30:00`'
        });
        return;
      }

      if (optionWasProvidedButInvalidDate('silinme', silIn)) {
        await replyWithEmbed({
          color: '#ff4444',
          title: '❌ Geçersiz Silinme Tarihi',
          description: '`silinme` değeri **YYYY-MM-DD HH:mm:ss** formatında olmalıdır.\n\nÖrnek: `2026-05-03 14:30:00`'
        });
        return;
      }


      // Basit doğrulamalar
      if (!adi) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Hatalı Giriş')
            .setDescription('Promosyon kod adı boş bırakılamaz.\n\n**Örnek kullanım:** `/promosyon_kod olustur adi:KIS2026VIP1 vip:true`')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if ((uyeKontrol === 1) && uyeler.length === 0) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Eksik Liste')
            .setDescription('`uye_kontrol=1` seçildiği için en az bir geçerli kullanıcı ID girmeniz gerekiyor.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if ((rolKontrol === 1) && roller.length === 0) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Eksik Liste')
            .setDescription('`rol_kontrol=1` seçildiği için en az bir geçerli rol ID girmeniz gerekiyor.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if ((sunucuKontrol === 1) && sunucular.length === 0) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Eksik Liste')
            .setDescription('`sunucu_kontrol=1` seçildiği için en az bir geçerli sunucu ID girmeniz gerekiyor.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if ((kanalKontrol === 1) && kanallar.length === 0) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Eksik Liste')
            .setDescription('`kanal_kontrol=1` seçildiği için en az bir geçerli kanal ID girmeniz gerekiyor.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );
        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      // Kaydet
      try {
        const promo = await PromoModul.loadPromosyonKodlar();
        const raw = promo?.raw;

        if (!raw) throw new Error('Promosyon verisi yüklenemedi');

        const list = extractCodesArray(raw);

        // Ad benzersiz mi?
        const existsName = list.some(item => String(getCodeIdentity(item).ad || '').toLowerCase() === adi.toLowerCase());
        if (existsName) {
          const embed = safeApply(
            new EmbedBuilder()
              .setColor('#ff4444')
              .setTitle('❌ Zaten Var')
              .setDescription(`Bu promosyon kod adı zaten mevcut: \`${adi}\`\n\nFarklı bir ad kullanın.`)
              .setFooter({ text: `TraceID: ${traceId}` })
              .setTimestamp()
          );
          await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }

        // Siralama otomatik
        const maxS = list.reduce((m, item) => {
          const s = Number(getCodeIdentity(item).siralama || 0) || 0;
          return Math.max(m, s);
        }, 0);

        const siralama = Number(siralamaIn || (maxS + 1));
        const nowStr = PromoModul.nowDateTimeString();
        const baslangic = basIn || nowStr;
        const bitis = bitIn || addDaysToDateTimeString(baslangic, 30);

        const newEntry = {
          kimlik_ve_durum: {
            id: generate32Id(),
            siralama,
            promosyon_kod_adı: adi,
            promosyon_kod_durum: (String(durum).toLowerCase() === 'deaktif') ? 'deaktif' : 'aktif',
            promosyon_kod_aciklama: aciklama || '—'
          },
          zamanlar: {
            promosyon_baslangic_zamani: baslangic,
            promosyon_bitis_zamani: bitis,
            kod_eklenme_zamani: nowStr,
            kod_silinme_zamani: silIn || 'yok'
          },
          yonetim: {
            promosyon_kod_ekleyen_kisi: String(userId)
          },
          yetkiler: {
            verilecek_yetki: {
              vip: vip ? 'yetki_var' : 'yetki_yok',
              premium: premium ? 'yetki_var' : 'yetki_yok',
              admin: admin ? 'yetki_var' : 'yetki_yok'
            }
          },
          kullanim: {
            kullanim_limiti: (typeof kullanimLimiti === 'number') ? kullanimLimiti : 0,
            promosyon_kod_kullanma_adet: 0,
            ayni_kisi_tekrar_kullanim_limit: (typeof ayniKisiLimit === 'number') ? ayniKisiLimit : 1,
            suresi_gecmis: 'gecmis_degil'
          },
          erisime_izinler: {
            uyeler: {
              kullanabilir_uyeler_kontrol: (typeof uyeKontrol === 'number') ? uyeKontrol : 0,
              kullanabilir_uyeler: uyeler
            },
            roller: {
              kullanabilir_roller_kontrol: (typeof rolKontrol === 'number') ? rolKontrol : 0,
              kullanabilir_roller: roller
            },
            sunucular: {
              promosyon_kod_kullanilabilir_sunucular_kontrol: (typeof sunucuKontrol === 'number') ? sunucuKontrol : 0,
              promosyon_kod_kullanilabilir_sunucular_id: sunucular
            },
            kanallar: {
              promosyon_kod_kullanilabilir_kanal_kontrol: (typeof kanalKontrol === 'number') ? kanalKontrol : 0,
              promosyon_kod_kullanilabilir_kanal_id: kanallar
            }
          }
        };

        // raw içinde listeyi bulup push et
        let inserted = false;

        if (Array.isArray(raw)) {
          raw.push(newEntry);
          inserted = true;
        } else {
          // en olası anahtarlar
          const keys = ['promosyon_kodlar', 'promosyonKodlar', 'kodlar', 'codes', 'items', 'list'];
          for (const k of keys) {
            if (Array.isArray(raw[k])) {
              raw[k].push(newEntry);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            // nested (tek seviye)
            for (const v of Object.values(raw)) {
              if (v && typeof v === 'object') {
                for (const k of keys) {
                  if (Array.isArray(v[k])) {
                    v[k].push(newEntry);
                    inserted = true;
                    break;
                  }
                }
              }
              if (inserted) break;
            }
          }
        }

        if (!inserted) {
          throw new Error('Promosyon listesi bulunamadı (raw şema uyuşmuyor).');
        }

        const saveOk = await PromoModul.savePromosyonKodlar(raw);
        if (!saveOk) {
          throw new Error('Dosyaya kaydetme başarısız (savePromosyonKodlar false döndü).');
        }

        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('✅ Promosyon Kodu Oluşturuldu')
            .setDescription(
              `Yeni promosyon kodu eklendi.\n\n` +
              `**Kod:** \`${adi}\`\n` +
              `**Durum:** ${newEntry.kimlik_ve_durum.promosyon_kod_durum}\n` +
              `**Sıralama:** ${siralama}\n` +
              `**Başlangıç:** ${baslangic}\n` +
              `**Bitiş:** ${bitis}\n` +
              `**Limit:** ${(newEntry.kullanim.kullanim_limiti || 0) > 0 ? newEntry.kullanim.kullanim_limiti : 'sınırsız'}\n` +
              `**Aynı Kişi Limit:** ${newEntry.kullanim.ayni_kisi_tekrar_kullanim_limit}\n\n` +
              `Kullanım: \`/promosyon_kod kullan kod:${adi}\``
            )
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });

        await SafeLog?.success?.('promosyon_kod_olustur_ok', 'Promosyon kod oluşturuldu ve kaydedildi', withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          kodAdi: adi,
          kodId: newEntry.kimlik_ve_durum.id,
          traceID: traceId
        }));
      } catch (e) {
        const embed = safeApply(
          new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('❌ Promosyon Kodu Oluşturulamadı')
            .setDescription('Promosyon kodu kaydedilirken bir sorun oluştu. Lütfen bilgileri kontrol edip tekrar deneyin.')
            .setFooter({ text: `TraceID: ${traceId}` })
            .setTimestamp()
        );

        await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });

        await SafeLog?.error?.('promosyon_kod_olustur_hata', `Oluştur exception: ${e.message}`, withNoConsole({
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: userId,
          kullaniciTag: userName,
          sunucuID: guildId,
          sunucuAdi: guildName,
          kanalID: channelId,
          kanalAdi: channelName,
          traceID: traceId,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        }));
      }

      return;
    }

    // Fallback
    const embed = safeApply(
      new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('⚠️ Bilgi')
        .setDescription('Geçersiz veya eksik bir alt komut kullanıldı. Lütfen komutu tekrar deneyin.')
        .setFooter({ text: `TraceID: ${traceId}` })
        .setTimestamp()
    );
    await replyOrEdit({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (fatalError) {
      const fallbackSafeApply = (embed) => {
        try {
          if (typeof applyEmbedParameters === 'function') {
            return applyEmbedParameters(embed, interaction.guildId, interaction.user?.id) || embed;
          }
        } catch (_) {}
        return embed;
      };

      const fatalEmbed = fallbackSafeApply(
        new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('❌ İşlem Tamamlanamadı')
          .setDescription('İşlem sırasında beklenmeyen bir sorun oluştu. Lütfen tekrar deneyin. Sorun devam ederse yetkili ekibe bilgi verin.')
          .setFooter({ text: `TraceID: ${fallbackTraceId}` })
          .setTimestamp()
      );

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [fatalEmbed], flags: MessageFlags.Ephemeral });
        } else {
          await interaction.editReply({ embeds: [fatalEmbed] });
        }
      } catch (_) {}

      try {
        await SafeLog?.error?.('promosyon_kod_execute_fatal', `Execute fatal error: ${fatalError.message}`, {
          klasor: 'sunucular',
          key: 'promo',
          kullaniciID: interaction.user?.id,
          kullaniciTag: interaction.user?.tag || interaction.user?.username,
          sunucuID: interaction.guildId,
          sunucuAdi: interaction.guild?.name || 'Unknown Guild',
          kanalID: interaction.channelId,
          kanalAdi: interaction.channel?.name || 'Unknown Channel',
          traceID: fallbackTraceId,
          hata: fatalError.message,
          stack: fatalError.stack?.split('\n')[0],
          sendToConsole: false
        });
      } catch (_) {}
    }
  }
};

// ==================== HELPER FUNCTIONS ====================

function formatRemainingTR(targetDateInput, nowInput = new Date()) {
  try {
    const target = new Date(targetDateInput);
    const now = new Date(nowInput);

    if (Number.isNaN(target.getTime())) return 'Bilinmiyor';
    if (target.getTime() <= now.getTime()) return 'Süresi doldu';

    const temp = new Date(now);

    let years = 0;
    while (true) {
      const next = new Date(temp);
      next.setFullYear(next.getFullYear() + 1);
      if (next <= target) { temp.setFullYear(temp.getFullYear() + 1); years++; } else break;
    }

    let months = 0;
    while (true) {
      const next = new Date(temp);
      next.setMonth(next.getMonth() + 1);
      if (next <= target) { temp.setMonth(temp.getMonth() + 1); months++; } else break;
    }

    let diffMs = target.getTime() - temp.getTime();

    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;

    const days = Math.floor(diffMs / day);
    diffMs -= days * day;

    const hours = Math.floor(diffMs / hour);
    diffMs -= hours * hour;

    const minutes = Math.floor(diffMs / min);
    diffMs -= minutes * min;

    const seconds = Math.floor(diffMs / sec);

    const parts = [];
    if (years) parts.push(`${years} yıl`);
    if (months) parts.push(`${months} ay`);
    if (days) parts.push(`${days} gün`);
    if (hours) parts.push(`${hours} saat`);
    if (minutes) parts.push(`${minutes} dakika`);
    if (seconds) parts.push(`${seconds} saniye`);

    return parts.length ? `${parts.join(' ')} kaldı` : 'Az kaldı';
  } catch {
    return 'Bilinmiyor';
  }
}

/**
 * Tarihi "24 Şubat 2026 23:45" formatına çevirir (TR)
 */
function formatDateTRLong(dateInput) {
  try {
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return 'Bilinmiyor';

    const aylar = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    const gun = d.getDate();
    const ay = aylar[d.getMonth()];
    const yil = d.getFullYear();

    const saat = String(d.getHours()).padStart(2, '0');
    const dakika = String(d.getMinutes()).padStart(2, '0');

    return `${gun} ${ay} ${yil} ${saat}:${dakika}`;
  } catch {
    return 'Bilinmiyor';
  }
}

/**
 * Yetki bitiş tarihini hesapla
 * @param {string} baslamaTarihi - "YYYY-MM-DD HH:mm:ss"
 * @param {number} gunSayisi - Gün sayısı
 * @returns {string} Bitiş tarihi "YYYY-MM-DD HH:mm:ss"
 */
function calculateYetkiBitisTarihi(baslamaTarihi, gunSayisi = 30) {
  try {
    const dateStr = baslamaTarihi.replace(' ', 'T');
    const date = new Date(dateStr);

    if (Number.isNaN(date.getTime())) throw new Error('Tarih parse edilemedi');

    date.setDate(date.getDate() + gunSayisi);

    const yyyy = String(date.getFullYear()).padStart(4, '0');
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');

    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
  } catch {
    const now = new Date();
    now.setDate(now.getDate() + gunSayisi);

    const yyyy = String(now.getFullYear()).padStart(4, '0');
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
  }
}
