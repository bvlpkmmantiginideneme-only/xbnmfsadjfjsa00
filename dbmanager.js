// dbmanager.js
// Enterprise Veritabani Yoneticisi - KRITIK GUNCELLEMELER
// Graceful disable, pool recovery, timeout dinamik, logger fallback

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor(logger) {
    this. logger = logger || this._createDummyLogger();
    
    this.pools = new Map();
    this.queryQueue = [];
    this.isProcessingQueue = false;
    this.isDisabled = false;
    this.disableReason = null;

    this.kuyrukMaksBoyutu = Number(process.env. DB_KUYRUK_MAKS_BOYUTU || 1000);
    this.yenidenDenmeSayisi = Number(process.env.DB_YENIDEN_DENEME_SAYISI || 3);
    this.yenidenGecikmeMs = Number(process. env.DB_YENIDEN_DENEME_GECIKME_MS || 1000);
    this.maksBaglanti = Number(process. env.DB_MAKS_BAGLANTI || 20);
    this.bostaZamanAsimi = Number(process. env.DB_BOSTA_ZAMAN_ASIMI || 30000);
    this.maksYenidenBaglanti = Number(process.env.DB_MAKS_YENIDEN_BAGLANTI || 5);
    
    const timeoutSaniye = Number(process. env.DB_ZAMANASIMI_YENILEME || 30);
    this.zamanAsimi = timeoutSaniye * 1000;
    
    this.cokluSqlIfade = this._parseEnvBoolean(process.env. COKLU_SQL_IFADE);

    this.connectionLostRetries = 0;
    this.stats = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      totalConnections: 0,
      reconnectAttempts:  0,
      poolErrors: 0,
      multipleStatementsBlocked: 0,
      injectionAttemptsBlocked:  0
    };

    this.dangerousPatterns = [
      /DROP\s+TABLE/i,
      /DELETE\s+FROM/i,
      /TRUNCATE\s+TABLE/i,
      /ALTER\s+TABLE\s+DROP/i,
      /EXEC\s*\(/i,
      /EXECUTE\s*\(/i
    ];

    this.injectionPatterns = [
      /('|(\\)|(--))/,
      /union\s+select/i,
      /or\s+1\s*=\s*1/i,
      /;\s*drop/i,
      /script>/i
    ];
  }

  _createDummyLogger() {
    return {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      critical: () => {}
    };
  }

  _parseEnvBoolean(value) {
    if (! value) return false;
    const str = String(value).toLowerCase().trim();
    return str === '1' || str === 'true' || str === 'yes';
  }

  checkEnvValidity() {
    const requiredEnvs = ['DB_HOST', 'DB_USER', 'DB_PASS'];
    const missing = [];

    for (const env of requiredEnvs) {
      if (! process.env[env]) {
        missing.push(env);
      }
    }

    if (missing.length > 0) {
      this.isDisabled = true;
      this.disableReason = `Eksik ENV:  ${missing.join(', ')}`;
      
      this.logger. warn('db_disabled', `Veritabani devre disi: ${this.disableReason}`, {
        klasor: 'database',
        key:  'startup'
      }).catch(() => {});

      console.warn('[WARN] VERITABANI DEVRE DISI:', this. disableReason);
      return false;
    }

    return true;
  }

  register(dbName, config) {
    if (this.isDisabled) {
      this.logger.warn('db_register_skipped', `DB kaydi atlandi (devre disi)`, {
        klasor: 'database',
        key:  'startup',
        dbName,
        neden: this.disableReason
      }).catch(() => {});
      return false;
    }

    if (this. pools.has(dbName)) {
      throw new Error(`Pool '${dbName}' zaten kayitli`);
    }

    const finalConfig = {
      host: config.host,
      user: config.user,
      password: config.password,
      database:  config.database || dbName,
      waitForConnections:  true,
      connectionLimit: this.maksBaglanti,
      queueLimit: 0,
      enableKeepAlive:  true,
      keepAliveInitialDelayMs: 0,
      idleTimeout: this.bostaZamanAsimi,
      multipleStatements: this.cokluSqlIfade
    };

    try {
      const pool = mysql.createPool(finalConfig);

      pool.on('error', (err) => {
        this._handlePoolError(dbName, err);
      });

      this.pools.set(dbName, {
        pool,
        config:  finalConfig,
        name: dbName,
        isHealthy: true,
        lastError: null,
        errorCount: 0,
        reconnectAttempts: 0,
        createdAt: Date.now()
      });

      this.logger.info('db_kayit', `DB kaydedildi: ${dbName}`, {
        klasor: 'database',
        key: 'startup',
        dbName,
        timeout: `${this.zamanAsimi / 1000}s`
      }).catch(() => {});

      return true;
    } catch (error) {
      console.error('[ERROR] db_kayit_hata', dbName, error. message);
      this.logger.error('db_kayit_hata', `Pool kayit hatasi: ${dbName}`, {
        klasor: 'database',
        key: 'startup',
        dbName,
        hata: error.message
      }).catch(() => {});
      throw error;
    }
  }

  async _handlePoolError(dbName, error) {
    const poolData = this.pools. get(dbName);
    if (!poolData) return;

    poolData.lastError = error;
    poolData.errorCount++;
    poolData.isHealthy = false;
    this.stats.poolErrors++;

    console.warn('[WARN] db_pool_hata', dbName, error.code);
    this.logger.warn('db_pool_hata', `Pool hatasi: ${dbName} (${error.code})`, {
      klasor: 'database',
      key:  'error',
      dbName,
      hataMesaji: error.message,
      hataSayisi: poolData.errorCount,
      kod: error.code
    }).catch(() => {});

    if (['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'PROTOCOL_PACKETS_OUT_OF_ORDER'].includes(error. code)) {
      await this._attemptReconnect(dbName);
    }
  }

  async _attemptReconnect(dbName) {
    const poolData = this.pools.get(dbName);
    if (!poolData) return;

    poolData. reconnectAttempts++;
    this.stats.reconnectAttempts++;

    if (poolData.reconnectAttempts > this.maksYenidenBaglanti) {
      poolData.isHealthy = false;
      
      console.error('[CRITICAL] db_yeniden_bag_basarisiz', dbName);
      this.logger.critical('db_yeniden_bag_basarisiz', `YENIDEN BAGLANMA BASARISIZ: ${dbName}`, {
        klasor:  'database',
        key: 'critical',
        dbName,
        denemeSayisi: poolData.reconnectAttempts,
        maksYenidenBaglanti: this. maksYenidenBaglanti
      }).catch(() => {});

      return;
    }

    const delayMs = Math. min(1000 * Math.pow(2, poolData.reconnectAttempts), 30000);

    this.logger.info('db_yeniden_bag_deneme', `Yeniden baglanma:  ${dbName} (${poolData. reconnectAttempts}/${this.maksYenidenBaglanti})`, {
      klasor: 'database',
      key: 'reconnect',
      dbName,
      deneme: poolData. reconnectAttempts,
      gecikmeMs: delayMs
    }).catch(() => {});

    setTimeout(async () => {
      try {
        await poolData.pool.end().catch(() => {});

        const newPool = mysql.createPool(poolData.config);
        newPool.on('error', (err) => {
          this._handlePoolError(dbName, err);
        });

        poolData.pool = newPool;
        poolData.isHealthy = true;
        poolData.errorCount = 0;

        this.logger.info('db_yeniden_bag_basarili', `Pool onarildi: ${dbName}`, {
          klasor: 'database',
          key: 'reconnect',
          dbName
        }).catch(() => {});
      } catch (err) {
        console.error('[ERROR] db_yeniden_bag_tekrar_hata', dbName, err.message);
        this.logger. error('db_yeniden_bag_tekrar_hata', `Onarim basarisiz: ${dbName}`, {
          klasor: 'database',
          key: 'reconnect',
          dbName,
          hata: err.message
        }).catch(() => {});
      }
    }, delayMs);
  }

  _validateMultipleStatements(sql) {
    if (! this.cokluSqlIfade && sql.includes(';')) {
      const parts = sql.split(';').filter(p => p.trim());
      if (parts.length > 1) {
        this.stats.multipleStatementsBlocked++;
        
        console.error('[ERROR] db_multi_stmt_engel', 'Multiple statements engellendi');
        this.logger.error('db_multi_stmt_engel', `Multiple statements engellendi`, {
          klasor: 'database',
          key: 'security',
          sql:  sql. substring(0, 100)
        }).catch(() => {});

        throw new Error('Multiple statements bu sistemde devre disi');
      }
    }

    if (this.cokluSqlIfade && sql.includes(';')) {
      const parts = sql. split(';').filter(p => p. trim());
      if (parts.length > 1) {
        console.warn('[WARN] db_multi_stmt_aktif', 'Multiple statements AKTIF');
        this.logger.warn('db_multi_stmt_aktif', `Multiple statements AKTIF ve kullaniliyor`, {
          klasor: 'database',
          key: 'security',
          deyimSayisi: parts. length
        }).catch(() => {});
      }
    }
  }

  _detectSQLInjection(sql) {
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sql)) {
        this.stats.injectionAttemptsBlocked++;
        
        console.error('[ERROR] db_injection_tespit', 'SQL INJECTION TESPITI');
        this.logger.error('db_injection_tespit', `SQL INJECTION TESPITI`, {
          klasor: 'database',
          key:  'security',
          sql:  sql.substring(0, 100)
        }).catch(() => {});

        return true;
      }
    }
    return false;
  }

  _isForbiddenQuery(sql) {
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(sql)) {
        console.error('[ERROR] db_forbidden_query', 'TEHLIKELI QUERY ENGELLENDI');
        this.logger.error('db_forbidden_query', `TEHLIKELI QUERY ENGELLENDI`, {
          klasor: 'database',
          key: 'security',
          sql:  sql.substring(0, 100)
        }).catch(() => {});
        return true;
      }
    }
    return false;
  }

  _enqueueQuery(queueItem) {
    if (this.queryQueue.length >= this.kuyrukMaksBoyutu) {
      throw new Error(`Query sirasi dolu (${this.kuyrukMaksBoyutu})`);
    }

    this.queryQueue.push(queueItem);
    this._processQueue();
  }

  async _processQueue() {
    if (this.isProcessingQueue || this.queryQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queryQueue.length > 0) {
      const queueItem = this. queryQueue.shift();

      try {
        const result = await this._executeQuery(
          queueItem. dbName,
          queueItem.sql,
          queueItem.params,
          queueItem.options
        );

        queueItem.resolve(result);
      } catch (error) {
        queueItem.reject(error);
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.isProcessingQueue = false;
  }

  async _executeQuery(dbName, sql, params, options = {}) {
    if (this. isDisabled) {
      throw new Error(`Veritabani devre disi: ${this.disableReason}`);
    }

    const poolData = this.pools.get(dbName);
    if (!poolData) {
      throw new Error(`Pool bulunamadi: ${dbName}`);
    }

    const traceId = options.traceId || crypto.randomUUID();
    const queryStartTime = Date.now();
    
    const timeout = options.timeoutMs || this.zamanAsimi;
    const maxRetry = options.retries !== undefined ? options.retries : this.yenidenDenmeSayisi;
    
    let attempt = 0;
    let lastError = null;

    this._validateMultipleStatements(sql);

    if (this._detectSQLInjection(sql)) {
      throw new Error('SQL Injection tespit edildi! ');
    }

    if (this._isForbiddenQuery(sql)) {
      throw new Error('Bu query islemi engellendi');
    }

    while (attempt < maxRetry) {
      try {
        if (! poolData.isHealthy && attempt > 0) {
          await new Promise(resolve => 
            setTimeout(resolve, this.yenidenGecikmeMs * attempt)
          );
        }

        const connection = await Promise.race([
          poolData.pool. getConnection(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Baglanti timeout')), timeout)
          )
        ]);

        try {
          let result;

          if (Array.isArray(params) && params.length > 0) {
            result = await Promise.race([
              connection. execute(sql, params),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Query timeout')), timeout)
              )
            ]);
          } else {
            result = await Promise.race([
              connection.query(sql),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Query timeout')), timeout)
              )
            ]);
          }

          const queryDuration = Date.now() - queryStartTime;

          this.stats. totalQueries++;
          this.stats.successfulQueries++;

          if (this. logger && options.logQuery !== false) {
            this.logger.debug('db_sorgu_basarili', `Sorgu basarili (${queryDuration}ms)`, {
              klasor: 'database',
              key:  'query',
              dbName,
              sure: queryDuration,
              satirSayisi: result[0] ? result[0].length : 0,
              traceID: traceId
            }).catch(() => {});
          }

          poolData.isHealthy = true;
          poolData.errorCount = 0;

          return result;
        } finally {
          connection. release();
        }
      } catch (error) {
        lastError = error;
        attempt++;
        this.stats.failedQueries++;

        if (this.logger && attempt < maxRetry) {
          console.warn('[WARN] db_query_retry', `Retry ${attempt}/${maxRetry}`, error.message);
          this.logger.warn('db_query_retry', `Retry ${attempt}/${maxRetry}`, {
            klasor:  'database',
            key: 'query',
            dbName,
            hata: error.message,
            deneme: attempt,
            traceID: traceId
          }).catch(() => {});
        }

        if (['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED']. includes(error.code)) {
          poolData.isHealthy = false;
          poolData.errorCount++;
          await this._handlePoolError(dbName, error);
        }

        if (attempt < maxRetry) {
          await new Promise(resolve => 
            setTimeout(resolve, this.yenidenGecikmeMs * attempt)
          );
        }
      }
    }

    console.error('[ERROR] db_query_basarisiz', `${maxRetry} deneme basarisiz`, lastError?. message);
    this.logger.error('db_query_basarisiz', `Sorgu basarisiz (${maxRetry} deneme)`, {
      klasor:  'database',
      key: 'query',
      dbName,
      sql:  sql.substring(0, 100),
      hata: lastError?. message,
      denemeSayisi:  maxRetry,
      sure: Date.now() - queryStartTime,
      traceID: traceId
    }).catch(() => {});

    throw lastError || new Error('Veritabani sorgusu basarisiz');
  }

  async query(dbName, sql, params = [], options = {}) {
    if (this.isDisabled) {
      throw new Error(`Veritabani devre disi: ${this.disableReason}`);
    }

    if (options.queue) {
      return new Promise((resolve, reject) => {
        try {
          this._enqueueQuery({
            dbName,
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

    return this._executeQuery(dbName, sql, params, options);
  }

  async lightQuery(dbName, sql, params = [], traceId = null) {
    return this.query(dbName, sql, params, {
      retries: 2,
      queue: true,
      timeoutMs: 5000,
      traceId
    });
  }

  async heavyQuery(dbName, sql, params = [], traceId = null) {
    return this.query(dbName, sql, params, {
      retries: 3,
      queue:  true,
      timeoutMs: this.zamanAsimi,
      traceId
    });
  }

  async transaction(dbName, callback) {
    if (this.isDisabled) {
      throw new Error(`Veritabani devre disi: ${this.disableReason}`);
    }

    const poolData = this.pools.get(dbName);
    if (!poolData) {
      throw new Error(`Pool bulunamadi: ${dbName}`);
    }

    const connection = await poolData.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection. commit();
      return result;
    } catch (error) {
      await connection. rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async healthCheck() {
    if (this.isDisabled) {
      return { status: 'disabled', reason: this.disableReason };
    }

    const results = {};

    for (const [dbName, poolData] of this.pools) {
      try {
        const connection = await poolData. pool.getConnection();
        await connection.ping();
        connection.release();

        results[dbName] = {
          status: 'healthy',
          isHealthy: true,
          queries: this.stats.totalQueries,
          successRate: ((this.stats.successfulQueries / Math.max(this.stats.totalQueries, 1)) * 100).toFixed(2) + '%'
        };

        poolData.isHealthy = true;
      } catch (error) {
        results[dbName] = {
          status: 'unhealthy',
          isHealthy: false,
          hata: error.message
        };

        poolData.isHealthy = false;

        console.error('[ERROR] db_saglik_hata', dbName, error.message);
        this.logger.error('db_saglik_hata', `Saglik kontrolu basarisiz: ${dbName}`, {
          klasor:  'database',
          key: 'health',
          dbName,
          hata: error.message
        }).catch(() => {});
      }
    }

    return results;
  }

  getStats() {
    return {
      ... this.stats,
      kuyrukUzunlugu: this.queryQueue.length,
      poolSayisi: this.pools.size,
      disabled: this.isDisabled,
      disableReason: this.disableReason
    };
  }

  async shutdown(timeoutMs = 5000) {
    try {
      const shutdownPromises = [];

      for (const [dbName, poolData] of this.pools) {
        shutdownPromises.push(
          Promise.race([
            poolData.pool. end(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Kapatma timeout: ${dbName}`)), timeoutMs)
            )
          ])
        );
      }

      await Promise.all(shutdownPromises);

      this.logger.info('db_kapatildi', `Tum DB havuzlari kapatildi`, {
        klasor: 'database',
        key: 'shutdown',
        poolSayisi: this. pools.size
      }).catch(() => {});
    } catch (error) {
      console.error('[ERROR] db_kapatma_hata', error. message);
      this.logger.error('db_kapatma_hata', `Kapatma hatasi`, {
        klasor: 'database',
        key: 'shutdown',
        hata: error.message
      }).catch(() => {});
      throw error;
    }
  }
}

module.exports = DatabaseManager;