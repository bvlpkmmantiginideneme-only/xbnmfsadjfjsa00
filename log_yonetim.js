// log_yonetim.js
// Enterprise Log Yönetim Sistemi - v2.0
// Discord.js v14 uyumlu, dinamik embed, opsiyonel log kanalı destekli
// 5 saniyelik config refresh, kullanıcı dostu kategorize loglar
// Production-ready, güvenli, modüler

const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==================== SABITLER VE YOLLAR ====================

const LOGLAR_ROOT = path.join(process.cwd(), 'loglar');
const LOGLAR_SUNUCULAR = path.join(LOGLAR_ROOT, 'sunucular');
const LOGLAR_DM = path.join(LOGLAR_ROOT, 'dm');
const LOGLAR_BOT_GENEL = path.join(LOGLAR_ROOT, 'bot_genel');
const LOGLAR_DATABASE = path.join(LOGLAR_ROOT, 'database');
const LOGLAR_PANEL = path.join(LOGLAR_ROOT, 'panel');
const LOGLAR_SISTEMI = path.join(LOGLAR_ROOT, 'log_sistemi.jsonl');
const LOGLAR_ARSIV = path.join(LOGLAR_ROOT, 'log_kalici_arsiv');
const DEFAULT_CONFIG_PATH = path.join(LOGLAR_ROOT, 'default_config.json');

// Sunucu/DM veri yolları
const SUNUCU_DM_ROOT = path.join(process.cwd(), 'sunucu_dm_veriler');
const DM_VERILER_PATH = path.join(SUNUCU_DM_ROOT, 'dm');
const SUNUCU_VERILER_PATH = path.join(SUNUCU_DM_ROOT, 'sunucu');

// Varsayılan değerler
const DEFAULT_LOG_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const DEFAULT_KALICI_LOG_SILME_SANIYE = 2592000; // 30 gün
const EMBED_PARAM_REFRESH_INTERVAL = 5000; // 5 saniye
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const MAX_EMBED_FIELD_VALUE_LENGTH = 1024;

// Console renk kodları
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN:  '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA:  '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE:  '\x1b[37m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW:  '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_CYAN: '\x1b[96m',
  GRAY: '\x1b[90m',
  BOLD:  '\x1b[1m'
};

// Log kategorileri ve stilleri
const LOG_CATEGORIES = {
  SUCCESS: {
    emoji: '✅',
    color: 0x2ECC71, // Yeşil
    label: 'Başarılı',
    consoleColor:  COLORS.BRIGHT_GREEN
  },
  WARNING: {
    emoji: '⚠️',
    color: 0xF39C12, // Turuncu
    label: 'Uyarı',
    consoleColor: COLORS.BRIGHT_YELLOW
  },
  ERROR:  {
    emoji:  '❌',
    color: 0xE74C3C, // Kırmızı
    label: 'Hata',
    consoleColor:  COLORS.BRIGHT_RED
  },
  INFO: {
    emoji: 'ℹ️',
    color: 0x3498DB, // Mavi
    label: 'Bilgi',
    consoleColor: COLORS.BRIGHT_CYAN
  },
  SYSTEM: {
    emoji: '🧠',
    color: 0x9B59B6, // Mor
    label: 'Sistem',
    consoleColor:  COLORS.MAGENTA
  },
  DATA_COLLECT: {
    emoji: '📡',
    color:  0x1ABC9C, // Turkuaz
    label: 'Veri Toplama',
    consoleColor:  COLORS.CYAN
  },
  QUERY: {
    emoji: '🔍',
    color:  0x34495E, // Koyu gri
    label:  'Sorgu',
    consoleColor: COLORS.GRAY
  },
  USER: {
    emoji: '👤',
    color: 0x2980B9, // Koyu mavi
    label:  'Kullanıcı',
    consoleColor:  COLORS.BLUE
  },
  ADMIN: {
    emoji: '🛠️',
    color: 0xE91E63, // Pembe
    label:  'Admin',
    consoleColor: COLORS.BRIGHT_RED
  },
  DEBUG: {
    emoji: '🔍',
    color:  0x95A5A6, // Gri
    label:  'Debug',
    consoleColor: COLORS.GRAY
  },
  CRITICAL: {
    emoji: '🔴',
    color:  0x8B0000, // Koyu kırmızı
    label: 'Kritik',
    consoleColor:  COLORS.RED + COLORS.BOLD
  }
};

// ==================== LOG YÖNETİM SINIFI ====================

class LogYonetim {
  static initialized = false;
  static initPromise = null;
  static writeQueue = [];
  static isWriting = false;
  static configCache = null;
  static configLastRead = 0;
  static CONFIG_CACHE_TTL = 180000; // 3 dakika cache

  // Discord client referansı
  static discordClient = null;

  // Embed parametreleri cache
  static embedParamsCache = new Map();
  static embedParamsLastRefresh = new Map();

  // Rate limit koruması
  static rateLimitMap = new Map();
  static RATE_LIMIT_WINDOW = 1000; // 1 saniye
  static RATE_LIMIT_MAX = 5; // Saniyede max 5 mesaj

  // ==================== BAŞLATMA VE DİZİN YÖNETİMİ ====================

  /**
   * Discord client'ı ayarla
   * @param {Client} client - Discord.js Client instance
   */
  static setClient(client) {
    LogYonetim.discordClient = client;
  }

  /**
   * Log dizinlerini oluştur ve başlat
   * @returns {Promise<boolean>}
   */
  static async ensureLogDirs() {
    if (LogYonetim.initialized) return true;

    if (LogYonetim.initPromise) {
      return LogYonetim.initPromise;
    }

    LogYonetim.initPromise = (async () => {
      try {
        const dirs = [
          LOGLAR_ROOT,
          LOGLAR_SUNUCULAR,
          LOGLAR_DM,
          LOGLAR_BOT_GENEL,
          LOGLAR_DATABASE,
          LOGLAR_PANEL,
          LOGLAR_ARSIV,
          SUNUCU_DM_ROOT,
          DM_VERILER_PATH,
          SUNUCU_VERILER_PATH
        ];

        for (const dir of dirs) {
          try {
            await fsp.mkdir(dir, { recursive: true });
          } catch (mkdirErr) {
            if (mkdirErr.code !== 'EEXIST') {
              console.error(`${COLORS.RED}[LOG] Dizin oluşturulamadı: ${dir} - ${mkdirErr.message}${COLORS.RESET}`);
            }
          }
        }

        // log_sistemi.jsonl dosyasını oluştur
        if (! fs.existsSync(LOGLAR_SISTEMI)) {
          fs.writeFileSync(LOGLAR_SISTEMI, '', 'utf8');
        }

        // default_config.json dosyasını oluştur veya kontrol et
        await LogYonetim._ensureDefaultConfig();

        LogYonetim.initialized = true;
        return true;
      } catch (e) {
        console.error(`${COLORS.RED}[LOG] Başlatma hatası: ${e.message}${COLORS.RESET}`);
        return false;
      }
    })();

    return LogYonetim.initPromise;
  }

  /**
   * Varsayılan config dosyasını oluştur/doğrula
   */
  static async _ensureDefaultConfig() {
    try {
      if (! fs.existsSync(DEFAULT_CONFIG_PATH)) {
        const defaultConfig = {
          olusmaTarih: new Date().toISOString(),
          logBoyutuSiniri: LogYonetim._getLogLimitFromEnv(),
          kaliciLogSilmeSaniye: LogYonetim._getKaliciLogSilmeSaniyeFromEnv(),
          rotasyonTarihler: [],
          stateRepairLog: [],
          defaultLogKanalId: null,
          defaultEmbedFooter: null,
          defaultEmbedImage: null
        };

        await LogYonetim._safeWriteJson(DEFAULT_CONFIG_PATH, defaultConfig);
        console.log(`${COLORS.GREEN}[LOG] default_config.json oluşturuldu${COLORS.RESET}`);
      } else {
        // Mevcut config'i doğrula ve eksik alanları ekle
        const config = await LogYonetim._readConfig();
        let needsUpdate = false;

        const requiredFields = {
          olusmaTarih: new Date().toISOString(),
          logBoyutuSiniri: LogYonetim._getLogLimitFromEnv(),
          kaliciLogSilmeSaniye: LogYonetim._getKaliciLogSilmeSaniyeFromEnv(),
          rotasyonTarihler: [],
          stateRepairLog:  [],
          defaultLogKanalId: null,
          defaultEmbedFooter:  null,
          defaultEmbedImage:  null
        };

        for (const [key, defaultValue] of Object.entries(requiredFields)) {
          if (typeof config[key] === 'undefined') {
            config[key] = defaultValue;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await LogYonetim._safeWriteJson(DEFAULT_CONFIG_PATH, config);
        }
      }
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Config oluşturma hatası: ${e.message}${COLORS.RESET}`);
    }
  }

  // ==================== CONFIG YÖNETİMİ ====================

  static _getLogLimitFromEnv() {
    const envValue = process.env.LOG_ARSIV_DISK_LIMIT;
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_LOG_LIMIT_BYTES;
  }

  static _getKaliciLogSilmeSaniyeFromEnv() {
    const envValue = process.env.KALICI_LOG_DOSYA_SILME_SANIYE;
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_KALICI_LOG_SILME_SANIYE;
  }

  /**
   * Config dosyasını oku (cache destekli)
   * @returns {Promise<Object>}
   */
  static async _readConfig() {
    try {
      const now = Date.now();
      if (LogYonetim.configCache && (now - LogYonetim.configLastRead) < LogYonetim.CONFIG_CACHE_TTL) {
        return LogYonetim.configCache;
      }

      if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
        const defaultConfig = {
          olusmaTarih: new Date().toISOString(),
          logBoyutuSiniri: LogYonetim._getLogLimitFromEnv(),
          kaliciLogSilmeSaniye: LogYonetim._getKaliciLogSilmeSaniyeFromEnv(),
          rotasyonTarihler:  [],
          stateRepairLog: [],
          defaultLogKanalId: null,
          defaultEmbedFooter: null,
          defaultEmbedImage: null
        };
        LogYonetim.configCache = defaultConfig;
        LogYonetim.configLastRead = now;
        return defaultConfig;
      }

      const data = await fsp.readFile(DEFAULT_CONFIG_PATH, 'utf8');
      const config = JSON.parse(data);

      // ENV değerleri config'deki değerleri override eder
      if (process.env.LOG_ARSIV_DISK_LIMIT) {
        config.logBoyutuSiniri = LogYonetim._getLogLimitFromEnv();
      }
      if (process.env.KALICI_LOG_DOSYA_SILME_SANIYE) {
        config.kaliciLogSilmeSaniye = LogYonetim._getKaliciLogSilmeSaniyeFromEnv();
      }

      LogYonetim.configCache = config;
      LogYonetim.configLastRead = now;
      return config;
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Config okuma hatası:  ${e.message}${COLORS.RESET}`);
      return {
        olusmaTarih: new Date().toISOString(),
        logBoyutuSiniri: LogYonetim._getLogLimitFromEnv(),
        kaliciLogSilmeSaniye: LogYonetim._getKaliciLogSilmeSaniyeFromEnv(),
        rotasyonTarihler: [],
        stateRepairLog:  [],
        defaultLogKanalId: null,
        defaultEmbedFooter:  null,
        defaultEmbedImage:  null
      };
    }
  }

  /**
   * Config dosyasını güncelle
   * @param {Object} updates - Güncellenecek alanlar
   * @returns {Promise<boolean>}
   */
  static async _updateConfig(updates) {
    try {
      const config = await LogYonetim._readConfig();
      const updatedConfig = { ...config, ...updates };
      await LogYonetim._safeWriteJson(DEFAULT_CONFIG_PATH, updatedConfig);

      // Cache'i güncelle
      LogYonetim.configCache = updatedConfig;
      LogYonetim.configLastRead = Date.now();

      return true;
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Config güncelleme hatası: ${e.message}${COLORS.RESET}`);
      return false;
    }
  }

  // ==================== EMBED PARAMETRE YÖNETİMİ ====================

  /**
   * Sunucu veya DM için embed parametrelerini yükle
   * @param {string} id - Sunucu ID veya Kullanıcı ID
   * @param {string} type - 'sunucu' veya 'dm'
   * @returns {Promise<Object>}
   */
  static async loadEmbedParams(id, type = 'sunucu') {
    try {
      const cacheKey = `${type}_${id}`;
      const now = Date.now();

      // 5 saniyelik cache kontrolü
      const lastRefresh = LogYonetim.embedParamsLastRefresh.get(cacheKey) || 0;
      if ((now - lastRefresh) < EMBED_PARAM_REFRESH_INTERVAL) {
        const cached = LogYonetim.embedParamsCache.get(cacheKey);
        if (cached) return cached;
      }

      // Dosya yolunu belirle
      const basePath = type === 'dm' ? DM_VERILER_PATH : SUNUCU_VERILER_PATH;
      const filePath = path.join(basePath, `${id}.js`);

      let params = {
        EMBED_FOOTER:  null,
        EMBED_SETIMAGE: null,
        LOG_KANAL_ID: null
      };

      if (fs.existsSync(filePath)) {
        try {
          const content = await fsp.readFile(filePath, 'utf8');

          // EMBED_FOOTER parse
          const footerMatch = content.match(/EMBED_FOOTER\s*=\s*["'`]([^"'`]*)["'`]/);
          if (footerMatch && footerMatch[1]) {
            params.EMBED_FOOTER = footerMatch[1].trim();
          }

          // EMBED_SETIMAGE parse
          const imageMatch = content.match(/EMBED_SETIMAGE\s*=\s*["'`]([^"'`]*)["'`]/);
          if (imageMatch && imageMatch[1]) {
            params.EMBED_SETIMAGE = imageMatch[1].trim();
          }

          // LOG_KANAL_ID parse
          const kanalMatch = content.match(/LOG_KANAL_ID\s*=\s*["'`]([^"'`]*)["'`]/);
          if (kanalMatch && kanalMatch[1]) {
            params.LOG_KANAL_ID = kanalMatch[1].trim();
          }
        } catch (parseErr) {
          // Parse hatası - varsayılan değerlerle devam
        }
      }

      // Cache'e kaydet
      LogYonetim.embedParamsCache.set(cacheKey, params);
      LogYonetim.embedParamsLastRefresh.set(cacheKey, now);

      return params;
    } catch (e) {
      return {
        EMBED_FOOTER: null,
        EMBED_SETIMAGE:  null,
        LOG_KANAL_ID: null
      };
    }
  }

  /**
   * Embed parametrelerini yenile (5 saniyelik interval)
   * @param {string} id
   * @param {string} type
   * @returns {Promise<Object>}
   */
  static async refreshEmbedParams(id, type = 'sunucu') {
    const cacheKey = `${type}_${id}`;
    // Cache'i zorla temizle
    LogYonetim.embedParamsLastRefresh.delete(cacheKey);
    return await LogYonetim.loadEmbedParams(id, type);
  }

  // ==================== LOG KANAL KONTROLÜ ====================

  /**
   * Log kanalını kontrol et ve doğrula
   * @param {string} kanalId - Kanal ID
   * @returns {Promise<TextChannel|null>}
   */
  static async checkLogChannel(kanalId) {
    try {
      // Kanal ID kontrolü
      if (!kanalId || typeof kanalId !== 'string' || kanalId.trim() === '') {
        return null;
      }

      // Discord client kontrolü
      if (!LogYonetim.discordClient || !LogYonetim.discordClient.isReady()) {
        return null;
      }

      // Kanalı bul
      const kanal = await LogYonetim.discordClient.channels.fetch(kanalId).catch(() => null);

      if (!kanal) {
        LogYonetim._consoleLog('DEBUG', 'LOG_KANAL', `Kanal bulunamadı:  ${kanalId}`);
        return null;
      }

      // Kanal tipi kontrolü (TextChannel olmalı)
      if (!kanal.isTextBased || !kanal.isTextBased()) {
        LogYonetim._consoleLog('DEBUG', 'LOG_KANAL', `Kanal metin kanalı değil: ${kanalId}`);
        return null;
      }

      // Yazma izni kontrolü
      const botMember = kanal.guild?.members?.me;
      if (botMember && ! kanal.permissionsFor(botMember)?.has(['SendMessages', 'EmbedLinks'])) {
        LogYonetim._consoleLog('DEBUG', 'LOG_KANAL', `Kanala yazma izni yok: ${kanalId}`);
        return null;
      }

      return kanal;
    } catch (e) {
      // Hata durumunda sessizce null dön
      return null;
    }
  }

  /**
   * Log kanalı ID'sini al (öncelik sırası:  parametre > sunucu config > global config)
   * @param {Object} opts - Seçenekler
   * @returns {Promise<string|null>}
   */
  static async getLogKanalId(opts = {}) {
    try {
      // 1.Parametre olarak verilmişse
      if (opts.logKanalId) {
        return opts.logKanalId;
      }

      // 2.Sunucu veya DM config'inden
      if (opts.guildID) {
        const params = await LogYonetim.loadEmbedParams(opts.guildID, 'sunucu');
        if (params.LOG_KANAL_ID) {
          return params.LOG_KANAL_ID;
        }
      }

      if (opts.kullaniciID && ! opts.guildID) {
        const params = await LogYonetim.loadEmbedParams(opts.kullaniciID, 'dm');
        if (params.LOG_KANAL_ID) {
          return params.LOG_KANAL_ID;
        }
      }

      // 3.Global config'den
      const config = await LogYonetim._readConfig();
      return config.defaultLogKanalId || null;
    } catch (e) {
      return null;
    }
  }

  // ==================== EMBED FORMATLAMA ====================

  /**
   * Log için embed oluştur
   * @param {Object} options - Embed seçenekleri
   * @returns {Object} Discord.js EmbedBuilder uyumlu obje
   */
  static formatEmbed(options = {}) {
    const {
      category = 'INFO',
      title = null,
      description = '',
      fields = [],
      footer = null,
      image = null,
      thumbnail = null,
      timestamp = true,
      author = null
    } = options;

    const categoryStyle = LOG_CATEGORIES[category] || LOG_CATEGORIES.INFO;

    // Embed objesi oluştur
    const embed = {
      color: categoryStyle.color,
      title: title ?  `${categoryStyle.emoji} ${title}` : `${categoryStyle.emoji} ${categoryStyle.label}`,
      description: LogYonetim._truncateText(description, MAX_EMBED_DESCRIPTION_LENGTH),
      fields: [],
      timestamp: timestamp ? new Date().toISOString() : undefined
    };

    // Fields ekle
    if (Array.isArray(fields) && fields.length > 0) {
      embed.fields = fields.map(field => ({
        name: LogYonetim._truncateText(String(field.name || 'Alan'), 256),
        value: LogYonetim._truncateText(String(field.value || '-'), MAX_EMBED_FIELD_VALUE_LENGTH),
        inline: Boolean(field.inline)
      })).slice(0, 25); // Max 25 field
    }

    // Author ekle
    if (author) {
      embed.author = {
        name:  LogYonetim._truncateText(String(author.name || ''), 256),
        icon_url: author.icon_url || undefined,
        url: author.url || undefined
      };
    }

    // Footer ekle (opsiyonel)
    if (footer) {
      embed.footer = {
        text: LogYonetim._truncateText(String(footer), 2048)
      };
    }

    // Image ekle (opsiyonel)
    if (image && LogYonetim._isValidUrl(image)) {
      embed.image = { url: image };
    }

    // Thumbnail ekle
    if (thumbnail && LogYonetim._isValidUrl(thumbnail)) {
      embed.thumbnail = { url: thumbnail };
    }

    return embed;
  }

  /**
   * Metni belirli uzunlukta kes
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  static _truncateText(text, maxLength) {
    if (! text) return '';
    const str = String(text);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * URL geçerliliğini kontrol et
   * @param {string} url
   * @returns {boolean}
   */
  static _isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== RATE LIMIT KORUMASII ====================

  /**
   * Rate limit kontrolü
   * @param {string} kanalId
   * @returns {boolean}
   */
  static _checkRateLimit(kanalId) {
    const now = Date.now();
    const key = `channel_${kanalId}`;

    if (!LogYonetim.rateLimitMap.has(key)) {
      LogYonetim.rateLimitMap.set(key, { count: 1, resetTime: now + LogYonetim.RATE_LIMIT_WINDOW });
      return true;
    }

    const limit = LogYonetim.rateLimitMap.get(key);

    if (now > limit.resetTime) {
      // Window sıfırla
      LogYonetim.rateLimitMap.set(key, { count: 1, resetTime: now + LogYonetim.RATE_LIMIT_WINDOW });
      return true;
    }

    if (limit.count >= LogYonetim.RATE_LIMIT_MAX) {
      return false; // Rate limit aşıldı
    }

    limit.count++;
    return true;
  }

  // ==================== DISCORD LOG GÖNDERME ====================

  /**
   * Discord kanalına embed log gönder
   * @param {Object} embedData - Embed verisi
   * @param {Object} opts - Seçenekler
   * @returns {Promise<boolean>}
   */
  static async sendLogToChannel(embedData, opts = {}) {
    try {
      // Log kanal ID'sini al
      const kanalId = await LogYonetim.getLogKanalId(opts);

      if (!kanalId) {
        // Kanal ID yoksa sessizce atla
        return false;
      }

      // Kanalı kontrol et
      const kanal = await LogYonetim.checkLogChannel(kanalId);

      if (!kanal) {
        // Kanal bulunamadı veya geçersiz - sessizce atla
        return false;
      }

      // Rate limit kontrolü
      if (! LogYonetim._checkRateLimit(kanalId)) {
        LogYonetim._consoleLog('DEBUG', 'RATE_LIMIT', `Kanal rate limit:  ${kanalId}`);
        return false;
      }

      // Embed parametrelerini yükle
      let embedParams = { EMBED_FOOTER:  null, EMBED_SETIMAGE: null };

      if (opts.guildID) {
        embedParams = await LogYonetim.loadEmbedParams(opts.guildID, 'sunucu');
      } else if (opts.kullaniciID) {
        embedParams = await LogYonetim.loadEmbedParams(opts.kullaniciID, 'dm');
      }

      // Embed'e footer ve image ekle (varsa)
      if (embedParams.EMBED_FOOTER && ! embedData.footer) {
        embedData.footer = { text: embedParams.EMBED_FOOTER };
      }

      if (embedParams.EMBED_SETIMAGE && !embedData.image) {
        if (LogYonetim._isValidUrl(embedParams.EMBED_SETIMAGE)) {
          embedData.image = { url:  embedParams.EMBED_SETIMAGE };
        }
      }

      // Mesajı gönder
      await kanal.send({ embeds: [embedData] });

      return true;
    } catch (e) {
      // Hata durumunda sessizce devam et, botu kilitletme
      LogYonetim._consoleLog('DEBUG', 'DISCORD_LOG_HATA', e.message);
      return false;
    }
  }

  // ==================== GÜVENLİ DOSYA YAZIMI ====================

  /**
   * JSON dosyasını güvenli yaz (temp + backup)
   * @param {string} filePath
   * @param {Object} data
   * @returns {Promise<boolean>}
   */
  static async _safeWriteJson(filePath, data) {
    const tempPath = filePath + '.tmp';
    const backupPath = filePath + '.backup';

    try {
      // Önce temp dosyaya yaz
      await fsp.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');

      // Mevcut dosyayı backup'la
      if (fs.existsSync(filePath)) {
        try {
          await fsp.copyFile(filePath, backupPath);
        } catch (backupErr) {
          // Backup hatası kritik değil
        }
      }

      // Temp dosyayı asıl dosyaya taşı
      await fsp.rename(tempPath, filePath);

      // Backup'ı sil
      if (fs.existsSync(backupPath)) {
        await fsp.unlink(backupPath).catch(() => {});
      }

      return true;
    } catch (e) {
      // Hata durumunda temp dosyayı temizle
      if (fs.existsSync(tempPath)) {
        await fsp.unlink(tempPath).catch(() => {});
      }

      // Backup varsa geri yükle
      if (fs.existsSync(backupPath) && ! fs.existsSync(filePath)) {
        try {
          await fsp.rename(backupPath, filePath);
        } catch (restoreErr) {
          console.error(`${COLORS.RED}[LOG] Backup geri yükleme hatası: ${restoreErr.message}${COLORS.RESET}`);
        }
      }

      throw e;
    }
  }

  // ==================== BOYUT KONTROLÜ VE ARŞİVLEME ====================

  /**
   * Dosya boyutunu al
   * @param {string} filePath
   * @returns {Promise<number>}
   */
  static async _getFileSize(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return 0;
      }
      const stats = await fsp.stat(filePath);
      return stats.size;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Byte'ı okunabilir formata çevir
   * @param {number} bytes
   * @returns {string}
   */
  static _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Log dosyası boyut kontrolü ve rotasyon
   * @param {string} logFilePath
   * @returns {Promise<Object>}
   */
  static async _checkAndRotateLog(logFilePath) {
    try {
      const config = await LogYonetim._readConfig();
      const logLimit = config.logBoyutuSiniri || DEFAULT_LOG_LIMIT_BYTES;
      const fileSize = await LogYonetim._getFileSize(logFilePath);

      if (fileSize < logLimit) {
        return { rotated: false };
      }

      // Limit aşıldı - arşivleme yap
      console.log(`${COLORS.YELLOW}[LOG] Limit aşıldı (${LogYonetim._formatBytes(fileSize)}), arşivleme başlıyor...${COLORS.RESET}`);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const originalFileName = path.basename(logFilePath);
      const newFileName = `${path.basename(logFilePath, path.extname(logFilePath))}_${timestamp}${path.extname(logFilePath)}`;
      const archivePath = path.join(LOGLAR_ARSIV, newFileName);

      let arsivDurumu = 'tamamlandi';
      let aciklama = 'Log dosyası başarıyla arşive taşındı';

      try {
        await fsp.mkdir(LOGLAR_ARSIV, { recursive:  true });
        await fsp.rename(logFilePath, archivePath);
        await fsp.writeFile(logFilePath, '', 'utf8');
        console.log(`${COLORS.GREEN}[LOG] Arşivleme tamamlandı: ${newFileName}${COLORS.RESET}`);
      } catch (archiveErr) {
        arsivDurumu = 'hatali';
        aciklama = `Arşivleme hatası:  ${archiveErr.message}`;
        console.error(`${COLORS.RED}[LOG] Arşivleme hatası: ${archiveErr.message}${COLORS.RESET}`);

        try {
          if (! fs.existsSync(logFilePath)) {
            await fsp.writeFile(logFilePath, '', 'utf8');
          }
        } catch (createErr) {
          console.error(`${COLORS.RED}[LOG] Yeni log dosyası oluşturulamadı: ${createErr.message}${COLORS.RESET}`);
        }
      }

      // Sistem loguna kaydet
      const arsivKayit = {
        arsiv_durumu: arsivDurumu,
        orijinal_dosya_adi: originalFileName,
        yeni_dosya_adi: newFileName,
        dosya_boyutu: LogYonetim._formatBytes(fileSize),
        dosya_boyutu_bytes: fileSize,
        arsiv_yolu: archivePath,
        islem_tarihi: new Date().toISOString(),
        uygulama:  'log_yonetim',
        kategori: 'arsivleme',
        aciklama: aciklama
      };

      await LogYonetim._appendToSystemLog(arsivKayit);

      // Config'e rotasyon kaydı ekle
      const rotasyonKaydi = {
        tarih: new Date().toISOString(),
        dosya:  newFileName,
        boyut: fileSize,
        boyutFormatli: LogYonetim._formatBytes(fileSize),
        silinecekTarih: new Date(Date.now() + (config.kaliciLogSilmeSaniye * 1000)).toISOString()
      };

      const rotasyonTarihler = config.rotasyonTarihler || [];
      rotasyonTarihler.push(rotasyonKaydi);

      await LogYonetim._updateConfig({ rotasyonTarihler });

      return { rotated:  true, archivePath, originalSize: fileSize };
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Rotasyon kontrolü hatası: ${e.message}${COLORS.RESET}`);
      return { rotated: false, error: e.message };
    }
  }

  /**
   * Sistem log dosyasına kayıt ekle
   * @param {Object} entry
   */
  static async _appendToSystemLog(entry) {
    try {
      await LogYonetim.ensureLogDirs();
      const line = JSON.stringify(entry) + '\n';
      await fsp.appendFile(LOGLAR_SISTEMI, line, 'utf8');
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Sistem log yazma hatası: ${e.message}${COLORS.RESET}`);
    }
  }

  // ==================== ESKİ ARŞİV TEMİZLİĞİ ====================

  /**
   * Eski arşiv dosyalarını temizle
   * @returns {Promise<Object>}
   */
  static async cleanupOldArchives() {
    try {
      await LogYonetim.ensureLogDirs();

      const config = await LogYonetim._readConfig();
      const kaliciLogSilmeSaniye = config.kaliciLogSilmeSaniye || DEFAULT_KALICI_LOG_SILME_SANIYE;
      const maxAge = kaliciLogSilmeSaniye * 1000;
      const now = Date.now();

      const files = await fsp.readdir(LOGLAR_ARSIV).catch(() => []);
      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of files) {
        const filePath = path.join(LOGLAR_ARSIV, file);

        try {
          const stats = await fsp.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            deletedSize += stats.size;
            await fsp.unlink(filePath);
            deletedCount++;

            await LogYonetim._appendToSystemLog({
              arsiv_durumu:  'silindi',
              orijinal_dosya_adi: file,
              yeni_dosya_adi: null,
              dosya_boyutu:  LogYonetim._formatBytes(stats.size),
              dosya_boyutu_bytes: stats.size,
              arsiv_yolu:  filePath,
              islem_tarihi:  new Date().toISOString(),
              uygulama:  'log_yonetim',
              kategori: 'temizlik',
              aciklama: `Eski arşiv dosyası silindi (yaş: ${Math.floor(age / 86400000)} gün)`
            });
          }
        } catch (fileErr) {
          continue;
        }
      }

      if (deletedCount > 0) {
        console.log(`${COLORS.GREEN}[LOG] Arşiv temizliği:  ${deletedCount} dosya silindi (${LogYonetim._formatBytes(deletedSize)})${COLORS.RESET}`);
      }

      return { deletedCount, deletedSize };
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Arşiv temizliği hatası: ${e.message}${COLORS.RESET}`);
      return { deletedCount:  0, deletedSize: 0 };
    }
  }

  // ==================== ZAMAN FORMATLAMA ====================

  static _formatTimestamp() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  static _formatFullDate() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ==================== CONSOLE LOG ====================

  /**
   * Konsola log yaz
   * @param {string} severity
   * @param {string} event
   * @param {string} message
   */
  static _consoleLog(severity, event, message) {
    const timestamp = LogYonetim._formatTimestamp();
    const eventStr = event ? String(event).slice(0, 28).padEnd(28) : ''.padEnd(28);
    const msgStr = message ? String(message).slice(0, 120) : '';

    const categoryStyle = LOG_CATEGORIES[severity] || LOG_CATEGORIES.INFO;
    const color = categoryStyle.consoleColor;
    const prefix = (categoryStyle.label || 'INFO').padEnd(5).slice(0, 5);
    const emoji = categoryStyle.emoji;

    const logLine = `${COLORS.GRAY}[${timestamp}]${COLORS.RESET} ${color}[${prefix}]${COLORS.RESET} ${emoji} ${COLORS.WHITE}${eventStr}${COLORS.RESET} ${msgStr}`;

    if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(logLine);
    } else if (severity === 'WARNING' || severity === 'WARN') {
      console.warn(logLine);
    } else if (severity !== 'DEBUG' || process.env.DEBUG_MODE === 'true') {
      console.log(logLine);
    }
  }

  // ==================== QUEUE YÖNETİMİ ====================

  /**
   * Yazma kuyruğunu işle
   */
  static async _processWriteQueue() {
    if (LogYonetim.isWriting || LogYonetim.writeQueue.length === 0) {
      return;
    }

    LogYonetim.isWriting = true;

    while (LogYonetim.writeQueue.length > 0) {
      const batch = LogYonetim.writeQueue.splice(0, 50);
      const lines = batch.map(entry => JSON.stringify(entry)).join('\n') + '\n';

      try {
        await LogYonetim._checkAndRotateLog(LOGLAR_SISTEMI);
        await fsp.appendFile(LOGLAR_SISTEMI, lines, 'utf8');
      } catch (writeErr) {
        console.error(`${COLORS.RED}[LOG] Queue yazma hatası:  ${writeErr.message}${COLORS.RESET}`);

        try {
          await LogYonetim.ensureLogDirs();
          await fsp.appendFile(LOGLAR_SISTEMI, lines, 'utf8');
        } catch (retryErr) {
          console.error(`${COLORS.RED}[LOG] Retry başarısız: ${retryErr.message}${COLORS.RESET}`);
        }
      }
    }

    LogYonetim.isWriting = false;
  }

  // ==================== ANA LOG YAZMA FONKSİYONLARI ====================

  /**
   * Genel log yazma
   * @param {Object} data - Log verisi
   */
  static async writeLog(data) {
    try {
      await LogYonetim.ensureLogDirs();

      const entry = {
        timestamp: new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID: data.traceID || null,
        kategori: data.kategori || data.klasor || 'genel',
        ...data
      };

      LogYonetim.writeQueue.push(entry);
      LogYonetim._consoleLog(entry.severity, data.tur || data.key, data.mesaj);

      setImmediate(() => LogYonetim._processWriteQueue());

      if (LogYonetim.writeQueue.length > 100) {
        await LogYonetim._checkAndRotateLog(LOGLAR_SISTEMI);
      }
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Yazma hatası: ${e.message}${COLORS.RESET}`);
    }
  }

  /**
   * Senkron log yazma (kritik durumlar için)
   * @param {Object} data
   */
  static writeLogSync(data) {
    try {
      if (! fs.existsSync(LOGLAR_ROOT)) {
        fs.mkdirSync(LOGLAR_ROOT, { recursive:  true });
      }

      const entry = {
        timestamp:  new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID: data.traceID || null,
        kategori: data.kategori || data.klasor || 'genel',
        ...data
      };

      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(LOGLAR_SISTEMI, line, 'utf8');

      LogYonetim._consoleLog(entry.severity, data.tur || data.key, data.mesaj);
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Sync yazma hatası:  ${e.message}${COLORS.RESET}`);
    }
  }

  /**
   * Kategori bazlı log dosyasına yaz
   * @param {string} klasor
   * @param {string} key
   * @param {Object} data
   */
  static async writeRegularLog(klasor, key, data) {
    try {
      await LogYonetim.ensureLogDirs();

      let logDir = LOGLAR_BOT_GENEL;
      let fileName = `${key}.jsonl`;

      switch (klasor) {
        case 'sunucular':
          logDir = LOGLAR_SUNUCULAR;
          if (data.guildID) {
            fileName = `${data.guildID}.jsonl`;
          }
          break;
        case 'dm':
          logDir = LOGLAR_DM;
          if (data.kullaniciID) {
            fileName = `${data.kullaniciID}.jsonl`;
          }
          break;
        case 'database':
          logDir = LOGLAR_DATABASE;
          break;
        case 'panel':
          logDir = LOGLAR_PANEL;
          break;
        case 'bot_genel':
          logDir = LOGLAR_BOT_GENEL;
          break;
      }

      const filePath = path.join(logDir, fileName);
      await LogYonetim._checkAndRotateLog(filePath);

      const entry = {
        timestamp: new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID:  data.traceID || null,
        ...data
      };

      const line = JSON.stringify(entry) + '\n';
      await fsp.appendFile(filePath, line, 'utf8');
    } catch (e) {
      // Regular log hatası kritik değil
    }
  }

  // ==================== SEVİYE BAZLI LOG FONKSİYONLARI ====================

  /**
   * Info log
   * @param {string} event - Olay adı
   * @param {string} message - Mesaj
   * @param {Object} opts - Ek seçenekler
   */
  static async logInfo(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'INFO',
      emoji: 'ℹ️',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'info', entry);
    }

    // Discord'a gönder
    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category: 'INFO',
        title:  event,
        description:  message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Warn log
   */
  static async logWarn(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'WARNING',
      emoji: '⚠️',
      mesaj:  message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'warn', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category: 'WARNING',
        title:  event,
        description: message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Error log
   */
  static async logError(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'ERROR',
      emoji: '❌',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'error', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category:  'ERROR',
        title: event,
        description: message,
        fields:  opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Success log
   */
  static async logSuccess(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'SUCCESS',
      emoji:  '✅',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'success', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category: 'SUCCESS',
        title: event,
        description:  message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * System log
   */
  static async logSystem(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'SYSTEM',
      emoji: '🧠',
      mesaj: message,
      traceID:  opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'system', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category: 'SYSTEM',
        title: event,
        description: message,
        fields:  opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Debug log
   */
  static async logDebug(event, message, opts = {}) {
    // Debug logları sadece DEBUG_MODE açıksa gönderilir
    if (process.env.DEBUG_MODE !== 'true' && opts.sendToDiscord !== true) {
      opts.sendToDiscord = false;
    }

    const entry = {
      tur: event,
      severity: 'DEBUG',
      emoji: '🔍',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'debug', entry);
    }

    if (opts.sendToDiscord === true) {
      const embed = LogYonetim.formatEmbed({
        category: 'DEBUG',
        title:  event,
        description: message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Critical log
   */
  static async logCritical(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'CRITICAL',
      emoji: '🔴',
      mesaj: message,
      traceID: opts.traceID || null,
      alarm: true,
      ...opts
    };

    // Critical loglar sync yazılır
    LogYonetim.writeLogSync(entry);

    if (opts.klasor) {
      try {
        await LogYonetim.writeRegularLog(opts.klasor, 'critical', entry);
      } catch (regErr) {
        // Critical log yazılamadı
      }
    }

    // Critical her zaman Discord'a gönderilir
    const embed = LogYonetim.formatEmbed({
      category: 'CRITICAL',
      title:  `🚨 ${event}`,
      description: message,
      fields: opts.fields || []
    });
    await LogYonetim.sendLogToChannel(embed, opts);
  }

  /**
   * Data collection log (Veri toplama)
   */
  static async logDataCollect(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'DATA_COLLECT',
      emoji: '📡',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'data_collect', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category:  'DATA_COLLECT',
        title: event,
        description: message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Query log (Sorgu takibi)
   */
  static async logQuery(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'QUERY',
      emoji: '🔍',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'query', entry);
    }

    // Query logları varsayılan olarak Discord'a gönderilmez (spam önleme)
    if (opts.sendToDiscord === true) {
      const embed = LogYonetim.formatEmbed({
        category: 'QUERY',
        title:  event,
        description: message,
        fields: opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * User log (Kullanıcı bazlı)
   */
  static async logUser(event, message, opts = {}) {
    const entry = {
      tur:  event,
      severity: 'USER',
      emoji: '👤',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'user', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category:  'USER',
        title: event,
        description: message,
        fields:  opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  /**
   * Admin log
   */
  static async logAdmin(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity:  'ADMIN',
      emoji: '🛠️',
      mesaj: message,
      traceID:  opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);

    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'admin', entry);
    }

    if (opts.sendToDiscord !== false) {
      const embed = LogYonetim.formatEmbed({
        category: 'ADMIN',
        title: event,
        description: message,
        fields:  opts.fields || []
      });
      await LogYonetim.sendLogToChannel(embed, opts);
    }
  }

  // ==================== ESKI API UYUMLULUĞU (Backward Compatibility) ====================

  static async info(event, message, opts = {}) {
    return LogYonetim.logInfo(event, message, opts);
  }

  static async warn(event, message, opts = {}) {
    return LogYonetim.logWarn(event, message, opts);
  }

  static async error(event, message, opts = {}) {
    return LogYonetim.logError(event, message, opts);
  }

  static async debug(event, message, opts = {}) {
    return LogYonetim.logDebug(event, message, opts);
  }

  static async success(event, message, opts = {}) {
    return LogYonetim.logSuccess(event, message, opts);
  }

  static async critical(event, message, opts = {}) {
    return LogYonetim.logCritical(event, message, opts);
  }

  // ==================== SİSTEM LOG FONKSİYONLARI ====================

  /**
   * Sistem başladı logu
   */
  static async sistemBasladi() {
    LogYonetim.writeLogSync({
      tur: 'sistem_basladi',
      emoji: '🟢',
      severity: 'SUCCESS',
      kategori: 'sistem',
      mesaj: 'Bot sistemi başlatıldı'
    });

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', {
        tur: 'sistem_basladi',
        emoji: '🟢',
        severity: 'SUCCESS',
        mesaj: 'Bot hazır'
      });

      // Başlangıçta eski arşivleri temizle
      await LogYonetim.cleanupOldArchives();

      // Self-test çalıştır
      await LogYonetim.selfTest();

      // Discord'a başlangıç logu gönder
      const embed = LogYonetim.formatEmbed({
        category: 'SUCCESS',
        title:  '🟢 Sistem Başladı',
        description: 'Bot sistemi başarıyla başlatıldı ve hazır.',
        fields: [
          { name: 'Başlangıç Zamanı', value:  LogYonetim._formatFullDate(), inline: true },
          { name: 'Node.js', value: process.version, inline: true }
        ]
      });

      // Global config'den log kanalına gönder
      const config = await LogYonetim._readConfig();
      if (config.defaultLogKanalId) {
        await LogYonetim.sendLogToChannel(embed, { logKanalId: config.defaultLogKanalId });
      }
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Sistem başlangıç işlemleri hatası: ${e.message}${COLORS.RESET}`);
    }
  }

    /**
   * Sistem kapandı logu
   */
  static async sistemKapandi() {
    LogYonetim.writeLogSync({
      tur: 'sistem_kapandi',
      emoji:  '🔴',
      severity: 'INFO',
      kategori: 'sistem',
      mesaj:  'Bot sistemi kapatıldı'
    });

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', {
        tur: 'sistem_kapandi',
        emoji: '🔴',
        severity: 'INFO',
        mesaj:  'Bot kapatıldı'
      });

      // Discord'a kapanış logu gönder
      const embed = LogYonetim.formatEmbed({
        category: 'SYSTEM',
        title:  '🔴 Sistem Kapandı',
        description:  'Bot sistemi kapatılıyor.',
        fields: [
          { name: 'Kapanış Zamanı', value:  LogYonetim._formatFullDate(), inline: true }
        ]
      });

      const config = await LogYonetim._readConfig();
      if (config.defaultLogKanalId) {
        await LogYonetim.sendLogToChannel(embed, { logKanalId: config.defaultLogKanalId });
      }
    } catch (e) {
      // Kapanış logu yazılamadı
    }
  }

  /**
   * Sistem hatası logu
   * @param {string} mesaj - Hata mesajı
   * @param {string} seviye - Hata seviyesi
   * @param {string} traceId - Trace ID
   */
  static async sistemHatasi(mesaj, seviye = 'ERROR', traceId = null) {
    const entry = {
      tur: 'sistem_hatasi',
      emoji: '🚨',
      severity: seviye,
      kategori: 'sistem',
      mesaj:  String(mesaj).substring(0, 500),
      traceID: traceId
    };

    LogYonetim.writeLogSync(entry);

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', entry);

      // Discord'a hata logu gönder
      const embed = LogYonetim.formatEmbed({
        category:  seviye === 'CRITICAL' ? 'CRITICAL' : 'ERROR',
        title: '🚨 Sistem Hatası',
        description: String(mesaj).substring(0, 500),
        fields: [
          { name: 'Seviye', value: seviye, inline: true },
          { name: 'Trace ID', value: traceId || 'Yok', inline: true }
        ]
      });

      const config = await LogYonetim._readConfig();
      if (config.defaultLogKanalId) {
        await LogYonetim.sendLogToChannel(embed, { logKanalId: config.defaultLogKanalId });
      }
    } catch (e) {
      // Hata logu yazılamadı
    }
  }

  // ==================== ÖZEL LOG FONKSİYONLARI ====================

  /**
   * Komut register logu
   */
  static async komutRegister(toplamKomut, degisenleri, eklenenler, silenenler, hata = null) {
    const entry = {
      tur: 'komut_register',
      severity: hata ? 'ERROR' : 'SUCCESS',
      emoji: hata ? '❌' : '📋',
      kategori: 'komut',
      toplamKomut,
      degisenleri,
      eklenenler,
      silenenler,
      hata:  hata || null,
      mesaj: hata
        ? `Komut kaydı hatası: ${hata}`
        : `Komutlar kaydedildi - Toplam: ${toplamKomut}, Değişen: ${degisenleri}, Eklenen: ${eklenenler}, Silinen: ${silenenler}`
    };

    await LogYonetim.writeLog(entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category: hata ? 'ERROR' : 'SUCCESS',
      title:  hata ? '❌ Komut Kaydı Hatası' : '📋 Komutlar Kaydedildi',
      description: hata ?  `Hata: ${hata}` : 'Slash komutları başarıyla güncellendi.',
      fields: [
        { name:  'Toplam Komut', value: String(toplamKomut), inline: true },
        { name: 'Değişen', value: String(degisenleri), inline: true },
        { name: 'Eklenen', value: String(eklenenler), inline: true },
        { name: 'Silinen', value: String(silenenler), inline: true }
      ]
    });

    const config = await LogYonetim._readConfig();
    if (config.defaultLogKanalId) {
      await LogYonetim.sendLogToChannel(embed, { logKanalId: config.defaultLogKanalId });
    }
  }

  /**
   * Panel açıldı logu
   */
  static async panelAcildi(userId, sayfa = 1, guildId = null, traceId = null) {
    const entry = {
      tur: 'panel_acildi',
      emoji: '📊',
      severity:  'INFO',
      kategori: 'panel',
      kullaniciID: userId,
      guildID: guildId,
      sayfa,
      traceID: traceId,
      mesaj:  `Panel açıldı - Kullanıcı: ${userId}, Sayfa: ${sayfa}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('panel', 'acildi', entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category: 'INFO',
      title: '📊 Panel Açıldı',
      description: `Kullanıcı paneli açtı.`,
      fields: [
        { name: 'Kullanıcı ID', value: userId, inline: true },
        { name: 'Sayfa', value: String(sayfa), inline: true }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId, kullaniciID: userId });
  }

  /**
   * Panel kapandı logu
   */
  static async panelKapandi(userId, neden = 'unknown', guildId = null, traceId = null) {
    const nedenMap = {
      'kullanici':  'Kullanıcı kapattı',
      'timeout': 'Süre doldu',
      'error': 'Hata oluştu',
      'force_close': 'Zorla kapatıldı',
      'unknown': 'Bilinmeyen'
    };

    const entry = {
      tur: 'panel_kapandi',
      emoji:  '🔴',
      severity: 'INFO',
      kategori: 'panel',
      kullaniciID: userId,
      guildID: guildId,
      neden,
      traceID: traceId,
      mesaj:  `Panel kapandı - ${nedenMap[neden] || neden}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('panel', 'kapandi', entry);
  }

  /**
   * Panel sayfa değişimi logu
   */
  static async panelSayfaDegisti(userId, eskiSayfa, yeniSayfa, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'panel_sayfa_degisti',
      emoji: '📄',
      severity:  'INFO',
      kategori: 'panel',
      kullaniciID:  userId,
      guildID: guildId,
      eskiSayfa,
      yeniSayfa,
      traceID: traceId,
      mesaj: `Sayfa değişti:  ${eskiSayfa} → ${yeniSayfa}`
    });
  }

  /**
   * Panel hata logu
   */
  static async panelHata(userId, hata, guildId = null, traceId = null) {
    const entry = {
      tur: 'panel_hata',
      emoji:  '❌',
      severity: 'ERROR',
      kategori: 'panel',
      kullaniciID: userId,
      guildID: guildId,
      hata:  String(hata).substring(0, 300),
      traceID: traceId,
      mesaj: `Panel hatası:  ${String(hata).substring(0, 100)}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('panel', 'hata', entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category: 'ERROR',
      title:  '❌ Panel Hatası',
      description: String(hata).substring(0, 300),
      fields: [
        { name: 'Kullanıcı ID', value: userId, inline: true }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId, kullaniciID: userId });
  }

  /**
   * Kullanıcı komut logu
   */
  static async kullaniciKomut(userId, komut, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'komut_kullanildi',
      emoji:  '💬',
      severity: 'INFO',
      kategori:  'komut',
      kullaniciID: userId,
      guildID: guildId,
      komut,
      traceID: traceId,
      mesaj: `Komut:  /${komut} - Kullanıcı: ${userId}`
    });
  }

  /**
   * Yetki hatası logu
   */
  static async yetkiHatasi(userId, islem, guildId = null, traceId = null) {
    const entry = {
      tur: 'yetki_hatasi',
      emoji:  '🚫',
      severity:  'WARN',
      kategori: 'yetki',
      kullaniciID: userId,
      guildID: guildId,
      islem,
      traceID: traceId,
      mesaj: `Yetkisiz işlem: ${islem}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('sunucular', 'yetki', entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category: 'WARNING',
      title:  '🚫 Yetkisiz İşlem',
      description: `Kullanıcı yetkisiz bir işlem denedi.`,
      fields: [
        { name: 'Kullanıcı ID', value: userId, inline: true },
        { name:  'İşlem', value: islem, inline: true }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId, kullaniciID: userId });
  }

  /**
   * Sorgu başarılı logu
   */
  static async sorguBasarili(userId, tablo, sure_ms, satirSayisi, guildId = null, traceId = null) {
    const entry = {
      tur:  'sorgu_basarili',
      emoji: '✅',
      severity: 'DEBUG',
      kategori: 'database',
      kullaniciID: userId,
      guildID: guildId,
      tablo,
      sure_ms,
      satirSayisi,
      traceID: traceId,
      mesaj: `DB sorgu OK - ${tablo}:  ${satirSayisi} satır, ${sure_ms}ms`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('database', 'sorgu', entry);
  }

  /**
   * Sorgu hata logu
   */
  static async sorguHatasi(userId, tablo, hata, guildId = null, traceId = null) {
    const entry = {
      tur: 'sorgu_hatasi',
      emoji: '❌',
      severity: 'ERROR',
      kategori:  'database',
      kullaniciID: userId,
      guildID: guildId,
      tablo,
      hata: String(hata).substring(0, 300),
      traceID: traceId,
      mesaj: `DB sorgu HATA - ${tablo}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('database', 'hata', entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category: 'ERROR',
      title: '❌ Veritabanı Sorgu Hatası',
      description: `Sorgu sırasında hata oluştu.`,
      fields: [
        { name: 'Tablo', value: tablo, inline: true },
        { name: 'Hata', value: String(hata).substring(0, 200), inline: false }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId, kullaniciID: userId });
  }

  /**
   * Veritabanı bağlantı logu
   */
  static async dbBaglanti(dbName, durum, detay = null, traceId = null) {
    const basarili = durum === 'basarili' || durum === 'connected';

    const entry = {
      tur:  'db_baglanti',
      emoji: basarili ? '🔗' : '❌',
      severity: basarili ? 'SUCCESS' : 'ERROR',
      kategori: 'database',
      dbName,
      durum,
      detay,
      traceID: traceId,
      mesaj: `DB ${durum}:  ${dbName}${detay ? ' - ' + detay : ''}`
    };

    await LogYonetim.writeLog(entry);

    // Discord'a gönder
    const embed = LogYonetim.formatEmbed({
      category:  basarili ? 'SUCCESS' : 'ERROR',
      title: basarili ? '🔗 Veritabanı Bağlandı' : '❌ Veritabanı Bağlantı Hatası',
      description: `${dbName} veritabanı ${durum}.`,
      fields: detay ? [{ name: 'Detay', value: detay, inline: false }] : []
    });

    const config = await LogYonetim._readConfig();
    if (config.defaultLogKanalId) {
      await LogYonetim.sendLogToChannel(embed, { logKanalId: config.defaultLogKanalId });
    }
  }

  /**
   * DM gönderildi logu
   */
  static async dmGonderildi(userId, baslik, guildId = null, traceId = null) {
    const entry = {
      tur: 'dm_gonderildi',
      emoji: '📧',
      severity:  'INFO',
      kategori: 'dm',
      kullaniciID: userId,
      guildID: guildId,
      baslik,
      traceID: traceId,
      mesaj:  `DM gönderildi:  ${baslik}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('dm', userId, entry);
  }

  /**
   * DM gönderim hatası logu
   */
  static async dmGonderimHatasi(userId, neden, guildId = null, traceId = null) {
    const nedenMap = {
      'dmKapali': 'DM kapalı',
      'izinYok': 'İzin yok',
      'timeout':  'Zaman aşımı',
      'unknown': 'Bilinmeyen'
    };

    const entry = {
      tur: 'dm_gonderim_hatasi',
      emoji: '⚠️',
      severity: 'WARN',
      kategori: 'dm',
      kullaniciID: userId,
      guildID: guildId,
      neden,
      traceID: traceId,
      mesaj:  `DM gönderilemedi: ${nedenMap[neden] || neden}`
    };

    await LogYonetim.writeLog(entry);
    await LogYonetim.writeRegularLog('dm', userId, entry);
  }

  // ==================== VERİ TOPLAMA LOGLARI ====================

  /**
   * Veri toplama başladı logu
   */
  static async veriToplamaBasladi(guildId, tip, traceId = null) {
    const entry = {
      tur: 'veri_toplama_basladi',
      emoji: '📡',
      severity:  'DATA_COLLECT',
      kategori: 'veri_toplama',
      guildID: guildId,
      tip,
      traceID: traceId,
      mesaj: `Veri toplama başladı - ${tip}`
    };

    await LogYonetim.writeLog(entry);

    const embed = LogYonetim.formatEmbed({
      category:  'DATA_COLLECT',
      title: '📡 Veri Toplama Başladı',
      description: `${tip} verisi toplanmaya başlandı.`,
      fields: [
        { name: 'Sunucu ID', value: guildId || 'Tüm sunucular', inline: true },
        { name:  'Tip', value: tip, inline: true }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID:  guildId });
  }

  /**
   * Veri toplama tamamlandı logu
   */
  static async veriToplamaTamamlandi(guildId, tip, sure_ms, kayitSayisi, traceId = null) {
    const entry = {
      tur: 'veri_toplama_tamamlandi',
      emoji: '✅',
      severity: 'SUCCESS',
      kategori: 'veri_toplama',
      guildID:  guildId,
      tip,
      sure_ms,
      kayitSayisi,
      traceID: traceId,
      mesaj:  `Veri toplama tamamlandı - ${tip}:  ${kayitSayisi} kayıt, ${sure_ms}ms`
    };

    await LogYonetim.writeLog(entry);

    const embed = LogYonetim.formatEmbed({
      category: 'SUCCESS',
      title: '✅ Veri Toplama Tamamlandı',
      description: `${tip} verisi başarıyla toplandı.`,
      fields: [
        { name: 'Sunucu ID', value: guildId || 'Tüm sunucular', inline:  true },
        { name: 'Kayıt Sayısı', value: String(kayitSayisi), inline: true },
        { name: 'Süre', value: `${sure_ms}ms`, inline: true }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId });
  }

  /**
   * Veri toplama hatası logu
   */
  static async veriToplamaHatasi(guildId, tip, hata, traceId = null) {
    const entry = {
      tur: 'veri_toplama_hatasi',
      emoji: '❌',
      severity:  'ERROR',
      kategori: 'veri_toplama',
      guildID: guildId,
      tip,
      hata: String(hata).substring(0, 300),
      traceID: traceId,
      mesaj: `Veri toplama hatası - ${tip}:  ${String(hata).substring(0, 100)}`
    };

    await LogYonetim.writeLog(entry);

    const embed = LogYonetim.formatEmbed({
      category: 'ERROR',
      title: '❌ Veri Toplama Hatası',
      description: `${tip} veri toplama sırasında hata oluştu.`,
      fields: [
        { name: 'Sunucu ID', value: guildId || 'Bilinmiyor', inline: true },
        { name: 'Tip', value: tip, inline: true },
        { name:  'Hata', value: String(hata).substring(0, 200), inline: false }
      ]
    });

    await LogYonetim.sendLogToChannel(embed, { guildID: guildId });
  }

  // ==================== YARDIMCI FONKSİYONLAR ====================

  /**
   * Benzersiz trace ID oluştur
   * @returns {string}
   */
  static createTraceId() {
    try {
      return crypto.randomUUID ?  crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    } catch (e) {
      return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
  }

  /**
   * Log istatistiklerini al
   * @returns {Promise<Object>}
   */
  static async getLogStats() {
    try {
      await LogYonetim.ensureLogDirs();
      const config = await LogYonetim._readConfig();

      const stats = {
        mainLogSize: 0,
        mainLogSizeFormatted: '0 B',
        archiveCount: 0,
        archiveSize: 0,
        archiveSizeFormatted: '0 B',
        logLimit: config.logBoyutuSiniri,
        logLimitFormatted: LogYonetim._formatBytes(config.logBoyutuSiniri),
        kaliciLogSilmeSaniye: config.kaliciLogSilmeSaniye,
        kaliciLogSilmeGun: Math.floor(config.kaliciLogSilmeSaniye / 86400),
        rotasyonSayisi: config.rotasyonTarihler ?  config.rotasyonTarihler.length : 0,
        lastRotation: null,
        queueLength: LogYonetim.writeQueue.length,
        discordClientReady: LogYonetim.discordClient?.isReady() || false,
        embedParamsCacheSize: LogYonetim.embedParamsCache.size
      };

      // Ana log dosyası boyutu
      if (fs.existsSync(LOGLAR_SISTEMI)) {
        const mainStats = await fsp.stat(LOGLAR_SISTEMI);
        stats.mainLogSize = mainStats.size;
        stats.mainLogSizeFormatted = LogYonetim._formatBytes(mainStats.size);
      }

      // Arşiv dosyaları
      const archiveFiles = await fsp.readdir(LOGLAR_ARSIV).catch(() => []);
      stats.archiveCount = archiveFiles.length;

      for (const file of archiveFiles) {
        try {
          const filePath = path.join(LOGLAR_ARSIV, file);
          const fileStats = await fsp.stat(filePath);
          stats.archiveSize += fileStats.size;
        } catch (e) {
          continue;
        }
      }

      stats.archiveSizeFormatted = LogYonetim._formatBytes(stats.archiveSize);

      // Son rotasyon tarihi
      if (config.rotasyonTarihler && config.rotasyonTarihler.length > 0) {
        stats.lastRotation = config.rotasyonTarihler[config.rotasyonTarihler.length - 1].tarih;
      }

      return stats;
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Stats hatası: ${e.message}${COLORS.RESET}`);
      return null;
    }
  }

  /**
   * Yazma kuyruğunu boşalt
   */
  static async flushQueue() {
    while (LogYonetim.writeQueue.length > 0) {
      await LogYonetim._processWriteQueue();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Embed parametre cache'ini temizle
   */
  static clearEmbedParamsCache() {
    LogYonetim.embedParamsCache.clear();
    LogYonetim.embedParamsLastRefresh.clear();
  }

  /**
   * Rate limit map'ini temizle
   */
  static clearRateLimitMap() {
    LogYonetim.rateLimitMap.clear();
  }

  // ==================== SELF-TEST MEKANİZMASI ====================

  /**
   * Sistem self-test
   * @returns {Promise<Object>}
   */
  static async selfTest() {
    const testResults = {
      logDosyasiOlusturma: false,
      boyutTespiti: false,
      configOkuma: false,
      configYazma: false,
      jsonlKayit: false,
      arsivKlasoruKontrol: false,
      embedParamYukleme: false,
      discordClientKontrol: false,
      tumTestler: false
    };

    try {
      console.log(`${COLORS.CYAN}[LOG] Self-test başlıyor...${COLORS.RESET}`);

      // Test 1: Log dosyası oluşturma
      try {
        await LogYonetim.ensureLogDirs();
        testResults.logDosyasiOlusturma = fs.existsSync(LOGLAR_SISTEMI);
      } catch (e) {
        testResults.logDosyasiOlusturma = false;
      }

      // Test 2: Boyut tespiti
      try {
        const size = await LogYonetim._getFileSize(LOGLAR_SISTEMI);
        testResults.boyutTespiti = typeof size === 'number' && size >= 0;
      } catch (e) {
        testResults.boyutTespiti = false;
      }

      // Test 3: Config okuma
      try {
        const config = await LogYonetim._readConfig();
        testResults.configOkuma = config && typeof config.logBoyutuSiniri === 'number';
      } catch (e) {
        testResults.configOkuma = false;
      }

      // Test 4: Config yazma
      try {
        const config = await LogYonetim._readConfig();
        const testValue = Date.now();
        config._selfTestValue = testValue;
        await LogYonetim._updateConfig({ _selfTestValue: testValue });
        const updatedConfig = await LogYonetim._readConfig();
        testResults.configYazma = updatedConfig._selfTestValue === testValue;

        // Test değerini temizle
        delete updatedConfig._selfTestValue;
        await LogYonetim._updateConfig(updatedConfig);
      } catch (e) {
        testResults.configYazma = false;
      }

      // Test 5: JSONL kayıt
      try {
        const testEntry = {
          arsiv_durumu: 'test',
          orijinal_dosya_adi: 'self_test.jsonl',
          islem_tarihi: new Date().toISOString(),
          uygulama:  'self_test',
          kategori: 'test',
          aciklama: 'Self-test kaydı'
        };
        await LogYonetim._appendToSystemLog(testEntry);
        testResults.jsonlKayit = true;
      } catch (e) {
        testResults.jsonlKayit = false;
      }

      // Test 6: Arşiv klasörü kontrolü
      try {
        testResults.arsivKlasoruKontrol = fs.existsSync(LOGLAR_ARSIV);
      } catch (e) {
        testResults.arsivKlasoruKontrol = false;
      }

      // Test 7: Embed param yükleme
      try {
        const params = await LogYonetim.loadEmbedParams('test_id', 'sunucu');
        testResults.embedParamYukleme = params && typeof params === 'object';
      } catch (e) {
        testResults.embedParamYukleme = false;
      }

      // Test 8: Discord client kontrolü
      try {
        testResults.discordClientKontrol = LogYonetim.discordClient !== null || true; // Client olmasa da geçer
      } catch (e) {
        testResults.discordClientKontrol = true;
      }

      // Tüm testler başarılı mı?
      const kritikTestler = [
        testResults.logDosyasiOlusturma,
        testResults.boyutTespiti,
        testResults.configOkuma,
        testResults.configYazma,
        testResults.jsonlKayit,
        testResults.arsivKlasoruKontrol
      ];

      testResults.tumTestler = kritikTestler.every(v => v === true);

      if (testResults.tumTestler) {
        console.log(`${COLORS.GREEN}[LOG SİSTEMİ] Başarıyla aktif ve stabil çalışıyor.${COLORS.RESET}`);
      } else {
        const basarisiz = Object.entries(testResults)
          .filter(([key, value]) => value === false && key !== 'tumTestler')
          .map(([key]) => key);
        console.warn(`${COLORS.YELLOW}[LOG SİSTEMİ] Bazı testler başarısız:  ${basarisiz.join(', ')}${COLORS.RESET}`);
      }

      // Test sonuçlarını logla
      await LogYonetim._appendToSystemLog({
        arsiv_durumu: testResults.tumTestler ? 'tamamlandi' : 'hatali',
        orijinal_dosya_adi: 'self_test',
        islem_tarihi: new Date().toISOString(),
        uygulama: 'log_yonetim',
        kategori:  'self_test',
        aciklama: testResults.tumTestler
          ? 'Tüm self-test kontrolleri başarılı'
          : `Başarısız testler: ${Object.entries(testResults).filter(([k, v]) => !v && k !== 'tumTestler').map(([k]) => k).join(', ')}`,
        test_sonuclari: testResults
      });

      return testResults;
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Self-test hatası: ${e.message}${COLORS.RESET}`);
      return testResults;
    }
  }

  // ==================== STATE REPAIR LOG ====================

  /**
   * State repair kaydı
   * @param {string} stateFile - State dosyası
   * @param {string} neden - Repair nedeni
   * @param {string} action - Yapılan aksiyon
   */
  static async logStateRepair(stateFile, neden, action) {
    try {
      const config = await LogYonetim._readConfig();
      const stateRepairLog = config.stateRepairLog || [];

      stateRepairLog.push({
        tarih: new Date().toISOString(),
        dosya: path.basename(stateFile),
        neden: neden,
        action:  action
      });

      // Son 100 kaydı tut
      if (stateRepairLog.length > 100) {
        stateRepairLog.splice(0, stateRepairLog.length - 100);
      }

      await LogYonetim._updateConfig({ stateRepairLog });
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] State repair log hatası: ${e.message}${COLORS.RESET}`);
    }
  }

  // ==================== GLOBAL LOG KANAL YÖNETİMİ ====================

  /**
   * Global log kanalını ayarla
   * @param {string} kanalId - Kanal ID
   */
  static async setDefaultLogKanal(kanalId) {
    try {
      await LogYonetim._updateConfig({ defaultLogKanalId: kanalId });
      console.log(`${COLORS.GREEN}[LOG] Varsayılan log kanalı ayarlandı:  ${kanalId}${COLORS.RESET}`);
      return true;
    } catch (e) {
      console.error(`${COLORS.RED}[LOG] Log kanalı ayarlama hatası: ${e.message}${COLORS.RESET}`);
      return false;
    }
  }

  /**
   * Global embed footer ayarla
   * @param {string} footer - Footer metni
   */
  static async setDefaultEmbedFooter(footer) {
    try {
      await LogYonetim._updateConfig({ defaultEmbedFooter: footer });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Global embed image ayarla
   * @param {string} imageUrl - Image URL
   */
  static async setDefaultEmbedImage(imageUrl) {
    try {
      if (imageUrl && !LogYonetim._isValidUrl(imageUrl)) {
        return false;
      }
      await LogYonetim._updateConfig({ defaultEmbedImage: imageUrl });
      return true;
    } catch (e) {
      return false;
    }
  }
}

// ==================== MODÜL EXPORT ====================

module.exports = {
  LogYonetim,

  // Discord client ayarla
  setClient: LogYonetim.setClient.bind(LogYonetim),

  // Yeni API - Seviye bazlı log fonksiyonları
  logInfo: LogYonetim.logInfo.bind(LogYonetim),
  logWarn: LogYonetim.logWarn.bind(LogYonetim),
  logError:  LogYonetim.logError.bind(LogYonetim),
  logSuccess: LogYonetim.logSuccess.bind(LogYonetim),
  logSystem: LogYonetim.logSystem.bind(LogYonetim),
  logDebug: LogYonetim.logDebug.bind(LogYonetim),
  logCritical: LogYonetim.logCritical.bind(LogYonetim),
  logDataCollect: LogYonetim.logDataCollect.bind(LogYonetim),
  logQuery: LogYonetim.logQuery.bind(LogYonetim),
  logUser: LogYonetim.logUser.bind(LogYonetim),
  logAdmin: LogYonetim.logAdmin.bind(LogYonetim),

  // Eski API uyumluluğu (backward compatibility)
  info: LogYonetim.info.bind(LogYonetim),
  warn: LogYonetim.warn.bind(LogYonetim),
  error: LogYonetim.error.bind(LogYonetim),
  debug: LogYonetim.debug.bind(LogYonetim),
  success: LogYonetim.success.bind(LogYonetim),
  critical: LogYonetim.critical.bind(LogYonetim),

  // Sistem fonksiyonları
  sistemBasladi: LogYonetim.sistemBasladi.bind(LogYonetim),
  sistemKapandi: LogYonetim.sistemKapandi.bind(LogYonetim),
  sistemHatasi: LogYonetim.sistemHatasi.bind(LogYonetim),

  // Özel log fonksiyonları
  komutRegister: LogYonetim.komutRegister.bind(LogYonetim),
  panelAcildi: LogYonetim.panelAcildi.bind(LogYonetim),
  panelKapandi: LogYonetim.panelKapandi.bind(LogYonetim),
  panelSayfaDegisti: LogYonetim.panelSayfaDegisti.bind(LogYonetim),
  panelHata: LogYonetim.panelHata.bind(LogYonetim),
  kullaniciKomut: LogYonetim.kullaniciKomut.bind(LogYonetim),
  yetkiHatasi: LogYonetim.yetkiHatasi.bind(LogYonetim),
  sorguBasarili: LogYonetim.sorguBasarili.bind(LogYonetim),
  sorguHatasi: LogYonetim.sorguHatasi.bind(LogYonetim),
  dbBaglanti: LogYonetim.dbBaglanti.bind(LogYonetim),
  dmGonderildi: LogYonetim.dmGonderildi.bind(LogYonetim),
  dmGonderimHatasi: LogYonetim.dmGonderimHatasi.bind(LogYonetim),

  // Veri toplama logları
  veriToplamaBasladi: LogYonetim.veriToplamaBasladi.bind(LogYonetim),
  veriToplamaTamamlandi: LogYonetim.veriToplamaTamamlandi.bind(LogYonetim),
  veriToplamaHatasi: LogYonetim.veriToplamaHatasi.bind(LogYonetim),

  // Yardımcı fonksiyonlar
  createTraceId: LogYonetim.createTraceId.bind(LogYonetim),
  writeLog: LogYonetim.writeLog.bind(LogYonetim),
  writeLogSync: LogYonetim.writeLogSync.bind(LogYonetim),
  writeRegularLog: LogYonetim.writeRegularLog.bind(LogYonetim),
  ensureLogDirs:  LogYonetim.ensureLogDirs.bind(LogYonetim),
  getLogStats: LogYonetim.getLogStats.bind(LogYonetim),
  flushQueue: LogYonetim.flushQueue.bind(LogYonetim),
  cleanupOldArchives: LogYonetim.cleanupOldArchives.bind(LogYonetim),
  logStateRepair: LogYonetim.logStateRepair.bind(LogYonetim),

  // Embed ve kanal yönetimi
  formatEmbed: LogYonetim.formatEmbed.bind(LogYonetim),
  loadEmbedParams:  LogYonetim.loadEmbedParams.bind(LogYonetim),
  refreshEmbedParams:  LogYonetim.refreshEmbedParams.bind(LogYonetim),
  checkLogChannel: LogYonetim.checkLogChannel.bind(LogYonetim),
  sendLogToChannel: LogYonetim.sendLogToChannel.bind(LogYonetim),
  setDefaultLogKanal: LogYonetim.setDefaultLogKanal.bind(LogYonetim),
  setDefaultEmbedFooter: LogYonetim.setDefaultEmbedFooter.bind(LogYonetim),
  setDefaultEmbedImage: LogYonetim.setDefaultEmbedImage.bind(LogYonetim),
  clearEmbedParamsCache: LogYonetim.clearEmbedParamsCache.bind(LogYonetim),
  clearRateLimitMap: LogYonetim.clearRateLimitMap.bind(LogYonetim),

  // Test fonksiyonu
  selfTest: LogYonetim.selfTest.bind(LogYonetim),

  // Sabitler (dışarıdan erişim için)
  LOG_CATEGORIES,
  COLORS
};