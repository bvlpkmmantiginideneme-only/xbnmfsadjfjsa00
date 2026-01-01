// dbmanager.js
// Enterprise Veritabanı Yöneticisi - TAM VE EKSİKSİZ
// Çoklu DB desteği, mysql2/promise, pool yönetimi, retry & queue sistemi
// Stabil, güvenli, üretim ortamına hazır
// v2.0 - ENV reload, akıllı pattern kontrolü, gelişmiş loglama

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const EventEmitter = require('events');

// ==================== CONSOLE RENK KODLARI ====================

const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN:  '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_CYAN: '\x1b[96m',
  BOLD: '\x1b[1m'
};

// ==================== VARSAYILAN SQL GÜVENLİK PATTERNLERİ ====================

/**
 * Varsayılan tehlikeli SQL pattern'leri
 * Bu pattern'ler registerDatabase() veya setSecurityPatterns() ile değiştirilebilir
 */
const DEFAULT_DANGEROUS_PATTERNS = [
  /DROP\s+DATABASE/i,
  /DROP\s+TABLE\s+\w+\s*$/i,
  /DELETE\s+FROM\s+\w+\s*$/i,
  /TRUNCATE\s+TABLE/i,
  /ALTER\s+TABLE\s+\w+\s+DROP/i,
  /EXEC\s*\(/i,
  /EXECUTE\s*\(/i,
  /xp_cmdshell/i,
  /sp_executesql/i
];

/**
 * Varsayılan SQL injection pattern'leri
 * Bu pattern'ler registerDatabase() veya setSecurityPatterns() ile değiştirilebilir
 */
const DEFAULT_INJECTION_PATTERNS = [
  /('\s*OR\s*'?\d*\s*=\s*'?\d*)/i,
  /('\s*OR\s*'[^']*'\s*=\s*'[^']*')/i,
  /(;\s*DROP)/i,
  /(;\s*DELETE\s+FROM)/i,
  /(;\s*UPDATE\s+\w+\s+SET)/i,
  /(;\s*INSERT\s+INTO)/i,
  /(UNION\s+SELECT)/i,
  /(UNION\s+ALL\s+SELECT)/i,
  /(--).*$/i,
  /(\/\*.*\*\/)/i
];

// ==================== DATABASE MANAGER CLASS ====================

class DatabaseManager extends EventEmitter {
  /**
   * DatabaseManager constructor
   * @param {Object} logger - Opsiyonel logger nesnesi (info, warn, error, debug, critical, success metotları)
   * @param {Object} options - Opsiyonel yapılandırma seçenekleri
   * @param {Array<RegExp>} options.dangerousPatterns - Özel tehlikeli SQL pattern'leri
   * @param {Array<RegExp>} options.injectionPatterns - Özel SQL injection pattern'leri
   * @param {boolean} options.enablePatternValidation - Pattern doğrulamasını etkinleştir/devre dışı bırak (varsayılan: true)
   */
  constructor(logger = null, options = {}) {
    super();

    this.logger = logger || this._createDefaultLogger();
    this.pools = new Map();
    this.queryQueues = new Map();
    this.processingQueues = new Map();
    this.poolStats = new Map();
    this.isDisabled = false;
    this.disableReason = null;

    // Healthcheck interval referansı (temizlik için)
    this._healthCheckInterval = null;

    // ENV'den parametreleri oku
    this.config = this._loadConfigFromEnv();

    // Güvenlik pattern'lerini yapılandır
    this._configureSecurityPatterns(options);

    // Pattern doğrulama aktif mi?
    this.enablePatternValidation = options.enablePatternValidation !== false;

    // Global istatistikler
    this.globalStats = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      totalRetries: 0,
      totalConnections: 0,
      poolErrors: 0,
      queueOverflows: 0,
      injectionBlocks: 0,
      dangerousQueryBlocks: 0,
      startTime: Date.now()
    };

    // Periyodik sağlık kontrolü başlat
    this._startHealthCheck();
  }

  // ==================== GÜVENLİK PATTERN YÖNETİMİ ====================

  /**
   * Güvenlik pattern'lerini yapılandırır
   * @param {Object} options - Pattern yapılandırma seçenekleri
   * @private
   */
  _configureSecurityPatterns(options) {
    // Tehlikeli pattern'leri ayarla (özel veya varsayılan)
    if (Array.isArray(options.dangerousPatterns) && options.dangerousPatterns.length > 0) {
      this.dangerousPatterns = options.dangerousPatterns.filter(p => p instanceof RegExp);
    } else {
      this.dangerousPatterns = [...DEFAULT_DANGEROUS_PATTERNS];
    }

    // Injection pattern'lerini ayarla (özel veya varsayılan)
    if (Array.isArray(options.injectionPatterns) && options.injectionPatterns.length > 0) {
      this.injectionPatterns = options.injectionPatterns.filter(p => p instanceof RegExp);
    } else {
      this.injectionPatterns = [...DEFAULT_INJECTION_PATTERNS];
    }
  }

  /**
   * Güvenlik pattern'lerini runtime'da günceller
   * @param {Object} patterns - Yeni pattern yapılandırması
   * @param {Array<RegExp>} patterns.dangerous - Tehlikeli SQL pattern'leri
   * @param {Array<RegExp>} patterns.injection - SQL injection pattern'leri
   * @returns {Object} Güncellenmiş pattern sayıları
   */
  setSecurityPatterns(patterns = {}) {
    const result = {
      previousDangerousCount: this.dangerousPatterns.length,
      previousInjectionCount: this.injectionPatterns.length,
      newDangerousCount: 0,
      newInjectionCount: 0,
      updated: false
    };

    if (Array.isArray(patterns.dangerous)) {
      const validPatterns = patterns.dangerous.filter(p => p instanceof RegExp);
      if (validPatterns.length > 0) {
        this.dangerousPatterns = validPatterns;
        result.newDangerousCount = validPatterns.length;
        result.updated = true;
      }
    }

    if (Array.isArray(patterns.injection)) {
      const validPatterns = patterns.injection.filter(p => p instanceof RegExp);
      if (validPatterns.length > 0) {
        this.injectionPatterns = validPatterns;
        result.newInjectionCount = validPatterns.length;
        result.updated = true;
      }
    }

    if (result.updated) {
      this._consoleLog('info', null, `Güvenlik pattern'leri güncellendi - Tehlikeli:  ${result.newDangerousCount}, Injection: ${result.newInjectionCount}`);

      this.logger.info('security_patterns_updated', 'Güvenlik pattern\'leri güncellendi', {
        klasor: 'database',
        key: 'security',
        oncekiTehlikeli: result.previousDangerousCount,
        yeniTehlikeli:  result.newDangerousCount,
        oncekiInjection: result.previousInjectionCount,
        yeniInjection: result.newInjectionCount
      }).catch(() => {});
    }

    return result;
  }

  /**
   * Pattern doğrulamasını etkinleştirir veya devre dışı bırakır
   * @param {boolean} enabled - Etkin durumu
   */
  setPatternValidation(enabled) {
    this.enablePatternValidation = !!enabled;
    this._consoleLog('info', null, `Pattern doğrulama:  ${this.enablePatternValidation ?  'etkin' : 'devre dışı'}`);
  }

  /**
   * Mevcut güvenlik pattern'lerini döndürür
   * @returns {Object} Pattern dizileri
   */
  getSecurityPatterns() {
    return {
      dangerous: [...this.dangerousPatterns],
      injection: [...this.injectionPatterns],
      validationEnabled: this.enablePatternValidation
    };
  }

  // ==================== CONFIG YÖNETİMİ ====================

  /**
   * ENV değişkenlerinden yapılandırmayı yükler
   * @returns {Object} Yapılandırma nesnesi
   * @private
   */
  _loadConfigFromEnv() {
    return {
      kuyrukMaksBoyutu: this._parseEnvInt('DB_KUYRUK_MAKS_BOYUTU', 1000),
      yenidenDenemeSayisi: this._parseEnvInt('DB_YENIDEN_DENEME_SAYISI', 3),
      yenidenGecikmeMs: this._parseEnvInt('DB_YENIDEN_DENEME_GECIKME_MS', 1000),
      maksBaglanti: this._parseEnvInt('DB_MAKS_BAGLANTI', 20),
      bostaZamanAsimi: this._parseEnvInt('DB_BOSTA_ZAMAN_ASIMI', 30000),
      maksYenidenBaglanti: this._parseEnvInt('DB_MAKS_YENIDEN_BAGLANTI', 5),
      zamanAsimi: this._parseEnvInt('DB_ZAMAN_ASIMI', 30) * 1000,
      timeoutYenilemeSaniye: this._parseEnvInt('DB_TIMEOUT_YENILEME_SANIYE', 30),
      cokluSqlIfade: this._parseEnvBool('MULTIPLESTATEMENTS', true),
      // Healthcheck frekansı (dakika cinsinden, varsayılan 5 dakika)
      healthCheckFrequencyMs: this._parseEnvInt('DB_HEALTHCHECK_FREQUENCY_MINUTES', 5) * 60 * 1000
    };
  }

  /**
   * ENV değerlerini runtime'da yeniden yükler
   * @returns {Object} Eski ve yeni yapılandırma karşılaştırması
   */
  reloadConfig() {
    const oldConfig = { ...this.config };
    this.config = this._loadConfigFromEnv();

    const changes = {};
    let hasChanges = false;

    // Değişiklikleri tespit et
    for (const key of Object.keys(this.config)) {
      if (oldConfig[key] !== this.config[key]) {
        changes[key] = {
          old: oldConfig[key],
          new:  this.config[key]
        };
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this._consoleLog('info', null, 'ENV yapılandırması yeniden yüklendi');

      this.logger.info('config_reloaded', 'ENV yapılandırması yeniden yüklendi', {
        klasor:  'database',
        key: 'config',
        degisiklikler: changes
      }).catch(() => {});

      // Healthcheck frekansı değiştiyse interval'i yeniden başlat
      if (changes.healthCheckFrequencyMs) {
        this._restartHealthCheck();
      }

      this.emit('config: reloaded', { oldConfig, newConfig: this.config, changes });
    }

    return {
      hasChanges,
      changes,
      currentConfig: { ...this.config }
    };
  }

  /**
   * Healthcheck interval'ini yeniden başlatır
   * @private
   */
  _restartHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
    this._startHealthCheck();
  }

  /**
   * ENV string değerini integer olarak parse eder
   * @param {string} key - ENV değişken adı
   * @param {number} defaultValue - Varsayılan değer
   * @returns {number} Parse edilmiş değer
   * @private
   */
  _parseEnvInt(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * ENV string değerini boolean olarak parse eder
   * @param {string} key - ENV değişken adı
   * @param {boolean} defaultValue - Varsayılan değer
   * @returns {boolean} Parse edilmiş değer
   * @private
   */
  _parseEnvBool(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    const str = String(value).toLowerCase().trim();
    return str === '1' || str === 'true' || str === 'yes' || str === 'evet';
  }

  /**
   * Varsayılan logger nesnesi oluşturur (no-op)
   * @returns {Object} Logger nesnesi
   * @private
   */
  _createDefaultLogger() {
    const noop = async () => {};
    return {
      info:  noop,
      warn: noop,
      error: noop,
      debug: noop,
      critical: noop,
      success: noop,
      dbBaglanti: noop,
      sorguBasarili: noop,
      sorguHatasi: noop
    };
  }

  // ==================== ZAMAN FORMATLAMA ====================

  /**
   * Şu anki zamanı HH:MM:SS formatında döndürür
   * @returns {string} Formatlanmış zaman
   * @private
   */
  _formatTimestamp() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  /**
   * Renkli konsol log mesajı yazar
   * @param {string} level - Log seviyesi (success, warn, error, info)
   * @param {string|null} dbName - Veritabanı etiketi
   * @param {string} message - Log mesajı
   * @private
   */
  _consoleLog(level, dbName, message) {
    const timestamp = this._formatTimestamp();
    const dbStr = dbName ? `[${dbName}]` : '';

    let color = COLORS.WHITE;
    let prefix = 'INFO';

    switch (level) {
      case 'success':
        color = COLORS.BRIGHT_GREEN;
        prefix = 'OK';
        break;
      case 'warn':
        color = COLORS.BRIGHT_YELLOW;
        prefix = 'WARN';
        break;
      case 'error': 
        color = COLORS.BRIGHT_RED;
        prefix = 'ERROR';
        break;
      case 'info':
      default:
        color = COLORS.BRIGHT_CYAN;
        prefix = 'INFO';
        break;
    }

    const logLine = `${COLORS.GRAY}[${timestamp}]${COLORS.RESET} ${color}[DB]${COLORS.RESET} ${prefix.padEnd(5)} ${dbStr} ${message}`;

    if (level === 'error') {
      console.error(logLine);
    } else if (level === 'warn') {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  }

  // ==================== ENV DOĞRULAMA ====================

  /**
   * Zorunlu ENV değişkenlerinin varlığını kontrol eder
   * @returns {boolean} Tüm zorunlu değişkenler mevcut mu?
   */
  checkEnvValidity() {
    const requiredEnvs = ['DB_HOST', 'DB_USER', 'DB_PASS'];
    const missing = [];

    for (const env of requiredEnvs) {
      if (! process.env[env] || process.env[env].trim() === '') {
        missing.push(env);
      }
    }

    if (missing.length > 0) {
      this.isDisabled = true;
      this.disableReason = `Eksik ENV:  ${missing.join(', ')}`;

      this._consoleLog('warn', null, `Veritabanı devre dışı:  ${this.disableReason}`);

      this.logger.warn('db_disabled', `Veritabanı devre dışı: ${this.disableReason}`, {
        klasor: 'database',
        key:  'startup',
        eksikEnv: missing
      }).catch(() => {});

      return false;
    }

    return true;
  }

  // ==================== VERİTABANI KAYIT ====================

  /**
   * Yeni bir veritabanı bağlantı havuzu kaydeder
   * @param {string} dbLabel - Veritabanı etiketi (benzersiz tanımlayıcı)
   * @param {Object} config - Bağlantı yapılandırması
   * @param {string} config.host - Veritabanı sunucu adresi
   * @param {number} config.port - Veritabanı port numarası
   * @param {string} config.user - Veritabanı kullanıcı adı
   * @param {string} config.password - Veritabanı şifresi
   * @param {string} config.database - Veritabanı adı
   * @param {number} config.connectionLimit - Maksimum bağlantı sayısı
   * @param {number} config.idleTimeout - Boşta kalma zaman aşımı (ms)
   * @param {number} config.connectTimeout - Bağlantı zaman aşımı (ms)
   * @param {boolean} config.multipleStatements - Çoklu SQL ifadesi desteği
   * @param {string} config.charset - Karakter seti
   * @param {string} config.timezone - Zaman dilimi
   * @returns {Promise<boolean>} Kayıt başarılı mı?
   */
  async registerDatabase(dbLabel, config) {
    if (this.isDisabled) {
      this._consoleLog('warn', dbLabel, 'DB kaydı atlandı (sistem devre dışı)');
      return false;
    }

    if (this.pools.has(dbLabel)) {
      this._consoleLog('warn', dbLabel, 'Bu etiketle zaten bir DB kayıtlı, güncelleniyor...');
      await this.unregisterDatabase(dbLabel);
    }

    const poolConfig = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || this._parseEnvInt('DB_PORT', 3306),
      user: config.user || process.env.DB_USER,
      password: config.password || process.env.DB_PASS,
      database: config.database || config.dbName || dbLabel,
      waitForConnections: true,
      connectionLimit: config.connectionLimit || this.config.maksBaglanti,
      queueLimit: 2000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      idleTimeout: config.idleTimeout || this.config.bostaZamanAsimi,
      connectTimeout: config.connectTimeout || this.config.zamanAsimi,
      multipleStatements: config.multipleStatements !== undefined
        ? config.multipleStatements
        :  this.config.cokluSqlIfade,
      charset: config.charset || 'utf8mb4',
      timezone: config.timezone || 'local'
    };

    try {
      const pool = mysql.createPool(poolConfig);

      // Pool event'leri
      pool.on('connection', (connection) => {
        this.globalStats.totalConnections++;
        const stats = this.poolStats.get(dbLabel);
        if (stats) {
          stats.connections++;
          stats.lastConnectionTime = Date.now();
        }
      });

      pool.on('release', (connection) => {
        const stats = this.poolStats.get(dbLabel);
        if (stats) {
          stats.releases++;
        }
      });

      pool.on('enqueue', () => {
        const stats = this.poolStats.get(dbLabel);
        if (stats) {
          stats.enqueues++;
        }
      });

      // Pool verilerini kaydet
      this.pools.set(dbLabel, {
        pool:  pool,
        config: poolConfig,
        label: dbLabel,
        isHealthy: true,
        lastError: null,
        errorCount: 0,
        reconnectAttempts: 0,
        createdAt: Date.now(),
        lastQueryTime: null,
        lastHealthCheck: null
      });

      // Queue ve stats başlat
      this.queryQueues.set(dbLabel, []);
      this.processingQueues.set(dbLabel, false);
      this.poolStats.set(dbLabel, {
        connections: 0,
        releases: 0,
        enqueues:  0,
        queries: 0,
        successfulQueries: 0,
        failedQueries: 0,
        retries: 0,
        avgQueryTime: 0,
        totalQueryTime: 0,
        lastConnectionTime: null,
        lastQueryTime:  null
      });

      this._consoleLog('success', dbLabel, `Veritabanı kaydedildi (limit: ${poolConfig.connectionLimit}, timeout: ${poolConfig.connectTimeout}ms)`);

      await this.logger.info('db_register', `DB kaydedildi: ${dbLabel}`, {
        klasor: 'database',
        key:  'startup',
        dbLabel: dbLabel,
        database: poolConfig.database,
        host: poolConfig.host,
        connectionLimit: poolConfig.connectionLimit
      });

      this.emit('database:registered', { label: dbLabel, config: poolConfig });

      return true;
    } catch (error) {
      this._consoleLog('error', dbLabel, `Kayıt hatası: ${error.message}`);

      await this.logger.error('db_register_error', `DB kayıt hatası:  ${dbLabel}`, {
        klasor: 'database',
        key: 'startup',
        dbLabel: dbLabel,
        hata: error.message
      });

      return false;
    }
  }

  /**
   * registerDatabase için kısa alias
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {Object} config - Bağlantı yapılandırması
   * @returns {Promise<boolean>} Kayıt başarılı mı?
   */
  async register(dbLabel, config) {
    return this.registerDatabase(dbLabel, config);
  }

  // ==================== VERİTABANI KAYIT SİLME ====================

  /**
   * Kayıtlı bir veritabanı bağlantı havuzunu kaldırır
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {Promise<boolean>} Silme başarılı mı?
   */
  async unregisterDatabase(dbLabel) {
    const poolData = this.pools.get(dbLabel);
    if (!poolData) {
      return false;
    }

    try {
      await poolData.pool.end();
      this.pools.delete(dbLabel);
      this.queryQueues.delete(dbLabel);
      this.processingQueues.delete(dbLabel);
      this.poolStats.delete(dbLabel);

      this._consoleLog('info', dbLabel, 'Veritabanı kaydı silindi');

      this.emit('database:unregistered', { label: dbLabel });

      return true;
    } catch (error) {
      this._consoleLog('error', dbLabel, `Kayıt silme hatası: ${error.message}`);
      return false;
    }
  }

  // ==================== GÜVENLİK KONTROL ====================

  /**
   * SQL sorgusunun geçerliliğini ve güvenliğini kontrol eder
   * @param {string} sql - SQL sorgusu
   * @throws {Error} Geçersiz veya tehlikeli sorgu durumunda
   * @private
   */
  _validateQuery(sql) {
    if (!sql || typeof sql !== 'string') {
      throw new Error('Geçersiz SQL sorgusu');
    }

    const trimmedSql = sql.trim();

    // Pattern doğrulama devre dışıysa atla
    if (! this.enablePatternValidation) {
      return true;
    }

    // Tehlikeli pattern kontrolü
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(trimmedSql)) {
        this.globalStats.dangerousQueryBlocks++;
        throw new Error('Bu SQL sorgusu güvenlik nedeniyle engellendi');
      }
    }

    // Multiple statements kontrolü (eğer devre dışıysa)
    if (! this.config.cokluSqlIfade && trimmedSql.includes(';')) {
      const parts = trimmedSql.split(';').filter(p => p.trim().length > 0);
      if (parts.length > 1) {
        throw new Error('Çoklu SQL ifadesi bu sistemde devre dışı');
      }
    }

    return true;
  }

  /**
   * SQL injection pattern'lerini tespit eder
   * @param {string} sql - SQL sorgusu
   * @returns {boolean} Injection tespit edildi mi?
   * @private
   */
  _detectSqlInjection(sql) {
    // Pattern doğrulama devre dışıysa atla
    if (!this.enablePatternValidation) {
      return false;
    }

    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sql)) {
        this.globalStats.injectionBlocks++;
        return true;
      }
    }
    return false;
  }

  // ==================== QUEUE YÖNETİMİ ====================

  /**
   * Sorguyu kuyruğa ekler
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {Object} queryItem - Sorgu bilgileri
   * @param {string} queryItem.sql - SQL sorgusu
   * @param {Array} queryItem.params - Sorgu parametreleri
   * @param {Object} queryItem.options - Sorgu seçenekleri
   * @param {Function} queryItem.resolve - Promise resolve fonksiyonu
   * @param {Function} queryItem.reject - Promise reject fonksiyonu
   * @throws {Error} Veritabanı bulunamadığında veya kuyruk dolduğunda
   * @private
   */
  _enqueueQuery(dbLabel, queryItem) {
    const queue = this.queryQueues.get(dbLabel);

    if (!queue) {
      throw new Error(`Veritabanı bulunamadı:  ${dbLabel}`);
    }

    if (queue.length >= this.config.kuyrukMaksBoyutu) {
      this.globalStats.queueOverflows++;

      // Detaylı log için traceId oluştur veya mevcut olanı kullan
      const traceId = queryItem.options?.traceId || crypto.randomUUID();

      this._consoleLog('error', dbLabel, `Kuyruk taşması!  TraceID: ${traceId}, Kuyruk boyutu: ${queue.length}/${this.config.kuyrukMaksBoyutu}`);

      this.logger.error('queue_overflow', 'Sorgu kuyruğu taştı', {
        klasor: 'database',
        key:  'queue',
        dbLabel:  dbLabel,
        traceID: traceId,
        kuyrukBoyutu:  queue.length,
        maksKuyruk: this.config.kuyrukMaksBoyutu,
        sql: queryItem.sql ?  queryItem.sql.substring(0, 100) : 'N/A',
        timestamp: new Date().toISOString()
      }).catch(() => {});

      this.emit('queue:overflow', {
        dbLabel,
        traceId,
        queueLength: queue.length,
        maxQueueSize: this.config.kuyrukMaksBoyutu
      });

      throw new Error(`Sorgu kuyruğu dolu (${this.config.kuyrukMaksBoyutu}).TraceID: ${traceId}`);
    }

    queue.push(queryItem);
    this._processQueue(dbLabel);
  }

  /**
   * Sorgu kuyruğunu işler
   * @param {string} dbLabel - Veritabanı etiketi
   * @private
   */
  async _processQueue(dbLabel) {
    if (this.processingQueues.get(dbLabel)) {
      return;
    }

    const queue = this.queryQueues.get(dbLabel);
    if (!queue || queue.length === 0) {
      return;
    }

    this.processingQueues.set(dbLabel, true);

    while (queue.length > 0) {
      const item = queue.shift();

      try {
        const result = await this._executeQueryInternal(
          dbLabel,
          item.sql,
          item.params,
          item.options
        );
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }

      // Event loop'u bloklamadan devam et
      await new Promise(resolve => setImmediate(resolve));
    }

    this.processingQueues.set(dbLabel, false);
  }

  // ==================== SORGU ÇALIŞTIRMA ====================

  /**
   * SQL sorgusunu dahili olarak çalıştırır (retry mekanizması dahil)
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @param {Object} options - Çalıştırma seçenekleri
   * @returns {Promise<Array>} Sorgu sonuçları
   * @throws {Error} Sorgu başarısız olduğunda
   * @private
   */
  async _executeQueryInternal(dbLabel, sql, params, options = {}) {
    const poolData = this.pools.get(dbLabel);

    if (!poolData) {
      throw new Error(`Veritabanı bulunamadı:  ${dbLabel}`);
    }

    const traceId = options.traceId || crypto.randomUUID();
    const startTime = Date.now();
    const timeout = options.timeoutMs || this.config.zamanAsimi;
    const maxRetries = options.retries !== undefined ? options.retries : this.config.yenidenDenemeSayisi;
    const stats = this.poolStats.get(dbLabel);

    // Güvenlik kontrolleri
    this._validateQuery(sql);

    if (this._detectSqlInjection(sql)) {
      const error = new Error('SQL Injection tespit edildi! ');

      await this.logger.critical('db_injection', 'SQL INJECTION TESPİTİ', {
        klasor: 'database',
        key:  'security',
        dbLabel: dbLabel,
        sql:  sql.substring(0, 100),
        traceID: traceId,
        timestamp: new Date().toISOString()
      });

      this.emit('security:injection_detected', { dbLabel, traceId, sql:  sql.substring(0, 50) });

      throw error;
    }

    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;

      try {
        // Bağlantı al
        const connection = await Promise.race([
          poolData.pool.getConnection(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Bağlantı zaman aşımı')), timeout)
          )
        ]);

        try {
          let result;

          // Parametreli sorgu mu?
          if (Array.isArray(params) && params.length > 0) {
            result = await Promise.race([
              connection.execute(sql, params),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Sorgu zaman aşımı')), timeout)
              )
            ]);
          } else {
            result = await Promise.race([
              connection.query(sql),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Sorgu zaman aşımı')), timeout)
              )
            ]);
          }

          const duration = Date.now() - startTime;

          // İstatistikleri güncelle
          this.globalStats.totalQueries++;
          this.globalStats.successfulQueries++;

          if (stats) {
            stats.queries++;
            stats.successfulQueries++;
            stats.totalQueryTime += duration;
            stats.avgQueryTime = stats.totalQueryTime / stats.queries;
            stats.lastQueryTime = Date.now();
          }

          poolData.isHealthy = true;
          poolData.errorCount = 0;
          poolData.lastQueryTime = Date.now();

          // Debug log
          if (options.logQuery !== false) {
            this.logger.debug('db_query_success', `Sorgu OK (${duration}ms)`, {
              klasor: 'database',
              key:  'query',
              dbLabel: dbLabel,
              sure: duration,
              satirSayisi: result[0] ? result[0].length :  0,
              traceID: traceId
            }).catch(() => {});
          }

          this.emit('query:success', {
            dbLabel,
            duration,
            rowCount: result[0] ? result[0].length : 0,
            traceId
          });

          return result[0]; // Sadece data kısmını döndür
        } finally {
          connection.release();
        }
      } catch (error) {
        lastError = error;
        this.globalStats.failedQueries++;

        if (stats) {
          stats.failedQueries++;
        }

        // Retry gerekiyor mu?
        const recoverableErrors = [
          'PROTOCOL_CONNECTION_LOST',
          'ECONNREFUSED',
          'ECONNRESET',
          'ETIMEDOUT',
          'PROTOCOL_PACKETS_OUT_OF_ORDER',
          'ER_LOCK_WAIT_TIMEOUT',
          'ER_LOCK_DEADLOCK'
        ];

        const isRecoverable = recoverableErrors.includes(error.code) ||
          error.message.includes('zaman aşımı') ||
          error.message.includes('timeout');

        if (isRecoverable && attempt < maxRetries) {
          this.globalStats.totalRetries++;
          if (stats) {
            stats.retries++;
          }

          const delay = this.config.yenidenGecikmeMs * attempt;

          this._consoleLog('warn', dbLabel, `Retry ${attempt}/${maxRetries} - ${delay}ms sonra (${error.message})`);

          await this.logger.warn('db_query_retry', `Retry ${attempt}/${maxRetries}`, {
            klasor:  'database',
            key: 'query',
            dbLabel: dbLabel,
            hata: error.message,
            kod: error.code,
            deneme: attempt,
            gecikme: delay,
            traceID: traceId
          });

          // Pool sağlığını güncelle
          if (['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) {
            poolData.isHealthy = false;
            poolData.errorCount++;
            await this._attemptReconnect(dbLabel);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    // Tüm denemeler başarısız
    const duration = Date.now() - startTime;

    poolData.lastError = lastError;
    poolData.errorCount++;

    this._consoleLog('error', dbLabel, `Sorgu başarısız (${maxRetries} deneme, ${duration}ms): ${lastError?.message}`);

    await this.logger.error('db_query_failed', `Sorgu başarısız (${maxRetries} deneme)`, {
      klasor: 'database',
      key:  'query',
      dbLabel: dbLabel,
      sql:  sql.substring(0, 100),
      hata: lastError?.message,
      kod: lastError?.code,
      denemeSayisi: maxRetries,
      sure: duration,
      traceID: traceId
    });

    this.emit('query:failed', {
      dbLabel,
      error: lastError,
      attempts: attempt,
      duration,
      traceId
    });

    throw lastError || new Error('Veritabanı sorgusu başarısız');
  }

  // ==================== PUBLIC QUERY API ====================

  /**
   * SQL sorgusu çalıştırır
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @param {Object} options - Çalıştırma seçenekleri
   * @param {boolean} options.queue - Kuyruğa ekle
   * @param {number} options.retries - Yeniden deneme sayısı
   * @param {number} options.timeoutMs - Zaman aşımı (ms)
   * @param {string} options.traceId - İzleme kimliği
   * @param {boolean} options.logQuery - Sorguyu logla
   * @returns {Promise<Array>} Sorgu sonuçları
   */
  async query(dbLabel, sql, params = [], options = {}) {
    if (this.isDisabled) {
      throw new Error(`Veritabanı sistemi devre dışı:  ${this.disableReason}`);
    }

    if (! this.pools.has(dbLabel)) {
      throw new Error(`Veritabanı bulunamadı:  ${dbLabel}.Önce registerDatabase() ile kaydedin.`);
    }

    // Queue kullan
    if (options.queue) {
      return new Promise((resolve, reject) => {
        try {
          this._enqueueQuery(dbLabel, {
            sql,
            params,
            options,
            resolve,
            reject
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    // Direkt çalıştır
    return this._executeQueryInternal(dbLabel, sql, params, options);
  }

  /**
   * Hafif sorgular için optimize edilmiş sorgu çalıştırıcı
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @param {string} traceId - İzleme kimliği
   * @returns {Promise<Array>} Sorgu sonuçları
   */
  async lightQuery(dbLabel, sql, params = [], traceId = null) {
    return this.query(dbLabel, sql, params, {
      retries: 2,
      queue: true,
      timeoutMs: 5000,
      traceId:  traceId
    });
  }

  /**
   * Ağır sorgular için optimize edilmiş sorgu çalıştırıcı
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @param {string} traceId - İzleme kimliği
   * @returns {Promise<Array>} Sorgu sonuçları
   */
  async heavyQuery(dbLabel, sql, params = [], traceId = null) {
    return this.query(dbLabel, sql, params, {
      retries: this.config.yenidenDenemeSayisi,
      queue: true,
      timeoutMs: this.config.zamanAsimi,
      traceId: traceId
    });
  }

  /**
   * Tek satır getiren sorgu çalıştırır
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {string} sql - SQL sorgusu
   * @param {Array} params - Sorgu parametreleri
   * @param {Object} options - Çalıştırma seçenekleri
   * @returns {Promise<Object|null>} Tek satır veya null
   */
  async queryOne(dbLabel, sql, params = [], options = {}) {
    const results = await this.query(dbLabel, sql, params, options);
    return results && results.length > 0 ? results[0] : null;
  }

  // ==================== TRANSACTION DESTEĞİ ====================

  /**
   * Transaction içinde callback fonksiyonunu çalıştırır
   * @param {string} dbLabel - Veritabanı etiketi
   * @param {Function} callback - Transaction içinde çalışacak fonksiyon (connection parametresi alır)
   * @returns {Promise<*>} Callback'in döndürdüğü değer
   */
  async transaction(dbLabel, callback) {
    if (this.isDisabled) {
      throw new Error(`Veritabanı sistemi devre dışı: ${this.disableReason}`);
    }

    const poolData = this.pools.get(dbLabel);
    if (!poolData) {
      throw new Error(`Veritabanı bulunamadı: ${dbLabel}`);
    }

    const connection = await poolData.pool.getConnection();

    try {
      await connection.beginTransaction();

      const result = await callback(connection);

      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // ==================== YENİDEN BAĞLANMA ====================

  /**
   * Bağlantı havuzunu yeniden oluşturmaya çalışır
   * @param {string} dbLabel - Veritabanı etiketi
   * @private
   */
  async _attemptReconnect(dbLabel) {
    const poolData = this.pools.get(dbLabel);
    if (!poolData) return;

    poolData.reconnectAttempts++;

    if (poolData.reconnectAttempts > this.config.maksYenidenBaglanti) {
      poolData.isHealthy = false;

      this._consoleLog('error', dbLabel, `Maksimum yeniden bağlantı denemesi aşıldı (${this.config.maksYenidenBaglanti})`);

      await this.logger.critical('db_reconnect_failed', `Yeniden bağlantı başarısız:  ${dbLabel}`, {
        klasor: 'database',
        key: 'critical',
        dbLabel: dbLabel,
        denemeSayisi:  poolData.reconnectAttempts
      });

      this.emit('database:reconnect_failed', { label: dbLabel });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, poolData.reconnectAttempts), 30000);

    this._consoleLog('info', dbLabel, `Yeniden bağlanma ${poolData.reconnectAttempts}/${this.config.maksYenidenBaglanti} - ${delay}ms sonra`);

    setTimeout(async () => {
      try {
        // Eski pool'u kapat
        await poolData.pool.end().catch(() => {});

        // Yeni pool oluştur
        const newPool = mysql.createPool(poolData.config);

        // Test bağlantısı
        const testConnection = await newPool.getConnection();
        await testConnection.ping();
        testConnection.release();

        // Başarılı - güncelle
        poolData.pool = newPool;
        poolData.isHealthy = true;
        poolData.errorCount = 0;
        poolData.reconnectAttempts = 0;

        this._consoleLog('success', dbLabel, 'Yeniden bağlantı başarılı');

        await this.logger.success('db_reconnect_success', `Pool onarıldı: ${dbLabel}`, {
          klasor: 'database',
          key: 'reconnect',
          dbLabel: dbLabel
        });

        this.emit('database:reconnected', { label: dbLabel });
      } catch (error) {
        this._consoleLog('error', dbLabel, `Yeniden bağlantı hatası: ${error.message}`);

        await this.logger.error('db_reconnect_error', `Onarım başarısız: ${dbLabel}`, {
          klasor: 'database',
          key:  'reconnect',
          dbLabel:  dbLabel,
          hata: error.message
        });

        // Tekrar dene
        await this._attemptReconnect(dbLabel);
      }
    }, delay);
  }

  // ==================== BAĞLANTI TESTİ ====================

  /**
   * Belirtilen veritabanı bağlantısını test eder
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {Promise<boolean>} Bağlantı sağlıklı mı?
   */
  async testConnection(dbLabel) {
    if (this.isDisabled) {
      return false;
    }

    const poolData = this.pools.get(dbLabel);
    if (!poolData) {
      return false;
    }

    try {
      const connection = await poolData.pool.getConnection();
      await connection.ping();
      connection.release();

      poolData.isHealthy = true;
      return true;
    } catch (error) {
      poolData.isHealthy = false;
      return false;
    }
  }

  // ==================== SAĞLIK KONTROLÜ ====================

  /**
   * Tüm veya belirtilen veritabanlarının sağlık durumunu kontrol eder
   * @param {string|null} dbLabel - Veritabanı etiketi (null ise tümü)
   * @returns {Promise<Object>} Sağlık durumu raporu
   */
  async healthCheck(dbLabel = null) {
    if (this.isDisabled) {
      return {
        status: 'disabled',
        reason:  this.disableReason,
        databases: {}
      };
    }

    const results = {};
    const labels = dbLabel ? [dbLabel] : Array.from(this.pools.keys());

    for (const label of labels) {
      const poolData = this.pools.get(label);
      if (!poolData) continue;

      try {
        const connection = await poolData.pool.getConnection();
        await connection.ping();
        connection.release();

        poolData.isHealthy = true;
        poolData.lastHealthCheck = Date.now();

        const stats = this.poolStats.get(label);

        results[label] = {
          status: 'healthy',
          isHealthy: true,
          database: poolData.config.database,
          host: poolData.config.host,
          errorCount: poolData.errorCount,
          reconnectAttempts:  poolData.reconnectAttempts,
          lastQueryTime: poolData.lastQueryTime,
          stats: stats ?  {
            queries:  stats.queries,
            successfulQueries: stats.successfulQueries,
            failedQueries:  stats.failedQueries,
            avgQueryTime: Math.round(stats.avgQueryTime) + 'ms',
            retries: stats.retries
          } : null
        };
      } catch (error) {
        poolData.isHealthy = false;

        results[label] = {
          status: 'unhealthy',
          isHealthy: false,
          database: poolData.config.database,
          host:  poolData.config.host,
          error: error.message,
          errorCode: error.code,
          errorCount: poolData.errorCount
        };
      }
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      databases: results,
      globalStats: this.globalStats,
      healthCheckFrequencyMs: this.config.healthCheckFrequencyMs
    };
  }

  /**
   * Periyodik sağlık kontrolünü başlatır
   * @private
   */
  _startHealthCheck() {
    // Önceki interval varsa temizle
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
    }

    // ENV'den okunan frekans ile sağlık kontrolü
    this._healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.healthCheck();

        let allHealthy = true;
        for (const [label, status] of Object.entries(health.databases)) {
          if (! status.isHealthy) {
            allHealthy = false;
            this._consoleLog('warn', label, 'Sağlık kontrolü başarısız');
          }
        }

        if (allHealthy && this.pools.size > 0) {
          this._consoleLog('info', null, 'Bağlantı havuzu stabil');
        }

        this.emit('healthcheck:completed', health);
      } catch (error) {
        this._consoleLog('error', null, `Sağlık kontrolü hatası: ${error.message}`);
      }
    }, this.config.healthCheckFrequencyMs);

    // Interval'i unref yap ki process'i açık tutmasın
    if (this._healthCheckInterval.unref) {
      this._healthCheckInterval.unref();
    }
  }

  // ==================== İSTATİSTİKLER ====================

  /**
   * Veritabanı istatistiklerini döndürür
   * @param {string|null} dbLabel - Veritabanı etiketi (null ise tümü)
   * @returns {Object} İstatistik raporu
   */
  getStats(dbLabel = null) {
    if (dbLabel) {
      const stats = this.poolStats.get(dbLabel);
      const poolData = this.pools.get(dbLabel);
      const queue = this.queryQueues.get(dbLabel);

      return {
        dbLabel:  dbLabel,
        isHealthy: poolData?.isHealthy || false,
        stats: stats || null,
        queueLength: queue?.length || 0,
        errorCount: poolData?.errorCount || 0,
        reconnectAttempts:  poolData?.reconnectAttempts || 0
      };
    }

    // Tüm istatistikler
    const allStats = {};

    for (const [label, stats] of this.poolStats) {
      const poolData = this.pools.get(label);
      const queue = this.queryQueues.get(label);

      allStats[label] = {
        isHealthy: poolData?.isHealthy || false,
        stats: stats,
        queueLength: queue?.length || 0,
        errorCount: poolData?.errorCount || 0
      };
    }

    return {
      global: this.globalStats,
      uptime: Date.now() - this.globalStats.startTime,
      databases: allStats,
      disabled: this.isDisabled,
      disableReason: this.disableReason,
      config: {
        kuyrukMaksBoyutu: this.config.kuyrukMaksBoyutu,
        yenidenDenemeSayisi: this.config.yenidenDenemeSayisi,
        maksBaglanti: this.config.maksBaglanti,
        zamanAsimi: this.config.zamanAsimi,
        healthCheckFrequencyMs: this.config.healthCheckFrequencyMs
      }
    };
  }

  // ==================== KAYITLI VERİTABANLARI ====================

  /**
   * Kayıtlı tüm veritabanlarının listesini döndürür
   * @returns {Array<Object>} Veritabanı bilgileri dizisi
   */
  getRegisteredDatabases() {
    const databases = [];

    for (const [label, poolData] of this.pools) {
      databases.push({
        label:  label,
        database: poolData.config.database,
        host: poolData.config.host,
        isHealthy: poolData.isHealthy,
        createdAt: poolData.createdAt
      });
    }

    return databases;
  }

  /**
   * Belirtilen etiketle bir veritabanının kayıtlı olup olmadığını kontrol eder
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {boolean} Kayıtlı mı?
   */
  isDatabaseRegistered(dbLabel) {
    return this.pools.has(dbLabel);
  }

    // ==================== KAPATMA ====================

  /**
   * Tüm veritabanı bağlantılarını kapatır
   * @param {number} timeoutMs - Kapatma zaman aşımı (ms)
   * @returns {Promise<void>}
   */
  async shutdown(timeoutMs = 5000) {
    this._consoleLog('info', null, 'Veritabanı bağlantıları kapatılıyor...');

    // Healthcheck interval'ini temizle
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }

    const shutdownPromises = [];

    for (const [label, poolData] of this.pools) {
      shutdownPromises.push(
        Promise.race([
          poolData.pool.end(),
          new Promise((resolve) =>
            setTimeout(() => {
              this._consoleLog('warn', label, 'Pool kapatma zaman aşımı');
              resolve();
            }, timeoutMs)
          )
        ]).catch(err => {
          this._consoleLog('error', label, `Pool kapatma hatası:  ${err.message}`);
        })
      );
    }

    await Promise.all(shutdownPromises);

    this.pools.clear();
    this.queryQueues.clear();
    this.processingQueues.clear();
    this.poolStats.clear();

    this._consoleLog('success', null, 'Tüm veritabanı bağlantıları kapatıldı');

    await this.logger.info('db_shutdown', 'Veritabanı bağlantıları kapatıldı', {
      klasor: 'database',
      key: 'shutdown'
    });

    this.emit('shutdown');
  }

  /**
   * Tek bir veritabanı bağlantı havuzunu kapatır (unregisterDatabase alias)
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {Promise<boolean>} Kapatma başarılı mı?
   */
  async close(dbLabel) {
    return this.unregisterDatabase(dbLabel);
  }

  /**
   * Tüm veritabanı bağlantılarını kapatır (shutdown alias)
   * @returns {Promise<void>}
   */
  async closeAll() {
    return this.shutdown();
  }

  // ==================== YARDIMCI METODLAR ====================

  /**
   * Belirtilen veritabanının sağlıklı olup olmadığını döndürür
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {boolean} Sağlıklı mı?
   */
  isHealthy(dbLabel) {
    const poolData = this.pools.get(dbLabel);
    return poolData ?  poolData.isHealthy : false;
  }

  /**
   * Sistemin genel olarak aktif olup olmadığını döndürür
   * @returns {boolean} Sistem aktif mi?
   */
  isActive() {
    return ! this.isDisabled && this.pools.size > 0;
  }

  /**
   * Belirtilen veritabanının kuyruk uzunluğunu döndürür
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {number} Kuyruk uzunluğu
   */
  getQueueLength(dbLabel) {
    const queue = this.queryQueues.get(dbLabel);
    return queue ? queue.length : 0;
  }

  /**
   * Tüm veritabanlarının toplam kuyruk uzunluğunu döndürür
   * @returns {number} Toplam kuyruk uzunluğu
   */
  getTotalQueueLength() {
    let total = 0;
    for (const queue of this.queryQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Belirtilen veritabanının bağlantı havuzu yapılandırmasını döndürür
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {Object|null} Pool yapılandırması veya null
   */
  getPoolConfig(dbLabel) {
    const poolData = this.pools.get(dbLabel);
    return poolData ? { ...poolData.config } : null;
  }

  /**
   * Sistemin çalışma süresini milisaniye cinsinden döndürür
   * @returns {number} Çalışma süresi (ms)
   */
  getUptime() {
    return Date.now() - this.globalStats.startTime;
  }

  /**
   * Sistemin çalışma süresini okunabilir formatta döndürür
   * @returns {string} Formatlanmış çalışma süresi
   */
  getUptimeFormatted() {
    const uptime = this.getUptime();
    const seconds = Math.floor(uptime / 1000) % 60;
    const minutes = Math.floor(uptime / (1000 * 60)) % 60;
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}g`);
    if (hours > 0) parts.push(`${hours}s`);
    if (minutes > 0) parts.push(`${minutes}d`);
    parts.push(`${seconds}sn`);

    return parts.join(' ');
  }

  /**
   * Mevcut yapılandırmayı döndürür
   * @returns {Object} Yapılandırma nesnesi
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Belirtilen bir yapılandırma değerini günceller
   * NOT: Bu metod sadece runtime değerlerini günceller, ENV'i değiştirmez
   * @param {string} key - Yapılandırma anahtarı
   * @param {*} value - Yeni değer
   * @returns {boolean} Güncelleme başarılı mı? 
   */
  setConfigValue(key, value) {
    if (this.config.hasOwnProperty(key)) {
      const oldValue = this.config[key];
      this.config[key] = value;

      this._consoleLog('info', null, `Yapılandırma güncellendi: ${key} = ${value} (önceki: ${oldValue})`);

      this.logger.info('config_updated', 'Yapılandırma değeri güncellendi', {
        klasor: 'database',
        key:  'config',
        parametre: key,
        eskiDeger: oldValue,
        yeniDeger: value
      }).catch(() => {});

      // Healthcheck frekansı değiştiyse interval'i yeniden başlat
      if (key === 'healthCheckFrequencyMs') {
        this._restartHealthCheck();
      }

      this.emit('config:updated', { key, oldValue, newValue:  value });

      return true;
    }

    this._consoleLog('warn', null, `Bilinmeyen yapılandırma anahtarı: ${key}`);
    return false;
  }

  /**
   * Tüm kuyrukları temizler (dikkatli kullanın!)
   * @param {string|null} dbLabel - Belirli bir veritabanı etiketi veya null (tümü)
   * @returns {number} Temizlenen sorgu sayısı
   */
  clearQueues(dbLabel = null) {
    let clearedCount = 0;

    if (dbLabel) {
      const queue = this.queryQueues.get(dbLabel);
      if (queue) {
        clearedCount = queue.length;
        
        // Bekleyen sorguları reject et
        while (queue.length > 0) {
          const item = queue.shift();
          if (item.reject) {
            item.reject(new Error('Kuyruk temizlendi'));
          }
        }

        this._consoleLog('warn', dbLabel, `Kuyruk temizlendi: ${clearedCount} sorgu iptal edildi`);
      }
    } else {
      for (const [label, queue] of this.queryQueues) {
        const count = queue.length;
        
        // Bekleyen sorguları reject et
        while (queue.length > 0) {
          const item = queue.shift();
          if (item.reject) {
            item.reject(new Error('Kuyruk temizlendi'));
          }
        }

        clearedCount += count;

        if (count > 0) {
          this._consoleLog('warn', label, `Kuyruk temizlendi: ${count} sorgu iptal edildi`);
        }
      }
    }

    if (clearedCount > 0) {
      this.logger.warn('queues_cleared', 'Sorgular kuyruklardan temizlendi', {
        klasor: 'database',
        key: 'queue',
        dbLabel:  dbLabel || 'tümü',
        temizlenenSorguSayisi: clearedCount
      }).catch(() => {});

      this.emit('queues:cleared', { dbLabel, clearedCount });
    }

    return clearedCount;
  }

  /**
   * Global istatistikleri sıfırlar
   */
  resetGlobalStats() {
    const oldStats = { ...this.globalStats };

    this.globalStats = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      totalRetries: 0,
      totalConnections: 0,
      poolErrors: 0,
      queueOverflows: 0,
      injectionBlocks: 0,
      dangerousQueryBlocks: 0,
      startTime: Date.now()
    };

    this._consoleLog('info', null, 'Global istatistikler sıfırlandı');

    this.logger.info('stats_reset', 'Global istatistikler sıfırlandı', {
      klasor: 'database',
      key: 'stats',
      eskiIstatistikler: oldStats
    }).catch(() => {});

    this.emit('stats:reset', { oldStats });
  }

  /**
   * Belirtilen veritabanının istatistiklerini sıfırlar
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {boolean} Sıfırlama başarılı mı?
   */
  resetPoolStats(dbLabel) {
    const stats = this.poolStats.get(dbLabel);
    if (!stats) {
      return false;
    }

    const oldStats = { ...stats };

    this.poolStats.set(dbLabel, {
      connections: 0,
      releases: 0,
      enqueues: 0,
      queries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      retries: 0,
      avgQueryTime: 0,
      totalQueryTime: 0,
      lastConnectionTime: null,
      lastQueryTime: null
    });

    this._consoleLog('info', dbLabel, 'Pool istatistikleri sıfırlandı');

    this.emit('pool:stats_reset', { dbLabel, oldStats });

    return true;
  }

  /**
   * Detaylı sistem durumu raporu oluşturur
   * @returns {Object} Detaylı durum raporu
   */
  getDetailedStatus() {
    const databases = {};

    for (const [label, poolData] of this.pools) {
      const stats = this.poolStats.get(label);
      const queue = this.queryQueues.get(label);

      databases[label] = {
        isHealthy: poolData.isHealthy,
        config: {
          host: poolData.config.host,
          database: poolData.config.database,
          connectionLimit: poolData.config.connectionLimit
        },
        stats: stats ? {
          queries: stats.queries,
          successfulQueries: stats.successfulQueries,
          failedQueries: stats.failedQueries,
          successRate: stats.queries > 0 
            ? ((stats.successfulQueries / stats.queries) * 100).toFixed(2) + '%'
            :  'N/A',
          avgQueryTime: Math.round(stats.avgQueryTime) + 'ms',
          retries: stats.retries,
          connections: stats.connections,
          lastQueryTime: stats.lastQueryTime 
            ? new Date(stats.lastQueryTime).toISOString() 
            : null
        } : null,
        queue: {
          length: queue ? queue.length :  0,
          maxSize: this.config.kuyrukMaksBoyutu,
          utilizationPercent: queue 
            ? ((queue.length / this.config.kuyrukMaksBoyutu) * 100).toFixed(2) + '%'
            : '0%'
        },
        errors: {
          count: poolData.errorCount,
          lastError: poolData.lastError ?  poolData.lastError.message : null,
          reconnectAttempts:  poolData.reconnectAttempts
        },
        timing: {
          createdAt: new Date(poolData.createdAt).toISOString(),
          lastQueryTime: poolData.lastQueryTime 
            ? new Date(poolData.lastQueryTime).toISOString() 
            : null,
          lastHealthCheck: poolData.lastHealthCheck 
            ? new Date(poolData.lastHealthCheck).toISOString() 
            : null
        }
      };
    }

    return {
      system: {
        isActive: this.isActive(),
        isDisabled: this.isDisabled,
        disableReason: this.disableReason,
        uptime: this.getUptime(),
        uptimeFormatted: this.getUptimeFormatted(),
        registeredDatabases:  this.pools.size,
        totalQueueLength: this.getTotalQueueLength()
      },
      globalStats: {
        ...this.globalStats,
        successRate: this.globalStats.totalQueries > 0
          ? ((this.globalStats.successfulQueries / this.globalStats.totalQueries) * 100).toFixed(2) + '%'
          : 'N/A',
        avgRetriesPerFailure: this.globalStats.failedQueries > 0
          ? (this.globalStats.totalRetries / this.globalStats.failedQueries).toFixed(2)
          : '0'
      },
      config: {
        ...this.config,
        healthCheckFrequencyFormatted: `${this.config.healthCheckFrequencyMs / 60000} dakika`
      },
      security: {
        patternValidationEnabled: this.enablePatternValidation,
        dangerousPatternsCount: this.dangerousPatterns.length,
        injectionPatternsCount: this.injectionPatterns.length,
        blockedDangerousQueries: this.globalStats.dangerousQueryBlocks,
        blockedInjectionAttempts: this.globalStats.injectionBlocks
      },
      databases: databases,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Bağlantı havuzunun mevcut bağlantı sayısını tahmin eder
   * NOT: mysql2 bu bilgiyi doğrudan sağlamaz, bu nedenle istatistiklerden tahmin edilir
   * @param {string} dbLabel - Veritabanı etiketi
   * @returns {Object|null} Bağlantı bilgileri veya null
   */
  getConnectionInfo(dbLabel) {
    const poolData = this.pools.get(dbLabel);
    const stats = this.poolStats.get(dbLabel);

    if (!poolData || !stats) {
      return null;
    }

    return {
      connectionLimit: poolData.config.connectionLimit,
      totalConnectionsCreated: stats.connections,
      totalReleases: stats.releases,
      enqueuedRequests: stats.enqueues,
      isHealthy: poolData.isHealthy
    };
  }
}

// ==================== MODÜL EXPORT ====================

module.exports = DatabaseManager;