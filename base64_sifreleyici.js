// base64_sifreleyici.js
// Ultra Gelişmiş Base64 Encoding / Decoding Modülü - TAM VE EKSİKSİZ
// Metin, görsel, dosya, URL desteği - Production-ready
// Crash-proof, log entegreli, genişletilebilir yapı
// Versiyon:  3.0.0
// Güncelleme Tarihi: 2026-01-01

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { Stream, Readable } = require('stream');

// ==================== YAPILANDIRMA (CONFIG) ====================

/**
 * Varsayılan yapılandırma ayarları
 * ENV değişkenleri veya options parametresi ile override edilebilir
 * @type {Object}
 */
const DEFAULT_CONFIG = {
  // Zaman aşımı ayarları (milisaniye)
  timeout: parseInt(process.env.BASE64_TIMEOUT_MS, 10) || 30000,
  
  // Dosya boyut limitleri (byte)
  maxFileSize: parseInt(process.env.BASE64_MAX_FILE_SIZE, 10) || 50 * 1024 * 1024,
  maxUrlContentSize: parseInt(process.env.BASE64_MAX_URL_SIZE, 10) || 25 * 1024 * 1024,
  
  // URL ayarları
  followRedirects: process.env.BASE64_FOLLOW_REDIRECTS !== 'false',
  maxRedirects: parseInt(process.env.BASE64_MAX_REDIRECTS, 10) || 5,
  
  // Loglama ayarları
  enableLogging: process.env.BASE64_ENABLE_LOGGING !== 'false',
  logLevel: (process.env.BASE64_LOG_LEVEL || 'info').toLowerCase(),
  
  // Varsayılan encoding
  defaultEncoding:  'utf8',
  
  // Stream okuma ayarları
  streamHighWaterMark:  parseInt(process.env.BASE64_STREAM_BUFFER, 10) || 64 * 1024
};

// Aktif yapılandırma (değiştirilebilir)
let activeConfig = { ...DEFAULT_CONFIG };

// ==================== DESTEKLENEN GÖRSEL UZANTILARI ====================

/**
 * Desteklenen görsel dosya uzantıları listesi
 * @type {string[]}
 */
const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.tiff',
  '.tif',
  '.avif',
  '.heic',
  '.heif'
];

// ==================== MIME TİPLERİ SÖZLÜĞÜ ====================

/**
 * Dosya uzantılarına göre MIME tipleri
 * @type {Object.<string, string>}
 */
const SUPPORTED_MIME_TYPES = {
  // Görsel formatları
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
  '.ico': 'image/x-icon',
  '.svg':  'image/svg+xml',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif':  'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  
  // Doküman formatları
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  
  // Veri formatları
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.csv': 'text/csv',
  
  // Metin formatları
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.md': 'text/markdown',
  
  // Arşiv formatları
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz':  'application/gzip',
  
  // Ses formatları
  '.mp3': 'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  
  // Video formatları
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi':  'video/x-msvideo',
  '.mov':  'video/quicktime',
  '.mkv': 'video/x-matroska',
  
  // Font formatları
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject'
};

// ==================== HATA KODLARI ====================

/**
 * Standart hata kodları enum'u
 * Tüm hata durumları için tutarlı kodlama sağlar
 * @type {Object.<string, string>}
 */
const ERROR_CODES = {
  // Girdi hataları
  INVALID_INPUT: 'INVALID_INPUT',
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_ENCODING: 'INVALID_ENCODING',
  
  // Dosya hataları
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_TOO_LARGE:  'FILE_TOO_LARGE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  IS_DIRECTORY: 'IS_DIRECTORY',
  
  // Base64 hataları
  INVALID_BASE64: 'INVALID_BASE64',
  INVALID_BASE64_LENGTH: 'INVALID_BASE64_LENGTH',
  INVALID_BASE64_CHARACTERS: 'INVALID_BASE64_CHARACTERS',
  INVALID_BASE64_PADDING: 'INVALID_BASE64_PADDING',
  
  // Encode/Decode hataları
  DECODE_ERROR: 'DECODE_ERROR',
  ENCODE_ERROR: 'ENCODE_ERROR',
  JSON_PARSE_ERROR: 'JSON_PARSE_ERROR',
  JSON_STRINGIFY_ERROR: 'JSON_STRINGIFY_ERROR',
  
  // URL hataları
  URL_INVALID: 'URL_INVALID',
  URL_TIMEOUT: 'URL_TIMEOUT',
  URL_FETCH_ERROR: 'URL_FETCH_ERROR',
  URL_CONTENT_TOO_LARGE:  'URL_CONTENT_TOO_LARGE',
  URL_REDIRECT_LIMIT:  'URL_REDIRECT_LIMIT',
  URL_REDIRECT_MISSING: 'URL_REDIRECT_MISSING',
  
  // Ağ hataları
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  DNS_ERROR: 'DNS_ERROR',
  SSL_ERROR: 'SSL_ERROR',
  
  // HTTP hataları
  HTTP_CLIENT_ERROR: 'HTTP_CLIENT_ERROR',
  HTTP_SERVER_ERROR: 'HTTP_SERVER_ERROR',
  HTTP_UNAUTHORIZED: 'HTTP_UNAUTHORIZED',
  HTTP_FORBIDDEN: 'HTTP_FORBIDDEN',
  HTTP_NOT_FOUND: 'HTTP_NOT_FOUND',
  
  // Genel hatalar
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  STREAM_ERROR: 'STREAM_ERROR'
};

// ==================== LOG SEVİYELERİ ====================

/**
 * Log seviyeleri ve öncelikleri
 * Düşük numara = düşük öncelik (daha fazla log)
 * @type {Object.<string, number>}
 */
const LOG_LEVELS = {
  debug:  0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};

// ==================== GEÇERLİ ENCODING LİSTESİ ====================

/**
 * Node.js tarafından desteklenen geçerli encoding listesi
 * @type {string[]}
 */
const VALID_ENCODINGS = [
  'utf8',
  'utf-8',
  'ascii',
  'latin1',
  'binary',
  'hex',
  'base64',
  'base64url',
  'ucs2',
  'ucs-2',
  'utf16le',
  'utf-16le'
];

// ==================== LOGGER SINIFI ====================

/**
 * Gelişmiş Logger sınıfı
 * Harici log modülü entegrasyonu ve console fallback desteği
 */
class Logger {
  constructor() {
    this.externalLogger = null;
    this.initialized = false;
    this.initializationAttempted = false;
  }
  
  /**
   * Logger'ı başlatır ve harici modülü yüklemeye çalışır
   * @private
   */
  initialize() {
    if (this.initializationAttempted) return;
    this.initializationAttempted = true;
    
    try {
      this.externalLogger = require('./log_yonetim');
      this.initialized = true;
      
      if (activeConfig.enableLogging && this.shouldLog('info')) {
        console.info('[BASE64-LOGGER] Harici log modülü (log_yonetim) başarıyla yüklendi.');
      }
    } catch (e) {
      this.externalLogger = null;
      this.initialized = false;
      
      if (activeConfig.enableLogging) {
        console.warn('[BASE64-LOGGER] Harici log modülü (log_yonetim) bulunamadı.Console fallback aktif.');
        console.warn('[BASE64-LOGGER] Hata detayı:', e.message);
      }
    }
  }
  
  /**
   * Logger yapılandırmasını yeniden uygular
   */
  reconfigure() {
    if (activeConfig.enableLogging && this.shouldLog('debug')) {
      this.consoleLog('debug', 'logger_reconfigure', 'Logger yapılandırması güncellendi', {
        logLevel: activeConfig.logLevel,
        enableLogging: activeConfig.enableLogging
      });
    }
  }
  
  /**
   * Log seviyesinin aktif olup olmadığını kontrol eder
   * Düzeltilmiş karşılaştırma: mesaj seviyesi >= yapılandırılmış seviye
   * @param {string} level - Kontrol edilecek log seviyesi
   * @returns {boolean} Log seviyesi aktif mi
   * @private
   */
  shouldLog(level) {
    if (!activeConfig.enableLogging) return false;
    
    const configuredLevel = LOG_LEVELS[activeConfig.logLevel];
    const messageLevel = LOG_LEVELS[level];
    
    // Geçersiz seviye kontrolü
    if (configuredLevel === undefined || messageLevel === undefined) {
      return true; // Bilinmeyen seviye ise logla
    }
    
    // Mesaj seviyesi, yapılandırılmış seviyeden büyük veya eşitse logla
    // Örnek: logLevel='warn'(2) ise, sadece warn(2) ve error(3) loglanır
    return messageLevel >= configuredLevel;
  }
  
  /**
   * Zaman damgası formatı
   * @returns {string} ISO formatında zaman damgası
   * @private
   */
  getTimestamp() {
    return new Date().toISOString();
  }
  
  /**
   * Console'a log yazdırır
   * @param {string} level - Log seviyesi
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} extras - Ek bilgiler
   * @private
   */
  consoleLog(level, event, message, extras = {}) {
    const timestamp = this.getTimestamp();
    const prefix = `[${timestamp}] [BASE64] [${level.toUpperCase()}]`;
    const fullMessage = `${prefix} ${event}:  ${message}`;
    
    let logData;
    if (Object.keys(extras).length > 0) {
      try {
        logData = `${fullMessage} | ${JSON.stringify(extras)}`;
      } catch (e) {
        logData = `${fullMessage} | [Serialize edilemedi]`;
      }
    } else {
      logData = fullMessage;
    }
    
    switch (level) {
      case 'debug':
        console.debug(logData);
        break;
      case 'info':
        console.info(logData);
        break;
      case 'warn':
        console.warn(logData);
        break;
      case 'error':
        console.error(logData);
        break;
      default:
        console.log(logData);
    }
  }
  
  /**
   * Debug seviyesinde log yazar
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} opts - Ek opsiyonlar
   */
  async debug(event, message, opts = {}) {
    if (!this.shouldLog('debug')) return;
    
    this.initialize();
    
    try {
      if (this.externalLogger && typeof this.externalLogger.debug === 'function') {
        await this.externalLogger.debug(event, message, {
          klasor: 'bot_genel',
          key: 'base64',
          ...opts
        });
      } else {
        this.consoleLog('debug', event, message, opts);
      }
    } catch (e) {
      this.consoleLog('debug', event, message, opts);
      console.warn('[BASE64-LOGGER] Harici logger hatası:', e.message);
    }
  }
  
  /**
   * Info seviyesinde log yazar
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} opts - Ek opsiyonlar
   */
  async info(event, message, opts = {}) {
    if (! this.shouldLog('info')) return;
    
    this.initialize();
    
    try {
      if (this.externalLogger && typeof this.externalLogger.info === 'function') {
        await this.externalLogger.info(event, message, {
          klasor: 'bot_genel',
          key: 'base64',
          ...opts
        });
      } else {
        this.consoleLog('info', event, message, opts);
      }
    } catch (e) {
      this.consoleLog('info', event, message, opts);
      console.warn('[BASE64-LOGGER] Harici logger hatası:', e.message);
    }
  }
  
  /**
   * Warn seviyesinde log yazar
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} opts - Ek opsiyonlar
   */
  async warn(event, message, opts = {}) {
    if (!this.shouldLog('warn')) return;
    
    this.initialize();
    
    try {
      if (this.externalLogger && typeof this.externalLogger.warn === 'function') {
        await this.externalLogger.warn(event, message, {
          klasor: 'bot_genel',
          key: 'base64',
          ...opts
        });
      } else {
        this.consoleLog('warn', event, message, opts);
      }
    } catch (e) {
      this.consoleLog('warn', event, message, opts);
      console.error('[BASE64-LOGGER] Harici logger hatası:', e.message);
    }
  }
  
  /**
   * Error seviyesinde log yazar
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} opts - Ek opsiyonlar
   */
  async error(event, message, opts = {}) {
    if (!this.shouldLog('error')) return;
    
    this.initialize();
    
    try {
      if (this.externalLogger && typeof this.externalLogger.error === 'function') {
        await this.externalLogger.error(event, message, {
          klasor: 'bot_genel',
          key: 'base64',
          ...opts
        });
      } else {
        this.consoleLog('error', event, message, opts);
      }
    } catch (e) {
      // Her durumda console'a yaz
      this.consoleLog('error', event, message, opts);
      console.error('[BASE64-LOGGER] Harici logger hatası:', e.message);
    }
  }
  
  /**
   * Success seviyesinde log yazar (info wrapper)
   * @param {string} event - Olay adı
   * @param {string} message - Log mesajı
   * @param {Object} opts - Ek opsiyonlar
   */
  async success(event, message, opts = {}) {
    await this.info(event, `✓ ${message}`, opts);
  }
}

// Global logger instance
const logger = new Logger();

// ==================== YARDIMCI FONKSİYONLAR ====================

/**
 * Başarılı sonuç objesi oluşturur
 * @param {any} data - Sonuç verisi
 * @param {string} type - Veri tipi
 * @param {string} source - Veri kaynağı
 * @param {Object} extras - Ek bilgiler
 * @returns {Object} Standart başarı objesi
 */
function createSuccessResponse(data, type, source, extras = {}) {
  return {
    success:  true,
    data:  data,
    type: type,
    source: source,
    timestamp: new Date().toISOString(),
    ...extras
  };
}

/**
 * Hata sonuç objesi oluşturur
 * @param {string} message - Hata mesajı
 * @param {string} errorCode - Hata kodu
 * @param {Object} extras - Ek bilgiler
 * @returns {Object} Standart hata objesi
 */
function createErrorResponse(message, errorCode, extras = {}) {
  return {
    success:  false,
    data: null,
    message: message,
    error_code: errorCode,
    timestamp:  new Date().toISOString(),
    ...extras
  };
}

/**
 * Byte değerini okunabilir formata çevirir
 * @param {number} bytes - Byte değeri
 * @param {number} decimals - Ondalık basamak sayısı
 * @returns {string} Formatlanmış boyut string'i
 * @example
 * formatBytes(1024) // "1 KB"
 * formatBytes(1536, 2) // "1.50 KB"
 * formatBytes(0) // "0 B"
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Geçersiz boyut';
  if (! Number.isFinite(bytes)) return 'Geçersiz boyut';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  
  return parseFloat((bytes / Math.pow(k, index)).toFixed(decimals)) + ' ' + sizes[index];
}

/**
 * Dosya uzantısına göre MIME tipini döndürür
 * @param {string} filePath - Dosya yolu veya dosya adı
 * @returns {string} MIME tipi
 * @example
 * getMimeType('resim.png') // "image/png"
 * getMimeType('/path/to/document.pdf') // "application/pdf"
 * getMimeType('bilinmeyen.xyz') // "application/octet-stream"
 */
function getMimeType(filePath) {
  if (! filePath || typeof filePath !== 'string') {
    return 'application/octet-stream';
  }
  
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Dosya uzantısının görsel formatı olup olmadığını kontrol eder
 * @param {string} filePath - Dosya yolu veya dosya adı
 * @returns {boolean} Görsel formatı mı
 */
function isImageExtension(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Encoding değerini normalize eder ve doğrular
 * @param {string} encoding - Kontrol edilecek encoding
 * @returns {Object} { valid: boolean, normalized: string, error: string|null }
 */
function normalizeAndValidateEncoding(encoding) {
  if (!encoding || typeof encoding !== 'string') {
    return {
      valid: false,
      normalized: null,
      error: 'Encoding değeri boş veya string değil'
    };
  }
  
  const normalized = encoding.toLowerCase().trim();
  
  if (! VALID_ENCODINGS.includes(normalized)) {
    return {
      valid:  false,
      normalized: normalized,
      error:  `Geçersiz encoding:  '${encoding}'.Desteklenen encodingler: ${VALID_ENCODINGS.join(', ')}`
    };
  }
  
  return {
    valid: true,
    normalized: normalized,
    error: null
  };
}

/**
 * Girdi tipini otomatik olarak algılar
 * Performans optimizasyonu yapılmış versiyon
 * @param {any} input - Tip algılanacak girdi
 * @returns {string} Algılanan tip
 * @example
 * detectInputType('https://example.com/image.png') // "url"
 * detectInputType(Buffer.from('test')) // "buffer"
 * detectInputType({ key: 'value' }) // "object"
 * detectInputType([1, 2, 3]) // "array"
 */
function detectInputType(input) {
  // Null veya undefined kontrolü
  if (input === null) {
    return 'null';
  }
  
  if (input === undefined) {
    return 'undefined';
  }
  
  // Primitive tipler önce kontrol edilir (performans için)
  const inputType = typeof input;
  
  if (inputType === 'number') {
    return 'number';
  }
  
  if (inputType === 'boolean') {
    return 'boolean';
  }
  
  if (inputType === 'symbol') {
    return 'symbol';
  }
  
  if (inputType === 'bigint') {
    return 'bigint';
  }
  
  if (inputType === 'function') {
    return 'function';
  }
  
  // Buffer kontrolü (object'ten önce)
  if (Buffer.isBuffer(input)) {
    return 'buffer';
  }
  
  // Uint8Array kontrolü
  if (input instanceof Uint8Array) {
    return 'uint8array';
  }
  
  // ArrayBuffer kontrolü
  if (input instanceof ArrayBuffer) {
    return 'arraybuffer';
  }
  
  // Stream kontrolü
  if (input instanceof Stream || (inputType === 'object' && typeof input.pipe === 'function')) {
    return 'stream';
  }
  
  // String kontrolü
  if (inputType === 'string') {
    return detectStringType(input);
  }
  
  // Array kontrolü (object'ten önce)
  if (Array.isArray(input)) {
    return 'array';
  }
  
  // Object kontrolü
  if (inputType === 'object') {
    return detectObjectType(input);
  }
  
  return 'unknown';
}

/**
 * String tipini detaylı algılar
 * @param {string} input - Algılanacak string
 * @returns {string} Algılanan tip
 * @private
 */
function detectStringType(input) {
  // Boş string kontrolü
  if (input.length === 0 || input.trim().length === 0) {
    return 'empty';
  }
  
  // Data URL kontrolü (en hızlı kontrol)
  if (input.startsWith('data:')) {
    return 'dataurl';
  }
  
  // URL kontrolleri
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return 'url';
  }
  
  if (input.startsWith('ftp://') || input.startsWith('ftps://')) {
    return 'ftp';
  }
  
  if (input.startsWith('file://')) {
    return 'fileurl';
  }
  
  // Dosya yolu kontrolü - sadece path benzeri stringler için
  // Performans:  önce basit kontroller, sonra dosya sistemi erişimi
  if (looksLikeFilePath(input)) {
    try {
      if (fs.existsSync(input)) {
        return 'file';
      }
    } catch (e) {
      // Dosya kontrolü başarısız, devam et
    }
  }
  
  // Base64 kontrolü
  const base64Validation = validateBase64Quick(input);
  if (base64Validation.looksLikeBase64 && base64Validation.valid) {
    return 'base64';
  }
  
  // Varsayılan:  düz metin
  return 'text';
}

/**
 * String'in dosya yoluna benzeyip benzemediğini kontrol eder
 * @param {string} input - Kontrol edilecek string
 * @returns {boolean}
 * @private
 */
function looksLikeFilePath(input) {
  // Çok kısa stringler dosya yolu olamaz
  if (input.length < 2) return false;
  
  // Çok uzun stringler muhtemelen dosya yolu değil
  if (input.length > 500) return false;
  
  // Satır sonu içeren stringler dosya yolu değil
  if (input.includes('\n') || input.includes('\r')) return false;
  
  // Mutlak yol kontrolü
  if (input.startsWith('/') || input.startsWith('\\')) return true;
  
  // Windows mutlak yol kontrolü
  if (/^[A-Za-z]:[\\/]/.test(input)) return true;
  
  // Göreli yol kontrolü
  if (input.startsWith('./') || input.startsWith('../')) return true;
  if (input.startsWith('.\\') || input.startsWith('..\\')) return true;
  
  // Uzantı içeren dosya adı kontrolü
  if (/\.[a-zA-Z0-9]{1,10}$/.test(input) && !input.includes(' ')) return true;
  
  return false;
}

/**
 * Object tipini detaylı algılar
 * @param {Object} input - Algılanacak object
 * @returns {string} Algılanan tip
 * @private
 */
function detectObjectType(input) {
  // Date kontrolü
  if (input instanceof Date) {
    return 'date';
  }
  
  // RegExp kontrolü
  if (input instanceof RegExp) {
    return 'regexp';
  }
  
  // Map kontrolü
  if (input instanceof Map) {
    return 'map';
  }
  
  // Set kontrolü
  if (input instanceof Set) {
    return 'set';
  }
  
  // Error kontrolü
  if (input instanceof Error) {
    return 'error';
  }
  
  // Promise kontrolü
  if (input instanceof Promise || (typeof input.then === 'function')) {
    return 'promise';
  }
  
  // Plain object
  return 'object';
}

/**
 * Hızlı Base64 ön kontrolü
 * @param {string} str - Kontrol edilecek string
 * @returns {Object} { looksLikeBase64: boolean, valid: boolean }
 * @private
 */
function validateBase64Quick(str) {
  // Çok kısa veya çok uzun stringler
  if (str.length < 4) {
    return { looksLikeBase64: false, valid: false };
  }
  
  // Data URL ise base64 kısmını al
  let base64Str = str;
  if (str.startsWith('data:')) {
    const commaIndex = str.indexOf(',');
    if (commaIndex === -1) {
      return { looksLikeBase64: false, valid:  false };
    }
    base64Str = str.substring(commaIndex + 1);
  }
  
  // Whitespace temizle
  base64Str = base64Str.replace(/[\s\r\n]/g, '');
  
  // Uzunluk 4'ün katı olmalı
  if (base64Str.length % 4 !== 0) {
    return { looksLikeBase64: false, valid: false };
  }
  
  // Base64 benzeri görünüyor mu? 
  const looksLikeBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(base64Str);
  
  if (!looksLikeBase64) {
    return { looksLikeBase64: false, valid: false };
  }
  
  // Detaylı doğrulama
  try {
    const buffer = Buffer.from(base64Str, 'base64');
    const reEncoded = buffer.toString('base64');
    const valid = base64Str.replace(/=+$/, '') === reEncoded.replace(/=+$/, '');
    return { looksLikeBase64: true, valid: valid };
  } catch (e) {
    return { looksLikeBase64: true, valid: false };
  }
}

/**
 * Base64 string'in geçerli olup olmadığını detaylı kontrol eder
 * @param {string} str - Kontrol edilecek string
 * @returns {Object} Detaylı doğrulama sonucu
 */
function validateBase64Detailed(str) {
  const result = {
    valid: false,
    isDataUrl: false,
    mimeType: null,
    base64Part: null,
    originalInput: null,
    length: 0,
    decodedSize: 0,
    errorCode: null,
    errorMessage:  null,
    errorPosition: null
  };
  
  // Orijinal girdiyi sakla
  result.originalInput = str;
  
  // Tip kontrolü
  if (typeof str !== 'string') {
    result.errorCode = ERROR_CODES.INVALID_TYPE;
    result.errorMessage = `Girdi string tipinde değil, alınan tip: ${typeof str}`;
    return result;
  }
  
  // Boş string kontrolü
  if (str.length === 0) {
    result.errorCode = ERROR_CODES.EMPTY_INPUT;
    result.errorMessage = 'Girdi boş string';
    return result;
  }
  
  let base64Str = str;
  let originalBase64Start = 0;
  
  // Data URL formatını işle
  if (str.startsWith('data:')) {
    result.isDataUrl = true;
    
    
const dataUrlMatch = str.match(/^data:([^;,]*)?(?:;([^;,]*))?(?:;([^,]*))?,([\\s\\S]*)$/);
    
    if (dataUrlMatch) {
      result.mimeType = dataUrlMatch[1] || null;
      
      const param1 = dataUrlMatch[2];
      const param2 = dataUrlMatch[3];
      
      // Base64 encoding kontrolü
      const hasBase64 = param1 === 'base64' || param2 === 'base64';
      
      if (! hasBase64 && (param1 || param2)) {
        // Base64 olmayan encoding
        if (param1 && param1.startsWith('charset=')) {
          // URL encoded data olabilir
        }
      }
      
      base64Str = dataUrlMatch[4] || '';
      originalBase64Start = str.indexOf(',') + 1;
    } else {
      // Fallback: virgülden sonrasını al
      const commaIndex = str.indexOf(',');
      if (commaIndex !== -1) {
        base64Str = str.substring(commaIndex + 1);
        originalBase64Start = commaIndex + 1;
      } else {
        result.errorCode = ERROR_CODES.INVALID_BASE64;
        result.errorMessage = 'Geçersiz Data URL formatı:  virgül bulunamadı';
        return result;
      }
    }
  }
  
  // Whitespace temizliği - pozisyon takibi ile
  const originalBase64 = base64Str;
  base64Str = base64Str.replace(/[\s\r\n]/g, '');
  result.base64Part = base64Str;
  result.length = base64Str.length;
  
  // Boş Base64 kontrolü
  if (base64Str.length === 0) {
    result.errorCode = ERROR_CODES.EMPTY_INPUT;
    result.errorMessage = 'Base64 içeriği boş';
    return result;
  }
  
  // Karakter seti kontrolü - pozisyon raporlama ile
  for (let i = 0; i < base64Str.length; i++) {
    const char = base64Str[i];
    const isValidChar = (
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z') ||
      (char >= '0' && char <= '9') ||
      char === '+' ||
      char === '/' ||
      char === '='
    );
    
    if (!isValidChar) {
      // Orijinal stringdeki pozisyonu hesapla
      let originalPosition = originalBase64Start;
      let cleanIndex = 0;
      for (let j = 0; j < originalBase64.length && cleanIndex < i; j++) {
        const origChar = originalBase64[j];
        if (origChar !== ' ' && origChar !== '\n' && origChar !== '\r' && origChar !== '\t') {
          cleanIndex++;
        }
        originalPosition++;
      }
      
      result.errorCode = ERROR_CODES.INVALID_BASE64_CHARACTERS;
      result.errorMessage = `Geçersiz karakter bulundu: '${char}' (karakter kodu: ${char.charCodeAt(0)})`;
      result.errorPosition = {
        indexInBase64: i,
        indexInOriginal: originalPosition,
        character: char,
        charCode: char.charCodeAt(0)
      };
      return result;
    }
  }
  
  // Padding kontrolü
  const paddingMatch = base64Str.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  
  if (paddingLength > 2) {
    result.errorCode = ERROR_CODES.INVALID_BASE64_PADDING;
    result.errorMessage = `Geçersiz padding: ${paddingLength} adet '=' karakteri bulundu (maksimum 2 olabilir)`;
    return result;
  }
  
  // Padding konumu kontrolü
  const equalIndex = base64Str.indexOf('=');
  if (equalIndex !== -1 && equalIndex !== base64Str.length - paddingLength) {
    result.errorCode = ERROR_CODES.INVALID_BASE64_PADDING;
    result.errorMessage = `Geçersiz padding konumu: '=' karakteri sadece string sonunda olmalıdır (pozisyon: ${equalIndex})`;
    result.errorPosition = {
      indexInBase64: equalIndex,
      expected: 'String sonu',
      found: `Pozisyon ${equalIndex}`
    };
    return result;
  }
  
  // Uzunluk kontrolü
  if (base64Str.length % 4 !== 0) {
    result.errorCode = ERROR_CODES.INVALID_BASE64_LENGTH;
    result.errorMessage = `Geçersiz uzunluk: ${base64Str.length} karakter (4'ün katı olmalı, eksik:  ${4 - (base64Str.length % 4)} karakter)`;
    return result;
  }
  
  // Decode testi
  try {
    const buffer = Buffer.from(base64Str, 'base64');
    result.decodedSize = buffer.length;
    
    // Re-encode ve karşılaştır
    const reEncoded = buffer.toString('base64');
    const normalizedOriginal = base64Str.replace(/=+$/, '');
    const normalizedReEncoded = reEncoded.replace(/=+$/, '');
    
    if (normalizedOriginal !== normalizedReEncoded) {
      result.errorCode = ERROR_CODES.INVALID_BASE64;
      result.errorMessage = 'Base64 doğrulama başarısız:  decode-encode döngüsü tutarsız sonuç verdi';
      return result;
    }
  } catch (e) {
    result.errorCode = ERROR_CODES.DECODE_ERROR;
    result.errorMessage = `Decode hatası: ${e.message}`;
    return result;
  }
  
  // Tüm kontroller başarılı
  result.valid = true;
  return result;
}

/**
 * Base64 string'in geçerli olup olmadığını kontrol eder (basit versiyon)
 * @param {string} str - Kontrol edilecek string
 * @returns {boolean} Geçerli mi
 */
function isValidBase64(str) {
  return validateBase64Detailed(str).valid;
}

/**
 * Base64 doğrulama fonksiyonu (kullanıcı dostu sonuç döner)
 * @param {string} input - Doğrulanacak Base64 string
 * @returns {Object} Doğrulama sonucu
 * @example
 * validateBase64('SGVsbG8gV29ybGQ=')
 * // { valid: true, isDataUrl: false, mimeType: null, length: 16, ...}
 */
function validateBase64(input) {
  const result = validateBase64Detailed(input);
  
  return {
    valid:  result.valid,
    isDataUrl:  result.isDataUrl,
    mimeType: result.mimeType,
    length: result.length,
    decodedSize: result.decodedSize,
    decodedSizeFormatted: formatBytes(result.decodedSize),
    reason: result.errorMessage,
    errorCode:  result.errorCode,
    errorPosition:  result.errorPosition
  };
}

// ==================== STREAM YARDIMCI FONKSİYONLARI ====================

/**
 * Dosyayı stream olarak okuyup Buffer'a çevirir
 * Büyük dosyalar için bellek yönetimi optimize edilmiş
 * @param {string} filePath - Dosya yolu
 * @param {number} maxSize - Maksimum boyut
 * @returns {Promise<Buffer>}
 * @private
 */
async function readFileAsStream(filePath, maxSize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    
    const readStream = fs.createReadStream(filePath, {
      highWaterMark:  activeConfig.streamHighWaterMark
    });
    
    readStream.on('data', (chunk) => {
      totalSize += chunk.length;
      
      if (totalSize > maxSize) {
        readStream.destroy();
        reject(new Error(`FILE_TOO_LARGE: ${totalSize}: ${maxSize}`));
        return;
      }
      
      chunks.push(chunk);
    });
    
    readStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    readStream.on('error', (error) => {
      reject(error);
    });
  });
}

// ==================== ANA FONKSİYONLAR ====================

/**
 * Metin içeriğini Base64'e encode eder
 * @param {string} text - Encode edilecek metin
 * @param {Object} options - Opsiyonlar
 * @param {string} [options.encoding='utf8'] - Metin encoding'i
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await encodeText('Merhaba Dünya');
 * console.log(result.data); // "TWVyaGFiYSBEw7xueWE="
 * 
 * // Farklı encoding ile
 * const result2 = await encodeText('Hello', { encoding: 'ascii' });
 * console.log(result2.data); // "SGVsbG8="
 */
async function encodeText(text, options = {}) {
  const { encoding = activeConfig.defaultEncoding } = options;
  
  try {
    // Tip kontrolü
    if (text === undefined) {
      return createErrorResponse(
        'Metin parametresi tanımsız (undefined)',
        ERROR_CODES.EMPTY_INPUT,
        { hint: 'encodeText fonksiyonuna bir string değeri geçirin' }
      );
    }
    
    if (text === null) {
      return createErrorResponse(
        'Metin parametresi null',
        ERROR_CODES.EMPTY_INPUT,
        { hint: 'encodeText fonksiyonuna null yerine geçerli bir string geçirin' }
      );
    }
    
    if (typeof text !== 'string') {
      return createErrorResponse(
        `Metin parametresi string olmalıdır, alınan tip: ${typeof text}`,
        ERROR_CODES.INVALID_TYPE,
        { receivedType: typeof text, expectedType: 'string' }
      );
    }
    
    if (text.length === 0) {
      return createErrorResponse(
        'Boş metin encode edilemez',
        ERROR_CODES.EMPTY_INPUT,
        { hint: 'En az bir karakter içeren metin geçirin' }
      );
    }
    
    // Encoding doğrulama
    const encodingValidation = normalizeAndValidateEncoding(encoding);
    if (!encodingValidation.valid) {
      return createErrorResponse(
        encodingValidation.error,
        ERROR_CODES.INVALID_ENCODING,
        { 
          providedEncoding: encoding,
          supportedEncodings: VALID_ENCODINGS 
        }
      );
    }
    
    const normalizedEncoding = encodingValidation.normalized;
    
    await logger.debug('encode_text_start', `Metin encode başladı`, {
      characterCount: text.length,
      encoding:  normalizedEncoding
    });
    
    // Buffer'a çevir ve encode et
    const buffer = Buffer.from(text, normalizedEncoding);
    const base64 = buffer.toString('base64');
    
    await logger.info('encode_text_success', `Metin encode başarılı`, {
      inputLength: text.length,
      outputLength: base64.length,
      byteSize: buffer.length
    });
    
    return createSuccessResponse(base64, 'text', 'memory', {
      originalLength: text.length,
      encodedLength: base64.length,
      encoding:  normalizedEncoding,
      byteSize: buffer.length,
      byteSizeFormatted:  formatBytes(buffer.length)
    });
    
  } catch (error) {
    await logger.error('encode_text_error', `Metin encode hatası: ${error.message}`, {
      errorName: error.name
    });
    
    return createErrorResponse(
      `Metin encode edilirken hata oluştu: ${error.message}`,
      ERROR_CODES.ENCODE_ERROR,
      { technicalInfo: error.message, errorName: error.name }
    );
  }
}

/**
 * Base64 stringini decode ederek metne çevirir
 * @param {string} base64String - Decode edilecek Base64 string
 * @param {Object} options - Opsiyonlar
 * @param {string} [options.encoding='utf8'] - Çıktı encoding'i
 * @param {boolean} [options.returnBuffer=false] - Buffer olarak döndür
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await decodeText('TWVyaGFiYSBEw7xueWE=');
 * console.log(result.data); // "Merhaba Dünya"
 * 
 * // Data URL'den decode
 * const result2 = await decodeText('data: text/plain;base64,SGVsbG8=');
 * console.log(result2.data); // "Hello"
 * 
 * // Buffer olarak decode
 * const result3 = await decodeText('SGVsbG8=', { returnBuffer:  true });
 * console.log(Buffer.isBuffer(result3.data)); // true
 */
async function decodeText(base64String, options = {}) {
  const {
    encoding = activeConfig.defaultEncoding,
    returnBuffer = false
  } = options;
  
  try {
    // Tip kontrolü
    if (base64String === undefined) {
      return createErrorResponse(
        'Base64 string parametresi tanımsız (undefined)',
        ERROR_CODES.EMPTY_INPUT
      );
    }
    
    if (base64String === null) {
      return createErrorResponse(
        'Base64 string parametresi null',
        ERROR_CODES.EMPTY_INPUT
      );
    }
    
    if (typeof base64String !== 'string') {
      return createErrorResponse(
        `Base64 parametresi string olmalıdır, alınan tip: ${typeof base64String}`,
        ERROR_CODES.INVALID_TYPE,
        { receivedType:  typeof base64String }
      );
    }
    
    // Encoding doğrulama (returnBuffer false ise)
    if (! returnBuffer) {
      const encodingValidation = normalizeAndValidateEncoding(encoding);
      if (!encodingValidation.valid) {
        return createErrorResponse(
          encodingValidation.error,
          ERROR_CODES.INVALID_ENCODING,
          {
            providedEncoding: encoding,
            supportedEncodings: VALID_ENCODINGS
          }
        );
      }
    }
    
    const normalizedEncoding = normalizeAndValidateEncoding(encoding).normalized || 'utf8';
    
    // Detaylı Base64 doğrulaması
    const validation = validateBase64Detailed(base64String);
    
    if (!validation.valid) {
      return createErrorResponse(
        validation.errorMessage,
        validation.errorCode,
        {
          hint: 'Geçerli Base64 formatı:  sadece A-Z, a-z, 0-9, +, / ve = karakterleri içermeli, uzunluk 4\'ün katı olmalı',
          isDataUrl: validation.isDataUrl,
          errorPosition: validation.errorPosition
        }
      );
    }
    
    await logger.debug('decode_text_start', `Base64 decode başladı`, {
      inputLength: base64String.length,
      isDataUrl: validation.isDataUrl
    });
    
    // Decode işlemi
    const buffer = Buffer.from(validation.base64Part, 'base64');
    
    if (returnBuffer) {
      await logger.info('decode_buffer_success', `Buffer decode başarılı`, {
        bufferSize: buffer.length
      });
      
      return createSuccessResponse(buffer, 'buffer', 'memory', {
        size: buffer.length,
        sizeFormatted:  formatBytes(buffer.length),
        mimeType: validation.mimeType,
        wasDataUrl: validation.isDataUrl
      });
    }
    
    const decoded = buffer.toString(normalizedEncoding);
    
    await logger.info('decode_text_success', `Metin decode başarılı`, {
      outputLength: decoded.length
    });
    
    return createSuccessResponse(decoded, 'text', 'memory', {
      decodedLength: decoded.length,
      originalBase64Length: validation.length,
      encoding:  normalizedEncoding,
      mimeType: validation.mimeType,
      wasDataUrl: validation.isDataUrl
    });
    
  } catch (error) {
    await logger.error('decode_text_error', `Base64 decode hatası: ${error.message}`);
    
    return createErrorResponse(
      `Base64 decode edilirken hata oluştu: ${error.message}`,
      ERROR_CODES.DECODE_ERROR,
      { technicalInfo: error.message }
    );
  }
}

/**
 * Local dosyayı okuyup Base64'e encode eder
 * Büyük dosyalar için stream tabanlı okuma kullanır
 * @param {string} filePath - Dosya yolu
 * @param {Object} options - Opsiyonlar
 * @param {boolean} [options.includeDataUrl=false] - Data URL formatı dahil et
 * @param {number} [options.maxSize] - Maksimum dosya boyutu (byte)
 * @param {boolean} [options.useStream=true] - Stream tabanlı okuma kullan
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await encodeFileLocal('./resim.png');
 * console.log(result.data); // Base64 string
 * 
 * // Data URL ile
 * const result2 = await encodeFileLocal('./logo.svg', { includeDataUrl: true });
 * console.log(result2.dataUrl); // "data:image/svg+xml;base64,..."
 * 
 * // Boyut limiti ile
 * const result3 = await encodeFileLocal('./buyuk.zip', { maxSize:  10 * 1024 * 1024 });
 */
async function encodeFileLocal(filePath, options = {}) {
  const {
    includeDataUrl = false,
    maxSize = activeConfig.maxFileSize,
    useStream = true
  } = options;
  
  try {
    // Parametre kontrolü
    if (! filePath) {
      return createErrorResponse(
        'Dosya yolu parametresi boş',
        ERROR_CODES.EMPTY_INPUT,
        { hint:  'Geçerli bir dosya yolu belirtin' }
      );
    }
    
    if (typeof filePath !== 'string') {
      return createErrorResponse(
        `Dosya yolu string olmalıdır, alınan tip: ${typeof filePath}`,
        ERROR_CODES.INVALID_TYPE,
        { receivedType: typeof filePath }
      );
    }
    
    // Mutlak yola çevir
    const absolutePath = path.resolve(filePath);
    const fileName = path.basename(absolutePath);
    
    await logger.debug('encode_file_start', `Dosya encode başladı`, {
      fileName:  fileName,
      path: absolutePath
    });
    
    // Dosya varlık ve erişim kontrolü
    try {
      await fsp.access(absolutePath, fs.constants.R_OK);
    } catch (accessError) {
      const errorCode = accessError.code;
      
      switch (errorCode) {
        case 'ENOENT':
          return createErrorResponse(
            `Dosya bulunamadı:  ${fileName}`,
            ERROR_CODES.FILE_NOT_FOUND,
            {
              path: absolutePath,
              systemError: errorCode,
              hint: 'Dosya yolunun doğru olduğundan emin olun'
            }
          );
          
        case 'EACCES': 
          return createErrorResponse(
            `Dosya okuma izni yok: ${fileName}`,
            ERROR_CODES.PERMISSION_DENIED,
            {
              path: absolutePath,
              systemError:  errorCode,
              hint: 'Dosya izinlerini kontrol edin'
            }
          );
          
        case 'EPERM':
          return createErrorResponse(
            `Dosya işlemi izin verilmiyor: ${fileName}`,
            ERROR_CODES.PERMISSION_DENIED,
            {
              path: absolutePath,
              systemError: errorCode,
              hint: 'Yönetici hakları gerekebilir'
            }
          );
          
        default: 
          return createErrorResponse(
            `Dosya erişim hatası: ${accessError.message}`,
            ERROR_CODES.FILE_READ_ERROR,
            {
              path:  absolutePath,
              systemError: errorCode
            }
          );
      }
    }
    
    // Dosya bilgilerini al
    const stats = await fsp.stat(absolutePath);
    
    // Dizin kontrolü
    if (stats.isDirectory()) {
      return createErrorResponse(
        `Belirtilen yol bir dizin, dosya değil: ${fileName}`,
        ERROR_CODES.IS_DIRECTORY,
        {
          path: absolutePath,
          hint: 'Bir dosya yolu belirtin, dizin değil'
        }
      );
    }
    
    // Boyut kontrolü
    if (stats.size > maxSize) {
      return createErrorResponse(
        `Dosya çok büyük:  ${formatBytes(stats.size)} (maksimum: ${formatBytes(maxSize)})`,
        ERROR_CODES.FILE_TOO_LARGE,
        {
          fileSize: stats.size,
          fileSizeFormatted: formatBytes(stats.size),
          maxSize: maxSize,
          maxSizeFormatted: formatBytes(maxSize),
          hint: 'maxSize parametresi ile limiti artırabilirsiniz'
        }
      );
    }
    
    // Dosyayı oku (stream veya normal)
    let buffer;
    
    if (useStream && stats.size > activeConfig.streamHighWaterMark * 2) {
      // Büyük dosyalar için stream kullan
      await logger.debug('encode_file_stream', `Stream ile okuma:  ${formatBytes(stats.size)}`);
      
      try {
        buffer = await readFileAsStream(absolutePath, maxSize);
      } catch (streamError) {
        if (streamError.message.startsWith('FILE_TOO_LARGE: ')) {
          const [, size, max] = streamError.message.split(':');
          return createErrorResponse(
            `Dosya okuma sırasında boyut limiti aşıldı`,
            ERROR_CODES.FILE_TOO_LARGE,
            {
              readSize: parseInt(size, 10),
              maxSize: parseInt(max, 10)
            }
          );
        }
        throw streamError;
      }
    } else {
      // Küçük dosyalar için normal okuma
      buffer = await fsp.readFile(absolutePath);
    }
    
    const base64 = buffer.toString('base64');
    
    // MIME tipi ve görsel kontrolü
    const mimeType = getMimeType(absolutePath);
    const isImage = isImageExtension(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    
    // Data URL oluştur
    let dataUrl = null;
    if (includeDataUrl) {
      dataUrl = `data:${mimeType};base64,${base64}`;
    }
    
    await logger.info('encode_file_success', `Dosya encode başarılı`, {
      fileName: fileName,
      fileSize: formatBytes(stats.size),
      mimeType:  mimeType
    });
    
    return createSuccessResponse(base64, isImage ? 'image' : 'file', 'local', {
      fileName: fileName,
      filePath: absolutePath,
      fileSize:  stats.size,
      fileSizeFormatted: formatBytes(stats.size),
      mimeType: mimeType,
      isImage: isImage,
      extension: extension,
      encodedLength: base64.length,
      dataUrl: dataUrl,
      modifiedTime: stats.mtime.toISOString(),
      createdTime: stats.birthtime.toISOString()
    });
    
  } catch (error) {
    await logger.error('encode_file_error', `Dosya encode hatası: ${error.message}`, {
      filePath: filePath
    });
    
    // Hata tipine göre uygun kod belirle
    let errorCode = ERROR_CODES.FILE_READ_ERROR;
    if (error.code === 'ENOENT') {
      errorCode = ERROR_CODES.FILE_NOT_FOUND;
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      errorCode = ERROR_CODES.PERMISSION_DENIED;
    }
    
    return createErrorResponse(
      `Dosya encode edilirken hata oluştu: ${error.message}`,
      errorCode,
      {
        technicalInfo: error.message,
        filePath: filePath,
        systemError: error.code
      }
    );
  }
}

/**
 * URL'den içerik indirip Base64'e encode eder
 * @param {string} url - İçerik URL'i
 * @param {Object} options - Opsiyonlar
 * @param {number} [options.timeout] - İstek zaman aşımı (ms)
 * @param {number} [options.maxSize] - Maksimum içerik boyutu (byte)
 * @param {boolean} [options.includeDataUrl=false] - Data URL formatı dahil et
 * @param {boolean} [options.followRedirects=true] - Yönlendirmeleri takip et
 * @param {number} [options.maxRedirects] - Maksimum yönlendirme sayısı
 * @param {Object} [options.headers] - Özel HTTP başlıkları
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await encodeFromURL('https://example.com/image.jpg');
 * console.log(result.data); // Base64 string
 * 
 * // Özel ayarlarla
 * const result2 = await encodeFromURL('https://api.example.com/file', {
 *   timeout: 60000,
 *   maxSize: 100 * 1024 * 1024,
 *   includeDataUrl: true,
 *   headers: { 'Authorization': 'Bearer token123' }
 * });
 */
async function encodeFromURL(url, options = {}) {
  const {
    timeout = activeConfig.timeout,
    maxSize = activeConfig.maxUrlContentSize,
    includeDataUrl = false,
    followRedirects = activeConfig.followRedirects,
    maxRedirects = activeConfig.maxRedirects,
    headers:  customHeaders = {}
  } = options;
  
  try {
    // URL kontrolü
    if (!url) {
      return createErrorResponse(
        'URL parametresi boş',
        ERROR_CODES.EMPTY_INPUT,
        { hint: 'Geçerli bir URL belirtin' }
      );
    }
    
    if (typeof url !== 'string') {
      return createErrorResponse(
        `URL parametresi string olmalıdır, alınan tip: ${typeof url}`,
        ERROR_CODES.INVALID_TYPE,
        { receivedType: typeof url }
      );
    }
    
    // URL parse
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (urlError) {
      return createErrorResponse(
        `Geçersiz URL formatı: ${url}`,
        ERROR_CODES.URL_INVALID,
        { 
          url:  url, 
          hint:  'URL http: // veya https:// ile başlamalıdır',
          parseError: urlError.message
        }
      );
    }
    
    // Protokol kontrolü
    if (! ['http:', 'https:'].includes(parsedUrl.protocol)) {
      return createErrorResponse(
        `Desteklenmeyen protokol: ${parsedUrl.protocol}`,
        ERROR_CODES.URL_INVALID,
        {
          protocol: parsedUrl.protocol,
          supportedProtocols:  ['http:', 'https:'],
          hint: 'Sadece HTTP ve HTTPS protokolleri desteklenir'
        }
      );
    }
    
    await logger.debug('encode_url_start', `URL encode başladı`, {
      hostname: parsedUrl.hostname,
      protocol: parsedUrl.protocol,
      timeout: timeout,
      maxSize:  formatBytes(maxSize)
    });
    
    // İçeriği indir
    const result = await new Promise((resolve, reject) => {
      let redirectCount = 0;
      let currentUrl = url;
      
      const makeRequest = (requestUrl) => {
        const currentParsedUrl = new URL(requestUrl);
        const httpModule = currentParsedUrl.protocol === 'https:' ? https : http;
        
        const requestOptions = {
          hostname: currentParsedUrl.hostname,
          port: currentParsedUrl.port || (currentParsedUrl.protocol === 'https:' ? 443 : 80),
          path: currentParsedUrl.pathname + currentParsedUrl.search,
          method: 'GET',
          timeout: timeout,
          headers: {
            'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Base64Encoder/3.0',
            'Accept':  '*/*',
            'Accept-Encoding': 'identity',
            'Connection': 'close',
            ...customHeaders
          }
        };
        
        const request = httpModule.request(requestOptions, (response) => {
          const statusCode = response.statusCode;
          const responseHeaders = response.headers;
          
          // Redirect kontrolü (3xx)
          if (statusCode >= 300 && statusCode < 400) {
            if (! followRedirects) {
              reject({
                code: ERROR_CODES.URL_FETCH_ERROR,
                message:  `Yönlendirme engellendi (HTTP ${statusCode})`,
                statusCode: statusCode,
                responseInfo: {
                  headers: responseHeaders,
                  redirectDisabled: true
                }
              });
              return;
            }
            
            redirectCount++;
            if (redirectCount > maxRedirects) {
              reject({
                code: ERROR_CODES.URL_REDIRECT_LIMIT,
                message: `Maksimum yönlendirme sayısı aşıldı:  ${redirectCount}/${maxRedirects}`,
                statusCode: statusCode,
                responseInfo: {
                  redirectCount: redirectCount,
                  maxRedirects: maxRedirects,
                  lastUrl: requestUrl
                }
              });
              return;
            }
            
            const redirectUrl = responseHeaders.location;
            if (!redirectUrl) {
              reject({
                code: ERROR_CODES.URL_REDIRECT_MISSING,
                message:  'Yönlendirme URL\'i (Location header) bulunamadı',
                statusCode: statusCode,
                responseInfo:  {
                  headers: responseHeaders
                }
              });
              return;
            }
            
            // Göreceli URL'yi mutlak URL'ye çevir
            let absoluteRedirectUrl;
            try {
              absoluteRedirectUrl = new URL(redirectUrl, requestUrl).href;
            } catch (e) {
              reject({
                code:  ERROR_CODES.URL_INVALID,
                message:  `Geçersiz yönlendirme URL'i: ${redirectUrl}`,
                statusCode: statusCode,
                responseInfo: {
                  redirectUrl: redirectUrl,
                  parseError: e.message
                }
              });
              return;
            }
            
            logger.debug('encode_url_redirect', `Yönlendirme takip ediliyor`, {
              from: requestUrl,
              to: absoluteRedirectUrl,
              redirectCount: redirectCount
            });
            
            currentUrl = absoluteRedirectUrl;
            makeRequest(absoluteRedirectUrl);
            return;
          }
          
          // HTTP hata kontrolü (4xx - Client hataları)
          if (statusCode >= 400 && statusCode < 500) {
            let errorCode = ERROR_CODES.HTTP_CLIENT_ERROR;
            let errorMessage = `İstemci hatası: HTTP ${statusCode}`;
            
            switch (statusCode) {
              case 400:
                errorMessage = 'Geçersiz istek (400 Bad Request)';
                break;
              case 401:
                errorCode = ERROR_CODES.HTTP_UNAUTHORIZED;
                errorMessage = 'Yetkilendirme gerekli (401 Unauthorized)';
                break;
              case 403:
                errorCode = ERROR_CODES.HTTP_FORBIDDEN;
                errorMessage = 'Erişim yasaklandı (403 Forbidden)';
                break;
              case 404:
                errorCode = ERROR_CODES.HTTP_NOT_FOUND;
                errorMessage = 'İçerik bulunamadı (404 Not Found)';
                break;
              case 405:
                errorMessage = 'Metod izin verilmiyor (405 Method Not Allowed)';
                break;
              case 408:
                errorCode = ERROR_CODES.URL_TIMEOUT;
                errorMessage = 'İstek zaman aşımı (408 Request Timeout)';
                break;
              case 429:
                errorMessage = 'Çok fazla istek (429 Too Many Requests)';
                break;
            }
            
            reject({
              code: errorCode,
              message: errorMessage,
              statusCode: statusCode,
              responseInfo: {
                statusText: response.statusMessage,
                headers: {
                  contentType: responseHeaders['content-type'],
                  retryAfter: responseHeaders['retry-after']
                }
              }
            });
            return;
          }
          
          // HTTP hata kontrolü (5xx - Server hataları)
          if (statusCode >= 500) {
            let errorMessage = `Sunucu hatası: HTTP ${statusCode}`;
            
            switch (statusCode) {
              case 500:
                errorMessage = 'Sunucu iç hatası (500 Internal Server Error)';
                break;
              case 501:
                errorMessage = 'Desteklenmeyen özellik (501 Not Implemented)';
                break;
              case 502:
                errorMessage = 'Geçersiz ağ geçidi (502 Bad Gateway)';
                break;
              case 503:
                errorMessage = 'Hizmet kullanılamıyor (503 Service Unavailable)';
                break;
              case 504:
                errorMessage = 'Ağ geçidi zaman aşımı (504 Gateway Timeout)';
                break;
            }
            
            reject({
              code: ERROR_CODES.HTTP_SERVER_ERROR,
              message: errorMessage,
              statusCode:  statusCode,
              responseInfo: {
                statusText: response.statusMessage,
                headers: {
                  retryAfter: responseHeaders['retry-after']
                }
              }
            });
            return;
          }
          
          // Başarılı olmayan diğer durumlar
          if (statusCode < 200 || statusCode >= 300) {
            reject({
              code: ERROR_CODES.URL_FETCH_ERROR,
              message: `Beklenmeyen HTTP durumu: ${statusCode} ${response.statusMessage}`,
              statusCode: statusCode,
              responseInfo: {
                statusText: response.statusMessage
              }
            });
            return;
          }
          
          // Content-Length kontrolü
          const contentLength = parseInt(responseHeaders['content-length'], 10);
          if (contentLength && contentLength > maxSize) {
            request.destroy();
            reject({
              code: ERROR_CODES.URL_CONTENT_TOO_LARGE,
              message: `İçerik çok büyük: ${formatBytes(contentLength)} (maksimum:  ${formatBytes(maxSize)})`,
              statusCode: statusCode,
              responseInfo:  {
                contentLength: contentLength,
                contentLengthFormatted: formatBytes(contentLength),
                maxSize: maxSize,
                maxSizeFormatted: formatBytes(maxSize)
              }
            });
            return;
          }
          
          // İçeriği oku
          const chunks = [];
          let totalSize = 0;
          
          response.on('data', (chunk) => {
            totalSize += chunk.length;
            
            if (totalSize > maxSize) {
              request.destroy();
              reject({
                code: ERROR_CODES.URL_CONTENT_TOO_LARGE,
                message: `İndirme sırasında boyut limiti aşıldı: ${formatBytes(totalSize)}`,
                statusCode: statusCode,
                responseInfo: {
                  downloadedSize: totalSize,
                  downloadedSizeFormatted: formatBytes(totalSize),
                  maxSize: maxSize,
                  maxSizeFormatted: formatBytes(maxSize)
                }
              });
              return;
            }
            
            chunks.push(chunk);
          });
          
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const contentType = responseHeaders['content-type'] || 'application/octet-stream';
            
            resolve({
              buffer: buffer,
              contentType: contentType,
              size: buffer.length,
              statusCode: statusCode,
              headers: responseHeaders,
              finalUrl: currentUrl,
              redirectCount:  redirectCount
            });
          });
          
          response.on('error', (error) => {
            reject({
              code: ERROR_CODES.NETWORK_ERROR,
              message: `Yanıt okuma hatası: ${error.message}`,
              statusCode: statusCode,
              responseInfo: {
                errorName: error.name,
                errorCode: error.code
              }
            });
          });
        });
        
        // Timeout
        request.on('timeout', () => {
          request.destroy();
          reject({
            code: ERROR_CODES.URL_TIMEOUT,
            message:  `İstek zaman aşımına uğradı:  ${timeout}ms`,
            statusCode:  null,
            responseInfo: {
              timeout: timeout,
              timeoutFormatted: `${timeout / 1000} saniye`
            }
          });
        });
        
        // Bağlantı hataları
        request.on('error', (error) => {
          let errorCode = ERROR_CODES.NETWORK_ERROR;
          let errorMessage = error.message;
          
          switch (error.code) {
            case 'ENOTFOUND':
              errorCode = ERROR_CODES.DNS_ERROR;
              errorMessage = `DNS çözümleme hatası: '${parsedUrl.hostname}' bulunamadı`;
              break;
            case 'ECONNREFUSED':
              errorCode = ERROR_CODES.CONNECTION_REFUSED;
              errorMessage = `Bağlantı reddedildi:  ${parsedUrl.host}`;
              break;
            case 'ECONNRESET': 
              errorCode = ERROR_CODES.NETWORK_ERROR;
              errorMessage = 'Bağlantı uzak sunucu tarafından sıfırlandı';
              break;
            case 'ETIMEDOUT':
              errorCode = ERROR_CODES.TIMEOUT_ERROR;
              errorMessage = 'Bağlantı zaman aşımına uğradı';
              break;
            case 'EPIPE':
              errorCode = ERROR_CODES.NETWORK_ERROR;
              errorMessage = 'Bağlantı beklenmedik şekilde kapandı';
              break;
            case 'CERT_HAS_EXPIRED':
              errorCode = ERROR_CODES.SSL_ERROR;
              errorMessage = 'SSL sertifikası süresi dolmuş';
              break;
            case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
              errorCode = ERROR_CODES.SSL_ERROR;
              errorMessage = 'SSL sertifikası doğrulanamadı';
              break;
            case 'DEPTH_ZERO_SELF_SIGNED_CERT':
              errorCode = ERROR_CODES.SSL_ERROR;
              errorMessage = 'Kendinden imzalı SSL sertifikası';
              break;
            case 'ERR_TLS_CERT_ALTNAME_INVALID': 
              errorCode = ERROR_CODES.SSL_ERROR;
              errorMessage = 'SSL sertifikası hostname eşleşmiyor';
              break;
          }
          
          reject({
            code: errorCode,
            message: errorMessage,
            statusCode: null,
            responseInfo: {
              errorName: error.name,
              systemError: error.code,
              hostname: parsedUrl.hostname
            }
          });
        });
        
        request.end();
      };
      
      makeRequest(url);
    });
    
    // Base64 encode
    const base64 = result.buffer.toString('base64');
    
    // MIME tipi belirle
    const contentTypeParts = result.contentType.split(';');
    const mimeType = contentTypeParts[0].trim();
    const charset = contentTypeParts.find(p => p.trim().startsWith('charset='));
    const isImage = mimeType.startsWith('image/');
    
    // Data URL oluştur
    let dataUrl = null;
    if (includeDataUrl) {
      dataUrl = `data:${mimeType};base64,${base64}`;
    }
    
    await logger.info('encode_url_success', `URL encode başarılı`, {
      hostname: parsedUrl.hostname,
      size: formatBytes(result.size),
      mimeType: mimeType,
      redirectCount: result.redirectCount
    });
    
    return createSuccessResponse(base64, isImage ? 'image' : 'file', 'url', {
      url: url,
      finalUrl: result.finalUrl,
      hostname: parsedUrl.hostname,
      contentType: mimeType,
      charset: charset ?  charset.split('=')[1] : null,
      size: result.size,
      sizeFormatted:  formatBytes(result.size),
      isImage: isImage,
      encodedLength: base64.length,
      dataUrl: dataUrl,
      redirectCount: result.redirectCount,
      responseHeaders: {
        contentType: result.headers['content-type'],
        contentLength: result.headers['content-length'],
        lastModified: result.headers['last-modified'],
        etag: result.headers['etag'],
        cacheControl: result.headers['cache-control']
      }
    });
    
  } catch (error) {
    // Yapılandırılmış hata objesi mi kontrol et
    if (error.code && error.message) {
      await logger.error('encode_url_error', `URL encode hatası: ${error.message}`, {
        url: url,
        errorCode: error.code,
        statusCode: error.statusCode
      });
      
      return createErrorResponse(
        error.message,
        error.code,
        {
          url: url,
          statusCode: error.statusCode,
          responseInfo: error.responseInfo
        }
      );
    }
    
    // Beklenmeyen hata
    await logger.error('encode_url_error', `URL encode hatası: ${error.message}`, {
      url:  url
    });
    
    return createErrorResponse(
      `URL encode edilirken beklenmeyen hata: ${error.message}`,
      ERROR_CODES.INTERNAL_ERROR,
      {
        url:  url,
        technicalInfo: error.message,
        errorName: error.name
      }
    );
  }
}

/**
 * Buffer'ı Base64'e encode eder
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer - Encode edilecek buffer
 * @param {Object} options - Opsiyonlar
 * @param {string} [options.mimeType='application/octet-stream'] - MIME tipi
 * @param {boolean} [options.includeDataUrl=false] - Data URL formatı dahil et
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Buffer encode
 * const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
 * const result = await encodeBuffer(buffer);
 * console.log(result.data); // "SGVsbG8="
 * 
 * // MIME tipi ile
 * const result2 = await encodeBuffer(pngBuffer, {
 *   mimeType: 'image/png',
 *   includeDataUrl: true
 * });
 * console.log(result2.dataUrl); // "data:image/png;base64,..."
 */
async function encodeBuffer(buffer, options = {}) {
  const {
    mimeType = 'application/octet-stream',
    includeDataUrl = false
  } = options;
  
  try {
    // Tip kontrolü
    if (buffer === undefined) {
      return createErrorResponse(
        'Buffer parametresi tanımsız (undefined)',
        ERROR_CODES.EMPTY_INPUT
      );
    }
    
    if (buffer === null) {
      return createErrorResponse(
        'Buffer parametresi null',
        ERROR_CODES.EMPTY_INPUT
      );
    }
    
    // Buffer tipini belirle ve dönüştür
    let actualBuffer;
    let inputType;
    
    if (Buffer.isBuffer(buffer)) {
      actualBuffer = buffer;
      inputType = 'Buffer';
    } else if (buffer instanceof Uint8Array) {
      actualBuffer = Buffer.from(buffer);
      inputType = 'Uint8Array';
    } else if (buffer instanceof ArrayBuffer) {
      actualBuffer = Buffer.from(buffer);
      inputType = 'ArrayBuffer';
    } else if (Array.isArray(buffer) && buffer.every(b => typeof b === 'number')) {
      // Byte array
      actualBuffer = Buffer.from(buffer);
      inputType = 'ByteArray';
    } else {
      return createErrorResponse(
        `Parametre geçerli bir Buffer, Uint8Array veya ArrayBuffer değil, alınan tip: ${typeof buffer}`,
        ERROR_CODES.INVALID_TYPE,
        {
          receivedType: typeof buffer,
          expectedTypes: ['Buffer', 'Uint8Array', 'ArrayBuffer', 'number[]']
        }
      );
    }
    
    if (actualBuffer.length === 0) {
      return createErrorResponse(
        'Boş buffer encode edilemez',
        ERROR_CODES.EMPTY_INPUT,
        { hint:  'En az 1 byte içeren buffer geçirin' }
      );
    }
    
    await logger.debug('encode_buffer_start', `Buffer encode başladı`, {
      bufferSize: actualBuffer.length,
      inputType: inputType
    });
    
    const base64 = actualBuffer.toString('base64');
    
    // Data URL oluştur
    let dataUrl = null;
    if (includeDataUrl) {
      dataUrl = `data:${mimeType};base64,${base64}`;
    }
    
    await logger.info('encode_buffer_success', `Buffer encode başarılı`, {
      inputSize: formatBytes(actualBuffer.length),
      outputLength: base64.length
    });
    
    return createSuccessResponse(base64, 'buffer', 'memory', {
      size: actualBuffer.length,
      sizeFormatted: formatBytes(actualBuffer.length),
      mimeType: mimeType,
      inputType: inputType,
      encodedLength: base64.length,
      dataUrl: dataUrl
    });
    
  } catch (error) {
    await logger.error('encode_buffer_error', `Buffer encode hatası: ${error.message}`);
    
    return createErrorResponse(
      `Buffer encode edilirken hata oluştu: ${error.message}`,
      ERROR_CODES.ENCODE_ERROR,
      { technicalInfo: error.message }
    );
  }
}

/**
 * JSON objesini Base64'e encode eder
 * @param {Object|Array} jsonObject - Encode edilecek JSON objesi veya array
 * @param {Object} options - Opsiyonlar
 * @param {boolean} [options.pretty=false] - Formatlanmış JSON çıktısı
 * @param {number} [options.indent=2] - Girinti boşluk sayısı (pretty=true ise)
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await encodeJSON({ name: 'Test', value: 123 });
 * console.log(result.data); // "eyJuYW1lIjoiVGVzdCIsInZhbHVlIjoxMjN9"
 * 
 * // Formatlanmış JSON
 * const result2 = await encodeJSON({ key: 'value' }, { pretty: true });
 */
async function encodeJSON(jsonObject, options = {}) {
  const { pretty = false, indent = 2 } = options;
  
  try {
    // Tip kontrolü
    if (jsonObject === undefined) {
      return createErrorResponse(
        'JSON objesi tanımsız (undefined)',
        ERROR_CODES.EMPTY_INPUT
      );
    }
    
    if (jsonObject === null) {
      // null değeri JSON'da geçerli, encode edilebilir
      const jsonString = 'null';
      const buffer = Buffer.from(jsonString, 'utf8');
      const base64 = buffer.toString('base64');
      
      return createSuccessResponse(base64, 'json', 'memory', {
        originalLength: jsonString.length,
        encodedLength: base64.length,
        isNull: true
      });
    }
    
    // Serialize edilemez tipler
    if (typeof jsonObject === 'function') {
      return createErrorResponse(
        'Fonksiyonlar JSON olarak encode edilemez',
        ERROR_CODES.INVALID_TYPE,
        { receivedType: 'function' }
      );
    }
    
    if (typeof jsonObject === 'symbol') {
      return createErrorResponse(
        'Symbol değerler JSON olarak encode edilemez',
        ERROR_CODES.INVALID_TYPE,
        { receivedType:  'symbol' }
      );
    }
    
    if (typeof jsonObject === 'bigint') {
      return createErrorResponse(
        'BigInt değerler doğrudan JSON olarak encode edilemez',
        ERROR_CODES.INVALID_TYPE,
        {
          receivedType: 'bigint',
          hint: 'BigInt değeri stringe çevirin:  bigintValue.toString()'
        }
      );
    }
    
    await logger.debug('encode_json_start', 'JSON encode başladı', {
      type: Array.isArray(jsonObject) ? 'array' : typeof jsonObject
    });
    
    // JSON stringify
    let jsonString;
    try {
      jsonString = pretty
        ? JSON.stringify(jsonObject, null, indent)
        : JSON.stringify(jsonObject);
    } catch (stringifyError) {
      // Circular reference veya diğer stringify hataları
      let hint = 'JSON.stringify hatası oluştu';
      
      if (stringifyError.message.includes('circular')) {
        hint = 'Obje döngüsel referans içeriyor.Döngüsel referansları kaldırın.';
      } else if (stringifyError.message.includes('BigInt')) {
        hint = 'Obje BigInt değer içeriyor.BigInt değerlerini stringe çevirin.';
      }
      
      return createErrorResponse(
        `JSON stringify hatası: ${stringifyError.message}`,
        ERROR_CODES.JSON_STRINGIFY_ERROR,
        {
          technicalInfo:  stringifyError.message,
          hint: hint
        }
      );
    }
    
    // Base64 encode
    const buffer = Buffer.from(jsonString, 'utf8');
    const base64 = buffer.toString('base64');
    
    // Obje istatistikleri
    let keyCount = 0;
    let isArray = false;
    let depth = 1;
    
    if (typeof jsonObject === 'object' && jsonObject !== null) {
      isArray = Array.isArray(jsonObject);
      if (isArray) {
        keyCount = jsonObject.length;
      } else {
        keyCount = Object.keys(jsonObject).length;
      }
    }
    
    await logger.info('encode_json_success', `JSON encode başarılı`, {
      jsonLength: jsonString.length,
      base64Length: base64.length,
      keyCount: keyCount
    });
    
    return createSuccessResponse(base64, 'json', 'memory', {
      originalLength: jsonString.length,
      encodedLength:  base64.length,
      byteSize: buffer.length,
      keyCount: keyCount,
      isArray:  isArray,
      pretty: pretty
    });
    
  } catch (error) {
    await logger.error('encode_json_error', `JSON encode hatası: ${error.message}`);
    
    return createErrorResponse(
      `JSON encode edilirken hata oluştu: ${error.message}`,
      ERROR_CODES.ENCODE_ERROR,
      { technicalInfo: error.message }
    );
  }
}

/**
 * Base64 stringini decode ederek JSON objesine çevirir
 * @param {string} base64String - Decode edilecek Base64 string
 * @param {Object} options - Opsiyonlar
 * @param {Function} [options.reviver] - JSON.parse reviver fonksiyonu
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Basit kullanım
 * const result = await decodeJSON('eyJuYW1lIjoiVGVzdCJ9');
 * console.log(result.data); // { name: "Test" }
 * 
 * // Reviver ile
 * const result2 = await decodeJSON(base64, {
 *   reviver: (key, value) => {
 *     if (key === 'date') return new Date(value);
 *     return value;
 *   }
 * });
 */
async function decodeJSON(base64String, options = {}) {
  const { reviver = null } = options;
  
  try {
    // Önce text olarak decode et
    const textResult = await decodeText(base64String, { encoding: 'utf8' });
    
    if (! textResult.success) {
      return textResult; // Hata zaten formatlanmış
    }
    
    await logger.debug('decode_json_parse', 'JSON parse ediliyor', {
      textLength: textResult.data.length
    });
    
    // JSON parse
    let jsonObject;
    try {
      jsonObject = reviver
        ? JSON.parse(textResult.data, reviver)
        : JSON.parse(textResult.data);
    } catch (parseError) {
      // Parse hatası detayları
      let position = null;
      const positionMatch = parseError.message.match(/position\s+(\d+)/i);
      if (positionMatch) {
        position = parseInt(positionMatch[1], 10);
      }
      
      // Hata bağlamını göster
      let context = null;
      if (position !== null && textResult.data.length > 0) {
        const start = Math.max(0, position - 20);
        const end = Math.min(textResult.data.length, position + 20);
        context = {
          before: textResult.data.substring(start, position),
          errorChar: textResult.data[position] || '[EOF]',
          after: textResult.data.substring(position + 1, end)
        };
      }
      
      return createErrorResponse(
        `Geçersiz JSON formatı: ${parseError.message}`,
        ERROR_CODES.JSON_PARSE_ERROR,
        {
          technicalInfo: parseError.message,
          position: position,
          context: context,
          hint: 'Base64 decode edilen içerik geçerli JSON formatında değil'
        }
      );
    }
    
    // Obje istatistikleri
    let keyCount = 0;
    let isArray = false;
    let dataType = typeof jsonObject;
    
    if (jsonObject !== null && typeof jsonObject === 'object') {
      isArray = Array.isArray(jsonObject);
      if (isArray) {
        keyCount = jsonObject.length;
      } else {
        keyCount = Object.keys(jsonObject).length;
      }
    }
    
    await logger.info('decode_json_success', 'JSON decode başarılı', {
      keyCount: keyCount,
      isArray: isArray,
      dataType:  dataType
    });
    
    return createSuccessResponse(jsonObject, 'json', 'memory', {
      keyCount: keyCount,
      isArray:  isArray,
      dataType: dataType,
      originalBase64Length: base64String.length,
      jsonLength: textResult.data.length
    });
    
  } catch (error) {
    await logger.error('decode_json_error', `JSON decode hatası:  ${error.message}`);
    
    return createErrorResponse(
      `JSON decode edilirken hata oluştu:  ${error.message}`,
      ERROR_CODES.DECODE_ERROR,
      { technicalInfo:  error.message }
    );
  }
}

/**
 * Akıllı otomatik encode fonksiyonu
 * Girdi tipini otomatik algılar ve uygun encode fonksiyonunu çağırır
 * @param {any} input - Encode edilecek içerik
 * @param {string} [type=null] - Zorla belirtilecek tip (opsiyonel)
 * @param {Object} options - Opsiyonlar
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Metin encode
 * await universalAutoEncode('Merhaba Dünya');
 * 
 * // Dosya encode
 * await universalAutoEncode('./resim.png');
 * 
 * // URL encode
 * await universalAutoEncode('https://example.com/image.jpg');
 * 
 * // JSON encode
 * await universalAutoEncode({ key: 'value' });
 * 
 * // Buffer encode
 * await universalAutoEncode(Buffer.from('test'));
 */
async function universalAutoEncode(input, type = null, options = {}) {
  try {
    // Tip algılama
    const detectedType = type || detectInputType(input);
    
    await logger.debug('auto_encode_start', `Otomatik encode başladı`, {
      detectedType: detectedType,
      forcedType: type
    });
    
    switch (detectedType) {
      case 'text':
        return await encodeText(input, options);
        
      case 'file':
        return await encodeFileLocal(input, options);
        
      case 'url': 
        return await encodeFromURL(input, options);
        
      case 'buffer': 
        return await encodeBuffer(input, options);
        
      case 'uint8array':
        // Uint8Array'i Buffer'a çevir
        return await encodeBuffer(Buffer.from(input), options);
        
      case 'arraybuffer':
        // ArrayBuffer'ı Buffer'a çevir (view kullanarak)
        return await encodeBuffer(Buffer.from(new Uint8Array(input)), options);
        
      case 'object':
        return await encodeJSON(input, options);
        
      case 'array':
        return await encodeJSON(input, options);
        
      case 'base64':
        // Zaten Base64 ise doğrula ve döndür
        const validation = validateBase64(input);
        if (validation.valid) {
          await logger.info('auto_encode_already_base64', 'Girdi zaten Base64 formatında');
          return createSuccessResponse(input, 'base64', 'input', {
            note: 'Girdi zaten geçerli Base64 formatında',
            length: input.length,
            decodedSize: validation.decodedSize,
            decodedSizeFormatted:  validation.decodedSizeFormatted,
            isDataUrl: validation.isDataUrl,
            mimeType: validation.mimeType
          });
        }
        // Geçersizse metin olarak encode et
        return await encodeText(input, options);
        
      case 'dataurl':
        // Data URL'den Base64 kısmını çıkar
        const dataUrlInfo = fromDataUrl(input);
        
        if (dataUrlInfo.valid && dataUrlInfo.base64) {
          await logger.info('auto_encode_dataurl_extracted', 'Data URL\'den Base64 çıkarıldı');
          return createSuccessResponse(dataUrlInfo.base64, 'base64', 'dataurl', {
            mimeType: dataUrlInfo.mimeType,
            encoding: dataUrlInfo.encoding,
            originalLength: input.length,
            base64Length: dataUrlInfo.base64.length
          });
        }
        
        return createErrorResponse(
          'Geçersiz Data URL formatı',
          ERROR_CODES.INVALID_INPUT,
          { hint: 'Data URL formatı:  data:[<mediatype>][;base64],<data>' }
        );
        
      case 'number':
        return await encodeText(String(input), options);
        
      case 'boolean': 
        return await encodeText(String(input), options);
        
      case 'date':
        return await encodeText(input.toISOString(), options);
        
      case 'null': 
        return await encodeJSON(null, options);
        
      case 'undefined': 
        return createErrorResponse(
          'undefined değer encode edilemez',
          ERROR_CODES.EMPTY_INPUT
        );
        
      case 'empty':
        return createErrorResponse(
          'Boş girdi encode edilemez',
          ERROR_CODES.EMPTY_INPUT
        );
        
      case 'stream':
        return createErrorResponse(
          'Stream doğrudan encode edilemez',
          ERROR_CODES.UNSUPPORTED_FORMAT,
          {
            hint: 'Stream\'i önce Buffer\'a çevirin.Örnek: const chunks = []; stream.on("data", c => chunks.push(c)); stream.on("end", () => Buffer.concat(chunks))'
          }
        );
        
      case 'function':
        return createErrorResponse(
          'Fonksiyonlar encode edilemez',
          ERROR_CODES.UNSUPPORTED_FORMAT
        );
        
      case 'symbol': 
        return createErrorResponse(
          'Symbol değerler encode edilemez',
          ERROR_CODES.UNSUPPORTED_FORMAT
        );
        
      case 'bigint':
        // BigInt'i string olarak encode et
        return await encodeText(input.toString(), options);
        
      case 'ftp':
        return createErrorResponse(
          'FTP protokolü desteklenmiyor',
          ERROR_CODES.UNSUPPORTED_FORMAT,
          { hint: 'Sadece HTTP ve HTTPS protokolleri desteklenir' }
        );
        
      case 'fileurl':
        // file: // URL'sini dosya yoluna çevir
        try {
          const filePath = new URL(input).pathname;
          return await encodeFileLocal(filePath, options);
        } catch (e) {
          return createErrorResponse(
            `Geçersiz file: // URL formatı: ${e.message}`,
            ERROR_CODES.URL_INVALID
          );
        }
        
      case 'map':
        // Map'i object'e çevir
        return await encodeJSON(Object.fromEntries(input), options);
        
      case 'set':
        // Set'i array'e çevir
        return await encodeJSON([...input], options);
        
      case 'regexp':
        // RegExp'i string olarak encode et
        return await encodeText(input.toString(), options);
        
      case 'error':
        // Error objesini JSON olarak encode et
        return await encodeJSON({
          name: input.name,
          message: input.message,
          stack:  input.stack
        }, options);
        
      case 'promise':
        return createErrorResponse(
          'Promise doğrudan encode edilemez',
          ERROR_CODES.UNSUPPORTED_FORMAT,
          { hint: 'Promise\'i await ile çözümleyin:  await promise' }
        );
        
      case 'unknown':
      default:
        return createErrorResponse(
          `Girdi türü algılanamadı veya desteklenmiyor:  ${detectedType}`,
          ERROR_CODES.UNKNOWN_TYPE,
          {
            receivedType: typeof input,
            detectedType: detectedType,
            hint: 'Desteklenen tipler: text, file, url, buffer, object, array, base64, dataurl'
          }
        );
    }
    
  } catch (error) {
    await logger.error('auto_encode_error', `Otomatik encode hatası: ${error.message}`);
    
    return createErrorResponse(
      `Otomatik encode sırasında hata oluştu: ${error.message}`,
      ERROR_CODES.INTERNAL_ERROR,
      { technicalInfo:  error.message }
    );
  }
}

/**
 * Akıllı otomatik decode fonksiyonu
 * Hedef tipe göre decode işlemi yapar
 * @param {string} base64String - Decode edilecek Base64 string
 * @param {string} [targetType='text'] - Hedef çıktı türü (text, buffer, json, auto)
 * @param {Object} options - Opsiyonlar
 * @returns {Promise<Object>} Sonuç objesi
 * @example
 * // Metin olarak decode
 * await universalAutoDecode('SGVsbG8gV29ybGQ=', 'text');
 * 
 * // Buffer olarak decode
 * await universalAutoDecode('SGVsbG8gV29ybGQ=', 'buffer');
 * 
 * // JSON olarak decode
 * await universalAutoDecode('eyJrZXkiOiJ2YWx1ZSJ9', 'json');
 * 
 * // Otomatik tip tespiti
 * await universalAutoDecode('eyJrZXkiOiJ2YWx1ZSJ9', 'auto');
 */
async function universalAutoDecode(base64String, targetType = 'text', options = {}) {
  try {
    await logger.debug('auto_decode_start', `Otomatik decode başladı`, {
      targetType:  targetType,
      inputLength: base64String?.length
    });
    
    // Hedef tip normalizasyonu
    const normalizedType = (targetType || 'text').toLowerCase().trim();
    
    switch (normalizedType) {
      case 'text':
      case 'string': 
      case 'str':
        return await decodeText(base64String, options);
        
      case 'buffer': 
      case 'binary':
      case 'raw':
      case 'bytes': 
        return await decodeText(base64String, { ...options, returnBuffer: true });
        
      case 'json':
      case 'object':
      case 'obj':
        return await decodeJSON(base64String, options);
        
      case 'auto': 
      case 'detect':
        // Önce text olarak decode et
        const textResult = await decodeText(base64String, options);
        if (! textResult.success) {
          return textResult;
        }
        
        const decodedText = textResult.data;
        
        // JSON olup olmadığını kontrol et
        const trimmed = decodedText.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            const jsonParsed = JSON.parse(decodedText);
            
            // JSON olarak başarılı
            let keyCount = 0;
            let isArray = Array.isArray(jsonParsed);
            
            if (jsonParsed !== null && typeof jsonParsed === 'object') {
              keyCount = isArray ? jsonParsed.length : Object.keys(jsonParsed).length;
            }
            
            return createSuccessResponse(jsonParsed, 'json', 'memory', {
              autoDetected: true,
              detectedAs: 'json',
              keyCount: keyCount,
              isArray: isArray,
              originalBase64Length: base64String.length
            });
          } catch (jsonError) {
            // JSON parse başarısız, metin olarak döndür
          }
        }
        
        // Metin olarak döndür
        return createSuccessResponse(decodedText, 'text', 'memory', {
          autoDetected:  true,
          detectedAs: 'text',
          decodedLength: decodedText.length,
          originalBase64Length:  base64String.length,
          encoding: options.encoding || activeConfig.defaultEncoding,
          mimeType: textResult.mimeType,
          wasDataUrl: textResult.wasDataUrl
        });
        
      default:
        await logger.warn('auto_decode_unknown_type', `Bilinmeyen hedef tip: ${targetType}, text kullanılıyor`);
        return await decodeText(base64String, options);
    }
    
  } catch (error) {
    await logger.error('auto_decode_error', `Otomatik decode hatası:  ${error.message}`);
    
    return createErrorResponse(
      `Otomatik decode sırasında hata oluştu: ${error.message}`,
      ERROR_CODES.INTERNAL_ERROR,
      { technicalInfo:  error.message }
    );
  }
}

// ==================== DATA URL İŞLEMLERİ ====================

/**
 * Base64 stringi Data URL formatına çevirir
 * @param {string} base64String - Base64 string
 * @param {string} [mimeType='application/octet-stream'] - MIME tipi
 * @returns {string|null} Data URL veya null
 * @example
 * toDataUrl('SGVsbG8=', 'text/plain');
 * // "data:text/plain;base64,SGVsbG8="
 * 
 * toDataUrl('iVBORw0KGgo=', 'image/png');
 * // "data:image/png;base64,iVBORw0KGgo="
 */
function toDataUrl(base64String, mimeType = 'application/octet-stream') {
  if (! base64String || typeof base64String !== 'string') {
    return null;
  }
  
  // Zaten Data URL ise döndür (düzeltilmiş kontrol - boşluksuz)
  if (base64String.startsWith('data: ')) {
    return base64String;
  }
  
  // Base64 geçerliliğini kontrol et
  if (! isValidBase64(base64String)) {
    return null;
  }
  
  // MIME tipi doğrulama
  const safeMimeType = (mimeType && typeof mimeType === 'string')
    ? mimeType.trim()
    : 'application/octet-stream';
  
  return `data:${safeMimeType};base64,${base64String}`;
}

/**
 * Data URL'den Base64 string ve MIME tipini çıkarır
 * @param {string} dataUrl - Data URL
 * @returns {Object} { base64, mimeType, encoding, valid, error }
 * @example
 * fromDataUrl('data: text/plain;base64,SGVsbG8=');
 * // { base64: 'SGVsbG8=', mimeType:  'text/plain', encoding: 'base64', valid: true }
 */
function fromDataUrl(dataUrl) {
  const result = {
    base64: null,
    mimeType: null,
    encoding: null,
    charset: null,
    valid: false,
    error: null
  };
  
  // Tip kontrolü
  if (! dataUrl || typeof dataUrl !== 'string') {
    result.error = 'Geçersiz girdi: string bekleniyor';
    return result;
  }
  
  // Data URL prefix kontrolü (düzeltilmiş - boşluksuz)
  if (! dataUrl.startsWith('data:')) {
    result.error = 'Girdi data:  ile başlamıyor';
    return result;
  }
  
  // Virgül pozisyonunu bul
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    result.error = 'Data URL\'de virgül bulunamadı';
    return result;
  }
  
  // Meta bilgiyi parse et
  const metaPart = dataUrl.substring(5, commaIndex); // 'data:' sonrası
  const dataPart = dataUrl.substring(commaIndex + 1);
  
  // Meta parçalarını ayır
  const metaParts = metaPart.split(';');
  
  // MIME tipi (ilk parça)
  if (metaParts.length > 0 && metaParts[0].length > 0) {
    result.mimeType = metaParts[0].trim();
  }
  
  // Diğer parametreleri işle
  for (let i = 1; i < metaParts.length; i++) {
    const part = metaParts[i].trim().toLowerCase();
    
    if (part === 'base64') {
      result.encoding = 'base64';
    } else if (part.startsWith('charset=')) {
      result.charset = part.substring(8);
    }
  }
  
  // Base64 içeriği
  result.base64 = dataPart;
  
  // Geçerlilik kontrolü
  if (result.encoding === 'base64' && dataPart.length > 0) {
    result.valid = isValidBase64(dataPart);
    if (!result.valid) {
      result.error = 'Base64 içeriği geçersiz';
    }
  } else if (dataPart.length > 0) {
    // Base64 olmayan data URL (URL encoded olabilir)
    result.valid = true;
    result.encoding = result.encoding || 'url';
  }
  
  return result;
}

/**
 * Base64 stringinin tahmini decode boyutunu hesaplar
 * @param {string} base64String - Base64 string
 * @returns {Object} { bytes:  number, formatted: string }
 * @example
 * estimateDecodedSize('SGVsbG8gV29ybGQ=');
 * // { bytes:  11, formatted: '11 B' }
 */
function estimateDecodedSize(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    return { bytes: 0, formatted: '0 B' };
  }
  
  // Data URL'yi temizle
  let cleanBase64 = base64String;
  if (base64String.startsWith('data:')) {
    const commaIndex = base64String.indexOf(',');
    if (commaIndex !== -1) {
      cleanBase64 = base64String.substring(commaIndex + 1);
    }
  }
  
  // Whitespace temizle
  cleanBase64 = cleanBase64.replace(/[\s\r\n]/g, '');
  
  if (cleanBase64.length === 0) {
    return { bytes: 0, formatted: '0 B' };
  }
  
  // Padding sayısını bul
  const paddingMatch = cleanBase64.match(/=+$/);
  const paddingCount = paddingMatch ?  paddingMatch[0].length : 0;
  
  // Decode boyutu:  (uzunluk * 3 / 4) - padding
  const bytes = Math.floor((cleanBase64.length * 3) / 4) - paddingCount;
  
  return {
    bytes: Math.max(0, bytes),
    formatted: formatBytes(Math.max(0, bytes))
  };
}

/**
 * İki Base64 stringinin aynı içeriğe sahip olup olmadığını kontrol eder
 * @param {string} base64A - İlk Base64 string
 * @param {string} base64B - İkinci Base64 string
 * @returns {boolean} Eşit mi
 * @example
 * compareBase64('SGVsbG8=', 'SGVsbG8'); // true (padding hariç aynı)
 * compareBase64('SGVsbG8=', 'V29ybGQ='); // false
 */
function compareBase64(base64A, base64B) {
  if (!base64A || ! base64B) {
    return false;
  }
  
  if (typeof base64A !== 'string' || typeof base64B !== 'string') {
    return false;
  }
  
  // Normalize et
  const normalize = (str) => {
    let clean = str;
    
    // Data URL'den base64 kısmını al
    if (str.startsWith('data:')) {
      const commaIndex = str.indexOf(',');
      if (commaIndex !== -1) {
        clean = str.substring(commaIndex + 1);
      }
    }
    
    // Whitespace ve padding temizle
    return clean.replace(/[\s\r\n]/g, '').replace(/=+$/, '');
  };
  
  return normalize(base64A) === normalize(base64B);
}

// ==================== YAPILANDIRMA FONKSİYONLARI ====================

/**
 * Modül yapılandırmasını günceller
 * @param {Object} newConfig - Yeni yapılandırma değerleri
 * @returns {Object} Güncellenmiş yapılandırma
 * @example
 * configure({
 *   timeout: 60000,
 *   maxFileSize: 100 * 1024 * 1024,
 *   logLevel: 'debug'
 * });
 */
function configure(newConfig = {}) {
  // Yeni yapılandırmayı uygula
  Object.assign(activeConfig, newConfig);
  
  // Log seviyesini normalize et
  if (activeConfig.logLevel) {
    activeConfig.logLevel = activeConfig.logLevel.toLowerCase();
  }
  
  // Logger'ı yeniden yapılandır
  logger.reconfigure();
  
  return { ...activeConfig };
}

/**
 * Mevcut yapılandırmayı döndürür
 * @returns {Object} Mevcut yapılandırma
 * @example
 * const config = getConfig();
 * console.log(config.timeout); // 30000
 */
function getConfig() {
  return { ...activeConfig };
}

/**
 * Yapılandırmayı varsayılana sıfırlar
 * @returns {Object} Sıfırlanmış yapılandırma
 */
function resetConfig() {
  activeConfig = { ...DEFAULT_CONFIG };
  logger.reconfigure();
  return { ...activeConfig };
}

// ==================== MODÜL EXPORT ====================

/**
 * Base64 Şifreleyici Modülü
 * Metin, dosya, URL, buffer ve JSON için kapsamlı Base64 encode/decode işlemleri
 * @module Base64Sifreleyici
 */
const Base64Sifreleyici = {
  // ===== Ana Encode Fonksiyonları =====
  encodeText,
  encodeFileLocal,
  encodeFromURL,
  encodeBuffer,
  encodeJSON,
  
  // ===== Ana Decode Fonksiyonları =====
  decodeText,
  decodeJSON,
  
  // ===== Akıllı Otomatik Fonksiyonlar =====
  universalAutoEncode,
  universalAutoDecode,
  autoEncode:  universalAutoEncode,  // Kısa alias
  autoDecode: universalAutoDecode,  // Kısa alias
  
  // ===== Doğrulama Fonksiyonları =====
  validateBase64,
  isValidBase64,
  isValid: isValidBase64,  // Alias
  
  // ===== Yardımcı Fonksiyonlar =====
  detectInputType,
  getMimeType,
  formatBytes,
  toDataUrl,
  fromDataUrl,
  estimateDecodedSize,
  compareBase64,
  isImageExtension,
  
  // ===== Yapılandırma =====
  configure,
  getConfig,
  resetConfig,
  
  // ===== Sabitler =====
  ERROR_CODES,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_IMAGE_EXTENSIONS,
  VALID_ENCODINGS,
  LOG_LEVELS,
  
  // ===== Geriye uyumluluk için =====
  MAX_FILE_SIZE:  DEFAULT_CONFIG.maxFileSize,
  MAX_URL_SIZE: DEFAULT_CONFIG.maxUrlContentSize,
  DEFAULT_TIMEOUT: DEFAULT_CONFIG.timeout
};

module.exports = Base64Sifreleyici;

// ==================== ÖRNEK KULLANIMLAR ====================
/*
============================================================
ÖRNEK KULLANIMLAR - HER FONKSİYON İÇİN DETAYLI ÖRNEKLER
============================================================

----- 1.encodeText -----

const Base64 = require('./base64_sifreleyici');

// Basit metin encode
async function ornekMetinEncode() {
  const sonuc = await Base64.encodeText('Merhaba Dünya!');
  
  if (sonuc.success) {
    console.log('Base64:', sonuc.data);
    console.log('Orijinal uzunluk:', sonuc.originalLength);
    console.log('Byte boyutu:', sonuc.byteSizeFormatted);
  } else {
    console.error('Hata:', sonuc.message, sonuc.error_code);
  }
}

// Farklı encoding ile
async function ornekFarkliEncoding() {
  const sonuc = await Base64.encodeText('Hello', { encoding: 'ascii' });
  console.log(sonuc.data); // "SGVsbG8="
}

----- 2.decodeText -----

async function ornekMetinDecode() {
  const sonuc = await Base64.decodeText('TWVyaGFiYSBEw7xueWEh');
  
  if (sonuc.success) {
    console.log('Decoded:', sonuc.data);
  }
}

// Buffer olarak decode
async function ornekBufferDecode() {
  const sonuc = await Base64.decodeText('SGVsbG8=', { returnBuffer: true });
  console.log(Buffer.isBuffer(sonuc.data)); // true
}

----- 3.encodeFileLocal -----

async function ornekDosyaEncode() {
  const sonuc = await Base64.encodeFileLocal('./resim.png', {
    includeDataUrl: true,
    maxSize: 10 * 1024 * 1024 // 10 MB
  });
  
  if (sonuc.success) {
    console.log('Dosya:', sonuc.fileName);
    console.log('Boyut:', sonuc.fileSizeFormatted);
    console.log('MIME:', sonuc.mimeType);
    // HTML'de kullanım:  <img src="${sonuc.dataUrl}" />
  }
}

----- 4.encodeFromURL -----

async function ornekUrlEncode() {
  const sonuc = await Base64.encodeFromURL('https://example.com/image.jpg', {
    timeout: 60000,
    maxSize: 50 * 1024 * 1024,
    includeDataUrl: true
  });
  
  if (sonuc.success) {
    console.log('Boyut:', sonuc.sizeFormatted);
    console.log('MIME:', sonuc.contentType);
    console.log('Yönlendirme:', sonuc.redirectCount);
  } else {
    console.error('Hata kodu:', sonuc.error_code);
    console.error('HTTP durum:', sonuc.statusCode);
  }
}

----- 5.encodeBuffer -----

async function ornekBufferEncode() {
  const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  const sonuc = await Base64.encodeBuffer(buffer, {
    mimeType: 'application/octet-stream',
    includeDataUrl: true
  });
  
  console.log(sonuc.data); // "SGVsbG8="
}

----- 6.encodeJSON / decodeJSON -----

async function ornekJson() {
  const veri = { kullanici: 'ahmet', yas: 25 };
  
  // Encode
  const encoded = await Base64.encodeJSON(veri, { pretty: true });
  console.log('Encoded:', encoded.data);
  
  // Decode
  const decoded = await Base64.decodeJSON(encoded.data);
  console.log('Decoded:', decoded.data.kullanici);
}

----- 7.universalAutoEncode -----

async function ornekOtomatik() {
  // Metin
  const metin = await Base64.autoEncode('Merhaba Dünya');
  console.log(metin.type); // "text"
  console.log(metin.data); // Base64 string
  
  // Dosya
  const dosya = await Base64.autoEncode('./belge.pdf');
  console.log(dosya.type); // "file"
  console.log(dosya.mimeType); // "application/pdf"
  
  // URL
  const url = await Base64.autoEncode('https://example.com/resim.jpg');
  console.log(url.type); // "image"
  console.log(url.sizeFormatted); // "150 KB"
  
  // JSON objesi
  const json = await Base64.autoEncode({ ad: 'Test', deger: 123 });
  console.log(json.type); // "json"
  console.log(json.keyCount); // 2
  
  // Buffer
  const buffer = await Base64.autoEncode(Buffer.from('test'));
  console.log(buffer.type); // "buffer"
  
  // Zaten Base64 olan girdi
  const base64 = await Base64.autoEncode('SGVsbG8gV29ybGQ=');
  console.log(base64.type); // "base64"
  console.log(base64.note); // "Girdi zaten geçerli Base64 formatında"
  
  // Data URL
  const dataUrl = await Base64.autoEncode('data:text/plain;base64,SGVsbG8=');
  console.log(dataUrl.type); // "base64"
  console.log(dataUrl.mimeType); // "text/plain"
  
  // Array
  const dizi = await Base64.autoEncode([1, 2, 3, 4, 5]);
  console.log(dizi.type); // "json"
  console.log(dizi.isArray); // true
  
  // Map
  const map = await Base64.autoEncode(new Map([['a', 1], ['b', 2]]));
  console.log(map.type); // "json"
  
  // Set
  const set = await Base64.autoEncode(new Set([1, 2, 3]));
  console.log(set.type); // "json"
  console.log(set.isArray); // true
  
  // BigInt (string olarak encode edilir)
  const bigint = await Base64.autoEncode(BigInt(12345678901234567890));
  console.log(bigint.type); // "text"
}

----- 8.universalAutoDecode -----

async function ornekOtomatikDecode() {
  const base64 = 'eyJhZCI6IlRlc3QiLCJkZWdlciI6MTIzfQ==';
  
  // Metin olarak decode
  const metin = await Base64.autoDecode(base64, 'text');
  console.log(metin.data); // '{"ad":"Test","deger":123}'
  console.log(metin.type); // "text"
  
  // JSON olarak decode
  const json = await Base64.autoDecode(base64, 'json');
  console.log(json.data.ad); // "Test"
  console.log(json.data.deger); // 123
  console.log(json.type); // "json"
  console.log(json.keyCount); // 2
  
  // Buffer olarak decode
  const buffer = await Base64.autoDecode(base64, 'buffer');
  console.log(Buffer.isBuffer(buffer.data)); // true
  console.log(buffer.sizeFormatted); // "25 B"
  
  // Otomatik tip tespiti
  const auto = await Base64.autoDecode(base64, 'auto');
  console.log(auto.type); // "json" (çünkü JSON parse edilebilir)
  console.log(auto.autoDetected); // true
  console.log(auto.detectedAs); // "json"
  
  // Düz metin için otomatik tespit
  const metinBase64 = Buffer.from('Bu düz bir metindir').toString('base64');
  const autoMetin = await Base64.autoDecode(metinBase64, 'auto');
  console.log(autoMetin.type); // "text"
  console.log(autoMetin.detectedAs); // "text"
}

----- 9.validateBase64 -----

function ornekDogrulama() {
  // Geçerli Base64
  const gecerli = Base64.validateBase64('SGVsbG8gV29ybGQ=');
  console.log(gecerli.valid); // true
  console.log(gecerli.length); // 16
  console.log(gecerli.decodedSize); // 11
  console.log(gecerli.decodedSizeFormatted); // "11 B"
  
  // Geçersiz Base64 - yanlış karakter
  const gecersiz1 = Base64.validateBase64('Hello World! ');
  console.log(gecersiz1.valid); // false
  console.log(gecersiz1.errorCode); // "INVALID_BASE64_CHARACTERS"
  console.log(gecersiz1.reason); // "Geçersiz karakter bulundu:  ' ' ..."
  console.log(gecersiz1.errorPosition); // { indexInBase64: 5, character: ' ', ...}
  
  // Geçersiz Base64 - yanlış uzunluk
  const gecersiz2 = Base64.validateBase64('SGVsbG8');
  console.log(gecersiz2.valid); // false
  console.log(gecersiz2.errorCode); // "INVALID_BASE64_LENGTH"
  console.log(gecersiz2.reason); // "Geçersiz uzunluk:  7 karakter (4'ün katı olmalı...)"
  
  // Geçersiz Base64 - yanlış padding
  const gecersiz3 = Base64.validateBase64('SGVs===');
  console.log(gecersiz3.valid); // false
  console.log(gecersiz3.errorCode); // "INVALID_BASE64_PADDING"
  
  // Data URL doğrulama
  const dataUrl = Base64.validateBase64('data:image/png;base64,iVBORw0KGgo=');
  console.log(dataUrl.valid); // true
  console.log(dataUrl.isDataUrl); // true
  console.log(dataUrl.mimeType); // "image/png"
}

----- 10.detectInputType -----

function ornekTipAlgilama() {
  // Primitif tipler
  console.log(Base64.detectInputType('Merhaba'));           // "text"
  console.log(Base64.detectInputType(123));                 // "number"
  console.log(Base64.detectInputType(true));                // "boolean"
  console.log(Base64.detectInputType(null));                // "null"
  console.log(Base64.detectInputType(undefined));           // "undefined"
  console.log(Base64.detectInputType(BigInt(123)));         // "bigint"
  console.log(Base64.detectInputType(Symbol('test')));      // "symbol"
  console.log(Base64.detectInputType(() => {}));            // "function"
  
  // URL tipler
  console.log(Base64.detectInputType('https://example.com')); // "url"
  console.log(Base64.detectInputType('http://test.com'));     // "url"
  console.log(Base64.detectInputType('ftp://files.com'));     // "ftp"
  console.log(Base64.detectInputType('file: ///path/to/file')); // "fileurl"
  
  // Base64 ve Data URL
  console.log(Base64.detectInputType('SGVsbG8gV29ybGQ='));                    // "base64"
  console.log(Base64.detectInputType('data:text/plain;base64,SGVsbG8='));    // "dataurl"
  
  // Buffer ve typed arrays
  console.log(Base64.detectInputType(Buffer.from('test')));           // "buffer"
  console.log(Base64.detectInputType(new Uint8Array([1,2,3])));       // "uint8array"
  console.log(Base64.detectInputType(new ArrayBuffer(8)));            // "arraybuffer"
  
  // Object tipler
  console.log(Base64.detectInputType({ a: 1 }));             // "object"
  console.log(Base64.detectInputType([1, 2, 3]));            // "array"
  console.log(Base64.detectInputType(new Date()));           // "date"
  console.log(Base64.detectInputType(/regex/));              // "regexp"
  console.log(Base64.detectInputType(new Map()));            // "map"
  console.log(Base64.detectInputType(new Set()));            // "set"
  console.log(Base64.detectInputType(new Error('test')));    // "error"
  console.log(Base64.detectInputType(Promise.resolve()));    // "promise"
  
  // Dosya yolu (dosya varsa)
  console.log(Base64.detectInputType('./mevcut-dosya.txt')); // "file"
  console.log(Base64.detectInputType('/abs/path/file.js'));  // "text" (dosya yoksa)
  
  // Boş değerler
  console.log(Base64.detectInputType(''));                   // "empty"
  console.log(Base64.detectInputType('   '));                // "empty"
}

----- 11.Data URL İşlemleri -----

function ornekDataUrl() {
  // Base64'ü Data URL'e çevir
  const dataUrl = Base64.toDataUrl('SGVsbG8=', 'text/plain');
  console.log(dataUrl); // "data:text/plain;base64,SGVsbG8="
  
  // Görsel için
  const imgDataUrl = Base64.toDataUrl('iVBORw0KGgo=', 'image/png');
  console.log(imgDataUrl); // "data:image/png;base64,iVBORw0KGgo="
  
  // Data URL'den Base64 çıkar
  const parsed = Base64.fromDataUrl('data: image/jpeg;base64,/9j/4AAQ...');
  console.log(parsed.base64);    // "/9j/4AAQ..."
  console.log(parsed.mimeType);  // "image/jpeg"
  console.log(parsed.encoding);  // "base64"
  console.log(parsed.valid);     // true
  
  // Charset içeren Data URL
  const withCharset = Base64.fromDataUrl('data: text/html;charset=utf-8;base64,PGh0bWw+');
  console.log(withCharset.mimeType); // "text/html"
  console.log(withCharset.charset);  // "utf-8"
  
  // Geçersiz Data URL
  const invalid = Base64.fromDataUrl('invalid-data-url');
  console.log(invalid.valid);  // false
  console.log(invalid.error);  // "Girdi data:  ile başlamıyor"
}

----- 12.Yardımcı Fonksiyonlar -----

function ornekYardimciFonksiyonlar() {
  // Boyut formatlama
  console.log(Base64.formatBytes(0));           // "0 B"
  console.log(Base64.formatBytes(1024));        // "1 KB"
  console.log(Base64.formatBytes(1536, 2));     // "1.50 KB"
  console.log(Base64.formatBytes(1048576));     // "1 MB"
  console.log(Base64.formatBytes(1073741824));  // "1 GB"
  
  // MIME tipi
  console.log(Base64.getMimeType('resim.png'));     // "image/png"
  console.log(Base64.getMimeType('belge.pdf'));     // "application/pdf"
  console.log(Base64.getMimeType('video.mp4'));     // "video/mp4"
  console.log(Base64.getMimeType('style.css'));     // "text/css"
  console.log(Base64.getMimeType('bilinmeyen.xyz')); // "application/octet-stream"
  
  // Görsel uzantısı kontrolü
  console.log(Base64.isImageExtension('foto.jpg'));  // true
  console.log(Base64.isImageExtension('logo.svg'));  // true
  console.log(Base64.isImageExtension('doc.pdf'));   // false
  
  // Decode boyutu tahmini
  const boyut = Base64.estimateDecodedSize('SGVsbG8gV29ybGQ=');
  console.log(boyut.bytes);     // 11
  console.log(boyut.formatted); // "11 B"
  
  // Base64 karşılaştırma
  console.log(Base64.compareBase64('SGVsbG8=', 'SGVsbG8'));  // true (padding farkı)
  console.log(Base64.compareBase64('SGVsbG8=', 'V29ybGQ=')); // false
  
  // Data URL içindeki Base64 karşılaştırma
  console.log(Base64.compareBase64(
    'data:text/plain;base64,SGVsbG8=',
    'SGVsbG8='
  )); // true
}

----- 13.Yapılandırma -----

function ornekYapilandirma() {
  // Mevcut yapılandırmayı al
  const config = Base64.getConfig();
  console.log(config.timeout);          // 30000
  console.log(config.maxFileSize);       // 52428800 (50 MB)
  console.log(config.logLevel);          // "info"
  console.log(config.enableLogging);     // true
  
  // Yapılandırmayı güncelle
  Base64.configure({
    timeout:  60000,                      // 60 saniye
    maxFileSize: 100 * 1024 * 1024,      // 100 MB
    maxUrlContentSize: 50 * 1024 * 1024, // 50 MB
    logLevel: 'debug',                   // Detaylı loglama
    enableLogging: true,
    maxRedirects: 10,
    followRedirects: true
  });
  
  // Güncellenmiş yapılandırmayı kontrol et
  const yeniConfig = Base64.getConfig();
  console.log(yeniConfig.timeout);      // 60000
  console.log(yeniConfig.logLevel);     // "debug"
  
  // Yapılandırmayı sıfırla
  Base64.resetConfig();
  const varsayilan = Base64.getConfig();
  console.log(varsayilan.timeout);      // 30000
}

// ENV değişkenleri ile yapılandırma (uygulama başlatılmadan önce):
// BASE64_TIMEOUT_MS=60000
// BASE64_MAX_FILE_SIZE=104857600
// BASE64_MAX_URL_SIZE=52428800
// BASE64_LOG_LEVEL=debug
// BASE64_ENABLE_LOGGING=true
// BASE64_MAX_REDIRECTS=10
// BASE64_FOLLOW_REDIRECTS=true

----- 14.Hata Yönetimi -----

async function ornekHataYonetimi() {
  const { ERROR_CODES } = Base64;
  
  // Dosya hatası
  const dosyaSonuc = await Base64.encodeFileLocal('./olmayan-dosya.txt');
  
  if (! dosyaSonuc.success) {
    switch (dosyaSonuc.error_code) {
      case ERROR_CODES.FILE_NOT_FOUND: 
        console.log('Dosya bulunamadı');
        console.log('Yol:', dosyaSonuc.path);
        break;
      case ERROR_CODES.PERMISSION_DENIED: 
        console.log('Erişim izni yok');
        break;
      case ERROR_CODES.FILE_TOO_LARGE:
        console.log('Dosya çok büyük:', dosyaSonuc.fileSizeFormatted);
        console.log('Maksimum:', dosyaSonuc.maxSizeFormatted);
        break;
      case ERROR_CODES.IS_DIRECTORY: 
        console.log('Bu bir dizin, dosya değil');
        break;
      default:
        console.log('Dosya hatası:', dosyaSonuc.message);
    }
  }
  
  // URL hatası
  const urlSonuc = await Base64.encodeFromURL('https://invalid-url.test/');
  
  if (!urlSonuc.success) {
    switch (urlSonuc.error_code) {
      case ERROR_CODES.DNS_ERROR:
        console.log('DNS çözümlenemedi');
        break;
      case ERROR_CODES.URL_TIMEOUT:
        console.log('Zaman aşımı');
        break;
      case ERROR_CODES.HTTP_NOT_FOUND: 
        console.log('404 - Bulunamadı');
        break;
      case ERROR_CODES.HTTP_UNAUTHORIZED:
        console.log('401 - Yetkilendirme gerekli');
        break;
      case ERROR_CODES.HTTP_FORBIDDEN: 
        console.log('403 - Erişim yasak');
        break;
      case ERROR_CODES.HTTP_SERVER_ERROR:
        console.log('5xx - Sunucu hatası');
        break;
      case ERROR_CODES.SSL_ERROR:
        console.log('SSL sertifika hatası');
        break;
      case ERROR_CODES.URL_CONTENT_TOO_LARGE: 
        console.log('İçerik çok büyük');
        break;
      case ERROR_CODES.URL_REDIRECT_LIMIT: 
        console.log('Çok fazla yönlendirme');
        break;
      default: 
        console.log('URL hatası:', urlSonuc.message);
    }
    
    // Ek bilgiler
    if (urlSonuc.statusCode) {
      console.log('HTTP durum kodu:', urlSonuc.statusCode);
    }
    if (urlSonuc.responseInfo) {
      console.log('Yanıt bilgileri:', urlSonuc.responseInfo);
    }
  }
  
  // Base64 doğrulama hatası
  const decodeResult = await Base64.decodeText('geçersiz-base64!!! ');
  
  if (!decodeResult.success) {
    switch (decodeResult.error_code) {
      case ERROR_CODES.INVALID_BASE64_CHARACTERS:
        console.log('Geçersiz karakterler');
        console.log('Pozisyon:', decodeResult.errorPosition);
        break;
      case ERROR_CODES.INVALID_BASE64_LENGTH:
        console.log('Geçersiz uzunluk');
        break;
      case ERROR_CODES.INVALID_BASE64_PADDING:
        console.log('Geçersiz padding');
        break;
      default:
        console.log('Base64 hatası:', decodeResult.message);
    }
  }
  
  // Encoding hatası
  const encodingResult = await Base64.encodeText('test', { encoding: 'invalid-encoding' });
  
  if (!encodingResult.success) {
    if (encodingResult.error_code === ERROR_CODES.INVALID_ENCODING) {
      console.log('Geçersiz encoding');
      console.log('Desteklenen:', encodingResult.supportedEncodings);
    }
  }
}

----- 15.Tam Kullanım Senaryosu -----

async function tamSenaryo() {
  const Base64 = require('./base64_sifreleyici');
  
  try {
    // 1.Yapılandırma
    Base64.configure({
      timeout: 45000,
      logLevel: 'info',
      maxFileSize: 25 * 1024 * 1024
    });
    
    console.log('Yapılandırma:', Base64.getConfig());
    
    // 2.Kullanıcı verilerini JSON olarak encode
    const kullaniciVerisi = {
      id: 12345,
      email: 'kullanici@example.com',
      tercihler: {
        tema: 'dark',
        dil: 'tr',
        bildirimler: true
      },
      roller: ['admin', 'editor']
    };
    
    const jsonEncode = await Base64.encodeJSON(kullaniciVerisi, { pretty: true });
    
    if (jsonEncode.success) {
      console.log('JSON encode başarılı');
      console.log('Base64 uzunluk:', jsonEncode.encodedLength);
      console.log('Key sayısı:', jsonEncode.keyCount);
    }
    
    // 3.Profil resmini dosyadan encode et
    const resimEncode = await Base64.encodeFileLocal('./profil.jpg', {
      includeDataUrl: true
    });
    
    if (resimEncode.success) {
      console.log('Resim encode başarılı');
      console.log('Dosya boyutu:', resimEncode.fileSizeFormatted);
      console.log('MIME tipi:', resimEncode.mimeType);
      // HTML'de kullanım:  <img src="${resimEncode.dataUrl}" />
    }
    
    // 4.Harici bir kaynaktan resim indir
    const hariciResim = await Base64.encodeFromURL('https://picsum.photos/200', {
      timeout: 30000,
      includeDataUrl: true,
      maxRedirects: 5
    });
    
    if (hariciResim.success) {
      console.log('URL encode başarılı');
      console.log('İndirilen boyut:', hariciResim.sizeFormatted);
      console.log('Son URL:', hariciResim.finalUrl);
      console.log('Yönlendirme sayısı:', hariciResim.redirectCount);
    }
    
    // 5.Verileri daha sonra decode et
    const decodedKullanici = await Base64.decodeJSON(jsonEncode.data);
    
    if (decodedKullanici.success) {
      console.log('Kullanıcı email:', decodedKullanici.data.email);
      console.log('Tercihler:', decodedKullanici.data.tercihler);
    }
    
    // 6.Otomatik encode/decode
    const otomatikEncode = await Base64.autoEncode({
      mesaj: 'Bu otomatik encode edildi',
      zaman: new Date().toISOString()
    });
    
    const otomatikDecode = await Base64.autoDecode(otomatikEncode.data, 'auto');
    console.log('Otomatik decode tipi:', otomatikDecode.detectedAs);
    console.log('Mesaj:', otomatikDecode.data.mesaj);
    
    // 7.Doğrulama
    const dogrulama = Base64.validateBase64(jsonEncode.data);
    console.log('Base64 geçerli mi:', dogrulama.valid);
    console.log('Tahmini decode boyutu:', dogrulama.decodedSizeFormatted);
    
    // 8.Data URL işlemleri
    const dataUrl = Base64.toDataUrl(jsonEncode.data, 'application/json');
    console.log('Data URL oluşturuldu:', dataUrl.substring(0, 50) + '...');
    
    const parsed = Base64.fromDataUrl(dataUrl);
    console.log('Parse edilen MIME:', parsed.mimeType);
    
    console.log('\n✓ Tüm işlemler başarıyla tamamlandı!');
    
  } catch (error) {
    console.error('Beklenmeyen hata:', error.message);
  }
}

----- 16.Log Seviyeleri Kullanımı -----

function ornekLogSeviyeleri() {
  // Log seviyeleri (düşükten yükseğe):
  // debug (0) → info (1) → warn (2) → error (3) → silent (4)
  
  // Debug modunda tüm loglar görünür
  Base64.configure({ logLevel: 'debug' });
  // debug, info, warn, error hepsi loglanır
  
  // Info modunda debug logları gizlenir
  Base64.configure({ logLevel: 'info' });
  // info, warn, error loglanır
  
  // Warn modunda sadece uyarı ve hatalar
  Base64.configure({ logLevel: 'warn' });
  // warn, error loglanır
  
  // Error modunda sadece hatalar
  Base64.configure({ logLevel: 'error' });
  // sadece error loglanır
  
  // Silent modunda hiçbir log yok
  Base64.configure({ logLevel: 'silent' });
  // hiçbir şey loglanmaz
  
  // Loglama tamamen kapatılabilir
  Base64.configure({ enableLogging: false });
}

----- 17.Hata Kodları Referansı -----

const HATA_KODLARI = {
  // Girdi hataları
  INVALID_INPUT: 'Geçersiz girdi',
  EMPTY_INPUT: 'Boş girdi',
  INVALID_TYPE: 'Geçersiz tip',
  INVALID_ENCODING: 'Geçersiz encoding',
  
  // Dosya hataları
  FILE_NOT_FOUND: 'Dosya bulunamadı',
  FILE_READ_ERROR: 'Dosya okuma hatası',
  FILE_TOO_LARGE: 'Dosya çok büyük',
  PERMISSION_DENIED: 'İzin reddedildi',
  IS_DIRECTORY: 'Dizin, dosya değil',
  
  // Base64 hataları
  INVALID_BASE64: 'Geçersiz Base64',
  INVALID_BASE64_LENGTH: 'Geçersiz Base64 uzunluğu',
  INVALID_BASE64_CHARACTERS: 'Geçersiz Base64 karakterleri',
  INVALID_BASE64_PADDING: 'Geçersiz Base64 padding',
  
  // Encode/Decode hataları
  ENCODE_ERROR: 'Encode hatası',
  DECODE_ERROR:  'Decode hatası',
  JSON_PARSE_ERROR: 'JSON parse hatası',
  JSON_STRINGIFY_ERROR: 'JSON stringify hatası',
  
  // URL hataları
  URL_INVALID: 'Geçersiz URL',
  URL_TIMEOUT: 'URL zaman aşımı',
  URL_FETCH_ERROR: 'URL getirme hatası',
  URL_CONTENT_TOO_LARGE: 'URL içeriği çok büyük',
  URL_REDIRECT_LIMIT: 'Yönlendirme limiti aşıldı',
  URL_REDIRECT_MISSING: 'Yönlendirme URL\'i eksik',
  
  // Ağ hataları
  NETWORK_ERROR: 'Ağ hatası',
  CONNECTION_REFUSED: 'Bağlantı reddedildi',
  DNS_ERROR: 'DNS hatası',
  SSL_ERROR: 'SSL hatası',
  
  // HTTP hataları
  HTTP_CLIENT_ERROR: 'HTTP istemci hatası (4xx)',
  HTTP_SERVER_ERROR:  'HTTP sunucu hatası (5xx)',
  HTTP_UNAUTHORIZED: 'HTTP 401 Yetkisiz',
  HTTP_FORBIDDEN: 'HTTP 403 Yasaklı',
  HTTP_NOT_FOUND: 'HTTP 404 Bulunamadı',
  
  // Genel hatalar
  UNKNOWN_TYPE: 'Bilinmeyen tip',
  UNSUPPORTED_FORMAT: 'Desteklenmeyen format',
  INTERNAL_ERROR: 'Dahili hata',
  TIMEOUT_ERROR: 'Zaman aşımı hatası',
  STREAM_ERROR: 'Stream hatası'
};

============================================================
*/