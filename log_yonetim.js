// log_yonetim.js
// Enterprise Log Yönetim Sistemi
// Rotasyon, auto-cleanup, state repair, emoji UI

const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');

const LOGLAR_ROOT = path.join(process.cwd(), 'loglar');
const LOGLAR_SUNUCULAR = path.join(LOGLAR_ROOT, 'sunucular');
const LOGLAR_DM = path.join(LOGLAR_ROOT, 'dm');
const LOGLAR_BOT_GENEL = path.join(LOGLAR_ROOT, 'bot_genel');
const LOGLAR_DATABASE = path.join(LOGLAR_ROOT, 'database');
const LOGLAR_PANEL = path.join(LOGLAR_ROOT, 'panel');
const LOGLAR_SISTEMI = path.join(LOGLAR_ROOT, 'log_sistemi.  jsonl');
const LOGLAR_ARSIV = path.join(LOGLAR_ROOT, 'log_kalici_arsiv');
const DEFAULT_CONFIG = path.join(LOGLAR_ROOT, 'default_config.json');

// ✅ DYNAMIK SILME SÜRESİ - ENV'DEN
const KALICI_LOG_SILME_SANIYE = Number(process.env.KALICI_LOG_DOSYA_SILME_SANIYE || 2592000); // Varsayılan 1 ay
const LOG_BOYUTU_SINIRI = 5 * 1024 * 1024 * 1024; // 5GB

class LogYonetim {
  static async ensureLogDirs() {
    try {
      const dirs = [
        LOGLAR_SUNUCULAR,
        LOGLAR_DM,
        LOGLAR_BOT_GENEL,
        LOGLAR_DATABASE,
        LOGLAR_PANEL,
        LOGLAR_ARSIV
      ];

      for (const dir of dirs) {
        await fsp.mkdir(dir, { recursive: true });
      }

      if (! fs.existsSync(LOGLAR_SISTEMI)) {
        fs.writeFileSync(LOGLAR_SISTEMI, '', 'utf8');
      }

      if (!fs.existsSync(DEFAULT_CONFIG)) {
        const config = {
          olusmaTarih: new Date().toISOString(),
          logBoyutuSiniri: LOG_BOYUTU_SINIRI,
          kaliciLogSilmeSaniye: KALICI_LOG_SILME_SANIYE,
          rotasyonTarihler: [],
          stateRepairLog: []
        };
        fs.writeFileSync(DEFAULT_CONFIG, JSON.stringify(config, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('❌ Log dizini oluşturma hatası:', e && e.message);
    }
  }

  /**
   * ✅ LOG ROTASYONU - 5GB
   * @private
   */
  static async _checkLogRotation() {
    try {
      await LogYonetim.ensureLogDirs();

      if (!fs.existsSync(LOGLAR_SISTEMI)) {
        return;
      }

      const stats = fs.statSync(LOGLAR_SISTEMI);
      const boyut = stats.size;

      if (boyut > LOG_BOYUTU_SINIRI) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const arsivAdi = `log_sistemi_${timestamp}.jsonl`;
        const arsivPath = path.join(LOGLAR_ARSIV, arsivAdi);

        await fsp.rename(LOGLAR_SISTEMI, arsivPath);
        fs.writeFileSync(LOGLAR_SISTEMI, '', 'utf8');

        try {
          const config = JSON. parse(fs.readFileSync(DEFAULT_CONFIG, 'utf8'));
          config.rotasyonTarihler.push({
            tarih: new Date().toISOString(),
            dosya: arsivAdi,
            boyut: boyut,
            silinecekTarih: new Date(Date.now() + KALICI_LOG_SILME_SANIYE * 1000).toISOString()
          });
          fs.writeFileSync(DEFAULT_CONFIG, JSON.stringify(config, null, 2), 'utf8');
        } catch (_) {}

        console.log(`📦 LOG ROTASYONU: ${arsivAdi} (${(boyut / 1024 / 1024 / 1024).toFixed(2)}GB)`);
      }
    } catch (e) {
      console.error('❌ Rotasyon hatası:', e && e.message);
    }
  }

  /**
   * ✅ AUTO-CLEANUP - ESKI LOGLAR SİLİNİR
   * Bot açıldığında çalışır
   * @private
   */
  static async _cleanupOldLogs() {
    try {
      await LogYonetim. ensureLogDirs();

      const files = await fsp.readdir(LOGLAR_ARSIV).catch(() => []);
      const now = Date.now();
      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of files) {
        const filePath = path.join(LOGLAR_ARSIV, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > KALICI_LOG_SILME_SANIYE * 1000) {
          await fsp.unlink(filePath);
          deletedCount++;
          deletedSize += stats.size;
        }
      }

      if (deletedCount > 0) {
        const sizeMb = (deletedSize / 1024 / 1024).toFixed(2);
        console.log(`🗑️ LOG TEMIZLEME: ${deletedCount} dosya silindi (${sizeMb}MB)`);
      }

      return { deletedCount, deletedSize };
    } catch (e) {
      console.error('❌ Cleanup hatası:', e && e.message);
      return { deletedCount: 0, deletedSize:  0 };
    }
  }

  /**
   * ✅ STATE DOSYASI AKILLI RECOVERY
   * @private
   */
  static async _repairStateFile(stateFile) {
    try {
      if (fs.existsSync(stateFile)) {
        const data = fs.readFileSync(stateFile, 'utf8');
        JSON.parse(data);
        return true; // Dosya sağlam
      }
      return false;
    } catch (e) {
      try {
        // Bozuk dosyayı sil
        await fsp.unlink(stateFile);
        
        // Config'e kaydet
        try {
          const config = JSON. parse(fs.readFileSync(DEFAULT_CONFIG, 'utf8'));
          config.stateRepairLog.push({
            tarih: new Date().toISOString(),
            dosya: path.basename(stateFile),
            neden: 'JSON parse hatası - otomatik silinmişti',
            action: 'DELETED'
          });
          fs.writeFileSync(DEFAULT_CONFIG, JSON.stringify(config, null, 2), 'utf8');
        } catch (_) {}

        return false;
      } catch (_) {
        return false;
      }
    }
  }

  /**
   * Log yazma
   */
  static async writeLog(data) {
    try {
      await LogYonetim.ensureLogDirs();
      await LogYonetim._checkLogRotation();

      const entry = {
        timestamp: new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID: data.traceID || null,
        ... data
      };

      const line = JSON.stringify(entry) + '\n';
      await fsp.appendFile(LOGLAR_SISTEMI, line, 'utf8');
    } catch (e) {
      console.error('❌ Log yazma hatası:', e && e. message);
    }
  }

  static writeLogSync(data) {
    try {
      if (!fs.existsSync(LOGLAR_ROOT)) {
        fs.mkdirSync(LOGLAR_ROOT, { recursive: true });
      }

      const entry = {
        timestamp: new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID: data.traceID || null,
        ... data
      };

      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(LOGLAR_SISTEMI, line, 'utf8');
    } catch (e) {
      console.error('❌ Sync log yazma hatası:', e && e.message);
    }
  }

  static async writeRegularLog(klasor, key, data) {
    try {
      await LogYonetim.ensureLogDirs();
      
      let logDir = LOGLAR_BOT_GENEL;
      if (klasor === 'sunucular') logDir = LOGLAR_SUNUCULAR;
      else if (klasor === 'dm') logDir = LOGLAR_DM;
      else if (klasor === 'database') logDir = LOGLAR_DATABASE;
      else if (klasor === 'panel') logDir = LOGLAR_PANEL;

      const filePath = path.join(logDir, `${key}.jsonl`);
      const entry = {
        timestamp: new Date().toISOString(),
        severity: data.severity || 'INFO',
        traceID:  data.traceID || null,
        ...data
      };

      const line = JSON.stringify(entry) + '\n';
      await fsp.appendFile(filePath, line, 'utf8');
    } catch (e) {
      console.error('❌ Regular log hatası:', e && e.message);
    }
  }

  // ==================== LOG FONKSİYONLARI ====================

  static async debug(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'DEBUG',
      emoji: '🔍',
      mesaj: message,
      traceID: opts.traceID || null,
      ... opts
    };

    await LogYonetim.writeLog(entry);
    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'debug', entry);
    }
  }

  static async info(event, message, opts = {}) {
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
      await LogYonetim.writeRegularLog(opts.klasor, opts. key || 'info', entry);
    }
  }

  static async warn(event, message, opts = {}) {
    const entry = {
      tur:  event,
      severity: 'WARN',
      emoji: '⚠️',
      mesaj: message,
      traceID: opts.traceID || null,
      ...opts
    };

    await LogYonetim.writeLog(entry);
    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'warn', entry);
    }
  }

  static async error(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'ERROR',
      emoji: '❌',
      mesaj: message,
      traceID: opts.traceID || null,
      ... opts
    };

    await LogYonetim.writeLog(entry);
    if (opts.klasor) {
      await LogYonetim.writeRegularLog(opts.klasor, opts.key || 'error', entry);
    }
  }

  static async critical(event, message, opts = {}) {
    const entry = {
      tur: event,
      severity: 'CRITICAL',
      emoji: '🔴',
      mesaj: message,
      traceID: opts. traceID || null,
      alarm: true,
      ...opts
    };

    LogYonetim.writeLogSync(entry);

    if (opts.klasor) {
      try {
        await LogYonetim.writeRegularLog(opts.klasor, 'critical', entry);
      } catch (_) {}
    }
  }

  // ==================== SİSTEM İŞLEMLERİ ====================

  static async sistemBasladi() {
    LogYonetim.writeLogSync({
      tur: 'sistem_basladi',
      emoji: '🟢',
      severity: 'INFO',
      mesaj: 'Bot sistemi başlatıldı'
    });

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', {
        tur: 'sistem_basladi',
        emoji: '🟢',
        severity:  'INFO',
        mesaj: 'Bot hazır'
      });

      // ✅ BOT AÇILIŞINDA AUTO-CLEANUP
      await LogYonetim._cleanupOldLogs();
    } catch (_) {}
  }

  static async sistemKapandi() {
    LogYonetim.writeLogSync({
      tur: 'sistem_kapandi',
      emoji: '🔴',
      severity: 'INFO',
      mesaj: 'Bot sistemi kapatıldı'
    });

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', {
        tur: 'sistem_kapandi',
        emoji: '🔴',
        severity: 'INFO',
        mesaj: 'Bot kapatıldı'
      });
    } catch (_) {}
  }

  static async sistemHatasi(mesaj, seviye = 'ERROR', traceId = null) {
    LogYonetim.writeLogSync({
      tur: 'sistem_hatasi',
      emoji:  '🚨',
      severity: seviye,
      mesaj: mesaj. substring(0, 300),
      traceID: traceId
    });

    try {
      await LogYonetim.writeRegularLog('bot_genel', 'sistem', {
        tur: 'sistem_hatasi',
        emoji: '🚨',
        severity: seviye,
        mesaj: mesaj.substring(0, 300),
        traceID: traceId
      });
    } catch (_) {}
  }

  static async komutRegister(toplamKomut, degisenleri, eklenenler, silenenler, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'komut_register',
      severity: 'INFO',
      emoji: '📋',
      toplamKomut,
      degisenleri,
      eklenenler,
      silenenler,
      traceID:  traceId,
      mesaj: `Komutlar kaydedildi - Toplam: ${toplamKomut}, Değişen: ${degisenleri}, Eklenen: ${eklenenler}, Silinen: ${silenenler}`
    });
  }

  static async panelAcildi(userId, sayfa = 1, guildId = null, traceId = null) {
    await LogYonetim. writeLog({
      tur:  'panel_acildi',
      emoji: '📊',
      severity: 'INFO',
      kullaniciID: userId,
      guildID: guildId,
      sayfa,
      traceID: traceId,
      mesaj: `Panel açıldı - Sayfa ${sayfa}`
    });

    await LogYonetim.writeRegularLog('panel', userId, {
      tur: 'panel_acildi',
      emoji: '📊',
      severity: 'INFO',
      sayfa,
      traceID:  traceId,
      mesaj: 'Panel açıldı'
    });
  }

  static async panelKapandi(userId, neden = 'unknown', guildId = null, traceId = null) {
    const nedenAciklama = {
      'kullanici':  '👤 Kullanıcı kapatmış',
      'timeout': '⏰ Süresi dolmuş',
      'error': '❌ Hata nedeniyle',
      'unknown': '❓ Bilinmeyen neden'
    };

    await LogYonetim. writeLog({
      tur:  'panel_kapandi',
      emoji: '🔴',
      severity: 'INFO',
      kullaniciID: userId,
      guildID: guildId,
      neden,
      traceID: traceId,
      mesaj: `Panel kapatıldı - ${nedenAciklama[neden] || neden}`
    });

    await LogYonetim.writeRegularLog('panel', userId, {
      tur: 'panel_kapandi',
      emoji:  '🔴',
      severity: 'INFO',
      neden,
      traceID:  traceId,
      mesaj: 'Panel kapatıldı'
    });
  }

  static async kullaniciKomut(userId, komut, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'komut_kullanildi',
      emoji: '💬',
      severity: 'INFO',
      kullaniciID: userId,
      guildID: guildId,
      komut,
      traceID: traceId,
      mesaj: `Komut kullanıldı:  /${komut}`
    });
  }

  static async yetkiHatasi(userId, islem, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'yetki_hatasi',
      emoji: '🚫',
      severity: 'WARN',
      kullaniciID: userId,
      guildID: guildId,
      islem,
      traceID:  traceId,
      mesaj: `Yetkisiz işlem - ${islem}`
    });

    await LogYonetim.writeRegularLog('sunucular', userId, {
      tur: 'yetki_hatasi',
      emoji:  '🚫',
      severity: 'WARN',
      islem,
      traceID: traceId,
      mesaj: 'Yetkisiz işlem'
    });
  }

  static async sorguBasarili(userId, tablo, sure_ms, satirSayisi, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'sorgu_basarili',
      emoji: '✅',
      severity: 'DEBUG',
      kullaniciID:  userId,
      guildID:  guildId,
      tablo,
      sure_ms,
      satirSayisi,
      traceID: traceId,
      mesaj: `Sorgu başarılı - ${satirSayisi} satır, ${sure_ms}ms`
    });

    await LogYonetim.writeRegularLog('database', 'sorgu', {
      tur: 'sorgu_basarili',
      emoji: '✅',
      severity: 'DEBUG',
      tablo,
      sure_ms,
      satirSayisi,
      traceID: traceId,
      mesaj:  'Sorgu başarılı'
    });
  }

  static async sorguHatasi(userId, tablo, hata, guildId = null, traceId = null) {
    await LogYonetim. writeLog({
      tur:  'sorgu_hatasi',
      emoji: '❌',
      severity: 'ERROR',
      kullaniciID: userId,
      guildID: guildId,
      tablo,
      hata:  hata.substring(0, 200),
      traceID: traceId,
      mesaj:  `Sorgu hatası - ${tablo}`
    });

    await LogYonetim.writeRegularLog('database', 'sorgu', {
      tur: 'sorgu_hatasi',
      emoji: '❌',
      severity: 'ERROR',
      tablo,
      hata:  hata.substring(0, 100),
      traceID: traceId,
      mesaj:  'Sorgu hatası'
    });
  }

  static async dmGonderildi(userId, baslik, guildId = null, traceId = null) {
    await LogYonetim.writeLog({
      tur: 'dm_gonderildi',
      emoji: '📧',
      severity: 'INFO',
      kullaniciID:  userId,
      guildID:  guildId,
      baslik,
      traceID: traceId,
      mesaj: `DM gönderildi - ${baslik}`
    });

    await LogYonetim.writeRegularLog('dm', userId, {
      tur: 'dm_gonderildi',
      emoji:  '📧',
      severity:  'INFO',
      baslik,
      traceID: traceId,
      mesaj:  'DM gönderildi'
    });
  }

  static async dmGonderimHatasi(userId, neden, guildId = null, traceId = null) {
    const nedenAciklama = {
      'dmKapali': '🔒 DM kapalı',
      'izinYok': '❌ İzin yok',
      'timeout': '⏱️ Zaman aşımı',
      'unknown': '❓ Bilinmeyen'
    };

    await LogYonetim.writeLog({
      tur: 'dm_gonderim_hatasi',
      emoji:  '⚠️',
      severity:  'WARN',
      kullaniciID: userId,
      guildID: guildId,
      neden,
      traceID: traceId,
      mesaj: `DM gönderilemedi - ${nedenAciklama[neden] || neden}`
    });

    await LogYonetim.writeRegularLog('dm', userId, {
      tur: 'dm_gonderim_hatasi',
      emoji: '⚠️',
      severity: 'WARN',
      neden,
      traceID: traceId,
      mesaj: 'DM gönderilemedi'
    });
  }
}

module.exports = LogYonetim;