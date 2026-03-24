// index.js
// Discord Bot - Ultra Gelişmiş Çekirdek Sistem
// VIP/Premium yetki, oda yönetimi, dinamik config, DB senkronizasyon
// ENV mask parametreleri gerçek zamanlı takip
// TEK DOSYA - TAM VE EKSİKSİZ - Production Ready
// v3.1 - Düzeltilmiş ODA sistemi, config-bağımlı kisitlama, embed optimize
global.__ROOT_DIR__ = __dirname;
require('dotenv').config();
require("module-alias/register");
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const https = require('https');
const http = require('http');
const DbManager = require('@ozel_yapim_moduller/dbManager');
// ==================== PROMOSYON KODLARI MODÜLÜ ====================
const PromoModul = require('@ozel_yapim_moduller/promosyon_kodlar_kontrol_modul.js');


// ==================== SONUÇ DOSYA GÖNDERİM MODÜLÜ (YENİ) ====================
// Not: Bu modül fetch/FormData/Blob kullanır. Node sürümü eski ise, mümkünse polyfill yapılır.
(function ensureWebApiPolyfills() {
  try {
    if (typeof globalThis.fetch !== 'function' || typeof globalThis.FormData !== 'function' || typeof globalThis.Blob !== 'function') {
      // Öncelik: undici (Node 18+ ile uyumlu)
      try {
        const undici = require('undici');
        if (typeof globalThis.fetch !== 'function' && typeof undici.fetch === 'function') globalThis.fetch = undici.fetch;
        if (typeof globalThis.FormData !== 'function' && typeof undici.FormData === 'function') globalThis.FormData = undici.FormData;
        if (typeof globalThis.Blob !== 'function' && typeof undici.Blob === 'function') globalThis.Blob = undici.Blob;
      } catch (_) {}

      // Alternatif: node-fetch (varsa)
      if (typeof globalThis.fetch !== 'function') {
        try {
          const nf = require('node-fetch');
          const f = nf.default || nf;
          if (typeof f === 'function') globalThis.fetch = f;
          if (typeof globalThis.Headers !== 'function' && nf.Headers) globalThis.Headers = nf.Headers;
          if (typeof globalThis.Request !== 'function' && nf.Request) globalThis.Request = nf.Request;
          if (typeof globalThis.Response !== 'function' && nf.Response) globalThis.Response = nf.Response;
        } catch (_) {}
      }
    }
  } catch (_) {}
})();

let SonucDosyaGonderim = null;
try {
  SonucDosyaGonderim = require('./sonuc_dosya_gonderim');
} catch (e) {
  // Prod ortamında dosya yoksa bot çökmemeli
  SonucDosyaGonderim = null;
}

// Komutlar bazen @ozel_yapim_moduller/sonuc_dosya_gonderim üzerinden import edebilir.
// Bu yüzden yerel (güncel) modülü alias yoluna da yönlendiriyoruz (best-effort).
if (SonucDosyaGonderim) {
  try {
    const localKey = require.resolve('./sonuc_dosya_gonderim');
    const localMod = require.cache[localKey];
    if (localMod) {
      const aliases = [
        '@ozel_yapim_moduller/sonuc_dosya_gonderim',
        '@ozel_yapim_moduller/sonuc_dosya_gonderim.js'
      ];
      for (const a of aliases) {
        try {
          const aliasKey = require.resolve(a);
          require.cache[aliasKey] = localMod;
        } catch (_) {}
      }
    }
  } catch (_) {}
}

const odaCache = new Map();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  Collection
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// ==================== SABİTLER VE YOLLAR ====================

const BASE_DIR = process.cwd();

const RUTBE_DIR = path.join(BASE_DIR, 'rutbe');
const VIP_DIR = path.join(RUTBE_DIR, 'vip');
const PREMIUM_DIR = path.join(RUTBE_DIR, 'premium');
const VIP_KOMUT_DIR = path.join(VIP_DIR, 'komut');

const PREMIUM_KOMUT_DIR = path.join(PREMIUM_DIR, 'komut');


const ODA_GERI_SAYIM_INTERVAL_MS = 1000;

const COP_TEMIZLIK_DIR = path.join(process.cwd(), 'cop_temizlik');
const COP_TEMIZLIK_STARTUP_DELAY_MS = 2000;


// ==================== 1 SANİYELİK GLOBAL TICK GERİ SAYIM MEKANİZMASI (DOSYA TABANLI) ====================
// Amaç: Komutların state dosyalarında (memory kullanmadan) saniyelik geri sayım yapmak.
// - root/state/yardim_komutu/<mesajid>.json (yardım)  -> mevcut davranış KORUNUR (min 2s tabanı + finalize/cop taşıma)
// - root/state/ip_komutu/<mesajid>.json (ip)         -> her saniye dosyadan oku, -1 yaz, embed alanını güncelle, bitince butonları kilitle + cop'a taşı
// Not: Bu mekanizma asla memory içi "kalan süre" tutmaz. Her tick'te dosya okunur ve sadece dosya güncellenir.

const STATE_ROOT_DIR = path.join(process.cwd(), 'state');
const STATE_CONFIG_FILE = path.join(STATE_ROOT_DIR, 'config.json');

const YARDIM_STATE_DIR = path.join(process.cwd(), 'state', 'yardim_komutu');
const IP_STATE_DIR = path.join(process.cwd(), 'state', 'ip_komutu');
const RATE_LIMIT_KONTROL_DIR = path.join(process.cwd(), 'state', 'rate_limit_kontrol');
const RATE_LIMIT_KONTROL_FILE = path.join(RATE_LIMIT_KONTROL_DIR, 'kontrol.json');

const GLOBAL_STATE_TICK_INTERVAL_MS = 1000;

let globalStateTickAktif = false;
let globalStateTickIntervalId = null;
let globalStateTickRunning = false;
let globalTickYardimRunning = false;
let globalTickIpRunning = false;
let globalTickRateLimitRunning = false;
let globalTickBotCommandUsageRunning = false;
let __botCommandUsageLastDailyKey = null;
let __botCommandUsageLastMonthlyKey = null;
let odaGeriSayimAktif = false;
let odaGeriSayimIntervalId = null;

let copTemizlikAktif = false;
let copTemizlikIntervalId = null;
let copTemizlikSonZamani = null;

const VIP_YETKILI_FILE = path.join(BASE_DIR, 'rutbe', 'vip', 'vip_yetkili_kisiler.json');
const PREMIUM_YETKILI_FILE = path.join(BASE_DIR, 'rutbe', 'premium', 'premium_yetkili_kisiler.json');


// Yetki kontrol dosyaları (aktif/pasif + zaman aralığı) - root dizindeki klasörden okunur
const BOT_YETKI_KONTROL_DIR = path.join(BASE_DIR, 'bot_yetki_kontrol_dosyalar');
const VIP_KONTROL_FILE = path.join(BOT_YETKI_KONTROL_DIR, 'vip_yetkililer.json');
const PREMIUM_KONTROL_FILE = path.join(BOT_YETKI_KONTROL_DIR, 'premium_yetkililer.json');
const ADMIN_KONTROL_FILE = path.join(BOT_YETKI_KONTROL_DIR, 'admin_yetkililer.json');

const YETKI_KONTROL_TICK_MS = 1000;
const SUNUCU_DM_VERILER_DIR = path.join(BASE_DIR, 'sunucu_dm_veriler');
const SUNUCU_VERILER_DIR = path.join(SUNUCU_DM_VERILER_DIR, 'sunucu');
const DM_VERILER_DIR = path.join(SUNUCU_DM_VERILER_DIR, 'dm');

const UCRETSIZ_KOMUTLAR_DIR = path.join(BASE_DIR, 'ucretsiz_komutlar');
const OWNER_KOMUT_DIR = path.join(BASE_DIR, 'owner_komutlar');
const ADMIN_KOMUT_DIR = path.join(BASE_DIR, 'admin_komutlar');

const LOGLAR_ROOT = path.join(BASE_DIR, 'loglar');
const CACHE_DIR = path.join(BASE_DIR, '.cache');


// ==================== SİSTEM LOG (log_sistemi.jsonl) ====================
// Önemli tick/temizlik/self-test kayıtlarını buraya basacağız.
const LOG_SISTEMI_FILE = path.join(LOGLAR_ROOT, 'log_sistemi.jsonl');

function appendSystemLog(entry) {
  try {
    if (!fs.existsSync(LOGLAR_ROOT)) fs.mkdirSync(LOGLAR_ROOT, { recursive: true });
    if (!fs.existsSync(LOG_SISTEMI_FILE)) fs.writeFileSync(LOG_SISTEMI_FILE, '', 'utf8');

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    }) + '\n';

    fs.appendFileSync(LOG_SISTEMI_FILE, line, 'utf8');
  } catch (_) {}
}



// ==================== UTF-8 CONSOLE FIX (Windows/CMD uyumu) ====================
// Bazı CMD ekranlarında Türkçe karakter/emoji bozulmasını azaltmak için best-effort ayarlar.
// (Node tarafında garanti vermez; ama çoğu ortamda gözle görülür iyileştirir.)
(function __ensureUtf8Console() {
  try {
    if (process?.stdout?.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');
    if (process?.stderr?.setDefaultEncoding) process.stderr.setDefaultEncoding('utf8');
  } catch {}
})();

// ==================== KOMUT YÜKLEME ÖZET & ÖZEL LOG (loglar/komut_yukleme) ====================

const KOMUT_YUKLEME_LOG_DIR = path.join(LOGLAR_ROOT, 'komut_yukleme');

async function __writeKomutYuklemeLog(scope, entry) {
  try {
    await fsp.mkdir(KOMUT_YUKLEME_LOG_DIR, { recursive: true });
    const day = new Date().toISOString().split('T')[0];
    const fp = path.join(KOMUT_YUKLEME_LOG_DIR, `${day}.jsonl`);

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: scope || 'global',
      ...entry
    }) + '\n';

    await fsp.appendFile(fp, line, 'utf8').catch(() => {});
    // mevcut rotation util'ini burada da kullan (best-effort)
    await __withLogLock(fp, async () => {
      await __rotateIfNeeded(fp, 'komut_yukleme');
    }).catch(() => {});
  } catch {}
}

function __prettyLine(title) {
  const t = String(title || '').trim();
  const bar = '='.repeat(Math.max(20, t.length + 8));
  return `\n${bar}\n  ${t}\n${bar}`;
}


// ==================== STARTUP: PAKET KAYBI / ATLANAN İÇERİK RAPORU ====================
// Sadece bot ilk açılırken 1 kez basılır (tekrar etmez).
async function __printStartupPacketLossOnce() {
  try {
    if (__startupIntegrityPrinted) return;
    __startupIntegrityPrinted = true;

    const snap = __lastCommandTrackingSnapshot || {};
    const scope = snap.scope || {};

    const guildFailed = Array.isArray(scope.guildFailed) ? scope.guildFailed : [];
    const dmFailed = Array.isArray(scope.dmFailed) ? scope.dmFailed : [];

    const guildCommands = Array.isArray(scope.guildCommands) ? scope.guildCommands : [];
    const dmCommands = Array.isArray(scope.dmCommands) ? scope.dmCommands : [];

    const failedTotal = guildFailed.length + dmFailed.length;
    const okTotal = guildCommands.length + dmCommands.length;

    const denom = Math.max(1, okTotal + failedTotal);
    const lossPct = ((failedTotal / denom) * 100);

    const integ = __startupIntegritySnapshot || {};
    const atlanan = Number(integ.atlanan_icerik || 0) || 0;
    const hata = Number(integ.hata || 0) || 0;

    // Console (CMD/Terminal)
    try {
      console.log(__prettyLine('📶 PAKET DURUMU / İÇERİK KONTROLÜ'));
      console.log(`📡 Paket kaybı: %${lossPct.toFixed(2)}  (${failedTotal}/${denom})`);
      console.log(`🧩 Atlanan içerikler: ${atlanan}  |  Yükleme hatası: ${hata}`);

      if (failedTotal > 0) {
        const sample = guildFailed.concat(dmFailed).slice(0, 10).map(x => String(x)).filter(Boolean);
        if (sample.length) console.log(`⚠️ Örnek (ilk ${sample.length}): ${sample.join(', ')}`);
      }
      if (atlanan > 0 && Array.isArray(integ.ornek_atlanan) && integ.ornek_atlanan.length) {
        const s = integ.ornek_atlanan.slice(0, 10).map(x => String(x)).filter(Boolean);
        if (s.length) console.log(`⏭️ Atlanan örnekleri: ${s.join(', ')}`);
      }
      if (hata > 0 && Array.isArray(integ.ornek_hata) && integ.ornek_hata.length) {
        const s = integ.ornek_hata.slice(0, 10).map(x => String(x)).filter(Boolean);
        if (s.length) console.log(`❗ Hata örnekleri: ${s.join(', ')}`);
      }
      console.log('✅ Kontrol tamamlandı. (Bu bilgi yalnızca açılışta gösterilir.)\n');
    } catch {}

    // Dosya log (best-effort)
    await SafeLog.info('startup_integrity', 'Paket kaybı / atlanan içerik raporu (açılış)', {
      klasor: 'bot_genel',
      key: 'startup',
      paket_kaybi_yuzde: Number(lossPct.toFixed(2)),
      paket_kaybi: failedTotal,
      toplam_paket: denom,
      atlanan_icerik: atlanan,
      yukleme_hatasi: hata
    }).catch(() => {});
  } catch {
  }
}

async function __logKomutYuklemeOzetToConsoleAndLogs(snapshot, opts = {}) {
  try {
    const guildCount = Number(opts?.sunucuSayisi ?? client?.guilds?.cache?.size ?? 0) || 0;

    const guildCommands = Array.isArray(snapshot?.scope?.guildCommands) ? snapshot.scope.guildCommands : [];
    const dmCommands = Array.isArray(snapshot?.scope?.dmCommands) ? snapshot.scope.dmCommands : [];
    const guildFailed = Array.isArray(snapshot?.scope?.guildFailed) ? snapshot.scope.guildFailed : [];
    const dmFailed = Array.isArray(snapshot?.scope?.dmFailed) ? snapshot.scope.dmFailed : [];

    const guildOk = Math.max(0, guildCommands.length - guildFailed.length);
    const dmOk = Math.max(0, dmCommands.length - dmFailed.length);

    const guildFailCount = Math.max(0, guildFailed.length);
    const dmFailCount = Math.max(0, dmFailed.length);

    // Console banner
    console.log(__prettyLine('📦 KOMUT YÜKLEME ÖZETİ'));
    console.log(`🌐 Sunuculara komut yükleme özeti:`);
    console.log(`  ✅ ${guildOk} komut, ${guildCount} sunucuya başarıyla yüklendi`);
    console.log(`  ${guildFailCount > 0 ? '❌' : '✅'} ${guildFailCount} komut, ${guildCount} sunucuya yüklenemedi`);
    console.log(`  ℹ️ Ek açıklama: ${guildFailCount > 0 ? 'Yüklenemeyen komutlar (sunucu) loglara başarıyla yazılmıştır !' : 'Her şey yolunda görünüyor. Komutlar stabil şekilde hazır ✅'}`);

    console.log(`\n💬 DM komut yükleme özeti:`);
    console.log(`  ✅ ${dmOk} komut, DM'de başarıyla yüklendi`);
    console.log(`  ${dmFailCount > 0 ? '❌' : '✅'} ${dmFailCount} komut, DM'de yüklenemedi`);
    console.log(`  ℹ️ Ek açıklama: ${dmFailCount > 0 ? 'Yüklenemeyen komutlar (dm) loglara başarıyla yazılmıştır !' : 'DM komutları da hazır ✅'}`);

    // Structured logs (SafeLog + özel dosya)
    await SafeLog.info('komut_yukleme_ozeti_sunucu', 'Sunuculara komut yükleme özeti', {
      klasor: 'bot_genel',
      key: 'startup',
      sunucuSayisi: guildCount,
      basariliKomut: guildOk,
      yuklenemeyenKomut: guildFailCount,
      ekAciklama: guildFailCount > 0
        ? 'Yüklenemeyen komutlar (sunucu) loglara başarıyla yazılmıştır !'
        : 'Her şey yolunda. Komutlar stabil şekilde hazır ✅'
    }).catch(() => {});

    await SafeLog.info('komut_yukleme_ozeti_dm', 'DM komut yükleme özeti', {
      klasor: 'bot_genel',
      key: 'startup',
      basariliKomut: dmOk,
      yuklenemeyenKomut: dmFailCount,
      ekAciklama: dmFailCount > 0
        ? 'Yüklenemeyen komutlar (dm) loglara başarıyla yazılmıştır !'
        : 'DM komutları stabil şekilde hazır ✅'
    }).catch(() => {});

    if (guildFailCount > 0) {
      await __writeKomutYuklemeLog('sunucu', {
        ok: false,
        sunucuSayisi: guildCount,
        yuklenemeyenKomutlar: guildFailed.slice(0, 500)
      });
    }

    if (dmFailCount > 0) {
      await __writeKomutYuklemeLog('dm', {
        ok: false,
        yuklenemeyenKomutlar: dmFailed.slice(0, 500)
      });
    }

  } catch (e) {
    await __writeKomutYuklemeLog('global', {
      ok: false,
      hata: String(e?.message || e).slice(0, 500)
    });
  }
}

const ADMINLER_DOSYA = path.join(BASE_DIR, 'adminler.json');
const COMMAND_SIGNATURE_FILE = path.join(CACHE_DIR, 'command_signature.json');

// Oda kapanış lock mekanizması (duple işlemi önleme)
const odaKapanisLock = new Set();
const odaKapanmaAktif = new Set();


// ==================== ENV DEĞİŞKENLERİ ====================

const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;
const PANEL_DEAKTIF_SANIYE = Math.max(10, Number(process.env.PANEL_DEAKTIF_SANIYE || 120));
const SUNUCU_GUNCELLEME_ARALIK = Math.max(60000, Number(process.env.SUNUCU_GUNCELLEME_ARALIK_MS || 86400000));
const ERROR_WEBHOOK_URL = process.env.ERROR_WEBHOOK_URL || '';
const FILE_DELETE_DELAY_MS = Math.max(1000, Number(process.env.FILE_DELETE_DELAY_MS || 2000));

// Cop temizlik dosyaları için TTL (ms).
// Not: Eski default 30dk idi; bu da loglarda "çalıştı" görünmesine rağmen klasörde dosya kalmasına sebep olabiliyordu.
// Default'u 60s yaptık. İhtiyaç halinde ENV ile yükseltilebilir: COP_TEMIZLIK_FILE_TTL_MS
const COP_TEMIZLIK_FILE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.COP_TEMIZLIK_FILE_TTL_MS || (60 * 1000))
);
// "Aktif kullanıcı" hesabı için pencere (ms). 60s: aynı anda aktif kitleyi yakalamak için yeterli, çok agresif değil.

// ==================== KOMUT DM/SUNUCU AYARLARI ====================

function getCommandContextSettings() {
  const dmAktifRaw = process.env.KOMUTLAR_DM_AKTIF;
  const sunucuAktifRaw = process.env.KOMUTLAR_SUNUCU_AKTIF;

  const dmAktif = dmAktifRaw === undefined || dmAktifRaw === null || dmAktifRaw === ''
    ? true
    : (dmAktifRaw === '1' || dmAktifRaw.toLowerCase() === 'true');

  const sunucuAktif = sunucuAktifRaw === undefined || sunucuAktifRaw === null || sunucuAktifRaw === ''
    ? true
    :  (sunucuAktifRaw === '1' || sunucuAktifRaw.toLowerCase() === 'true');

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

// ==================== ENV MASK PARAMETRELERİ ====================

const dosyaYazimContextStore = new AsyncLocalStorage();
const ENV_MASK_CHECK_INTERVAL = 1000;
const DEFAULT_TC_MASK_MODE = 0;
const DEFAULT_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const TEXT_FILE_WRITE_EXTENSIONS = new Set([
  '.txt', '.json', '.jsonl', '.csv', '.log', '.md', '.yaml', '.yml', '.xml',
  '.html', '.htm', '.js', '.ts', '.jsx', '.tsx', '.sql', '.ini', '.env'
]);
const PRIVACY_MASK_ENV_KEYS = {
  ucretsiz: 'UCRETSIZ_KOMUTLAR_GIZLILIK_MASKELEME',
  vip: 'VIP_KOMUTLAR_GIZLILIK_MASKELEME',
  premium: 'PREMIUM_KOMUTLAR_GIZLILIK_MASKELEME',
  admin: 'ADMIN_KOMUTLAR_GIZLILIK_MASKELEME'
};

const envMaskCache = Object.fromEntries(
  Object.keys(PRIVACY_MASK_ENV_KEYS).map(key => [key, { value: DEFAULT_TC_MASK_MODE, lastCheck: 0 }])
);

function normalizePrivacyMaskCategory(maskType) {
  switch (String(maskType || '').toLowerCase()) {
    case 'vip':
      return 'vip';
    case 'premium':
      return 'premium';
    case 'admin':
    case 'owner':
      return 'admin';
    case 'ucretsiz':
    case 'normal':
    default:
      return 'ucretsiz';
  }
}

function normalizeMaskMode(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return DEFAULT_TC_MASK_MODE;

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'evet', 'on', 'aktif'].includes(normalized)) return 1;
  return 0;
}

function getEnvMaskValue(maskType) {
  const category = normalizePrivacyMaskCategory(maskType);
  const now = Date.now();
  const cache = envMaskCache[category];

  if (!cache) return DEFAULT_TC_MASK_MODE;
  if ((now - cache.lastCheck) < ENV_MASK_CHECK_INTERVAL) {
    return cache.value;
  }

  const envKey = PRIVACY_MASK_ENV_KEYS[category];
  const mode = normalizeMaskMode(process.env[envKey]);

  cache.value = mode;
  cache.lastCheck = now;
  return mode;
}

function isCommandMasked(commandType) {
  return getEnvMaskValue(commandType) === 1;
}

function shouldBlockCommandByPrivacyMask() {
  // Gizlilik maskeleme ENV'leri komut görünürlüğünü değil,
  // yalnızca dosyaya yazım sırasında TC verisinin nasıl yazılacağını yönetir.
  return false;
}

function getCommandPrivacyCategory(commandType, cmd = null) {
  const explicitType = String(commandType || '').toLowerCase();
  const rutbeTipi = String(cmd?.rutbeTipi || '').toLowerCase();
  const permission = String(cmd?.permission || '').toLowerCase();

  if (explicitType === 'owner' || rutbeTipi === 'owner' || permission === 'owner') return 'admin';
  if (explicitType === 'admin' || rutbeTipi === 'admin' || permission === 'admin') return 'admin';
  if (explicitType === 'vip' || rutbeTipi === 'vip' || permission === 'vip') return 'vip';
  if (explicitType === 'premium' || rutbeTipi === 'premium' || permission === 'premium') return 'premium';
  return 'ucretsiz';
}

function runWithFileWriteContext(context, fn) {
  const safeContext = {
    category: normalizePrivacyMaskCategory(context?.category || 'ucretsiz'),
    commandName: context?.commandName || null,
    guildId: context?.guildId || null,
    userId: context?.userId || null,
    traceId: context?.traceId || null
  };

  return dosyaYazimContextStore.run(safeContext, fn);
}

function getActiveFileWriteContext() {
  return dosyaYazimContextStore.getStore() || null;
}

function isTextLikeFilePath(filePath) {
  try {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    return TEXT_FILE_WRITE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function isEncryptionEnabled() {
  const raw = process.env.ENCRYPTION_ENABLED;
  if (raw === undefined || raw === null || raw === '') return false;
  return ['1', 'true', 'evet', 'on', 'aktif'].includes(String(raw).trim().toLowerCase());
}

function getEncryptionAlgorithm() {
  const raw = String(process.env.ENCRYPTION_ALGORITHM || DEFAULT_ENCRYPTION_ALGORITHM).trim().toLowerCase();
  return raw || DEFAULT_ENCRYPTION_ALGORITHM;
}

function getEncryptionKey(category = 'ucretsiz') {
  const source = (
    process.env.ENCRYPTION_KEY ||
    process.env.ENCRYPTION_SECRET ||
    process.env.ENCRYPTION_PASSWORD ||
    TOKEN ||
    CLIENT_ID ||
    BOT_OWNER_ID ||
    'tc-gizlilik-varsayilan-anahtar'
  );

  return crypto
    .createHash('sha256')
    .update(`${source}:${normalizePrivacyMaskCategory(category)}:tc-gizlilik-v1`, 'utf8')
    .digest();
}

function encryptTcSegment(segment, category = 'ucretsiz') {
  try {
    const algorithm = getEncryptionAlgorithm();
    if (algorithm !== 'aes-256-gcm') return null;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, getEncryptionKey(category), iv);
    cipher.setAAD(Buffer.from(String(category || 'ucretsiz'), 'utf8'));

    const encrypted = Buffer.concat([
      cipher.update(String(segment), 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
  } catch {
    return null;
  }
}

function formatTcForFileWrite(tcValue, context = null) {
  const tc = String(tcValue ?? '').trim();
  if (!/^\d{11}$/.test(tc)) return tcValue;

  const activeContext = context || getActiveFileWriteContext();
  const category = normalizePrivacyMaskCategory(activeContext?.category || 'ucretsiz');
  const mode = getEnvMaskValue(category);

  if (mode !== 1) return tc;

  const first4 = tc.slice(0, 4);
  const middle3 = tc.slice(4, 7);
  const last4 = tc.slice(7);

  if (isEncryptionEnabled()) {
    const encryptedSegment = encryptTcSegment(middle3, category);
    if (encryptedSegment) {
      return `${first4}-${encryptedSegment}-${last4}`;
    }
  }

  return `${first4}***${last4}`;
}

function maskTcNumbersInText(text, context = null) {
  if (typeof text !== 'string' || text.length === 0) return text;

  const activeContext = context || getActiveFileWriteContext();
  const category = normalizePrivacyMaskCategory(activeContext?.category || 'ucretsiz');
  if (getEnvMaskValue(category) !== 1) return text;

  return text.replace(/(^|[^\d])(\d{11})(?!\d)/g, (full, prefix, tc) => {
    return `${prefix}${formatTcForFileWrite(tc, activeContext)}`;
  });
}

function sanitizeStructuredDataForFileWrite(value, context = null, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return maskTcNumbersInText(value, context);
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    const asString = String(value);
    if (/^\d{11}$/.test(asString)) {
      return formatTcForFileWrite(asString, context);
    }
    return value;
  }

  if (typeof value === 'bigint') {
    const asString = value.toString();
    if (/^\d{11}$/.test(asString)) {
      return formatTcForFileWrite(asString, context);
    }
    return value;
  }

  if (Buffer.isBuffer(value) || value instanceof Date || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeStructuredDataForFileWrite(item, context, seen));
  }

  const cloned = {};
  for (const [key, entryValue] of Object.entries(value)) {
    cloned[key] = sanitizeStructuredDataForFileWrite(entryValue, context, seen);
  }
  return cloned;
}

function looksLikeJsonString(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function detectJsonIndent(text) {
  try {
    const match = String(text || '').match(/\n(\s+)"/);
    if (!match) return 2;
    return Math.max(2, match[1].length);
  } catch {
    return 2;
  }
}

function transformStringForFileWrite(text, filePath, context = null) {
  if (typeof text !== 'string' || text.length === 0) return text;

  const activeContext = context || getActiveFileWriteContext();
  const category = normalizePrivacyMaskCategory(activeContext?.category || 'ucretsiz');
  if (getEnvMaskValue(category) !== 1) return text;

  if (looksLikeJsonString(text) || String(filePath || '').toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(text);
      const sanitized = sanitizeStructuredDataForFileWrite(parsed, activeContext);
      return JSON.stringify(sanitized, null, detectJsonIndent(text));
    } catch {
      // JSON değilse normal metin gibi maskele.
    }
  }

  return maskTcNumbersInText(text, activeContext);
}

function prepareDataForFileWrite(data, filePath, context = null) {
  const activeContext = context || getActiveFileWriteContext();
  if (!activeContext) return data;

  const category = normalizePrivacyMaskCategory(activeContext.category || 'ucretsiz');
  if (getEnvMaskValue(category) !== 1) return data;

  if (typeof data === 'string') {
    return transformStringForFileWrite(data, filePath, activeContext);
  }

  if (Buffer.isBuffer(data)) {
    if (!isTextLikeFilePath(filePath)) return data;
    const originalText = data.toString('utf8');
    const transformedText = transformStringForFileWrite(originalText, filePath, activeContext);
    return transformedText === originalText ? data : Buffer.from(transformedText, 'utf8');
  }

  if (data instanceof Uint8Array) {
    if (!isTextLikeFilePath(filePath)) return data;
    const originalText = Buffer.from(data).toString('utf8');
    const transformedText = transformStringForFileWrite(originalText, filePath, activeContext);
    return transformedText === originalText ? data : Buffer.from(transformedText, 'utf8');
  }

  return data;
}

function installFileWritePrivacyGuards() {
  if (global.__FILE_WRITE_PRIVACY_GUARDS_INSTALLED__) return;
  global.__FILE_WRITE_PRIVACY_GUARDS_INSTALLED__ = true;

  const originalPromiseWriteFile = fsp.writeFile.bind(fsp);
  const originalPromiseAppendFile = fsp.appendFile.bind(fsp);
  const originalWriteFileSync = fs.writeFileSync.bind(fs);
  const originalAppendFileSync = fs.appendFileSync.bind(fs);
  const originalWriteFile = typeof fs.writeFile === 'function' ? fs.writeFile.bind(fs) : null;
  const originalAppendFile = typeof fs.appendFile === 'function' ? fs.appendFile.bind(fs) : null;
  const originalCreateWriteStream = typeof fs.createWriteStream === 'function' ? fs.createWriteStream.bind(fs) : null;

  fsp.writeFile = async function(filePath, data, ...rest) {
    return originalPromiseWriteFile(filePath, prepareDataForFileWrite(data, filePath), ...rest);
  };

  fsp.appendFile = async function(filePath, data, ...rest) {
    return originalPromiseAppendFile(filePath, prepareDataForFileWrite(data, filePath), ...rest);
  };

  fs.writeFileSync = function(filePath, data, ...rest) {
    return originalWriteFileSync(filePath, prepareDataForFileWrite(data, filePath), ...rest);
  };

  fs.appendFileSync = function(filePath, data, ...rest) {
    return originalAppendFileSync(filePath, prepareDataForFileWrite(data, filePath), ...rest);
  };

  if (originalWriteFile) {
    fs.writeFile = function(filePath, data, options, callback) {
      let finalOptions = options;
      let finalCallback = callback;

      if (typeof options === 'function') {
        finalCallback = options;
        finalOptions = undefined;
      }

      return originalWriteFile(filePath, prepareDataForFileWrite(data, filePath), finalOptions, finalCallback);
    };
  }

  if (originalAppendFile) {
    fs.appendFile = function(filePath, data, options, callback) {
      let finalOptions = options;
      let finalCallback = callback;

      if (typeof options === 'function') {
        finalCallback = options;
        finalOptions = undefined;
      }

      return originalAppendFile(filePath, prepareDataForFileWrite(data, filePath), finalOptions, finalCallback);
    };
  }

  if (originalCreateWriteStream) {
    fs.createWriteStream = function(filePath, options) {
      const stream = originalCreateWriteStream(filePath, options);
      if (!stream || stream.__privacyGuardWrapped) return stream;

      const originalStreamWrite = typeof stream.write === 'function' ? stream.write.bind(stream) : null;
      if (originalStreamWrite) {
        stream.write = function(chunk, encoding, callback) {
          let finalEncoding = encoding;
          let finalCallback = callback;

          if (typeof encoding === 'function') {
            finalCallback = encoding;
            finalEncoding = undefined;
          }

          return originalStreamWrite(prepareDataForFileWrite(chunk, filePath), finalEncoding, finalCallback);
        };
      }

      stream.__privacyGuardWrapped = true;
      return stream;
    };
  }
}

installFileWritePrivacyGuards();

// ==================== CACHE SİSTEMLERİ ====================

const yetkiCache = {
  vip: { data: [], lastUpdate: 0, ttl: 60000 },
  premium: { data: [], lastUpdate: 0, ttl: 60000 },
  admins: { data: [], lastUpdate: 0, ttl: 60000 }
};

const sunucuConfigCache = new Map();
const CONFIG_CACHE_TTL = 30000;

const sunucuLogKanalCache = new Map();
const LOG_KANAL_CACHE_TTL = 5000;

const apiQueue = {
  queue: [],
  processing: false,
  lastRequest: 0,
  minInterval: 50
};

const activeOdaTimers = new Map();

// ==================== MODÜL IMPORTLARI ====================

let DatabaseManager = null;
let LogYonetim = null;
let VeriYonetim = null;
let dbManager = null;
let dbConnected = false;

function loadModules() {
  try {
    DatabaseManager = require('@ozel_yapim_moduller/dbmanager');
  } catch (e) {
    DatabaseManager = null;
  }

  try {
    LogYonetim = require('@ozel_yapim_moduller/log_yonetim');
  } catch (e) {
    LogYonetim = null;
  }

  try {
    const veriModule = require('@ozel_yapim_moduller/veri_yonetim');
    VeriYonetim = veriModule.VeriYonetim || veriModule;
  } catch (e) {
    VeriYonetim = null;
  }
}

loadModules();

// ==================== SUNUCU LOG KANAL SİSTEMİ ====================

async function getSunucuLogKanalId(guildId) {
  const now = Date.now();
  if (! guildId) return null;
  const cached = sunucuLogKanalCache.get(guildId);
  
  if (cached && (now - cached.lastCheck) < LOG_KANAL_CACHE_TTL) {
    return cached.kanalId;
  }
  
  try {
    const configPath = path.join(SUNUCU_VERILER_DIR, `${guildId}.json`);
    
    if (!fs.existsSync(configPath)) {
      sunucuLogKanalCache.set(guildId, { kanalId: null, lastCheck: now });
      return null;
    }
    
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    
    const logKanalId = config.LOG_KANALI || null;
    
    sunucuLogKanalCache.set(guildId, { kanalId: logKanalId, lastCheck: now });
    return logKanalId;
  } catch (e) {
    sunucuLogKanalCache.set(guildId, { kanalId: null, lastCheck: now });
    return null;
  }
}

async function sendSunucuLog(guildId, embed) {
  if (!guildId || !client || !client.isReady()) return false;
  
  try {
    const logKanalId = await getSunucuLogKanalId(guildId);
    
    if (!logKanalId) return false;
    
    const kanal = await client.channels.fetch(logKanalId).catch(() => null);
    
    if (!kanal || !kanal.isTextBased()) return false;
    
    const botMember = kanal.guild?.members?.me;
    if (botMember && ! kanal.permissionsFor(botMember)?.has(['SendMessages', 'EmbedLinks'])) {
      return false;
    }
    
    await kanal.send({ embeds: [embed] });
    return true;
  } catch (e) {
    return false;
  }
}

// ==================== SAFE LOGGER ====================


// ==================== LOG ROTATION & KALICI ARŞİV (LOCAL) ====================
// Bu dosya tek başına çalışabilsin diye LogYonetim modülüne bağlı kalmadan
// log döndürme + kalıcı arşiv + kalıcı silme (retention) mekanizması burada da uygulanır.

const LOG_ARCHIVE_DIR = path.join(LOGLAR_ROOT, 'log_kalici_arsiv');
const LOG_ROTATE_MAX_BYTES = Math.max(256 * 1024, Number(process.env.LOG_ROTATE_MAX_BYTES || (5 * 1024 * 1024))); // default 5MB
const LOG_ARCHIVE_RETENTION_DAYS = Math.max(1, Number(process.env.LOG_ARCHIVE_RETENTION_DAYS || 30)); // default 30 gün
const LOG_ROTATION_CHECK_INTERVAL_MS = Math.max(250, Number(process.env.LOG_ROTATION_CHECK_INTERVAL_MS || 2000));

const __logRotateLocks = new Map(); // filePath -> Promise (simple mutex)
let __lastArchiveCleanupAt = 0;

function __withLogLock(filePath, fn) {
  const prev = __logRotateLocks.get(filePath) || Promise.resolve();
  const next = prev.then(fn).catch(() => {}).finally(() => {
    // sadece en son zincir ise sil
    if (__logRotateLocks.get(filePath) === next) __logRotateLocks.delete(filePath);
  });
  __logRotateLocks.set(filePath, next);
  return next;
}

async function __rotateIfNeeded(logFilePath, klasorName) {
  try {
    const st = await fsp.stat(logFilePath).catch(() => null);
    if (!st || !st.isFile()) return;
    if (st.size < LOG_ROTATE_MAX_BYTES) return;

    const day = new Date().toISOString().split('T')[0];
    const safeKlasor = String(klasorName || 'bot_genel').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const archiveFolder = path.join(LOG_ARCHIVE_DIR, safeKlasor, day);

    await fsp.mkdir(archiveFolder, { recursive: true });

    const base = path.basename(logFilePath, '.log');
    const archiveName = `${base}-${Date.now()}-${process.pid}.log`;
    const archivePath = path.join(archiveFolder, archiveName);

    // rename atomic; eğer aynı dosya yoksa noop
    await fsp.rename(logFilePath, archivePath).catch(async () => {
      // Windows/FS edge-case: rename olmazsa kopyala + sil
      try {
        await fsp.copyFile(logFilePath, archivePath);
        await fsp.unlink(logFilePath).catch(() => {});
      } catch {}
    });

    // Yeni log dosyasını yarat (appendFile zaten oluşturur ama bazı sistemlerde race olur)
    await fsp.appendFile(logFilePath, '', 'utf8').catch(() => {});

  } catch (e) {
    // yut
  }
}

async function __cleanupOldArchivedLogs() {
  const now = Date.now();
  // her 6 saatte bir yeterli
  if (now - __lastArchiveCleanupAt < 6 * 60 * 60 * 1000) return;
  __lastArchiveCleanupAt = now;

  const cutoff = now - (LOG_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  async function walk(dir) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) {
          await walk(p);
          // boş klasörü temizle
          const remain = await fsp.readdir(p).catch(() => null);
          if (Array.isArray(remain) && remain.length === 0) {
            await fsp.rmdir(p).catch(() => {});
          }
        } else if (ent.isFile()) {
          const st = await fsp.stat(p).catch(() => null);
          if (st && st.mtimeMs < cutoff) {
            await fsp.unlink(p).catch(() => {});
          }
        }
      } catch {}
    }
  }

  await walk(LOG_ARCHIVE_DIR);
}

const SafeLog = {
  async _internalLog(level, event, message, opts = {}) {
    if (LogYonetim && typeof LogYonetim[level] === 'function') {
      try {
        await LogYonetim[level](event, message, {
          ...opts,
          sendToDiscord: false
        });
        return;
      } catch (e) {
      }
    }
    
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
      // Boyut limiti aşıldıysa kalıcı arşive döndür
      await __withLogLock(logFile, async () => {
        await __rotateIfNeeded(logFile, opts.klasor || 'bot_genel');
      });

      // Eski arşivleri periyodik temizle
      await __cleanupOldArchivedLogs();
    } catch (fileErr) {
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
	  sendToConsole: false,
      traceID: traceId
    });
  },

  async yetkiHatasi(userId, message, guildId) {
    await this.warn('yetki_hatasi', message, {
      klasor: 'bot_genel',
      key: 'permission',
      kullaniciID:  userId,
      sunucuID: guildId
    });
  },

  async sorguBasarili(userId, tablo, sure, satirSayisi, guildId, traceId) {
    await this.info('sorgu_basarili', `DB sorgusu: ${tablo}`, {
      klasor: 'database',
      key: 'query',
      kullaniciID:  userId,
      tablo,
      sure,
      satirSayisi,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async sorguHatasi(userId, tablo, hata, guildId, traceId) {
    await this.error('sorgu_hatasi', `DB sorgu hatası: ${tablo}`, {
      klasor: 'database',
      key: 'error',
      kullaniciID:  userId,
      tablo,
      hata,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async dmGonderildi(userId, baslik, guildId, traceId) {
    await this.info('dm_gonderildi', `DM gönderildi: ${baslik}`, {
      klasor: 'dm',
      key: 'send',
      kullaniciID:  userId,
      sunucuID: guildId,
      traceID: traceId
    });
  },

  async dmGonderimHatasi(userId, neden, guildId, traceId) {
    await this.warn('dm_gonderim_hatasi', `DM gönderilemedi: ${neden}`, {
      klasor: 'dm',
      key: 'error',
      kullaniciID: userId,
      sunucuID:  guildId,
      traceID: traceId
    });
  }
};




// ==================== KULLANICI DOSTU LOG ====================

async function sendUserFriendlyLog(guildId, baslik, aciklama, renk = '#4a9eff') {
  if (!guildId) return;
  
  const embed = new EmbedBuilder()
    .setTitle(baslik)
    .setDescription(aciklama)
    .setColor(renk)
    .setTimestamp();
  
  const params = getEmbedParameters(guildId) || {};

  if (params.footer && ! embed.data.footer) {
    embed.setFooter({ text: params.footer });
  }

  if (params.image && !embed.data.image) {
    embed.setImage(params.image);
  }

  if (params.thumbnail && !embed.data.thumbnail) {
    embed.setThumbnail(params.thumbnail);
  }

  if (params.color && !embed.data.color) {
    embed.setColor(params.color);
  }
  
  await sendSunucuLog(guildId, embed);
}

// ==================== WEBHOOK BİLDİRİM ====================

async function sendErrorWebhook(level, event, message, opts = {}) {
  if (! ERROR_WEBHOOK_URL) return;

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
          { name: 'Trace ID', value: opts.traceID || 'N/A', inline: true },
          { name: 'Kullanıcı', value: opts.kullaniciID || 'N/A', inline: true },
          { name:  'Sunucu', value: opts.sunucuID || 'N/A', inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Bot Error System' }
      }]
    });

    const requestOptions = {
      hostname: webhookUrl.hostname,
      port: webhookUrl.port || (isHttps ? 443 : 80),
      path: webhookUrl.pathname + webhookUrl.search,
      method: 'POST',
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
  }
}

// ==================== SYSTEM WEBHOOK (GENEL BİLDİRİM) ====================
// ERROR_WEBHOOK_URL aynı zamanda "önemli sistem gelişmeleri" için de kullanılır.
// (Bot açıldı/kapatıldı, shard bağlantı durumları vb.)
async function sendSystemWebhook(level, title, description, fields = []) {
  if (!ERROR_WEBHOOK_URL) return;

  try {
    const webhookUrl = new URL(ERROR_WEBHOOK_URL);
    const isHttps = webhookUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const levelColorMap = {
      INFO: 0x2ecc71,
      WARN: 0xf1c40f,
      ERROR: 0xe67e22,
      CRITICAL: 0xe74c3c
    };

    const safeFields = Array.isArray(fields) ? fields.slice(0, 25).map(f => ({
      name: String(f?.name || 'Bilgi').substring(0, 256),
      value: String(f?.value ?? '-').substring(0, 1024),
      inline: Boolean(f?.inline)
    })) : [];

    const payload = JSON.stringify({
      embeds: [{
        title: title?.substring(0, 256) || '📌 Sistem Bildirimi',
        description: description?.substring(0, 2000) || 'Detay yok',
        color: levelColorMap[level] || 0x3498db,
        fields: safeFields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Bot System Monitor' }
      }]
    });

    const requestOptions = {
      hostname: webhookUrl.hostname,
      port: webhookUrl.port || (isHttps ? 443 : 80),
      path: webhookUrl.pathname + webhookUrl.search,
      method: 'POST',
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
    // yut
  }
}


// ==================== ENV DOĞRULAMA ====================

function validateEnv() {
  const errors = [];
  const warnings = [];
  let canStart = true;

  if (!TOKEN || TOKEN.trim() === '') {
    errors.push('TOKEN eksik');
    canStart = false;
  }

  if (! CLIENT_ID || CLIENT_ID.trim() === '') {
    warnings.push('CLIENT_ID eksik - Komut register edilemeyecek');
  }

  if (!BOT_OWNER_ID) {
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

  const maskStatus = {
    ucretsiz: getEnvMaskValue('ucretsiz'),
    vip: getEnvMaskValue('vip'),
    premium: getEnvMaskValue('premium'),
    admin: getEnvMaskValue('admin')
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

// ==================== ODA GERİ SAYIM SİSTEMİ (DB BACKED) ====================

async function startOdaGeriSayim() {
  if (odaGeriSayimAktif) {
    
    return;
  }

  if (! dbConnected || !dbManager) {
    
    return;
  }

  odaGeriSayimAktif = true;
  

  await SafeLog.info('oda_geri_sayim_baslatildi', 'Oda geri sayım sistemi başlatıldı', {
    klasor: 'oda_sistem',
    key: 'geri_sayim',
    interval_ms: ODA_GERI_SAYIM_INTERVAL_MS
  });

  odaGeriSayimIntervalId = setInterval(async () => {
    await tickOdaGeriSayim();
  }, ODA_GERI_SAYIM_INTERVAL_MS);
}

async function tickOdaGeriSayim() {
  if (!dbConnected || !dbManager) return;

  try {
    const odalar = await dbManager.query(
      'main',
      `SELECT id, kullanici_id, sunucu_id, acilan_oda_id, kalan_zaman, durum
       FROM kanal_geri_sayim WHERE durum = 'aktif'`,
      [],
      { queue: true }
    ).catch(err => {
      return [];
    });

    if (!Array.isArray(odalar) || odalar.length === 0) return;

    for (const oda of odalar) {
      try {
        const kanalId = oda.acilan_oda_id;
        const sunucuId = oda.sunucu_id;
        const kalanZaman = Number(oda.kalan_zaman) || 0;
        const kullaniciId = oda.kullanici_id;

        if (!kanalId || !sunucuId) continue;

        // Kanal kontrolü
        const guild = client?.guilds?.cache?.get(sunucuId);
        if (!guild) {
          await closeOdaRecord(kanalId);
          continue;
        }

        const kanal = guild.channels.cache.get(kanalId);
        if (!kanal) {
          // Kanal bulunamadıysa sil
          await closeOdaRecord(kanalId);
          continue;
        }

        // UYARILAR GÖNDER (5 saniye öncesi)
        if (kalanZaman > 5) {
          if ([300, 240, 180, 120, 60].includes(kalanZaman)) {
            await gonderSureUyarisi(kanal, kalanZaman, sunucuId, kullaniciId);
          }
          if ([10, 5].includes(kalanZaman)) {
            await gonderSonSaniyeUyarisi(kanal, kalanZaman);
          }
        }

        // 5 SANİYE KALA KAPANIŞA BAŞLA
        if (kalanZaman === 5) {
          if (!odaKapanmaAktif.has(kanalId)) {
            odaKapanmaAktif.add(kanalId);
            
            // Async çalışıyor, kapanışı başlat
            kapanasiGercekles(kanalId, sunucuId, kullaniciId).then(() => {
              odaKapanmaAktif.delete(kanalId);
            }).catch((e) => {
              odaKapanmaAktif.delete(kanalId);
            });
          }
          continue;
        }

        // NORMAL AZALMA
        if (kalanZaman > 0) {
          const yeniZaman = kalanZaman - 1;
          
          try {
            await dbManager.query(
              'main',
              'UPDATE kanal_geri_sayim SET kalan_zaman = ? WHERE acilan_oda_id = ? ',
              [yeniZaman, kanalId],
              { queue: true, logQuery: false }
            );
          } catch (updateErr) {
            await SafeLog.warn('tick_update_error', `Güncelleme hatası: ${updateErr.message}`, {
              klasor: 'oda_sistem',
              key: 'tick',
              kanalId
            });
          }
        }

      } catch (e) {
        await SafeLog.error('tick_oda_error', `Oda işleme hatası: ${e.message}`, {
          klasor: 'oda_sistem',
          key: 'tick',
          hata: e.message
        });
      }
    }
  } catch (e) {
    await SafeLog.error('tick_main_error', `Tick ana hatası: ${e.message}`, {
      klasor: 'oda_sistem',
      key: 'tick',
      hata: e.message
    });
  }
}

async function kapanasiGercekles(kanalId, sunucuId, kullaniciId) {
  if (!kanalId || !sunucuId) {
    await SafeLog.error('kapanma_parametreler', 'Eksik parametreler', {
      klasor: 'oda_sistem',
      key: 'kapanma',
      kanalId,
      sunucuId
    });
    return;
  }

  try {
    const guild = client.guilds.cache.get(sunucuId);
    if (!guild) throw new Error('Sunucu bulunamadı');

    const kanal = guild.channels.cache.get(kanalId);
    if (!kanal) {
      await closeOdaRecord(kanalId);
      return;
    }

    // ADIM 1: Mesajları oku
    let mesajArray = [];
    const hedefKullanicilar = new Set();

    try {
      const mesajlar = await kanal.messages.fetch({ limit: 100 });
      mesajArray = Array.from(mesajlar.values()).reverse();

      for (const msg of mesajArray) {
        if (msg?.author && ! msg.author.bot) {
          hedefKullanicilar.add(msg.author.id);
        }
      }
    } catch (e) {
      await SafeLog.warn('kapanma_mesaj_fetch', `Mesaj fetch hatası: ${e.message}`, {
        klasor: 'oda_sistem',
        key: 'kapanma',
        kanalId
      });
    }

    // ADIM 2: Dosyaya yaz
    let mesajIcerik = `═══════════════════════════════════════════\n`;
    mesajIcerik += `ODA KAPANMA RAPORU\n`;
    mesajIcerik += `═══════════════════════════════════════════\n\n`;
    mesajIcerik += `Oda ID: ${kanalId}\n`;
    mesajIcerik += `Sunucu ID: ${sunucuId}\n`;
    mesajIcerik += `Kapanış Tarihi: ${new Date().toLocaleString('tr-TR')}\n`;
    mesajIcerik += `Toplam Mesaj: ${mesajArray.length}\n\n`;
    mesajIcerik += `───────────────────────────────────────────\n`;
    mesajIcerik += `MESAJ GEÇMİŞİ:\n`;
    mesajIcerik += `───────────────────────────────────────────\n\n`;

    for (const msg of mesajArray) {
      const timestamp = msg.createdAt?.toLocaleString('tr-TR') || 'Bilinmiyor';
      const author = msg.author?.tag || 'Bilinmeyen Kullanıcı';
      const content = msg.content?.trim() || '(İçerik yok)';

      mesajIcerik += `[${timestamp}] ${author}:\n${content}\n\n`;

      if (msg.attachments?.size > 0) {
        const dosyalar = msg.attachments.map(a => a.name || a.url).join(', ');
        mesajIcerik += `📎 Dosyalar: ${dosyalar}\n\n`;
      }
    }

    mesajIcerik += `\n═══════════════════════════════════════════\n`;
    mesajIcerik += `Arşiv:  ${new Date().toISOString()}\n`;
    mesajIcerik += `═══════════════════════════════════════════\n`;

    // Dosyayı yaz
    const dosyaAdi = `${kanalId}-${Date.now()}.txt`;
    const dosyaYolu = path.join(COP_TEMIZLIK_DIR, dosyaAdi);

    let dosyaBasarili = false;
    try {
      await ensureDir(COP_TEMIZLIK_DIR);
  await ensureDir(RATE_LIMIT_KONTROL_DIR);
  await ensureRateLimitKontrolFile();
      await fsp.writeFile(dosyaYolu, mesajIcerik, 'utf8');
      dosyaBasarili = true;
      await SafeLog.debug('kapanma_dosya', `Dosya oluşturuldu: ${dosyaAdi}`, {
        klasor: 'oda_sistem',
        key: 'kapanma',
        kanalId
      });
    } catch (fileErr) {
      await SafeLog.error('kapanma_dosya_hatasi', `Dosya yazma hatası: ${fileErr.message}`, {
        klasor: 'oda_sistem',
        key: 'kapanma',
      sendToConsole: false,
        kanalId
      });
    }

    // ADIM 3: DM gönder
    let dmBasarili = 0;

    if (dosyaBasarili && hedefKullanicilar.size > 0) {
      for (const userId of hedefKullanicilar) {
        try {
          const user = await client.users.fetch(userId).catch(() => null);
          if (! user) continue;

          const embed = new EmbedBuilder()
            .setTitle('📁 Oda Geçmişi')
            .setDescription('Oda kapandı.Mesaj geçmişi aşağıda.')
            .addFields(
              { name: 'Oda ID', value: kanalId, inline: true },
              { name: 'Mesaj Sayısı', value: String(mesajArray.length), inline: true },
              { name:  'Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
            )
            .setColor('#4a9eff')
            .setTimestamp();

          applyEmbedParameters(embed, sunucuId, userId, { scope: 'dm' });

          const dosyaBuf = await fsp.readFile(dosyaYolu);

          await user.send({
            embeds: [embed],
            files: [{ attachment: dosyaBuf, name: dosyaAdi }]
          });

          dmBasarili++;
          await SafeLog.dmGonderildi(userId, `Oda Arşivi (${kanalId})`, sunucuId, null);

        } catch (e) {
          await SafeLog.dmGonderimHatasi(userId, `DM hatası: ${e.message}`, sunucuId, null);
        }
      }
    }

    // ADIM 4: Kanal sil
    try {
      await kanal.delete('Oda süresi doldu');
      await SafeLog.info('kapanma_kanal_silindi', `Kanal silindi: ${kanalId}`, {
        klasor: 'oda_sistem',
        key: 'kapanma',
      sendToConsole: false,
        kanalId
      });
    } catch (delErr) {
      await SafeLog.warn('kapanma_kanal_silme_hatasi', `Kanal silinme hatası: ${delErr.message}`, {
        klasor: 'oda_sistem',
        key: 'kapanma',
      sendToConsole: false,
        kanalId
      });
    }

    // ADIM 5: DB'den sil (KRİTİK - BU MUTLAKA ÇALIŞMALI)
    const dbSilmeBasarili = await closeOdaRecord(kanalId);

    // BAŞARI
    await SafeLog.success('oda_kapandi', `✅ Oda kapatıldı:  ${kanalId}`, {
      klasor: 'oda_sistem',
      key: 'kapanma',
      mesajSayisi: mesajArray.length,
      dmBasarili,
      sendToConsole: false,
      dmToplam: hedefKullanicilar.size,
      dbSilme: dbSilmeBasarili
    });

  } catch (e) {
    await SafeLog.error('oda_kapanma_hatasi', `Kapanma hatası: ${e.message}`, {
      klasor: 'oda_sistem',
      key: 'kapanma',
      kanalId,
      sunucuId,
      sendToConsole: false,
      hata: e.message
    });

    // Hata bile olsa DB kaydını kapalıya çek
    await closeOdaRecord(kanalId);
  }
}

async function gonderSureUyarisi(kanal, kalanZaman, sunucuId, kullaniciId) {
  try {
    const dakika = Math.ceil(kalanZaman / 60);
    const embed = new EmbedBuilder()
      .setTitle('⏰ Oda Süresi')
      .setDescription(`Bu oda **${dakika} dakika** sonra kapanacak.\n\n⚠️ Dosyalarınızı kaydetmeyi unutmayın!`)
      .setColor('#FFA500')
      .setTimestamp();

    applyEmbedParameters(embed, sunucuId, kullaniciId);
    await kanal.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {}
}

async function gonderSonSaniyeUyarisi(kanal, kalanZaman) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('🚨 SON SANİYELER!')
      .setDescription(`Oda **${kalanZaman} saniye** sonra kapanacak! `)
      .setColor('#FF0000')
	  
      .setTimestamp();

    await kanal.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {}
}

async function handleOdaCiktiKritikal(oda, kanal) {
  const kanalId = oda.acilan_oda_id;
  const sunucuId = oda.sunucu_id;
  const kullaniciId = oda.kullanici_id;

  if (!kanalId || !sunucuId) {
    await SafeLog.warn('handle_oda_param', 'Eksik parametreler', {
      klasor: 'oda_sistem',
      key: 'kritik',
      kanalId,
      sunucuId
    });
    return;
  }

  try {
    // 1️⃣ KANALI KİLİT
    try {
      await kanal.permissionOverwrites.set([
        {
          id: sunucuId,
          deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions']
        }
      ]).catch((err) => {
        
      });
    } catch (lockErr) {
      await SafeLog.warn('handle_kanal_kilitle', `Kilitleme hatası: ${lockErr.message}`, {
        klasor: 'oda_sistem',
        key: 'kritik',
        kanalId
      });
    }

    // 2️⃣ MESAJLARI ÇEK VE İŞLE
    let mesajlar = null;
    try {
      mesajlar = await kanal.messages.fetch({ limit: 100 });
    } catch (fetchErr) {
      mesajlar = new Map();
    }

    const mesajArray = mesajlar && mesajlar.size > 0 ? Array.from(mesajlar.values()).reverse() : [];

    // Geçmiş dosyası oluştur
    let mesajIcerik = `═══════════════════════════════════════════\n`;
    mesajIcerik += `ODA KAPANMA RAPORU\n`;
    mesajIcerik += `═══════════════════════════════════════════\n\n`;
    mesajIcerik += `Oda ID: ${kanalId}\n`;
    mesajIcerik += `Sunucu ID: ${sunucuId}\n`;
    mesajIcerik += `Kapalı Zaman: ${new Date().toLocaleString('tr-TR')}\n`;
    mesajIcerik += `Toplam Mesaj: ${mesajArray.length}\n\n`;
    mesajIcerik += `───────────────────────────────────────────\n`;
    mesajIcerik += `MESAJ GEÇMİŞİ:\n`;
    mesajIcerik += `───────────────────────────────────────────\n\n`;

    // Bot olmayan kullanıcıları topla
    const hedefKullanicilar = new Set();

    if (mesajArray.length > 0) {
      for (const msg of mesajArray) {
        try {
          // Bot olmayan yazarları topla
          if (msg?.author && !msg.author.bot) {
            hedefKullanicilar.add(msg.author.id);
          }

          const timestamp = msg.createdAt ?  msg.createdAt.toLocaleString('tr-TR') : 'Bilinmiyor';
          const authorTag = msg.author?.tag ??  'Bilinmeyen Kullanıcı';
          const content = msg.content && msg.content.trim() ? msg.content :  '(İçerik yok)';

          mesajIcerik += `[${timestamp}] ${authorTag}:\n`;
          mesajIcerik += `${content}\n`;

          // Dosya varsa
          if (msg.attachments && msg.attachments.size > 0) {
            const dosyaAdlari = msg.attachments.map(a => a.name || a.url).join(', ');
            mesajIcerik += `📎 Dosyalar: ${dosyaAdlari}\n`;
          }

          // Embed varsa
          if (msg.embeds && msg.embeds.length > 0) {
            msg.embeds.forEach((embed, idx) => {
              const embedTitle = embed.title || 'Başlıksız';
              const embedDesc = embed.description ?  embed.description.substring(0, 100) : '';
              mesajIcerik += `[Embed ${idx + 1}] ${embedTitle} ${embedDesc}\n`;
            });
          }

          mesajIcerik += '\n';
        } catch (msgErr) {
          
        }
      }
    }

    mesajIcerik += `\n═══════════════════════════════════════════\n`;
    mesajIcerik += `Arşiv Tarihi: ${new Date().toISOString()}\n`;
    mesajIcerik += `═══════════════════════════════════════════\n`;

    // 3️⃣ DOSYA OLUŞTUR
    const dosyaAdi = `${kanalId}-gecmis-${Date.now()}.txt`;
    const dosyaYolu = path.join(COP_TEMIZLIK_DIR, dosyaAdi);

    let dosyaBasarili = false;
    try {
      await ensureDir(COP_TEMIZLIK_DIR);
      await fsp.writeFile(dosyaYolu, mesajIcerik, 'utf8');
      dosyaBasarili = true;
    } catch (fileErr) {
      await SafeLog.error('handle_dosya_hatasi', `Dosya yazma hatası: ${fileErr.message}`, {
        klasor: 'oda_sistem',
        key: 'kritik',
        kanalId
      });
    }

    // 4️⃣ DM GÖNDER
    const dmSonuclari = [];

    if (dosyaBasarili && hedefKullanicilar.size > 0) {
      for (const userId of hedefKullanicilar) {
        try {
          const user = await client.users.fetch(userId).catch(() => null);

          if (! user) {
            dmSonuclari.push({ userId, basarili: false, neden: 'Kullanıcı bulunamadı' });
            continue;
          }

          // Embed oluştur
          const dmEmbed = new EmbedBuilder()
            .setTitle('📁 Oda Geçmişi Arşivi')
            .setDescription('Katılmış olduğunuz oda kapandı ve mesaj geçmişi bu dosyada arşivlenmiştir.')
            .addFields(
              { name: 'Oda ID', value:  kanalId, inline: true },
              { name: 'Mesaj Sayısı', value: String(mesajArray.length), inline: true },
              { name:  'Kapanış Tarihi', value: new Date().toLocaleString('tr-TR'), inline: false }
            )
            .setColor('#4a9eff')
            .setTimestamp();

          applyEmbedParameters(dmEmbed, sunucuId, userId, { scope: 'dm' });

          // Dosya oku ve gönder
          let dosyaBuf = null;
          try {
            dosyaBuf = await fsp.readFile(dosyaYolu);
          } catch (readErr) {
            dmSonuclari.push({ userId, basarili: false, neden: `Dosya okuma hatası:  ${readErr.message}` });
            continue;
          }

          // Dosya okununca DM gönder
          try {
            await user.send({
              embeds: [dmEmbed],
              files: [{
                attachment: dosyaBuf,
                name: dosyaAdi
              }]
            });

            dmSonuclari.push({ userId, basarili:  true, kullaniciTag: user.tag });
            await SafeLog.dmGonderildi(userId, `Oda Arşivi (${kanalId})`, sunucuId, null);

          } catch (sendErr) {
            dmSonuclari.push({ userId, basarili: false, neden: sendErr.message });
            await SafeLog.dmGonderimHatasi(userId, `DM hatası: ${sendErr.message}`, sunucuId, null);
          }

        } catch (userFetchErr) {
          dmSonuclari.push({ userId, basarili: false, neden: `Fetch hatası: ${userFetchErr.message}` });
        }
      }
    }

    const dmBasariliSayisi = dmSonuclari.filter(x => x.basarili).length;

    // 5️⃣ 2 SANİYE SONRA KANALI SİL
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      await kanal.delete('Oda süresi doldu');
    } catch (delErr) {
      await SafeLog.warn('handle_kanal_silme', `Kanal silinme hatası: ${delErr.message}`, {
        klasor: 'oda_sistem',
        key: 'kritik',
        kanalId
      });
    }

    // 6️⃣ DB KAYDI SİL (KRİTİK)
    const dbSilmeBasarili = await closeOdaRecord(kanalId);

    // BAŞARI LOGU
    await SafeLog.success('oda_kapandi_tam', `✅ Oda tamamen kapatıldı: ${kanalId}`, {
      klasor: 'oda_sistem',
      key: 'geri_sayim',
      kanalId,
      kullaniciID: kullaniciId,
      sunucuID: sunucuId,
      mesajSayisi: mesajArray.length,
      hedefKullaniciSayisi: hedefKullanicilar.size,
      dmBasarili: dmBasariliSayisi,
      dmToplam: dmSonuclari.length,
      dosyaBasarili:  dosyaBasarili,
      dbSilme: dbSilmeBasarili
    });

  } catch (e) {
    await SafeLog.error('oda_kapanma_kritik_error', `ODA KAPANMA KRİTİK HATASI: ${e.message}`, {
      klasor: 'oda_sistem',
      key:  'geri_sayim',
      kanalId,
      kullaniciID: kullaniciId,
      hata: e.message,
      stack: e.stack
    });

    // Hata durumunda da DB kaydını kapalıya çekme denemesi yap
    await closeOdaRecord(kanalId);
  }
}

// ==================== ODA DB KAYDI SİLME (YENİ FONKSİYON) ====================

async function deleteOdaRecord(odaId) {
  if (!odaId) {
    await SafeLog.warn('oda_delete_param', 'deleteOdaRecord:  odaId boş', {
      klasor: 'oda_sistem',
      key: 'oda'
    });
    return false;
  }

  if (! dbConnected || !dbManager) {
    await SafeLog.warn('oda_delete_nodb', 'deleteOdaRecord: DB bağlı değil', {
      klasor:  'oda_sistem',
      key: 'oda',
      kanalId: odaId
    });
    return false;
  }

  try {
    // SQL'i düzeltme - WHERE koşulunu sağlamlaştır
    const sql = `DELETE FROM kanal_geri_sayim WHERE acilan_oda_id = ? `;

    const result = await dbManager.query(
      'main',
      sql,
      [odaId],
      { 
        queue: true, 
        logQuery: false,
        timeout: 10000
      }
    );

    await SafeLog.success('oda_db_silindi', `DB kaydı silindi: ${odaId}`, {
      klasor: 'oda_sistem',
      key: 'oda',
      kanalId: odaId,
      affectedRows: result?.affectedRows || 0
    });

    return true;

  } catch (e) {
    await SafeLog.error('oda_db_delete_error', `Oda kaydı silme hatası: ${e.message}`, {
      klasor: 'oda_sistem',
      key: 'oda',
      kanalId: odaId,
      hata: e.message,
      stack: e.stack
    });

    // Hata olursa tekrar dene
    try {
      await new Promise(r => setTimeout(r, 1000));
      
      const retryResult = await dbManager.query(
        'main',
        `DELETE FROM kanal_geri_sayim WHERE acilan_oda_id = ?`,
        [odaId],
        { queue: true, logQuery: false }
      );

      if (retryResult?.affectedRows > 0) {
        await SafeLog.success('oda_db_silindi_retry', `DB kaydı ikinci denemede silindi: ${odaId}`, {
          klasor: 'oda_sistem',
          key: 'oda',
          kanalId: odaId
        });
        return true;
      }
    } catch (retryErr) {
      await SafeLog.error('oda_db_delete_retry_error', `Tekrar deneme başarısız: ${retryErr.message}`, {
        klasor: 'oda_sistem',
        key: 'oda',
        kanalId: odaId
      });
    }

    return false;
  }
}

function stopOdaGeriSayim() {
  if (odaGeriSayimIntervalId) {
    clearInterval(odaGeriSayimIntervalId);
    odaGeriSayimIntervalId = null;
  }
  odaGeriSayimAktif = false;
  
}

function getOdaGeriSayimStats() {
  return {
    aktif: odaGeriSayimAktif,
    kapanmaAktif: Array.from(odaKapanmaAktif)
  };
}

// ==================== COP TEMİZLİK SİSTEMİ ====================

async function startCopTemizlik() {
  try {
    if (copTemizlikAktif) {
      console.log('[COP TEMİZLİK] Sistem zaten aktif');
      return;
    }

    await ensureDir(COP_TEMIZLIK_DIR);

    await SafeLog.info('cop_temizlik_baslatildi', 'Çöp temizlik sistemi başlatılıyor', {
      klasor: 'sistem',
      key: 'temizlik',
      klasor_yolu: COP_TEMIZLIK_DIR,
      startup_delay_ms: COP_TEMIZLIK_STARTUP_DELAY_MS
    });
    copTemizlikAktif = true;

    console.log('[COP TEMİZLİK] ✅ Sistem başlatıldı (tick ile kontrol ediliyor)');

  } catch (err) {
    console.error('[COP TEMİZLİK] Başlatma hatası:', err.message);

    await SafeLog.error('cop_temizlik_baslatma_hatasi', 'Çöp temizlik başlatma hatası', {
      klasor: 'sistem',
      key: 'temizlik',
      hata: err.message
    });
  }
}


// ==================== TICK-BASED COP TEMİZLİK + SELF-TEST ====================
let __tickCopRunning = false;
let __lastSelfTestAt = 0;

// Self-test’i kaç ms’de bir çalıştırmak istersin? (varsayılan: 10 dk)
const SELF_TEST_INTERVAL_MS = Math.max(60_000, Number(process.env.SELF_TEST_INTERVAL_MS || (10 * 60_000)));

async function tickCopTemizlikVeSelfTest() {
  if (__tickCopRunning) return;
  __tickCopRunning = true;

  try {
    const now = Date.now();

    // ---- 1) COP TEMİZLİK ----
    if (copTemizlikAktif) {
      const sureSaniye = readCopTemizlikSuresi();
      const dueMs = sureSaniye * 1000;

      const last = copTemizlikSonZamani || 0;
      if ((now - last) >= dueMs) {
        const copRapor = await temizleCopKlasoru();
        const silinenDosya = Number(copRapor?.toplam_silinen || 0) || 0;
        const silinenByte = Number(copRapor?.silinen_boyut_byte || 0) || 0;
        const silinenDosyaSayi = Number(copRapor?.silinen_dosya || 0) || 0;
        const silinenKlasorSayi = Number(copRapor?.silinen_klasor || 0) || 0;
        const copOrnekler = Array.isArray(copRapor?.ornekler) ? copRapor.ornekler.slice(0, 80) : [];

        // Kullanıcı dostu tick bilgisi
        try {
          console.log(`🧾 [COP RAPOR] 📌 Dosya: ${silinenDosyaSayi} | 📁 Klasör: ${silinenKlasorSayi} | 💾 Boşalan: ${typeof formatBytes==='function' ? formatBytes(silinenByte) : silinenByte + ' B'}`);
        } catch {}

        const silinenKapandi = await temizleKapandiOdaKayitlari();

        copTemizlikSonZamani = now;

        SafeLog.info('cop_temizlik_tick', 'Tick ile çöp temizlik yapıldı', {
          klasor: 'sistem',
          key: 'temizlik',
          silinen_dosya_sayisi: silinenDosya,
          silinen_dosya: silinenDosyaSayi,
          silinen_klasor: silinenKlasorSayi,
          silinen_boyut_byte: silinenByte,
          silinen_boyut_human: (typeof formatBytes==='function' ? formatBytes(silinenByte) : String(silinenByte)),
          ornek_silinenler: copOrnekler,
          db_silinen_kapandi_kayit: silinenKapandi,
          sendToConsole: false
        }).catch(() => {});

        appendSystemLog({
          type: 'cop_temizlik',
          silinen_dosya_sayisi: silinenDosya,
          silinen_dosya: silinenDosyaSayi,
          silinen_klasor: silinenKlasorSayi,
          silinen_boyut_byte: silinenByte,
          silinen_boyut_human: (typeof formatBytes==='function' ? formatBytes(silinenByte) : String(silinenByte)),
          ornek_silinenler: copOrnekler,
          db_silinen_kapandi_kayit: silinenKapandi,
          sure_saniye: sureSaniye
        });
      }
    }

    // ---- 2) SELF-TEST ----
    if ((now - __lastSelfTestAt) >= SELF_TEST_INTERVAL_MS) {
      __lastSelfTestAt = now;

      if (LogYonetim && typeof LogYonetim.selfTest === 'function') {
        const ok = await LogYonetim.selfTest().catch(() => false);
        appendSystemLog({ type: 'self_test', ok: Boolean(ok) });
      } else {
        appendSystemLog({ type: 'self_test', ok: false, reason: 'LogYonetim.selfTest bulunamadı' });
      }
    }

  } catch (e) {
    appendSystemLog({
      type: 'tick_error',
      scope: 'tickCopTemizlikVeSelfTest',
      error: String(getSafeErrorMessage(e))
    });
  } finally {
    __tickCopRunning = false;
  }
}

async function copTemizlikDongusuBaslat() {
  try {
    const copRapor = await temizleCopKlasoru();
    const temizlenmis = Number(copRapor?.toplam_silinen || 0) || 0;
    const silinenByte = Number(copRapor?.silinen_boyut_byte || 0) || 0;
    const silinenDosyaSayi = Number(copRapor?.silinen_dosya || 0) || 0;
    const silinenKlasorSayi = Number(copRapor?.silinen_klasor || 0) || 0;
    const copOrnekler = Array.isArray(copRapor?.ornekler) ? copRapor.ornekler.slice(0, 80) : [];
	const silinenKapandi = await temizleKapandiOdaKayitlari();
	
	await SafeLog.info('cop_temizlik_yapildi', 'Çöp klasörü temizlendi', {
  klasor: 'sistem',
  key: 'temizlik',
  silinen_dosya_sayisi: temizlenmis,
      silinen_dosya: silinenDosyaSayi,
      silinen_klasor: silinenKlasorSayi,
      silinen_boyut_byte: silinenByte,
      silinen_boyut_human: (typeof formatBytes==='function' ? formatBytes(silinenByte) : String(silinenByte)),
      ornek_silinenler: copOrnekler,
  silinen_dosya: silinenDosyaSayi,
  silinen_klasor: silinenKlasorSayi,
  silinen_boyut_byte: silinenByte,
  silinen_boyut_human: (typeof formatBytes==='function' ? formatBytes(silinenByte) : String(silinenByte)),
  ornek_silinenler: copOrnekler,
  db_silinen_kapandi_kayit: silinenKapandi
});
console.log(`[COP TEMİZLİK] ✅ DB kapandı kayıtları silindi - ${silinenKapandi} satır`);

    await SafeLog.info('cop_temizlik_yapildi', 'Çöp klasörü temizlendi', {
      klasor: 'sistem',
      key: 'temizlik',
	  sendToConsole: false,
      silinen_dosya_sayisi: temizlenmis
    });

    console.log(`[COP TEMİZLİK] ✅ Temizlendi - ${temizlenmis} dosya silindi`);

    const sureSaniye = readCopTemizlikSuresi();

    await SafeLog.info('cop_temizlik_timer_basladi', 'Çöp temizlik zamanlayıcısı başlatıldı', {
      klasor: 'sistem',
      key: 'temizlik',
      sure_saniye: sureSaniye,
      sure_dakika: (sureSaniye / 60).toFixed(2)
    });

    copTemizlikIntervalId = setTimeout(async () => {
      await copTemizlikDongusuBaslat();
    }, sureSaniye * 1000);

    copTemizlikSonZamani = Date.now();

    console.log(`[COP TEMİZLİK] Sonraki temizlik ${sureSaniye}s (${(sureSaniye / 60).toFixed(2)}d) sonra`);

  } catch (err) {
    console.error('[COP TEMİZLİK] Döngü hatası:', err.message);

    await SafeLog.error('cop_temizlik_dongu_hatasi', 'Çöp temizlik döngü hatası', {
      klasor:  'sistem',
      key:  'temizlik',
      hata: err.message
    });

    const sureSaniye = readCopTemizlikSuresi();
    copTemizlikIntervalId = setTimeout(async () => {
      await copTemizlikDongusuBaslat();
    }, sureSaniye * 1000);
  }
}

async function temizleKapandiOdaKayitlari() {
  if (!dbConnected || !dbManager) return 0;

  try {
    // TRIM/LOWER ile olası boşluk/case problemlerine karşı daha sağlam
    const sql = `
      DELETE FROM kanal_geri_sayim
      WHERE LOWER(TRIM(durum)) = 'kapandi'
    `;

    const result = await dbManager.query(
      'main',
      sql,
      [],
      { queue: true, logQuery: false, timeout: 10000 }
    );

    const silinen = Number(result?.affectedRows ?? result?.rowCount ?? 0) || 0;
    return silinen;
  } catch (err) {
    await SafeLog.error('oda_kapandi_bulk_delete_error', 'Kapandı kayıtları toplu silme hatası', {
      klasor: 'sistem',
      key: 'temizlik',
      hata: err.message
    }).catch(() => {});
    return 0;
  }
}

async function temizleCopKlasoru() {
  try {
    const now = Date.now();
    const ttlMs = COP_TEMIZLIK_FILE_TTL_MS;

    // tmp/yarım inmiş dosyaları daha agresif temizle (10sn)
    const TMP_TTL_MS = Math.max(3_000, Number(process.env.COP_TEMIZLIK_TMP_TTL_MS || 10_000));

    const statsOut = {
      toplam_silinen: 0,
      silinen_dosya: 0,
      silinen_klasor: 0,
      silinen_boyut_byte: 0,
      ttl_ms: ttlMs,
      tmp_ttl_ms: TMP_TTL_MS,
      baslangic_iso: new Date(now).toISOString(),
      ornekler: []
    };

    const pushSample = (item) => {
      try {
        if (!item) return;
        if (!Array.isArray(statsOut.ornekler)) statsOut.ornekler = [];
        if (statsOut.ornekler.length >= 80) return; // log şişmesini engelle
        statsOut.ornekler.push(item);
      } catch {}
    };

    const isTmpName = (name) => {
      const n = String(name || '').toLowerCase();
      return (
        n.endsWith('.tmp') ||
        n.includes('.tmp_') ||
        n.includes('.tmp-') ||
        n.endsWith('.part') ||
        n.endsWith('.partial') ||
        n.endsWith('.crdownload') ||
        n.endsWith('.download')
      );
    };

    // Klasör ikon/özellik dosyaları gibi "standart" dosyaları asla silme
    const isProtectedName = (name) => {
      const n = String(name || '').toLowerCase();
      return (
        n === 'desktop.ini' ||
        n === '.directory' ||
        n === '.ds_store' ||
        n === 'thumbs.db' ||
        n === 'icon.ico' ||
        n === 'folder.ico'
      );
    };

    // recursive walk: dosyaları ve alt klasörleri temizle (boş kalan klasörleri de kaldır)
    async function walk(dir) {
      let entries = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        const fullPath = path.join(dir, ent.name);

        try {
          if (ent.isDirectory()) {
            await walk(fullPath);

            // Alt klasör boşsa kaldır (içerik kalmadıysa)
            const remain = await fsp.readdir(fullPath).catch(() => null);
            if (Array.isArray(remain) && remain.length === 0) {
              await fsp.rmdir(fullPath).catch(() => {});
              statsOut.toplam_silinen++;
              statsOut.silinen_klasor++;
              pushSample({ tip: 'klasor', yol: fullPath });
            }
            continue;
          }

          if (!ent.isFile()) continue;
          if (isProtectedName(ent.name)) continue;

          const stats = await fsp.stat(fullPath).catch(() => null);
          if (!stats || !stats.isFile()) continue;

          const ageMs = now - (stats.mtimeMs || now);

          // ✅ BUGFIX: tmp/yarım inmiş dosyalar artık SKIPLENMEZ, daha agresif silinir
          const tmp = isTmpName(ent.name);
          if (tmp) {
            if (ageMs < TMP_TTL_MS) continue;
          } else {
            if (ageMs < ttlMs) continue;
          }

          await fsp.unlink(fullPath).catch(() => {});
          statsOut.toplam_silinen++;
          statsOut.silinen_dosya++;
          statsOut.silinen_boyut_byte += Number(stats.size || 0) || 0;

          pushSample({
            tip: 'dosya',
            ad: ent.name,
            yol: fullPath,
            boyut_byte: Number(stats.size || 0) || 0,
            yas_ms: ageMs,
            tmp: tmp
          });

          await SafeLog.debug('cop_dosya_silindi', `Dosya silindi: ${ent.name}`, {
            klasor: 'sistem',
            key: 'temizlik',
            dosya_adi: ent.name,
            dosya_yolu: fullPath,
            dosya_boyutu: stats.size,
            dosya_yasi_ms: ageMs,
            tmp_dosya: tmp,
            sendToConsole: false
          }).catch(() => {});
        } catch {
          // Manual silinmiş olabilir → hata verme
        }
      }
    }

    if (fs.existsSync(COP_TEMIZLIK_DIR)) {
      await walk(COP_TEMIZLIK_DIR);
    }

    // 📌 Kullanıcı dostu CMD çıktısı (özet)
    try {
      const freed = formatBytes(statsOut.silinen_boyut_byte);
      const line = `🧹 [ÇÖP TEMİZLİK] ✅ Silindi: ${statsOut.toplam_silinen} öğe  |  📄 Dosya: ${statsOut.silinen_dosya}  |  📁 Klasör: ${statsOut.silinen_klasor}  |  💾 Boşalan: ${freed}`;
      if (statsOut.toplam_silinen > 0) console.log(line);
      else console.log(`🧹 [ÇÖP TEMİZLİK] ✨ Temiz (silinen yok) | TTL: ${(ttlMs/1000).toFixed(0)}s | TMP TTL: ${(TMP_TTL_MS/1000).toFixed(0)}s`);
    } catch {}

    // 📦 Detaylı log (SafeLog + sistem jsonl)
    try {
      await SafeLog.info('cop_temizlik_detay', 'Çöp temizlik detay raporu', {
        klasor: 'sistem',
        key: 'temizlik',
        sendToConsole: false,
        ...statsOut,
        silinen_boyut_human: (() => { try { return formatBytes(statsOut.silinen_boyut_byte); } catch { return String(statsOut.silinen_boyut_byte); } })()
      }).catch(() => {});
      appendSystemLog({ type: 'cop_temizlik_detay', ...statsOut });
    } catch {}

    return statsOut;

  } catch (err) {
    console.error('[COP TEMİZLİK] Döngü hatası:', err.message);

    await SafeLog.error('cop_temizlik_dongu_hatasi', 'Çöp temizlik döngü hatası', {
      klasor: 'sistem',
      key: 'temizlik',
      hata: err.message
    }).catch(() => {});

    return {
      toplam_silinen: 0,
      silinen_dosya: 0,
      silinen_klasor: 0,
      silinen_boyut_byte: 0,
      hata: String(err?.message || err)
    };
  }
}



function readCopTemizlikSuresi() {
  const envDeger = process.env.COP_TEMIZLIK_SURE_SANIYE || '60';
  const saniye = parseInt(envDeger, 10);

  if (isNaN(saniye) || saniye < 5) {
    console.warn(`[COP TEMİZLİK] Geçersiz ENV değeri (${envDeger}), varsayılan 60s kullanılıyor`);
    return 60;
  }

  return saniye;
}

function getCopTemizlikNextTime() {
  if (! copTemizlikAktif) {
    return {
      status: 'inaktif',
      nextCleanupSeconds: null
    };
  }

  const sureSaniye = readCopTemizlikSuresi();

  return {
    status: 'aktif',
    sureSaniye: sureSaniye,
    sureDakika: (sureSaniye / 60).toFixed(2),
    sonTemizlikZamani: copTemizlikSonZamani ?  new Date(copTemizlikSonZamani).toISOString() : 'Henüz yapılmadı'
  };
}

function stopCopTemizlik() {
  if (copTemizlikIntervalId) {
    clearTimeout(copTemizlikIntervalId);
    copTemizlikIntervalId = null;
  }

  copTemizlikAktif = false;

  SafeLog.info('cop_temizlik_durduruldu', 'Çöp temizlik sistemi durduruldu', {
    klasor: 'sistem',
    key: 'temizlik'
  }).catch(() => {});

  console.log('[COP TEMİZLİK] ✅ Sistem durduruldu');
}


// ==================== YARDIM KOMUTU STATE TICK SİSTEMİ ====================


function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatCopTimestamp(d = new Date()) {
  // cop-<mesajid>-<tarih saat dakika saniye>.json
  // Örn: 20260208-141530
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

async function safeReadJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch {}
  return null;
}

async function safeWriteJson(filePath, obj) {
  let tmpPath = null;
  try {
    // Atomik yazım (yarım/corrupt json riskini azaltır)
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});

    tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');

    await fsp.rename(tmpPath, filePath).catch(async () => {
      try {
        await fsp.copyFile(tmpPath, filePath);
        await fsp.unlink(tmpPath).catch(() => {});
      } catch {}
    });

    return true;
  } catch {
    if (tmpPath) {
      await fsp.unlink(tmpPath).catch(() => {});
    }
    return false;
  }
}


// ==================== STATE ALT KLASÖR GENEL TARAMA (YENİ) ====================
// İstek:
// - state/ klasörü altındaki (muaf olmayan) tüm alt klasörlerdeki <mesajid>.json state dosyalarını tara
// - IP komutu state mekanizmasının aynı işlem akışını bu state'lere de uygula
// - state/config.json içindeki muaf_klasorler listesine göre klasörleri pas geç
// - trace_id üzerinden kontrol + log yönetimi (sendToConsole=false)

let __stateMuafCache = { list: [], lastCheck: 0 };
const __STATE_MUAF_CACHE_TTL_MS = Math.max(1000, Number(process.env.STATE_MUAF_CACHE_TTL_MS || 5000));

async function __loadStateMuafKlasorler() {
  const now = Date.now();
  if (__stateMuafCache.list && (now - __stateMuafCache.lastCheck) < __STATE_MUAF_CACHE_TTL_MS) {
    return new Set(__stateMuafCache.list);
  }

  let muaf = [];
  try {
    const cfg = await safeReadJson(STATE_CONFIG_FILE);
    if (cfg && Array.isArray(cfg.muaf_klasorler)) {
      muaf = cfg.muaf_klasorler.map(x => String(x || '').trim()).filter(Boolean);
    }
  } catch {}

  __stateMuafCache = { list: muaf, lastCheck: now };
  return new Set(muaf);
}

function __stateGetTopFolder(relPath) {
  try {
    const parts = String(relPath || '').split(/[\\\/]/).filter(Boolean);
    return parts[0] || '';
  } catch {
    return '';
  }
}

function __ensureTraceIdOnState(stateObj) {
  try {
    const existing = String(stateObj?.trace_id || stateObj?.traceId || stateObj?.trace || '').trim();
    if (existing) return existing;

    const base = [
      stateObj?.sunucu_id,
      stateObj?.kanal_id,
      stateObj?.kullanici_id,
      stateObj?.geri_sayim_mesaj_id,
      stateObj?.sonuc_dosya_butonlu_embed_mesaj_id,
      Date.now(),
      Math.random()
    ].map(x => String(x || '')).join('|');

    const tid = crypto.createHash('sha256').update(base).digest('hex').slice(0, 24);
    stateObj.trace_id = tid;
    return tid;
  } catch {
    const tid = crypto.randomBytes(12).toString('hex');
    try { stateObj.trace_id = tid; } catch {}
    return tid;
  }
}

function __isIpLikeGenericState(stateObj) {
  if (!stateObj || typeof stateObj !== 'object') return false;

  const hasCore =
    ('durum' in stateObj) &&
    ('kalan_sure_saniye' in stateObj) &&
    ('kullanici_id' in stateObj) &&
    ('sunucu_id' in stateObj) &&
    ('kanal_id' in stateObj);

  if (!hasCore) return false;

  const tur = String(stateObj.tur || '').trim();
  if (tur === 'ip_komutu_embed_state') return true;

  const hasIpish = ('ip' in stateObj) || ('sonuc_txt' in stateObj) || ('sonuc_dosya_yolu' in stateObj) || ('geri_sayim_mesaj_id' in stateObj);
  return hasIpish;
}

async function __walkJsonFilesRecursive(rootDir, muafSet) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);

      try {
        if (ent.isDirectory()) {
          const rel = path.relative(rootDir, full);
          const top = __stateGetTopFolder(rel);
          if (top && muafSet && muafSet.has(top)) continue;
          await walk(full);
          continue;
        }

        if (!ent.isFile()) continue;
        if (!ent.name.endsWith('.json')) continue;
        if (ent.name === 'config.json') continue;
        if (ent.name.startsWith('cop-')) continue;

        const rel = path.relative(rootDir, full);
        const top = __stateGetTopFolder(rel);
        if (top && muafSet && muafSet.has(top)) continue;

        out.push(full);
      } catch {}
    }
  }

  await walk(rootDir);
  return out;
}

let __genericStateTickRunning = false;

async function tickStateAltKlasorleriGenel() {
  if (__genericStateTickRunning) return;
  __genericStateTickRunning = true;

  try {
    await ensureDir(STATE_ROOT_DIR);

    const muaf = await __loadStateMuafKlasorler();
    ['ip_komutu', 'yardim_komutu', 'rate_limit_kontrol'].forEach(x => muaf.add(x));

    const files = await __walkJsonFilesRecursive(STATE_ROOT_DIR, muaf);

    for (const fp of files) {
      const stateObj = await safeReadJson(fp);
      if (!__isIpLikeGenericState(stateObj)) continue;

      const tid = __ensureTraceIdOnState(stateObj);

      const durum = String(stateObj?.durum || 'aktif');
      let kalan = Number(stateObj?.kalan_sure_saniye);
      if (!Number.isFinite(kalan)) kalan = 0;
      if (kalan < 0) kalan = 0;

      if (!stateObj.olusturma_tarihi_iso) stateObj.olusturma_tarihi_iso = new Date().toISOString();
      stateObj.guncelleme_tarihi_iso = new Date().toISOString();

      if (!stateObj.tur) stateObj.tur = 'ip_komutu_embed_state';

      if (durum === 'basarili' || durum === 'sonuc_alindi' || durum === 'tamamlandi') {
        stateObj.durum = 'basarili';
        stateObj.kalan_sure_saniye = 0;
        await safeWriteJson(fp, stateObj).catch(() => {});

        await updateIpMessageFromState(stateObj, { disableButtons: true, forceSuccess: true, forceFail: false }).catch(() => {});
        await finalizeIpStateFile(fp, stateObj).catch(() => {});
        continue;
      }

      if (durum !== 'aktif' || kalan <= 2) {
        stateObj.durum = (durum !== 'aktif') ? durum : 'timeout';
        stateObj.kalan_sure_saniye = 0;
        await safeWriteJson(fp, stateObj).catch(() => {});

        await updateIpMessageFromState(stateObj, { disableButtons: true, forceFail: true }).catch(() => {});
        await finalizeIpStateFile(fp, stateObj).catch(() => {});
        continue;
      }

      stateObj.kalan_sure_saniye = Math.max(0, kalan - 1);
      await safeWriteJson(fp, stateObj).catch(() => {});
      await updateIpMessageFromState(stateObj, { disableButtons: false, forceFail: false }).catch(() => {});
    }

  } catch (e) {
    await SafeLog.error('state_altklasor_tick_hata', `State alt klasör tick hatası: ${e.message}`, {
      klasor: 'state_genel',
      key: 'tick',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
  } finally {
    __genericStateTickRunning = false;
  }
}

async function __genericStateBulkMarkAndDisable(mode = 'restart') {
  try {
    await ensureDir(STATE_ROOT_DIR);

    const muaf = await __loadStateMuafKlasorler();
    ['ip_komutu', 'yardim_komutu', 'rate_limit_kontrol'].forEach(x => muaf.add(x));

    const files = await __walkJsonFilesRecursive(STATE_ROOT_DIR, muaf);
    if (!files.length) return { total: 0, updated: 0 };

    let updated = 0;

    for (const fp of files) {
      const st = await safeReadJson(fp);
      if (!__isIpLikeGenericState(st)) continue;

      const durum = String(st?.durum || 'aktif');
      if (durum !== 'aktif') continue;

      const tid = __ensureTraceIdOnState(st);
      st.durum = (mode === 'shutdown') ? 'iptal' : 'timeout';
      st.kalan_sure_saniye = 2;
      st.guncelleme_tarihi_iso = new Date().toISOString();

      if (!st.tur) st.tur = 'ip_komutu_embed_state';

      await safeWriteJson(fp, st).catch(() => {});

      if (client && client.isReady()) {
        await updateIpMessageFromState(st, { disableButtons: true, forceFail: true }).catch(() => {});
      }

      updated++;
      await SafeLog.debug('state_altklasor_bulk_mark', `Genel state işaretlendi: ${path.basename(fp)}`, {
        klasor: 'state_genel',
        key: 'bulk',
        traceID: tid,
        dosya: fp,
        sendToConsole: false
      }).catch(() => {});
    }

    return { total: files.length, updated };
  } catch {
    return { total: 0, updated: 0 };
  }
}

function safeText(v, max = 1024) {
  const str = String(v ?? '').trim();
  if (!str) return '-';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function compareTr(a, b) {
  try {
    return String(a || '').localeCompare(String(b || ''), 'tr', { sensitivity: 'base' });
  } catch {
    return String(a || '').localeCompare(String(b || ''));
  }
}

function chunkTo1024(lines) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const add = (cur ? '\n' : '') + line;
    if ((cur + add).length > 1024) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur += add;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function buildHelpEmbedFromState(stateObj) {
  const guildId = stateObj?.sunucu_id || null;
  const userId = stateObj?.kullanici_id || null;

  const kalan = Number(stateObj?.kalan_sure_saniye);
  const durum = String(stateObj?.durum || 'aktif');

  const isHome = String(stateObj?.mod || 'home') === 'home';
  const isList = String(stateObj?.mod || 'home') === 'list';

  const embed =
    isHome
      ? createInfoEmbed(
          '📖 Yardım Menüsü',
          [
            'Bir kategori seç:',
            '',
            '🛡️ **Admin** — Yönetici komutları',
            '💎 **VIP** — VIP komutları',
            '👑 **Premium** — Premium komutları',
            '🆓 **Ücretsiz** — Herkesin kullanabileceği komutlar',
            '',
            '🔎 Komutları sayfalayabilir, yenileyebilir veya sayfa numarasıyla gidebilirsin.'
          ].join('\n'),
          guildId,
          userId
        )
      : new EmbedBuilder()
          .setTitle(`📚 Yardım • ${safeText(stateObj?.aktif_kategori || 'Kategori', 32)}`)
          .setDescription(
            [
              `🧾 Toplam **${Number(stateObj?.sayfa_yapisi?.toplam_komut || 0)}** komut`,
              `📄 Sayfa **${Number(stateObj?.suanki_sayfa || 1)}/${Number(stateObj?.sayfa_yapisi?.toplam_sayfa || 1)}**`,
              `🔤 Sıralama: **Alfabetik**`,
              '',
              '📌 Komut detayları aşağıda kategorize edildi:'
            ].join('\n')
          )
          .setTimestamp();

  // Uygula parametreler (renk, footer, img vs)
  applyEmbedParameters(embed, guildId, userId);

  // Kalan süre alanı (yardim.js ile aynı mantık: state üzerinden göster)
  if (Number.isFinite(kalan)) {
    embed.addFields({
      name: '⏳ KALAN SÜRE (SANIYE)',
      value: `🧨 **${kalan} saniye**\n> Butona bastıkça süre yenilenir.`,
      inline: false
    });
  }

  if (isHome) {
    embed.addFields({ name: '✨ İpucu', value: 'Butonlara bastıkça panel süresi yenilenir.', inline: false });
  } else if (isList) {
    const items = Array.isArray(stateObj?.sayfa_icerigi) ? stateObj.sayfa_icerigi : [];
    if (!items.length) {
      embed.addFields({ name: '⚠️ Komut bulunamadı', value: 'Bu kategoride listelenecek bir komut yok.', inline: false });
    } else {
      const byCat = new Map();
      for (const c of items) {
        const cat = c?.category || 'Genel';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(c);
      }

      const sortedCats = Array.from(byCat.keys()).sort(compareTr);
      for (const catName of sortedCats) {
        const cmds = byCat.get(catName) || [];
        const lines = [];
        for (const c of cmds) {
          const name = safeText(c?.name, 32);
          const usage = safeText(c?.usage, 150);
          const desc = safeText(c?.description, 180);

          lines.push(`🔹 **/${name}** — ${desc}`);
          lines.push(`↳ 🧩 Kullanım: \`${usage}\``);
          lines.push('');
        }

        const chunks = chunkTo1024(lines.filter(Boolean));
        chunks.forEach((chunk, idx) => {
          const title = idx === 0 ? `📂 ${safeText(catName, 60)}` : `📂 ${safeText(catName, 60)} (devam)`;
          embed.addFields({ name: title, value: chunk, inline: false });
        });
      }
    }
  }

  // Süre bitti / pasif uyarısı
if (durum !== 'aktif' || (Number.isFinite(kalan) && kalan <= 2)) {
  const expiredEmbed = new EmbedBuilder()
    .setTitle('ℹ️ Bilgi')
    .setDescription('⛔ Bu yardım panelinin süresi doldu. Butonlar devre dışı bırakıldı.')
    .setColor(0xFF0000) // isteğe bağlı renk
    .setTimestamp();

  return expiredEmbed;
}



  return embed;
}

async function updateHelpMessageFromState(stateObj, { disableButtons = false } = {}) {
  const guildId = stateObj?.sunucu_id;
  const channelId = stateObj?.kanal_id;
  const messageId = stateObj?.mesaj_id;

  if (!client || !client.isReady() || !guildId || !channelId || !messageId) return false;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return false;

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return false;

    const embed = buildHelpEmbedFromState(stateObj);

    const payload = disableButtons ? { embeds: [embed], components: [] } : { embeds: [embed] };
    await msg.edit(payload).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function finalizeHelpStateFile(filePath, stateObj) {
  // durum pasif + dosya adı cop-... + taşıma
  try {
    await ensureDir(COP_TEMIZLIK_DIR);

    const msgId = String(stateObj?.mesaj_id || path.basename(filePath).replace('.json', ''));
    const ts = formatCopTimestamp(new Date());
    const newName = `cop-${msgId}-${ts}.json`;
    const newLocalPath = path.join(path.dirname(filePath), newName);
    const movedPath = path.join(COP_TEMIZLIK_DIR, newName);

    // önce rename
    await fsp.rename(filePath, newLocalPath).catch(async () => {
      // fallback: kopyala + sil
      try {
        await fsp.copyFile(filePath, newLocalPath);
        await fsp.unlink(filePath).catch(() => {});
      } catch {}
    });

    // rename olur olmaz mesajı "süre bitti" olarak güncelle + butonları kapat
    await updateHelpMessageFromState(stateObj, { disableButtons: true });

    // sonra cop_temizlik'e taşı
    await fsp.rename(newLocalPath, movedPath).catch(async () => {
      try {
        await fsp.copyFile(newLocalPath, movedPath);
        await fsp.unlink(newLocalPath).catch(() => {});
      } catch {}
    });

    return true;
  } catch (e) {
    await SafeLog.warn('yardim_state_finalize_hata', `Yardım state finalize hatası: ${e.message}`, {
      klasor: 'yardim_state',
      key: 'finalize',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
    return false;
  }
}

async function tickYardimKomutuStates() {
  if (globalTickYardimRunning) return;
  globalTickYardimRunning = true;

  try {
    await ensureDir(YARDIM_STATE_DIR);

    const files = await fsp.readdir(YARDIM_STATE_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json') && !f.startsWith('cop-'));

    for (const file of jsonFiles) {
      const fp = path.join(YARDIM_STATE_DIR, file);

      const stateObj = await safeReadJson(fp);
      if (!stateObj || stateObj.tur !== 'yardim_komutu_embed_state') continue;

      // Eğer zaten pasif ise finalize et (ör: daha önce tick kaçırmış olabilir)
      const durum = String(stateObj?.durum || 'aktif');

      // Kalan süreyi dosyadan oku (memory değil) ve koruma uygula
      let kalan = Number(stateObj?.kalan_sure_saniye);

      if (!Number.isFinite(kalan)) kalan = 2;

      // Negatif bug koruması: - değer gördüğünde 2'ye sabitle
      if (kalan < 0) {
        kalan = 2;
        stateObj.kalan_sure_saniye = 2;
        stateObj.guncelleme_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj);
      }

      // Pasif ise direkt finalize
      if (durum !== 'aktif' || kalan <= 2) {
        stateObj.durum = 'pasif';
        stateObj.kalan_sure_saniye = 2;
        stateObj.guncelleme_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj);

        await finalizeHelpStateFile(fp, stateObj);
        continue;
      }

      // Aktif ve kalan > 2 ise 1 azalt
      const yeniKalan = Math.max(2, kalan - 1);

      stateObj.kalan_sure_saniye = yeniKalan;
      stateObj.guncelleme_tarihi_iso = new Date().toISOString();

      // Eğer 0 altına düşecek bug olursa 2'ye sabitle
      if (stateObj.kalan_sure_saniye < 0) stateObj.kalan_sure_saniye = 2;

      await safeWriteJson(fp, stateObj);

      // Her -1 düşüşte embed'i state içeriğine göre güncelle
      if (yeniKalan > 2) {
        await updateHelpMessageFromState(stateObj, { disableButtons: false });
      } else {
        // 2'ye düştüyse: pasifleştir + butonları kapat + dosyayı cop'a taşı
        stateObj.durum = 'pasif';
        stateObj.kalan_sure_saniye = 2;
        stateObj.guncelleme_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj);

        await finalizeHelpStateFile(fp, stateObj);
      }
    }
  } catch (e) {
    await SafeLog.error('yardim_state_tick_hata', `Yardım state tick hatası: ${e.message}`, {
      klasor: 'yardim_state',
      key: 'tick',
      hata: e.message
    }).catch(() => {});
  } finally {
    globalTickYardimRunning = false;
  }
}


// ==================== IP KOMUTU STATE TICK (DOSYA TABANLI) ====================
// root/state/ip_komutu/<mesajid>.json dosyalarını her saniye okur ve kalan_sure_saniye değerini
// SADECE dosya üzerinden -1 azaltır (asla memory içi geri sayım yok). Bot restart olsa bile devam eder.

function _disableAllButtons(components = []) {
  try {
    if (!Array.isArray(components)) return [];
    const disableTypes = new Set([2, 3, 5, 6, 7, 8]); // button + tüm select menu tipleri

    return components.map(row => {
      try {
        const rowJson = typeof row?.toJSON === 'function' ? row.toJSON() : row;
        if (!rowJson || !Array.isArray(rowJson.components)) return rowJson;

        rowJson.components = rowJson.components.map(comp => {
          const c = { ...comp };
          if (disableTypes.has(Number(c.type))) {
            c.disabled = true;
          }
          return c;
        });

        return rowJson;
      } catch {
        return row;
      }
    });
  } catch {
    return components;
  }
}

// IP mesaj edit lock (aynı mesaja aynı anda 2 edit atılmasını engeller)
const __ipMsgEditLocks = new Map(); // messageId -> Promise

function __withIpMsgLock(messageId, fn) {
  const prev = __ipMsgEditLocks.get(messageId) || Promise.resolve();
  const next = prev
    .then(fn)
    .catch(() => {})
    .finally(() => {
      if (__ipMsgEditLocks.get(messageId) === next) __ipMsgEditLocks.delete(messageId);
    });
  __ipMsgEditLocks.set(messageId, next);
  return next;
}

function __extractKalanFromEmbed(embed) {
  try {
    const fields = Array.isArray(embed?.fields) ? embed.fields : [];
    for (const f of fields) {
      const name = String(f?.name || '').toLowerCase();
      if (name.includes('kalan') && name.includes('süre')) {
        const m = String(f?.value || '').match(/(\d+)/);
        if (m) return Number(m[1]);
      }
      if (name.includes('⏱️') && name.includes('kalan')) {
        const m = String(f?.value || '').match(/(\d+)/);
        if (m) return Number(m[1]);
      }
    }
  } catch {}
  return null;
}

async function updateIpMessageFromState(stateObj, opts = {}) {
  const disableButtons = Boolean(opts.disableButtons);
  const forceFail = Boolean(opts.forceFail);
  const forceSuccess = Boolean(opts.forceSuccess);

  try {
    const channelId = stateObj?.kanal_id;
    const buttonEmbedMsgId = stateObj?.sonuc_dosya_butonlu_embed_mesaj_id;
    const countdownMsgId = stateObj?.geri_sayim_mesaj_id;

    if (!channelId || (!buttonEmbedMsgId && !countdownMsgId)) return false;

    const lockKey = String(buttonEmbedMsgId || countdownMsgId || channelId);

    return await __withIpMsgLock(lockKey, async () => {
      const kanal = await client.channels.fetch(channelId).catch(() => null);
      if (!kanal || !kanal.isTextBased()) return false;

      const kalan = Math.max(0, Number(stateObj?.kalan_sure_saniye || 0));

      // 1) Geri sayım mesajını güncelle
      if (countdownMsgId) {
        try {
          const kalanMsg = await kanal.messages.fetch(String(countdownMsgId)).catch(() => null);
          if (kalanMsg) {
            const newContent = (disableButtons || kalan <= 0)
              ? '⏱️ Süre doldu. İşlem tamamlandı !'
              : `⚠️ **Kalan Sure !**
Kalan Sure: \`${kalan}\` saniye`;

            const currentContent = String(kalanMsg.content || '').trim();
            if (String(newContent).trim() !== currentContent) {
              await kalanMsg.edit({ content: newContent }).catch(() => {});
            }
          }
        } catch {}
      }

      // 2) Sonuç (butonlu) embed mesajını sadece süre bittiğinde / devre dışı bırakırken güncelle
      //    ✅ Performans: geri sayım sırasında bu mesajı *SÜREKLİ* edit etmiyoruz.
      //    ✅ İstek: "sonuc_dosya_butonlu_embed_mesaj_id" mesajına sadece süre bittiğinde/devre dışı bırakmada dokun.
      if (!buttonEmbedMsgId) return true;

      // Geri sayım devam ederken (disableButtons=false ve kalan>0) butonlu embed mesajını güncelleme
      if (!disableButtons && kalan > 0) {
        return true;
      }

      const msg = await kanal.messages.fetch(String(buttonEmbedMsgId)).catch(() => null);
      if (!msg) return false;

      const oldEmbed = msg.embeds?.[0];

      // Embed yoksa sadece butonları kapat / minimal content güncelle
      if (!oldEmbed) {
        const newContent = (disableButtons || kalan <= 0)
          ? (forceFail ? '❌ İşlem iptal edildi.' : '⏱️ Süre doldu. Lütfen komutu tekrar kullanın.')
          : String(msg.content || '');

        const payload = disableButtons
          ? { content: newContent, components: _disableAllButtons(msg.components || []) }
          : { content: newContent };

        await msg.edit(payload).catch(() => {});
        return true;
      }

      const eb = EmbedBuilder.from(oldEmbed);

      // Kalan süre alanını bul/güncelle
      const fields = Array.isArray(eb.data?.fields) ? eb.data.fields.slice() : [];
      let updated = false;

      for (let i = 0; i < fields.length; i++) {
        const name = String(fields[i]?.name || '');
        const lower = name.toLowerCase();
        if (lower.includes('kalan') && (lower.includes('süre') || lower.includes('sure'))) {
          fields[i] = { ...fields[i], value: `${kalan} saniye` };
          updated = true;
          break;
        }
        if (name.includes('⏱️') && lower.includes('kalan')) {
          fields[i] = { ...fields[i], value: `${kalan} saniye` };
          updated = true;
          break;
        }
      }

      if (!updated) {
        fields.push({ name: '⏱️ Kalan Süre', value: `${kalan} saniye`, inline: true });
      }

      eb.setFields(fields.slice(0, 25));

      if (disableButtons || kalan <= 0) {
        // Süre doldu / iptal / başarı mesajı (DUPLICATE yazı engeli)
        if (forceSuccess) {
          eb.setTitle('✅ İşlem Tamamlandı');
          eb.setDescription(
            [
              'Sonuç başarıyla hazırlandı ve DM olarak iletildi.',
              '',
              'ℹ️ Eğer DM kapalıysa, Discord ayarlarından DM izinlerini açıp tekrar deneyin.'
            ].join('\n')
          );
          // Alanları sadeleştir
          eb.setFields([
            { name: '⏱️ Kalan Süre', value: `${kalan} saniye`, inline: true }
          ]);
        } else if (forceFail) {
          eb.setTitle('ℹ️ UYARI !');
          eb.setDescription(
            [
              'Bir hata oluştu veya işlem başarıyla tamamlandı !',
              '',
              'Eğer dm ye sonuç veriler gönderilmemiş ise komutu tekrar kullanın veya hata hala devam ediyorsa yetkililer ile iletişime geçiniz !'
            ].join('\n')
          );
          eb.setFields([
            { name: '⏱️ Kalan Süre', value: `${kalan} saniye`, inline: true }
          ]);
        } else {
          const desc = String(eb.data?.description || '');
          const msg = '⏱️ Süre doldu. Butonlar devre dışı bırakıldı.';
          if (!desc.includes(msg)) {
            eb.setDescription(desc + (desc ? '\n\n' : '') + msg);
          }
        }
      }

      const payload = (disableButtons || kalan <= 0)
        ? { embeds: [eb], components: _disableAllButtons(msg.components || []) }
        : { embeds: [eb] };

      await msg.edit(payload).catch(() => {});
      return true;
    });
  } catch (e) {
    await SafeLog.warn('ip_state_update_msg_hata', `IP state mesaj güncelleme hatası: ${e.message}`, {
      klasor: 'ip_state',
      key: 'update',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
    return false;
  }
}

async function finalizeIpStateFile
(filePath, stateObj) {
  try {
    const msgId = stateObj?.sonuc_dosya_butonlu_embed_mesaj_id || stateObj?.geri_sayim_mesaj_id || path.basename(filePath, '.json');
    const ts = Date.now();
    const newName = `cop-${msgId}-${ts}.json`;
    const newLocalPath = path.join(path.dirname(filePath), newName);
    const movedPath = path.join(COP_TEMIZLIK_DIR, newName);

    // önce rename
    await fsp.rename(filePath, newLocalPath).catch(async () => {
      try {
        await fsp.copyFile(filePath, newLocalPath);
        await fsp.unlink(filePath).catch(() => {});
      } catch {}
    });

    // mesajı "süre bitti" olarak güncelle + butonları kapat
    await updateIpMessageFromState(stateObj, { disableButtons: true, forceFail: (String(stateObj?.durum||'') === 'timeout' || String(stateObj?.durum||'') === 'iptal'), forceSuccess: (String(stateObj?.durum||'') === 'basarili') });

    // cop_temizlik'e taşı
    await fsp.rename(newLocalPath, movedPath).catch(async () => {
      try {
        await fsp.copyFile(newLocalPath, movedPath);
        await fsp.unlink(newLocalPath).catch(() => {});
      } catch {}
    });

    return true;
  } catch (e) {
    await SafeLog.warn('ip_state_finalize_hata', `IP state finalize hatası: ${e.message}`, {
      klasor: 'ip_state',
      key: 'finalize',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
    return false;
  }
}

async function tickIpKomutuStates() {
  if (globalTickIpRunning) return;
  globalTickIpRunning = true;

  try {
    await ensureDir(IP_STATE_DIR);

    const files = await fsp.readdir(IP_STATE_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json') && !f.startsWith('cop-'));

    for (const file of jsonFiles) {
      const fp = path.join(IP_STATE_DIR, file);

      const stateObj = await safeReadJson(fp);
      if (!stateObj || stateObj.tur !== 'ip_komutu_embed_state') continue;

      const durum = String(stateObj?.durum || 'aktif');
      let kalan = Number(stateObj?.kalan_sure_saniye);
      if (!Number.isFinite(kalan)) kalan = 0;
      if (kalan < 0) kalan = 0;

      // Başarıyla sonuçlanmış state varsa tekrar "hata" basma
      if (durum === 'basarili' || durum === 'sonuc_alindi' || durum === 'tamamlandi') {
        stateObj.durum = 'basarili';
        stateObj.kalan_sure_saniye = 0;
        stateObj.guncelleme_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj).catch(() => {});

        await updateIpMessageFromState(stateObj, { disableButtons: true, forceSuccess: true, forceFail: false }).catch(() => {});
        await finalizeIpStateFile(fp, stateObj).catch(() => {});
        continue;
      }

      // İSTEK: kalan süre 2 veya altına düştüyse (veya bot restart/shutdown sonrası 2'ye çekildiyse)
      // işlemi direkt "süre dolmuş gibi" finalize et. Butonlar devre dışı + sorgu başarısız.
      if (durum !== 'aktif' || kalan <= 2) {
        stateObj.durum = (durum !== 'aktif') ? durum : 'timeout';
        stateObj.kalan_sure_saniye = 0;
        stateObj.guncelleme_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj);

        // Mesajları "iptal/timeout" gibi güncelle
        await updateIpMessageFromState(stateObj, {
          disableButtons: true,
          forceFail: true
        });

        await finalizeIpStateFile(fp, stateObj);
        continue;
      }

      const yeniKalan = Math.max(0, kalan - 1);
      stateObj.kalan_sure_saniye = yeniKalan;
      stateObj.guncelleme_tarihi_iso = new Date().toISOString();

      await safeWriteJson(fp, stateObj);

      // Normal durumda güncelle
      await updateIpMessageFromState(stateObj, { disableButtons: false, forceFail: false });
    }
  } catch (e) {
    await SafeLog.error('ip_state_tick_hata', `IP state tick hatası: ${e.message}`, {
      klasor: 'ip_state',
      key: 'tick',
      hata: e.message
    }).catch(() => {});
  } finally {
    globalTickIpRunning = false;
  }
}



// ==================== IP STATE RECOVERY (RESTART/SHUTDOWN SAFE) ====================
// İstek:
// - Bot kapanırken: kalan_sure_saniye 2'ye çek + butonları devre dışı + sorguyu "başarısız" işaretle.
// - Bot açılırken (restart sonrası): yarım kalan state'leri aynı şekilde "süre dolmuş gibi" davranacak hale getir.

async function __ipStateBulkMarkAndDisable(mode = 'restart') {
  try {
    await ensureDir(IP_STATE_DIR);

    const files = await fsp.readdir(IP_STATE_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json') && !f.startsWith('cop-'));
    if (jsonFiles.length === 0) return { total: 0, updated: 0 };

    let updated = 0;

    for (const file of jsonFiles) {
      const fp = path.join(IP_STATE_DIR, file);

      const stateObj = await safeReadJson(fp);
      if (!stateObj || stateObj.tur !== 'ip_komutu_embed_state') continue;

      const durum = String(stateObj?.durum || 'aktif');

      // Sadece aktif (veya belirsiz) state'leri işaretle
      if (durum !== 'aktif') continue;

      stateObj.durum = (mode === 'shutdown') ? 'iptal' : 'timeout';
      stateObj.kalan_sure_saniye = 2;
      stateObj.guncelleme_tarihi_iso = new Date().toISOString();

      await safeWriteJson(fp, stateObj);

      // Mesaj düzenleme best-effort (client ready değilse sadece dosya güncellenir)
      if (client && client.isReady()) {
        await updateIpMessageFromState(stateObj, { disableButtons: true, forceFail: true }).catch(() => {});
      }

      updated++;
    }

    return { total: jsonFiles.length, updated };
  } catch {
    return { total: 0, updated: 0 };
  }
}
// ==================== IP SONUÇ DOSYASI REBUILD (RESTART-SAFE, TEK SEFER) ====================
// Amaç: Bot restart / ani kapanma sonrası, state dosyasındaki sonuç metni (sonuc_txt) ve dosya yolu (sonuc_dosya_yolu)
// bilgilerini kullanarak cop_temizlik içine aynı isimle .txt dosyasını yeniden oluşturmak.
// Not: Bu işlem SADECE bot başlangıcında 1 defa çalışır (tekrarlı rebuild engellenir).

let __ipSonucRebuildDone = false;

function __sanitizeFileName(name) {
  try {
    const n = String(name || '').trim();
    if (!n) return null;
    // Çok agresif olmayan, ama traversal engelleyen basit temizlik
    const base = path.basename(n);
    const safe = base.replace(/[^a-zA-Z0-9_.\-]/g, '_');
    return safe || null;
  } catch {
    return null;
  }
}

async function __ensureIpSonucTxtFromState(stateObj) {
  try {
    const sonucTxt = (typeof stateObj?.sonuc_txt === 'string') ? stateObj.sonuc_txt : null;
    if (!sonucTxt || !sonucTxt.trim()) return null;

    // Dosya adı: sonuc_dosya_yolu varsa aynı basename; yoksa mesaj_id üzerinden üret
    const fromPath = (typeof stateObj?.sonuc_dosya_yolu === 'string') ? stateObj.sonuc_dosya_yolu : '';
    const fileName = __sanitizeFileName(fromPath) || __sanitizeFileName(stateObj?.sonuc_dosya_adi) || `${stateObj?.mesaj_id || 'sonuc'}-sonuc.txt`;

    await ensureDir(COP_TEMIZLIK_DIR);

    const targetPath = path.join(COP_TEMIZLIK_DIR, fileName);

    const exists = await fsp.stat(targetPath).then(st => st.isFile()).catch(() => false);
    if (!exists) {
      // Windows Notepad uyumu: UTF-8 BOM ekle
      const content = '\uFEFF' + String(sonucTxt).replace(/\r\n/g, '\n');
      await fsp.writeFile(targetPath, content, 'utf8').catch(() => {});
    }

    return targetPath;
  } catch {
    return null;
  }
}

async function rebuildIpSonucFilesOnce() {
  if (__ipSonucRebuildDone) return;
  __ipSonucRebuildDone = true;

  try {
    await ensureDir(IP_STATE_DIR);
    await ensureDir(COP_TEMIZLIK_DIR);

    const files = await fsp.readdir(IP_STATE_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json') && !f.startsWith('cop-'));

    let rebuilt = 0;

    for (const file of jsonFiles) {
      const fp = path.join(IP_STATE_DIR, file);
      const stateObj = await safeReadJson(fp);
      if (!stateObj || stateObj.tur !== 'ip_komutu_embed_state') continue;

      // State içinde sonuç anahtarları yoksa geç
      const hasSonucTxt = typeof stateObj?.sonuc_txt === 'string' && stateObj.sonuc_txt.trim();
      const hasSonucYol = typeof stateObj?.sonuc_dosya_yolu === 'string' && stateObj.sonuc_dosya_yolu.trim();
      if (!hasSonucTxt && !hasSonucYol) continue;

      const rebuiltPath = await __ensureIpSonucTxtFromState(stateObj);
      if (rebuiltPath) {
        // State'i güncelle: yeni dosya yolu cop_temizlik içinde (restart sonrası kesin)
        stateObj.sonuc_dosya_yolu = rebuiltPath;
        stateObj.sonuc_dosya_adi = path.basename(rebuiltPath);
        stateObj.sonuc_rebuild_tarihi_iso = new Date().toISOString();
        await safeWriteJson(fp, stateObj);
        rebuilt++;
      }
    }

    if (rebuilt > 0) {
      await SafeLog.info('ip_sonuc_rebuild_ok', `IP sonuç dosyaları rebuild edildi: ${rebuilt} adet`, {
        klasor: 'ip_state',
        key: 'rebuild',
        adet: rebuilt
      }).catch(() => {});
    }
  } catch (e) {
    await SafeLog.warn('ip_sonuc_rebuild_hata', `IP sonuç rebuild hatası: ${e.message}`, {
      klasor: 'ip_state',
      key: 'rebuild',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
  }
}

async function findIpStateByTraceId(traceId) {
  if (!traceId) return null;
  const tid = String(traceId).trim();
  if (!tid) return null;

  try {
    await ensureDir(IP_STATE_DIR);
    const files = await fsp.readdir(IP_STATE_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const fp = path.join(IP_STATE_DIR, file);
      const st = await safeReadJson(fp);
      if (!st || st.tur !== 'ip_komutu_embed_state') continue;

      const stTrace = String(st.trace_id || st.traceId || st.trace || '').trim();
      if (stTrace && stTrace === tid) return { filePath: fp, state: st };

      // Fallback: bazı sürümlerde buton embed mesaj id'si ile ilişkilendirilebilir
      const btnTrace = String(st.buton_trace_id || '').trim();
      if (btnTrace && btnTrace === tid) return { filePath: fp, state: st };
    }

    // Fallback (YENİ): IP dışındaki state alt klasörlerinde de trace_id ile ara (muaf klasörler hariç)
    try {
      const muaf = await __loadStateMuafKlasorler();
      ['ip_komutu', 'yardim_komutu', 'rate_limit_kontrol'].forEach(x => muaf.add(x));

      const otherFiles = await __walkJsonFilesRecursive(STATE_ROOT_DIR, muaf);
      for (const fp of otherFiles) {
        const st = await safeReadJson(fp);
        if (!__isIpLikeGenericState(st)) continue;

        const stTrace = String(st.trace_id || st.traceId || st.trace || '').trim();
        if (stTrace && stTrace === tid) return { filePath: fp, state: st };

        const btnTrace = String(st.buton_trace_id || '').trim();
        if (btnTrace && btnTrace === tid) return { filePath: fp, state: st };
      }
    } catch {}

  } catch {}

  return null;
}

// ==================== IP STATE SUCCESS FINALIZE (BUTON BASTI) ====================
// Amaç: Kullanıcı sonuç butonuna bastığında state "başarılı" olarak işaretlensin,
// butonlar kapatılsın ve tick mekanizması tekrar "hata/iptal" basmasın.
async function __markIpStateSuccess(stateFilePath, stateObj) {
  try {
    if (!stateFilePath || !stateObj) return false;

    stateObj.durum = 'basarili';
    stateObj.kalan_sure_saniye = 0;
    stateObj.guncelleme_tarihi_iso = new Date().toISOString();

    await safeWriteJson(stateFilePath, stateObj).catch(() => {});

    // Mesajı başarı durumuna çek + butonları kapat
    if (client && client.isReady()) {
      await updateIpMessageFromState(stateObj, { disableButtons: true, forceSuccess: true, forceFail: false }).catch(() => {});
    }

    // Dosyayı cop'a taşı (normal akış)
    await finalizeIpStateFile(stateFilePath, stateObj).catch(() => {});
    return true;
  } catch {
    return false;
  }
}





function __extractEncryptedResultLinkFromState(stateObj) {
  try {
    if (!stateObj || typeof stateObj !== 'object') return null;

    const directKeys = [
      'sifreli_link',
      'encrypted_link',
      'sonuc_sifreli_link',
      'sonuc_link',
      'sonuc_url',
      'download_url',
      'api_link',
      'api_url',
      'result_link'
    ];

    for (const k of directKeys) {
      const v = String(stateObj?.[k] || '').trim();
      if (v && /^https?:\/\//i.test(v)) return v;
    }

    const txt = String(stateObj?.sonuc_txt || '').trim();
    if (txt) {
      const m = txt.match(/https?:\/\/[^\s<>"'\]\)]+/i);
      if (m && m[0]) return m[0];
    }

    const other = String(stateObj?.sonuc || stateObj?.link || '').trim();
    if (other && /^https?:\/\//i.test(other)) return other;

    return null;
  } catch {
    return null;
  }
}

// ==================== KOMUT RATE LIMIT (KULLANICI BAZLI, DOSYA TABANLI) ====================
// Amaç: Her kullanıcı saniyede sadece 1 komut kullanabilsin.
// State dosyası: root/state/rate_limit_kontrol/kontrol.json
// ENV: KOMUT_KULLANIM_LIMIT_SANIYE (default 1)

let __rateLimitFileLock = Promise.resolve();

function __withRateLimitFileLock(fn) {
  const run = __rateLimitFileLock.then(fn, fn);
  __rateLimitFileLock = run.catch(() => {});
  return run;
}

function readKomutKullanimLimitSaniye() {
  const raw = process.env.KOMUT_KULLANIM_LIMIT_SANIYE;
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || isNaN(n) || n < 1) return 1;
  return Math.min(3600, n);
}

function formatRateLimitTimestamp(d = new Date()) {
  // YYYY-MM-DD HH:MM:SS
  try {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return new Date().toISOString().replace('T', ' ').split('.')[0];
  }
}

function __normalizeRateLimitState(stateObj) {
  const limit = readKomutKullanimLimitSaniye();
  const st = (stateObj && typeof stateObj === 'object') ? stateObj : {};
  if (!st.gruplar || typeof st.gruplar !== 'object') st.gruplar = {};

  const keys = Object.keys(st.gruplar);

  for (const k of keys) {
    const v = st.gruplar[k];
    if (!v || typeof v !== 'object') {
      delete st.gruplar[k];
      continue;
    }

    const uid = String(v.kullanici_id || k || '').trim();
    if (!uid || !/^\d{5,30}$/.test(uid)) {
      delete st.gruplar[k];
      continue;
    }

    if (k !== uid) {
      st.gruplar[uid] = v;
      delete st.gruplar[k];
    }

    v.kullanici_id = uid;

    const durum = String(v.durum || 'aktif').toLowerCase();
    v.durum = (durum === 'aktif') ? 'aktif' : 'pasif';

    let kalan = Number(v.kalan_sure_saniye);
    if (!Number.isFinite(kalan) || isNaN(kalan)) kalan = limit;

    // ekstra güvenlik: negatif olursa 1'e sabitle
    if (kalan < 0) kalan = 1;

    kalan = Math.floor(kalan);

    v.kalan_sure_saniye = kalan;

    if (!v.komut_kullanim_zaman || typeof v.komut_kullanim_zaman !== 'string') {
      v.komut_kullanim_zaman = formatRateLimitTimestamp(new Date());
    }
  }

  return st;
}

async function safeWriteJsonAtomic(filePath, obj) {
  try {
    await ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
    await fsp.rename(tmp, filePath).catch(async () => {
      try {
        await fsp.copyFile(tmp, filePath);
      } catch {}
      await fsp.unlink(tmp).catch(() => {});
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureRateLimitKontrolFile() {
  return __withRateLimitFileLock(async () => {
    try {
      await ensureDir(RATE_LIMIT_KONTROL_DIR);

      if (!fs.existsSync(RATE_LIMIT_KONTROL_FILE)) {
        const empty = { gruplar: {} };
        await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, empty);
        return true;
      }

      const obj = await safeReadJson(RATE_LIMIT_KONTROL_FILE);

      if (!obj) {
        await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, { gruplar: {} });
        return true;
      }

      const normalized = __normalizeRateLimitState(obj);
      await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, normalized);
      return true;

    } catch (e) {
      await SafeLog.warn('rate_limit_kontrol_dosya_hatasi', `Kontrol dosyası hazırlanamadı: ${e.message}`, {
        klasor: 'rate_limit',
        key: 'startup'
      }).catch(() => {});
      return false;
    }
  });
}

async function tickRateLimitKontrol() {
  if (globalTickRateLimitRunning) return;
  globalTickRateLimitRunning = true;

  try {
    await __withRateLimitFileLock(async () => {
      const limit = readKomutKullanimLimitSaniye();

      let stateObj = await safeReadJson(RATE_LIMIT_KONTROL_FILE);
      if (!stateObj) stateObj = { gruplar: {} };

      stateObj = __normalizeRateLimitState(stateObj);

      const gruplar = stateObj.gruplar || {};
      let changed = false;

      for (const [uid, data] of Object.entries(gruplar)) {
        const durum = String(data?.durum || 'aktif');
        let kalan = Number(data?.kalan_sure_saniye);

        if (durum !== 'aktif') {
          await safeDeleteRateLimitWarningMessage(data);
          delete gruplar[uid];
          changed = true;
          continue;
        }

        if (!Number.isFinite(kalan) || isNaN(kalan)) {
          kalan = limit;
          data.kalan_sure_saniye = limit;
          changed = true;
        }

        if (kalan < 0) {
          // ekstra güvenlik: negatif → 1
          data.kalan_sure_saniye = 1;
          changed = true;
          kalan = 1;
        }

        if (kalan <= 0) {
          await safeDeleteRateLimitWarningMessage(data);
          delete gruplar[uid];
          changed = true;
          continue;
        }

        const yeni = Math.max(0, Math.floor(kalan) - 1);

        if (yeni <= 0) {
          await safeDeleteRateLimitWarningMessage(data);
          delete gruplar[uid];
          changed = true;
        } else {
          data.kalan_sure_saniye = yeni;
          changed = true;
        }
      }

      if (changed) {
        stateObj.gruplar = gruplar;
        await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);
      }
    });
  } catch (e) {
    await SafeLog.error('rate_limit_tick_hata', `Rate limit tick hatası: ${e.message}`, {
      klasor: 'rate_limit',
      key: 'tick',
      hata: e.message
    }).catch(() => {});
  } finally {
    globalTickRateLimitRunning = false;
  }
}

async function safeDeleteRateLimitWarningMessage(record) {
  try {
    if (!client || !client.isReady()) return false;

    const channelId = record?.uyari_kanal_id;
    const messageId = record?.uyari_mesaj_id;
    if (!channelId || !messageId) return false;

    const kanal = await client.channels.fetch(String(channelId)).catch(() => null);
    if (!kanal || !kanal.isTextBased()) return false;

    const msg = await kanal.messages.fetch(String(messageId)).catch(() => null);
    if (!msg) return false;

    await msg.delete().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function handleKullaniciKomutRateLimit(interaction, traceId) {
  try {
    const userId = interaction?.user?.id;
    if (!userId) return true;

    // Owner (ENV) + adminler.json içindeki adminler rate limit dışı
    if (isOwner(userId) || await isAdmin(userId)) {
      // Eski uyarı mesajı varsa sil (mesaj yoksa hata verme)
      try {
        await ensureRateLimitKontrolFile();
        let warn = null;
        await __withRateLimitFileLock(async () => {
          let stateObj = await safeReadJson(RATE_LIMIT_KONTROL_FILE);
          if (!stateObj) return;

          stateObj = __normalizeRateLimitState(stateObj);
          const rec = stateObj?.gruplar?.[String(userId)];
          if (rec) {
            warn = { ...rec };
            delete stateObj.gruplar[String(userId)];
            await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);
          }
        });
        if (warn) await safeDeleteRateLimitWarningMessage(warn);
      } catch {}
      return true;
    }

    const limit = readKomutKullanimLimitSaniye();
    if (limit <= 0) return true;

    // Dosya hazır değilse bile komutu engelleme
    await ensureRateLimitKontrolFile();

    let warningToDelete = null;

    const result = await __withRateLimitFileLock(async () => {
      let stateObj = await safeReadJson(RATE_LIMIT_KONTROL_FILE);
      if (!stateObj) stateObj = { gruplar: {} };

      stateObj = __normalizeRateLimitState(stateObj);

      const gruplar = stateObj.gruplar || {};
      const existing = gruplar[userId];

      if (existing && String(existing.durum) === 'aktif') {
        let kalan = Number(existing.kalan_sure_saniye);

        if (!Number.isFinite(kalan) || isNaN(kalan)) kalan = 1;

        if (kalan < 0) {
          existing.kalan_sure_saniye = 1;
          kalan = 1;
          await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);
        }

        if (kalan <= 0) {
          // cooldown bitmiş: kayıt sil + varsa uyarı mesajını sil
          warningToDelete = { ...existing };
          delete gruplar[userId];
          stateObj.gruplar = gruplar;
          await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);
          return { allowed: true };
        }

        return { allowed: false, kalan: Math.max(1, Math.floor(kalan)) };
      }

      // izin ver: cooldown başlat
      gruplar[userId] = {
        kullanici_id: userId,
        komut_kullanim_zaman: formatRateLimitTimestamp(new Date()),
        durum: 'aktif',
        kalan_sure_saniye: limit
      };

      stateObj.gruplar = gruplar;
      await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);

      return { allowed: true };
    });

    // izin verildiyse eski uyarı mesajını da temizle (mesaj yoksa skip)
    if (result.allowed && warningToDelete) {
      await safeDeleteRateLimitWarningMessage(warningToDelete);
    }

    if (!result.allowed) {
      // İstek: Rate limit doluysa net ve kısa uyarı ver.
      // Not: Diğer akışları etkilememek için sadece mesaj metni güncellendi.
      const msg = `⚠️ Çok hızlı kullanıyorsun. **${result.kalan}** saniye bekleyip tekrar dene.`;

      // Uyarıyı NORMAL mesaj olarak gönderiyoruz ki daha sonra silebilelim.
      let sentMsg = null;

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: msg }).catch(() => {});
        } else {
          await interaction.editReply({ content: msg }).catch(() => {});
        }
        sentMsg = await interaction.fetchReply().catch(() => null);
      } catch {}

      // mesaj id'sini state'e yaz (best-effort)
      if (sentMsg?.id && interaction?.channelId) {
        await __withRateLimitFileLock(async () => {
          let stateObj = await safeReadJson(RATE_LIMIT_KONTROL_FILE);
          if (!stateObj) stateObj = { gruplar: {} };
          stateObj = __normalizeRateLimitState(stateObj);

          const rec = stateObj?.gruplar?.[String(userId)];
          if (rec && String(rec.durum) === 'aktif') {
            rec.uyari_mesaj_id = String(sentMsg.id);
            rec.uyari_kanal_id = String(interaction.channelId);
            rec.uyari_sunucu_id = interaction.guildId ? String(interaction.guildId) : null;
            rec.uyari_olusturma_iso = new Date().toISOString();
            await safeWriteJsonAtomic(RATE_LIMIT_KONTROL_FILE, stateObj);
          }
        }).catch(() => {});
      }

      await SafeLog.info('komut_rate_limit', 'Kullanıcı rate limit engeli', {
        klasor: 'rate_limit',
        key: 'block',
        kullaniciID: userId,
        komut: interaction.commandName,
		sendToConsole: false,
        traceID: traceId
      }).catch(() => {});

      return false;
    }

    return true;

  } catch (e) {
    await SafeLog.warn('komut_rate_limit_hata', `Rate limit kontrol hatası: ${e.message}`, {
      klasor: 'rate_limit',
      key: 'error',
	  sendToConsole: false,
      traceID: traceId
    }).catch(() => {});

    return true;
  }
}


// ==================== SUNUCU CONFIG 1 SANİYEDE BİR GÜNCELLEME (HAFİF TOUCH) ====================
// İstek: sunucu_dm_veriler/sunucu/<sunucuid>.json dosyaları her 1 saniyede bir güncellensin.
// NOT: VeriYonetim.toplamaSunucuVerisi çok ağır (owner fetch, kanal/invite/webhook vb.).
// Bu yüzden burada sadece hızlı "touch" yapıyoruz: sonGuncelleme/_metaSonGuncelleme ve temel guild alanları.
// Ayrıca aşağıdaki alanlar KESİNLİKLE overwrite edilmez (tek seferlik ayarlar):
// EMBED_*, ODA_* ve _defaultlar_ilk_yazildi, LOG_KANALI/LOG_KATEGORI (mevcut değerler korunur).

// ==================== SUNUCU/DM VERİLERİ GÜNCELLEME ZAMANLAMASI (CONFIG.JSON) ====================
// İstek: saniyelik (1s) güncelleme yerine, sunucu_dm_veriler/config.json içindeki parametrelerle kontrol.
// Örn:
//  "sunucu_veriler_guncelleme_saniye": 5,
//  "dm_veriler_guncelleme_saniye": 6

const SUNUCU_DM_CONFIG_FILE = path.join(SUNUCU_DM_VERILER_DIR, 'config.json');

let __sunucuDmCfgCache = { at: 0, sunucu_s: 5, dm_s: 6 };

function __readSunucuDmUpdateSeconds() {
  const now = Date.now();
  if (now - __sunucuDmCfgCache.at < 1000) return __sunucuDmCfgCache;

  try {
    if (fs.existsSync(SUNUCU_DM_CONFIG_FILE)) {
      const raw = fs.readFileSync(SUNUCU_DM_CONFIG_FILE, 'utf8');
      const obj = JSON.parse(raw);
      const s1 = Number(obj?.sunucu_veriler_guncelleme_saniye);
      const s2 = Number(obj?.dm_veriler_guncelleme_saniye);

      if (Number.isFinite(s1) && s1 > 0) __sunucuDmCfgCache.sunucu_s = Math.max(1, Math.floor(s1));
      if (Number.isFinite(s2) && s2 > 0) __sunucuDmCfgCache.dm_s = Math.max(1, Math.floor(s2));
    }
  } catch {
    // yut
  }

  __sunucuDmCfgCache.at = now;
  return __sunucuDmCfgCache;
}

let __lastSunucuVerilerTouchAt = 0;
let __lastDmVerilerTouchAt = 0;

function __shouldRunSunucuTouch() {
  const cfg = __readSunucuDmUpdateSeconds();
  return (Date.now() - __lastSunucuVerilerTouchAt) >= (cfg.sunucu_s * 1000);
}

function __shouldRunDmTouch() {
  const cfg = __readSunucuDmUpdateSeconds();
  return (Date.now() - __lastDmVerilerTouchAt) >= (cfg.dm_s * 1000);
}

let globalTickSunucuConfigRunning = false;

function __createTimestampObject() {
  const now = new Date();
  const iso = now.toISOString();
  const tam = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  return {
    iso,
    tam,
    unix: now.getTime()
  };
}

// ==================== BOT KOMUT KULLANIM LIMIT SİSTEMİ (DM JSON TABANLI) ====================
// Tek kaynak: sunucu_dm_veriler/dm/<kullaniciId>.json
// Not:
// - Owner/Admin kullanıcılar mevcut sistem davranışıyla uyumlu olacak şekilde limit dışıdır.
// - Günlük sıfırlama: Türkiye saati ile her gün 00:00
// - Aylık sıfırlama: Türkiye saati ile her ayın 1'i 00:00
// - Sayaçlar tüm komutlar için (DM + sunucu ortak) aynı DM json dosyasında tutulur.

const BOT_COMMAND_USAGE_TIMEZONE = 'Europe/Istanbul';
const BOT_COMMAND_USAGE_RESET_FIELDS = {
  daily: 'BOT_UCRETSIZ_GUNLUK_LIMIT_SON_SIFIRLANMA_ZAMANI',
  monthly: 'BOT_UCRETSIZ_AYLIK_LIMIT_SON_SIFIRLANMA_ZAMANI'
};

const BOT_COMMAND_USAGE_FIELDS = {
  ucretsiz: {
    dailyUsed: 'BOT_UCRETSIZ_KOMUT_KULLANIM_GUNLUK_LIMIT_KULLANILDI',
    dailyRemaining: 'BOT_UCRETSIZ_KOMUT_KULLANIM_GUNLUK_LIMIT_KALAN',
    monthlyUsed: 'BOT_UCRETSIZ_KOMUT_KULLANIM_AYLIK_LIMIT_KULLANILAN',
    monthlyRemaining: 'BOT_UCRETSIZ_KOMUT_KULLANIM_AYLIK_LIMIT_KALAN'
  },
  premium: {
    dailyUsed: 'BOT_PREMIUM_KOMUT_KULLANIM_GUNLUK_LIMIT_KULLANILAN',
    dailyRemaining: 'BOT_PREMIUM_KOMUT_KULLANIM_GUNLUK_LIMIT_KALAN',
    monthlyUsed: 'BOT_PREMIUM_KOMUT_KULLANIM_AYLIK_LIMIT_KULLANILAN',
    monthlyRemaining: 'BOT_PREMIUM_KOMUT_KULLANIM_AYLIK_LIMIT_KALAN'
  },
  vip: {
    dailyUsed: 'BOT_VIP_KOMUT_KULLANIM_GUNLUK_LIMIT_KULLANILAN',
    dailyRemaining: 'BOT_VIP_KOMUT_KULLANIM_GUNLUK_LIMIT_KALAN',
    monthlyUsed: 'BOT_VIP_KOMUT_KULLANIM_AYLIK_LIMIT_KULLANILAN',
    monthlyRemaining: 'BOT_VIP_KOMUT_KULLANIM_AYLIK_LIMIT_KALAN'
  }
};

let __botCommandUsageFileLock = Promise.resolve();

function __withBotCommandUsageFileLock(fn) {
  const run = __botCommandUsageFileLock.then(fn, fn);
  __botCommandUsageFileLock = run.catch(() => {});
  return run;
}

function __readPositiveEnvNumber(name, fallbackValue) {
  const raw = process.env[name];
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || isNaN(n) || n < 0) return fallbackValue;
  return n;
}

function getBotCommandUsageLimits() {
  return {
    ucretsiz: {
      daily: __readPositiveEnvNumber('BOT_UCRETSIZ_KOMUT_KULLANIM_GUNLUK_LIMIT', 20),
      monthly: __readPositiveEnvNumber('BOT_UCRETSIZ_KOMUT_KULLANIM_AYLIK_LIMIT', 100)
    },
    premium: {
      daily: __readPositiveEnvNumber('BOT_PREMIUM_KOMUT_KULLANIM_GUNLUK_LIMIT', 100),
      monthly: __readPositiveEnvNumber('BOT_PREMIUM_KOMUT_KULLANIM_AYLIK_LIMIT', 500)
    },
    vip: {
      daily: __readPositiveEnvNumber('BOT_VIP_KOMUT_KULLANIM_GUNLUK_LIMIT', 300),
      monthly: __readPositiveEnvNumber('BOT_VIP_KOMUT_KULLANIM_AYLIK_LIMIT', 1000)
    }
  };
}

function getTurkeyDateInfo(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: BOT_COMMAND_USAGE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });

    const parts = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    }

    const year = String(parts.year || date.getUTCFullYear());
    const month = String(parts.month || pad2(date.getUTCMonth() + 1));
    const day = String(parts.day || pad2(date.getUTCDate()));
    const hour = String(parts.hour || pad2(date.getUTCHours()));
    const minute = String(parts.minute || pad2(date.getUTCMinutes()));
    const second = String(parts.second || pad2(date.getUTCSeconds()));

    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      dayKey: `${year}-${month}-${day}`,
      monthKey: `${year}-${month}`,
      text: `${year}-${month}-${day} ${hour}:${minute}:${second}`
    };
  } catch {
    const fallback = new Date(date);
    return {
      year: String(fallback.getFullYear()),
      month: pad2(fallback.getMonth() + 1),
      day: pad2(fallback.getDate()),
      hour: pad2(fallback.getHours()),
      minute: pad2(fallback.getMinutes()),
      second: pad2(fallback.getSeconds()),
      dayKey: `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}-${pad2(fallback.getDate())}`,
      monthKey: `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}`,
      text: `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}-${pad2(fallback.getDate())} ${pad2(fallback.getHours())}:${pad2(fallback.getMinutes())}:${pad2(fallback.getSeconds())}`
    };
  }
}

function __extractDayKeyFromStoredResetValue(value) {
  try {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const s = String(value).trim();
    const direct = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return null;
    return getTurkeyDateInfo(d).dayKey;
  } catch {
    return null;
  }
}

function __extractMonthKeyFromStoredResetValue(value) {
  try {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const s = String(value).trim();
    const direct = s.match(/^(\d{4}-\d{2})/);
    if (direct) return direct[1];
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return null;
    return getTurkeyDateInfo(d).monthKey;
  } catch {
    return null;
  }
}

function __clampUsageValue(value, minValue, maxValue, fallbackValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || isNaN(n)) return fallbackValue;
  return Math.max(minValue, Math.min(maxValue, Math.floor(n)));
}

function __getLimitTierKeyFromRutbe(rutbe) {
  const s = String(rutbe || '').trim().toLowerCase();
  if (s === 'vip') return 'vip';
  if (s === 'premium') return 'premium';
  if (s === 'ucretsiz' || s === 'normal' || s === 'user') return 'ucretsiz';
  return null;
}

function __isBotCommandUsageLimitExemptRutbe(rutbe) {
  const s = String(rutbe || '').trim().toLowerCase();
  return s === 'owner' || s === 'admin';
}

function normalizeBotCommandUsageData(rawData, opts = {}) {
  const data = (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) ? rawData : {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limits = getBotCommandUsageLimits();
  const turkeyNow = getTurkeyDateInfo(now);

  const storedDailyKey = __extractDayKeyFromStoredResetValue(data[BOT_COMMAND_USAGE_RESET_FIELDS.daily]);
  const storedMonthlyKey = __extractMonthKeyFromStoredResetValue(data[BOT_COMMAND_USAGE_RESET_FIELDS.monthly]);

  let shouldResetMonthly = Boolean(opts.forceMonthlyReset);
  let shouldResetDaily = Boolean(opts.forceDailyReset);

  if (!storedMonthlyKey || storedMonthlyKey !== turkeyNow.monthKey) shouldResetMonthly = true;
  if (!storedDailyKey || storedDailyKey !== turkeyNow.dayKey) shouldResetDaily = true;
  if (shouldResetMonthly) shouldResetDaily = true;

  let changed = false;

  for (const [tierKey, fieldMap] of Object.entries(BOT_COMMAND_USAGE_FIELDS)) {
    const tierLimits = limits[tierKey] || { daily: 0, monthly: 0 };

    let dailyUsed = __clampUsageValue(data[fieldMap.dailyUsed], 0, tierLimits.daily, 0);
    let monthlyUsed = __clampUsageValue(data[fieldMap.monthlyUsed], 0, tierLimits.monthly, 0);

    if (shouldResetDaily) dailyUsed = 0;
    if (shouldResetMonthly) monthlyUsed = 0;

    const dailyRemaining = Math.max(0, tierLimits.daily - dailyUsed);
    const monthlyRemaining = Math.max(0, tierLimits.monthly - monthlyUsed);

    if (data[fieldMap.dailyUsed] !== dailyUsed) {
      data[fieldMap.dailyUsed] = dailyUsed;
      changed = true;
    }
    if (data[fieldMap.dailyRemaining] !== dailyRemaining) {
      data[fieldMap.dailyRemaining] = dailyRemaining;
      changed = true;
    }
    if (data[fieldMap.monthlyUsed] !== monthlyUsed) {
      data[fieldMap.monthlyUsed] = monthlyUsed;
      changed = true;
    }
    if (data[fieldMap.monthlyRemaining] !== monthlyRemaining) {
      data[fieldMap.monthlyRemaining] = monthlyRemaining;
      changed = true;
    }
  }

  const nowIso = now.toISOString();

  if (shouldResetDaily || !data[BOT_COMMAND_USAGE_RESET_FIELDS.daily]) {
    if (data[BOT_COMMAND_USAGE_RESET_FIELDS.daily] !== nowIso) {
      data[BOT_COMMAND_USAGE_RESET_FIELDS.daily] = nowIso;
      changed = true;
    }
  }

  if (shouldResetMonthly || !data[BOT_COMMAND_USAGE_RESET_FIELDS.monthly]) {
    if (data[BOT_COMMAND_USAGE_RESET_FIELDS.monthly] !== nowIso) {
      data[BOT_COMMAND_USAGE_RESET_FIELDS.monthly] = nowIso;
      changed = true;
    }
  }

  return {
    data,
    changed,
    turkeyNow,
    resetDaily: shouldResetDaily,
    resetMonthly: shouldResetMonthly
  };
}

async function __readExistingDmUserConfigForUsage(userId) {
  const jsonPath = path.join(DM_VERILER_DIR, `${userId}.json`);
  const jsPath = path.join(DM_VERILER_DIR, `${userId}.js`);

  if (fs.existsSync(jsonPath)) {
    const fromJson = await safeReadJson(jsonPath).catch(() => null);
    return { filePath: jsonPath, data: (fromJson && typeof fromJson === 'object') ? fromJson : {} };
  }

  if (fs.existsSync(jsPath)) {
    try {
      delete require.cache[require.resolve(jsPath)];
      const fromJs = require(jsPath);
      return { filePath: jsonPath, data: (fromJs && typeof fromJs === 'object') ? fromJs : {} };
    } catch {
      return { filePath: jsonPath, data: {} };
    }
  }

  return { filePath: jsonPath, data: {} };
}

async function ensureDmUserCommandUsageFile(userId, opts = {}) {
  try {
    if (!userId) return null;

    await ensureDir(DM_VERILER_DIR);

    const existing = await __readExistingDmUserConfigForUsage(userId);
    const normalized = normalizeBotCommandUsageData(existing?.data || {}, opts);
    const payload = normalized?.data || existing?.data || {};

    if (!payload.kullanici_id) payload.kullanici_id = String(userId);

    const writeOk = await safeWriteJsonAtomic(existing.filePath, payload);
    if (!writeOk) return null;

    return {
      filePath: existing.filePath,
      data: payload,
      normalized
    };
  } catch {
    return null;
  }
}

function createBotCommandUsageLimitExceededEmbed(guildId, userId, tierKey, counters, blockedBy = {}) {
  const tierLabels = {
    ucretsiz: 'Ücretsiz',
    premium: 'Premium',
    vip: 'VIP'
  };

  const reasons = [];
  if (blockedBy?.daily) reasons.push('günlük limit');
  if (blockedBy?.monthly) reasons.push('aylık limit');

  const reasonText = reasons.length > 0 ? reasons.join(' ve ') : 'komut kullanım limiti';

  const embed = new EmbedBuilder()
    .setTitle('🚫 Komut Kullanım Limiti Doldu')
    .setDescription(
      `Mevcut **${tierLabels[tierKey] || tierKey || 'kullanıcı'}** hesabın için tanımlı **${reasonText}** doldu.\n\n` +
      `• Günlük kalan: **${Math.max(0, Number(counters?.dailyRemaining || 0))}**\n` +
      `• Aylık kalan: **${Math.max(0, Number(counters?.monthlyRemaining || 0))}**\n\n` +
      `Günlük limitler her gün **Türkiye saati ile 00:00**'da, aylık limitler ise her ayın **1'inde** otomatik sıfırlanır.`
    )
    .setColor('#ff8800')
    .setTimestamp();

  applyEmbedParameters(embed, guildId, userId, guildId ? null : { scope: 'dm' });
  return embed;
}

async function sendBotCommandUsageLimitExceededResponse(interaction, embed) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch {
    try {
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return true;
    } catch {
      return false;
    }
  }
}

async function consumeBotCommandUsageLimit(interaction, traceId) {
  return __withBotCommandUsageFileLock(async () => {
    try {
      const userId = interaction?.user?.id;
      const guildId = interaction?.guildId;

      if (!userId) {
        return { allowed: true, skipped: true, reason: 'missing_user' };
      }

      const rutbe = getUserRutbe(userId);
      if (__isBotCommandUsageLimitExemptRutbe(rutbe)) {
        return { allowed: true, skipped: true, reason: 'exempt_rutbe', rutbe };
      }

      const tierKey = __getLimitTierKeyFromRutbe(rutbe) || 'ucretsiz';
      const ensured = await ensureDmUserCommandUsageFile(userId, { now: new Date() });
      if (!ensured || !ensured.data) {
        return { allowed: true, skipped: true, reason: 'dm_usage_file_unavailable', rutbe, tierKey };
      }

      const data = ensured.data;
      const fieldMap = BOT_COMMAND_USAGE_FIELDS[tierKey];
      const limits = getBotCommandUsageLimits()[tierKey] || { daily: 0, monthly: 0 };

      let dailyUsed = __clampUsageValue(data[fieldMap.dailyUsed], 0, limits.daily, 0);
      let monthlyUsed = __clampUsageValue(data[fieldMap.monthlyUsed], 0, limits.monthly, 0);

      let dailyRemaining = Math.max(0, limits.daily - dailyUsed);
      let monthlyRemaining = Math.max(0, limits.monthly - monthlyUsed);

      const blockedBy = {
        daily: dailyRemaining <= 0,
        monthly: monthlyRemaining <= 0
      };

      if (blockedBy.daily || blockedBy.monthly) {
        const embed = createBotCommandUsageLimitExceededEmbed(guildId, userId, tierKey, {
          dailyUsed,
          dailyRemaining,
          monthlyUsed,
          monthlyRemaining
        }, blockedBy);

        await SafeLog.info('bot_komut_limit_engel', 'Günlük/aylık komut kullanım limiti dolu', {
          klasor: 'bot_genel',
          key: 'command_limit',
          kullaniciID: userId,
          sunucuID: guildId,
          rutbe,
          tierKey,
          dailyRemaining,
          monthlyRemaining,
          komut: interaction?.commandName || null,
          traceID: traceId,
          sendToConsole: false
        }).catch(() => {});

        await sendBotCommandUsageLimitExceededResponse(interaction, embed);

        return {
          allowed: false,
          consumed: false,
          rutbe,
          tierKey,
          counters: { dailyUsed, dailyRemaining, monthlyUsed, monthlyRemaining },
          blockedBy
        };
      }

      dailyUsed += 1;
      monthlyUsed += 1;
      dailyRemaining = Math.max(0, limits.daily - dailyUsed);
      monthlyRemaining = Math.max(0, limits.monthly - monthlyUsed);

      data[fieldMap.dailyUsed] = dailyUsed;
      data[fieldMap.dailyRemaining] = dailyRemaining;
      data[fieldMap.monthlyUsed] = monthlyUsed;
      data[fieldMap.monthlyRemaining] = monthlyRemaining;
      data.sonGuncelleme = __createTimestampObject();
      data._metaSonGuncelleme = Date.now();

      const writeOk = await safeWriteJsonAtomic(ensured.filePath, data);
      if (!writeOk) {
        return { allowed: true, skipped: true, reason: 'write_failed', rutbe, tierKey };
      }

      return {
        allowed: true,
        consumed: true,
        rutbe,
        tierKey,
        filePath: ensured.filePath,
        counters: { dailyUsed, dailyRemaining, monthlyUsed, monthlyRemaining }
      };
    } catch (e) {
      await SafeLog.warn('bot_komut_limit_kontrol_hata', `Komut kullanım limiti kontrol hatası: ${e.message}`, {
        klasor: 'bot_genel',
        key: 'command_limit',
        traceID: traceId,
        sendToConsole: false
      }).catch(() => {});
      return { allowed: true, skipped: true, reason: 'exception' };
    }
  });
}

async function rollbackConsumedBotCommandUsageLimit(userId, consumeResult = null) {
  return __withBotCommandUsageFileLock(async () => {
    try {
      if (!userId || !consumeResult?.consumed || !consumeResult?.tierKey) return false;

      const tierKey = consumeResult.tierKey;
      const fieldMap = BOT_COMMAND_USAGE_FIELDS[tierKey];
      if (!fieldMap) return false;

      const ensured = await ensureDmUserCommandUsageFile(userId, { now: new Date() });
      if (!ensured || !ensured.data) return false;

      const data = ensured.data;
      const limits = getBotCommandUsageLimits()[tierKey] || { daily: 0, monthly: 0 };

      let dailyUsed = __clampUsageValue(data[fieldMap.dailyUsed], 0, limits.daily, 0);
      let monthlyUsed = __clampUsageValue(data[fieldMap.monthlyUsed], 0, limits.monthly, 0);

      dailyUsed = Math.max(0, dailyUsed - 1);
      monthlyUsed = Math.max(0, monthlyUsed - 1);

      data[fieldMap.dailyUsed] = dailyUsed;
      data[fieldMap.dailyRemaining] = Math.max(0, limits.daily - dailyUsed);
      data[fieldMap.monthlyUsed] = monthlyUsed;
      data[fieldMap.monthlyRemaining] = Math.max(0, limits.monthly - monthlyUsed);
      data.sonGuncelleme = __createTimestampObject();
      data._metaSonGuncelleme = Date.now();

      return await safeWriteJsonAtomic(ensured.filePath, data);
    } catch {
      return false;
    }
  });
}

async function normalizeAllDmCommandUsageFiles(opts = {}) {
  let changedCount = 0;

  try {
    await ensureDir(DM_VERILER_DIR);
    const files = await fsp.readdir(DM_VERILER_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(file => file.endsWith('.json') && !file.startsWith('.'));

    for (const file of jsonFiles) {
      try {
        const fp = path.join(DM_VERILER_DIR, file);
        const existing = await safeReadJson(fp).catch(() => null);
        if (!existing || typeof existing !== 'object') continue;

        const normalized = normalizeBotCommandUsageData(existing, opts);
        if (normalized?.changed) {
          await safeWriteJsonAtomic(fp, normalized.data);
          changedCount++;
        }
      } catch {}
    }
  } catch {}

  return changedCount;
}

async function tickBotCommandUsageLimitResetSystem() {
  if (globalTickBotCommandUsageRunning) return;
  globalTickBotCommandUsageRunning = true;

  try {
    const now = new Date();
    const turkeyNow = getTurkeyDateInfo(now);

    const firstSync = (__botCommandUsageLastDailyKey === null || __botCommandUsageLastMonthlyKey === null);
    const shouldCheckDaily = !firstSync && __botCommandUsageLastDailyKey !== turkeyNow.dayKey;
    const shouldCheckMonthly = !firstSync && __botCommandUsageLastMonthlyKey !== turkeyNow.monthKey;

    if (!firstSync && !shouldCheckDaily && !shouldCheckMonthly) return;

    const changedCount = await __withBotCommandUsageFileLock(async () => {
      return normalizeAllDmCommandUsageFiles({
        now,
        forceDailyReset: shouldCheckDaily,
        forceMonthlyReset: shouldCheckMonthly
      });
    });

    __botCommandUsageLastDailyKey = turkeyNow.dayKey;
    __botCommandUsageLastMonthlyKey = turkeyNow.monthKey;

    await SafeLog.info('bot_komut_limit_reset', 'DM komut kullanım limitleri senkronlandı/sıfırlandı', {
      klasor: 'bot_genel',
      key: 'command_limit',
      firstSync,
      dailyReset: shouldCheckDaily,
      monthlyReset: shouldCheckMonthly,
      changedCount,
      turkeyDate: turkeyNow.text,
      sendToConsole: false
    }).catch(() => {});
  } catch (e) {
    await SafeLog.warn('bot_komut_limit_reset_hata', `Komut limit reset tick hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'command_limit',
      sendToConsole: false
    }).catch(() => {});
  } finally {
    globalTickBotCommandUsageRunning = false;
  }
}

const SUNUCU_CONFIG_KORUNAN_ALANLAR_1S = [
  'EMBED_FOOTER',
  'EMBED_SETIMAGE',
  'EMBED_THUMBNAIL',
  'EMBED_COLOR',
  'ODALARIN_OLDUGU_KATEGORI_ID',
  'ODA_ACMA_VARSAYILAN_SANIYE',
  'ODA_AC_KANAL_ID',
  'KOMUTLAR_ICIN_ODA_AC_ZORUNLU',
  'ODA_AC_KATEGORI_ID',
  '_defaultlar_ilk_yazildi',
  'LOG_KANALI',
  'LOG_KATEGORI'
];

async function tickSunucuConfigDosyalari1S() {
  if (globalTickSunucuConfigRunning) return;
  globalTickSunucuConfigRunning = true;

  try {
    if (!client || !client.isReady()) return;

    const ts = __createTimestampObject();
    const guilds = Array.from(client.guilds.cache.values());
    if (guilds.length === 0) return;

    for (const guild of guilds) {
      try {
        const guildId = guild?.id;
        if (!guildId) continue;

        const filePath = path.join(SUNUCU_VERILER_DIR, `${guildId}.json`);
        if (!fs.existsSync(filePath)) continue;

        const existing = await safeReadJson(filePath).catch(() => null);
        if (!existing || typeof existing !== 'object') continue;

        // Korunan alanları snapshot al (mevcut değerler korunacak)
        const korunacak = {};
        for (const k of SUNUCU_CONFIG_KORUNAN_ALANLAR_1S) {
          if (typeof existing[k] !== 'undefined') korunacak[k] = existing[k];
        }

        // Hafif güncelleme
        existing.sonGuncelleme = ts;
        existing._metaSonGuncelleme = ts.unix;

        if (existing.sunucuAdi && typeof existing.sunucuAdi === 'object') {
          existing.sunucuAdi.deger = guild.name;
          existing.sunucuAdi.veri_cekilme_zamani = ts.tam;
          existing.sunucuAdi.guncelleme = ts;
        }

        if (existing.ikon && typeof existing.ikon === 'object') {
          existing.ikon.deger = guild.iconURL?.({ dynamic: true, size: 512 }) || null;
          existing.ikon.veri_cekilme_zamani = ts.tam;
          existing.ikon.guncelleme = ts;
        }

        if (existing.banner && typeof existing.banner === 'object') {
          existing.banner.deger = guild.bannerURL?.({ size: 1024 }) || null;
          existing.banner.veri_cekilme_zamani = ts.tam;
          existing.banner.guncelleme = ts;
        }

        if (existing.uyeSayisi && typeof existing.uyeSayisi === 'object') {
          existing.uyeSayisi.deger = typeof guild.memberCount === 'number' ? guild.memberCount : existing.uyeSayisi.deger;
          existing.uyeSayisi.veri_cekilme_zamani = ts.tam;
          existing.uyeSayisi.guncelleme = ts;
        }

        if (existing.boostSeviyesi && typeof existing.boostSeviyesi === 'object') {
          existing.boostSeviyesi.deger = guild.premiumTier || 0;
          existing.boostSeviyesi.veri_cekilme_zamani = ts.tam;
          existing.boostSeviyesi.guncelleme = ts;
        }

        if (existing.boostSayisi && typeof existing.boostSayisi === 'object') {
          existing.boostSayisi.deger = guild.premiumSubscriptionCount || 0;
          existing.boostSayisi.veri_cekilme_zamani = ts.tam;
          existing.boostSayisi.guncelleme = ts;
        }

        if (existing.bolge && typeof existing.bolge === 'object') {
          existing.bolge.deger = guild.preferredLocale || null;
          existing.bolge.veri_cekilme_zamani = ts.tam;
          existing.bolge.guncelleme = ts;
        }

        // Korunan alanları geri yaz (overwrite engeli)
        for (const [k, v] of Object.entries(korunacak)) {
          existing[k] = v;
        }

        // Atomic yaz
        await safeWriteJsonAtomic(filePath, existing);
      } catch {
        // Sessiz
      }
    }
  } finally {
    globalTickSunucuConfigRunning = false;
  }
}


async function tickDmConfigDosyalariConfigurable() {
  // DM verileri bazı kurulumlarda .js olabilir; bozmamak için sadece .json dosyalarına hafif touch uygulanır.
  try {
    if (!client || !client.isReady()) return;

    await ensureDir(DM_VERILER_DIR);

    const files = await fsp.readdir(DM_VERILER_DIR).catch(() => []);
    const jsonFiles = (files || []).filter(f => f.endsWith('.json') && !f.startsWith('.'));

    if (jsonFiles.length === 0) return;

    const ts = __createTimestampObject();

    for (const file of jsonFiles) {
      try {
        const fp = path.join(DM_VERILER_DIR, file);
        const existing = await safeReadJson(fp).catch(() => null);
        if (!existing || typeof existing !== 'object') continue;

        const normalizedUsage = normalizeBotCommandUsageData(existing, { now: new Date() });
        const nextData = (normalizedUsage && normalizedUsage.data && typeof normalizedUsage.data === 'object')
          ? normalizedUsage.data
          : existing;

        // Sadece meta/timestamp alanlarını hafifçe güncelle
        nextData.sonGuncelleme = ts;
        nextData._metaSonGuncelleme = ts.unix;

        await safeWriteJson(fp, nextData);
      } catch {}
    }
  } catch {}
}



async function tick1saniye_global_tick_geri_sayim_mekanizmasi() {
  if (globalStateTickRunning) return;
  globalStateTickRunning = true;

  try {
    // Yardım (mevcut davranış korunur)
    await tickYardimKomutuStates();
    // IP state (dosya tabanlı)
    await tickIpKomutuStates();
    // State alt klasörleri (muaflar hariç) - IP mekanizmasına bağlı
    await tickStateAltKlasorleriGenel();
    // Komut Rate Limit (dosya tabanlı)
    await tickRateLimitKontrol();
    // Günlük/Aylık bot komut kullanım limit reset/senkronizasyonu (DM json tabanlı)
    await tickBotCommandUsageLimitResetSystem();
    // Sunucu/DM config dosyalarını config.json'daki saniye değerlerine göre hafif şekilde güncelle
    if (__shouldRunSunucuTouch()) {
      __lastSunucuVerilerTouchAt = Date.now();
      await tickSunucuConfigDosyalari1S();
    }
    if (__shouldRunDmTouch()) {
      __lastDmVerilerTouchAt = Date.now();
      await tickDmConfigDosyalariConfigurable();
    }
    // Tick tabanlı cop temizlik + self-test
    await tickCopTemizlikVeSelfTest();

} finally {
    globalStateTickRunning = false;
  }
}

async function start1saniye_global_tick_geri_sayim_mekanizmasi() {
  if (globalStateTickAktif) return;

  await ensureDir(YARDIM_STATE_DIR);
  await ensureDir(IP_STATE_DIR);
  await ensureDir(COP_TEMIZLIK_DIR);
  await ensureDir(RATE_LIMIT_KONTROL_DIR);
  await ensureRateLimitKontrolFile();

  // Bot restart/baslangic: IP komutu sonuc dosyalarini state'ten tek sefer rebuild et
  await rebuildIpSonucFilesOnce();

  // IP komutu: restart sonrası yarım kalan state'leri süre dolmuş gibi işaretle
  await __ipStateBulkMarkAndDisable('restart');

  // Genel (muaf olmayan) state klasörleri: restart sonrası yarım kalanları işaretle
  await __genericStateBulkMarkAndDisable('restart');

  globalStateTickAktif = true;

  await SafeLog.info('1saniye_global_tick_basladi', 'Yardım state tick sistemi başlatıldı', {
    klasor: 'yardim_state',
    key: 'startup',
    tick_ms: GLOBAL_STATE_TICK_INTERVAL_MS
  }).catch(() => {});

  globalStateTickIntervalId = setInterval(async () => {
    await tick1saniye_global_tick_geri_sayim_mekanizmasi();
  }, GLOBAL_STATE_TICK_INTERVAL_MS);
}

function stop1saniye_global_tick_geri_sayim_mekanizmasi() {
  if (globalStateTickIntervalId) {
    clearInterval(globalStateTickIntervalId);
    globalStateTickIntervalId = null;
  }
  globalStateTickAktif = false;
  SafeLog.info('1saniye_global_tick_durduruldu', 'Yardım state tick sistemi durduruldu', {
    klasor: 'yardim_state',
    key: 'shutdown'
  }).catch(() => {});
}


async function getCopTemizlikStats() {
  try {
    if (!fs.existsSync(COP_TEMIZLIK_DIR)) {
      return {
        dosya_sayisi: 0,
        toplam_boyut: 0,
        toplam_boyut_kb: '0.00',
        toplam_boyut_mb: '0.00',
        sonTemizlik: 'Henüz yapılmadı',
        nextCleanup: getCopTemizlikNextTime()
      };
    }

    const dosyalar = await fsp.readdir(COP_TEMIZLIK_DIR);
    let toplamBoyut = 0;

    for (const dosya of dosyalar) {
      try {
        const yol = path.join(COP_TEMIZLIK_DIR, dosya);
        const stats = await fsp.stat(yol);
        if (stats.isFile()) {
          toplamBoyut += stats.size;
        }
      } catch {
      }
    }

    return {
      dosya_sayisi: dosyalar.length,
      toplam_boyut: toplamBoyut,
      toplam_boyut_kb: (toplamBoyut / 1024).toFixed(2),
      toplam_boyut_mb: (toplamBoyut / 1024 / 1024).toFixed(2),
      sonTemizlik: copTemizlikSonZamani ? new Date(copTemizlikSonZamani).toISOString() : 'Henüz yapılmadı',
      nextCleanup: getCopTemizlikNextTime()
    };
  } catch (err) {
    return {
      error: err.message,
      dosya_sayisi: 0,
      toplam_boyut:  0
    };
  }
}

// ==================== ENSUREDİR ====================

async function ensureDir(dirPath) {
  try {
    await fsp.mkdir(dirPath, { recursive: true });
    return true;
  } catch (err) {
    console.error(`[SİSTEM] Dizin oluşturulamadı: ${dirPath}`, err.message);
    return false;
  }
}

// ==================== DİZİN OLUŞTURMA ====================

async function ensureDirs() {
  const dirs = [
    LOGLAR_ROOT,
    path.join(LOGLAR_ROOT, 'sunucular'),
    path.join(LOGLAR_ROOT, 'dm'),
    path.join(LOGLAR_ROOT, 'bot_genel'),
    path.join(LOGLAR_ROOT, 'database'),
    path.join(LOGLAR_ROOT, 'oda_sistem'),
    path.join(LOGLAR_ROOT, 'log_kalici_arsiv'),
    
    CACHE_DIR,
    
    UCRETSIZ_KOMUTLAR_DIR,
    OWNER_KOMUT_DIR,
    ADMIN_KOMUT_DIR,
    
    RUTBE_DIR,
    VIP_DIR,
    PREMIUM_DIR,
    VIP_KOMUT_DIR,
    
    PREMIUM_KOMUT_DIR,
    
    
    SUNUCU_DM_VERILER_DIR,
    SUNUCU_VERILER_DIR,
    DM_VERILER_DIR,
    
    COP_TEMIZLIK_DIR,
    path.join(process.cwd(), 'state'),
    YARDIM_STATE_DIR,
    IP_STATE_DIR
  ];

  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
	  
    } catch (e) {
      if (e.code !== 'EEXIST') {
        await SafeLog.warn('dir_create_error', `Dizin oluşturulamadı: ${dir}`, {
          klasor: 'bot_genel',
          key:  'startup'
        });
      }
    }
  }
    // Bakım sistem dizinlerini hazırla
  await ensureBakimDirs();

  await ensureYetkiliFiles();

  await ensureYetkiKontrolFiles();

  try {
    if (!fs.existsSync(ADMINLER_DOSYA)) {
      await fsp.writeFile(ADMINLER_DOSYA, JSON.stringify({ admins: [] }, null, 2), 'utf8');
    }
  } catch (e) {
  }

  try {
    if (!fs.existsSync(COMMAND_SIGNATURE_FILE)) {
      await fsp.writeFile(COMMAND_SIGNATURE_FILE, JSON.stringify({ commands: {}, lastUpdate: 0 }, null, 2), 'utf8');
    }
  } catch (e) {
  }

  if (VeriYonetim && typeof VeriYonetim.ensureDirs === 'function') {
    try {
      await VeriYonetim.ensureDirs();
    } catch (e) {
    }
  }

  if (LogYonetim && typeof LogYonetim.ensureLogDirs === 'function') {
    try {
      await LogYonetim.ensureLogDirs();
    } catch (e) {
    }
  }

  await SafeLog.info('dirs_ready', 'Dizinler hazır', {
    klasor: 'bot_genel',
    key: 'startup'
  });
}

async function ensureYetkiliFiles() {
  const files = [
    {
      path: VIP_YETKILI_FILE,
      dir: BASE_DIR,
      content: { vip_uyeler: [] }
    },
    {
      path: PREMIUM_YETKILI_FILE,
      dir: BASE_DIR,
      content: { premium_uyeler: [] }
    }
  ];

  for (const file of files) {
    try {
      await fsp.mkdir(file.dir, { recursive: true });

      if (! fs.existsSync(file.path)) {
        await fsp.writeFile(file.path, JSON.stringify(file.content, null, 2), 'utf8');
      }
    } catch (e) {
    }
  }
}

// ==================== YETKİ SİSTEMİ ====================
//
// Yeni Mantık (2026):
// - Root dosyaları SADE formatta tutulur:
//   adminler.json -> { "admins": [] }
//   vip_yetkili_kisiler.json -> { "vip_uyeler": [] }
//   premium_yetkili_kisiler.json -> { "premium_uyeler": [] }
// - Zaman/durum bilgisi olan kontrol dosyaları root dizindeki
//   bot_yetki_kontrol_dosyalar klasöründen okunur:
//   vip_yetkililer.json, premium_yetkililer.json, admin_yetkililer.json
// - Her 1 saniyede bir kontrol edilir:
//   * Kontrol dosyasında baslangic/bitis aralığına göre durum güncellenir (aktif/pasif)
//   * Durumu aktif olan kullanıcılar ilgili root yetki dosyasına eklenir
//   * Kontrol dosyasında olmayan veya pasif olanlar root yetki dosyasından kaldırılır
//   * Eski veriler korunur (dosya sıfırlanmaz), sadece gerekli ekleme/çıkarma yapılır

let vipFileWatcher = null;
let premiumFileWatcher = null;
let adminFileWatcher = null;

let vipKontrolWatcher = null;
let premiumKontrolWatcher = null;
let adminKontrolWatcher = null;

let yetkiKontrolIntervalId = null;
let yetkiKontrolTickRunning = false;

// -------------------- JSON IO (safe) --------------------

async function safeReadJson(filePath, fallbackObj = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallbackObj;
    const raw = await fsp.readFile(filePath, 'utf8');
    const txt = (raw || '').trim();
    if (!txt) return fallbackObj;
    return JSON.parse(txt);
  } catch (e) {
    return fallbackObj;
  }
}

async function safeWriteJsonAtomic(filePath, dataObj) {
  try {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });

    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const jsonStr = JSON.stringify(dataObj, null, 2);

    await fsp.writeFile(tmp, jsonStr, 'utf8');
    await fsp.rename(tmp, filePath);
    return true;
  } catch (e) {
    return false;
  }
}

function parseTsMaybe(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : fallback;
}

function parseDateWindowValue(v) {
  if (v === null || v === undefined || v === '') {
    return { hasValue: false, valid: true, value: null };
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    return { hasValue: true, valid: true, value: v };
  }

  const t = Date.parse(String(v));
  if (Number.isFinite(t)) {
    return { hasValue: true, valid: true, value: t };
  }

  return { hasValue: true, valid: false, value: null };
}

function normalizeYetkiDurumValue(v, defaultValue = 'aktif') {
  if (v === null || v === undefined || String(v).trim() === '') {
    return defaultValue;
  }

  const s = String(v).trim().toLowerCase();
  if (['aktif', 'active', '1', 'true', 'evet', 'on', 'enabled'].includes(s)) return 'aktif';
  if (['pasif', 'passive', '0', 'false', 'hayir', 'hayır', 'off', 'disabled'].includes(s)) return 'pasif';
  return defaultValue;
}

function normalizeControlFileData(json, roleKeyHint) {
  // Desteklenen formatlar:
  // 1) Dosyanın kendisi array: [ {kullaniciId, baslangic, bitis, durum}, ... ]
  // 2) Obje içinde array: { yetkililer: [...] } veya { vip_yetkililer: [...] } vb.
  let containerType = 'object';
  let listKey = null;
  let list = [];

  if (Array.isArray(json)) {
    containerType = 'array';
    list = json;
  } else if (json && typeof json === 'object') {
    const candidates = [
      roleKeyHint,
      'yetkililer',
      'uyeler',
      'list',
      'data',
      'users'
    ].filter(Boolean);

    for (const k of candidates) {
      if (Array.isArray(json[k])) {
        listKey = k;
        list = json[k];
        break;
      }
    }

    if (!listKey) {
      for (const [k, v] of Object.entries(json)) {
        if (Array.isArray(v)) {
          listKey = k;
          list = v;
          break;
        }
      }
    }

    if (!Array.isArray(list)) list = [];
  } else {
    list = [];
  }

  return { containerType, listKey, list };
}

function buildControlFilePayload(containerType, listKey, list, roleKeyHint) {
  if (containerType === 'array') return list;
  const key = listKey || roleKeyHint || 'yetkililer';
  return { [key]: list };
}

// -------------------- Dosya ensure --------------------

async function ensureYetkiKontrolFiles() {
  await ensureDir(BOT_YETKI_KONTROL_DIR);

  const defaults = [
    { file: VIP_KONTROL_FILE, payload: { vip_yetkililer: [] } },
    { file: PREMIUM_KONTROL_FILE, payload: { premium_yetkililer: [] } },
    { file: ADMIN_KONTROL_FILE, payload: { admin_yetkililer: [] } }
  ];

  for (const d of defaults) {
    try {
      if (!fs.existsSync(d.file)) {
        await safeWriteJsonAtomic(d.file, d.payload);
      }
    } catch {}
  }
}

// -------------------- Watchers (cache invalidation) --------------------

function startYetkiFileWatchers() {
  const watch = (filePath, onChange) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const w = fs.watch(filePath, { persistent: false }, () => onChange());
      w.on('error', () => {});
      return w;
    } catch {
      return null;
    }
  };

  // Root sade dosyalar
  vipFileWatcher = watch(VIP_YETKILI_FILE, () => { yetkiCache.vip.lastUpdate = 0; });
  premiumFileWatcher = watch(PREMIUM_YETKILI_FILE, () => { yetkiCache.premium.lastUpdate = 0; });
  adminFileWatcher = watch(ADMINLER_DOSYA, () => { yetkiCache.admins.lastUpdate = 0; });

  // Kontrol dosyaları (tick zaten periyodik, sadece "ani" değişimlerde cache'i bozalım)
  vipKontrolWatcher = watch(VIP_KONTROL_FILE, () => { forceRefreshYetkiCache(); });
  premiumKontrolWatcher = watch(PREMIUM_KONTROL_FILE, () => { forceRefreshYetkiCache(); });
  adminKontrolWatcher = watch(ADMIN_KONTROL_FILE, () => { forceRefreshYetkiCache(); });
}

function stopYetkiFileWatchers() {
  const close = (w) => { try { w?.close(); } catch {} };
  close(vipFileWatcher); vipFileWatcher = null;
  close(premiumFileWatcher); premiumFileWatcher = null;
  close(adminFileWatcher); adminFileWatcher = null;

  close(vipKontrolWatcher); vipKontrolWatcher = null;
  close(premiumKontrolWatcher); premiumKontrolWatcher = null;
  close(adminKontrolWatcher); adminKontrolWatcher = null;
}

// -------------------- Root sade dosyalar (read/write) --------------------

async function readRootYetkiList(role) {
  if (role === 'vip') {
    const j = await safeReadJson(VIP_YETKILI_FILE, { vip_uyeler: [] });
    const arr = Array.isArray(j.vip_uyeler) ? j.vip_uyeler : [];
    return arr.map(x => String(x)).filter(Boolean);
  }
  if (role === 'premium') {
    const j = await safeReadJson(PREMIUM_YETKILI_FILE, { premium_uyeler: [] });
    const arr = Array.isArray(j.premium_uyeler) ? j.premium_uyeler : [];
    return arr.map(x => String(x)).filter(Boolean);
  }
  if (role === 'admins') {
    const j = await safeReadJson(ADMINLER_DOSYA, { admins: [] });
    const arr = Array.isArray(j.admins) ? j.admins : [];
    return arr.map(x => String(x)).filter(Boolean);
  }
  return [];
}

async function writeRootYetkiList(role, ids) {
  const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map(x => String(x)).filter(Boolean)));

  if (role === 'vip') {
    return safeWriteJsonAtomic(VIP_YETKILI_FILE, { vip_uyeler: unique });
  }
  if (role === 'premium') {
    return safeWriteJsonAtomic(PREMIUM_YETKILI_FILE, { premium_uyeler: unique });
  }
  if (role === 'admins') {
    return safeWriteJsonAtomic(ADMINLER_DOSYA, { admins: unique });
  }
  return false;
}

// -------------------- Kontrol dosyaları (tick) --------------------

async function evaluateAndMaybeUpdateControlFile(filePath, roleKeyHint) {
  const now = Date.now();

  const json = await safeReadJson(filePath, buildControlFilePayload('object', roleKeyHint, [], roleKeyHint));
  const { containerType, listKey, list } = normalizeControlFileData(json, roleKeyHint);

  const normalized = [];
  const activeIds = [];
  let changed = false;

  for (const item of (Array.isArray(list) ? list : [])) {
    let uid = '';
    if (typeof item === 'string') uid = item;
    else if (item && typeof item === 'object') uid = String(item.kullaniciId || item.userId || item.id || '').trim();
    if (!uid) continue;

    const rawStart = (item && typeof item === 'object')
      ? (item.baslangic ?? item.baslangicZamani ?? item.startAt ?? item.start ?? item.baslangic_ts)
      : null;
    const rawEnd = (item && typeof item === 'object')
      ? (item.bitis ?? item.bitisZamani ?? item.endAt ?? item.end ?? item.bitis_ts)
      : null;

    const startInfo = parseDateWindowValue(rawStart);
    const endInfo = parseDateWindowValue(rawEnd);

    const manualDurum = normalizeYetkiDurumValue(
      (item && typeof item === 'object') ? (item.durum ?? item.status) : null,
      'aktif'
    );

    const tarihFormatGecerli = startInfo.valid && endInfo.valid;
    const tarihSirasiGecerli =
      !startInfo.hasValue ||
      !endInfo.hasValue ||
      (startInfo.value < endInfo.value);

    const baslangicUygun = !startInfo.hasValue || (startInfo.valid && now >= startInfo.value);
    const bitisUygun = !endInfo.hasValue || (endInfo.valid && now < endInfo.value);

    const tarihlerAktifIcinUygun = tarihFormatGecerli && tarihSirasiGecerli && baslangicUygun && bitisUygun;
    const computed = (manualDurum === 'aktif' && tarihlerAktifIcinUygun) ? 'aktif' : 'pasif';

    const prevDurum = normalizeYetkiDurumValue(
      (item && typeof item === 'object') ? (item.durum ?? item.status) : null,
      ''
    );

    if (typeof item === 'string') changed = true;
    if (prevDurum !== computed) changed = true;

    const rec = {
      ...(item && typeof item === 'object' && !Array.isArray(item) ? item : {}),
      kullaniciId: uid,
      baslangic: startInfo.hasValue && startInfo.valid ? startInfo.value : null,
      bitis: endInfo.hasValue && endInfo.valid ? endInfo.value : null,
      durum: computed
    };

    normalized.push(rec);
    if (computed === 'aktif') activeIds.push(uid);
  }

  if (changed) {
    const payload = buildControlFilePayload(containerType, listKey, normalized, roleKeyHint);
    await safeWriteJsonAtomic(filePath, payload);
  }

  return { activeIds, normalizedCount: normalized.length, changed };
}

async function syncRootWithControl(role, activeIds) {
  const existing = await readRootYetkiList(role);

  const activeSet = new Set(activeIds.map(x => String(x)));
  const next = [];

  for (const id of existing) {
    if (activeSet.has(id)) next.push(id);
  }
  for (const id of activeIds) {
    const sid = String(id);
    if (!next.includes(sid)) next.push(sid);
  }

  const same = existing.length === next.length && existing.every((v, i) => v === next[i]);
  if (!same) {
    await writeRootYetkiList(role, next);
  }

  if (role === 'vip') {
    yetkiCache.vip.data = next;
    yetkiCache.vip.lastUpdate = Date.now();
  } else if (role === 'premium') {
    yetkiCache.premium.data = next;
    yetkiCache.premium.lastUpdate = Date.now();
  } else if (role === 'admins') {
    yetkiCache.admins.data = next;
    yetkiCache.admins.lastUpdate = Date.now();
  }

  return { changed: !same, count: next.length };
}

async function tickYetkiKontrol() {
  if (yetkiKontrolTickRunning) return;
  yetkiKontrolTickRunning = true;

  try {
    await ensureYetkiKontrolFiles();

    const vip = await evaluateAndMaybeUpdateControlFile(VIP_KONTROL_FILE, 'vip_yetkililer');
    const prem = await evaluateAndMaybeUpdateControlFile(PREMIUM_KONTROL_FILE, 'premium_yetkililer');
    const adm = await evaluateAndMaybeUpdateControlFile(ADMIN_KONTROL_FILE, 'admin_yetkililer');

    await syncRootWithControl('vip', vip.activeIds);
    await syncRootWithControl('premium', prem.activeIds);
    await syncRootWithControl('admins', adm.activeIds);
  } catch (e) {
    // tick spam olmasın diye log basmıyoruz
  } finally {
    yetkiKontrolTickRunning = false;
  }
}

function startYetkiKontrolTick() {
  if (yetkiKontrolIntervalId) return;

  yetkiKontrolIntervalId = setInterval(() => {
    tickYetkiKontrol().catch(() => {});
  }, YETKI_KONTROL_TICK_MS);

  tickYetkiKontrol().catch(() => {});
}

function stopYetkiKontrolTick() {
  if (yetkiKontrolIntervalId) {
    clearInterval(yetkiKontrolIntervalId);
    yetkiKontrolIntervalId = null;
  }
}

// -------------------- Yetki sorgu API (komutların kullandığı) --------------------

function refreshYetkiliCache(rutbeTipi) {
  const now = Date.now();
  const cache = yetkiCache[rutbeTipi];
  if (!cache) return [];

  // Tick zaten 1 saniye; burada da cache TTL'yi 1s'e sabitle
  cache.ttl = 1000;

  if (cache.data.length > 0 && (now - cache.lastUpdate) < cache.ttl) {
    return cache.data;
  }

  let filePath = null;
  let jsonKey = null;

  if (rutbeTipi === 'vip') {
    filePath = VIP_YETKILI_FILE;
    jsonKey = 'vip_uyeler';
  } else if (rutbeTipi === 'premium') {
    filePath = PREMIUM_YETKILI_FILE;
    jsonKey = 'premium_uyeler';
  } else if (rutbeTipi === 'admins') {
    filePath = ADMINLER_DOSYA;
    jsonKey = 'admins';
  } else {
    return [];
  }

  try {
    if (!fs.existsSync(filePath)) {
      cache.data = [];
      cache.lastUpdate = now;
      return [];
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse((raw || '{}').trim() || '{}');
    const list = Array.isArray(json[jsonKey]) ? json[jsonKey] : [];

    cache.data = list.map(x => String(x)).filter(Boolean);
    cache.lastUpdate = now;
    return cache.data;
  } catch {
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
  return vipUsers.includes(String(userId));
}

function isPremiumUser(userId) {
  const premiumUsers = getYetkiliKullanicilar('premium');
  return premiumUsers.includes(String(userId));
}

function isAdminUser(userId) {
  const admins = getYetkiliKullanicilar('admins');
  return admins.includes(String(userId));
}

function getUserRutbe(userId) {
  // Rutbe hiyerarşisi (2026):
  // owner > admin > vip > premium > ucretsiz
  // Not: ucretsiz kullanıcılar için ekstra dosya yoktur; listelerde yoksa "ucretsiz" kabul edilir.
  if (isOwner(userId)) return 'owner';

  // Admin listesi (root adminler.json) - sync cache üzerinden
  if (isAdminUser(userId)) return 'admin';

  const isVip = isVipUser(userId);
  const isPremium = isPremiumUser(userId);

  // VIP, Premium'dan üst olduğu için her iki yetki varsa VIP say.
  if (isVip) return 'vip';
  if (isPremium) return 'premium';
  return 'ucretsiz';
}

function canUseVipCommand(userId) {
  // VIP komutları: owner, admin, vip
  return isOwner(userId) || isAdminUser(userId) || isVipUser(userId);
}

function canUsePremiumCommand(userId) {
  // Premium komutları: owner, admin, vip, premium
  // (VIP kullanıcıları premium komutları da kullanabilir.)
  return isOwner(userId) || isAdminUser(userId) || isVipUser(userId) || isPremiumUser(userId);
}

function forceRefreshYetkiCache() {
  yetkiCache.vip.lastUpdate = 0;
  yetkiCache.premium.lastUpdate = 0;
  yetkiCache.admins.lastUpdate = 0;
}


// ==================== BAKIM KOMUTU SİSTEMİ ====================

const BAKIM_KOMUTLAR_DIR = path.join(BASE_DIR, 'bakim_komutlar');
const BAKIM_YETKILI_FILE = path.join(BASE_DIR, 'bakim_yetkili_kisiler.json');

let bakimKomutlarCache = [];
let bakimYetkililerCache = [];
let bakimCacheLastUpdate = 0;
const BAKIM_CACHE_TTL = 30000; // 30 saniye

/**
 * Bakımda olan komutları oku ve cache'e kaydet
 * @returns {Array<string>}
 */
function getBakimdaKomutlar() {
  const now = Date.now();
  if (bakimKomutlarCache.length > 0 && (now - bakimCacheLastUpdate) < BAKIM_CACHE_TTL) {
    return bakimKomutlarCache;
  }

  try {
    if (!fs.existsSync(BAKIM_KOMUTLAR_DIR)) {
      fs.mkdirSync(BAKIM_KOMUTLAR_DIR, { recursive: true });
      bakimKomutlarCache = [];
      bakimCacheLastUpdate = now;
      return [];
    }

    const files = fs.readdirSync(BAKIM_KOMUTLAR_DIR);
    bakimKomutlarCache = files
      .filter(f => f.endsWith('.js'))
      .map(f => path.basename(f, '.js'));
    
    bakimCacheLastUpdate = now;
    return bakimKomutlarCache;
  } catch (e) {
    SafeLog.warn('bakim_komutlar_oku_hatasi', `Bakım komutları okunamadı: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'bakim'
    });
    return [];
  }
}

/**
 * Bakım yetkililerini oku
 * @returns {Array<string>}
 */
function getBakimYetkililer() {
  const now = Date.now();
  if (bakimYetkililerCache.length > 0 && (now - bakimCacheLastUpdate) < BAKIM_CACHE_TTL) {
    return bakimYetkililerCache;
  }

  try {
    if (!fs.existsSync(BAKIM_YETKILI_FILE)) {
      const defaultData = { bakim_ekibi_id: [] };
      fs.writeFileSync(BAKIM_YETKILI_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
      bakimYetkililerCache = [];
      bakimCacheLastUpdate = now;
      return [];
    }

    const data = fs.readFileSync(BAKIM_YETKILI_FILE, 'utf8');
    const json = JSON.parse(data);
    bakimYetkililerCache = Array.isArray(json.bakim_ekibi_id) ? json.bakim_ekibi_id : [];
    
    bakimCacheLastUpdate = now;
    return bakimYetkililerCache;
  } catch (e) {
    SafeLog.warn('bakim_yetkili_oku_hatasi', `Bakım yetkililer okunamadı: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'bakim'
    });
    return [];
  }
}

/**
 * Komut bakımda mı kontrol et
 * @param {string} commandName
 * @returns {boolean}
 */
function isCommandBakimda(commandName) {
  const bakimdaKomutlar = getBakimdaKomutlar();
  return bakimdaKomutlar.includes(commandName);
}

/**
 * Bakım yetkilisi mi kontrol et (Owner ve Bakım Ekibi)
 * @param {string} userId
 * @returns {boolean}
 */
function isBakimYetkilisi(userId) {
  const bakimYetkili = getBakimYetkililer();
  return isOwner(userId) || bakimYetkili.includes(userId);
}

/**
 * Bakım komutları cache'ini temizle (dinamik güncelleme)
 */
function forceRefreshBakimCache() {
  bakimKomutlarCache = [];
  bakimYetkililerCache = [];
  bakimCacheLastUpdate = 0;
}

/**
 * Bakım komut klasörünün dizin yapısını sağla
 */
async function ensureBakimDirs() {
  try {
    await fsp.mkdir(BAKIM_KOMUTLAR_DIR, { recursive: true });
    
    if (!fs.existsSync(BAKIM_YETKILI_FILE)) {
      await fsp.writeFile(
        BAKIM_YETKILI_FILE,
        JSON.stringify({ bakim_ekibi_id: [] }, null, 2),
        'utf8'
      );
    }

    await SafeLog.info('bakim_dizinler_ready', 'Bakım sistem dizinleri hazır', {
      klasor: 'bot_genel',
      key: 'bakim'
    });
  } catch (e) {
    await SafeLog.error('bakim_dizin_hatasi', `Bakım dizin oluşturma hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'bakim'
    });
  }
}

// ==================== ADMIN SİSTEMİ ====================

async function getAdmins() {
  // Admin listesi root dizindeki sade adminler.json içinden okunur:
  // { "admins": ["id1","id2", ...] }
  // Bu fonksiyon ARTIK adminler.json'u zaman/durum objeleriyle overwrite etmez.
  try {
    const admins = refreshYetkiliCache('admins'); // sync okur, cache'i günceller
    return Array.isArray(admins) ? admins.map(x => String(x)) : [];
  } catch {
    return [];
  }
}

function isOwner(userId) {
  return BOT_OWNER_ID && userId === BOT_OWNER_ID;
}

async function isAdmin(userId) {
  try {
    const admins = await getAdmins();
    return admins.includes(String(userId));
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
  const cached = sunucuConfigCache.get(guildId);

  // 🔥 ÖNEMLİ:
  // Bu fonksiyon artık sadece TTL'e güvenmez.
  // Sunucu config dosyası bot çalışırken değişirse (true/false vb. manuel düzeltmeler)
  // restart gerektirmeden algılamak için dosyanın mtimeMs değerine göre cache invalidation yapar.

  const normalizeBos = (val) => {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'bos' || low === 'boş' || low === 'null' || low === 'none' || low === 'undefined') return null;
    return val;
  };

  const parseBooleanLike = (val, def = false) => {
    if (val === undefined || val === null || val === '') return def;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    const s = String(val).trim().toLowerCase();
    if (['1', 'true', 'evet', 'yes', 'on', 'aktif', 'enabled'].includes(s)) return true;
    if (['0', 'false', 'hayir', 'hayır', 'no', 'off', 'pasif', 'disabled'].includes(s)) return false;
    return def;
  };

  const parsePositiveInt = (val, def) => {
    const v = normalizeBos(val);
    if (v === null) return def;
    const n = Number(String(v).trim());
    if (!Number.isFinite(n)) return def;
    const i = Math.floor(n);
    return i > 0 ? i : def;
  };

  const parseId = (val) => {
    const v = normalizeBos(val);
    if (v === null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };

  const parseIdList = (val) => {
    const v = normalizeBos(val);
    if (v === null) return [];
    if (Array.isArray(v)) {
      return v
        .map(x => String(x).trim())
        .filter(Boolean)
        .filter(x => x.toLowerCase() !== 'bos' && x.toLowerCase() !== 'boş');
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return [];
      if (s.toLowerCase() === 'bos' || s.toLowerCase() === 'boş') return [];
      return s.split(',').map(x => x.trim()).filter(Boolean);
    }
    return [];
  };

  const parseEmbedColor = (val) => {
    const v = normalizeBos(val);
    if (v === null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = String(v).trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low.startsWith('#')) {
      const n = parseInt(low.slice(1), 16);
      return Number.isFinite(n) ? n : null;
    }
    // '0xffffff' / '0xFFFFFF' veya normal number string
    const n = Number(low);
    return Number.isFinite(n) ? n : null;
  };

  // mtime check: config dosyası değiştiyse cache'i anında yenile.
  try {
    const configPath = path.join(SUNUCU_VERILER_DIR, `${guildId}.json`);
    const st = fs.existsSync(configPath) ? fs.statSync(configPath) : null;
    if (!st || !st.isFile()) {
      if (cached && cached.source === 'missing' && (now - cached.lastUpdate) < CONFIG_CACHE_TTL) {
        return cached.config;
      }
      const defaultConfig = {
        KOMUTLAR_ICIN_ODA_AC_ZORUNLU: false,
        ODA_AC_KANAL_ID: [],
        ODA_AC_KATEGORI_ID: null,
        ODALARIN_OLDUGU_KATEGORI_ID: null,
        ODA_ACMA_VARSAYILAN_SANIYE: 600,
        EMBED_FOOTER: null,
        EMBED_SETIMAGE: null,
        EMBED_COLOR: null,
        EMBED_THUMBNAIL: null,
        LOG_KANALI: null,
        sahip: { deger: { id: null } }
      };
      sunucuConfigCache.set(guildId, { config: defaultConfig, lastUpdate: now, mtimeMs: 0, size: 0, source: 'missing' });
      return defaultConfig;
    }

    if (cached && cached.mtimeMs && cached.size !== undefined && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.config;
    }
  } catch {
    if (cached && cached.config) return cached.config;
  }

  const defaultConfig = {
    KOMUTLAR_ICIN_ODA_AC_ZORUNLU: false,
    ODA_AC_KANAL_ID: [],
    ODA_AC_KATEGORI_ID: null,
    ODALARIN_OLDUGU_KATEGORI_ID: null,
    ODA_ACMA_VARSAYILAN_SANIYE: 600,
    EMBED_FOOTER:  null,
    EMBED_SETIMAGE: null,
    EMBED_COLOR: null,
    EMBED_THUMBNAIL: null,
    LOG_KANALI:  null,
    sahip:  { deger: { id: null } }
  };

  try {
    const configPath = path.join(SUNUCU_VERILER_DIR, `${guildId}.json`);

    const st = fs.existsSync(configPath) ? fs.statSync(configPath) : null;

    if (!fs.existsSync(configPath)) {
      sunucuConfigCache.set(guildId, { config: defaultConfig, lastUpdate: now, mtimeMs: 0, size: 0, source: 'missing' });
      return defaultConfig;
    }

    const fileContent = fs.readFileSync(configPath, 'utf8');
    const data = JSON.parse(fileContent);

    const komutlarZorunlu = parseBooleanLike(data.KOMUTLAR_ICIN_ODA_AC_ZORUNLU, false);

    const config = {
      KOMUTLAR_ICIN_ODA_AC_ZORUNLU: komutlarZorunlu,

      ODA_AC_KANAL_ID: parseIdList(data.ODA_AC_KANAL_ID),

      ODA_AC_KATEGORI_ID: parseId(data.ODA_AC_KATEGORI_ID),
      ODALARIN_OLDUGU_KATEGORI_ID: parseId(data.ODALARIN_OLDUGU_KATEGORI_ID),
      ODA_ACMA_VARSAYILAN_SANIYE: parsePositiveInt(data.ODA_ACMA_VARSAYILAN_SANIYE, 600),

      EMBED_FOOTER: (normalizeBos(data.EMBED_FOOTER) ? String(data.EMBED_FOOTER) : null),

      EMBED_SETIMAGE:
        (typeof normalizeBos(data.EMBED_SETIMAGE) === 'string' && String(data.EMBED_SETIMAGE).trim().startsWith('http'))
          ? String(data.EMBED_SETIMAGE).trim()
          : null,

      EMBED_THUMBNAIL:
        (typeof normalizeBos(data.EMBED_THUMBNAIL) === 'string' && String(data.EMBED_THUMBNAIL).trim().startsWith('http'))
          ? String(data.EMBED_THUMBNAIL).trim()
          : null,

      EMBED_COLOR: parseEmbedColor(data.EMBED_COLOR),

      LOG_KANALI: parseId(data.LOG_KANALI),

      sahip: {
        deger:  {
          id: data.sahip?.deger?.id || null
        }
      }
    };

    sunucuConfigCache.set(guildId, {
      config,
      lastUpdate: now,
      mtimeMs: st && st.isFile() ? st.mtimeMs : Date.now(),
      size: st && st.isFile() ? st.size : 0,
      source: 'file'
    });
    return config;
  } catch (e) {
    // Dosya anlık yazım sırasında bozuk JSON olursa bot config'i tamamen sıfırlamasın;
    // son bilinen config ile devam etsin (restart gerekmesin).
    if (cached && cached.config) {
      return cached.config;
    }
    sunucuConfigCache.set(guildId, { config: defaultConfig, lastUpdate: now, mtimeMs: 0, size: 0, source: 'error' });
    return defaultConfig;
  }
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
      key: 'startup'
    });
    return false;
  }

  const dbEnvValid = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS;

  if (!dbEnvValid) {
    await SafeLog.warn('db_env_missing', 'Veritabanı ENV değişkenleri eksik', {
      klasor:  'database',
      key:  'startup'
    });
    return false;
  }

  try {
    const parseEnvInt = (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    dbManager = new DatabaseManager(null, {
      maxQueryLength: parseEnvInt(process.env.DB_MAX_QUERY_LENGTH, 50000),
      maxParamCount: parseEnvInt(process.env.DB_MAX_PARAM_COUNT, 2000),
      maxParamLength: parseEnvInt(process.env.DB_MAX_PARAM_LENGTH, 16000),
      querySandbox: {
        maxQueryLength: parseEnvInt(process.env.DB_SANDBOX_MAX_QUERY_LENGTH, 100000),
        maxParamCount: parseEnvInt(process.env.DB_SANDBOX_MAX_PARAM_COUNT, 2000),
        maxParamLength: parseEnvInt(process.env.DB_SANDBOX_MAX_PARAM_LENGTH, 32000)
      }
    });

    dbManager.logger = {
      info: (e, m, o) => SafeLog.info(e, m, { ...o, klasor: 'database' }),
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
      database: process.env.DB_NAME || 'AdmiralMorrisonGenel',
      connectionLimit: parseEnvInt(process.env.DB_MAKS_BAGLANTI, 60),
      queueLimit: parseEnvInt(process.env.DB_HAVUZ_KUYRUK_LIMITI, 5000),
      connectTimeout: parseEnvInt(process.env.DB_BAGLANTI_ZAMAN_ASIMI_MS, parseEnvInt(process.env.DB_ZAMAN_ASIMI, 30) * 1000),
      idleTimeout: parseEnvInt(process.env.DB_BOSTA_ZAMAN_ASIMI, 30000)
    });

    if (typeof dbManager.testConnection === 'function') {
      const testOk = await dbManager.testConnection('main');
      if (!testOk) {
        await SafeLog.warn('db_test_failed', 'Veritabanı bağlantı testi başarısız', {
          klasor:  'database',
          key:  'startup'
        });
        return false;
      }
    }

    dbConnected = true;

    await SafeLog.success('db_connected', 'Veritabanı bağlantısı başarılı', {
      klasor: 'database',
      key: 'startup'
    });

    await ensureDatabaseTables();

    return true;
  } catch (e) {
    await SafeLog.error('db_init_error', `Veritabanı başlatma hatası: ${e.message}`, {
      klasor: 'database',
      key: 'startup'
    });
    return false;
  }
}

async function ensureDatabaseTables() {
  if (!dbConnected || !dbManager) return;

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

// ==================== API QUEUE SİSTEMİ ====================

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
        await SafeLog.warn('api_429_backoff', `API 429 - ${retryAfter}ms bekleniyor`, {
          klasor: 'bot_genel',
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


// ✅ LogYonetim auto-logger'ı başlatmak için client enjekte et
try {
  if (LogYonetim && typeof LogYonetim.setClient === 'function') {
    LogYonetim.setClient(client);
  }
} catch (_) {}

let rest = null;
if (TOKEN && TOKEN.trim() !== '') {
  rest = new REST({ version: '10' }).setToken(TOKEN);
}

client.commands = new Map();
client.ownerCommands = new Map();
client.adminCommands = new Map();
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
  }
}



// ==================== KOMUT YÜKLEME TRACKING (SUNUCU/DM CONFIG) ====================
// İstenen mantık:
// - sunucu_dm_veriler/sunucu/<guildId>.json ve sunucu_dm_veriler/dm/<userId>.json içine
//   "son_yuklenen_komutlar" ve "yuklenmeyen_komutlar" alanları eklenir.
// - Komut register hatasında ilgili scope için yuklenmeyen_komutlar güncellenir.
// - Başarılı olduğunda son_yuklenen_komutlar güncellenir ve yuklenmeyen_komutlar temizlenir.
// Not: Discord API register global olduğu için scope ayrımı "context" (sunucu/DM) üzerinden yapılır.

let __lastCommandTrackingSnapshot = null;

// Startup içerik/komut bütünlüğü (sadece bot açılışında raporlanır)
let __startupIntegritySnapshot = null;
let __startupIntegrityPrinted = false;

function __nowIso() {
  try { return new Date().toISOString(); } catch { return null; }
}

function __normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    const s = String(x ?? '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function __getCommandScopeFlags(cmdData) {
  // cmdData.contexts: 0 = guild, 1/2 = DM
  const contexts = Array.isArray(cmdData?.contexts) ? cmdData.contexts : [];
  const dmPerm = cmdData?.dm_permission !== false;
  const isGuild = contexts.length ? contexts.includes(0) : true;
  const isDm = dmPerm && (contexts.includes(1) || contexts.includes(2));
  return { isGuild, isDm };
}

async function __ensureCommandTrackingKeys(filePath) {
  try {
    if (!filePath) return false;
    if (!fs.existsSync(filePath)) return false;

    const data = await safeReadJson(filePath).catch(() => null);
    if (!data || typeof data !== 'object') return false;

    let changed = false;

    if (!data.son_yuklenen_komutlar || typeof data.son_yuklenen_komutlar !== 'object') {
      data.son_yuklenen_komutlar = { zaman: null, komutlar: [] };
      changed = true;
    } else {
      if (!('zaman' in data.son_yuklenen_komutlar)) { data.son_yuklenen_komutlar.zaman = null; changed = true; }
      if (!Array.isArray(data.son_yuklenen_komutlar.komutlar)) { data.son_yuklenen_komutlar.komutlar = []; changed = true; }
    }

    if (!data.yuklenmeyen_komutlar || typeof data.yuklenmeyen_komutlar !== 'object') {
      data.yuklenmeyen_komutlar = { zaman: null, komutlar: [] };
      changed = true;
    } else {
      if (!('zaman' in data.yuklenmeyen_komutlar)) { data.yuklenmeyen_komutlar.zaman = null; changed = true; }
      if (!Array.isArray(data.yuklenmeyen_komutlar.komutlar)) { data.yuklenmeyen_komutlar.komutlar = []; changed = true; }
    }

    if (changed) {
      await safeWriteJsonAtomic(filePath, data).catch(() => {});
    }

    return true;
  } catch {
    return false;
  }
}

async function __applyCommandTrackingSnapshotToConfigs({ onlyGuildId = null, onlyUserId = null } = {}) {
  try {
    const snap = __lastCommandTrackingSnapshot;
    if (!snap || !snap.scope) return false;

    const ts = __nowIso();

    // SUNUCU CONFIG
    try {
      await ensureDir(SUNUCU_VERILER_DIR);
      const guildFiles = await fsp.readdir(SUNUCU_VERILER_DIR).catch(() => []);
      const targets = (guildFiles || []).filter(f => f.endsWith('.json') && !f.startsWith('.'));

      for (const file of targets) {
        const gid = String(file).replace(/\.json$/i, '');
        if (onlyGuildId && gid !== String(onlyGuildId)) continue;

        const fp = path.join(SUNUCU_VERILER_DIR, file);
        if (!fs.existsSync(fp)) continue;

        await __ensureCommandTrackingKeys(fp);

        const data = await safeReadJson(fp).catch(() => null);
        if (!data || typeof data !== 'object') continue;

        const existingPending = __normalizeStringArray(data?.yuklenmeyen_komutlar?.komutlar);

        // Başarılı scope listesi
        const loaded = __normalizeStringArray(snap.scope.guildCommands);

        // Pending: önce mevcut pending'i al, sonra snap başarısızlarını ekle
        const pendingSet = new Set(existingPending);
        for (const c of (snap.scope.guildFailed || [])) pendingSet.add(String(c));

        // Eğer artık yüklenmişse pending'den çıkar
        for (const c of loaded) pendingSet.delete(String(c));

        // Eğer komut artık hiç yoksa pending'den çıkar
        const pending = __normalizeStringArray(Array.from(pendingSet));

        data.son_yuklenen_komutlar = {
          zaman: snap.registerOk ? (snap.registerAt || ts) : (data?.son_yuklenen_komutlar?.zaman || null),
          komutlar: loaded
        };

        data.yuklenmeyen_komutlar = {
          zaman: pending.length ? (snap.registerOk ? (snap.registerAt || ts) : (snap.registerAt || ts)) : null,
          komutlar: pending
        };

        await safeWriteJsonAtomic(fp, data).catch(() => {});
      }
    } catch {
      // yut
    }

    // DM CONFIG
    try {
      await ensureDir(DM_VERILER_DIR);
      const dmFiles = await fsp.readdir(DM_VERILER_DIR).catch(() => []);
      const targets = (dmFiles || []).filter(f => f.endsWith('.json') && !f.startsWith('.'));

      for (const file of targets) {
        const uid = String(file).replace(/\.json$/i, '');
        if (onlyUserId && uid !== String(onlyUserId)) continue;

        const fp = path.join(DM_VERILER_DIR, file);
        if (!fs.existsSync(fp)) continue;

        await __ensureCommandTrackingKeys(fp);

        const data = await safeReadJson(fp).catch(() => null);
        if (!data || typeof data !== 'object') continue;

        const existingPending = __normalizeStringArray(data?.yuklenmeyen_komutlar?.komutlar);
        const loaded = __normalizeStringArray(snap.scope.dmCommands);

        const pendingSet = new Set(existingPending);
        for (const c of (snap.scope.dmFailed || [])) pendingSet.add(String(c));
        for (const c of loaded) pendingSet.delete(String(c));

        const pending = __normalizeStringArray(Array.from(pendingSet));

        data.son_yuklenen_komutlar = {
          zaman: snap.registerOk ? (snap.registerAt || ts) : (data?.son_yuklenen_komutlar?.zaman || null),
          komutlar: loaded
        };

        data.yuklenmeyen_komutlar = {
          zaman: pending.length ? (snap.registerOk ? (snap.registerAt || ts) : (snap.registerAt || ts)) : null,
          komutlar: pending
        };

        await safeWriteJson(fp, data).catch(() => {});
      }
    } catch {
      // yut
    }

    return true;
  } catch {
    return false;
  }
}


// ==================== KOMUT YÜKLEME - DETAYLI VERSİYON ====================

async function loadCommandsFrom(folder, targetMap, rutbeTipi = null) {
  const stats = {
    loaded: 0,
    skipped: 0,
    errors: 0,
    loadedNames: [],
    skippedNames: [],
    errorNames: [],
    errorDetails: [],
    contextStats: {
      sunucuVeDM: [],      // Hem sunucu hem DM'de çalışan
      sadeceSunucu: [],    // Sadece sunucuda
      sadeceDM: []         // Sadece DM'de
    }
  };

  try {
    await fsp.mkdir(folder, { recursive: true });

    let files = [];
    try {
      files = await fsp.readdir(folder);
    } catch (e) {
      await SafeLog.warn('folder_read_error', `Klasör okunamadı: ${folder}`, {
        klasor: 'bot_genel',
        key: 'startup',
        hata: e.message
      });
      return stats;
    }

    const jsFiles = files.filter(f => f.endsWith('.js')).sort();

    if (jsFiles.length === 0) {
      await SafeLog.info('klasor_bos', `Klasörde JS dosyası bulunamadı: ${folder}`, {
        klasor: 'bot_genel',
        key: 'startup',
        rutbe: rutbeTipi || 'ucretsiz'
      });
      return stats;
    }

    for (const file of jsFiles) {
      const fullPath = path.join(folder, file);

      try {
        // Cache'i temizle
        delete require.cache[require.resolve(fullPath)];
        const cmd = require(fullPath);

        // Komut formatı kontrolü
        if (!cmd || !cmd.data || !cmd.data.name || typeof cmd.execute !== 'function') {
          stats.skipped++;
          stats.skippedNames.push(file);
          
          await SafeLog.warn('komut_format_hatasi', `Komut formatı yanlış: ${file}`, {
            klasor: 'bot_genel',
            key: 'startup',
            rutbe: rutbeTipi || 'ucretsiz',
            dosya: file,
            neden: !cmd ? 'Boş dosya' : !cmd.data ? 'data eksik' : !cmd.data.name ? 'name eksik' : 'execute function yok'
          });
          continue;
        }

        // Rutbe bilgisini ekle
        if (rutbeTipi) {
          cmd.rutbeTipi = rutbeTipi;
          if (!cmd.permission) {
            cmd.permission = rutbeTipi;
          }
        }

        // Map'e ekle
        targetMap.set(cmd.data.name, cmd);
        stats.loaded++;
        stats.loadedNames.push(cmd.data.name);

        // ✨ CONTEXT AYRIMI (DM/SUNUCU/HER İKİ)
        // Default: DM izni açık ve sunucuda çalışmalı
        const dmPermission = cmd.data.dm_permission !== false;
        const contexts = Array.isArray(cmd.data.contexts) ? cmd.data.contexts : [0, 1];
        
        const isDmContext = dmPermission && (contexts.includes(1) || contexts.includes(2));
        const isGuildContext = contexts.includes(0);

        if (isGuildContext && isDmContext) {
          stats.contextStats.sunucuVeDM.push(cmd.data.name);
        } else if (isGuildContext && !isDmContext) {
          stats.contextStats.sadeceSunucu.push(cmd.data.name);
        } else if (isDmContext && !isGuildContext) {
          stats.contextStats.sadeceDM.push(cmd.data.name);
        } else {
          // Fallback: her ikisinde de çalışsın
          stats.contextStats.sunucuVeDM.push(cmd.data.name);
        }

      } catch (e) {
        stats.errors++;
        const inferredName = String(file || '').replace(/\.js$/i, '');
        stats.errorNames.push(inferredName || file);
        stats.errorDetails.push({
          dosya: file,
          komut: inferredName || null,
          fullPath,
          hata: e.message,
          stack: e.stack?.split('\n')[0]
        });

        await SafeLog.error('komut_yukleme_hatasi', `Komut yükleme başarısız: ${file}`, {
          klasor: 'bot_genel',
          key: 'startup',
          rutbe: rutbeTipi || 'ucretsiz',
          dosya: file,
          hata: e.message
        });
      }
    }
  } catch (e) {
    stats.errors++;
    await SafeLog.error('klasor_islem_hatasi', `Klasör işleme hatası: ${folder}`, {
      klasor: 'bot_genel',
      key: 'startup',
      hata: e.message
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 📋 DETAYLI ÖZETİ LOG'LA
  // ════════════════════════════════════════════════════════════════════
  const folderName = folder.split('\\').pop() || folder.split('/').pop();
  const toplamDosya = stats.loaded + stats.skipped + stats.errors;
  
  await SafeLog.info('komut_yuk_ozet', `📦 Komut Yükleme Özeti: ${folderName}`, {
    klasor: 'bot_genel',
    key: 'startup',
    rutbe: rutbeTipi || 'ucretsiz',
    '═══════════════════════════════': '═══════════════════════════════',
    'Klasör': folderName,
    'Rutbe Tipi': rutbeTipi || 'ucretsiz',
    '───────────────────────────────': '───────────────────────────────',
    'Toplam Dosya': toplamDosya,
    'Başarılı Yüklenen': stats.loaded,
    'Atlanan (Format Hatası)': stats.skipped,
    'Hatalı Yükleme': stats.errors,
    '───────────────────────────────': '───────────────────────────────',
    'Yüklenen Komutlar': stats.loadedNames.length > 0 ? `[${stats.loaded}] ${stats.loadedNames.join(', ')}` : '❌ Yok',
    'Atlanan Komutlar': stats.skippedNames.length > 0 ? `[${stats.skipped}] ${stats.skippedNames.join(', ')}` : '✅ Yok',
    'Hatalı Komutlar': stats.errorNames.length > 0 ? `[${stats.errors}] ${stats.errorNames.join(', ')}` : '✅ Yok',
    '───────────────────────────────': '───────────────────────────────',
    '🌍 Context Dağılımı': '',
    'Sunucu + DM': stats.contextStats.sunucuVeDM.length > 0 ? `[${stats.contextStats.sunucuVeDM.length}] ${stats.contextStats.sunucuVeDM.join(', ')}` : '❌ Yok',
    'Sadece Sunucu': stats.contextStats.sadeceSunucu.length > 0 ? `[${stats.contextStats.sadeceSunucu.length}] ${stats.contextStats.sadeceSunucu.join(', ')}` : '❌ Yok',
    'Sadece DM': stats.contextStats.sadeceDM.length > 0 ? `[${stats.contextStats.sadeceDM.length}] ${stats.contextStats.sadeceDM.join(', ')}` : '❌ Yok',
    '═══════════════════════════════': '═══════════════════════════════',
    'Hata Detayları': stats.errorDetails.length > 0 ? JSON.stringify(stats.errorDetails, null, 2) : '✅ Hata Yok'
  });

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
      await SafeLog.warn('register_429_backoff', `Komut register 429 - ${waitTime}ms`, {
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
  const startTime = Date.now();
  
  await SafeLog.info('komut_yukleme_baslandi', '🚀 Komut yükleme başlatıldı...', {
    klasor: 'bot_genel',
    key: 'startup'
  });

  // ════════════════════════════════════════════════════════════════════
  // 📥 TÜM KOMUTLARI YÜKLEMEYİ
  // ════════════════════════════════════════════════════════════════════
  const ucretsizStats = await loadCommandsFrom(UCRETSIZ_KOMUTLAR_DIR, client.commands);
  const ownerStats = await loadCommandsFrom(OWNER_KOMUT_DIR, client.ownerCommands, 'owner');
  const adminStats = await loadCommandsFrom(ADMIN_KOMUT_DIR, client.adminCommands, 'admin');
  const vipStats = await loadCommandsFrom(VIP_KOMUT_DIR, client.vipCommands, 'vip');
  const premiumStats = await loadCommandsFrom(PREMIUM_KOMUT_DIR, client.premiumCommands, 'premium');

  // Komut load hatalarını scope bazında pending listesine aday olarak hazırla
  const __loadFailedCandidates = [];
  for (const st of [ucretsizStats, ownerStats, adminStats, vipStats, premiumStats]) {
    try {
      const errs = Array.isArray(st?.errorNames) ? st.errorNames : [];
      const skp = Array.isArray(st?.skippedNames) ? st.skippedNames : [];
      for (const x of errs.concat(skp)) {
        const n = String(x || '').replace(/\.js$/i, '').trim();
        if (n) __loadFailedCandidates.push(n);
      }
    } catch {}
  }
  const __loadFailedUnique = __normalizeStringArray(__loadFailedCandidates);
  // Komut context meta (register skip/catch blokları için de erişilebilir olmalı)
  const cmdMetaByName = {}; // name -> { isGuild, isDm }


  // Startup integrity snapshot (paket kaybı/atlanan içerikler raporu için)
  try {
    const statsList = [ucretsizStats, ownerStats, adminStats, vipStats, premiumStats];
    const skipped = statsList.reduce((a, s) => a + (Number(s?.skipped || 0) || 0), 0);
    const errors = statsList.reduce((a, s) => a + (Number(s?.errors || 0) || 0), 0);
    const skippedNames = statsList.flatMap(s => Array.isArray(s?.skippedNames) ? s.skippedNames : []).slice(0, 50);
    const errorNames = statsList.flatMap(s => Array.isArray(s?.errorNames) ? s.errorNames : []).slice(0, 50);

    __startupIntegritySnapshot = {
      atlanan_icerik: skipped,
      hata: errors,
      ornek_atlanan: skippedNames.map(x => String(x)).slice(0, 25),
      ornek_hata: errorNames.map(x => String(x)).slice(0, 25)
    };
  } catch {
    __startupIntegritySnapshot = null;
  }




  // ════════════════════════════════════════════════════════════════════
  // 🔄 KAPIŞMA ÖNLEME (Owner komutları diğer maplerde olmasın)
  // ════════════════════════════════════════════════════════════════════
  for (const name of client.ownerCommands.keys()) {
    if (client.commands.has(name)) {
      client.commands.delete(name);
      await SafeLog.debug('komut_capisme_oncele', `Owner komutunu normal mapten çıkardı: ${name}`, {
        klasor: 'bot_genel',
        key: 'startup'
      });
    }
    if (client.adminCommands.has(name)) {
      client.adminCommands.delete(name);
    }
    if (client.vipCommands.has(name)) {
      client.vipCommands.delete(name);
    }
    if (client.premiumCommands.has(name)) {
      client.premiumCommands.delete(name);
    }
  }

  // Admin komutları diğer maplerde olmasın (owner hariç)
  for (const name of client.adminCommands.keys()) {
    if (client.commands.has(name)) client.commands.delete(name);
    if (client.vipCommands.has(name)) client.vipCommands.delete(name);
    if (client.premiumCommands.has(name)) client.premiumCommands.delete(name);
  }

  // ════════════════════════════════════════════════════════════════════
  // 📡 DISCORD API'YE KOMUTLARI KAYDET (Register)
  // ════════════════════════════════════════════════════════════════════
  
  if (!CLIENT_ID || !rest) {
    await SafeLog.warn('register_skip', '⚠️ CLIENT_ID veya REST eksik - Komut register atlanıyor', {
      klasor: 'bot_genel',
      key: 'startup',
      clientId: CLIENT_ID ? '✅ Var' : '❌ Yok',
      restClient: rest ? '✅ Var' : '❌ Yok'
    });
    
    // Tracking snapshot (register hatası)
    try {
      const guildCommands = [];
      const dmCommands = [];
      for (const [name, flags] of Object.entries(cmdMetaByName || {})) {
        if (flags?.isGuild) guildCommands.push(name);
        if (flags?.isDm) dmCommands.push(name);
      }
      // Register başarısızsa: mevcut komutları scope bazında pending'e yaz
      __lastCommandTrackingSnapshot = {
        registerOk: false,
        registerAt: __nowIso(),
        scope: {
          guildCommands: __normalizeStringArray(guildCommands),
          dmCommands: __normalizeStringArray(dmCommands),
          guildFailed: __normalizeStringArray(guildCommands.concat(__loadFailedUnique || [])),
          dmFailed: __normalizeStringArray(dmCommands.concat(__loadFailedUnique || []))
        },
        error: e?.message || 'register_error'
      };
      await __applyCommandTrackingSnapshotToConfigs();
    } catch {}

    const toplamKomut = client.commands.size + client.ownerCommands.size + client.adminCommands.size +
                       client.vipCommands.size + client.premiumCommands.size;
    
    return {
      total: toplamKomut,
      changed: 0,
      added: 0,
      deleted: 0,
      registered: false,
      loadTime: Date.now() - startTime
    };
  }

  try {
    const currentSignatures = {};
    const previousSignatures = await loadCommandSignatures();
    let changed = 0, added = 0, deleted = 0;

    const allCommands = [];
    const processedNames = new Set();


    // ════════════════════════════════════════════════════════════════════
    // 🔍 TÜM KOMUTLARI TOPLA VE İŞLE
    // ════════════════════════════════════════════════════════════════════
    
    const commandMaps = [
      { map: client.commands, type: 'normal' },
      { map: client.ownerCommands, type: 'owner' },
      { map: client.adminCommands, type: 'admin' },
      { map: client.vipCommands, type: 'vip' },
      { map: client.premiumCommands, type: 'premium' }
    ];

    for (const { map, type } of commandMaps) {
      for (const cmd of map.values()) {
        if (cmd.data && !processedNames.has(cmd.data.name)) {
          let cmdData = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : { ...cmd.data };

          // ✨ CONTEXT KURALARI
          // /oda komutu SADECE sunucu scope'a
          if (cmd.data.name === 'oda') {
            cmdData.contexts = [0]; // Sadece sunucu
            cmdData.integration_types = [0];
            cmdData.dm_permission = false;
          } else {
            // Diğer komutlar ENV ayarlarına göre
            if (COMMAND_CONTEXT_SETTINGS.contexts && COMMAND_CONTEXT_SETTINGS.contexts.length > 0) {
              cmdData.contexts = COMMAND_CONTEXT_SETTINGS.contexts;
            }
            
            if (COMMAND_CONTEXT_SETTINGS.integrationTypes && 
                COMMAND_CONTEXT_SETTINGS.integrationTypes.length > 0) {
              cmdData.integration_types = COMMAND_CONTEXT_SETTINGS.integrationTypes;
            }
            
            if (COMMAND_CONTEXT_SETTINGS.dmPermission !== undefined && 
                COMMAND_CONTEXT_SETTINGS.dmPermission !== null) {
              cmdData.dm_permission = COMMAND_CONTEXT_SETTINGS.dmPermission;
            }
          }

          const flags = __getCommandScopeFlags(cmdData);
          cmdMetaByName[cmd.data.name] = flags;

          const sig = getCommandSignature(cmdData);
          currentSignatures[cmd.data.name] = sig;
          allCommands.push(cmdData);
          processedNames.add(cmd.data.name);

          // Değişiklik tespiti
          if (!previousSignatures[cmd.data.name]) {
            added++;
          } else if (previousSignatures[cmd.data.name] !== sig) {
            changed++;
          }
        }
      }
    }

    // Silinen komutları tespit et
    for (const prevCmd of Object.keys(previousSignatures)) {
      if (!currentSignatures[prevCmd]) {
        deleted++;
      }
    }

    let needsUpdate = added > 0 || changed > 0 || deleted > 0;

    // Eğer config dosyalarında daha önce "yuklenmeyen_komutlar" biriktiyse,
    // signature kıyası aynı olsa bile tekrar register dene.
    // (Bu tarama config dosyaları yoksa noop olur.)
    try {
      const hasPending = await (async () => {
        try {
          if (!fs.existsSync(SUNUCU_VERILER_DIR) && !fs.existsSync(DM_VERILER_DIR)) return false;
          let pendingFound = false;

          if (fs.existsSync(SUNUCU_VERILER_DIR)) {
            const gf = await fsp.readdir(SUNUCU_VERILER_DIR).catch(() => []);
            for (const f of (gf || []).filter(x => x.endsWith('.json') && !x.startsWith('.'))) {
              const fp = path.join(SUNUCU_VERILER_DIR, f);
              const d = await safeReadJson(fp).catch(() => null);
              const arr = __normalizeStringArray(d?.yuklenmeyen_komutlar?.komutlar);
              if (arr.length) { pendingFound = true; break; }
            }
          }

          if (!pendingFound && fs.existsSync(DM_VERILER_DIR)) {
            const df = await fsp.readdir(DM_VERILER_DIR).catch(() => []);
            for (const f of (df || []).filter(x => x.endsWith('.json') && !x.startsWith('.'))) {
              const fp = path.join(DM_VERILER_DIR, f);
              const d = await safeReadJson(fp).catch(() => null);
              const arr = __normalizeStringArray(d?.yuklenmeyen_komutlar?.komutlar);
              if (arr.length) { pendingFound = true; break; }
            }
          }

          return pendingFound;
        } catch {
          return false;
        }
      })();
      if (hasPending) needsUpdate = true;
    } catch {}


    // ════════════════════════════════════════════════════════════════════
    // 📤 DISCORD API'YE GÖNDERİ
    // ════════════════════════════════════════════════════════════════════
    
    if (needsUpdate) {
      await safeRestPut(Routes.applicationCommands(CLIENT_ID), allCommands);
      await saveCommandSignatures(currentSignatures);

      // Tracking snapshot (config dosyaları hazırsa hemen yaz, değilse ready sonrası yazılacak)
      try {
        const guildCommands = [];
        const dmCommands = [];
        for (const [name, flags] of Object.entries(cmdMetaByName)) {
          if (flags?.isGuild) guildCommands.push(name);
          if (flags?.isDm) dmCommands.push(name);
        }

        __lastCommandTrackingSnapshot = {
          registerOk: true,
          registerAt: __nowIso(),
          scope: {
            guildCommands: __normalizeStringArray(guildCommands),
            dmCommands: __normalizeStringArray(dmCommands),
            guildFailed: __loadFailedUnique || [],
            dmFailed: __loadFailedUnique || []
          }
        };

        await __applyCommandTrackingSnapshotToConfigs();
      } catch {}

      await SafeLog.success('komutlar_guncellendi', '✅ Komutlar Discord API\'ye gönderildi', {
        klasor: 'bot_genel',
        key: 'startup',
        'Toplam Komut': Object.keys(currentSignatures).length,
        'Değiştirilen': changed,
        'Eklenen': added,
        'Silinen': deleted,
        'API Durumu': '✅ Başarılı'
      });
    } else {
      // Tracking snapshot (komutlar zaten güncel)
      try {
        const guildCommands = [];
        const dmCommands = [];
        for (const [name, flags] of Object.entries(cmdMetaByName)) {
          if (flags?.isGuild) guildCommands.push(name);
          if (flags?.isDm) dmCommands.push(name);
        }

        __lastCommandTrackingSnapshot = {
          registerOk: true,
          registerAt: __nowIso(),
          scope: {
            guildCommands: __normalizeStringArray(guildCommands),
            dmCommands: __normalizeStringArray(dmCommands),
            guildFailed: __loadFailedUnique || [],
            dmFailed: __loadFailedUnique || []
          }
        };

        await __applyCommandTrackingSnapshotToConfigs();
      } catch {}

      await SafeLog.info('komutlar_guncel', '✅ Komutlar zaten güncel (güncelleme gerekmedi)', {
        klasor: 'bot_genel',
        key: 'startup',
        'Toplam Komut': Object.keys(currentSignatures).length,
        'API Durumu': 'Kıyaslaması Yapıldı'
      });
    }

    const registerResult = { 
      total: Object.keys(currentSignatures).length, 
      changed, 
      added, 
      deleted,
      registered: true,
      loadTime: Date.now() - startTime
    };

    return registerResult;

  } catch (e) {
    await SafeLog.error('komut_register_hatasi', `❌ Komut register hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'startup',
      hata: e.message,
      stack: e.stack?.split('\n')[0]
    });

    await sendErrorWebhook('ERROR', 'komut_register_hatasi', e.message, {
      klasor: 'bot_genel'
    });

    // Tracking snapshot (register hatası)
    try {
      const guildCommands = [];
      const dmCommands = [];
      for (const [name, flags] of Object.entries(cmdMetaByName || {})) {
        if (flags?.isGuild) guildCommands.push(name);
        if (flags?.isDm) dmCommands.push(name);
      }
      // Register başarısızsa: mevcut komutları scope bazında pending'e yaz
      __lastCommandTrackingSnapshot = {
        registerOk: false,
        registerAt: __nowIso(),
        scope: {
          guildCommands: __normalizeStringArray(guildCommands),
          dmCommands: __normalizeStringArray(dmCommands),
          guildFailed: __normalizeStringArray(guildCommands.concat(__loadFailedUnique || [])),
          dmFailed: __normalizeStringArray(dmCommands.concat(__loadFailedUnique || []))
        },
        error: e?.message || 'register_error'
      };
      await __applyCommandTrackingSnapshotToConfigs();
    } catch {}

    const toplamKomut = client.commands.size + client.ownerCommands.size + client.adminCommands.size +
                       client.vipCommands.size + client.premiumCommands.size;

    return {
      total: toplamKomut,
      changed: 0,
      added: 0,
      deleted: 0,
      registered: false,
      loadTime: Date.now() - startTime,
      error: e.message
    };
  }
}

// ==================== EMBED YÖNETİMİ ====================

function __parseEmbedColorValue(val) {
  try {
    if (val === null || typeof val === 'undefined') return null;
    if (typeof val === 'number' && Number.isFinite(val)) return val;

    const s = String(val).trim();
    if (!s) return null;

    const low = s.toLowerCase();
    if (low.startsWith('#')) {
      const parsed = parseInt(low.slice(1), 16);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (low.startsWith('0x')) {
      const parsed = parseInt(low, 16);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = Number(low);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function __normalizeEmbedConfigPayload(raw = null) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const pickFirst = (...keys) => {
    for (const key of keys) {
      if (typeof src[key] !== 'undefined' && src[key] !== null) {
        const value = src[key];
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
          continue;
        }
        return value;
      }
    }
    return null;
  };

  const normalizeUrl = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  };

  return {
    footer: pickFirst('EMBED_FOOTER', 'default_EMBED_FOOTER', 'DEFAULT_EMBED_FOOTER'),
    image: normalizeUrl(pickFirst('EMBED_SETIMAGE', 'default_EMBED_SETIMAGE', 'DEFAULT_EMBED_SETIMAGE')),
    thumbnail: normalizeUrl(pickFirst('EMBED_THUMBNAIL', 'default_EMBED_THUMBNAIL', 'DEFAULT_EMBED_THUMBNAIL')),
    color: __parseEmbedColorValue(pickFirst('EMBED_COLOR', 'default_EMBED_COLOR', 'DEFAULT_EMBED_COLOR'))
  };
}

function __mergeEmbedParams(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  if (patch.footer) target.footer = patch.footer;
  if (patch.image) target.image = patch.image;
  if (patch.thumbnail) target.thumbnail = patch.thumbnail;
  if (patch.color !== null && typeof patch.color !== 'undefined') target.color = patch.color;
  return target;
}

function __readDmEmbedConfig(userId) {
  try {
    if (!userId) return null;

    const dmFilePathJson = path.join(DM_VERILER_DIR, `${userId}.json`);
    const dmFilePathJs = path.join(DM_VERILER_DIR, `${userId}.js`);
    const dmFilePath = fs.existsSync(dmFilePathJson) ? dmFilePathJson : dmFilePathJs;
    if (!fs.existsSync(dmFilePath)) return null;

    if (dmFilePath.endsWith('.json')) {
      const raw = fs.readFileSync(dmFilePath, 'utf8');
      return JSON.parse(raw);
    }

    delete require.cache[require.resolve(dmFilePath)];
    return require(dmFilePath);
  } catch {
    return null;
  }
}

function __normalizeEmbedScopeOptions(guildId = null, userId = null, opts = null) {
  let finalGuildId = guildId;
  let finalUserId = userId;
  let finalOpts = (opts && typeof opts === 'object') ? opts : {};

  if (userId && typeof userId === 'object' && !Array.isArray(userId) && !opts) {
    finalOpts = userId;
    finalUserId = null;
  }

  if (guildId && typeof guildId === 'object' && !Array.isArray(guildId) && !userId && !opts) {
    finalOpts = guildId;
    finalGuildId = null;
    finalUserId = null;
  }

  return {
    guildId: finalGuildId,
    userId: finalUserId,
    opts: finalOpts
  };
}

function getEmbedParameters(guildId = null, userId = null, opts = null) {
  const normalizedArgs = __normalizeEmbedScopeOptions(guildId, userId, opts);
  const finalGuildId = normalizedArgs.guildId;
  const finalUserId = normalizedArgs.userId;
  const finalOpts = normalizedArgs.opts || {};
  const scope = String(finalOpts.scope || finalOpts.context || '').trim().toLowerCase();

  const params = {
    footer: null,
    image: null,
    thumbnail: null,
    color: null
  };

  try {
    const shouldApplyGuildConfig = Boolean(finalGuildId) && scope !== 'dm';
    const shouldApplyDmConfig = Boolean(finalUserId) && (scope === 'dm' || !finalGuildId);

    if (shouldApplyGuildConfig) {
      const config = getSunucuConfig(finalGuildId);
      __mergeEmbedParams(params, __normalizeEmbedConfigPayload(config));
    }

    if (shouldApplyDmConfig) {
      const dmData = __readDmEmbedConfig(finalUserId);
      __mergeEmbedParams(params, __normalizeEmbedConfigPayload(dmData));
    }
  } catch {
  }

  return params;
}

function applyEmbedParameters(embed, guildId = null, userId = null, opts = null) {
  const params = getEmbedParameters(guildId, userId, opts);

  try {
    if (params.color !== null && typeof params.color !== 'undefined') {
      embed.setColor(params.color);
    }

    if (params.footer) {
      embed.setFooter({ text: params.footer });
    }

    if (params.thumbnail) {
      embed.setThumbnail(params.thumbnail);
    }

    if (params.image) {
      embed.setImage(params.image);
    }

  } catch (e) {
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
    embed.setFooter({ text: `HATA ❗ LÜTFEN YÖNETİCİ İLE İLETİŞİME GEÇİNİZ ⚠️` });
  }

  return applyEmbedParameters(embed, guildId, userId);
}

function createSuccessEmbed(title, description, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#00ff88')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  return applyEmbedParameters(embed, guildId, userId);
}

function createInfoEmbed(title, description, guildId = null, userId = null) {
  let embed = new EmbedBuilder()
    .setColor('#4a9eff')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  return applyEmbedParameters(embed, guildId, userId);
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

// ==================== ODA KİSİTLAMA SİSTEMİ (KRİTİK - MADDE 4) ====================

async function checkKomutKisitlamasi(interaction, commandName) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  if (!guildId) {
    return { allowed: true, embed: null };
  }

  const config = getSunucuConfig(guildId);
  const kisitlamaSorunluMu = config.KOMUTLAR_ICIN_ODA_AC_ZORUNLU;

  if (!kisitlamaSorunluMu) {
    return { allowed:  true, embed: null };
  }

  // /oda komutu KEÇİ SADECE belirlenen kategori/kanallarda
  if (commandName === 'oda') {
    const odaKanalIzni = await checkOdaKomutuIzni(guildId, channelId, userId);
    return odaKanalIzni;
  }

  // Muaf komutlar
  const exemptCommands = ['kurulum', 'yardim', 'help'];
  if (exemptCommands.includes(commandName.toLowerCase())) {
    return { allowed: true, embed: null };
  }

  // Muaf kullanıcılar (Madde 6)
  const isYetkili = isOwner(userId) || await isAdmin(userId);
  if (isYetkili) {
    return { allowed: true, embed: null };
  }

  const sunucuSahipId = config.sahip?.deger?.id;
  if (sunucuSahipId && userId === sunucuSahipId) {
    return { allowed: true, embed: null };
  }

  // Kategori ID kontrolü
  const kategoriId = config.ODALARIN_OLDUGU_KATEGORI_ID;
  if (! kategoriId) {
    const embed = createErrorEmbed(
      '⚠️ Sunucu Yapılandırması Hatası',
      'Sunucu yöneticisi oda kategorisini ayarlamadı.Lütfen bot sahibine bildir.',
      null, guildId, userId
    );
    return { allowed: false, embed };
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      const embed = createErrorEmbed(
        '❌ Hata',
        'Sunucu bulunamadı.',
        null, guildId, userId
      );
      return { allowed: false, embed };
    }

    const kanal = guild.channels.cache.get(channelId);
    if (!kanal) {
      const embed = createErrorEmbed(
        '❌ Hata',
        'Kanal bulunamadı.',
        null, guildId, userId
      );
      return { allowed: false, embed };
    }

    const kategori = guild.channels.cache.get(kategoriId);
    if (!kategori || kategori.type !== 4) {
      const embed = createErrorEmbed(
        '⚠️ Sunucu Yapılandırması Hatası',
        `Yapılandırılan kategori (ID: ${kategoriId}) sunucuda bulunamadı veya kategori değil.`,
        null, guildId, userId
      );
      return { allowed: false, embed };
    }

    if (kanal.parentId !== kategoriId) {
      const embed = createErrorEmbed(
        '📍 Yanlış Kanal - Komut Yasak',
        `Bu komutu kullanabilmek için **${kategori.name}** kategorisindeki bir kanala gitmelisiniz.\n\n📌 Lütfen **${kategori.name}** kategorisindeki bir kanal seçin.`,
        null, guildId, userId
      );
      return { allowed:  false, embed };
    }

    return { allowed: true, embed: null };

  } catch (e) {
    await SafeLog.error('kanal_kontrol_hatasi', e.message, {
      klasor: 'bot_genel',
      key: 'interaction',
      guildId,
      channelId,
      userId
    });

    const embed = createErrorEmbed(
      '❌ Hata',
      'Kanal kontrolü sırasında bir sorun oluştu.',
      null, guildId, userId
    );
    return { allowed: false, embed };
  }
}

async function checkOdaKomutuIzni(guildId, channelId, userId) {
  try {
    const config = getSunucuConfig(guildId);
    
    // Muaf kullanıcılar
    const isYetkili = isOwner(userId) || await isAdmin(userId);
    if (isYetkili) {
      return { allowed: true, embed: null };
    }

    const sunucuSahipId = config.sahip?.deger?.id;
    if (sunucuSahipId && userId === sunucuSahipId) {
      return { allowed: true, embed: null };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      const embed = createErrorEmbed(
        '❌ Hata',
        'Sunucu bulunamadı.',
        null, guildId, userId
      );
      return { allowed:  false, embed };
    }

    const kanal = guild.channels.cache.get(channelId);
    if (!kanal) {
      const embed = createErrorEmbed(
        '❌ Hata',
        'Kanal bulunamadı.',
        null, guildId, userId
      );
      return { allowed: false, embed };
    }

    // ODA_AC_KANAL_ID veya ODA_AC_KATEGORI_ID kontrolü
    const odaKanalIdleri = config.ODA_AC_KANAL_ID || [];
    const odaKategoriId = config.ODA_AC_KATEGORI_ID;

    const isOdaAcKanalinda = Array.isArray(odaKanalIdleri) && odaKanalIdleri.includes(channelId);
    
    let isOdaKategorisinde = false;
    if (odaKategoriId && kanal.parentId === odaKategoriId) {
      isOdaKategorisinde = true;
    }

    if (! isOdaAcKanalinda && !isOdaKategorisinde) {
      let mesaj = '❌ Oda Komutu Yasak\n\n';
      
      if (odaKanalIdleri.length > 0) {
        const kanallar = odaKanalIdleri
          .map(id => guild.channels.cache.get(id)?.name || `<#${id}>`)
          .filter(Boolean)
          .join(', ');
        mesaj += `📍 Bu komutu şu kanalda kullanabilirsiniz: ${kanallar} | <#${odaKanalIdleri}>\n\n`;
      }

      if (odaKategoriId) {
        const kategori = guild.channels.cache.get(odaKategoriId);
        if (kategori) {
          mesaj += `📂 Veya ${kategori.name} kategorisindeki herhangi bir kanalda kullanabilirsiniz.`;
        }
      }

      const embed = createErrorEmbed(
        '📍 Yanlış Kanal',
        mesaj || 'Bu komutu burada kullanamazsınız.',
        null, guildId, userId
      );
      return { allowed:  false, embed };
    }

    return { allowed: true, embed: null };

  } catch (e) {
    await SafeLog.error('oda_kanal_kontrol_hatasi', e.message, {
      klasor: 'bot_genel',
      key: 'interaction',
      guildId,
      channelId,
      userId,
      hata: e.message
    });

    const embed = createErrorEmbed(
      '❌ Hata',
      'Kanal kontrolü sırasında bir sorun oluştu.',
      null, guildId, userId
    );
    return { allowed: false, embed };
  }
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
    }
    return false;
  }

  if (requiredLevel === 'premium' && ! canUsePremiumCommand(userId)) {
    await SafeLog.yetkiHatasi(userId, 'Premium komut erişim denemesi', guildId);

    const embed = createErrorEmbed(
      '🚫 Yetkisiz İşlem',
      'Bu komut **Premium** kullanıcılarına özeldir.',
      null, guildId, userId
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
    }
    return false;
  }

  return true;
}

// ==================== ODA VERILERI SİSTEMİ ====================

async function createOdaRecord(data) {
  if (!dbConnected || !dbManager) return false;

  if (!data || !data.kullanici_id || !data.acilan_oda_id || !data.sunucu_id) {
    return false;
  }

  // ODA_ACMA_VARSAYILAN_SANIYE config'i zorunlu olarak dikkate alınsın.
  // Komut modülü kalan_zaman göndermese bile burada sunucu config'inden otomatik türetilir.
  let kalanZaman = data.kalan_zaman;
  if (typeof kalanZaman !== 'number' || !Number.isFinite(kalanZaman)) {
    const parsed = Number(String(kalanZaman ?? '').trim());
    kalanZaman = Number.isFinite(parsed) ? parsed : NaN;
  }
  if (!Number.isFinite(kalanZaman) || kalanZaman <= 0) {
    try {
      const cfg = getSunucuConfig(String(data.sunucu_id));
      const cfgS = Number(cfg?.ODA_ACMA_VARSAYILAN_SANIYE);
      kalanZaman = Number.isFinite(cfgS) && cfgS > 0 ? Math.floor(cfgS) : 600;
    } catch {
      kalanZaman = 600;
    }
  }

  // data objesini mutasyona uğratmadan local değişken kullan.
  kalanZaman = Math.max(1, Math.floor(kalanZaman));

  try {
    const sql = `
      INSERT INTO kanal_geri_sayim 
      (
        kullanici_id,
        acilan_oda_id,
        oda_ac_kanal_id,
        sunucu_id,
        oda_ac_kategori_id,
        odalarin_oldugu_kategori_id,
        kanal_acilma_zamani,
        kanal_kapanma_zamani,
        kalan_zaman,
        durum
      )
      VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'aktif')
    `;

    await dbManager.query(
      'main',
      sql,
      [
        data.kullanici_id,
        data.acilan_oda_id,
        data.oda_ac_kanal_id || null,
        data.sunucu_id,
        data.oda_ac_kategori_id || null,
        data.odalarin_oldugu_kategori_id || null,
        data.kanal_kapanma_zamani || null,
        kalanZaman
      ],
      { queue: true }
    );

    return true;
  } catch (e) {
    await SafeLog.error(
      'oda_record_error',
      `Oda kaydı oluşturma hatası: ${e.message}`,
      { klasor: 'oda_sistem', key: 'oda' }
    );
    return false;
  }
}

async function closeOdaRecord(odaId) {
  if (!dbConnected || !dbManager) return false;
  if (!odaId) return false;

  try {
    const sql = `
      UPDATE kanal_geri_sayim
      SET durum = 'kapandi', kalan_zaman = 0
      WHERE acilan_oda_id = ?   
    `;

    await dbManager.query(
      'main',
      sql,
      [odaId],
      { queue: true }
    );

    return true;
  } catch (e) {
    await SafeLog.error(
      'oda_close_error',
      `Oda kaydı kapatma hatası: ${e.message}`,
      { klasor: 'oda_sistem', key: 'oda' }
    );
    return false;
  }
}

async function startOdaGeriSayimTimer(kanalId, discordClient) {
  if (activeOdaTimers.has(kanalId)) {
    clearInterval(activeOdaTimers.get(kanalId));
    activeOdaTimers.delete(kanalId);
  }

  const timerInterval = setInterval(async () => {
    try {
      const kanal = discordClient?.channels?.cache?.get(kanalId);
      if (!kanal) {
        clearInterval(timerInterval);
        activeOdaTimers.delete(kanalId);
        await closeOdaRecord(kanalId);
        return;
      }
    } catch (err) {
      clearInterval(timerInterval);
      activeOdaTimers.delete(kanalId);
    }
  }, ODA_GERI_SAYIM_INTERVAL_MS);

  activeOdaTimers.set(kanalId, timerInterval);
}

async function restoreActiveOdaTimers() {
  if (! dbConnected || !dbManager) return;

  try {
    const sql = 'SELECT acilan_oda_id, sunucu_id FROM kanal_geri_sayim WHERE durum = "aktif"';
    const results = await dbManager.query('main', sql, [], { queue: true });

    if (results && results.length > 0) {
      let restoredCount = 0;

      for (const oda of results) {
        if (oda.acilan_oda_id) {
          const channel = client.channels.cache.get(oda.acilan_oda_id);
          
          if (channel) {
            await startOdaGeriSayimTimer(oda.acilan_oda_id, client);
            restoredCount++;
          } else {
            await closeOdaRecord(oda.acilan_oda_id);
          }
        }
      }

      await SafeLog.info('oda_timers_restored', `${restoredCount} aktif oda timer'ı geri yüklendi`, {
        klasor: 'oda_sistem',
        key: 'oda'
      });
    }
  } catch (e) {
    await SafeLog.error('oda_restore_error', `Timer geri yükleme hatası:  ${e.message}`, {
      klasor: 'oda_sistem',
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
    return { cmd: client.vipCommands.get(commandName), type: 'vip' };
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
  let consumedUsageLimit = null;

  try {
    const { cmd, type } = findCommand(commandName);

    if (!cmd) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut mevcut değil veya yüklenemedi.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }
	
	    // ==================== BAKIM KOMUTU BLOKAJI ====================
    if (isCommandBakimda(commandName) && !isBakimYetkilisi(userId)) {
      const embed = createWarningEmbed(
        '🔧 Komut Bakımda',
        `**${commandName}** komutu şu anda bakımda ve geçici olarak devre dışı bırakıldı.\n\n⏳ Lütfen daha sonra tekrar deneyin.\n\n*Bakım ekibi tarafından güncellenmektedir.*`,
        guildId, userId
      );

      await SafeLog.warn('bakim_komut_denemesi', `Bakımda komut kullanımı: /${commandName}`, {
        klasor: 'bot_genel',
        key: 'bakim',
        kullaniciID: userId,
        komut: commandName,
        sunucuID: guildId
      });

      try {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (e) {}
      return;
    }

    if (shouldBlockCommandByPrivacyMask(type)) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut şu anda kullanılamıyor.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (guildId && commandName !== 'oda') {
      const kisitlamaCheck = await checkKomutKisitlamasi(interaction, commandName);

      if (! kisitlamaCheck.allowed) {
        await interaction.reply({ embeds: [kisitlamaCheck.embed] });
        return;
      }
    }

    // /oda komutu için özel kontrol
    if (guildId && commandName === 'oda') {
      const odaCheck = await checkOdaKomutuIzni(guildId, interaction.channelId, userId);

      if (!odaCheck.allowed) {
        await interaction.reply({ embeds: [odaCheck.embed] });
        return;
      }
    }

    // Permission kontrol - rutbeli komutlar için
    let requiredPermission = 'user';

    if (type === 'owner') {
      requiredPermission = 'owner';
    } else if (type === 'admin' || cmd.rutbeTipi === 'admin') {
      requiredPermission = 'admin';
    } else if (type === 'vip' || cmd.rutbeTipi === 'vip') {
      requiredPermission = 'vip';
    } else if (type === 'premium' || cmd.rutbeTipi === 'premium') {
      requiredPermission = 'premium';
    } else if (cmd.permission) {
      requiredPermission = cmd.permission;
    }

    if (!await checkPermission(interaction, requiredPermission)) {
      return;
    }

    const usageLimitResult = await consumeBotCommandUsageLimit(interaction, traceId);
    if (!usageLimitResult?.allowed) {
      return;
    }
    if (usageLimitResult?.consumed) {
      consumedUsageLimit = usageLimitResult;
    }

    if (!cmd.skipDefer) {
      try {
        await interaction.deferReply();
      } catch (deferErr) {
        if (consumedUsageLimit?.consumed) {
          await rollbackConsumedBotCommandUsageLimit(userId, consumedUsageLimit).catch(() => {});
          consumedUsageLimit = null;
        }

        await SafeLog.warn('defer_failed', `Defer başarısız: ${deferErr.message}`, {
          klasor: 'bot_genel',
          key: 'interaction',
          traceID: traceId
        });
        return;
      }
    }

    const dosyaYazimKategori = getCommandPrivacyCategory(type, cmd);

    await runWithFileWriteContext({
      category: dosyaYazimKategori,
      commandName,
      guildId,
      userId,
      traceId
    }, async () => {
      await cmd.execute(interaction, {
      client,
      db:  dbManager,
      dbConnected,
      LogYonetim: SafeLog,
      traceId,
      PANEL_DEAKTIF_SANIYE,
      COP_TEMIZLIK_DIR,
      FILE_DELETE_DELAY_MS,
      getSunucuConfig,
      getEmbedParameters,
      applyEmbedParameters,
      createOdaRecord,
      startOdaGeriSayimTimer,
      closeOdaRecord,
      deleteOdaRecord,
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
      forceRefreshYetkiCache,
      forceRefreshConfigCache,
      sendUserFriendlyLog,
      sendSunucuLog,
      isCommandMasked,
      getEnvMaskValue,
      checkKomutKisitlamasi,
      checkOdaKomutuIzni
      });
    });

    await SafeLog.kullaniciKomut(userId, commandName, guildId, traceId);

  } catch (e) {
    if (consumedUsageLimit?.consumed) {
      await rollbackConsumedBotCommandUsageLimit(userId, consumedUsageLimit).catch(() => {});
      consumedUsageLimit = null;
    }

    await SafeLog.error('command_error', `Komut hatası: ${commandName}`, {
      klasor: 'bot_genel',
      key: 'command',
      hata: e.message,
      traceID: traceId,
      kullaniciID: userId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Bir Hata Oluştu',
        'Komut çalıştırılırken beklenmeyen bir sorun oluştu.Lütfen daha sonra tekrar deneyin.',
        traceId, guildId, userId
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed] });
      }
    } catch (replyErr) {
    }
  }
}

async function handleButton(interaction, traceId) {
  const buttonId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    // ⚠️ Bazı butonlar (ör: modal açanlar) deferUpdate ile ACK edildiğinde
    // showModal kullanılamaz ve "The reply to this interaction has already been sent or deferred." hatası alınır.
    // Bu yüzden modal açacak butonlarda deferUpdate atlanır.
    const shouldSkipDeferUpdate = typeof buttonId === 'string' && (buttonId.startsWith('kurulum_param_') || buttonId === 'yardim_goto');

    if (!shouldSkipDeferUpdate) {
      try {
        await interaction.deferUpdate();
      } catch (deferErr) {
      }
    }


    // ==================== IP KOMUTU SONUÇ BUTONLARI (RESTART-SAFE) ====================
// Buton ID formatı: ip_result_dosya:<traceId>  veya ip_result_link:<traceId>
if (buttonId && (buttonId.startsWith('ip_result_dosya:') || buttonId.startsWith('ip_result_link:'))) {
  const isDosya = buttonId.startsWith('ip_result_dosya:');
  const tracePart = buttonId.split(':').slice(1).join(':'); // traceId içerisinde ':' olma ihtimaline karşı

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const found = await findIpStateByTraceId(tracePart);

  if (!found || !found.state) {
    const embed = createErrorEmbed(
      '⛔ Sonuç Bulunamadı',
      'Sonuç verileri bulunamadı. Lütfen komutu tekrar kullanın.',
      traceId, guildId, userId
    );
    await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
    return;
  }

  const stateObj = found.state;

  const __finalizeIpStateFailIfDosya = async (neden) => {
    try {
      if (!isDosya) return;
      stateObj.durum = 'iptal';
      stateObj.kalan_sure_saniye = 0;
      stateObj.guncelleme_tarihi_iso = new Date().toISOString();
      await safeWriteJson(found.filePath, stateObj).catch(() => {});
      await updateIpMessageFromState(stateObj, { disableButtons: true, forceFail: true, forceSuccess: false }).catch(() => {});
      await finalizeIpStateFile(found.filePath, stateObj).catch(() => {});
      await SafeLog.info('ip_sonuc_button_dosya_finalize_fail', `IP dosya butonu finalize (fail): ${String(neden || 'unknown')}`,
        { klasor: 'ip_state', key: 'button', traceID: traceId, kullaniciID: userId, sendToConsole: false }).catch(() => {});
    } catch {}
  };

  // Sadece komutu kullanan kişi butonları kullanabilsin
  if (stateObj.kullanici_id && String(stateObj.kullanici_id) !== String(userId)) {
    const embed = createErrorEmbed(
      '🚫 Yetkisiz',
      'Bu sonuç sadece komutu kullanan kişi tarafından alınabilir.',
      traceId, guildId, userId
    );
    await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
    return;
  }

  // Sonuç: dosya upload ETME. Sadece API'den gelen şifreli linki gönder.
  const encryptedLink = __extractEncryptedResultLinkFromState(stateObj);

  if (!encryptedLink) {
    const embed = createErrorEmbed(
      'ℹ️ UYARI !',
      'Eğer dm ye sonuç veriler gönderilmemiş ise komutu tekrar kullanın veya hata hala devam ediyorsa yetkililer ile iletişime geçiniz !',
      traceId, guildId, userId
    );
    await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
    await __finalizeIpStateFailIfDosya('encrypted_link_not_found');
    return;
  }

  let dmChannel = null;
  let sentMsg = null;

  try {
    // ✅ DM göndermeden önce 1 saniye bekle (butona basınca akış başlar, link hazır olduktan sonra bekler)
    await sleep(1000);

    // DM kanalı oluştur/al
    dmChannel = await interaction.user.createDM();

    // DM gönder
    sentMsg = await dmChannel.send({
      content: `🔐 Şifreli Sonuç Linki:\n${encryptedLink}`
    });

    // ✅ Gönderimden sonra 1 saniye bekle
    await sleep(1000);

    // ✅ DM'ye gerçekten düşmüş mü kontrol et (fetch)
    // Not: Discord teslimatı kesin doğrulamaz; fetch edilebiliyorsa "başarılı" kabul edilir.
    let fetched = null;
    try {
      fetched = await dmChannel.messages.fetch(sentMsg.id);
    } catch (fetchErr) {
      fetched = null;
    }

    if (!fetched || !fetched.id) {
      const embed = createErrorEmbed(
        '❌ Hata',
        'DM gönderimi doğrulanamadı. Lütfen tekrar deneyin (kullanıcının DM\'leri kapalı olabilir).',
        traceId, guildId, userId
      );
      await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
      await __finalizeIpStateFailIfDosya('dm_verify_failed');
      return;
    }

    // Başarı: state'i finalize et ve butonları kapat (tick tekrar hata basmasın)
    await __markIpStateSuccess(found.filePath, stateObj).catch(() => {});

    const ok = createSuccessEmbed('✅ Gönderildi', 'Şifreli link DM olarak gönderildi.', traceId, guildId, userId);
    await interaction.followUp({ embeds: [ok], ephemeral: true }).catch(() => {});
    return;
  } catch (e) {
    await SafeLog.warn('ip_sonuc_button_hata', `IP sonuç butonu hatası: ${e?.message || String(e)}`, {
      klasor: 'ip_state',
      key: 'button',
      hata: e?.message || String(e),
      traceID: traceId,
      kullaniciID: userId,
      dm_message_id: sentMsg?.id || null,
      sendToConsole: false
    }).catch(() => {});

    const embed = createErrorEmbed(
      '❌ Hata',
      'Sonuç gönderilirken bir sorun oluştu.',
      traceId, guildId, userId
    );
    await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
    await __finalizeIpStateFailIfDosya(e?.message || 'send_failed');
    return;
  }
}


    const odaCommand = client.commands.get('oda');
    if (odaCommand && typeof odaCommand.handleButton === 'function') {
      await odaCommand.handleButton(interaction, buttonId, {
        client,
        db: dbManager,
        dbConnected,
        LogYonetim: SafeLog,
        traceId,
        getSunucuConfig,
        createOdaRecord,
        startOdaGeriSayimTimer,
        closeOdaRecord,
        getEmbedParameters,
        applyEmbedParameters,
        createErrorEmbed,
        createSuccessEmbed,
        createInfoEmbed,
        createWarningEmbed,
        sendUserFriendlyLog
      });
      return;
    }

    if (buttonId && buttonId.startsWith('vip_')) {
      if (!canUseVipCommand(userId)) {
        const embed = createErrorEmbed(
          '🚫 Yetkisiz İşlem',
          'Bu buton **VIP** kullanıcılarına özeldir.',
          traceId, guildId, userId
        );
        await interaction.followUp({ embeds: [embed] });
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

    if (buttonId && buttonId.startsWith('premium_')) {
      if (!canUsePremiumCommand(userId)) {
        const embed = createErrorEmbed(
          '🚫 Yetkisiz İşlem',
          'Bu buton **Premium** kullanıcılarına özeldir.',
          traceId, guildId, userId
        );
        await interaction.followUp({ embeds: [embed]});
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

    for (const [cmdName, cmd] of client.commands) {
      if (buttonId.startsWith(`${cmdName}_`) && typeof cmd.handleButton === 'function') {
        await cmd.handleButton(interaction, buttonId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
		  getEmbedParameters,
          applyEmbedParameters,
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

      await interaction.followUp({ embeds: [errorEmbed] });
    } catch (replyErr) {
    }
  }
}

async function handleModal(interaction, traceId) {
  const modalId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  try {
    try {
      await interaction.deferReply();
    } catch (deferErr) {
    }

    const odaCommand = client.commands.get('oda');
    if (odaCommand && typeof odaCommand.handleModal === 'function') {
      await odaCommand.handleModal(interaction, modalId, {
        client,
        db: dbManager,
        dbConnected,
        LogYonetim: SafeLog,
        traceId,
        getSunucuConfig,
        createOdaRecord,
        startOdaGeriSayimTimer,
        getEmbedParameters,
        applyEmbedParameters,
        createErrorEmbed,
        createSuccessEmbed,
        createInfoEmbed,
        createWarningEmbed,
        sendUserFriendlyLog
      });
      return;
    }

    for (const [cmdName, cmd] of client.commands) {
      if (modalId.startsWith(`${cmdName}_`) && typeof cmd.handleModal === 'function') {
        await cmd.handleModal(interaction, modalId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim:  SafeLog,
          traceId,
		  getEmbedParameters,
          applyEmbedParameters,
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
        await interaction.reply({ embeds: [errorEmbed] });
      }
    } catch (replyErr) {
    }
  }
}

async function handleSelectMenu(interaction, traceId) {
  const menuId = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const selectedValues = interaction.values;

  try {
    try {
      await interaction.deferUpdate();
    } catch (deferErr) {
    }

    for (const [cmdName, cmd] of client.commands) {
      if (menuId.startsWith(`${cmdName}_`) && typeof cmd.handleSelectMenu === 'function') {
        await cmd.handleSelectMenu(interaction, menuId, {
          client,
          db: dbManager,
          dbConnected,
          LogYonetim: SafeLog,
          traceId,
          selectedValues,
		  getEmbedParameters,
          applyEmbedParameters,
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
      klasor: 'bot_genel',
      key: 'interaction',
      kullaniciID: userId,
      traceID: traceId
    });

    try {
      const errorEmbed = createErrorEmbed(
        '❌ Hata',
        'Seçim işlenirken bir sorun oluştu.',
        traceId, guildId, userId
      );

      await interaction.followUp({ embeds: [errorEmbed] });
    } catch (replyErr) {
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
        db:  dbManager,
        dbConnected,
        LogYonetim: SafeLog,
        traceId,
        focusedOption
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
    }
  }
}


async function handleContextMenu(interaction, traceId) {
  const commandName = interaction.commandName;
  const userId = interaction.user?.id;
  const guildId = interaction.guildId;
  let consumedUsageLimit = null;

  try {
    const { cmd, type } = findCommand(commandName);

    if (!cmd) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut mevcut değil veya yüklenemedi.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Bakım blokajı
    if (isCommandBakimda(commandName) && !isBakimYetkilisi(userId)) {
      const embed = createWarningEmbed(
        '🔧 Komut Bakımda',
        `**${commandName}** komutu şu anda bakımda ve geçici olarak devre dışı bırakıldı.\n\n⏳ Lütfen daha sonra tekrar deneyin.`,
        guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (shouldBlockCommandByPrivacyMask(type)) {
      const embed = createErrorEmbed(
        '❌ Komut Bulunamadı',
        'Bu komut şu anda kullanılamıyor.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Yetki kontrolü (komut modülünde permission varsa, aynı helper ile kontrol et)
    if (cmd.permission && !await hasPermission(userId, cmd.permission)) {
      const embed = createErrorEmbed(
        '🚫 Yetkin Yok',
        'Bu işlemi yapmaya yetkin yok.',
        traceId, guildId, userId
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const usageLimitResult = await consumeBotCommandUsageLimit(interaction, traceId);
    if (!usageLimitResult?.allowed) {
      return;
    }
    if (usageLimitResult?.consumed) {
      consumedUsageLimit = usageLimitResult;
    }

    // Context menülerde deferReply gerekebilir
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (deferErr) {
      if (consumedUsageLimit?.consumed) {
        await rollbackConsumedBotCommandUsageLimit(userId, consumedUsageLimit).catch(() => {});
        consumedUsageLimit = null;
      }
    }
    const dosyaYazimKategori = getCommandPrivacyCategory(type, cmd);

    await runWithFileWriteContext({
      category: dosyaYazimKategori,
      commandName,
      guildId,
      userId,
      traceId
    }, async () => {
      await cmd.execute(interaction, {
      client,
      db: dbManager,
      dbConnected,
      LogYonetim: SafeLog,
      traceId,
      PANEL_DEAKTIF_SANIYE,
      COP_TEMIZLIK_DIR,
      FILE_DELETE_DELAY_MS,
      getSunucuConfig,
      getEmbedParameters,
      applyEmbedParameters,
      createOdaRecord,
      startOdaGeriSayimTimer,
      closeOdaRecord,
      deleteOdaRecord,
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
      forceRefreshYetkiCache,
      forceRefreshConfigCache,
      sendUserFriendlyLog,
      sendSunucuLog,
      isCommandMasked,
      getEnvMaskValue,
      checkKomutKisitlamasi,
      checkOdaKomutuIzni
      });
    });

    await SafeLog.kullaniciKomut(userId, commandName, guildId, traceId);

  } catch (e) {
    if (consumedUsageLimit?.consumed) {
      await rollbackConsumedBotCommandUsageLimit(userId, consumedUsageLimit).catch(() => {});
      consumedUsageLimit = null;
    }

    await SafeLog.error('context_menu_error', `Context menu hatası: ${commandName}`, {
      klasor: 'bot_genel',
      key: 'interaction',
      hata: e.message,
      traceID: traceId,
      kullaniciID: userId
    });

    const errorEmbed = createErrorEmbed(
      '❌ Hata',
      'İşlem gerçekleştirilirken bir sorun oluştu.',
      traceId, guildId, userId
    );

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    } catch {}
  }
}


// ==================== ANA INTERACTION HANDLER ====================

client.on('interactionCreate', async (interaction) => {
  const traceId = crypto.randomUUID ?  crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  try {

    if (interaction.isChatInputCommand()) {
      const rlOk = await handleKullaniciKomutRateLimit(interaction, traceId);
      if (!rlOk) return;
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
      // Yetki hatası dahil, spam denemelerde de rate limit çalışsın
      const rlOk = await handleKullaniciKomutRateLimit(interaction, traceId);
      if (!rlOk) return;
      await handleContextMenu(interaction, traceId);
    }
  } catch (e) {
    await SafeLog.critical('interaction_fatal', 'Fatal interaction hatası', {
      klasor:  'bot_genel',
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
          try { await __applyCommandTrackingSnapshotToConfigs({ onlyUserId: message.author.id }); } catch {}
        } catch (veriErr) {
        }
      }

      await SafeLog.info('dm_mesaj', 'DM mesajı alındı', {
        klasor: 'dm',
        key: 'mesaj',
        kullaniciID: message.author.id
      });
    }
  } catch (e) {
    await SafeLog.error('message_error', `Message event hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'event'
    });
  }
});

// ==================== GUILD EVENTS ====================

client.on('guildCreate', async (guild) => {
  try {
    await SafeLog.info('guild_create', `Yeni sunucu:  ${guild.name}`, {
      klasor: 'bot_genel',
      key:  'guild',
      guildID: guild.id,
      memberCount: guild.memberCount
    });

    if (VeriYonetim && typeof VeriYonetim.kaydetSunucuBilgisi === 'function') {
      try {
        await VeriYonetim.kaydetSunucuBilgisi(guild, client);
        try { await __applyCommandTrackingSnapshotToConfigs({ onlyGuildId: guild.id }); } catch {}
      } catch (veriErr) {
      }
    }
  } catch (e) {
    await SafeLog.error('guild_create_error', `Guild create hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'event'
    });
  }
});

client.on('guildDelete', async (guild) => {
  try {
    await SafeLog.info('guild_delete', `Sunucudan çıkıldı: ${guild.name}`, {
      klasor: 'bot_genel',
      key: 'guild',
      guildID: guild.id
    });

    forceRefreshConfigCache(guild.id);
  } catch (e) {
    await SafeLog.error('guild_delete_error', `Guild delete hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key:  'event'
    });
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await SafeLog.debug('member_add', `Yeni üye: ${member.user.tag}`, {
      klasor: 'bot_genel',
      key: 'member',
      guildID: member.guild.id
    });
  } catch (e) {
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await SafeLog.debug('member_remove', `Üye ayrıldı: ${member.user.tag}`, {
      klasor: 'bot_genel',
      key: 'member',
      guildID:  member.guild.id
    });
  } catch (e) {
  }
});

// ==================== READY EVENT ====================

client.once('ready', async () => {
  await SafeLog.sistemBasladi();

  await SafeLog.info('bot_ready', `Bot hazır:  ${client.user.tag}`, {
    klasor: 'bot_genel',
    key: 'startup',
    sunucuSayisi: client.guilds.cache.size,
    komutSayisi:
      client.commands.size +
      client.ownerCommands.size +
      client.vipCommands.size +
      client.premiumCommands.size
  });

  await sendSystemWebhook(
    'INFO',
    '✅ Bot Başladı',
    `Bot başarıyla giriş yaptı ve hazır durumda.\n\n• Kullanıcı: **${client.user.tag}**\n• Sunucu: **${client.guilds.cache.size}**`,
    [
      { name: 'Komut Sayısı', value: String(client.commands.size + client.ownerCommands.size + client.vipCommands.size + client.premiumCommands.size), inline: true },
      { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true }
    ]
  );


  startYetkiFileWatchers();
  startYetkiKontrolTick();
  
  // Yardım komutu state tick (dosya tabanlı, restart-safe)
  await start1saniye_global_tick_geri_sayim_mekanizmasi();
  
    // Bakım sistem dosyalarını kontrol et
  await ensureBakimDirs();
  const bakimdaKomutlar = getBakimdaKomutlar();
  if (bakimdaKomutlar.length > 0) {
    await SafeLog.info('bakim_komutlar_aktif', `Bakımda olan komutlar yüklendi`, {
      klasor: 'bot_genel',
      key: 'bakim',
      komutSayisi: bakimdaKomutlar.length,
      komutlar: bakimdaKomutlar.join(', ')
    });
  }

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
      await SafeLog.warn(
        'sunucu_guncelleme_hata',
        `Sunucu güncelleme hatası: ${veriErr.message}`,
        {
          klasor: 'bot_genel',
          key: 'startup'
        }
      );
    }
  }

  // Komut tracking alanlarını (config dosyaları oluştuktan sonra) bir kere senkronla
  try {
    await __applyCommandTrackingSnapshotToConfigs();
  } catch {}

  await restoreActiveOdaTimers();

  // ==================== PROMOSYON KODLARI SİSTEMİ BAŞLAT ====================
  try {
    // DB adapter'ı enjekte et
    if (PromoModul && typeof PromoModul.initDB === 'function') {
      await PromoModul.initDB({ dbManager });
    }
    promoSystemInitialized = true;

    await SafeLog.info(
      'promo_sistem_basladi',
      'Promosyon kodları sistemi başlatıldı',
      {
        klasor: 'bot_genel',
        key: 'startup'
      }
    );
  } catch (e) {
    await SafeLog.error(
      'promo_sistem_baslatma_hatasi',
      `Promosyon sistemi başlatma hatası: ${e.message}`,
      {
        klasor: 'bot_genel',
        key: 'startup'
      }
    );
  }



  // Açılış bütünlük raporu (paket kaybı/atlanan içerikler) - sadece 1 kez
  try { await __printStartupPacketLossOnce(); } catch {}

// ==================== SİSTEM TAM HAZIR ====================
try {
  await SafeLog.success('sistem_tam_hazir', '🟢 Tüm sistemler aktif — Bot tamamen hazır!', {
    klasor: 'bot_genel',
    key: 'startup',
    kullanici: client?.user?.tag || 'N/A',
    sunucuSayisi: client?.guilds?.cache?.size ?? 0,
    uptime_s: Math.floor(process.uptime())
  });
  await __writeKomutYuklemeLog('global', {
    ok: true,
    mesaj: 'Bot tamamen hazır',
    kullanici: client?.user?.tag || 'N/A',
    sunucuSayisi: client?.guilds?.cache?.size ?? 0
  });
} catch {}
});


// ==================== CLIENT ERROR EVENTS ====================

client.on('error', async (error) => {
  await SafeLog.error('client_error', 'Discord client hatası', {
    klasor:  'bot_genel',
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


client.on('shardError', async (error, shardId) => {
  await SafeLog.error('shard_error', `Shard ${shardId} hatası`, {
    klasor: 'bot_genel',
    key: 'client',
    shardId,
    hata: error.message
  });

  await sendErrorWebhook('ERROR', 'shard_error', `Shard ${shardId}:  ${error.message}`, {});
});

client.on('shardReady', async (shardId, unavailableGuilds) => {
  await SafeLog.info('shard_ready', `Shard ${shardId} hazır`, {
    klasor: 'bot_genel',
    key: 'client',
    shardId
  });
  await sendSystemWebhook('INFO','🧩 Shard Ready', `Shard hazır.\n• Shard: **${shardId}**\n• Sunucular: **${(unavailableGuilds?.size ?? client.guilds.cache.size) ?? 'N/A'}**`, []);

});

client.on('shardDisconnect', async (event, shardId) => {
  await SafeLog.warn('shard_disconnect', `Shard ${shardId} bağlantısı kesildi`, {
    klasor: 'bot_genel',
    key: 'client',
    shardId
  });
  await sendSystemWebhook('WARN','🔌 Shard Disconnect', `Shard bağlantısı koptu.\n• Shard: **${shardId}**\n• CloseEvent: **${event?.code ?? 'N/A'}**`, [{ name: 'Reason', value: String(event?.reason || 'N/A').substring(0, 900) }]);

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
    klasor: 'bot_genel',
    key: 'client',
    shardId,
    replayedEvents
  });
  await sendSystemWebhook('INFO','🔁 Shard Resume', `Shard devam etti (resume).\n• Shard: **${shardId}**\n• Replay: **${replayedEvents ?? 'N/A'}**`, []);

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
    // Bakım cache'ini temizle
  forceRefreshBakimCache();

  if (odaGeriSayimAktif) {
    stopOdaGeriSayim();
  }

  if (copTemizlikAktif) {
    stopCopTemizlik();
  }

  isShuttingDown = true;

  await SafeLog.info('shutdown_start', `Bot kapatılıyor (Sebep: ${reason})`, {
    klasor: 'bot_genel',
    key: 'shutdown',
    reason,
    uptime: process.uptime()
  });

  await sendSystemWebhook(
    'WARN',
    '🛑 Bot Kapanıyor',
    `Graceful shutdown başlatıldı.\n\n• Sebep: **${reason}**`,
    [
      { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true },
      { name: 'Sunucu', value: client?.guilds?.cache?.size ? String(client.guilds.cache.size) : 'N/A', inline: true }
    ]
  

  );

  // IP komutu: yarım kalan state'leri kapanışta direkt 'süre dolmuş gibi' işaretle
  await __ipStateBulkMarkAndDisable('shutdown');
  // Genel (muaf olmayan) state klasörleri: kapanışta yarım kalanları işaretle
  await __genericStateBulkMarkAndDisable('shutdown');
const shutdownTimeout = setTimeout(() => {
    process.exit(1);
  }, 15000);

  try {
    stopYetkiFileWatchers();
    stopYetkiKontrolTick();

    for (const [odaId, timerId] of activeOdaTimers) {
      clearInterval(timerId);
    }
    activeOdaTimers.clear();

    // Promo tick aktif ise bekle
    while (promoTickActive) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (dbManager && typeof dbManager.shutdown === 'function') {
      try {
        await dbManager.shutdown(5000);
      } catch (dbErr) {
        // yut
      }
    }

    if (client) {
      try {
        await client.destroy();
      } catch (clientErr) {
        // yut
      }
    }

    if (LogYonetim && typeof LogYonetim.flushQueue === 'function') {
      try {
        await LogYonetim.flushQueue();
      } catch (logErr) {
        // yut
      }
    }

    await SafeLog.sistemKapandi();
  } catch (e) {
    // yut
  }

  clearTimeout(shutdownTimeout);

  const exitCode = (reason === 'SIGINT' || reason === 'SIGTERM') ? 0 : 1;
  process.exit(exitCode);
}


// ==================== SHUTDOWN SİNYALLERİ ====================

process.on('SIGINT', async () => {
  console.log('\n[SİSTEM] SIGINT sinyali alındı, graceful shutdown başlatılıyor...');
  stopOdaGeriSayim();
  stopCopTemizlik();
  await gracefulShutdown('SIGINT');
});

process.on('SIGTERM', async () => {
  console.log('\n[SİSTEM] SIGTERM sinyali alındı, graceful shutdown başlatılıyor...');
  stopOdaGeriSayim();
  stopCopTemizlik();
  await gracefulShutdown('SIGTERM');
});

process.on('SIGHUP', async () => {
  console.log('\n[SİSTEM] SIGHUP sinyali alındı, graceful shutdown başlatılıyor...');
  stopOdaGeriSayim();
  stopCopTemizlik();
  await gracefulShutdown('SIGHUP');
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

setInterval(async () => {
  if (isShuttingDown) return;

  try {
    if (VeriYonetim && typeof VeriYonetim.guncelleTumSunucular === 'function') {
      const sonuc = await VeriYonetim.guncelleTumSunucular(client);
      await SafeLog.info('sunucu_otomatik_guncelleme', 'Sunucu verileri otomatik güncellendi', {
        klasor: 'bot_genel',
        key: 'veri',
        basarili: sonuc.basarili,
        hatali: sonuc.hatali
      });
    }
  } catch (e) {
    await SafeLog.error('sunucu_update_error', `Sunucu güncelleme hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'veri'
    });
  }
}, SUNUCU_GUNCELLEME_ARALIK);

// ==================== PROMOSYON KODLARI TICK MEKANIZMASI ====================

let promoSystemInitialized = false;

function __promoFindMethod(...names) {
  for (const name of names.flat()) {
    if (typeof PromoModul?.[name] === 'function') {
      return PromoModul[name].bind(PromoModul);
    }
  }
  return null;
}

function __promoNowDateTimeFallback() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function __promoBuildExpiredYetkiQueryFallback(tickNow) {
  return {
    sql: `SELECT id, kod_id, kullanici_id, verilecek_yetki_turu, yetki_bitis_tarihi, yetki_verildi_mi, islem_durumu, iptal_tarihi, iptal_sebebi
          FROM promosyon_kodlar
          WHERE yetki_verildi_mi = 1
            AND yetki_bitis_tarihi IS NOT NULL
            AND yetki_bitis_tarihi <= ?
            AND (iptal_tarihi IS NULL OR iptal_tarihi = '' OR iptal_tarihi = 'yok')`,
    params: [tickNow]
  };
}

async function __ensurePromoSystemReady() {
  if (promoSystemInitialized) return true;
  if (!PromoModul) return false;

  const initFn = __promoFindMethod('initDB', 'initDb', 'initializeDB', 'initializeDb', 'setDB', 'setDb', 'setDbManager', 'injectDbManager');
  if (!initFn) {
    promoSystemInitialized = true;
    return true;
  }

  try {
    if (dbManager) {
      await initFn({ dbManager, db: dbManager, manager: dbManager });
    } else {
      await initFn({ dbManager: null, db: null, manager: null });
    }
    promoSystemInitialized = true;
    return true;
  } catch (e) {
    await SafeLog.warn('promo_lazy_init_hata', `Promosyon sistemi lazy init hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'promo',
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
    return false;
  }
}

async function __promoCallSafe(methodNames, fallbackValue, ...args) {
  const fn = __promoFindMethod(methodNames);
  if (!fn) return fallbackValue;

  try {
    return await fn(...args);
  } catch (e) {
    await SafeLog.warn('promo_method_hata', `Promosyon modülü çağrısı başarısız: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'promo',
      methodler: Array.isArray(methodNames) ? methodNames.join(',') : String(methodNames || ''),
      hata: e.message,
      sendToConsole: false
    }).catch(() => {});
    return fallbackValue;
  }
}

const PROMO_TICK_INTERVAL = Math.max(
  15000,
  Number(process.env.PROMO_TICK_INTERVAL_MS || 15000)
); // Varsayılan 1 dakika

let promoTickActive = false;

async function runPromoTick() {
  if (isShuttingDown) return;

  if (promoTickActive) {
    await SafeLog.debug('promo_tick_skip', 'Promo tick zaten çalışıyor, atlanıyor', {
      klasor: 'bot_genel',
      key: 'promo'
    });
    return;
  }

  promoTickActive = true;
  const tickStartTime = Date.now();

  try {
    await __ensurePromoSystemReady();

    const tickNowFn = __promoFindMethod('nowDateTimeString', 'getNowDateTimeString', 'nowDateTime', 'getNowDateTime');
    const tickNow = tickNowFn ? String(await tickNowFn()) : __promoNowDateTimeFallback();
    await SafeLog.debug('promo_tick_basladi', 'Promosyon tick başladı', {
      klasor: 'bot_genel',
      key: 'promo',
      zaman: tickNow
    });

    // ============== ADIM 1: SÜRESI BİTMİŞ KODLARI DEAKTIF ET ==============
    const expireResult = await __promoCallSafe(
      ['markPromosyonKodExpiredIfNeeded', 'markExpiredPromosyonKodlar', 'kontrolEtVeDeaktifEtExpiredKodlar', 'checkExpiredPromosyonKodlar'],
      { ok: false, expiredCount: 0, expiredIds: [] }
    );
    if (expireResult.ok && expireResult.expiredCount > 0) {
      await SafeLog.info(
        'promo_expired_marked',
        `${expireResult.expiredCount} promosyon kodu deaktif edildi`,
        {
          klasor: 'bot_genel',
          key: 'promo',
          expiredIds: (expireResult.expiredIds || []).slice(0, 10)
        }
      );
    }

    // ============== ADIM 2: STATE SENKRONIZASYONU ==============
    const syncResult = await __promoCallSafe(
      ['syncStateWithPromosyonKodlar', 'syncPromosyonKodlarState', 'syncPromosyonKodState', 'senkronizePromosyonKodlar'],
      { ok: false, added: 0, updated: 0, extras: null }
    );
    if (syncResult.ok && (syncResult.added > 0 || syncResult.updated > 0)) {
      await SafeLog.info('promo_state_synced', 'State senkronize edildi', {
        klasor: 'bot_genel',
        key: 'promo',
        added: syncResult.added,
        updated: syncResult.updated,
        extras: syncResult.extras
      });
    }

    // ============== ADIM 3: DB'DEN SÜRESI BİTEN YETKİLERİ YAKALAMA ==============
    if (dbConnected && dbManager) {
      try {
        const queryBuilder = await __promoCallSafe(
          ['buildExpiredYetkiQuery', 'buildExpiredYetkilerQuery', 'getExpiredYetkiQuery'],
          __promoBuildExpiredYetkiQueryFallback(tickNow),
          tickNow
        );
        const expiredYetkiRows = await dbManager.query(
          'main',
          queryBuilder.sql,
          queryBuilder.params,
          { queue: true, logQuery: false }
        );

        if (expiredYetkiRows && expiredYetkiRows.length > 0) {
          await SafeLog.info(
            'promo_expired_yetki_found',
            `${expiredYetkiRows.length} süresi bitmiş yetki bulundu`,
            {
              klasor: 'bot_genel',
              key: 'promo',
              count: expiredYetkiRows.length
            }
          );

          let processedCount = 0;

         // ============== ADIM 4: HER YETKI İÇİN YETKİ GERİ AL ==============
for (const row of expiredYetkiRows) {
  try {
    const yetkiTuru = row?.verilecek_yetki_turu; // 'vip' | 'premium' | 'admin' | 'hicbiri'
    const kullaniciId = row?.kullanici_id;
    const dbId = row?.id;
    const kodId = row?.kod_id;

    if (yetkiTuru !== 'vip' && yetkiTuru !== 'premium' && yetkiTuru !== 'admin') {
      // hicbiri ise yetki geri alınacak bir şey yok
      await dbManager.query(
        'main',
        `UPDATE promosyon_kodlar 
         SET yetki_verildi_mi = 0, 
             islem_durumu = 'basarili', 
             son_kontrol_tarihi = NOW(), 
             hata_mesaji = 'yok',
             iptal_tarihi = IF(iptal_tarihi = 'yok' OR iptal_tarihi IS NULL, ?, iptal_tarihi),
             iptal_sebebi = IF(iptal_tarihi = 'yok' OR iptal_tarihi IS NULL, ?, iptal_sebebi)
         WHERE id = ?`,
        [
          tickNow,                // iptal_tarihi
          `suresi_bitti:hicbiri`, // iptal_sebebi
          dbId
        ],
        { queue: true, logQuery: false }
      );

      // Yetki artık yok + süresi bitmiş -> DB satırını temizle
      try {
        await dbManager.query(
          'main',
          `DELETE FROM promosyon_kodlar
           WHERE id = ?
             AND yetki_verildi_mi = 0
             AND (yetki_bitis_tarihi <= ? OR yetki_bitis_tarihi IS NULL)`,
          [dbId, tickNow],
          { queue: true, logQuery: false }
        );

        await SafeLog.info('promo_db_satir_silindi', 'Yetkisi biten kayıt DB’den silindi', {
          klasor: 'bot_genel',
          key: 'promo',
          dbId,
          kullaniciId,
          yetkiTuru,
          kodId
        });
      } catch (delErr) {
        await SafeLog.warn('promo_db_satir_silme_hatasi', `DB satır silme hatası: ${delErr.message}`, {
          klasor: 'bot_genel',
          key: 'promo',
          dbId,
          hata: delErr.message
        });
      }

      processedCount++;
      continue;
    }

    // Yetki dosyasından sil
    const removeResult = await __promoCallSafe(
      ['removeYetkiFromUser', 'removeUserYetki', 'revokeYetkiFromUser', 'removePromotionYetkiFromUser'],
      { ok: false },
      { yetkiTuru, kullaniciId }
    );

    if (removeResult.ok) {
      // DB güncelle
      await dbManager.query(
        'main',
        `UPDATE promosyon_kodlar 
         SET yetki_verildi_mi = 0, 
             islem_durumu = 'basarili', 
             son_kontrol_tarihi = NOW(), 
             hata_mesaji = 'yok',
             iptal_tarihi = IF(iptal_tarihi = 'yok' OR iptal_tarihi IS NULL, ?, iptal_tarihi),
             iptal_sebebi = IF(iptal_tarihi = 'yok' OR iptal_tarihi IS NULL, ?, iptal_sebebi)
         WHERE id = ?`,
        [
          tickNow,
          `suresi_bitti:${yetkiTuru}`, // vip/premium/admin
          dbId
        ],
        { queue: true, logQuery: false }
      );

      // Yetki artık yok + süresi bitmiş -> DB satırını temizle
      try {
        await dbManager.query(
          'main',
          `DELETE FROM promosyon_kodlar
           WHERE id = ?
             AND yetki_verildi_mi = 0
             AND (yetki_bitis_tarihi <= ? OR yetki_bitis_tarihi IS NULL)`,
          [dbId, tickNow],
          { queue: true, logQuery: false }
        );

        await SafeLog.info('promo_db_satir_silindi', 'Yetkisi biten kayıt DB’den silindi', {
          klasor: 'bot_genel',
          key: 'promo',
          dbId,
          kullaniciId,
          yetkiTuru,
          kodId
        });
      } catch (delErr) {
        await SafeLog.warn('promo_db_satir_silme_hatasi', `DB satır silme hatası: ${delErr.message}`, {
          klasor: 'bot_genel',
          key: 'promo',
          dbId,
          hata: delErr.message
        });
      }

      await SafeLog.success('promo_yetki_geri_alindi', `Yetki geri alındı: ${yetkiTuru}`, {
        klasor: 'bot_genel',
        key: 'promo',
        kullaniciId,
        yetkiTuru,
        kodId
      });

      processedCount++;
    } else {
      // DB hatası olarak işaretle
      await dbManager.query(
        'main',
        `UPDATE promosyon_kodlar 
         SET islem_durumu = 'basarisiz', 
             son_kontrol_tarihi = NOW(), 
             hata_mesaji = 'Yetki geri alınamadı'
         WHERE id = ?`,
        [dbId],
        { queue: true, logQuery: false }
      );

      await SafeLog.warn('promo_yetki_geri_alma_hatasi', 'Yetki geri alınamadı', {
        klasor: 'bot_genel',
        key: 'promo',
        kullaniciId,
        yetkiTuru
      });
    }
  } catch (rowErr) {
    await SafeLog.error('promo_row_process_error', `Satır işleme hatası: ${rowErr.message}`, {
      klasor: 'bot_genel',
      key: 'promo',
      hata: rowErr.message
    });
  }
}

await SafeLog.info(
  'promo_yetki_geri_alma_tamamlandi',
  `${processedCount}/${expiredYetkiRows.length} yetki geri alındı`,
  {
    klasor: 'bot_genel',
    key: 'promo',
    processedCount,
    totalCount: expiredYetkiRows.length
  }
);

        }
      } catch (dbErr) {
        await SafeLog.error('promo_db_query_error', `DB sorgu hatası: ${dbErr.message}`, {
          klasor: 'bot_genel',
          key: 'promo',
          hata: dbErr.message
        });
      }
    } else {
      await SafeLog.warn('promo_db_not_connected', 'DB bağlı değil, yetki geri alma atlanıyor', {
        klasor: 'bot_genel',
        key: 'promo'
      });
    }

    const tickDuration = Date.now() - tickStartTime;
    await SafeLog.info('promo_tick_tamamlandi', 'Promosyon tick tamamlandı', {
      klasor: 'bot_genel',
      key: 'promo',
	  sendToConsole: false,
      sureMiliSaniye: tickDuration
    });
  } catch (e) {
    await SafeLog.critical('promo_tick_error', `Promosyon tick kritik hatası: ${e.message}`, {
      klasor: 'bot_genel',
      key: 'promo',
      hata: e.message,
      stack: e.stack?.split('\n')[0]
    });
  } finally {
    promoTickActive = false;
  }
}

// Promo tick'i başlat
setInterval(runPromoTick, PROMO_TICK_INTERVAL);
setTimeout(() => {
  runPromoTick().catch(() => {});
}, Math.min(5000, PROMO_TICK_INTERVAL));


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
      premium: getEnvMaskValue('premium'),
      admin: getEnvMaskValue('admin')
    },
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    timestamp: new Date().toISOString()
  };
}

async function getSystemStats() {
  const health = getHealthStatus();

  let dbStats = null;
  if (dbManager && typeof dbManager.getStats === 'function') {
    try {
      dbStats = dbManager.getStats();
    } catch (e) {
      dbStats = null;
    }
  }

  let veriStats = null;
  if (VeriYonetim && typeof VeriYonetim.getVeriIstatistikleri === 'function') {
    try {
      veriStats = await VeriYonetim.getVeriIstatistikleri();
    } catch (e) {
      veriStats = null;
    }
  }

  let logStats = null;
  if (LogYonetim && typeof LogYonetim.getLogStats === 'function') {
    try {
      logStats = await LogYonetim.getLogStats();
    } catch (e) {
      logStats = null;
    }
  }

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
    database: dbStats,
    veri: veriStats,
    log: logStats,
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
      admin: getEnvMaskValue('admin'),
      checkInterval: ENV_MASK_CHECK_INTERVAL + 'ms'
    }
  };
}

// ==================== BOT BAŞLATMA ====================

async function startBot() {
  const __startupHr = process.hrtime.bigint();
  const startTime = Date.now();

// ════════════════════════════════════════════════════════════════════
// ✅ STARTUP BANNER (CMD/Terminal uyumlu)
// ════════════════════════════════════════════════════════════════════
try {
  console.log('\n================================');
  console.log('  🤖 BOT BAŞLATILIYOR...');
  console.log('================================\n');
} catch {}


  await SafeLog.info('bot_starting', 'Bot başlatılıyor...', {
    klasor: 'bot_genel',
    key: 'startup'
  });

  const envResult = validateEnv();
  if (!envResult.valid) {
    await SafeLog.critical('env_invalid', 'ENV doğrulaması başarısız - Bot başlatılamıyor', {
      klasor: 'bot_genel',
      key: 'startup',
      errors: envResult.errors.join('; ')
    });
    process.exit(1);
  }

  await ensureDirs();

  await initializeDatabase();
  if (dbConnected && DatabaseManager) {
    await startOdaGeriSayim();
  }
  // Çöp temizlik DB'den bağımsızdır: her koşulda çalışsın ✅
  await startCopTemizlik();

  // ✨ KOMUTLARI YÜKLEVe KAYDET
  const commandResult = await registerAndLoadCommands();

  if (commandResult) {
    await SafeLog.info('komutlar_yukleme_tamamlandi', '📋 Komut Yükleme Tamamlandı', {
      klasor: 'bot_genel',
      key: 'startup',
      'Total Komutlar': commandResult.total,
      'Eklenen': commandResult.added || 0,
      'Değişen': commandResult.changed || 0,
      'Silinen': commandResult.deleted || 0,
      'Kayıt Durumu': commandResult.registered ? '✅ API\'ye Gönderildi' : '⚠️ Atlandı',
      'Yükleme Süresi': `${commandResult.loadTime}ms`,
      'Hata': commandResult.error ? `❌ ${commandResult.error}` : '✅ Yok'
    });

// ✅ İstenen: Komutlar tamamen yüklendikten sonra özet (console + log) bas
try {
  if (typeof __logKomutYuklemeOzetToConsoleAndLogs === 'function') {
    await __logKomutYuklemeOzetToConsoleAndLogs(__lastCommandTrackingSnapshot || {}, { sunucuSayisi: client?.guilds?.cache?.size ?? 0 });
  }
} catch {}

  }

  const vipUsers = getYetkiliKullanicilar('vip');
  const premiumUsers = getYetkiliKullanicilar('premium');
  let adminCount = 0;
  try {
    const admins = await getAdmins();
    adminCount = admins.length;
  } catch (e) {}

  await SafeLog.info('yetki_yukleme_tamamlandi', '🔐 Yetki Sistemi Yüklendi', {
    klasor: 'bot_genel',
    key: 'startup',
    'Bot Sahibi': BOT_OWNER_ID ? `✅ ${BOT_OWNER_ID}` : '❌ Tanımsız',
    'Admin Sayısı': adminCount,
    'VIP Kullanıcı': vipUsers.length,
    'Premium Kullanıcı': premiumUsers.length
  });

  await SafeLog.info('env_maske_durumu', '🎭 ENV Maske Parametreleri', {
    klasor: 'bot_genel',
    key: 'startup',
    'UCRETSIZ Gizlilik': getEnvMaskValue('ucretsiz') ? '🔒 Aktif' : '🔓 Pasif',
    'VIP Gizlilik': getEnvMaskValue('vip') ? '🔒 Aktif' : '🔓 Pasif',
    'PREMIUM Gizlilik': getEnvMaskValue('premium') ? '🔒 Aktif' : '🔓 Pasif',
    'ADMIN Gizlilik': getEnvMaskValue('admin') ? '🔒 Aktif' : '🔓 Pasif'
  });

  await SafeLog.info('komut_context_ayarlari', '🌍 Komut Context Ayarları', {
    klasor: 'bot_genel',
    key: 'startup',
    'DM Aktif': COMMAND_CONTEXT_SETTINGS.dmAktif ? '✅ Evet' : '❌ Hayır',
    'Sunucu Aktif': COMMAND_CONTEXT_SETTINGS.sunucuAktif ? '✅ Evet' : '❌ Hayır',
    'Contexts': COMMAND_CONTEXT_SETTINGS.contexts.join(', '),
    'Integration Types': COMMAND_CONTEXT_SETTINGS.integrationTypes.join(', ')
  });

  try {
    await client.login(TOKEN);
    
    const loadTime = Math.max(1, Math.round(Number(process.hrtime.bigint() - __startupHr) / 1e6));
    await SafeLog.success('bot_basarili_basladi', `✅ Bot Başarıyla Başlatıldı (${loadTime}ms)`, {
      klasor: 'bot_genel',
      key: 'startup',
      sure: loadTime,
      sunucuSayisi: client.guilds.cache.size,
      kullaniciSayisi: client.users.cache.size,
      kanalSayisi: client.channels.cache.size
    });
  } catch (loginErr) {
    await SafeLog.critical('login_failed', `❌ Discord Login Başarısız: ${loginErr.message}`, {
      klasor: 'bot_genel',
      key: 'startup',
      hata: loginErr.message
    });

    await sendErrorWebhook('CRITICAL', 'login_failed', loginErr.message, {});
    await gracefulShutdown('LOGIN_FAILED');
  }
}

startBot().catch(async (e) => {
  await SafeLog.critical('startup_fatal', `❌ Bot Başlatma Hatası: ${e.message}`, {
    klasor: 'bot_genel',
    key: 'startup',
    hata: e.message
  });

  await sendErrorWebhook('CRITICAL', 'startup_fatal', e.message, {});
  await gracefulShutdown('STARTUP_FATAL');
});

// ==================== MODÜL EXPORT ====================

module.exports = {
  client,
  dbManager,
  get dbConnected() { return dbConnected; },
  SafeLog,
  getEnvMaskValue,
  isCommandMasked,
  isOwner,
  isAdmin,
  hasPermission,
  isVipUser,
  isPremiumUser,
  canUseVipCommand,
  canUsePremiumCommand,
  getBakimdaKomutlar,
  getBakimYetkililer,
  isCommandBakimda,
  isBakimYetkilisi,
  forceRefreshBakimCache,
  ensureBakimDirs,
  BAKIM_KOMUTLAR_DIR,
  BAKIM_YETKILI_FILE,
  getUserRutbe,
  getYetkiliKullanicilar,
  getAdmins,
  forceRefreshYetkiCache,
  getSunucuConfig,
  forceRefreshConfigCache,
  getSunucuLogKanalId,
  sendSunucuLog,
  sendUserFriendlyLog,
  getEmbedParameters,
  applyEmbedParameters,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  createWarningEmbed,
  createOdaRecord,
  closeOdaRecord,
  startOdaGeriSayimTimer,
  restoreActiveOdaTimers,
  get activeOdaTimers() { return activeOdaTimers; },
  PromoModul,
  runPromoTick,
  get promoTickActive() { return promoTickActive; },
  getHealthStatus,
  getSystemStats,
  gracefulShutdown,
  formatUptime,
  formatBytes,
  formatDuration,
  queueApiRequest,
  sendErrorWebhook,
  PANEL_DEAKTIF_SANIYE,
  SUNUCU_GUNCELLEME_ARALIK,
  COP_TEMIZLIK_DIR,
  FILE_DELETE_DELAY_MS,
  UCRETSIZ_KOMUTLAR_DIR,
  OWNER_KOMUT_DIR,
  VIP_KOMUT_DIR,
  PREMIUM_KOMUT_DIR,
  
  
  LOGLAR_ROOT,
  CACHE_DIR,
  BOT_OWNER_ID,
  SUNUCU_VERILER_DIR,
  DM_VERILER_DIR,
  BASE_DIR,
  RUTBE_DIR,
  VIP_DIR,
  PREMIUM_DIR,
  VIP_YETKILI_FILE,
  PREMIUM_YETKILI_FILE,
  ADMINLER_DOSYA,
  COMMAND_SIGNATURE_FILE,
  ENV_MASK_CHECK_INTERVAL,
  COMMAND_CONTEXT_SETTINGS,
  checkKomutKisitlamasi,
  startOdaGeriSayim,
  stopOdaGeriSayim,
  deleteOdaRecord,
  checkOdaKomutuIzni,
  handleOdaCiktiKritikal,
  tickOdaGeriSayim,
  gonderSureUyarisi,
  gonderSonSaniyeUyarisi,
  kapanasiGercekles,
  getOdaGeriSayimStats,
  startCopTemizlik,
  stopCopTemizlik,
  temizleCopKlasoru,
  readCopTemizlikSuresi,
  getCopTemizlikNextTime,
  getCopTemizlikStats,
  ensureDir,
  get odaGeriSayimAktif() { return odaGeriSayimAktif; },
  get copTemizlikAktif() { return copTemizlikAktif; },
  get yetkiCache() { return yetkiCache; },
  get sunucuConfigCache() { return sunucuConfigCache; },
  get sunucuLogKanalCache() { return sunucuLogKanalCache; },
  get CONFIG_CACHE_TTL() { return CONFIG_CACHE_TTL; },
  get LOG_KANAL_CACHE_TTL() { return LOG_KANAL_CACHE_TTL; }

};


