// sayfalar/1.js
// IO7R Veritabanı Sorgu Sayfası - Ultra Gelişmiş
// Base64 şifrelemeli, dosya kayıtlı, embed kontrollü, buton destekli
// TAM VE EKSİKSİZ - Production Ready

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

// ==================== MODÜL İMPORTLARI ====================

const Base64Sifreleyici = require('../base64_sifreleyici');
const LogYonetim = require('../log_yonetim');
const DbManager = require('../dbManager');
const VeriYonetim = require('../veriYonetim');

// ==================== SABİTLER ====================

// Klasör yolları
const COP_TEMIZLIK_DIR = path.join(process.cwd(), 'cop_temizlik');
const SUNUCU_DM_VERILER_DIR = path. join(process.cwd(), 'sunucu_dm_veriler');
const DM_VERILER_DIR = path. join(SUNUCU_DM_VERILER_DIR, 'dm');
const SUNUCU_VERILER_DIR = path.join(SUNUCU_DM_VERILER_DIR, 'sunucu');

// Embed renkleri
const DEFAULT_EMBED_COLOR = '#4a9eff';
const SUCCESS_EMBED_COLOR = '#00ff88';
const ERROR_EMBED_COLOR = '#ff4444';
const WARNING_EMBED_COLOR = '#ffaa00';
const PROCESSING_EMBED_COLOR = '#9966ff';

// ENV'den timeout değerlerini al (varsayılan değerlerle)
const DB_TIMEOUT_MS = parseInt(process.env. DB_TIMEOUT_MS, 10) || 15000;
const PENDING_RESULT_TIMEOUT_MS = parseInt(process. env.PENDING_RESULT_TIMEOUT_MS, 10) || 300000;

// Base64 decode linki (configurable)
const BASE64_DECODE_URL = process.env. BASE64_DECODE_URL || 'https://www.base64decode. org/';

// Geçici sonuç depolama (buton işlemleri için)
const pendingResults = new Map();

// ==================== ENV NORMALIZE FONKSİYONU ====================

/**
 * ENV değerini normalize ederek boolean'a çevirir
 * Desteklenen değerler:  1, true, TRUE, "true", 0, false, FALSE, "false"
 * @param {string|number|boolean|undefined|null} value - ENV değeri
 * @returns {boolean} - Normalize edilmiş boolean değer
 */
function normalizeEnvBoolean(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const strValue = String(value).toLowerCase().trim();

  if (strValue === '1' || strValue === 'true') {
    return true;
  }

  if (strValue === '0' || strValue === 'false') {
    return false;
  }

  return false;
}

// ==================== MASKELEME FONKSİYONLARI ====================

/**
 * Komut tipine göre maskeleme aktif mi kontrol eder
 * @param {string} commandType - Komut tipi:  'ucretsiz', 'vip', 'premium'
 * @returns {boolean} - Maskeleme aktif mi
 */
function isMaskingEnabled(commandType) {
  switch (commandType) {
    case 'ucretsiz': 
      return normalizeEnvBoolean(process.env. UCRETSIZ_KOMUTLAR_GIZLILIK_MASKELEME);
    case 'vip': 
      return normalizeEnvBoolean(process.env.VIP_KOMUTLAR_GIZLILIK_MASKELEME);
    case 'premium': 
      return normalizeEnvBoolean(process.env.PREMIUM_KOMUTLAR_GIZLILIK_MASKELEME);
    default:
      return true;
  }
}

/**
 * TC kimlik numarasını maskeler (SADECE LOG İÇİN)
 * Veritabanına, dosyaya veya sisteme maskelenmiş TC yazılmaz
 * 
 * Maskeleme kuralları:
 * - İlk 2 hane gizlenir (XX)
 * - Son 2 hane gizlenir (XX)
 * - Ortadaki 7 hane görünür
 * 
 * Örnek:  10012345678 → XX0123456XX
 * 
 * @param {string} tc - TC kimlik numarası (11 haneli)
 * @param {string} commandType - Komut tipi:  'ucretsiz', 'vip', 'premium'
 * @returns {string} - Maskelenmiş veya gerçek TC (ENV'e bağlı)
 */
function maskTcForLog(tc, commandType) {
  if (!tc || typeof tc !== 'string' || tc.length !== 11) {
    return 'GECERSIZ_TC';
  }

  if (!isMaskingEnabled(commandType)) {
    return tc;
  }

  const ortaKisim = tc.substring(2, 9);
  return 'XX' + ortaKisim + 'XX';
}

/**
 * TC'yi Base64 ile şifreler (LOG için)
 * @param {string} tc - TC kimlik numarası
 * @returns {Promise<string>} - Şifrelenmiş TC veya hata mesajı
 */
async function encryptTcForLog(tc) {
  try {
    if (!tc || typeof tc !== 'string') {
      return 'GECERSIZ_TC';
    }

    const result = await Base64Sifreleyici. encodeText(tc);

    if (result && result.success) {
      return result.data;
    }

    return 'SIFRELEME_HATASI';
  } catch (err) {
    return 'SIFRELEME_HATASI';
  }
}

// ==================== YARDIMCI FONKSİYONLAR ====================

/**
 * Saat: dakika: saniye formatında zaman damgası döndürür
 * @returns {string} - HH:mm:ss formatında zaman
 */
function formatTimestamp() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Dosya adı için tarih formatı döndürür
 * @returns {string} - yyyy-MM-dd_HH-mm-ss formatında tarih
 */
function formatFullDate() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const yil = now.getFullYear();
  const ay = pad(now. getMonth() + 1);
  const gun = pad(now. getDate());
  const saat = pad(now. getHours());
  const dakika = pad(now.getMinutes());
  const saniye = pad(now.getSeconds());
  return `${yil}-${ay}-${gun}_${saat}-${dakika}-${saniye}`;
}

/**
 * Okunabilir tarih formatı döndürür
 * @returns {string} - dd. MM.yyyy HH:mm:ss formatında tarih
 */
function formatReadableDate() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const gun = pad(now. getDate());
  const ay = pad(now. getMonth() + 1);
  const yil = now.getFullYear();
  const saat = pad(now.getHours());
  const dakika = pad(now.getMinutes());
  const saniye = pad(now.getSeconds());
  return `${gun}. ${ay}.${yil} ${saat}: ${dakika}: ${saniye}`;
}

/**
 * ISO timestamp döndürür (log metadata için)
 * @returns {string} - ISO formatında timestamp
 */
function getISOTimestamp() {
  return new Date().toISOString();
}

/**
 * Dizin yoksa oluşturur
 * @param {string} dirPath - Dizin yolu
 * @returns {Promise<boolean>} - Başarılı mı
 */
async function ensureDir(dirPath) {
  try {
    await fsp. mkdir(dirPath, { recursive: true });
    return true;
  } catch (err) {
    await LogYonetim. error('dizin_olusturma_hatasi', `Dizin oluşturulamadı: ${dirPath}`, {
      klasor: 'sistem',
      key: 'dosya',
      hata: err.message,
      dizin: dirPath,
      timestamp: getISOTimestamp()
    });
    return false;
  }
}

// ==================== TC DOĞRULAMA (CHECKSUM DAHİL) ====================

/**
 * Türkiye TC Kimlik Numarası checksum algoritması
 * 
 * Algoritma:
 * 1. İlk 10 hanenin toplamının birler basamağı 11.  haneye eşit olmalı
 * 2. Tek pozisyonlardaki (1,3,5,7,9) rakamların toplamının 7 katından
 *    çift pozisyonlardaki (2,4,6,8) rakamların toplamı çıkarılır
 *    Sonucun mod 10'u 10.  haneye eşit olmalı
 * 
 * @param {string} tc - TC kimlik numarası
 * @returns {boolean} - Checksum geçerli mi
 */
function validateTcChecksum(tc) {
  if (!tc || tc.length !== 11) {
    return false;
  }

  const digits = tc.split('').map(Number);

  if (digits. some(isNaN)) {
    return false;
  }

  // Kural 1: İlk 10 hanenin toplamının birler basamağı 11. haneye eşit olmalı
  let sumFirst10 = 0;
  for (let i = 0; i < 10; i++) {
    sumFirst10 += digits[i];
  }
  if (sumFirst10 % 10 !== digits[10]) {
    return false;
  }

  // Kural 2: Tek ve çift pozisyonların hesabı
  let oddSum = 0;
  let evenSum = 0;

  for (let i = 0; i < 9; i++) {
    if (i % 2 === 0) {
      oddSum += digits[i];
    } else {
      evenSum += digits[i];
    }
  }

  let tenthDigitCalc = ((oddSum * 7) - evenSum) % 10;
  if (tenthDigitCalc < 0) {
    tenthDigitCalc += 10;
  }

  if (tenthDigitCalc !== digits[9]) {
    return false;
  }

  return true;
}

/**
 * TC kimlik numarasını doğrular
 * Kurallar:
 * - 11 haneli olmalı
 * - Sadece rakam içermeli
 * - İlk hane 0 olamaz
 * - Checksum algoritması geçerli olmalı
 * 
 * @param {string} tc - TC kimlik numarası
 * @returns {{valid: boolean, error:  string|null, errorCode: string|null}} - Doğrulama sonucu
 */
function validateTc(tc) {
  if (!tc || typeof tc !== 'string') {
    return {
      valid: false,
      error:  'TC kimlik numarası boş olamaz.',
      errorCode:  'TC_EMPTY'
    };
  }

  const trimmedTc = tc.trim();

  if (trimmedTc. length !== 11) {
    return {
      valid: false,
      error: 'TC kimlik numarası 11 haneli olmalıdır.',
      errorCode: 'TC_LENGTH'
    };
  }

  if (!/^\d{11}$/.test(trimmedTc)) {
    return {
      valid: false,
      error: 'TC kimlik numarası sadece rakam içermelidir.',
      errorCode: 'TC_NOT_NUMERIC'
    };
  }

  if (trimmedTc. charAt(0) === '0') {
    return {
      valid: false,
      error: 'TC kimlik numarası 0 ile başlayamaz.',
      errorCode: 'TC_STARTS_ZERO'
    };
  }

  if (!validateTcChecksum(trimmedTc)) {
    return {
      valid: false,
      error: 'TC kimlik numarası geçersiz.  Lütfen doğru TC giriniz.',
      errorCode: 'TC_CHECKSUM_INVALID'
    };
  }

  return {
    valid: true,
    error: null,
    errorCode:  null
  };
}

// ==================== EMBED PARAMETRE OKUMA ====================

/**
 * Kullanıcı ve sunucu için embed parametrelerini okur
 * Öncelik sırası:  Sunucu config > DM config > Varsayılan
 * Bozuk config varsa fallback çalışır
 * 
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @returns {Promise<object>} - Embed parametreleri
 */
async function getEmbedParameters(usrId, gldId) {
  const params = {
    footer: null,
    image: null,
    thumbnail: null,
    color: null,
    author: null
  };

  // DM dosyasını kontrol et
  try {
    const dmFilePath = path.join(DM_VERILER_DIR, `${usrId}. js`);

    if (fs.existsSync(dmFilePath)) {
      delete require.cache[require.resolve(dmFilePath)];
      const dmData = require(dmFilePath);

      if (dmData && typeof dmData === 'object') {
        if (typeof dmData. EMBED_FOOTER === 'string' && dmData. EMBED_FOOTER. length > 0) {
          params.footer = dmData. EMBED_FOOTER;
        }
        if (typeof dmData.EMBED_SETIMAGE === 'string' && dmData. EMBED_SETIMAGE.length > 0) {
          params.image = dmData.EMBED_SETIMAGE;
        }
        if (typeof dmData. EMBED_THUMBNAIL === 'string' && dmData. EMBED_THUMBNAIL. length > 0) {
          params. thumbnail = dmData. EMBED_THUMBNAIL;
        }
        if (typeof dmData.EMBED_COLOR === 'string' && dmData. EMBED_COLOR. length > 0) {
          params. color = dmData. EMBED_COLOR;
        }
        if (typeof dmData.EMBED_AUTHOR === 'string' && dmData. EMBED_AUTHOR.length > 0) {
          params.author = dmData.EMBED_AUTHOR;
        }
      }
    }
  } catch (err) {
    await LogYonetim.warn('dm_config_okuma_hatasi', `DM config okunamadı: ${usrId}`, {
      klasor:  'panel',
      key:  'sayfa1',
      kullaniciID: usrId,
      hata:  err.message,
      timestamp: getISOTimestamp()
    });
  }

  // Sunucu dosyasını kontrol et (override)
  if (gldId) {
    try {
      const sunucuFilePath = path.join(SUNUCU_VERILER_DIR, `${gldId}.js`);

      if (fs. existsSync(sunucuFilePath)) {
        delete require.cache[require. resolve(sunucuFilePath)];
        const sunucuData = require(sunucuFilePath);

        if (sunucuData && typeof sunucuData === 'object') {
          if (typeof sunucuData. EMBED_FOOTER === 'string' && sunucuData.EMBED_FOOTER.length > 0) {
            params.footer = sunucuData. EMBED_FOOTER;
          }
          if (typeof sunucuData.EMBED_SETIMAGE === 'string' && sunucuData. EMBED_SETIMAGE.length > 0) {
            params.image = sunucuData. EMBED_SETIMAGE;
          }
          if (typeof sunucuData. EMBED_THUMBNAIL === 'string' && sunucuData. EMBED_THUMBNAIL.length > 0) {
            params.thumbnail = sunucuData.EMBED_THUMBNAIL;
          }
          if (typeof sunucuData.EMBED_COLOR === 'string' && sunucuData.EMBED_COLOR.length > 0) {
            params.color = sunucuData. EMBED_COLOR;
          }
          if (typeof sunucuData.EMBED_AUTHOR === 'string' && sunucuData.EMBED_AUTHOR.length > 0) {
            params.author = sunucuData.EMBED_AUTHOR;
          }
        }
      }
    } catch (err) {
      await LogYonetim.warn('sunucu_config_okuma_hatasi', `Sunucu config okunamadı: ${gldId}`, {
        klasor: 'panel',
        key: 'sayfa1',
        sunucuID: gldId,
        hata: err. message,
        timestamp: getISOTimestamp()
      });
    }
  }

  return params;
}

/**
 * Embed'e parametreleri güvenli şekilde uygular
 * Bozuk parametre varsa atlanır, embed bozulmaz
 * 
 * @param {EmbedBuilder} embed - Embed nesnesi
 * @param {object} params - Embed parametreleri
 * @returns {EmbedBuilder} - Güncellenmiş embed
 */
function applyEmbedParameters(embed, params) {
  try {
    if (params.footer && typeof params.footer === 'string') {
      embed. setFooter({ text: params.footer });
    }
  } catch (err) {
    // Footer hatası, devam
  }

  try {
    if (params.image && typeof params.image === 'string') {
      embed.setImage(params.image);
    }
  } catch (err) {
    // Image hatası, devam
  }

  try {
    if (params.thumbnail && typeof params.thumbnail === 'string') {
      embed.setThumbnail(params.thumbnail);
    }
  } catch (err) {
    // Thumbnail hatası, devam
  }

  try {
    if (params.color && typeof params.color === 'string') {
      embed.setColor(params.color);
    }
  } catch (err) {
    // Color hatası, devam
  }

  try {
    if (params.author && typeof params.author === 'string') {
      embed. setAuthor({ name: params.author });
    }
  } catch (err) {
    // Author hatası, devam
  }

  return embed;
}

// ==================== VERİ FORMATLAMA ====================

/**
 * Kullanıcı verisini dosya formatına çevirir
 * @param {object} data - Veritabanından gelen veri
 * @param {string} usrId - Kullanıcı ID
 * @returns {string} - Formatlanmış metin
 */
function formatUserDataForFile(data, usrId) {
  const lines = [];
  const timestamp = formatReadableDate();

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('👤 KULLANICI BİLGİLERİ');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  lines.push(`🆔 TC Kimlik Numarası: ${data.tc || 'N/A'}`);
  lines.push(`   └─ Güncelleme: ${timestamp}`);
  lines.push('');

  lines.push(`👤 Ad: ${data.ad || 'N/A'}`);
  lines.push(`   └─ Güncelleme:  ${timestamp}`);
  lines.push('');

  lines.push(`👥 Soyad: ${data. soyad || 'N/A'}`);
  lines.push(`   └─ Güncelleme: ${timestamp}`);
  lines.push('');

  lines.push('───────────────────────────────────────────────────────────');
  lines.push('⚙️ SİSTEM BİLGİLERİ');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('');

  lines.push(`🔑 Sorgu Yapan Kullanıcı ID: ${usrId}`);
  lines.push(`📅 Sorgu Tarihi: ${timestamp}`);
  lines.push(`🗄️ Veri Kaynağı: IO7R Veritabanı`);
  lines.push('');

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('📋 VERİ SONU');
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ==================== DOSYA KAYIT ====================

/**
 * Sorgu sonucunu dosyaya kaydeder
 * Klasör yoksa otomatik oluşturulur
 * Dosya UTF-8 encoding ile kaydedilir
 * İçerik Base64 ile şifrelenir
 * 
 * @param {string} usrId - Kullanıcı ID
 * @param {object} data - Kaydedilecek veri
 * @param {string} gldId - Sunucu ID (log için)
 * @param {string} cmdType - Komut tipi (log için)
 * @returns {Promise<object>} - Kayıt sonucu {success, filePath, fileName, error}
 */
async function saveResultToFile(usrId, data, gldId, cmdType) {
  try {
    const dirCreated = await ensureDir(COP_TEMIZLIK_DIR);
    if (!dirCreated) {
      await LogYonetim.error('dosya_olusturulamadi', 'Sonuç klasörü oluşturulamadı', {
        klasor: 'panel',
        key:  'sayfa1',
        kullaniciID: usrId,
        guildId: gldId,
        commandType: cmdType,
        timestamp: getISOTimestamp()
      });

      return {
        success: false,
        error: 'Sonuç klasörü oluşturulamadı'
      };
    }

    const timestamp = formatFullDate();
    const fileName = `${usrId}-${timestamp}.txt`;
    const filePath = path.join(COP_TEMIZLIK_DIR, fileName);

    const formattedData = formatUserDataForFile(data, usrId);

    const encodeResult = await Base64Sifreleyici.encodeText(formattedData);

    if (! encodeResult || ! encodeResult.success) {
      const errorMsg = encodeResult ?  encodeResult.message : 'Base64 encode başarısız';

      await LogYonetim.error('base64_encode_hatasi', `Base64 encode hatası: ${errorMsg}`, {
        klasor: 'panel',
        key:  'sayfa1',
        kullaniciID: usrId,
        guildId: gldId,
        commandType: cmdType,
        timestamp: getISOTimestamp()
      });

      return {
        success: false,
        error: `Base64 encode hatası: ${errorMsg}`
      };
    }

    const readableDate = formatReadableDate();
    const fileContent = `📌 Bu dosya Base64 ile şifrelenmiştir. 
Çözümleme için: ${BASE64_DECODE_URL}
Veriler güvenlik ve denetim amaçlı düzenlenmiştir. 

════════════════════════════════════════════════════════════════════════════════
📅 Dosya Oluşturma Tarihi: ${readableDate}
🔑 Kullanıcı ID: ${usrId}
📊 Veri Tipi:  Kullanıcı Sorgusu
════════════════════════════════════════════════════════════════════════════════

${encodeResult. data}

════════════════════════════════════════════════════════════════════════════════
📋 Dosya Sonu
════════════════════════════════════════════════════════════════════════════════
`;

    await fsp.writeFile(filePath, fileContent, { encoding: 'utf8' });

    await LogYonetim.info('dosya_olusturuldu', `Dosya başarıyla oluşturuldu: ${fileName}`, {
      klasor: 'panel',
      key: 'sayfa1',
      kullaniciID: usrId,
      guildId: gldId,
      commandType: cmdType,
      dosyaAdi:  fileName,
      dosyaYolu: filePath,
      timestamp: getISOTimestamp()
    });

    return {
      success:  true,
      filePath: filePath,
      fileName: fileName
    };

  } catch (err) {
    await LogYonetim.error('dosya_olusturulamadi', `Dosya kaydetme hatası:  ${err.message}`, {
      klasor: 'panel',
      key:  'sayfa1',
      kullaniciID: usrId,
      guildId: gldId,
      commandType: cmdType,
      hata: err.message,
      stack: err.stack,
      timestamp: getISOTimestamp()
    });

    return {
      success: false,
      error: err.message
    };
  }
}

// ==================== EMBED OLUŞTURMA FONKSİYONLARI ====================

/**
 * İşlem devam ediyor embed'i oluşturur
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @returns {Promise<EmbedBuilder>} - Embed
 */
async function createProcessingEmbed(usrId, gldId) {
  const params = await getEmbedParameters(usrId, gldId);

  let embed = new EmbedBuilder()
    .setColor(PROCESSING_EMBED_COLOR)
    .setTitle('⏳ İşlem Yapılıyor')
    .setDescription('İşleme başlandı, lütfen bekleyiniz...\n\nVeriler güvenli şekilde toplanıyor ve şifreleniyor.')
    .addFields(
      { name: '📊 Durum', value: '```Veritabanı sorgulanıyor... ```', inline: false },
      { name: '🔐 Güvenlik', value: '```Base64 şifreleme aktif```', inline: true },
      { name: '⏱️ Başlangıç', value: `\`${formatTimestamp()}\``, inline: true }
    )
    .setTimestamp();

  embed = applyEmbedParameters(embed, params);

  if (! params.footer) {
    embed. setFooter({ text: 'Lütfen bekleyiniz.. .' });
  }

  await LogYonetim. info('embed_hazirlandi', 'Processing embed hazırlandı', {
    klasor: 'panel',
    key: 'sayfa1',
    kullaniciID: usrId,
    guildId: gldId,
    embedTip: 'processing',
    timestamp:  getISOTimestamp()
  });

  return embed;
}

/**
 * Başarılı sorgu embed'i oluşturur
 * TC embed'de görünür (gerçek değer)
 * 
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @param {object} data - Sorgu sonucu
 * @param {string} fileName - Dosya adı
 * @returns {Promise<EmbedBuilder>} - Embed
 */
async function createSuccessEmbed(usrId, gldId, data, fileName) {
  const params = await getEmbedParameters(usrId, gldId);

  let embed = new EmbedBuilder()
    .setColor(SUCCESS_EMBED_COLOR)
    .setTitle('✅ İşlem Başarılı!')
    .setDescription('Sorgu işleminiz başarıyla tamamlandı.\nSonuç dosyası hazır 🎉')
    .addFields(
      { name: '🆔 TC', value:  `\`\`\`${data.tc || 'N/A'}\`\`\``, inline: true },
      { name: '👤 Ad', value: `\`\`\`${data.ad || 'N/A'}\`\`\``, inline: true },
      { name: '👥 Soyad', value: `\`\`\`${data.soyad || 'N/A'}\`\`\``, inline: true },
      { name:  '📁 Dosya', value: `\`${fileName}\``, inline: false },
      { name:  '⏱️ Tamamlanma', value: `\`${formatTimestamp()}\``, inline: true }
    )
    .setTimestamp();

  embed = applyEmbedParameters(embed, params);

  if (!params. footer) {
    embed.setFooter({ text: 'Dosyayı almak için aşağıdaki butonlardan birini seçin' });
  }

  await LogYonetim.info('embed_hazirlandi', 'Success embed hazırlandı', {
    klasor: 'panel',
    key:  'sayfa1',
    kullaniciID: usrId,
    guildId: gldId,
    embedTip: 'success',
    timestamp: getISOTimestamp()
  });

  return embed;
}

/**
 * Hata embed'i oluşturur
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @param {string} errorMessage - Hata mesajı
 * @param {string} errorCode - Hata kodu
 * @returns {Promise<EmbedBuilder>} - Embed
 */
async function createErrorEmbed(usrId, gldId, errorMessage, errorCode) {
  const params = await getEmbedParameters(usrId, gldId);

  let embed = new EmbedBuilder()
    .setColor(ERROR_EMBED_COLOR)
    .setTitle('❌ İşlem Başarısız')
    .setDescription('İşlem sırasında bir hata oluştu.\nLütfen daha sonra tekrar deneyiniz.')
    .addFields(
      { name: '❗ Hata', value: `\`\`\`${errorMessage}\`\`\``, inline: false },
      { name: '🔢 Hata Kodu', value:  `\`${errorCode || 'UNKNOWN'}\``, inline: true },
      { name: '⏱️ Zaman', value: `\`${formatTimestamp()}\``, inline: true }
    )
    .setTimestamp();

  embed = applyEmbedParameters(embed, params);

  if (!params. footer) {
    embed.setFooter({ text: 'Sorun devam ederse yöneticiyle iletişime geçin' });
  }

  await LogYonetim.info('embed_hazirlandi', 'Error embed hazırlandı', {
    klasor: 'panel',
    key: 'sayfa1',
    kullaniciID: usrId,
    guildId: gldId,
    embedTip: 'error',
    errorCode: errorCode,
    timestamp: getISOTimestamp()
  });

  return embed;
}

/**
 * Gönderim başarılı embed'i oluşturur
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @param {string} destination - Hedef:  'dm' veya 'channel'
 * @param {string} fileName - Dosya adı
 * @returns {Promise<EmbedBuilder>} - Embed
 */
async function createSentEmbed(usrId, gldId, destination, fileName) {
  const params = await getEmbedParameters(usrId, gldId);

  const destText = destination === 'dm' ? 'DM (Özel Mesaj)' : 'Bu Kanal';

  let embed = new EmbedBuilder()
    .setColor(SUCCESS_EMBED_COLOR)
    .setTitle('✅ Gönderim Başarılı!')
    .setDescription(`İşleminiz tamamlandı.\nDosya başarıyla **${destText}** üzerine gönderildi. `)
    .addFields(
      { name: '📁 Dosya', value: `\`${fileName}\``, inline: true },
      { name: '📤 Gönderim', value: `\`${destText}\``, inline: true },
      { name: '⏱️ Zaman', value: `\`${formatTimestamp()}\``, inline: true }
    )
    .setTimestamp();

  embed = applyEmbedParameters(embed, params);

  if (!params. footer) {
    embed.setFooter({ text: 'İşlem tamamlandı' });
  }

  await LogYonetim. info('embed_hazirlandi', 'Sent embed hazırlandı', {
    klasor:  'panel',
    key: 'sayfa1',
    kullaniciID: usrId,
    guildId: gldId,
    embedTip: 'sent',
    destination:  destination,
    timestamp: getISOTimestamp()
  });

  return embed;
}

/**
 * Sonuç bulunamadı embed'i oluşturur
 * @param {string} usrId - Kullanıcı ID
 * @param {string|null} gldId - Sunucu ID
 * @returns {Promise<EmbedBuilder>} - Embed
 */
async function createNotFoundEmbed(usrId, gldId) {
  const params = await getEmbedParameters(usrId, gldId);

  let embed = new EmbedBuilder()
    .setColor(WARNING_EMBED_COLOR)
    .setTitle('🔍 Sonuç Bulunamadı')
    .setDescription('Girilen TC kimlik numarası ile eşleşen kayıt bulunamadı.')
    .addFields(
      { name: '⏱️ Zaman', value:  `\`${formatTimestamp()}\``, inline: true }
    )
    .setTimestamp();

  embed = applyEmbedParameters(embed, params);

  if (!params.footer) {
    embed.setFooter({ text: 'Farklı bir TC numarası deneyin' });
  }

  await LogYonetim.info('embed_hazirlandi', 'NotFound embed hazırlandı', {
    klasor: 'panel',
    key: 'sayfa1',
    kullaniciID: usrId,
    guildId: gldId,
    embedTip: 'notFound',
    timestamp:  getISOTimestamp()
  });

  return embed;
}

// ==================== BUTON OLUŞTURMA ====================

/**
 * Dosya gönderim butonlarını oluşturur (aktif)
 * @returns {ActionRowBuilder} - Buton satırı
 */
function createDeliveryButtons() {
  const dmButton = new ButtonBuilder()
    .setCustomId('sayfa1_send_dm')
    .setLabel('📧 DM\'ye Gönder')
    .setStyle(ButtonStyle.Primary);

  const channelButton = new ButtonBuilder()
    .setCustomId('sayfa1_send_channel')
    .setLabel('📢 Bu Kanala Gönder')
    .setStyle(ButtonStyle. Secondary);

  return new ActionRowBuilder().addComponents(dmButton, channelButton);
}

/**
 * Devre dışı butonlar oluşturur (işlem tamamlandığında)
 * @returns {ActionRowBuilder} - Devre dışı buton satırı
 */
function createDisabledButtons() {
  const dmButton = new ButtonBuilder()
    .setCustomId('sayfa1_send_dm_disabled')
    .setLabel('📧 DM\'ye Gönder')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  const channelButton = new ButtonBuilder()
    .setCustomId('sayfa1_send_channel_disabled')
    .setLabel('📢 Bu Kanala Gönder')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  return new ActionRowBuilder().addComponents(dmButton, channelButton);
}

// ==================== PENDING RESULTS YÖNETİMİ ====================

/**
 * Pending result'ı temizler
 * @param {string} usrId - Kullanıcı ID
 */
function clearPendingResult(usrId) {
  const existing = pendingResults.get(usrId);
  if (existing && existing.timerId) {
    clearTimeout(existing. timerId);
  }
  pendingResults.delete(usrId);
}

/**
 * Pending result var mı kontrol eder
 * @param {string} usrId - Kullanıcı ID
 * @returns {boolean} - Var mı
 */
function hasPendingResult(usrId) {
  return pendingResults.has(usrId);
}

/**
 * Pending result sayısını döndürür
 * @returns {number} - Sayı
 */
function getPendingCount() {
  return pendingResults.size;
}

/**
 * Pending result'ı kaydeder ve otomatik temizleme timer'ı başlatır
 * 5 dakika sonra otomatik cleanup
 * 
 * @param {string} usrId - Kullanıcı ID
 * @param {object} resultData - Kaydedilecek veri
 */
function setPendingResult(usrId, resultData) {
  const existing = pendingResults.get(usrId);
  if (existing && existing.timerId) {
    clearTimeout(existing.timerId);
  }

  const timerId = setTimeout(async () => {
    if (pendingResults.has(usrId)) {
      pendingResults.delete(usrId);

      await LogYonetim.info('pending_otomatik_temizlendi', `Pending result otomatik temizlendi: ${usrId}`, {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID:  usrId,
        timeoutMs:  PENDING_RESULT_TIMEOUT_MS,
        timestamp:  getISOTimestamp()
      });
    }
  }, PENDING_RESULT_TIMEOUT_MS);

  pendingResults.set(usrId, {
    ... resultData,
    timerId:  timerId,
    timestamp: Date.now()
  });
}

// ==================== SAYFA MODÜL EXPORT ====================

module.exports = {
  /**
   * Sayfa numarasını döndürür
   * @returns {number} - Sayfa numarası
   */
  getPageNumber: function() {
    return 1;
  },

  /**
   * Sayfa adını döndürür
   * @returns {Promise<string>} - Sayfa adı
   */
  getPageName:  async function() {
    return 'IO7R Sorgulaması';
  },

  /**
   * Sayfa açıklamasını döndürür
   * @returns {Promise<string>} - Sayfa açıklaması
   */
  getPageDescription:  async function() {
    return 'TC Kimlik numarası ile kişi bilgisi sorgulaması yapabilirsiniz.\nSonuçlar Base64 ile şifrelenir ve dosyaya kaydedilir.';
  },

  /**
   * Sayfa içeriğini döndürür
   * @param {string} usrId - Kullanıcı ID
   * @returns {Promise<string>} - Sayfa içeriği
   */
  getPageContent: async function(usrId) {
    const content = [
      '**🗄️ IO7R Veritabanı Sorgu Sistemi**',
      '',
      '**Mevcut Kolon Bilgisi:**',
      '```',
      '• TC Kimlik Numarası',
      '• Ad',
      '• Soyadı',
      '```',
      '',
      '**🔐 Güvenlik Özellikleri:**',
      '• Base64 şifreleme',
      '• UTF-8 dosya kaydı',
      '• Zaman damgalı kayıtlar',
      '',
      '🔍 **Sorgula** butonuna tıklayarak TC kimlik numarası girin.'
    ];

    return content.join('\n');
  },

  /**
   * Sorgu modalını döndürür
   * @returns {Promise<ModalBuilder>} - Modal
   */
  getQueryModal:  async function() {
    const modal = new ModalBuilder()
      .setCustomId('sayfa_1_sorgu_modal')
      .setTitle('IO7R TC Sorgu');

    const tcInput = new TextInputBuilder()
      .setCustomId('io7r_tc')
      .setLabel('TC Kimlik Numarası')
      .setStyle(TextInputStyle. Short)
      .setPlaceholder('11 haneli TC numaranızı girin')
      .setRequired(true)
      .setMinLength(11)
      .setMaxLength(11);

    const row = new ActionRowBuilder().addComponents(tcInput);
    modal.addComponents(row);

    return modal;
  },

  /**
   * Modal submit işlemini yönetir
   * @param {Interaction} interaction - Discord etkileşimi
   * @param {object} context - Bağlam nesnesi
   */
  handleQueryModal: async function(interaction, context) {
    const { db, safeReply, traceId, userId, state } = context;
    const gldId = (state && state.guildId) ? state.guildId : interaction.guildId;
    const cmdType = (state && state.commandType) ? state.commandType : 'ucretsiz';

    try {
      // ========== API İSTEĞİ BAŞLATILDI ==========
      await LogYonetim.info('api_istegi_baslatildi', 'IO7R sorgu isteği başlatıldı', {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID:  userId,
        guildId: gldId,
        commandType: cmdType,
        traceID: traceId,
        timestamp: getISOTimestamp()
      });

      // ========== TC DEĞERİNİ AL ==========
      let tc = '';
      try {
        tc = interaction.fields.getTextInputValue('io7r_tc');
      } catch (fieldErr) {
        await LogYonetim.error('tc_deger_alinamadi', 'TC kimlik numarası modal\'dan alınamadı', {
          klasor: 'panel',
          key:  'sayfa1',
          kullaniciID: userId,
          guildId: gldId,
          commandType: cmdType,
          traceID: traceId,
          hata: fieldErr. message,
          timestamp: getISOTimestamp()
        });

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          'TC kimlik numarası alınamadı.  Lütfen tekrar deneyin.',
          'INPUT_ERROR'
        );
        await safeReply(interaction, { embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      tc = tc.trim();

      // ========== TC DOĞRULAMA ==========
      const validation = validateTc(tc);

      if (! validation.valid) {
        await LogYonetim.warn('tc_validasyon_hatasi', `TC validasyon hatası:  ${validation.error}`, {
          klasor: 'panel',
          key:  'sayfa1',
          kullaniciID: userId,
          guildId: gldId,
          commandType:  cmdType,
          traceID: traceId,
          hata: validation.error,
          errorCode: validation.errorCode,
          timestamp: getISOTimestamp()
        });

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          validation.error,
          validation.errorCode
        );
        await safeReply(interaction, { embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      // TC doğrulandı - maskeleme ve şifreleme (sadece log için)
      const tcMaskeli = maskTcForLog(tc, cmdType);
      const tcEncrypted = await encryptTcForLog(tc);

      await LogYonetim.info('tc_dogrulandi', 'TC kimlik numarası doğrulandı', {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID: userId,
        guildId: gldId,
        commandType: cmdType,
        traceID: traceId,
        tcMaskeli: tcMaskeli,
        tcEncrypted: tcEncrypted,
        timestamp:  getISOTimestamp()
      });

      // ========== İŞLEM EMBED'İNİ GÖSTER ==========
      const processingEmbed = await createProcessingEmbed(userId, gldId);
      await safeReply(interaction, { embeds: [processingEmbed], flags: MessageFlags.Ephemeral });

      // ========== VERİTABANI KONTROLÜ ==========
      const dbInstance = db || DbManager;

      if (!dbInstance || dbInstance.isDisabled) {
        await LogYonetim. error('db_bulunamadi', 'Veritabanı bağlantısı kullanılamıyor', {
          klasor: 'database',
          key:  'sorgu',
          kullaniciID: userId,
          guildId:  gldId,
          commandType: cmdType,
          traceID: traceId,
          timestamp: getISOTimestamp()
        });

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          'Veritabanı bağlantısı şu anda kullanılamıyor.\nLütfen daha sonra tekrar deneyin.',
          'DB_DISABLED'
        );

        try {
          await interaction.editReply({ embeds: [errorEmbed], components: [] });
        } catch (editErr) {
          await safeReply(interaction, { embeds:  [errorEmbed], flags: MessageFlags. Ephemeral });
        }
        return;
      }

      // ========== VERİTABANI SORGUSU ==========
      let results = [];
      const startTime = Date.now();

      await LogYonetim.info('db_sorgu_baslatildi', 'Veritabanı sorgusu başlatıldı', {
        klasor: 'database',
        key: 'sorgu',
        kullaniciID: userId,
        guildId: gldId,
        commandType:  cmdType,
        traceID: traceId,
        tcMaskeli: tcMaskeli,
        tcEncrypted: tcEncrypted,
        timeoutMs: DB_TIMEOUT_MS,
        timestamp:  getISOTimestamp()
      });

      try {
        const sql = 'SELECT tc, ad, soyad FROM io7r WHERE tc = ?  LIMIT 1';

        results = await dbInstance. query('main', sql, [tc], {
          queue: true,
          timeoutMs: DB_TIMEOUT_MS,
          traceId: traceId
        });

        const duration = Date.now() - startTime;

        await LogYonetim.info('db_sonucu', 'Veritabanı sorgusu tamamlandı', {
          klasor:  'database',
          key: 'sorgu',
          kullaniciID:  userId,
          guildId: gldId,
          commandType: cmdType,
          traceID: traceId,
          sure: duration,
          sonucSayisi: results ?  results. length : 0,
          timestamp: getISOTimestamp()
        });

      } catch (dbError) {
        const duration = Date.now() - startTime;
        const isTimeout = dbError. message && (
          dbError. message.toLowerCase().includes('timeout') ||
          dbError.message.toLowerCase().includes('zaman aşımı')
        );

        if (isTimeout) {
          await LogYonetim.error('db_timeout', `Veritabanı timeout:  ${duration}ms`, {
            klasor: 'database',
            key: 'sorgu',
            kullaniciID: userId,
            guildId: gldId,
            commandType: cmdType,
            traceID:  traceId,
            sure: duration,
            timeoutMs: DB_TIMEOUT_MS,
            timestamp: getISOTimestamp()
          });
        } else {
          await LogYonetim.error('hata', `Veritabanı sorgu hatası: ${dbError.message}`, {
            klasor:  'database',
            key: 'sorgu',
            kullaniciID:  userId,
            guildId: gldId,
            commandType: cmdType,
            traceID: traceId,
            hata: dbError. message,
            sure: duration,
            timestamp: getISOTimestamp()
          });
        }

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          isTimeout
            ? 'Sorgu zaman aşımına uğradı.  Lütfen daha sonra tekrar deneyin.'
            : 'Sorgu sırasında bir hata oluştu.  Lütfen daha sonra tekrar deneyin.',
          isTimeout ? 'DB_TIMEOUT' :  'DB_QUERY_ERROR'
        );

        try {
          await interaction.editReply({ embeds:  [errorEmbed], components: [] });
        } catch (editErr) {
          await safeReply(interaction, { embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
      }

      // ========== SONUÇ BULUNAMADI ==========
      if (! results || results.length === 0) {
        await LogYonetim.info('db_bulunamadi', `Sonuç bulunamadı:  ${tcMaskeli}`, {
          klasor: 'database',
          key: 'sorgu',
          kullaniciID: userId,
          guildId: gldId,
          commandType: cmdType,
          traceID: traceId,
          tcMaskeli: tcMaskeli,
          tcEncrypted:  tcEncrypted,
          timestamp: getISOTimestamp()
        });

        const notFoundEmbed = await createNotFoundEmbed(userId, gldId);

        try {
          await interaction.editReply({ embeds:  [notFoundEmbed], components: [] });
        } catch (editErr) {
          await safeReply(interaction, { embeds: [notFoundEmbed], flags: MessageFlags. Ephemeral });
        }
        return;
      }

      // ========== SONUÇ BULUNDU ==========
      const kayit = results[0];

      await LogYonetim.info('db_sonuc_bulundu', `Sonuç bulundu: ${tcMaskeli}`, {
        klasor: 'database',
        key: 'sorgu',
        kullaniciID: userId,
        guildId: gldId,
        commandType: cmdType,
        traceID: traceId,
        tcMaskeli: tcMaskeli,
        tcEncrypted:  tcEncrypted,
        timestamp: getISOTimestamp()
      });

      // ========== DOSYAYA KAYDET ==========
      const saveResult = await saveResultToFile(userId, kayit, gldId, cmdType);

      if (! saveResult. success) {
        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          'Sonuç dosyası oluşturulurken hata oluştu.  Lütfen tekrar deneyin.',
          'FILE_SAVE_ERROR'
        );

        try {
          await interaction.editReply({ embeds:  [errorEmbed], components: [] });
        } catch (editErr) {
          await safeReply(interaction, { embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
      }

      // ========== PENDING RESULT KAYDET ==========
      setPendingResult(userId, {
        data: kayit,
        filePath: saveResult. filePath,
        fileName: saveResult.fileName,
        guildId: gldId,
        traceId: traceId,
        commandType: cmdType
      });

      // ========== BAŞARI EMBED VE BUTONLARI GÖSTER ==========
      const successEmbed = await createSuccessEmbed(userId, gldId, kayit, saveResult.fileName);
      const deliveryButtons = createDeliveryButtons();

      try {
        await interaction.editReply({
          embeds:  [successEmbed],
          components: [deliveryButtons]
        });
      } catch (editErr) {
        await safeReply(interaction, {
          embeds:  [successEmbed],
          components: [deliveryButtons],
          flags:  MessageFlags.Ephemeral
        });
      }

      await LogYonetim.info('sorgu_tamamlandi', `IO7R sorgusu başarıyla tamamlandı:  ${tcMaskeli}`, {
        klasor: 'database',
        key:  'sorgu',
        kullaniciID: userId,
        guildId:  gldId,
        commandType: cmdType,
        traceID: traceId,
        dosyaAdi: saveResult.fileName,
        tcMaskeli: tcMaskeli,
        tcEncrypted: tcEncrypted,
        timestamp:  getISOTimestamp()
      });

    } catch (err) {
      await LogYonetim.error('hata', `IO7R kritik hata: ${err.message}`, {
        klasor: 'panel',
        key:  'sayfa1',
        kullaniciID: userId,
        guildId: gldId,
        commandType:  cmdType,
        traceID: traceId,
        hata: err. message,
        stack: err.stack,
        timestamp: getISOTimestamp()
      });

      const errorEmbed = await createErrorEmbed(
        userId,
        gldId,
        'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
        'INTERNAL_ERROR'
      );

      try {
        if (! interaction.replied && !interaction.deferred) {
          await safeReply(interaction, { embeds:  [errorEmbed], flags: MessageFlags. Ephemeral });
        } else {
          await interaction.editReply({ embeds: [errorEmbed], components:  [] });
        }
      } catch (replyErr) {
        await LogYonetim. error('etkilesim_hatasi', `Reply hatası: ${replyErr.message}`, {
          klasor: 'panel',
          key: 'sayfa1',
          kullaniciID: userId,
          guildId:  gldId,
          commandType: cmdType,
          traceID: traceId,
          hata: replyErr.message,
          timestamp: getISOTimestamp()
        });
      }
    }
  },

  /**
   * Buton etkileşimlerini yönetir
   * @param {Interaction} interaction - Discord etkileşimi
   * @param {string} buttonId - Buton ID
   * @param {object} context - Bağlam nesnesi
   */
  handleButton:  async function(interaction, buttonId, context) {
    const { traceId, userId } = context;
    const gldId = interaction.guildId;

    try {
      // ========== BUTON TIKLAMA LOG ==========
      await LogYonetim. info('buton_tiklama', `Buton tıklandı: ${buttonId}`, {
        klasor: 'panel',
        key: 'sayfa1',
        kullaniciID: userId,
        guildId: gldId,
        traceID: traceId,
        buttonId: buttonId,
        timestamp: getISOTimestamp()
      });

      // ========== PENDING RESULT KONTROLÜ ==========
      const pending = pendingResults.get(userId);

      if (! pending) {
        await LogYonetim.warn('session_suresi_doldu', 'Pending result bulunamadı veya süresi doldu', {
          klasor: 'panel',
          key: 'sayfa1',
          kullaniciID: userId,
          guildId:  gldId,
          traceID:  traceId,
          buttonId: buttonId,
          timestamp: getISOTimestamp()
        });

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          'İşlem süresi dolmuş veya sonuç bulunamadı.\nLütfen yeni bir sorgu yapın.',
          'SESSION_EXPIRED'
        );

        await interaction.reply({ embeds: [errorEmbed], flags:  MessageFlags.Ephemeral });
        return;
      }

      const { filePath, fileName, commandType } = pending;

      // ========== DOSYA VARLIK KONTROLÜ ==========
      if (!fs.existsSync(filePath)) {
        await LogYonetim.error('dosya_bulunamadi', `Sonuç dosyası bulunamadı: ${fileName}`, {
          klasor: 'panel',
          key: 'sayfa1',
          kullaniciID: userId,
          guildId: gldId,
          traceID: traceId,
          dosyaYolu: filePath,
          timestamp: getISOTimestamp()
        });

        const errorEmbed = await createErrorEmbed(
          userId,
          gldId,
          'Sonuç dosyası bulunamadı.\nLütfen yeni bir sorgu yapın.',
          'FILE_NOT_FOUND'
        );

        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        clearPendingResult(userId);
        return;
      }

            // ========== DM'YE GÖNDER ==========
      if (buttonId === 'sayfa1_send_dm') {
        await LogYonetim. info('dm_gonderim_denendi', 'DM gönderim denemesi başlatıldı', {
          klasor: 'panel',
          key: 'sayfa1',
          kullaniciID:  userId,
          guildId: gldId,
          commandType: commandType,
          traceID: traceId,
          dosyaAdi: fileName,
          timestamp: getISOTimestamp()
        });

        try {
          // Dosyayı oku
          const fileContent = await fsp.readFile(filePath);

          // DM'ye gönder
          await interaction. user.send({
            content: `📁 **IO7R Sorgu Sonucu**\n📅 Tarih: ${formatReadableDate()}`,
            files: [{
              attachment: fileContent,
              name: fileName
            }]
          });

          // Başarı embed'i ve butonları devre dışı bırak
          const sentEmbed = await createSentEmbed(userId, gldId, 'dm', fileName);
          const disabledButtons = createDisabledButtons();

          await interaction.update({
            embeds: [sentEmbed],
            components:  [disabledButtons]
          });

          await LogYonetim.info('dm_gonderim_basarili', 'DM gönderimi başarılı', {
            klasor: 'panel',
            key: 'sayfa1',
            kullaniciID: userId,
            guildId: gldId,
            commandType: commandType,
            traceID:  traceId,
            dosyaAdi: fileName,
            timestamp: getISOTimestamp()
          });

          // Pending result temizle
          clearPendingResult(userId);

        } catch (dmError) {
          // DM kapalı veya gönderim hatası
          const isDmClosed = dmError. code === 50007 ||
            (dmError.message && dmError.message.includes('Cannot send messages to this user'));

          await LogYonetim.warn('dm_kapali', `DM gönderilemedi: ${isDmClosed ? 'DM kapalı' : dmError.message}`, {
            klasor: 'panel',
            key: 'sayfa1',
            kullaniciID: userId,
            guildId:  gldId,
            commandType: commandType,
            traceID: traceId,
            dmKapali: isDmClosed,
            hata: dmError. message,
            timestamp: getISOTimestamp()
          });

          const errorEmbed = await createErrorEmbed(
            userId,
            gldId,
            isDmClosed
              ? 'DM gönderilemedi.  DM\'lerinizin açık olduğundan emin olun.'
              : 'DM gönderimi sırasında bir hata oluştu.',
            'DM_SEND_ERROR'
          );

          await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags. Ephemeral });
        }
      }

      // ========== KANALA GÖNDER ==========
      else if (buttonId === 'sayfa1_send_channel') {
        await LogYonetim.info('kanal_gonderim_baslatildi', 'Kanal gönderimi başlatıldı', {
          klasor: 'panel',
          key: 'sayfa1',
          kullaniciID: userId,
          guildId: gldId,
          commandType: commandType,
          traceID:  traceId,
          dosyaAdi:  fileName,
          timestamp: getISOTimestamp()
        });

        try {
          const channel = interaction.channel;

          if (! channel) {
            throw new Error('Kanal bulunamadı');
          }

          // ========== YETKİ KONTROLÜ ==========
          const botMember = interaction.guild?. members?. me;

          if (botMember && typeof channel.permissionsFor === 'function') {
            const permissions = channel.permissionsFor(botMember);

            const canSendMessages = permissions?. has(PermissionFlagsBits.SendMessages);
            const canAttachFiles = permissions?. has(PermissionFlagsBits. AttachFiles);

            if (!canSendMessages || !canAttachFiles) {
              await LogYonetim.warn('kanal_yetki_eksik', 'Bot\'un kanala mesaj/dosya gönderme yetkisi yok', {
                klasor: 'panel',
                key:  'sayfa1',
                kullaniciID: userId,
                guildId: gldId,
                commandType:  commandType,
                traceID: traceId,
                kanalId: channel.id,
                canSendMessages: canSendMessages,
                canAttachFiles: canAttachFiles,
                timestamp:  getISOTimestamp()
              });

              const errorEmbed = await createErrorEmbed(
                userId,
                gldId,
                'Bot\'un bu kanala mesaj veya dosya gönderme yetkisi yok.',
                'PERMISSION_ERROR'
              );

              await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags. Ephemeral });
              return;
            }
          }

          // Dosyayı oku
          const fileContent = await fsp.readFile(filePath);

          // Kanala gönder
          await channel.send({
            content:  `📁 **IO7R Sorgu Sonucu** - <@${userId}>\n📅 Tarih: ${formatReadableDate()}`,
            files: [{
              attachment:  fileContent,
              name: fileName
            }]
          });

          // Başarı embed'i ve butonları devre dışı bırak
          const sentEmbed = await createSentEmbed(userId, gldId, 'channel', fileName);
          const disabledButtons = createDisabledButtons();

          await interaction.update({
            embeds: [sentEmbed],
            components: [disabledButtons]
          });

          await LogYonetim.info('kanal_gonderim_basarili', `Dosya kanala gönderildi: ${fileName}`, {
            klasor: 'panel',
            key: 'sayfa1',
            kullaniciID: userId,
            guildId:  gldId,
            commandType: commandType,
            traceID: traceId,
            kanalId: channel. id,
            dosyaAdi:  fileName,
            timestamp: getISOTimestamp()
          });

          // Pending result temizle
          clearPendingResult(userId);

        } catch (channelError) {
          await LogYonetim.error('kanal_gonderim_hatasi', `Kanal gönderim hatası: ${channelError.message}`, {
            klasor: 'panel',
            key:  'sayfa1',
            kullaniciID: userId,
            guildId: gldId,
            commandType:  commandType,
            traceID: traceId,
            hata: channelError.message,
            timestamp: getISOTimestamp()
          });

          const errorEmbed = await createErrorEmbed(
            userId,
            gldId,
            'Kanala gönderilemedi.  Bot\'un bu kanala mesaj gönderme yetkisi olmayabilir.',
            'CHANNEL_SEND_ERROR'
          );

          await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
      }

    } catch (err) {
      await LogYonetim.error('buton_kritik_hata', `Buton işleme hatası: ${err.message}`, {
        klasor:  'panel',
        key: 'sayfa1',
        kullaniciID: userId,
        guildId: gldId,
        traceID: traceId,
        buttonId: buttonId,
        hata: err.message,
        stack: err.stack,
        timestamp: getISOTimestamp()
      });

      const errorEmbed = await createErrorEmbed(
        userId,
        gldId,
        'Buton işlenirken beklenmeyen bir hata oluştu.',
        'BUTTON_ERROR'
      );

      try {
        if (! interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags. Ephemeral });
        }
      } catch (replyErr) {
        await LogYonetim.error('etkilesim_hatasi', `Buton reply hatası: ${replyErr.message}`, {
          klasor: 'panel',
          key:  'sayfa1',
          kullaniciID: userId,
          guildId: gldId,
          traceID: traceId,
          hata: replyErr.message,
          timestamp: getISOTimestamp()
        });
      }
    }
  },

  // ==================== HARİCİ KULLANIM İÇİN YARDIMCI FONKSİYONLAR ====================

  /**
   * Bekleyen sonucu temizler
   * @param {string} usrId - Kullanıcı ID
   */
  clearPendingResult:  clearPendingResult,

  /**
   * Bekleyen sonuç var mı kontrol eder
   * @param {string} usrId - Kullanıcı ID
   * @returns {boolean} - Var mı
   */
  hasPendingResult:  hasPendingResult,

  /**
   * Bekleyen sonuç sayısını döndürür
   * @returns {number} - Sayı
   */
  getPendingCount: getPendingCount,

  /**
   * TC maskeleme fonksiyonu (harici kullanım için)
   * @param {string} tc - TC kimlik numarası
   * @param {string} cmdType - Komut tipi
   * @returns {string} - Maskelenmiş TC
   */
  maskTcForLog: maskTcForLog,

  /**
   * Maskeleme aktif mi kontrol fonksiyonu
   * @param {string} cmdType - Komut tipi
   * @returns {boolean} - Maskeleme aktif mi
   */
  isMaskingEnabled: isMaskingEnabled,

  /**
   * ENV normalize fonksiyonu
   * @param {any} val - ENV değeri
   * @returns {boolean} - Boolean değer
   */
  normalizeEnvBoolean: normalizeEnvBoolean,

  /**
   * TC doğrulama fonksiyonu (checksum dahil)
   * @param {string} tc - TC kimlik numarası
   * @returns {object} - Doğrulama sonucu
   */
  validateTc: validateTc,

  /**
   * TC checksum doğrulama fonksiyonu
   * @param {string} tc - TC kimlik numarası
   * @returns {boolean} - Checksum geçerli mi
   */
  validateTcChecksum:  validateTcChecksum,

  /**
   * TC'yi Base64 ile şifreler (LOG için)
   * @param {string} tc - TC kimlik numarası
   * @returns {Promise<string>} - Şifrelenmiş TC
   */
  encryptTcForLog: encryptTcForLog,

  /**
   * Embed parametrelerini getirir
   * @param {string} usrId - Kullanıcı ID
   * @param {string|null} gldId - Sunucu ID
   * @returns {Promise<object>} - Embed parametreleri
   */
  getEmbedParameters: getEmbedParameters
};

// Maskeleme logic'i ENV'e göre kontrol edilir şekilde eklendi.  VIP/Premium ve Ücretsiz maskelenme desteklenir.