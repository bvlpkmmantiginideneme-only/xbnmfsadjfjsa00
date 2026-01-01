// index.js
// Discord Bot - Ultra Gelişmiş Çekirdek Sistem
// VIP/Premium yetki, oda yönetimi, dinamik config, DB senkronizasyon
// ENV mask parametreleri gerçek zamanlı takip
// TEK DOSYA - TAM VE EKSİKSİZ - Production Ready
// v3.0 - Yeni log sistemi, ENV mask takibi, rate limit dostu

require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  MessageFlags,
  Collection
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// ==================== SABİTLER VE YOLLAR ====================

const BASE_DIR = process.cwd();

// Rütbe sistemi dizinleri (rutbe/ altında)
const RUTBE_DIR = path.join(BASE_DIR, 'rutbe');
const VIP_DIR = path.join(RUTBE_DIR, 'vip');
const PREMIUM_DIR = path.join(RUTBE_DIR, 'premium');
const VIP_KOMUT_DIR = path. join(VIP_DIR, 'komut');
const VIP_SAYFA_DIR = path.join(VIP_DIR, 'sayfa');
const PREMIUM_KOMUT_DIR = path.join(PREMIUM_DIR, 'komut');
const PREMIUM_SAYFA_DIR = path.join(PREMIUM_DIR, 'sayfa');

// Yetkili dosyaları (JSON formatında)
const VIP_YETKILI_FILE = path.join(VIP_DIR, 'vip_yetkili_kisiler.json');
const PREMIUM_YETKILI_FILE = path.join(PREMIUM_DIR, 'premium_yetkili_kisiler.json');

// Sunucu ve DM veri dizinleri
const SUNUCU_DM_VERILER_DIR = path. join(BASE_DIR, 'sunucu_dm_veriler');
const SUNUCU_VERILER_DIR = path.join(SUNUCU_DM_VERILER_DIR, 'sunucu');
const DM_VERILER_DIR = path. join(SUNUCU_DM_VERILER_DIR, 'dm');

// Komut dizinleri (sadece ücretsiz ve owner)
const UCRETSIZ_KOMUTLAR_DIR = path.join(BASE_DIR, 'ucretsiz_komutlar');
const OWNER_KOMUT_DIR = path. join(BASE_DIR, 'owner_komutlar');

// Sayfa ve state dizinleri
const STATELER_DIR = path.join(BASE_DIR, 'stateler');
const SAYFALAR_DIR = path.join(BASE_DIR, 'sayfalar');

// Log ve cache dizinleri
const LOGLAR_ROOT = path.join(BASE_DIR, 'loglar');
const CACHE_DIR = path. join(BASE_DIR, '. cache');

// Geçici dosya dizini (sorgu sonuçları için)
const COP_TEMIZLIK_DIR = path.join(BASE_DIR, 'cop_temizlik');

// Diğer dosyalar
const ADMINLER_DOSYA = path.join(BASE_DIR, 'adminler. json');
const COMMAND_SIGNATURE_FILE = path. join(CACHE_DIR, 'command_signature.json');

// NOT:  vip_komutlar, premium_komutlar ve oda_verileri klasörleri KALDIRILDI
// VIP/Premium komutları rutbe/ altından yüklenir
// Oda verileri veritabanında tutulur

// ==================== ENV DEĞİŞKENLERİ (DEFAULT FALLBACK İLE) ====================

const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process. env.CLIENT_ID || '';
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;
const PANEL_DEAKTIF_SANIYE = Math.max(10, Number(process.env. PANEL_DEAKTIF_SANIYE || 120));
const SUNUCU_GUNCELLEME_ARALIK = Math.max(60000, Number(process. env.SUNUCU_GUNCELLEME_ARALIK_MS || 86400000));
const ERROR_WEBHOOK_URL = process. env.ERROR_WEBHOOK_URL || '';
const FILE_DELETE_DELAY_MS = Math.max(1000, Number(process.env.FILE_DELETE_DELAY_MS || 2000));

// ==================== KOMUT DM/SUNUCU AYARLARI ====================

/**
 * ENV'den komut context ayarlarını okur
 * Varsayılan: Her ikisi de aktif (1)
 */
function getCommandContextSettings() {
  const dmAktifRaw = process.env. KOMUTLAR_DM_AKTIF;
  const sunucuAktifRaw = process.env.KOMUTLAR_SUNUCU_AKTIF;

  const dmAktif = dmAktifRaw === undefined || dmAktifRaw === null || dmAktifRaw === ''
    ? true
    : (dmAktifRaw === '1' || dmAktifRaw. toLowerCase() === 'true');

  const sunucuAktif = sunucuAktifRaw === undefined || sunucuAktifRaw === null || sunucuAktifRaw === ''
    ? true
    : (sunucuAktifRaw === '1' || sunucuAktifRaw.toLowerCase() === 'true');

  const contexts = [];
  if (sunucuAktif) contexts.push(0);
  if (dmAktif) {
    contexts.push(1);
    contexts.push(2);
  }

  const integrationTypes = [];
  if (sunucuAktif) integrationTypes.push(0);
  if (dmAktif) integrationTypes.push(1);

  return {
    dmAktif,
    sunucuAktif,
    contexts,
    integrationTypes,
    dmPermission: dmAktif
  };
}

const COMMAND_CONTEXT_SETTINGS = getCommandContextSettings();

// ==================== ENV MASK PARAMETRELERİ - GERÇEK ZAMANLI TAKİP ====================

const envMaskCache = {
  ucretsiz: { value: false, lastCheck: 0 },
  vip: { value:  false, lastCheck:  0 },
  premium: { value: false, lastCheck: 0 }
};

const ENV_MASK_CHECK_INTERVAL = 1000; // 1 saniye

/**
 * ENV mask değerini gerçek zamanlı okur - her saniye güncellenir
 * @param {string} maskType - 'ucretsiz', 'vip' veya 'premium'
 * @returns {boolean} Maskeleme aktif mi
 */
function getEnvMaskValue(maskType) {
  const now = Date.now();
  const cache = envMaskCache[maskType];
  
  if (! cache) return false;
  
  // Cache süresi dolmadıysa mevcut değeri döndür
  if ((now - cache.lastCheck) < ENV_MASK_CHECK_INTERVAL) {
    return cache.value;
  }
  
  // ENV'den güncel değeri oku
  let envKey = '';
  switch (maskType) {
    case 'ucretsiz': 
      envKey = 'UCRETSIZ_KOMUTLAR_GIZLILIK_MASKELEME';
      break;
    case 'vip': 
      envKey = 'VIP_KOMUTLAR_GIZLILIK_MASKELEME';
      break;
    case 'premium':
      envKey = 'PREMIUM_KOMUTLAR_GIZLILIK_MASKELEME';
      break;
    default:
      return false;
  }
  
  const envValue = process.env[envKey];
  const isEnabled = envValue === 'true' || envValue === '1' || envValue === 'evet';
  
  cache.value = isEnabled;
  cache.lastCheck = now;
  
  return isEnabled;
}

/**
 * Komut tipine göre maskeleme durumunu kontrol eder
 * @param {string} commandType - 'normal', 'vip', 'premium'
 * @returns {boolean}
 */
function isCommandMasked(commandType) {
  switch (commandType) {
    case 'vip':
      return getEnvMaskValue('vip');
    case 'premium':
      return getEnvMaskValue('premium');
    case 'normal':
    default:
      return getEnvMaskValue('ucretsiz');
  }
}

// ==================== KOMUT DM/SUNUCU AYARLARI ====================

/**
 * ENV'den komut context ayarlarını okur
 * Varsayılan: Her ikisi de aktif (1)
 * @returns {object} - {dmAktif, sunucuAktif, contexts, integrationTypes, dmPermission}
 */
function getCommandContextSettings() {
  const dmAktifRaw = process.env. KOMUTLAR_DM_AKTIF;
  const sunucuAktifRaw = process.env. KOMUTLAR_SUNUCU_AKTIF;

  // Normalize et - undefined/null/boş ise varsayılan true (1)
  const dmAktif = dmAktifRaw === undefined || dmAktifRaw === null || dmAktifRaw === ''
    ? true
    : (dmAktifRaw === '1' || dmAktifRaw. toLowerCase() === 'true');

  const sunucuAktif = sunucuAktifRaw === undefined || sunucuAktifRaw === null || sunucuAktifRaw === ''
    ? true
    : (sunucuAktifRaw === '1' || sunucuAktifRaw.toLowerCase() === 'true');

  // Discord API contexts:  0 = Guild, 1 = BotDM, 2 = PrivateChannel (Group DM)
  const contexts = [];
  if (sunucuAktif) contexts.push(0);
  if (dmAktif) {
    contexts.push(1);
    contexts.push(2);
  }

  // Integration types: 0 = GuildInstall, 1 = UserInstall
  const integrationTypes = [];
  if (sunucuAktif) integrationTypes.push(0);
  if (dmAktif) integrationTypes.push(1);

  return {
    dmAktif,
    sunucuAktif,
    contexts,
    integrationTypes,
    dmPermission: dmAktif
  };
}

// Global komut context ayarları (bir kez hesapla)
const COMMAND_CONTEXT_SETTINGS = getCommandContextSettings();

// ==================== CACHE SİSTEMLERİ ====================

const yetkiCache = {
  vip: { data: [], lastUpdate: 0, ttl: 60000 },
  premium: { data: [], lastUpdate: 0, ttl: 60000 },
  admins: { data:  [], lastUpdate: 0, ttl:  60000 }
};

const sunucuConfigCache = new Map();
const CONFIG_CACHE_TTL = 30000;

const sunucuLogKanalCache = new Map();
const LOG_KANAL_CACHE_TTL = 5000; // 5 saniye - hızlı güncelleme için

// API Queue sistemi
const apiQueue = {
  queue: [],
  processing: false,
  lastRequest: 0,
  minInterval: 50
};

// Aktif oda timer'ları
const activeOdaTimers = new Map();

// ==================== MODÜL IMPORTLARI (LAZY LOAD) ====================

let DatabaseManager = null;
let LogYonetim = null;
let VeriYonetim = null;
let dbManager = null;
let dbConnected = false;

function loadModules() {
  try {
    DatabaseManager = require('./dbmanager');
  } catch (e) {
    DatabaseManager = null;
  }

  try {
    LogYonetim = require('./log_yonetim');
  } catch (e) {
    LogYonetim = null;
  }

  try {
    const veriModule = require('./veri_yonetim');
    VeriYonetim = veriModule.VeriYonetim || veriModule;
  } catch (e) {
    VeriYonetim = null;
  }
}

loadModules();

// ==================== SUNUCU LOG KANAL SİSTEMİ ====================

/**
 * Sunucu için log kanalı ID'sini alır
 * Log kanalı tanımlı değilse null döner - bu durumda log gönderilmez
 * @param {string} guildId - Sunucu ID
 * @returns {Promise<string|null>} Log kanal ID veya null
 */
async function getSunucuLogKanalId(guildId) {
  if (!guildId) return null;
  
  const now = Date.now();
  const cached = sunucuLogKanalCache.get(guildId);
  
  // Cache geçerliyse döndür
  if (cached && (now - cached.lastCheck) < LOG_KANAL_CACHE_TTL) {
    return cached.kanalId;
  }
  
  try {
    // Sunucu config dosyasını oku
    const configPath = path.join(SUNUCU_VERILER_DIR, `${guildId}.js`);
    
    if (! fs.existsSync(configPath)) {
      sunucuLogKanalCache.set(guildId, { kanalId: null, lastCheck: now });
      return null;
    }
    
    // Cache temizle ve yeniden oku
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    
    const logKanalId = config.LOG_KANAL_ID || config.log_kanal_id || null;
    
    sunucuLogKanalCache.set(guildId, { kanalId: logKanalId, lastCheck: now });
    return logKanalId;
  } catch (e) {
    sunucuLogKanalCache.set(guildId, { kanalId: null, lastCheck: now });
    return null;
  }
}

/**
 * Sunucuya log gönderir - SADECE log kanalı tanımlıysa
 * Log kanalı yoksa sessizce atlar, kullanıcıyı rahatsız etmez
 * @param {string} guildId - Sunucu ID
 * @param {EmbedBuilder} embed - Gönderilecek embed
 * @returns {Promise<boolean>}
 */
async function sendSunucuLog(guildId, embed) {
  if (!guildId || !client || !client.isReady()) return false;
  
  try {
    const logKanalId = await getSunucuLogKanalId(guildId);
    
    // Log kanalı tanımlı değilse sessizce atla
    if (!logKanalId) return false;
    
    const kanal = await client.channels.fetch(logKanalId).catch(() => null);
    
    if (!kanal || !kanal.isTextBased()) return false;
    
    // Yazma izni kontrolü
    const botMember = kanal.guild?.members?.me;
    if (botMember && ! kanal.permissionsFor(botMember)?.has(['SendMessages', 'EmbedLinks'])) {
      return false;
    }
    
    await kanal.send({ embeds: [embed] });
    return true;
  } catch (e) {
    // Hata olursa sessizce geç - kullanıcıyı rahatsız etme
    return false;
  }
}

// ==================== SAFE LOGGER (KULLANICI DOSTU) ====================

const SafeLog = {
  /**
   * Dahili log - sistem loglaması için
   * Kullanıcıya GÖNDERİLMEZ
   */
  async _internalLog(level, event, message, opts = {}) {
    // LogYonetim varsa kullan
    if (LogYonetim && typeof LogYonetim[level] === 'function') {
      try {
        await LogYonetim[level](event, message, {
          ...opts,
          sendToDiscord: false // Kullanıcıya gönderme
        });
        return;
      } catch (e) {
        // Fallback'e düş
      }
    }
    
    // Fallback:  Dosyaya yaz
    try {
      const logDir = path.join(LOGLAR_ROOT, opts.klasor || 'bot_genel');
      const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.log`);
      
      await fsp.mkdir(logDir, { recursive: true });
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        message,
        ...opts
      };
      
      await fsp.appendFile(logFile, JSON.stringify(logEntry) + '\n', 'utf8');
    } catch (fileErr) {
      // Son çare: sessizce devam et
    }
  },

  async info(event, message, opts = {}) {
    await this._internalLog('info', event, message, opts);
  },

  async warn(event, message, opts = {}) {
    await this._internalLog('warn', event, message, opts);
  },

  async error(event, message, opts = {}) {
    await this._internalLog('error', event, message, opts);
  },

  async critical(event, message, opts = {}) {
    await this._internalLog('critical', event, message, opts);
    // Kritik hatalarda webhook bildir
    await sendErrorWebhook('CRITICAL', event, message, opts);
  },

  async debug(event, message, opts = {}) {
    if (process.env.DEBUG === 'true') {
      await this._internalLog('debug', event, message, opts);
    }
  },

  async success(event, message, opts = {}) {
    await this._internalLog('info', event, `✅ ${message}`, opts);
  },

  async sistemBasladi() {
    await this.info('sistem_basladi', 'Bot sistemi başlatıldı', {
      klasor: 'bot_genel',
      key: 'startup'
    });
  },

  async sistemKapandi() {
    await this.info('sistem_kapandi', 'Bot sistemi kapatıldı', {
      klasor: 'bot_genel',
      key: 'shutdown'
    });
  },

  async kullaniciKomut(userId, commandName, guildId, traceId) {
    await this.info('kullanici_komut', `Komut:  /${commandName}`, {
      klasor: guildId ?  'sunucular' : 'dm',
      key: 'command',
      kullaniciID: userId,
      komut: commandName,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async yetkiHatasi(userId, message, guildId) {
    await this.warn('yetki_hatasi', message, {
      klasor: 'bot_genel',
      key: 'permission',
      kullaniciID: userId,
      sunucuID: guildId
    });
  },

  async panelAcildi(userId, sayfa, guildId, traceId) {
    await this.info('panel_acildi', `Panel açıldı:  Sayfa ${sayfa}`, {
      klasor:  'panel',
      key:  'open',
      kullaniciID: userId,
      sayfa,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async panelKapandi(userId, neden, guildId, traceId) {
    await this.info('panel_kapandi', `Panel kapandı: ${neden}`, {
      klasor:  'panel',
      key: 'close',
      kullaniciID: userId,
      neden,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async panelHata(userId, hata, guildId, traceId) {
    await this.error('panel_hata', `Panel hatası: ${hata}`, {
      klasor: 'panel',
      key: 'error',
      kullaniciID: userId,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async sorguBasarili(userId, tablo, sure, satirSayisi, guildId, traceId) {
    await this.info('sorgu_basarili', `DB sorgusu: ${tablo}`, {
      klasor: 'database',
      key:  'query',
      kullaniciID: userId,
      tablo,
      sure,
      satirSayisi,
      sunucuID:  guildId,
      traceID:  traceId
    });
  },

  async sorguHatasi(userId, tablo, hata, guildId, traceId) {
    await this.error('sorgu_hatasi', `DB sorgu hatası: ${tablo}`, {
      klasor: 'database',
      key: 'error',
      kullaniciID: userId,
      tablo,
      hata,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async dmGonderildi(userId, baslik, guildId, traceId) {
    await this.info('dm_gonderildi', `DM gönderildi:  ${baslik}`, {
      klasor: 'dm',
      key: 'send',
      kullaniciID: userId,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async dmGonderimHatasi(userId, neden, guildId, traceId) {
    await this.warn('dm_gonderim_hatasi', `DM gönderilemedi: ${neden}`, {
      klasor: 'dm',
      key:  'error',
      kullaniciID: userId,
      sunucuID: guildId,
      traceID: traceId
    });
  }
};

// ==================== KULLANICI DOSTU LOG GÖNDERME ====================

/**
 * Kullanıcıya/Sunucuya log gönderir - SADE ve KULLANICI DOSTU
 * Sadece önemli bilgiler, teknik detay yok
 * @param {string} guildId - Sunucu ID
 * @param {string} baslik - Log başlığı
 * @param {string} aciklama - Kısa açıklama
 * @param {string} renk - Embed rengi
 */
async function sendUserFriendlyLog(guildId, baslik, aciklama, renk = '#4a9eff') {
  if (!guildId) return;
  
  const embed = new EmbedBuilder()
    .setTitle(baslik)
    .setDescription(aciklama)
    .setColor(renk)
    .setTimestamp();
  
  // Sunucu embed parametrelerini uygula
  const params = getEmbedParameters(guildId);
  if (params.footer) {
    embed.setFooter({ text: params.footer });
  }
  
  await sendSunucuLog(guildId, embed);
}

// ==================== WEBHOOK BİLDİRİM SİSTEMİ ====================

async function sendErrorWebhook(level, event, message, opts = {}) {
  if (!ERROR_WEBHOOK_URL) return;

  try {
    const webhookUrl = new URL(ERROR_WEBHOOK_URL);
    const isHttps = webhookUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = JSON.stringify({
      embeds: [{
        title: `🚨 ${level}:  ${event}`,
        description: message?.substring(0, 2000) || 'Detay yok',
        color: level === 'CRITICAL' ? 0xff0000 : 0xffaa00,
        fields: [
          { name: 'Trace ID', value: opts.traceID || 'N/A', inline:  true },
          { name: 'Kullanıcı', value: opts.kullaniciID || 'N/A', inline: true },
          { name: 'Sunucu', value:  opts.sunucuID || 'N/A', inline:  true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Bot Error System' }
      }]
    });

    const requestOptions = {
      hostname: webhookUrl.hostname,
      port: webhookUrl.port || (isHttps ? 443 : 80),
      path: webhookUrl.pathname + webhookUrl.search,
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    await new Promise((resolve, reject) => {
      const req = lib.request(requestOptions, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Webhook timeout'));
      });
      req.write(payload);
      req.end();
    });
  } catch (e) {
    // Webhook hatası sessizce geç
  }
}

// ==================== ENV DOĞRULAMA (KAPANMADAN DEVAM) ====================

function validateEnv() {
  const errors = [];
  const warnings = [];
  let canStart = true;

  if (!TOKEN || TOKEN.trim() === '') {
    errors.push('TOKEN eksik');
    canStart = false;
  }

  if (!CLIENT_ID || CLIENT_ID.trim() === '') {
    warnings.push('CLIENT_ID eksik - Komut register edilemeyecek');
  }

  if (! BOT_OWNER_ID) {
    warnings.push('BOT_OWNER_ID tanımlı değil - Owner komutları devre dışı');
  }

  const dbVars = ['DB_HOST', 'DB_USER', 'DB_PASS'];
  const hasAllDb = dbVars.every(v => process.env[v]);

  if (!hasAllDb) {
    warnings.push('Veritabanı bilgileri eksik - DB özellikleri devre dışı');
  }

  if (!ERROR_WEBHOOK_URL) {
    warnings.push('ERROR_WEBHOOK_URL tanımlı değil - Hata bildirimleri devre dışı');
  }

  // ENV mask durumlarını logla
  const maskStatus = {
    ucretsiz: getEnvMaskValue('ucretsiz'),
    vip: getEnvMaskValue('vip'),
    premium: getEnvMaskValue('premium')
  };

  if (warnings.length > 0) {
    SafeLog.warn('env_warnings', `${warnings.length} ENV uyarısı`, {
      klasor: 'bot_genel',
      key: 'startup',
      warnings:  warnings.join('; ')
    });
  }

  if (errors.length > 0) {
    SafeLog.error('env_errors', `${errors.length} ENV hatası`, {
      klasor: 'bot_genel',
      key: 'startup',
      errors: errors.join('; ')
    });
  }

  return { valid: canStart, errors, warnings, maskStatus };
}

// ==================== DİZİN OLUŞTURMA ====================

async function ensureDirs() {
  const dirs = [
    // Log dizinleri
    LOGLAR_ROOT,
    path.join(LOGLAR_ROOT, 'sunucular'),
    path.join(LOGLAR_ROOT, 'dm'),
    path.join(LOGLAR_ROOT, 'bot_genel'),
    path.join(LOGLAR_ROOT, 'database'),
    path.join(LOGLAR_ROOT, 'panel'),
    path.join(LOGLAR_ROOT, 'log_kalici_arsiv'),
    
    // Cache
    CACHE_DIR,
    
    // Komut dizinleri
    UCRETSIZ_KOMUTLAR_DIR,
    OWNER_KOMUT_DIR,
    
    // State ve sayfa
    STATELER_DIR,
    SAYFALAR_DIR,
    
    // Rütbe sistemi
    RUTBE_DIR,
    VIP_DIR,
    PREMIUM_DIR,
    VIP_KOMUT_DIR,
    VIP_SAYFA_DIR,
    PREMIUM_KOMUT_DIR,
    PREMIUM_SAYFA_DIR,
    
    // Sunucu/DM verileri
    SUNUCU_DM_VERILER_DIR,
    SUNUCU_VERILER_DIR,
    DM_VERILER_DIR,
    
    // Geçici dosyalar
    COP_TEMIZLIK_DIR
  ];

  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (e) {
      if (e.code !== 'EEXIST') {
        await SafeLog.warn('dir_create_error', `Dizin oluşturulamadı: ${dir}`, {
          klasor: 'bot_genel',
          key: 'startup'
        });
      }
    }
  }

  await ensureYetkiliFiles();

  try {
    if (!fs.existsSync(ADMINLER_DOSYA)) {
      await fsp.writeFile(ADMINLER_DOSYA, JSON.stringify({ admins: [] }, null, 2), 'utf8');
    }
  } catch (e) {
    // Sessizce devam et
  }

  try {
    if (! fs.existsSync(COMMAND_SIGNATURE_FILE)) {
      await fsp.writeFile(COMMAND_SIGNATURE_FILE, JSON.stringify({ commands: {}, lastUpdate: 0 }, null, 2), 'utf8');
    }
  } catch (e) {
    // Sessizce devam et
  }

  if (VeriYonetim && typeof VeriYonetim.ensureDirs === 'function') {
    try {
      await VeriYonetim.ensureDirs();
    } catch (e) {
      // Sessizce devam et
    }
  }

  if (LogYonetim && typeof LogYonetim.ensureLogDirs === 'function') {
    try {
      await LogYonetim.ensureLogDirs();
    } catch (e) {
      // Sessizce devam et
    }
  }

  await SafeLog.info('dirs_ready', 'Dizinler hazır', {
    klasor: 'bot_genel',
    key: 'startup'
  });
}
/**
 * Yetkili JSON dosyalarını oluşturur (yoksa)
 */
async function ensureYetkiliFiles() {
  const files = [
    {
      path: VIP_YETKILI_FILE,
      dir: VIP_DIR,
      content:  { vip_uyeler: [] }
    },
    {
      path: PREMIUM_YETKILI_FILE,
      dir: PREMIUM_DIR,
      content: { premium_uyeler: [] }
    }
  ];

  for (const file of files) {
    try {
      await fsp.mkdir(file.dir, { recursive: true });

      if (! fs.existsSync(file.path)) {
        await fsp.writeFile(file.path, JSON.stringify(file. content, null, 2), 'utf8');
      }
    } catch (e) {
      // Sessizce devam et
    }
  }
}

  try {
    if (!fs.existsSync(PREMIUM_YETKILI_FILE)) {
      await fsp.mkdir(PREMIUM_DIR, { recursive:  true });
      await fsp.writeFile(PREMIUM_YETKILI_FILE, defaultYetkiliContent, 'utf8');
    }
  } catch (e) {
    // Sessizce devam et
  }
}

// ==================== YETKİ SİSTEMİ (CACHE + FILE WATCH) ====================

// Dosya izleyicileri
let vipFileWatcher = null;
let premiumFileWatcher = null;
let adminFileWatcher = null;

function startYetkiFileWatchers() {
  // VIP dosya izleyici
  if (fs.existsSync(VIP_YETKILI_FILE)) {
    try {
      vipFileWatcher = fs.watch(VIP_YETKILI_FILE, { persistent: false }, () => {
        yetkiCache.vip.lastUpdate = 0; // Cache'i invalidate et
      });
      vipFileWatcher.on('error', () => {});
    } catch (e) {
      // Sessizce devam et
    }
  }

  // Premium dosya izleyici
  if (fs.existsSync(PREMIUM_YETKILI_FILE)) {
    try {
      premiumFileWatcher = fs.watch(PREMIUM_YETKILI_FILE, { persistent: false }, () => {
        yetkiCache.premium.lastUpdate = 0;
      });
      premiumFileWatcher.on('error', () => {});
    } catch (e) {
      // Sessizce devam et
    }
  }

  // Admin dosya izleyici
  if (fs.existsSync(ADMINLER_DOSYA)) {
    try {
      adminFileWatcher = fs.watch(ADMINLER_DOSYA, { persistent: false }, () => {
        yetkiCache.admins.lastUpdate = 0;
      });
      adminFileWatcher.on('error', () => {});
    } catch (e) {
      // Sessizce devam et
    }
  }
}

function stopYetkiFileWatchers() {
  if (vipFileWatcher) {
    vipFileWatcher.close();
    vipFileWatcher = null;
  }
  if (premiumFileWatcher) {
    premiumFileWatcher.close();
    premiumFileWatcher = null;
  }
  if (adminFileWatcher) {
    adminFileWatcher.close();
    adminFileWatcher = null;
  }
}
/**
 * Yetkili kullanıcıları JSON dosyasından okur ve cache'e alır
 * @param {string} rutbeTipi - 'vip' veya 'premium'
 * @returns {string[]} - Yetkili kullanıcı ID'leri
 */
function refreshYetkiliCache(rutbeTipi) {
  const cache = yetkiCache[rutbeTipi];
  if (! cache) return [];

  const now = Date.now();

  if (cache.data.length > 0 && (now - cache.lastUpdate) < cache.ttl) {
    return cache. data;
  }

  let filePath;
  let jsonKey;

  if (rutbeTipi === 'vip') {
    filePath = VIP_YETKILI_FILE;
    jsonKey = 'vip_uyeler';
  } else if (rutbeTipi === 'premium') {
    filePath = PREMIUM_YETKILI_FILE;
    jsonKey = 'premium_uyeler';
  } else {
    return [];
  }

  try {
    if (!fs.existsSync(filePath)) {
      cache.data = [];
      cache.lastUpdate = now;
      return [];
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const jsonData = JSON.parse(fileContent);

    const kullanicilar = Array.isArray(jsonData[jsonKey]) ? jsonData[jsonKey] : [];

    cache.data = kullanicilar;
    cache.lastUpdate = now;
    return kullanicilar;

  } catch (e) {
    cache.data = [];
    cache.lastUpdate = now;
    return [];
  }
}

function getYetkiliKullanicilar(rutbeTipi) {
  return refreshYetkiliCache(rutbeTipi);
}

function isVipUser(userId) {
  const vipUsers = getYetkiliKullanicilar('vip');
  return vipUsers.includes(userId);
}

function isPremiumUser(userId) {
  const premiumUsers = getYetkiliKullanicilar('premium');
  return premiumUsers.includes(userId);
}

function getUserRutbe(userId) {
  const isVip = isVipUser(userId);
  const isPremium = isPremiumUser(userId);

  if (isVip && isPremium) return 'vip+premium';
  if (isVip) return 'vip';
  if (isPremium) return 'premium';
  return 'normal';
}

function canUseVipCommand(userId) {
  return isVipUser(userId) || isOwner(userId);
}

function canUsePremiumCommand(userId) {
  return isPremiumUser(userId) || isOwner(userId);
}

function forceRefreshYetkiCache() {
  yetkiCache.vip.lastUpdate = 0;
  yetkiCache.premium.lastUpdate = 0;
  yetkiCache.admins.lastUpdate = 0;
}

// ==================== ADMIN SİSTEMİ ====================

async function getAdmins() {
  const cache = yetkiCache.admins;
  const now = Date.now();

  if (cache.data.length > 0 && (now - cache.lastUpdate) < cache.ttl) {
    return cache.data;
  }

  try {
    if (fs.existsSync(ADMINLER_DOSYA)) {
      const data = await fsp.readFile(ADMINLER_DOSYA, 'utf8');
      const parsed = JSON.parse(data);
      cache.data = Array.isArray(parsed.admins) ? parsed.admins :  [];
      cache.lastUpdate = now;
      return cache.data;
    }
  } catch (e) {
    // Sessizce devam et
  }

  cache.data = [];
  cache.lastUpdate = now;
  return [];
}

function isOwner(userId) {
  return BOT_OWNER_ID && userId === BOT_OWNER_ID;
}

async function isAdmin(userId) {
  try {
    const admins = await getAdmins();
    return admins.includes(userId);
  } catch (e) {
    return false;
  }
}

async function hasPermission(userId, level = 'user') {
  if (level === 'owner') {
    return isOwner(userId);
  } else if (level === 'admin') {
    return isOwner(userId) || await isAdmin(userId);
  } else if (level === 'vip') {
    return canUseVipCommand(userId);
  } else if (level === 'premium') {
    return canUsePremiumCommand(userId);
  }
  return true;
}

// ==================== SUNUCU KONFİG SİSTEMİ ====================

function getSunucuConfig(guildId) {
  const now = Date.now();
  const cached = sunucuConfigCache. get(guildId);

  if (cached && (now - cached.lastUpdate) < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  const defaultConfig = {
    KOMUTLAR_ICIN_ODA_AC_ZORUNLU: false,
    ODA_AC_KANAL_IDLERI: [],
    ODA_AC_KATEGORI_ID:  null,
    ODALARIN_OLDUGU_KATEGORI_ID: null,
    ODA_KAPANMA_VARSAYILAN_SANIYE: 300,
    EMBED_FOOTER:  null,
    EMBED_SETIMAGE: null,
    EMBED_COLOR: null,
    EMBED_THUMBNAIL: null,
    LOG_KANAL_ID: null
  };

  try {
    const configPath = path.join(SUNUCU_VERILER_DIR, `${guildId}.json`);

    if (!fs. existsSync(configPath)) {
      sunucuConfigCache.set(guildId, { config:  defaultConfig, lastUpdate: now });
      return defaultConfig;
    }

    const fileContent = fs.readFileSync(configPath, 'utf8');
    const data = JSON.parse(fileContent);

    const config = {
      KOMUTLAR_ICIN_ODA_AC_ZORUNLU: data.KOMUTLAR_ICIN_ODA_AC_ZORUNLU === true || data.KOMUTLAR_ICIN_ODA_AC_ZORUNLU === 1 || data.KOMUTLAR_ICIN_ODA_AC_ZORUNLU === '1',
      ODA_AC_KANAL_IDLERI: Array.isArray(data.ODA_AC_KANAL_IDLERI) ? data.ODA_AC_KANAL_IDLERI : 
                           (typeof data.ODA_AC_KANAL_IDLERI === 'string' ? data.ODA_AC_KANAL_IDLERI. split(',').filter(id => id.trim()) : []),
      ODA_AC_KATEGORI_ID: data.ODA_AC_KATEGORI_ID || null,
      ODALARIN_OLDUGU_KATEGORI_ID: data. ODALARIN_OLDUGU_KATEGORI_ID || null,
      ODA_KAPANMA_VARSAYILAN_SANIYE: Number(data.ODA_KAPANMA_VARSAYILAN_SANIYE) || 300,
      EMBED_FOOTER: data. EMBED_FOOTER || null,
      EMBED_SETIMAGE: data.EMBED_SETIMAGE || null,
      EMBED_COLOR: data.EMBED_COLOR || null,
      EMBED_THUMBNAIL: data.EMBED_THUMBNAIL || null,
      LOG_KANAL_ID: data.LOG_KANAL_ID || data.log_kanal_id || null
    };

    sunucuConfigCache.set(guildId, { config, lastUpdate:  now });
    return config;
  } catch (e) {
    sunucuConfigCache. set(guildId, { config: defaultConfig, lastUpdate:  now });
    return defaultConfig;
  }
}

function isOdaAcKomutZorunlu(guildId) {
  const config = getSunucuConfig(guildId);
  return config.ODA_AC_KOMUTLAR_ZORUNLU === true;
}

function isOdaAcKanali(guildId, channelId) {
  const config = getSunucuConfig(guildId);
  return config.ODA_AC_KANAL_IDLERI.includes(channelId);
}

function canRunCommandInChannel(guildId, channelId, commandName) {
  if (!guildId) return true;

  const config = getSunucuConfig(guildId);

  if (! config.ODA_AC_KOMUTLAR_ZORUNLU) return true;

  if (commandName === 'oda') {
    return config.ODA_AC_KANAL_IDLERI.includes(channelId);
  }

  return config.ODA_AC_KANAL_IDLERI.includes(channelId);
}

function forceRefreshConfigCache(guildId = null) {
  if (guildId) {
    sunucuConfigCache.delete(guildId);
    sunucuLogKanalCache.delete(guildId);
  } else {
    sunucuConfigCache.clear();
    sunucuLogKanalCache.clear();
  }
}

// ==================== DATABASE YÖNETİMİ ====================

async function initializeDatabase() {
  if (!DatabaseManager) {
    await SafeLog.warn('db_module_missing', 'DatabaseManager modülü yüklenemedi', {
      klasor: 'database',
      key:  'startup'
    });
    return false;
  }

  const dbEnvValid = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS;

  if (!dbEnvValid) {
    await SafeLog.warn('db_env_missing', 'Veritabanı ENV değişkenleri eksik', {
      klasor: 'database',
      key: 'startup'
    });
    return false;
  }

  try {
    dbManager = new DatabaseManager(null);

    dbManager.logger = {
      info: (e, m, o) => SafeLog.info(e, m, { ...o, klasor:  'database' }),
      warn: (e, m, o) => SafeLog.warn(e, m, { ...o, klasor: 'database' }),
      error: (e, m, o) => SafeLog.error(e, m, { ...o, klasor: 'database' }),
      debug: (e, m, o) => SafeLog.debug(e, m, { ...o, klasor: 'database' }),
      critical: (e, m, o) => SafeLog.critical(e, m, { ...o, klasor: 'database' }),
      success: (e, m, o) => SafeLog.success(e, m, { ...o, klasor: 'database' })
    };

    await dbManager.register('main', {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'AdmiralMorrisonGenel'
    });

    if (typeof dbManager.testConnection === 'function') {
      const testOk = await dbManager.testConnection('main');
      if (!testOk) {
        await SafeLog.warn('db_test_failed', 'Veritabanı bağlantı testi başarısız', {
          klasor: 'database',
          key:  'startup'
        });
        return false;
      }
    }

    dbConnected = true;

    await SafeLog.success('db_connected', 'Veritabanı bağlantısı başarılı', {
      klasor:  'database',
      key: 'startup'
    });

    await ensureDatabaseTables();

    return true;
  } catch (e) {
    await SafeLog.error('db_init_error', `Veritabanı başlatma hatası: ${e.message}`, {
      klasor:  'database',
      key: 'startup'
    });
    return false;
  }
}

async function ensureDatabaseTables() {
  if (! dbConnected || !dbManager) return;

  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS kanal_geri_sayim (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kullanici_id VARCHAR(32) NOT NULL,
        acilan_oda_id VARCHAR(32),
        oda_ac_kanal_id VARCHAR(500),
        sunucu_id VARCHAR(32) NOT NULL,
        oda_ac_kategori_id VARCHAR(32),
        odalarin_oldugu_kategori_id VARCHAR(32),
        kanal_acilma_zamani DATETIME,
        kanal_kapanma_zamani DATETIME,
        kalan_zaman INT DEFAULT 0,
        durum ENUM('aktif', 'kapandi', 'iptal') DEFAULT 'aktif',
        olusturma_tarihi TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        guncelleme_tarihi TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_kullanici (kullanici_id),
        INDEX idx_sunucu (sunucu_id),
        INDEX idx_oda (acilan_oda_id),
        INDEX idx_durum (durum)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await dbManager.query('main', createTableSQL, [], { logQuery: false });

    await SafeLog.info('db_tables_ready', 'Veritabanı tabloları hazır', {
      klasor: 'database',
      key: 'startup'
    });
  } catch (e) {
    await SafeLog.error('db_table_error', `Tablo oluşturma hatası: ${e.message}`, {
      klasor: 'database',
      key: 'startup'
    });
  }
}

// ==================== API QUEUE SİSTEMİ (RATE LIMIT DOSTU) ====================

async function queueApiRequest(requestFn) {
  return new Promise((resolve, reject) => {
    apiQueue.queue.push({ fn: requestFn, resolve, reject });
    processApiQueue();
  });
}

async function processApiQueue() {
  if (apiQueue.processing || apiQueue.queue.length === 0) return;

  apiQueue.processing = true;

  while (apiQueue.queue.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - apiQueue.lastRequest;

    if (timeSinceLastRequest < apiQueue.minInterval) {
      await new Promise(r => setTimeout(r, apiQueue.minInterval - timeSinceLastRequest));
    }

    const item = apiQueue.queue.shift();
    if (!item) continue;

    try {
      apiQueue.lastRequest = Date.now();
      const result = await item.fn();
      item.resolve(result);
    } catch (e) {
      if (e.status === 429) {
        const retryAfter = (e.retry_after || 5) * 1000;
        await SafeLog.warn('rate_limit_hit', `Rate limit - ${retryAfter}ms bekleniyor`, {
          klasor:  'bot_genel',
          key: 'api'
        });
        
        apiQueue.queue.unshift(item);
        await new Promise(r => setTimeout(r, retryAfter));
      } else {
        item.reject(e);
      }
    }
  }

  apiQueue.processing = false;
}

// ==================== DISCORD CLIENT ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

let rest = null;
if (TOKEN) {
  rest = new REST({ version: '10' }).setToken(TOKEN);
}

client.commands = new Map();
client.ownerCommands = new Map();
client.vipCommands = new Map();
client.premiumCommands = new Map();

// ==================== KOMUT YÜKLEME ====================

function getCommandSignature(cmdData) {
  try {
    const dataStr = JSON.stringify(cmdData);
    return crypto.createHash('md5').update(dataStr).digest('hex');
  } catch (e) {
    return null;
  }
}

async function loadCommandSignatures() {
  try {
    if (fs.existsSync(COMMAND_SIGNATURE_FILE)) {
      const data = await fsp.readFile(COMMAND_SIGNATURE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.commands || {};
    }
  } catch (e) {
    // Sessizce devam et
  }
  return {};
}

async function saveCommandSignatures(signatures) {
  try {
    await fsp.writeFile(
      COMMAND_SIGNATURE_FILE,
      JSON.stringify({ commands: signatures, lastUpdate: Date.now() }, null, 2),
      'utf8'
    );
  } catch (e) {
    // Sessizce devam et
  }
}

async function loadCommandsFrom(folder, targetMap, rutbeTipi = null) {
  const stats = { loaded: 0, skipped: 0, errors: 0 };

  try {
    await fsp.mkdir(folder, { recursive: true });
    
    let files = [];
    try {
      files = await fsp.readdir(folder);
    } catch (e) {
      return stats;
    }

    const jsFiles = files.filter(f => f.endsWith('.js'));

    for (const file of jsFiles) {
      const fullPath = path.join(folder, file);

      try {
        delete require.cache[require.resolve(fullPath)];
        const cmd = require(fullPath);

        if (!cmd || ! cmd.data || !cmd.data.name || typeof cmd.execute !== 'function') {
          stats.skipped++;
          continue;
        }

        if (rutbeTipi) {
          cmd.rutbeTipi = rutbeTipi;
        }

        targetMap.set(cmd.data.name, cmd);
        stats.loaded++;

        await SafeLog.debug('command_loaded', `Komut yüklendi: ${cmd.data.name}`, {
          klasor: 'bot_genel',
          key: 'startup'
        });
      } catch (e) {
        stats.errors++;
        await SafeLog.error('command_load_error', `Komut yükleme hatası: ${file}`, {
          klasor: 'bot_genel',
          key: 'startup'
        });
      }
    }
  } catch (e) {
    stats.errors++;
  }

  return stats;
}

async function safeRestPut(route, body, retryCount = 0) {
  const MAX_RETRIES = 3;

  if (! rest) {
    throw new Error('REST client hazır değil');
  }

  try {
    return await queueApiRequest(() => rest.put(route, { body }));
  } catch (e) {
    if (e.status === 429 && retryCount < MAX_RETRIES) {
      const waitTime = (e.retry_after || 5) * 1000;
      await SafeLog.warn('rate_limit_register', `Komut register rate limit - ${waitTime}ms`, {
        klasor: 'bot_genel',
        key: 'startup'
      });
      await new Promise(r => setTimeout(r, waitTime));
      return safeRestPut(route, body, retryCount + 1);
    }
    throw e;
  }
}

async function registerAndLoadCommands() {
  // Ücretsiz komutları yükle
  const ucretsizStats = await loadCommandsFrom(UCRETSIZ_KOMUTLAR_DIR, client. commands);
  
  // Owner komutlarını yükle
  const ownerStats = await loadCommandsFrom(OWNER_KOMUT_DIR, client.ownerCommands, 'owner');
  
  // VIP komutlarını yükle (rutbe/vip/komut/)
  const vipStats = await loadCommandsFrom(VIP_KOMUT_DIR, client.vipCommands, 'vip');
  
  // Premium komutlarını yükle (rutbe/premium/komut/)
  const premiumStats = await loadCommandsFrom(PREMIUM_KOMUT_DIR, client.premiumCommands, 'premium');

  // Çakışmaları çöz - Owner en yüksek öncelik
  for (const name of client.ownerCommands. keys()) {
    if (client.commands. has(name)) client.commands.delete(name);
    if (client.vipCommands.has(name)) client.vipCommands. delete(name);
    if (client. premiumCommands. has(name)) client.premiumCommands.delete(name);
  }

  if (! CLIENT_ID || !rest) {
    await SafeLog.warn('skip_register', 'CLIENT_ID veya REST eksik - Komut register atlanıyor', {
      klasor: 'bot_genel',
      key: 'startup'
    });
    return {
      total: client.commands.size + client.ownerCommands.size + client.vipCommands.size + client.premiumCommands.size,
      changed: 0,
      added: 0,
      deleted: 0
    };
  }

  try {
    const currentSignatures = {};
    const previousSignatures = await loadCommandSignatures();
    let changed = 0, added = 0, deleted = 0;

    const allCommands = [];
    const processedNames = new Set();

    const commandMaps = [
      client.commands,
      client.ownerCommands,
      client.vipCommands,
      client. premiumCommands
    ];

    for (const cmdMap of commandMaps) {
      for (const cmd of cmdMap.values()) {
        if (cmd.data && !processedNames. has(cmd.data.name)) {
          let cmdData = typeof cmd.data. toJSON === 'function' ? cmd.data.toJSON() : { ...cmd.data };

          // DM ve Sunucu context ayarlarını ekle
          cmdData.contexts = COMMAND_CONTEXT_SETTINGS.contexts;
          cmdData.integration_types = COMMAND_CONTEXT_SETTINGS.integrationTypes;

          if (COMMAND_CONTEXT_SETTINGS.dmPermission !== undefined) {
            cmdData.dm_permission = COMMAND_CONTEXT_SETTINGS.dmPermission;
          }

          const sig = getCommandSignature(cmdData);

          currentSignatures[cmd.data.name] = sig;
          allCommands.push(cmdData);
          processedNames.add(cmd.data.name);

          if (!previousSignatures[cmd. data.name]) {
            added++;
          } else if (previousSignatures[cmd.data.name] !== sig) {
            changed++;
          }
        }
      }
    }

    for (const prevCmd of Object.keys(previousSignatures)) {
      if (! currentSignatures[prevCmd]) {
        deleted++;
      }
    }

    const needsUpdate = added > 0 || changed > 0 || deleted > 0;

    if (needsUpdate) {
      await safeRestPut(Routes.applicationCommands(CLIENT_ID), allCommands);
      await saveCommandSignatures(currentSignatures);

      await SafeLog.info('commands_registered', 'Komutlar güncellendi', {
        klasor:  'bot_genel',
        key: 'startup',
        toplam: Object.keys(currentSignatures).length,
        degisen: changed,
        eklenen: added,
        silinen: deleted,
        dmAktif:  COMMAND_CONTEXT_SETTINGS.dmAktif,
        sunucuAktif: COMMAND_CONTEXT_SETTINGS. sunucuAktif
      });
    } else {
      await SafeLog.info('commands_uptodate', 'Komutlar güncel', {
        klasor: 'bot_genel',
        key: 'startup'
      });
    }

    return { total: Object.keys(currentSignatures).length, changed, added, deleted };
  } catch (e) {
    await SafeLog.error('command_register_error', `Komut register hatası: ${e. message}`, {
      klasor: 'bot_genel',
      key:  'startup'
    });
    return null;
  }
}

// ==================== EMBED YÖNETİMİ ====================

function getEmbedParameters(guildId = null, userId = null) {
  const params = {
    footer: null,
    image: null,
    thumbnail: null,
    color: null
  };

  try {
    if (guildId) {
      const config = getSunucuConfig(guildId);
      if (config.EMBED_FOOTER) params.footer = config.EMBED_FOOTER;
      if (config.EMBED_SETIMAGE) params.image = config.EMBED_SETIMAGE;
      if (config.EMBED_COLOR) params.color = config.EMBED_COLOR;
      if (config.EMBED_THUMBNAIL) params.thumbnail = config.EMBED_THUMBNAIL;
    }

    if (userId) {
      const dmFilePath = path.join(DM_VERILER_DIR, `${userId}.js`);
      if (fs.existsSync(dmFilePath)) {
        try {
          delete require.cache[require.resolve(dmFilePath)];
          const dmData = require(dmFilePath);
          if (dmData.EMBED_FOOTER) params.footer = dmData.EMBED_FOOTER;
          if (dmData.EMBED_SETIMAGE) params.image = dmData.EMBED_SETIMAGE;
          if (dmData.EMBED_COLOR) params.color = dmData.EMBED_COLOR;
          if (dmData.EMBED_THUMBNAIL) params.thumbnail = dmData.EMBED_THUMBNAIL;
        } catch (e) {
          // Sessizce devam et
        }
      }
    }
  } catch (e) {
    // Sessizce devam et
  }

  return params;
}

function applyEmbedParameters(embed, guildId = null, userId = null) {
  const params = getEmbedParameters(guildId, userId);

  try {
    if (params.footer) {
      embed.setFooter({ text: params.footer });
    }
    if (params.image) {
      embed.setImage(params.image);
    }
    if (params.thumbnail) {
      embed.setThumbnail(params.thumbnail);
    }
    if (params.color) {
      embed.setColor(params.color);
    }
  } catch (e) {
    // Sessizce devam et
  }

  return embed;
}

function createErrorEmbed(title, description, traceId = null, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#ff4444')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (traceId) {
    embed.setFooter({ text: `Trace:  ${traceId}` });
  }

  embed = applyEmbedParameters(embed, guildId, userId);
  return embed;
}

function createSuccessEmbed(title, description, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#00ff88')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  embed = applyEmbedParameters(embed, guildId, userId);
  return embed;
}

function createInfoEmbed(title, description, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#4a9eff')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  embed = applyEmbedParameters(embed, guildId, userId);
  return embed;
}

function createWarningEmbed(title, description, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#ffaa00')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  embed = applyEmbedParameters(embed, guildId, userId);
  return embed;
}

// ==================== YETKİ KONTROL ====================

async function checkPermission(interaction, requiredLevel = 'user') {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (requiredLevel === 'owner' && ! isOwner(userId)) {
    await SafeLog.yetkiHatasi(userId, 'Owner-only komut erişim denemesi', guildId);

    const embed = createErrorEmbed(
      '🚫 Yetkisiz İşlem',
      'Bu komut yalnızca bot sahibi tarafından kullanılabilir.',
      null, guildId, userId
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      // Sessizce devam et
    }
    return false;
  }

  if (requiredLevel === 'admin' && !await hasPermission(userId, 'admin')) {
    await SafeLog.yetkiHatasi(userId, 'Admin-only komut erişim denemesi', guildId);

    const embed = createErrorEmbed(
      '🚫 Yetkisiz İşlem',
      'Bu komut yalnızca yöneticiler tarafından kullanılabilir.',
      null, guildId, userId
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      // Sessizce devam et
    }
    return false;
  }

  if (requiredLevel === 'vip' && !canUseVipCommand(userId)) {
    await SafeLog.yetkiHatasi(userId, 'VIP komut erişim denemesi', guildId);

    const embed = createErrorEmbed(
      '🚫 Yetkisiz İşlem',
      'Bu komut **VIP** kullanıcılarına özeldir.',
      null, guildId, userId
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      // Sessizce devam et
    }
    return false;
  }

  if (requiredLevel === 'premium' && !canUsePremiumCommand(userId)) {
    await SafeLog.yetkiHatasi(userId, 'Premium komut erişim denemesi', guildId);

        const embed = createErrorEmbed(
      '🚫 Yetkisiz İşlem',
      'Bu komut **Premium** kullanıcılarına özeldir.',
      null, guildId, userId
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds:  [embed] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      // Sessizce devam et
    }
    return false;
  }

  return true;
}

// ==================== KANAL KONTROL ====================

function checkChannelRestriction(interaction, commandName) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  if (! guildId) return true;

  return canRunCommandInChannel(guildId, channelId, commandName);
}

// ==================== STATE YÖNETİMİ ====================

async function loadState(userId, stateDir = STATELER_DIR) {
  try {
    const statePath = path.join(stateDir, `${userId}.json`);
    
    if (!fs.existsSync(statePath)) {
      return null;
    }

    const data = await fsp.readFile(statePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

async function saveState(userId, state, stateDir = STATELER_DIR) {
  try {
    await fsp.mkdir(stateDir, { recursive: true });
    
    const statePath = path.join(stateDir, `${userId}.json`);
    state.lastSaved = Date.now();
    
    const tempPath = statePath + '.tmp';
    await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tempPath, statePath);
    
    return true;
  } catch (e) {
    await SafeLog.error('state_save_error', `State kaydetme hatası: ${userId}`, {
      klasor: 'panel',
      key: 'state'
    });
    return false;
  }
}

async function updateStateStatus(userId, stateDir, newStatus) {
  try {
    const state = await loadState(userId, stateDir);
    if (!state) return false;

    state.status = newStatus;
    state.statusUpdatedAt = Date.now();
    
    return await saveState(userId, state, stateDir);
  } catch (e) {
    return false;
  }
}

// ==================== ODA KISITLAMA SİSTEMİ ====================

/**
 * Kullanıcının açık odası var mı kontrol eder
 * @param {string} userId - Kullanıcı ID
 * @param {string} guildId - Sunucu ID
 * @returns {Promise<{hasRoom: boolean, roomData: object|null}>}
 */
async function checkUserHasActiveRoom(userId, guildId) {
  if (!dbConnected || !dbManager) {
    return { hasRoom: false, roomData: null };
  }

  try {
    const sql = `
      SELECT * FROM kanal_geri_sayim 
      WHERE kullanici_id = ? 
      AND sunucu_id = ?  
      AND durum = 'aktif'
      LIMIT 1
    `;

    const results = await dbManager. query('main', sql, [userId, guildId], { queue: true });

    if (results && results.length > 0) {
      return { hasRoom: true, roomData: results[0] };
    }

    return { hasRoom: false, roomData: null };
  } catch (e) {
    return { hasRoom: false, roomData: null };
  }
}

/**
 * Kanalın oda açma kanalı olup olmadığını kontrol eder
 * @param {string} guildId - Sunucu ID
 * @param {string} channelId - Kanal ID
 * @returns {boolean}
 */
function isOdaAcmaKanali(guildId, channelId) {
  const config = getSunucuConfig(guildId);

  if (!config.ODA_AC_KANAL_IDLERI || config.ODA_AC_KANAL_IDLERI.length === 0) {
    return false;
  }

  return config.ODA_AC_KANAL_IDLERI.includes(channelId);
}

/**
 * Komutun oda dışında kullanılıp kullanılamayacağını kontrol eder
 * @param {Interaction} interaction - Discord etkileşimi
 * @param {string} commandName - Komut adı
 * @returns {Promise<{allowed: boolean, embed: EmbedBuilder|null}>}
 */
async function checkOdaRestriction(interaction, commandName) {
  const guildId = interaction. guildId;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  // DM'de oda kısıtlaması yok
  if (! guildId) {
    return { allowed: true, embed: null };
  }

  // Bazı komutlar her zaman kullanılabilir
  const exemptCommands = ['oda', 'kurulum', 'yardim', 'help'];
  if (exemptCommands.includes(commandName. toLowerCase())) {
    return { allowed:  true, embed: null };
  }

  // Sunucu config'den zorunluluğu kontrol et
  const config = getSunucuConfig(guildId);

  if (!config. KOMUTLAR_ICIN_ODA_AC_ZORUNLU) {
    return { allowed: true, embed: null };
  }

  // Oda açma kanallarında her zaman kullanılabilir
  if (isOdaAcmaKanali(guildId, channelId)) {
    return { allowed: true, embed: null };
  }

  // Kullanıcının aktif odası var mı kontrol et
  const { hasRoom, roomData } = await checkUserHasActiveRoom(userId, guildId);

  if (!hasRoom) {
    return {
      allowed: false,
      embed:  createErrorEmbed(
        '🚪 Oda Gerekli',
        'Bu komutu kullanabilmek için önce bir **oda açmanız** gerekiyor.\n\n' +
        '📍 Oda açmak için `/oda` komutunu kullanabilirsiniz.\n' +
        '💡 Oda açtıktan sonra bu komutu kullanabilirsiniz.',
        null,
        guildId,
        userId
      )
    };
  }

  // Kullanıcı kendi odasında mı kontrol et
  if (roomData && roomData.acilan_oda_id !== channelId) {
    return {
      allowed: false,
      embed: createErrorEmbed(
        '📍 Yanlış Kanal',
        'Bu komutu sadece **kendi odanızda** kullanabilirsiniz.\n\n' +
        `🚪 Odanız:  <#${roomData.acilan_oda_id}>`,
        null,
        guildId,
        userId
      )
    };
  }

  return { allowed: true, embed: null };
}

// ==================== ODA GERİ SAYIM SİSTEMİ ====================

async function getOdaGeriSayimFromDB(odaId) {
  if (!dbConnected || !dbManager) return null;

  try {
    const sql = 'SELECT * FROM kanal_geri_sayim WHERE acilan_oda_id = ?  AND durum = "aktif" LIMIT 1';
    const results = await dbManager.query('main', sql, [odaId], { queue: true });
    return results && results.length > 0 ? results[0] : null;
  } catch (e) {
    return null;
  }
}

async function updateOdaKalanZaman(odaId, kalanZaman) {
  if (!dbConnected || !dbManager) return false;

  try {
    const sql = 'UPDATE kanal_geri_sayim SET kalan_zaman = ? WHERE acilan_oda_id = ? AND durum = "aktif"';
    await dbManager.query('main', sql, [kalanZaman, odaId], { queue: true });
    return true;
  } catch (e) {
    return false;
  }
}

async function createOdaRecord(data) {
  if (!dbConnected || !dbManager) return null;

  try {
    const sql = `
      INSERT INTO kanal_geri_sayim 
      (kullanici_id, acilan_oda_id, oda_ac_kanal_id, sunucu_id, oda_ac_kategori_id, 
       odalarin_oldugu_kategori_id, kanal_acilma_zamani, kanal_kapanma_zamani, kalan_zaman, durum)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'aktif')
    `;

    await dbManager.query('main', sql, [
      data.kullanici_id,
      data.acilan_oda_id,
      data.oda_ac_kanal_id,
      data.sunucu_id,
      data.oda_ac_kategori_id,
      data.odalarin_oldugu_kategori_id,
      data.kanal_kapanma_zamani,
      data.kalan_zaman
    ], { queue: true });

    return true;
  } catch (e) {
    await SafeLog.error('oda_record_error', `Oda kaydı oluşturma hatası: ${e.message}`, {
      klasor:  'panel',
      key: 'oda'
    });
    return false;
  }
}

async function closeOdaRecord(odaId) {
  if (! dbConnected || ! dbManager) return false;

  try {
    const sql = 'UPDATE kanal_geri_sayim SET durum = "kapandi", kalan_zaman = 0 WHERE acilan_oda_id = ?';
    await dbManager.query('main', sql, [odaId], { queue: true });
    return true;
  } catch (e) {
    await SafeLog.error('oda_close_error', `Oda kaydı kapatma hatası: ${e.message}`, {
      klasor: 'panel',
      key: 'oda'
    });
    return false;
  }
}

async function saveOdaMessages(channel, userId) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `${userId}-${timestamp}-oda-arsiv.zip`;
    const zipFilePath = path.join(ODA_VERILERI_DIR, zipFileName);

    await fsp.mkdir(ODA_VERILERI_DIR, { recursive: true });

    let allMessages = [];
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      allMessages = [...messages.values()].reverse();
    } catch (fetchErr) {
      // Sessizce devam et
    }

    let messagesContent = '═══════════════════════════════════════════\n';
    messagesContent += '📋 ODA MESAJ ARŞİVİ\n';
    messagesContent += `📅 Tarih: ${new Date().toLocaleString('tr-TR')}\n`;
    messagesContent += `#️⃣ Kanal: ${channel.name}\n`;
    messagesContent += `🆔 Kanal ID: ${channel.id}\n`;
    messagesContent += `👤 Oda Sahibi ID: ${userId}\n`;
    messagesContent += `📊 Toplam Mesaj:  ${allMessages.length}\n`;
    messagesContent += '═══════════════════════════════════════════\n\n';

    for (const msg of allMessages) {
      const msgTimestamp = msg.createdAt.toLocaleString('tr-TR');
      const authorTag = msg.author ?  msg.author.tag :  'Bilinmeyen';
      const content = msg.content || '[İçerik yok]';
      
      messagesContent += `[${msgTimestamp}] ${authorTag}:\n${content}\n`;

      if (msg.attachments && msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          messagesContent += `  📎 Ek:  ${att.name} - ${att.url}\n`;
        });
      }

      if (msg.embeds && msg.embeds.length > 0) {
        messagesContent += `  📑 Embed sayısı: ${msg.embeds.length}\n`;
      }

      messagesContent += '\n';
    }

    messagesContent += '═══════════════════════════════════════════\n';
    messagesContent += 'ARŞİV SONU\n';
    messagesContent += '═══════════════════════════════════════════\n';

    // Archiver kullanmadan basit text dosyası olarak kaydet
    const txtFilePath = path.join(ODA_VERILERI_DIR, `${userId}-${timestamp}-mesajlar.txt`);
    await fsp.writeFile(txtFilePath, messagesContent, 'utf8');

    return {
      success: true,
      filePath: txtFilePath,
      fileName: `${userId}-${timestamp}-mesajlar.txt`,
      messageCount: allMessages.length
    };
  } catch (e) {
    await SafeLog.error('oda_save_error', `Oda mesajları kaydetme hatası: ${e.message}`, {
      klasor:  'panel',
      key: 'oda'
    });
    return { success: false, error: e.message };
  }
}

function startOdaGeriSayim(odaId, discordClient) {
  if (activeOdaTimers.has(odaId)) {
    clearInterval(activeOdaTimers.get(odaId));
    activeOdaTimers.delete(odaId);
  }

  const timerInterval = setInterval(async () => {
    try {
      const odaData = await getOdaGeriSayimFromDB(odaId);

      if (!odaData || odaData.durum !== 'aktif') {
        clearInterval(timerInterval);
        activeOdaTimers.delete(odaId);
        return;
      }

      const now = new Date();
      const kapanmaZamani = new Date(odaData.kanal_kapanma_zamani);
      const kalanMs = kapanmaZamani - now;
      const kalanSaniye = Math.max(0, Math.floor(kalanMs / 1000));

      await updateOdaKalanZaman(odaId, kalanSaniye);

      const channel = discordClient.channels.cache.get(odaId);
      if (!channel) {
        clearInterval(timerInterval);
        activeOdaTimers.delete(odaId);
        await closeOdaRecord(odaId);
        return;
      }

      const guildId = odaData.sunucu_id;
      const odaSahibiId = odaData.kullanici_id;

      // 5 dakika kaldıysa - her dakika bildirim
      if (kalanSaniye <= 300 && kalanSaniye > 60 && kalanSaniye % 60 === 0) {
        const embed = createWarningEmbed(
          '⏰ Oda Kapanıyor! ',
          `Bu oda **${Math.floor(kalanSaniye / 60)} dakika** sonra kapanacak.\n\n⚠️ Önemli dosyalarınızı kaydetmeyi unutmayın!`,
          guildId, odaSahibiId
        );
        await channel.send({ embeds: [embed] }).catch(() => {});
      }

      // 1 dakika kaldıysa - kritik uyarılar
      if (kalanSaniye <= 60 && kalanSaniye > 5) {
        if (kalanSaniye === 60 || kalanSaniye === 30 || kalanSaniye === 10) {
          const embed = createErrorEmbed(
            '🚨 UYARI! ',
            `Bu oda **${kalanSaniye} saniye** sonra kapanacak!\n\n⚠️ Tüm mesajlar arşivlenecek.`,
            null, guildId, odaSahibiId
          );
          await channel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      // 5 saniye kaldıysa
      if (kalanSaniye === 5) {
        const embed = createErrorEmbed(
          '🔴 KANAL KAPANIYOR!',
          'Bu kanal **5 saniye** içinde silinecek! ',
          null, guildId, odaSahibiId
        );
        await channel.send({ embeds: [embed] }).catch(() => {});
      }

      // Süre doldu
      if (kalanSaniye <= 0) {
        clearInterval(timerInterval);
        activeOdaTimers.delete(odaId);

        const saveResult = await saveOdaMessages(channel, odaSahibiId);

        await closeOdaRecord(odaId);

        // Kullanıcıya DM gönder
        try {
          const user = await discordClient.users.fetch(odaSahibiId);

          if (saveResult.success) {
            const embed = createSuccessEmbed(
              '📁 Oda Arşivi',
              `Odanız kapandı ve tüm mesajlar arşivlendi.\n\n📅 Tarih:  ${new Date().toLocaleString('tr-TR')}\n📊 Mesaj Sayısı: ${saveResult.messageCount || 0}`
            );

            try {
              const fileBuffer = await fsp.readFile(saveResult.filePath);
              await user.send({
                embeds: [embed],
                files: [{
                  attachment: fileBuffer,
                  name: saveResult.fileName
                }]
              });

              await SafeLog.dmGonderildi(odaSahibiId, 'Oda Arşivi', guildId, null);
            } catch (fileErr) {
              await user.send({ embeds: [embed] });
            }
          } else {
            const embed = createWarningEmbed(
              '📁 Oda Kapandı',
              'Odanız kapandı.Mesajlar arşivlenirken bir sorun oluştu.'
            );
            await user.send({ embeds: [embed] });
          }
        } catch (dmErr) {
          await SafeLog.dmGonderimHatasi(odaSahibiId, 'DM kapalı veya erişilemez', guildId, null);
        }

        // Kanalı sil
        try {
          await channel.delete('Oda süresi doldu');
        } catch (delErr) {
          await SafeLog.error('oda_delete_error', `Kanal silme hatası: ${delErr.message}`, {
            klasor: 'panel',
            key:  'oda'
          });
        }

        await SafeLog.info('oda_kapandi', `Oda kapandı: ${odaId}`, {
          klasor: 'panel',
          key: 'oda',
          kullaniciID: odaSahibiId
        });
      }
    } catch (timerErr) {
      await SafeLog.error('oda_timer_error', `Oda timer hatası: ${timerErr.message}`, {
        klasor: 'panel',
        key:  'oda'
      });
    }
  }, 1000);

  activeOdaTimers.set(odaId, timerInterval);
}

async function restoreActiveOdaTimers() {
  if (! dbConnected || ! dbManager) return;

  try {
    const sql = 'SELECT * FROM kanal_geri_sayim WHERE durum = "aktif"';
    const results = await dbManager.query('main', sql, [], { queue: true });

    if (results && results.length > 0) {
      let restoredCount = 0;

      for (const oda of results) {
        if (oda.acilan_oda_id) {
          const channel = client.channels.cache.get(oda.acilan_oda_id);
          
          if (channel) {
            startOdaGeriSayim(oda.acilan_oda_id, client);
            restoredCount++;
          } else {
            await closeOdaRecord(oda.acilan_oda_id);
          }
        }
      }

      await SafeLog.info('oda_timers_restored', `${restoredCount} aktif oda timer'ı geri yüklendi`, {
        klasor: 'panel',
        key: 'oda'
      });
    }
  } catch (e) {
    await SafeLog.error('oda_restore_error', `Timer geri yükleme hatası: ${e.message}`, {
      klasor: 'panel',
      key: 'oda'
    });
  }
}

// ==================== INTERACTION HANDLER ====================

function findCommand(commandName) {
  if (client.ownerCommands.has(commandName)) {
    return { cmd: client.ownerCommands.get(commandName), type: 'owner' };
  }
  if (client.vipCommands.has(commandName)) {
    return { cmd:  client.vipCommands.get(commandName), type: 'vip' };
  }
  if (client.premiumCommands.has(commandName)) {
    return { cmd: client.premiumCommands.get(commandName), type: 'premium' };
  }
  if (client.commands.has(commandName)) {
    return { cmd: client.commands.get(commandName), type: 'normal' };
  }
  return { cmd: null, type: null };
}

async function handleSlashCommand(interaction, traceId) {
  const commandName = interaction.commandName;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    const { cmd, type } = findCommand(commandName);

    if (!cmd) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut mevcut değil veya yüklenemedi.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags. Ephemeral });
      return;
    }

    // ENV mask kontrolü - komut maskeliyse görünmez
    if (isCommandMasked(type)) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut şu anda kullanılamıyor.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // Oda kısıtlama kontrolü (sunucuda ise)
    if (guildId) {
      const odaCheck = await checkOdaRestriction(interaction, commandName);

      if (!odaCheck.allowed) {
        await interaction.reply({ embeds: [odaCheck.embed], flags: MessageFlags. Ephemeral });
        return;
      }
    }

    // ZORUNLU:  Her zaman defer yap (skipDefer yoksa)
    if (! cmd.skipDefer) {
      try {
        await interaction. deferReply({ flags: MessageFlags. Ephemeral });
      } catch (deferErr) {
        await SafeLog.warn('defer_failed', `Defer başarısız: ${deferErr.message}`, {
          klasor: 'bot_genel',
          key: 'interaction',
          traceID: traceId
        });
        return;
      }
    }

    // Yetki kontrolü
    let requiredPermission = 'user';

    if (type === 'owner') {
      requiredPermission = 'owner';
    } else if (type === 'vip' || cmd.rutbeTipi === 'vip') {
      requiredPermission = 'vip';
    } else if (type === 'premium' || cmd.rutbeTipi === 'premium') {
      requiredPermission = 'premium';
    } else if (cmd.permission) {
      requiredPermission = cmd. permission;
    }

    if (!await checkPermission(interaction, requiredPermission)) {
      return;
    }

    // Komutu çalıştır
    await cmd.execute(interaction, {
      client,
      db:  dbManager,
      dbConnected,
      LogYonetim:  SafeLog,
      traceId,
      PANEL_DEAKTIF_SANIYE,
      STATELER_DIR,
      SAYFALAR_DIR,
      COP_TEMIZLIK_DIR,
      FILE_DELETE_DELAY_MS,
      getSunucuConfig,
      getEmbedParameters,
      applyEmbedParameters,
      createOdaRecord,
      startOdaGeriSayim,
      closeOdaRecord,
      checkUserHasActiveRoom,
      isVipUser,
      isPremiumUser,
      getUserRutbe,
      isOwner,
      isAdmin,
      hasPermission,
      createErrorEmbed,
      createSuccessEmbed,
      createInfoEmbed,
      createWarningEmbed,
      loadState,
      saveState,
      updateStateStatus,
      forceRefreshYetkiCache,
      forceRefreshConfigCache,
      sendUserFriendlyLog,
      sendSunucuLog,
      isCommandMasked,
      getEnvMaskValue
    });

    await SafeLog.kullaniciKomut(userId, commandName, guildId, traceId);

  } catch (e) {
    await SafeLog.error('command_error', `Komut hatası: ${commandName}`, {
      klasor: 'bot_genel',
      key:  'command',
      hata: e.message,
      traceID: traceId,
      kullaniciID: userId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Bir Hata Oluştu',
        'Komut çalıştırılırken beklenmeyen bir sorun oluştu.  Lütfen daha sonra tekrar deneyin.',
        traceId, guildId, userId
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags. Ephemeral });
      }
    } catch (replyErr) {
      // Yanıt verilemedi
    }
  }
}
async function handleButton(interaction, traceId) {
  const buttonId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    // ZORUNLU: deferUpdate
    // YENİ - Modal gösteren butonlar için deferUpdate YAPMA
// deferUpdate burada yapılmayacak, her buton kendi içinde yönetecek

    // Panel butonları
    if (buttonId && buttonId.startsWith('panel_')) {
      const islemPaneli = client.commands.get('islem_paneli');
      if (islemPaneli && typeof islemPaneli.handleButton === 'function') {
        await islemPaneli.handleButton(interaction, buttonId, {
          client,
          db:  dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          PANEL_DEAKTIF_SANIYE,
          STATELER_DIR,
          SAYFALAR_DIR,
          getEmbedParameters,
          applyEmbedParameters,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
      }
      return;
    }

    // Sayfa butonları
    const sayfaMatch = buttonId.match(/^sayfa(\d+)_/);
    if (sayfaMatch) {
      const sayfaNo = sayfaMatch[1];
      try {
        const sayfaPath = path.join(SAYFALAR_DIR, `${sayfaNo}.js`);
        if (fs.existsSync(sayfaPath)) {
          delete require.cache[require.resolve(sayfaPath)];
          const sayfaModule = require(sayfaPath);

          if (sayfaModule && typeof sayfaModule.handleButton === 'function') {
            await sayfaModule.handleButton(interaction, buttonId, {
              client,
              db: dbManager,
              dbConnected,
              LogYonetim: SafeLog,
              traceId,
              userId,
              guildId,
              getEmbedParameters,
              applyEmbedParameters,
              createErrorEmbed,
              createSuccessEmbed,
              createInfoEmbed,
              createWarningEmbed,
              sendUserFriendlyLog
            });
          }
        }
      } catch (sayfaErr) {
        await SafeLog.error('sayfa_button_error', `Sayfa button hatası: ${sayfaErr.message}`, {
          klasor:  'panel',
          key: 'button'
        });
      }
      return;
    }

    // Oda butonları
    if (buttonId && buttonId.startsWith('oda_')) {
      const odaKomut = client.commands.get('oda');
      if (odaKomut && typeof odaKomut.handleButton === 'function') {
        await odaKomut.handleButton(interaction, buttonId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          getSunucuConfig,
          createOdaRecord,
          startOdaGeriSayim,
          closeOdaRecord,
          getEmbedParameters,
          applyEmbedParameters,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
      }
      return;
    }

    // VIP komut butonları
    if (buttonId && buttonId.startsWith('vip_')) {
      if (! canUseVipCommand(userId)) {
        const embed = createErrorEmbed(
          '🚫 Yetkisiz İşlem',
          'Bu buton **VIP** kullanıcılarına özeldir.',
          traceId, guildId, userId
        );
        await interaction.followUp({ embeds:  [embed], flags:  MessageFlags.Ephemeral });
        return;
      }

      const parts = buttonId.split('_');
      if (parts.length >= 2) {
        const commandName = parts[1];
        const vipCmd = client.vipCommands.get(commandName);

        if (vipCmd && typeof vipCmd.handleButton === 'function') {
          await vipCmd.handleButton(interaction, buttonId, {
            client,
            db: dbManager,
            dbConnected,
            LogYonetim: SafeLog,
            traceId,
            createErrorEmbed,
            createSuccessEmbed,
            createInfoEmbed,
            createWarningEmbed,
            sendUserFriendlyLog
          });
        }
      }
      return;
    }

    // Premium komut butonları
    if (buttonId && buttonId.startsWith('premium_')) {
      if (!canUsePremiumCommand(userId)) {
        const embed = createErrorEmbed(
          '🚫 Yetkisiz İşlem',
          'Bu buton **Premium** kullanıcılarına özeldir.',
          traceId, guildId, userId
        );
        await interaction.followUp({ embeds:  [embed], flags:  MessageFlags.Ephemeral });
        return;
      }

      const parts = buttonId.split('_');
      if (parts.length >= 2) {
        const commandName = parts[1];
        const premiumCmd = client.premiumCommands.get(commandName);

        if (premiumCmd && typeof premiumCmd.handleButton === 'function') {
          await premiumCmd.handleButton(interaction, buttonId, {
            client,
            db: dbManager,
            dbConnected,
            LogYonetim:  SafeLog,
            traceId,
            createErrorEmbed,
            createSuccessEmbed,
            createInfoEmbed,
            createWarningEmbed,
            sendUserFriendlyLog
          });
        }
      }
      return;
    }

    // Genel komut butonları
    for (const [cmdName, cmd] of client.commands) {
      if (buttonId.startsWith(`${cmdName}_`) && typeof cmd.handleButton === 'function') {
        await cmd.handleButton(interaction, buttonId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
        return;
      }
    }

  } catch (e) {
    await SafeLog.error('button_error', `Button hatası: ${buttonId}`, {
      klasor: 'bot_genel',
      key: 'interaction',
      kullaniciID: userId,
      traceID: traceId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Hata',
        'Buton işlenirken bir sorun oluştu.',
        traceId, guildId, userId
      );

      await interaction.followUp({ embeds: [errorEmbed], flags:  MessageFlags.Ephemeral });
    } catch (replyErr) {
      // Yanıt verilemedi
    }
  }
}

async function handleModal(interaction, traceId) {
  const modalId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    // ZORUNLU:  deferReply
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (deferErr) {
      // Defer başarısız olabilir
    }

    // Panel modalleri
    if (modalId && (modalId.startsWith('panel_') || modalId.includes('_modal'))) {
      const islemPaneli = client.commands.get('islem_paneli');
      if (islemPaneli && typeof islemPaneli.handleModal === 'function') {
        await islemPaneli.handleModal(interaction, modalId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          PANEL_DEAKTIF_SANIYE,
          STATELER_DIR,
          SAYFALAR_DIR,
          getEmbedParameters,
          applyEmbedParameters,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
      }
      return;
    }

    // Oda modalleri
    if (modalId && modalId.startsWith('oda_')) {
      const odaKomut = client.commands.get('oda');
      if (odaKomut && typeof odaKomut.handleModal === 'function') {
        await odaKomut.handleModal(interaction, modalId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          getSunucuConfig,
          createOdaRecord,
          startOdaGeriSayim,
          getEmbedParameters,
          applyEmbedParameters,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
      }
      return;
    }

    // Sayfa modalleri
    const sayfaMatch = modalId.match(/^sayfa(\d+)_/);
    if (sayfaMatch) {
      const sayfaNo = sayfaMatch[1];
      try {
        const sayfaPath = path.join(SAYFALAR_DIR, `${sayfaNo}.js`);
        if (fs.existsSync(sayfaPath)) {
          delete require.cache[require.resolve(sayfaPath)];
          const sayfaModule = require(sayfaPath);

          if (sayfaModule && typeof sayfaModule.handleModal === 'function') {
            await sayfaModule.handleModal(interaction, modalId, {
              client,
              db: dbManager,
              dbConnected,
              LogYonetim: SafeLog,
              traceId,
              userId,
              guildId,
              createErrorEmbed,
              createSuccessEmbed,
              createInfoEmbed,
              createWarningEmbed,
              sendUserFriendlyLog
            });
          }
        }
      } catch (sayfaErr) {
        await SafeLog.error('sayfa_modal_error', `Sayfa modal hatası: ${sayfaErr.message}`, {
          klasor: 'panel',
          key: 'modal'
        });
      }
      return;
    }

    // Genel komut modalleri
    for (const [cmdName, cmd] of client.commands) {
      if (modalId.startsWith(`${cmdName}_`) && typeof cmd.handleModal === 'function') {
        await cmd.handleModal(interaction, modalId, {
          client,
          db:  dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
        return;
      }
    }

  } catch (e) {
    await SafeLog.error('modal_error', `Modal hatası: ${modalId}`, {
      klasor: 'bot_genel',
      key: 'interaction',
      kullaniciID: userId,
      traceID: traceId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Hata',
        'Form işlenirken bir sorun oluştu.',
        traceId, guildId, userId
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      }
    } catch (replyErr) {
      // Yanıt verilemedi
    }
  }
}

async function handleSelectMenu(interaction, traceId) {
  const menuId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const selectedValues = interaction.values;

  try {
    // ZORUNLU: deferUpdate
    try {
      await interaction.deferUpdate();
    } catch (deferErr) {
      // Defer başarısız olabilir
    }

    // Panel select menüleri
    if (menuId && menuId.startsWith('panel_')) {
      const islemPaneli = client.commands.get('islem_paneli');
      if (islemPaneli && typeof islemPaneli.handleSelectMenu === 'function') {
        await islemPaneli.handleSelectMenu(interaction, menuId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim:  SafeLog,
          traceId,
          selectedValues,
          PANEL_DEAKTIF_SANIYE,
          STATELER_DIR,
          SAYFALAR_DIR,
          getEmbedParameters,
          applyEmbedParameters,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
      }
      return;
    }

    // Sayfa select menüleri
    const sayfaMatch = menuId.match(/^sayfa(\d+)_/);
    if (sayfaMatch) {
      const sayfaNo = sayfaMatch[1];
      try {
        const sayfaPath = path.join(SAYFALAR_DIR, `${sayfaNo}.js`);
        if (fs.existsSync(sayfaPath)) {
          delete require.cache[require.resolve(sayfaPath)];
          const sayfaModule = require(sayfaPath);

          if (sayfaModule && typeof sayfaModule.handleSelectMenu === 'function') {
            await sayfaModule.handleSelectMenu(interaction, menuId, {
              client,
              db: dbManager,
              dbConnected,
              LogYonetim: SafeLog,
              traceId,
              selectedValues,
              userId,
              guildId,
              createErrorEmbed,
              createSuccessEmbed,
              createInfoEmbed,
              createWarningEmbed,
              sendUserFriendlyLog
            });
          }
        }
      } catch (sayfaErr) {
        await SafeLog.error('sayfa_select_error', `Sayfa select hatası: ${sayfaErr.message}`, {
          klasor: 'panel',
          key: 'select'
        });
      }
      return;
    }

    // Genel komut select menüleri
    for (const [cmdName, cmd] of client.commands) {
      if (menuId.startsWith(`${cmdName}_`) && typeof cmd.handleSelectMenu === 'function') {
        await cmd.handleSelectMenu(interaction, menuId, {
          client,
          db:  dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          selectedValues,
          createErrorEmbed,
          createSuccessEmbed,
          createInfoEmbed,
          createWarningEmbed,
          sendUserFriendlyLog
        });
        return;
      }
    }

  } catch (e) {
    await SafeLog.error('select_error', `SelectMenu hatası: ${menuId}`, {
      klasor:  'bot_genel',
      key: 'interaction',
      kullaniciID: userId,
      traceID:  traceId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Hata',
        'Seçim işlenirken bir sorun oluştu.',
        traceId, guildId, userId
      );

      await interaction.followUp({ embeds: [errorEmbed], flags:  MessageFlags.Ephemeral });
    } catch (replyErr) {
      // Yanıt verilemedi
    }
  }
}

async function handleAutocomplete(interaction, traceId) {
  const commandName = interaction.commandName;
  const focusedOption = interaction.options.getFocused(true);

  try {
    const { cmd } = findCommand(commandName);

    if (cmd && typeof cmd.autocomplete === 'function') {
      const choices = await cmd.autocomplete(interaction, {
        client,
        db: dbManager,
        dbConnected,
        LogYonetim:  SafeLog,
        traceId,
        focusedOption,
        STATELER_DIR,
        SAYFALAR_DIR
      });

      if (Array.isArray(choices)) {
        await interaction.respond(choices.slice(0, 25));
      } else {
        await interaction.respond([]);
      }
    } else {
      await interaction.respond([]);
    }
  } catch (e) {
    try {
      await interaction.respond([]);
    } catch (respondErr) {
      // Respond da başarısız
    }
  }
}

// ==================== ANA INTERACTION HANDLER ====================

client.on('interactionCreate', async (interaction) => {
  const traceId = crypto.randomUUID ?  crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, traceId);
    } else if (interaction.isButton()) {
      await handleButton(interaction, traceId);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, traceId);
    } else if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu() || interaction.isMentionableSelectMenu()) {
      await handleSelectMenu(interaction, traceId);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, traceId);
    } else if (interaction.isContextMenuCommand()) {
      await SafeLog.debug('context_menu', `Context menu: ${interaction.commandName}`, {
        klasor: 'bot_genel',
        key: 'interaction'
      });
    }
  } catch (e) {
    await SafeLog.critical('interaction_fatal', 'Fatal interaction hatası', {
      klasor: 'bot_genel',
      key: 'critical',
      hata: e.message,
      traceID: traceId,
      userId: interaction.user?.id
    });

    await sendErrorWebhook('FATAL', 'interaction_fatal', e.message, {
      traceID: traceId,
      kullaniciID: interaction.user?.id
    });
  }
});

// ==================== MESSAGE EVENT ====================

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    if (! message.guild) {
      if (VeriYonetim && typeof VeriYonetim.kaydetKullaniciBilgisi === 'function') {
        try {
          await VeriYonetim.kaydetKullaniciBilgisi(message.author, client);
        } catch (veriErr) {
          // Sessizce geç
        }
      }

      await SafeLog.info('dm_mesaj', 'DM mesajı alındı', {
        klasor: 'dm',
        key:  'mesaj',
        kullaniciID: message.author.id
      });
    }
  } catch (e) {
    await SafeLog.error('message_error', `Message event hatası: ${e.message}`, {
      klasor:  'bot_genel',
      key: 'event'
    });
  }
});

// ==================== GUILD EVENTS ====================

client.on('guildCreate', async (guild) => {
  try {
    await SafeLog.info('guild_create', `Yeni sunucu:  ${guild.name}`, {
      klasor: 'bot_genel',
      key: 'guild',
      guildID: guild.id,
      memberCount: guild.memberCount
    });

    if (VeriYonetim && typeof VeriYonetim.kaydetSunucuBilgisi === 'function') {
      try {
        await VeriYonetim.kaydetSunucuBilgisi(guild, client);
      } catch (veriErr) {
        // Sessizce geç
      }
    }
  } catch (e) {
    await SafeLog.error('guild_create_error', `Guild create hatası: ${e.message}`, {
      klasor:  'bot_genel',
      key: 'event'
    });
  }
});

client.on('guildDelete', async (guild) => {
  try {
    await SafeLog.info('guild_delete', `Sunucudan çıkıldı: ${guild.name}`, {
      klasor:  'bot_genel',
      key: 'guild',
      guildID: guild.id
    });

    forceRefreshConfigCache(guild.id);
  } catch (e) {
    await SafeLog.error('guild_delete_error', `Guild delete hatası: ${e.message}`, {
      klasor:  'bot_genel',
      key: 'event'
    });
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await SafeLog.debug('member_add', `Yeni üye:  ${member.user.tag}`, {
      klasor: 'bot_genel',
      key: 'member',
      guildID: member.guild.id
    });
  } catch (e) {
    // Sessizce geç
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await SafeLog.debug('member_remove', `Üye ayrıldı:  ${member.user.tag}`, {
      klasor: 'bot_genel',
      key:  'member',
      guildID:  member.guild.id
    });
  } catch (e) {
    // Sessizce geç
  }
});

// ==================== READY EVENT ====================

client.once('ready', async () => {
  await SafeLog.sistemBasladi();

  await SafeLog.info('bot_ready', `Bot hazır:  ${client.user.tag}`, {
    klasor: 'bot_genel',
    key:  'startup',
    sunucuSayisi: client.guilds.cache.size,
    komutSayisi:  client.commands.size + client.ownerCommands.size + client.vipCommands.size + client.premiumCommands.size
  });

  // Dosya izleyicilerini başlat
  startYetkiFileWatchers();

  // Sunucu verilerini güncelle
  if (VeriYonetim && typeof VeriYonetim.guncelleTumSunucular === 'function') {
    try {
      const sonuc = await VeriYonetim.guncelleTumSunucular(client);
      await SafeLog.info('sunucu_guncelleme', 'Sunucu verileri güncellendi', {
        klasor: 'bot_genel',
        key: 'startup',
        basarili: sonuc.basarili,
        hatali: sonuc.hatali
      });
    } catch (veriErr) {
      await SafeLog.warn('sunucu_guncelleme_hata', `Sunucu güncelleme hatası: ${veriErr.message}`, {
        klasor:  'bot_genel',
        key: 'startup'
      });
    }
  }

  // Aktif oda timer'larını geri yükle
  await restoreActiveOdaTimers();
});

// ==================== CLIENT ERROR EVENTS ====================

client.on('error', async (error) => {
  await SafeLog.error('client_error', 'Discord client hatası', {
    klasor: 'bot_genel',
    key: 'client',
    hata: error.message
  });

  await sendErrorWebhook('ERROR', 'client_error', error.message, {});
});

client.on('warn', async (warning) => {
  await SafeLog.warn('client_warn', 'Discord client uyarısı', {
    klasor: 'bot_genel',
    key: 'client',
    uyari: warning
  });
});

client.on('rateLimit', async (rateLimitData) => {
  await SafeLog.warn('rate_limit', 'Rate limit uyarısı', {
    klasor: 'bot_genel',
    key: 'client',
    timeout: rateLimitData.timeout,
    method: rateLimitData.method,
    path: rateLimitData.path
  });
});

client.on('shardError', async (error, shardId) => {
  await SafeLog.error('shard_error', `Shard ${shardId} hatası`, {
    klasor: 'bot_genel',
    key: 'client',
    shardId,
    hata: error.message
  });

  await sendErrorWebhook('ERROR', 'shard_error', `Shard ${shardId}:  ${error.message}`, {});
});

client.on('shardReady', async (shardId) => {
  await SafeLog.info('shard_ready', `Shard ${shardId} hazır`, {
    klasor: 'bot_genel',
    key:  'client',
    shardId
  });
});

client.on('shardDisconnect', async (event, shardId) => {
  await SafeLog.warn('shard_disconnect', `Shard ${shardId} bağlantısı kesildi`, {
    klasor: 'bot_genel',
    key:  'client',
    shardId
  });
});

client.on('shardReconnecting', async (shardId) => {
  await SafeLog.info('shard_reconnecting', `Shard ${shardId} yeniden bağlanıyor`, {
    klasor: 'bot_genel',
    key: 'client',
    shardId
  });
});

client.on('shardResume', async (shardId, replayedEvents) => {
  await SafeLog.info('shard_resume', `Shard ${shardId} devam etti`, {
    klasor:  'bot_genel',
    key: 'client',
    shardId,
    replayedEvents
  });
});

// ==================== GLOBAL ERROR HANDLERS ====================

let unhandledErrorCount = 0;
const MAX_UNHANDLED_ERRORS = 10;
const ERROR_RESET_INTERVAL = 60000;

setInterval(() => {
  if (unhandledErrorCount > 0) {
    unhandledErrorCount = Math.max(0, unhandledErrorCount - 1);
  }
}, ERROR_RESET_INTERVAL);

process.on('unhandledRejection', async (reason, promise) => {
  unhandledErrorCount++;

  const errorMessage = reason instanceof Error ? reason.message : String(reason);

  await SafeLog.error('unhandled_rejection', 'Unhandled Promise rejection', {
    klasor: 'bot_genel',
    key: 'process',
    reason:  errorMessage
  });

  await sendErrorWebhook('ERROR', 'unhandled_rejection', errorMessage, {});

  if (unhandledErrorCount >= MAX_UNHANDLED_ERRORS) {
    await SafeLog.critical('too_many_rejections', 'Çok fazla unhandled rejection', {
      klasor: 'bot_genel',
      key: 'process'
    });
    await gracefulShutdown('TOO_MANY_ERRORS');
  }
});

process.on('uncaughtException', async (error, origin) => {
  unhandledErrorCount++;

  await SafeLog.critical('uncaught_exception', 'Uncaught exception', {
    klasor: 'bot_genel',
    key: 'process',
    hata: error.message,
    origin
  });

  await sendErrorWebhook('CRITICAL', 'uncaught_exception', error.message, {});

  const fatalErrors = ['EADDRINUSE', 'EACCES', 'EPERM', 'ENOMEM'];
  if (error.code && fatalErrors.includes(error.code)) {
    await gracefulShutdown('FATAL_ERROR');
  }

  if (unhandledErrorCount >= MAX_UNHANDLED_ERRORS) {
    await gracefulShutdown('TOO_MANY_ERRORS');
  }
});

process.on('warning', async (warning) => {
  if (warning.name === 'DeprecationWarning' || warning.name === 'ExperimentalWarning') {
    return;
  }

  await SafeLog.warn('process_warning', 'Process uyarısı', {
    klasor: 'bot_genel',
    key: 'process',
    name: warning.name,
    message: warning.message
  });
});

// ==================== GRACEFUL SHUTDOWN ====================

let isShuttingDown = false;

async function gracefulShutdown(reason = 'UNKNOWN') {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  await SafeLog.info('shutdown_start', `Bot kapatılıyor (Sebep: ${reason})`, {
    klasor: 'bot_genel',
    key: 'shutdown',
    reason,
    uptime: process.uptime()
  });

  const shutdownTimeout = setTimeout(() => {
    process.exit(1);
  }, 15000);

  try {
    // Dosya izleyicilerini durdur
    stopYetkiFileWatchers();

    // Aktif oda timer'larını temizle
    for (const [odaId, timerId] of activeOdaTimers) {
      clearInterval(timerId);
    }
    activeOdaTimers.clear();

    // State dosyalarını güncelle
    try {
      const stateFiles = await fsp.readdir(STATELER_DIR).catch(() => []);
      for (const file of stateFiles) {
        if (! file.endsWith('.json')) continue;

        const filePath = path.join(STATELER_DIR, file);
        try {
          const data = JSON.parse(await fsp.readFile(filePath, 'utf8'));
          if (data.status === 'active') {
            data.status = 'interrupted';
            data.interruptedAt = Date.now();
            data.interruptReason = reason;
            await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
          }
        } catch (stateErr) {
          // Sessizce geç
        }
      }
    } catch (e) {
      // Sessizce geç
    }

    // Veritabanı bağlantılarını kapat
    if (dbManager && typeof dbManager.shutdown === 'function') {
      try {
        await dbManager.shutdown(5000);
      } catch (dbErr) {
        // Sessizce geç
      }
    }

    // Discord client'ı kapat
    if (client) {
      try {
        await client.destroy();
      } catch (clientErr) {
        // Sessizce geç
      }
    }

    // Log queue'yu boşalt
    if (LogYonetim && typeof LogYonetim.flushQueue === 'function') {
      try {
        await LogYonetim.flushQueue();
      } catch (logErr) {
        // Sessizce geç
      }
    }

    await SafeLog.sistemKapandi();

  } catch (e) {
    // Shutdown sırasında hata
  }

  clearTimeout(shutdownTimeout);

  const exitCode = (reason === 'SIGINT' || reason === 'SIGTERM') ? 0 :  1;
  process.exit(exitCode);
}

// ==================== SHUTDOWN SİNYALLERİ ====================

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGHUP', () => {
  gracefulShutdown('SIGHUP');
});

if (process.platform === 'win32') {
  process.on('SIGBREAK', () => {
    gracefulShutdown('SIGBREAK');
  });
}

process.on('beforeExit', (code) => {
  if (! isShuttingDown) {
    gracefulShutdown(`BEFORE_EXIT_${code}`);
  }
});

// ==================== PERİYODİK GÖREVLER ====================

// State temizliği - 10 dakikada bir
const STATE_CLEANUP_INTERVAL = 10 * 60 * 1000;

setInterval(async () => {
  if (isShuttingDown) return;

  try {
    const stateFiles = await fsp.readdir(STATELER_DIR).catch(() => []);
    const now = Date.now();
    let updatedCount = 0;
    let deletedCount = 0;

    for (const file of stateFiles) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(STATELER_DIR, file);

      try {
        const content = await fsp.readFile(filePath, 'utf8');
        const data = JSON.parse(content);

        // Süresi dolmuş aktif state'leri expired yap
        if (data.status === 'active' && data.timeoutAt && now > data.timeoutAt + 60000) {
          data.status = 'expired';
          data.expiredAt = now;
          await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
          updatedCount++;
        }

        // 7 günden eski expired state'leri sil
        if (data.status === 'expired' && data.expiredAt && now > data.expiredAt + (7 * 24 * 60 * 60 * 1000)) {
          await fsp.unlink(filePath);
          deletedCount++;
        }
      } catch (parseErr) {
        try {
          await fsp.unlink(filePath);
          deletedCount++;
        } catch (unlinkErr) {
          // Sessizce geç
        }
      }
    }

    if (updatedCount > 0 || deletedCount > 0) {
      await SafeLog.info('state_cleanup', 'State temizliği yapıldı', {
        klasor:  'panel',
        key:  'cleanup',
        guncellenen: updatedCount,
        silinen: deletedCount
      });
    }
  } catch (e) {
    await SafeLog.error('state_cleanup_error', `State temizlik hatası: ${e.message}`, {
      klasor:  'panel',
      key: 'cleanup'
    });
  }
}, STATE_CLEANUP_INTERVAL);

// Sunucu veri güncelleme - ENV'den alınan süre (default 24 saat)
setInterval(async () => {
  if (isShuttingDown) return;
  if (! client || !client.isReady()) return;

  try {
    if (VeriYonetim && typeof VeriYonetim.guncelleTumSunucular === 'function') {
      const sonuc = await VeriYonetim.guncelleTumSunucular(client);
      await SafeLog.info('sunucu_otomatik_guncelleme', 'Sunucu verileri otomatik güncellendi', {
        klasor:  'bot_genel',
        key: 'veri',
        basarili: sonuc.basarili,
        hatali:  sonuc.hatali
      });
    }
  } catch (e) {
    await SafeLog.error('sunucu_update_error', `Sunucu güncelleme hatası:  ${e.message}`, {
      klasor: 'bot_genel',
      key: 'veri'
    });
  }
}, SUNUCU_GUNCELLEME_ARALIK);

// ==================== YARDIMCI FONKSİYONLAR ====================

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}g`);
  if (hours > 0) parts.push(`${hours}s`);
  if (minutes > 0) parts.push(`${minutes}d`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}sn`);

  return parts.join(' ');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}d ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}s ${Math.floor((ms % 3600000) / 60000)}d`;
}

function getHealthStatus() {
  const uptimeSeconds = process.uptime();
  const memUsage = process.memoryUsage();

  return {
    status: 'ok',
    uptime: uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    memoryUsage: {
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      rss: formatBytes(memUsage.rss),
      external: formatBytes(memUsage.external || 0),
      arrayBuffers: formatBytes(memUsage.arrayBuffers || 0)
    },
    dbConnected: dbConnected,
    discordConnected: client?.isReady() || false,
    commandsLoaded: {
      normal: client?.commands?.size || 0,
      owner: client?.ownerCommands?.size || 0,
      vip: client?.vipCommands?.size || 0,
      premium: client?.premiumCommands?.size || 0,
      total: (client?.commands?.size || 0) + (client?.ownerCommands?.size || 0) + 
             (client?.vipCommands?.size || 0) + (client?.premiumCommands?.size || 0)
    },
    guildsCount: client?.guilds?.cache?.size || 0,
    usersCount: client?.users?.cache?.size || 0,
    channelsCount: client?.channels?.cache?.size || 0,
    activeOdaTimers: activeOdaTimers.size,
    envMaskStatus: {
      ucretsiz: getEnvMaskValue('ucretsiz'),
      vip: getEnvMaskValue('vip'),
      premium: getEnvMaskValue('premium')
    },
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    timestamp: new Date().toISOString()
  };
}

async function getSystemStats() {
  const health = getHealthStatus();

  // Veritabanı istatistikleri
  let dbStats = null;
  if (dbManager && typeof dbManager.getStats === 'function') {
    try {
      dbStats = dbManager.getStats();
    } catch (e) {
      dbStats = null;
    }
  }

  // Veri istatistikleri
  let veriStats = null;
  if (VeriYonetim && typeof VeriYonetim.getVeriIstatistikleri === 'function') {
    try {
      veriStats = await VeriYonetim.getVeriIstatistikleri();
    } catch (e) {
      veriStats = null;
    }
  }

  // Log istatistikleri
  let logStats = null;
  if (LogYonetim && typeof LogYonetim.getLogStats === 'function') {
    try {
      logStats = await LogYonetim.getLogStats();
    } catch (e) {
      logStats = null;
    }
  }

  // State dosyaları sayısı
  let activeStates = 0;
  try {
    const stateFiles = await fsp.readdir(STATELER_DIR);
    activeStates = stateFiles.filter(f => f.endsWith('.json')).length;
  } catch (e) {
    activeStates = 0;
  }

  // Yetki istatistikleri
  const vipUsers = getYetkiliKullanicilar('vip');
  const premiumUsers = getYetkiliKullanicilar('premium');
  let adminCount = 0;
  try {
    const admins = await getAdmins();
    adminCount = admins.length;
  } catch (e) {
    adminCount = 0;
  }

  return {
    bot: health,
    database:  dbStats,
    veri: veriStats,
    log: logStats,
    panel: {
      activeStates,
      panelTimeout:  PANEL_DEAKTIF_SANIYE + ' saniye'
    },
    yetki: {
      ownerID: BOT_OWNER_ID || 'Tanımsız',
      adminSayisi: adminCount,
      vipKullaniciSayisi: vipUsers.length,
      premiumKullaniciSayisi: premiumUsers.length
    },
    cache: {
      yetkiCacheTTL: yetkiCache.vip.ttl + 'ms',
      configCacheTTL: CONFIG_CACHE_TTL + 'ms',
      sunucuConfigCacheSize: sunucuConfigCache.size,
      sunucuLogKanalCacheSize: sunucuLogKanalCache.size
    },
    odaTimers: {
      aktif: activeOdaTimers.size,
      timerIds: Array.from(activeOdaTimers.keys())
    },
    envMask: {
      ucretsiz: getEnvMaskValue('ucretsiz'),
      vip: getEnvMaskValue('vip'),
      premium: getEnvMaskValue('premium'),
      checkInterval: ENV_MASK_CHECK_INTERVAL + 'ms'
    }
  };
}

// ==================== BOT BAŞLATMA ====================

async function startBot() {
  const startTime = Date.now();

  await SafeLog. info('bot_starting', 'Bot başlatılıyor... ', {
    klasor: 'bot_genel',
    key: 'startup'
  });

  // 1. ENV Doğrulama
  const envResult = validateEnv();
  if (!envResult. valid) {
    await SafeLog. critical('env_invalid', 'ENV doğrulaması başarısız - Bot başlatılamıyor', {
      klasor: 'bot_genel',
      key: 'startup',
      errors: envResult. errors.join('; ')
    });
    process.exit(1);
  }

  // 2. Dizinleri oluştur
  await ensureDirs();

  // 3. Veritabanını başlat
  await initializeDatabase();

  // 4. Komutları yükle ve register et
  const commandResult = await registerAndLoadCommands();
  if (commandResult) {
    await SafeLog.info('commands_loaded', 'Komutlar yüklendi', {
      klasor: 'bot_genel',
      key: 'startup',
      toplam: commandResult. total,
      eklenen: commandResult.added,
      degisen: commandResult.changed,
      silinen: commandResult.deleted
    });
  }

  // 5. Yetki sistemini kontrol et
  const vipUsers = getYetkiliKullanicilar('vip');
  const premiumUsers = getYetkiliKullanicilar('premium');
  await SafeLog.info('yetki_loaded', 'Yetki sistemi yüklendi', {
    klasor: 'bot_genel',
    key: 'startup',
    vipSayisi: vipUsers. length,
    premiumSayisi:  premiumUsers.length,
    ownerID: BOT_OWNER_ID || 'Tanımsız'
  });

  // 6. ENV mask durumlarını logla
  await SafeLog.info('env_mask_status', 'ENV mask parametreleri', {
    klasor: 'bot_genel',
    key:  'startup',
    ucretsizMask: getEnvMaskValue('ucretsiz'),
    vipMask: getEnvMaskValue('vip'),
    premiumMask: getEnvMaskValue('premium')
  });

  /  // 7. Komut context ayarlarını logla
  await SafeLog.info('command_context_status', 'Komut context ayarları', {
    klasor: 'bot_genel',
    key: 'startup',
    dmAktif:  COMMAND_CONTEXT_SETTINGS.dmAktif,
    sunucuAktif: COMMAND_CONTEXT_SETTINGS. sunucuAktif,
    contexts: COMMAND_CONTEXT_SETTINGS. contexts,
    integrationTypes: COMMAND_CONTEXT_SETTINGS.integrationTypes
  });


  // 8. Discord'a bağlan
  try {
    await client.login(TOKEN);
    
    const loadTime = Date.now() - startTime;
    await SafeLog. success('bot_started', `Bot başarıyla başlatıldı (${loadTime}ms)`, {
      klasor: 'bot_genel',
      key: 'startup',
      sure:  loadTime
    });
  } catch (loginErr) {
    await SafeLog.critical('login_failed', `Discord login başarısız:  ${loginErr.message}`, {
      klasor: 'bot_genel',
      key: 'startup',
      hata: loginErr.message
    });

    await sendErrorWebhook('CRITICAL', 'login_failed', loginErr.message, {});
    await gracefulShutdown('LOGIN_FAILED');
  }
}

// Bot'u başlat
startBot().catch(async (e) => {
  await SafeLog.critical('startup_fatal', `Bot başlatma hatası:  ${e.message}`, {
    klasor: 'bot_genel',
    key: 'startup',
    hata:  e.message
  });

  await sendErrorWebhook('CRITICAL', 'startup_fatal', e.message, {});
  await gracefulShutdown('STARTUP_FATAL');
});

// ==================== MODÜL EXPORT ====================

module.exports = {
  // Discord Client
  client,
  
  // Database
  dbManager,
  get dbConnected() { return dbConnected; },
  
  // Logger
  SafeLog,
  
  // ENV Mask fonksiyonları
  getEnvMaskValue,
  isCommandMasked,
  
  // Yetki fonksiyonları
  isOwner,
  isAdmin,
  hasPermission,
  isVipUser,
  isPremiumUser,
  canUseVipCommand,
  canUsePremiumCommand,
  getUserRutbe,
  getYetkiliKullanicilar,
  getAdmins,
  forceRefreshYetkiCache,
  
  // Config fonksiyonları
  getSunucuConfig,
  isOdaAcKomutZorunlu,
  isOdaAcKanali,
  canRunCommandInChannel,
  forceRefreshConfigCache,
  
  // Log fonksiyonları
  getSunucuLogKanalId,
  sendSunucuLog,
  sendUserFriendlyLog,
  
  // Embed fonksiyonları
  getEmbedParameters,
  applyEmbedParameters,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  createWarningEmbed,
  
  // State fonksiyonları
  loadState,
  saveState,
  updateStateStatus,
  
  // Oda fonksiyonları
  createOdaRecord,
  closeOdaRecord,
  startOdaGeriSayim,
  getOdaGeriSayimFromDB,
  updateOdaKalanZaman,
  saveOdaMessages,
  restoreActiveOdaTimers,
  get activeOdaTimers() { return activeOdaTimers; },
  
  // Sistem fonksiyonları
  getHealthStatus,
  getSystemStats,
  gracefulShutdown,
  formatUptime,
  formatBytes,
  formatDuration,
  
  // API Queue
  queueApiRequest,
  
  // Webhook
  sendErrorWebhook,
  
  // Sabitler
  PANEL_DEAKTIF_SANIYE,
  SUNUCU_GUNCELLEME_ARALIK,
  STATELER_DIR,
  SAYFALAR_DIR,
  UCRETSIZ_KOMUTLAR_DIR,
  OWNER_KOMUT_DIR,
  VIP_KOMUTLAR_DIR,
  PREMIUM_KOMUTLAR_DIR,
  VIP_KOMUT_DIR,
  PREMIUM_KOMUT_DIR,
  VIP_SAYFA_DIR,
  PREMIUM_SAYFA_DIR,
  LOGLAR_ROOT,
  CACHE_DIR,
  BOT_OWNER_ID,
  SUNUCU_VERILER_DIR,
  DM_VERILER_DIR,
  ODA_VERILERI_DIR,
  BASE_DIR,
  RUTBE_DIR,
  VIP_DIR,
  PREMIUM_DIR,
  VIP_YETKILI_FILE,
  PREMIUM_YETKILI_FILE,
  ADMINLER_DOSYA,
  COMMAND_SIGNATURE_FILE,
  ENV_MASK_CHECK_INTERVAL,
  
  // Yeni exportlar
  COP_TEMIZLIK_DIR,
  FILE_DELETE_DELAY_MS,
  COMMAND_CONTEXT_SETTINGS,
  checkUserHasActiveRoom,
  checkOdaRestriction,
  isOdaAcmaKanali,
  
  // Cache referansları (read-only için getter)
  get yetkiCache() { return yetkiCache; },
  get sunucuConfigCache() { return sunucuConfigCache; },
  get sunucuLogKanalCache() { return sunucuLogKanalCache; },
  get CONFIG_CACHE_TTL() { return CONFIG_CACHE_TTL; },
  get LOG_KANAL_CACHE_TTL() { return LOG_KANAL_CACHE_TTL; }
};
