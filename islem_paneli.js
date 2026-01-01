// ═══════════════════════════════════════════════════════════════════════════════
// komutlar/islem_paneli.js
// ═══════════════════════════════════════════════════════════════════════════════
// İŞLEM PANELİ KOMUTU - TAM VE EKSİKSİZ PRODUCTION-READY SÜRÜM
// ═══════════════════════════════════════════════════════════════════════════════
//
// ÖZELLİKLER:
// • State korumalı (RAM + JSON dosya)
// • Bot restart sonrası state recovery
// • Dinamik geri sayım (her saniye embed güncelleme)
// • Race condition korumalı (async mutex)
// • Memory-safe (idle cleanup, proper teardown)
// • Crash-proof (tüm edge case'ler handle edilmiş)
// • Interaction timeout korumalı (3 saniye kuralı)
// • Fallback message edit desteği
// • Tam Türkçe kod ve yorumlar
//
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

const LogYonetim = require('../log_yonetim');

// ═══════════════════════════════════════════════════════════════════════════════
// SABİTLER
// ═══════════════════════════════════════════════════════════════════════════════

const SABITLER = Object.freeze({
  // Zaman sabitleri
  MIN_SURE_SANIYE: 10,
  MAX_SURE_SANIYE: 86400,
  VARSAYILAN_SURE_SANIYE:  300,
  IDLE_TEMIZLIK_SANIYE:  300,
  TIMER_ARALIK_MS: 1000,
  KILIT_ZAMAN_ASIMI_MS: 30000,
  INTERACTION_ZAMAN_ASIMI_MS:  2500,

  // Limit sabitleri
  MAX_SORGU_GECMISI:  10,
  MAX_SECIM_GOSTERIM: 5,
  MAX_EMBED_FIELD_UZUNLUK: 1024,
  MAX_EMBED_ACIKLAMA_UZUNLUK: 4096,

  // Buton ID sabitleri
  BUTON_ONCEKI:  'panel_onceki_',
  BUTON_SONRAKI: 'panel_sonraki_',
  BUTON_SAYFA_SEC: 'panel_sayfa_sec',
  BUTON_SAYFA_GOSTERGE: 'panel_sayfa_gosterge',
  BUTON_YENILE: 'panel_yenile',
  BUTON_SORGULA: 'panel_sorgula',
  BUTON_KAPAT: 'panel_kapat',
  BUTON_ZORLA_KAPAT: 'panel_zorla_kapat',

  // Modal ID sabitleri
  MODAL_SAYFA_SECIM: 'panel_sayfa_secim_modal',
  MODAL_SAYFA_NUMARASI_FIELD: 'sayfa_numarasi',

  // Durum sabitleri
  DURUM_AKTIF: 'aktif',
  DURUM_SURESI_DOLDU: 'suresi_doldu',
  DURUM_KAPATILDI: 'kapatildi',
  DURUM_ZORLA_KAPATILDI: 'zorla_kapatildi',

  // Renk sabitleri
  RENK_AKTIF: '#4a9eff',
  RENK_UYARI: '#ffaa00',
  RENK_TEHLIKE: '#ff4444',
  RENK_BASARI: '#00ff88',
  RENK_BILGI: '#4a9eff'
});

// Discord API hata kodları (sessizce geçilecekler)
const YOKSAYILAN_HATA_KODLARI = Object.freeze([
  10008,  // Unknown Message
  10062,  // Unknown Interaction
  40060,  // Interaction already acknowledged
  50001,  // Missing Access
  50013   // Missing Permissions
]);

// ═══════════════════════════════════════════════════════════════════════════════
// BELLEK YÖNETİMİ - MAP YAPILARI
// ═══════════════════════════════════════════════════════════════════════════════

// Aktif timer'ları tutan Map:  kullaniciId -> intervalId
const aktifTimerlar = new Map();

// Aktif interaction referanslarını tutan Map: kullaniciId -> { interaction, sonAktivite, messageId, channelId }
const aktifInteractionlar = new Map();

// Oturum kilitlerini tutan Map: kullaniciId -> { kilitli, promise, alinanZaman }
const oturumKilitleri = new Map();

// Idle temizlik interval referansı
let idleTemizlikIntervalId = null;

// ═══════════════════════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR - GENEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Benzersiz trace ID oluşturur
 * @returns {string} UUID formatında benzersiz ID
 */
function traceIdOlustur() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
  } catch (hata) {
    const zaman = Date.now().toString(36);
    const rastgele = Math.random().toString(36).substring(2, 15);
    return `${zaman}-${rastgele}`;
  }
}

/**
 * Sayıyı belirtilen uzunlukta sıfırla doldurur
 * @param {number} sayi - Doldurulacak sayı
 * @param {number} uzunluk - Hedef uzunluk
 * @returns {string} Sıfırlarla doldurulmuş string
 */
function sifirDoldur(sayi, uzunluk = 2) {
  return String(sayi).padStart(uzunluk, '0');
}

/**
 * Saat formatı:  HH:MM: SS
 * @returns {string} Formatlanmış saat
 */
function saatFormatiAl() {
  const simdi = new Date();
  const saat = sifirDoldur(simdi.getHours());
  const dakika = sifirDoldur(simdi.getMinutes());
  const saniye = sifirDoldur(simdi.getSeconds());
  return `${saat}:${dakika}:${saniye}`;
}

/**
 * Tarih formatı: GG.AA.YYYY
 * @returns {string} Formatlanmış tarih
 */
function tarihFormatiAl() {
  const simdi = new Date();
  const gun = sifirDoldur(simdi.getDate());
  const ay = sifirDoldur(simdi.getMonth() + 1);
  const yil = simdi.getFullYear();
  return `${gun}.${ay}.${yil}`;
}

/**
 * Tam tarih ve saat formatı: GG.AA.YYYY HH:MM:SS
 * @returns {string} Formatlanmış tarih ve saat
 */
function tamTarihSaatAl() {
  return `${tarihFormatiAl()} ${saatFormatiAl()}`;
}

/**
 * Metni belirtilen uzunlukta keser
 * @param {string} metin - Kesilecek metin
 * @param {number} maxUzunluk - Maksimum uzunluk
 * @returns {string} Kesilmiş metin
 */
function metniKes(metin, maxUzunluk) {
  if (! metin || typeof metin !== 'string') {
    return '';
  }
  if (metin.length <= maxUzunluk) {
    return metin;
  }
  return metin.substring(0, maxUzunluk - 3) + '...';
}

/**
 * Güvenli şekilde buton ID'sinden sayfa numarasını parse eder
 * @param {string} butonId - Buton ID'si (örn:  panel_onceki_3)
 * @param {number} varsayilan - Parse başarısız olursa kullanılacak değer
 * @returns {number} Sayfa numarası
 */
function guvenliButonSayfaParse(butonId, varsayilan = 1) {
  try {
    if (!butonId || typeof butonId !== 'string') {
      return varsayilan;
    }

    const parcalar = butonId.split('_');
    if (parcalar.length < 3) {
      return varsayilan;
    }

    const sayfaNo = parseInt(parcalar[2], 10);
    if (isNaN(sayfaNo) || sayfaNo < 1) {
      return varsayilan;
    }

    return sayfaNo;
  } catch (hata) {
    console.error('[PANEL] Buton ID parse hatası:', hata.message);
    return varsayilan;
  }
}

/**
 * Güvenli JSON parse işlemi
 * @param {string} jsonString - Parse edilecek JSON string
 * @param {*} varsayilan - Hata durumunda dönecek değer
 * @returns {*} Parse edilmiş nesne veya varsayılan değer
 */
function guvenliJsonParse(jsonString, varsayilan = null) {
  try {
    if (!jsonString || typeof jsonString !== 'string') {
      return varsayilan;
    }
    return JSON.parse(jsonString);
  } catch (hata) {
    console.error('[PANEL] JSON parse hatası:', hata.message);
    return varsayilan;
  }
}

/**
 * Hata kodunun yoksayılabilir olup olmadığını kontrol eder
 * @param {number} hatakodu - Discord API hata kodu
 * @returns {boolean} Yoksayılabilir mi
 */
function yoksayilabilirHataMi(hatakodu) {
  return YOKSAYILAN_HATA_KODLARI.includes(hatakodu);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASYNC MUTEX - RACE CONDITION KORUMASI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Kullanıcı bazlı async mutex kilidi alır
 * Deadlock önlemek için timeout mekanizması içerir
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @returns {Promise<Function>} Kilidi serbest bırakan fonksiyon
 */
async function kilitAl(kullaniciId) {
  const mevcutKilit = oturumKilitleri.get(kullaniciId);

  // Mevcut kilit varsa ve timeout aşılmamışsa bekle
  if (mevcutKilit && mevcutKilit.kilitli) {
    const gecenSure = Date.now() - mevcutKilit.alinanZaman;

    // Timeout kontrolü - deadlock önleme
    if (gecenSure > SABITLER.KILIT_ZAMAN_ASIMI_MS) {
      console.warn(`[PANEL] Kilit timeout aşıldı, zorla serbest bırakılıyor:  ${kullaniciId}`);
      oturumKilitleri.delete(kullaniciId);
    } else {
      // Mevcut kilidi bekle
      try {
        await Promise.race([
          mevcutKilit.promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Kilit bekleme timeout')), SABITLER.KILIT_ZAMAN_ASIMI_MS - gecenSure)
          )
        ]);
      } catch (hata) {
        console.warn(`[PANEL] Kilit bekleme hatası (${kullaniciId}):`, hata.message);
        oturumKilitleri.delete(kullaniciId);
      }
    }
  }

  // Yeni kilit oluştur
  let kilitCozFonksiyonu = null;
  const kilitPromise = new Promise((resolve) => {
    kilitCozFonksiyonu = resolve;
  });

  const yeniKilit = {
    kilitli: true,
    promise: kilitPromise,
    alinanZaman: Date.now()
  };

  oturumKilitleri.set(kullaniciId, yeniKilit);

  // Serbest bırakma fonksiyonu
  const serbestBirak = () => {
    const kilit = oturumKilitleri.get(kullaniciId);
    if (kilit && kilit === yeniKilit) {
      kilit.kilitli = false;
      oturumKilitleri.delete(kullaniciId);
    }
    if (kilitCozFonksiyonu) {
      kilitCozFonksiyonu();
    }
  };

  return serbestBirak;
}

/**
 * Kullanıcının kilidi olup olmadığını kontrol eder
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @returns {boolean} Kilit durumu
 */
function kilitliMi(kullaniciId) {
  const kilit = oturumKilitleri.get(kullaniciId);
  if (!kilit || ! kilit.kilitli) {
    return false;
  }

  // Timeout kontrolü
  const gecenSure = Date.now() - kilit.alinanZaman;
  if (gecenSure > SABITLER.KILIT_ZAMAN_ASIMI_MS) {
    oturumKilitleri.delete(kullaniciId);
    return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SÜRE HESAPLAMA VE YÖNETİM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ENV'den veya varsayılandan panel timeout süresini alır ve doğrular
 * @param {number} contextDeger - Context'ten gelen değer
 * @param {number} varsayilan - Varsayılan değer
 * @returns {number} Saniye cinsinden doğrulanmış timeout süresi
 */
function panelSuresiAl(contextDeger, varsayilan) {
  let sonuc = SABITLER.VARSAYILAN_SURE_SANIYE;

  // 1.ENV değişkeninden oku
  const envDeger = process.env.PANEL_DEAKTIF_SANIYE;
  if (envDeger !== undefined && envDeger !== null && envDeger !== '') {
    const parsed = parseInt(envDeger, 10);
    if (!isNaN(parsed)) {
      if (parsed >= SABITLER.MIN_SURE_SANIYE && parsed <= SABITLER.MAX_SURE_SANIYE) {
        return parsed;
      } else {
        console.warn(`[PANEL] ENV PANEL_DEAKTIF_SANIYE sınır dışı: ${envDeger}, varsayılan kullanılıyor`);
      }
    } else {
      console.warn(`[PANEL] ENV PANEL_DEAKTIF_SANIYE geçersiz sayı: ${envDeger}, varsayılan kullanılıyor`);
    }
  }

  // 2.Context'ten gelen değer
  if (contextDeger !== undefined && contextDeger !== null && typeof contextDeger === 'number') {
    if (contextDeger >= SABITLER.MIN_SURE_SANIYE && contextDeger <= SABITLER.MAX_SURE_SANIYE) {
      return contextDeger;
    }
  }

  // 3.Parametre olarak gelen varsayılan
  if (varsayilan !== undefined && varsayilan !== null && typeof varsayilan === 'number') {
    sonuc = varsayilan;
  }

  // Sınırlar içinde tut
  return Math.min(Math.max(SABITLER.MIN_SURE_SANIYE, sonuc), SABITLER.MAX_SURE_SANIYE);
}

/**
 * Kalan süreyi hesaplar
 * @param {number} bitisZamani - Bitiş timestamp'i (ms)
 * @returns {Object} Kalan süre bilgileri
 */
function kalanSureHesapla(bitisZamani) {
  const simdi = Date.now();
  const fark = Math.max(0, bitisZamani - simdi);
  const toplamSaniye = Math.floor(fark / 1000);

  return {
    gun: Math.floor(toplamSaniye / 86400),
    saat: Math.floor((toplamSaniye % 86400) / 3600),
    dakika: Math.floor((toplamSaniye % 3600) / 60),
    saniye:  toplamSaniye % 60,
    toplamSaniye:  toplamSaniye,
    toplamMs: fark,
    dolduMu: fark <= 0
  };
}

/**
 * Kalan süreyi okunabilir formata çevirir
 * @param {Object} kalanSure - kalanSureHesapla fonksiyonundan dönen nesne
 * @returns {string} Formatlanmış süre
 */
function kalanSureFormatiAl(kalanSure) {
  const { gun, saat, dakika, saniye } = kalanSure;

  if (gun > 0) {
    return `${gun}g ${saat}s ${dakika}d ${saniye}sn`;
  }
  if (saat > 0) {
    return `${saat}s ${dakika}d ${saniye}sn`;
  }
  if (dakika > 0) {
    return `${dakika}d ${saniye}sn`;
  }
  return `${saniye}sn`;
}

/**
 * Kalan süreye göre embed rengini döndürür
 * @param {number} toplamSaniye - Kalan toplam saniye
 * @returns {string} Hex renk kodu
 */
function sureRengiAl(toplamSaniye) {
  if (toplamSaniye <= 10) {
    return SABITLER.RENK_TEHLIKE;
  }
  if (toplamSaniye <= 30) {
    return SABITLER.RENK_UYARI;
  }
  return SABITLER.RENK_AKTIF;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE YÖNETİMİ - DOSYA İŞLEMLERİ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * State dosya yolunu döndürür ve dizini oluşturur
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} stateDir - State dizini
 * @returns {Promise<string>} Dosya yolu
 */
async function stateYoluAl(kullaniciId, stateDir) {
  try {
    await fsp.mkdir(stateDir, { recursive: true });
    return path.join(stateDir, `${kullaniciId}.json`);
  } catch (hata) {
    console.error('[PANEL] State dizini oluşturulamadı:', hata.message);
    throw hata;
  }
}

/**
 * Kullanıcı state'ini dosyadan yükler
 * Bot restart sonrası state recovery için kullanılır
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} stateDir - State dizini
 * @returns {Promise<Object|null>} State nesnesi veya null
 */
async function stateYukle(kullaniciId, stateDir) {
  try {
    const statePath = await stateYoluAl(kullaniciId, stateDir);

    // Dosya var mı kontrol
    try {
      await fsp.access(statePath, fs.constants.R_OK);
    } catch (erisimHatasi) {
      return null;
    }

    const icerik = await fsp.readFile(statePath, 'utf8');
    const state = guvenliJsonParse(icerik, null);

    // State doğrulama - temel yapı
    if (!state || typeof state !== 'object') {
      console.warn(`[PANEL] Geçersiz state yapısı, siliniyor: ${kullaniciId}`);
      await fsp.unlink(statePath).catch(() => {});
      return null;
    }

    // Zorunlu alanlar kontrolü
    const zorunluAlanlar = ['kullaniciId', 'durum', 'bitisZamani', 'mevcutSayfa'];
    for (const alan of zorunluAlanlar) {
      if (state[alan] === undefined || state[alan] === null) {
        console.warn(`[PANEL] Eksik state alanı (${alan}), siliniyor: ${kullaniciId}`);
        await fsp.unlink(statePath).catch(() => {});
        return null;
      }
    }

    return state;
  } catch (hata) {
    console.error(`[PANEL] State yükleme hatası (${kullaniciId}):`, hata.message);

    // Bozuk dosyayı temizle
    try {
      const statePath = await stateYoluAl(kullaniciId, stateDir);
      await fsp.unlink(statePath).catch(() => {});
    } catch (silmeHatasi) {
      // Önemsiz
    }

    return null;
  }
}

/**
 * Kullanıcı state'ini dosyaya kaydeder
 * Atomic write ile veri bütünlüğü sağlanır
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {Object} state - Kaydedilecek state
 * @param {string} stateDir - State dizini
 * @returns {Promise<boolean>} Başarı durumu
 */
async function stateKaydet(kullaniciId, state, stateDir) {
  try {
    const statePath = await stateYoluAl(kullaniciId, stateDir);

    // Metadata güncelle
    state.sonKayit = Date.now();
    state.sonKayitFormati = tamTarihSaatAl();

    // Atomic write:  önce temp dosyaya yaz, sonra rename
    const tempPath = `${statePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;

    await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tempPath, statePath);

    return true;
  } catch (hata) {
    console.error(`[PANEL] State kaydetme hatası (${kullaniciId}):`, hata.message);

    // Log kaydet
    try {
      await LogYonetim.error('panel_state_kayit_hatasi', 'State kaydedilemedi', {
        klasor: 'panel',
        key: 'state',
        kullaniciID: kullaniciId,
        hata: hata.message
      });
    } catch (logHatasi) {
      // Log hatası önemsiz
    }

    return false;
  }
}

/**
 * Kullanıcı state'ini ve ilgili tüm bellekteki verileri siler
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} stateDir - State dizini
 * @returns {Promise<boolean>} Başarı durumu
 */
async function stateSil(kullaniciId, stateDir) {
  try {
    // Önce bellekten temizle
    tumKullaniciVerileriniTemizle(kullaniciId);

    // Sonra dosyayı sil
    const statePath = await stateYoluAl(kullaniciId, stateDir);

    try {
      await fsp.access(statePath, fs.constants.F_OK);
      await fsp.unlink(statePath);
    } catch (erisimHatasi) {
      // Dosya zaten yok, sorun değil
    }

    return true;
  } catch (hata) {
    console.error(`[PANEL] State silme hatası (${kullaniciId}):`, hata.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BELLEK TEMİZLİK FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Kullanıcının panel timer'ını temizler
 * @param {string} kullaniciId - Kullanıcı ID'si
 */
function panelTimerTemizle(kullaniciId) {
  const timerId = aktifTimerlar.get(kullaniciId);
  if (timerId) {
    clearInterval(timerId);
    aktifTimerlar.delete(kullaniciId);
    console.log(`[PANEL] Timer temizlendi:  ${kullaniciId}`);
  }
}

/**
 * Kullanıcının tüm bellekteki verilerini temizler
 * @param {string} kullaniciId - Kullanıcı ID'si
 */
function tumKullaniciVerileriniTemizle(kullaniciId) {
  // Timer temizle
  panelTimerTemizle(kullaniciId);

  // Interaction referansını temizle
  aktifInteractionlar.delete(kullaniciId);

  // Kilidi temizle
  const kilit = oturumKilitleri.get(kullaniciId);
  if (kilit) {
    kilit.kilitli = false;
  }
  oturumKilitleri.delete(kullaniciId);

  console.log(`[PANEL] Tüm kullanıcı verileri temizlendi: ${kullaniciId}`);
}

/**
 * Interaction aktivitesini günceller (idle tracking için)
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {Object} interaction - Discord interaction nesnesi
 */
function interactionAktiviteGuncelle(kullaniciId, interaction) {
  const mevcutVeri = aktifInteractionlar.get(kullaniciId) || {};

  aktifInteractionlar.set(kullaniciId, {
    interaction:  interaction,
    sonAktivite:  Date.now(),
    messageId: mevcutVeri.messageId || null,
    channelId: interaction.channelId || mevcutVeri.channelId || null
  });
}

/**
 * Message ID'yi saklar (fallback edit için)
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} messageId - Mesaj ID'si
 * @param {string} channelId - Kanal ID'si
 */
function messageIdKaydet(kullaniciId, messageId, channelId) {
  const mevcutVeri = aktifInteractionlar.get(kullaniciId) || {};
  aktifInteractionlar.set(kullaniciId, {
    ...mevcutVeri,
    messageId: messageId,
    channelId: channelId,
    sonAktivite:  Date.now()
  });
}

/**
 * Idle kullanıcıları tespit edip temizler
 * 5 dakikadır işlem yapmayan kullanıcılar otomatik kapatılır
 */
async function idleKullanicilariTemizle() {
  const simdi = Date.now();
  const idleEsik = SABITLER.IDLE_TEMIZLIK_SANIYE * 1000;
  const temizlenecekler = [];

  for (const [kullaniciId, veri] of aktifInteractionlar) {
    const gecenSure = simdi - veri.sonAktivite;
    if (gecenSure > idleEsik) {
      temizlenecekler.push({
        kullaniciId:  kullaniciId,
        gecenSureSaniye: Math.floor(gecenSure / 1000)
      });
    }
  }

  for (const { kullaniciId, gecenSureSaniye } of temizlenecekler) {
    console.log(`[PANEL] Idle kullanıcı tespit edildi (${gecenSureSaniye}sn), temizleniyor: ${kullaniciId}`);

    try {
      await LogYonetim.info('panel_idle_temizlik', `Idle kullanıcı temizlendi: ${kullaniciId}`, {
        klasor:  'panel',
        key: 'idle',
        kullaniciID: kullaniciId,
        idleSuresiSaniye: gecenSureSaniye
      });
    } catch (logHatasi) {
      // Log hatası önemsiz
    }

    tumKullaniciVerileriniTemizle(kullaniciId);
  }

  if (temizlenecekler.length > 0) {
    console.log(`[PANEL] Toplam ${temizlenecekler.length} idle kullanıcı temizlendi.`);
  }
}

/**
 * Idle temizlik interval'ını başlatır
 */
function idleTemizlikBaslat() {
  if (idleTemizlikIntervalId) {
    clearInterval(idleTemizlikIntervalId);
  }

  // Her 60 saniyede idle kontrolü
  idleTemizlikIntervalId = setInterval(idleKullanicilariTemizle, 60000);
  console.log('[PANEL] Idle temizlik interval başlatıldı.');
}

/**
 * Idle temizlik interval'ını durdurur
 */
function idleTemizlikDurdur() {
  if (idleTemizlikIntervalId) {
    clearInterval(idleTemizlikIntervalId);
    idleTemizlikIntervalId = null;
    console.log('[PANEL] Idle temizlik interval durduruldu.');
  }
}

// Modül yüklendiğinde idle temizliği başlat
idleTemizlikBaslat();

// ═══════════════════════════════════════════════════════════════════════════════
// SAYFA YÖNETİMİ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toplam sayfa sayısını döndürür
 * @param {string} sayfalarDir - Sayfalar dizini
 * @returns {Promise<number>} Sayfa sayısı
 */
async function sayfaSayisiAl(sayfalarDir) {
  try {
    await fsp.mkdir(sayfalarDir, { recursive: true });
    const dosyalar = await fsp.readdir(sayfalarDir);

    // Sadece numara.js formatındaki dosyaları say
    const jsDosyalari = dosyalar.filter(dosya => {
      return /^\d+\.js$/i.test(dosya);
    });

    return Math.max(jsDosyalari.length, 1);
  } catch (hata) {
    console.error('[PANEL] Sayfa sayısı alınamadı:', hata.message);
    return 1;
  }
}

/**
 * Belirtilen sayfa modülünü yükler
 * @param {number} sayfaNo - Sayfa numarası
 * @param {string} sayfalarDir - Sayfalar dizini
 * @returns {Promise<Object|null>} Sayfa modülü veya null
 */
async function sayfaYukle(sayfaNo, sayfalarDir) {
  try {
    const dosyaAdi = `${sayfaNo}.js`;
    const tamYol = path.join(sayfalarDir, dosyaAdi);

    // Dosya var mı kontrol
    try {
      await fsp.access(tamYol, fs.constants.R_OK);
    } catch (erisimHatasi) {
      console.error(`[PANEL] Sayfa dosyası bulunamadı:  ${tamYol}`);
      return null;
    }

    // Require cache'i temizle (hot reload için)
    const resolvedPath = require.resolve(tamYol);
    delete require.cache[resolvedPath];

    const sayfa = require(tamYol);

    // Minimum gerekli fonksiyon kontrolü
    if (! sayfa || typeof sayfa.getPageNumber !== 'function') {
      console.error(`[PANEL] Geçersiz sayfa formatı (getPageNumber eksik): ${tamYol}`);
      return null;
    }

    return sayfa;
  } catch (hata) {
    console.error(`[PANEL] Sayfa yükleme hatası:  ${hata.message}`);

    try {
      await LogYonetim.error('panel_sayfa_yukleme_hatasi', `Sayfa yüklenemedi: ${sayfaNo}`, {
        klasor: 'panel',
        key: 'sayfa',
        sayfaNo: sayfaNo,
        hata: hata.message
      });
    } catch (logHatasi) {
      // Log hatası önemsiz
    }

    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GÜVENLİ INTERACTION YANITLARI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Güvenli şekilde interaction yanıtı gönderir
 * Discord'un 3 saniye kuralına uygun çalışır
 * @param {Object} interaction - Discord interaction
 * @param {Object} payload - Yanıt içeriği
 * @returns {Promise<Object|null>} Yanıt message nesnesi veya null
 */
async function guvenliYanit(interaction, payload) {
  try {
    // Ephemeral flag düzeltmesi
    if (payload.ephemeral) {
      delete payload.ephemeral;
      payload.flags = MessageFlags.Ephemeral;
    }

    let sonuc = null;

    if (! interaction.replied && !interaction.deferred) {
      sonuc = await interaction.reply(payload);
    } else if (interaction.deferred) {
      sonuc = await interaction.editReply(payload);
    } else {
      sonuc = await interaction.followUp(payload);
    }

    return sonuc;
  } catch (hata) {
    if (! yoksayilabilirHataMi(hata.code)) {
      console.error('[PANEL] Interaction yanıt hatası:', hata.message, `(Kod: ${hata.code})`);
    }
    return null;
  }
}

/**
 * Güvenli şekilde interaction günceller
 * @param {Object} interaction - Discord interaction
 * @param {Object} payload - Güncelleme içeriği
 * @returns {Promise<boolean>} Başarı durumu
 */
async function guvenliGuncelle(interaction, payload) {
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.update(payload);
    } else {
      await interaction.editReply(payload);
    }
    return true;
  } catch (hata) {
    if (!yoksayilabilirHataMi(hata.code)) {
      console.error('[PANEL] Interaction güncelleme hatası:', hata.message, `(Kod: ${hata.code})`);
    }
    return false;
  }
}

/**
 * Güvenli şekilde interaction defer yapar
 * @param {Object} interaction - Discord interaction
 * @param {boolean} guncellemeMi - Update mi (true) reply mi (false)
 * @returns {Promise<boolean>} Başarı durumu
 */
async function guvenliDefer(interaction, guncellemeMi = true) {
  try {
    if (interaction.replied || interaction.deferred) {
      return true;
    }

    if (guncellemeMi) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch (hata) {
    if (! yoksayilabilirHataMi(hata.code)) {
      console.error('[PANEL] Defer hatası:', hata.message, `(Kod: ${hata.code})`);
    }
    return false;
  }
}

/**
 * Fallback olarak mesajı direkt düzenler (interaction expired durumları için)
 * @param {Object} client - Discord client
 * @param {string} channelId - Kanal ID'si
 * @param {string} messageId - Mesaj ID'si
 * @param {Object} payload - Düzenleme içeriği
 * @returns {Promise<boolean>} Başarı durumu
 */
async function fallbackMesajDuzenle(client, channelId, messageId, payload) {
  try {
    if (! client || !channelId || !messageId) {
      return false;
    }

    const kanal = await client.channels.fetch(channelId).catch(() => null);
    if (!kanal || !kanal.isTextBased()) {
      return false;
    }

    const mesaj = await kanal.messages.fetch(messageId).catch(() => null);
    if (!mesaj) {
      return false;
    }

    await mesaj.edit(payload);
    return true;
  } catch (hata) {
    if (!yoksayilabilirHataMi(hata.code)) {
      console.error('[PANEL] Fallback mesaj düzenleme hatası:', hata.message);
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBED OLUŞTURMA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Panel embed'ini oluşturur
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {Object} state - Panel state'i
 * @param {number} sayfaNo - Sayfa numarası
 * @param {string} sayfalarDir - Sayfalar dizini
 * @param {Object} db - Veritabanı bağlantısı
 * @param {Object} secenekler - Ek seçenekler
 * @returns {Promise<EmbedBuilder|null>} Embed veya null
 */
async function panelEmbedOlustur(kullaniciId, state, sayfaNo, sayfalarDir, db, secenekler = {}) {
  try {
    const sayfa = await sayfaYukle(sayfaNo, sayfalarDir);

    let sayfaBaslik = `Sayfa ${sayfaNo}`;
    let sayfaAciklama = 'Açıklama yok';
    let sayfaIcerik = 'İçerik yok';

    if (sayfa) {
      // Sayfa başlığı
      if (typeof sayfa.getPageName === 'function') {
        try {
          const baslik = await sayfa.getPageName();
          if (baslik) sayfaBaslik = baslik;
        } catch (hata) {
          console.warn(`[PANEL] Sayfa başlığı alınamadı:  ${hata.message}`);
        }
      }

      // Sayfa açıklaması
      if (typeof sayfa.getPageDescription === 'function') {
        try {
          const aciklama = await sayfa.getPageDescription();
          if (aciklama) sayfaAciklama = metniKes(aciklama, SABITLER.MAX_EMBED_ACIKLAMA_UZUNLUK);
        } catch (hata) {
          console.warn(`[PANEL] Sayfa açıklaması alınamadı: ${hata.message}`);
        }
      }

      // Sayfa içeriği
      if (typeof sayfa.getPageContent === 'function') {
        try {
          const icerik = await sayfa.getPageContent(kullaniciId, db);
          if (icerik) sayfaIcerik = metniKes(icerik, SABITLER.MAX_EMBED_FIELD_UZUNLUK);
        } catch (hata) {
          console.warn(`[PANEL] Sayfa içeriği alınamadı: ${hata.message}`);
          sayfaIcerik = '⚠️ İçerik yüklenirken hata oluştu.';
        }
      }
    } else {
      sayfaIcerik = '⚠️ Bu sayfa yüklenemedi. Lütfen yöneticiye başvurun.';
    }

    // Kalan süre hesapla
    const kalanSure = kalanSureHesapla(state.bitisZamani);
    const kalanSureStr = kalanSureFormatiAl(kalanSure);
    const toplamSayfa = await sayfaSayisiAl(sayfalarDir);
    const saatStr = saatFormatiAl();
    const tarihStr = tarihFormatiAl();

    // Dinamik renk
    const embedRenk = sureRengiAl(kalanSure.toplamSaniye);

    // Durum emoji ve metni
    let durumEmoji = '🟢';
    let durumMetin = 'Aktif';

    if (kalanSure.toplamSaniye <= 10) {
      durumEmoji = '🔴';
      durumMetin = 'Süresi Doluyor! ';
    } else if (kalanSure.toplamSaniye <= 30) {
      durumEmoji = '🟡';
      durumMetin = 'Az Kaldı';
    }

    // Embed oluştur
    const embed = new EmbedBuilder()
      .setColor(embedRenk)
      .setTitle(`📋 ${sayfaBaslik}`)
      .setDescription(sayfaAciklama)
      .addFields(
        { 
          name: '📄 İçerik', 
          value:  sayfaIcerik || 'İçerik yok', 
          inline: false 
        },
        { 
          name: '👤 Kullanıcı', 
          value: `<@${kullaniciId}>`, 
          inline: true 
        },
        { 
          name: '📑 Sayfa', 
          value:  `${sayfaNo}/${toplamSayfa}`, 
          inline: true 
        },
        { 
          name:  `${durumEmoji} Durum`, 
          value: durumMetin, 
          inline: true 
        },
        { 
          name: '⏱️ Kalan Süre', 
          value: `\`${kalanSureStr}\``, 
          inline:  true 
        },
        { 
          name: '🕐 Güncelleme', 
          value:  `\`${saatStr}\``, 
          inline:  true 
        },
        { 
          name: '📅 Tarih', 
          value: `\`${tarihStr}\``, 
          inline: true 
        }
      )
      .setTimestamp();

    // Footer - TraceID opsiyonel
    const traceIdGoster = secenekler.traceIdGoster !== false && state.traceId;
    if (traceIdGoster) {
      embed.setFooter({ text: `Panel ID: ${state.traceId} | Sayfa: ${sayfaNo}/${toplamSayfa}` });
    } else {
      embed.setFooter({ text: `Sayfa: ${sayfaNo}/${toplamSayfa}` });
    }

    // Kullanıcı seçimleri (varsa)
    if (state.secimler && typeof state.secimler === 'object') {
      const secimAnahtarlari = Object.keys(state.secimler);
      if (secimAnahtarlari.length > 0) {
        const secimlerMetin = secimAnahtarlari
          .slice(0, SABITLER.MAX_SECIM_GOSTERIM)
          .map(anahtar => {
            const deger = metniKes(String(state.secimler[anahtar]), 30);
            return `• ${anahtar}: \`${deger}\``;
          })
          .join('\n');

        if (secimlerMetin) {
          embed.addFields({
            name: '🔧 Seçimler',
            value: metniKes(secimlerMetin, SABITLER.MAX_EMBED_FIELD_UZUNLUK),
            inline: false
          });
        }
      }
    }

    // Son sorgu (varsa)
    if (state.sonSorgu) {
      embed.addFields({
        name: '🔍 Son Sorgu',
        value:  `\`${metniKes(String(state.sonSorgu), 50)}\``,
        inline: false
      });
    }

    return embed;
  } catch (hata) {
    console.error('[PANEL] Embed oluşturma hatası:', hata.message);
    return null;
  }
}

/**
 * Hata embed'i oluşturur
 * @param {string} baslik - Başlık
 * @param {string} aciklama - Açıklama
 * @param {string|null} traceId - Trace ID (opsiyonel)
 * @returns {EmbedBuilder} Hata embed'i
 */
function hataEmbedOlustur(baslik, aciklama, traceId = null) {
  const embed = new EmbedBuilder()
    .setColor(SABITLER.RENK_TEHLIKE)
    .setTitle(baslik)
    .setDescription(aciklama)
    .setTimestamp();

  if (traceId) {
    embed.setFooter({ text: `Trace:  ${traceId}` });
  }

  return embed;
}

/**
 * Bilgi embed'i oluşturur
 * @param {string} baslik - Başlık
 * @param {string} aciklama - Açıklama
 * @returns {EmbedBuilder} Bilgi embed'i
 */
function bilgiEmbedOlustur(baslik, aciklama) {
  return new EmbedBuilder()
    .setColor(SABITLER.RENK_BILGI)
    .setTitle(baslik)
    .setDescription(aciklama)
    .setTimestamp();
}

/**
 * Uyarı embed'i oluşturur
 * @param {string} baslik - Başlık
 * @param {string} aciklama - Açıklama
 * @returns {EmbedBuilder} Uyarı embed'i
 */
function uyariEmbedOlustur(baslik, aciklama) {
  return new EmbedBuilder()
    .setColor(SABITLER.RENK_UYARI)
    .setTitle(baslik)
    .setDescription(aciklama)
    .setTimestamp();
}

/**
 * Başarı embed'i oluşturur
 * @param {string} baslik - Başlık
 * @param {string} aciklama - Açıklama
 * @returns {EmbedBuilder} Başarı embed'i
 */
function basariEmbedOlustur(baslik, aciklama) {
  return new EmbedBuilder()
    .setColor(SABITLER.RENK_BASARI)
    .setTitle(baslik)
    .setDescription(aciklama)
    .setTimestamp();
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUTON OLUŞTURMA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Panel navigasyon butonlarını oluşturur
 * @param {number} mevcutSayfa - Mevcut sayfa
 * @param {number} toplamSayfa - Toplam sayfa sayısı
 * @returns {ActionRowBuilder[]} Buton satırları
 */
function panelButonlariOlustur(mevcutSayfa, toplamSayfa) {
  const maxSayfa = Math.max(toplamSayfa || 1, 1);
  const sayfa = Math.max(1, Math.min(mevcutSayfa || 1, maxSayfa));

  // Satır 1: Navigasyon butonları
  const satir1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SABITLER.BUTON_ONCEKI}${sayfa}`)
      .setLabel('◀ Önceki')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sayfa <= 1),

    new ButtonBuilder()
      .setCustomId(SABITLER.BUTON_SAYFA_GOSTERGE)
      .setLabel(`📄 ${sayfa}/${maxSayfa}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),

    new ButtonBuilder()
      .setCustomId(`${SABITLER.BUTON_SONRAKI}${sayfa}`)
      .setLabel('Sonraki ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sayfa >= maxSayfa),

    new ButtonBuilder()
      .setCustomId(SABITLER.BUTON_SAYFA_SEC)
      .setLabel('📑 Sayfa Seç')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(maxSayfa <= 1)
  );

  // Satır 2: İşlem butonları
  const satir2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SABITLER.BUTON_YENILE)
      .setLabel('🔄 Yenile')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(SABITLER.BUTON_SORGULA)
      .setLabel('🔍 Sorgula')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(SABITLER.BUTON_KAPAT)
      .setLabel('✖ Kapat')
      .setStyle(ButtonStyle.Danger)
  );

  return [satir1, satir2];
}

/**
 * Mevcut paneli kapatma butonu oluşturur
 * @returns {ActionRowBuilder[]} Buton satırı
 */
function kapatmaButonuOlustur() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(SABITLER.BUTON_ZORLA_KAPAT)
        .setLabel('✖ Mevcut Paneli Kapat')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

/**
 * Sayfa seçim modalını oluşturur
 * @param {number} maxSayfa - Maksimum sayfa sayısı
 * @returns {ModalBuilder} Modal
 */
function sayfaSecimModalOlustur(maxSayfa) {
  return new ModalBuilder()
    .setCustomId(SABITLER.MODAL_SAYFA_SECIM)
    .setTitle('Sayfa Seçin')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SABITLER.MODAL_SAYFA_NUMARASI_FIELD)
          .setLabel('Sayfa Numarası')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`1 ile ${maxSayfa} arasında bir sayı girin`)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(4)
      )
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL KAPATMA FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Paneli kapatır ve gerekli temizlikleri yapar
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} stateDir - State dizini
 * @param {string} sebep - Kapatma sebebi
 * @param {string} sunucuId - Sunucu ID'si
 * @param {string} traceId - Trace ID
 * @returns {Promise<boolean>} Başarı durumu
 */
async function paneliKapat(kullaniciId, stateDir, sebep, sunucuId, traceId) {
  try {
    console.log(`[PANEL] Panel kapatılıyor: ${kullaniciId}, Sebep: ${sebep}`);

    // State'i güncelle
    const state = await stateYukle(kullaniciId, stateDir);
    if (state) {
      state.durum = SABITLER.DURUM_KAPATILDI;
      state.kapanisZamani = Date.now();
      state.kapanisSebebi = sebep;
      await stateKaydet(kullaniciId, state, stateDir);
    }

    // Bellekten temizle
    tumKullaniciVerileriniTemizle(kullaniciId);

    // Dosyayı sil
    await stateSil(kullaniciId, stateDir);

    // Log kaydet
    try {
      await LogYonetim.panelKapandi(kullaniciId, sebep, sunucuId, traceId);
    } catch (logHatasi) {
      console.error('[PANEL] Panel kapanış log hatası:', logHatasi.message);
    }

    return true;
  } catch (hata) {
    console.error(`[PANEL] Panel kapatma hatası (${kullaniciId}):`, hata.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL TIMER YÖNETİMİ
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Panel timer'ını başlatır
 * Her saniye embed günceller, süre dolduğunda temizlik yapar
 * @param {string} kullaniciId - Kullanıcı ID'si
 * @param {string} stateDir - State dizini
 * @param {string} sayfalarDir - Sayfalar dizini
 * @param {Object} db - Veritabanı bağlantısı
 * @param {Object} interaction - Discord interaction
 * @param {Object} client - Discord client (fallback için)
 */
function panelTimerBaslat(kullaniciId, stateDir, sayfalarDir, db, interaction, client) {
  // Önce eski timer'ı temizle
  panelTimerTemizle(kullaniciId);

  // Interaction referansını kaydet
  interactionAktiviteGuncelle(kullaniciId, interaction);

  console.log(`[PANEL] Timer başlatıldı: ${kullaniciId}`);

  const timerInterval = setInterval(async () => {
    try {
      // Kilit kontrolü - başka işlem yapılıyorsa atla
      if (kilitliMi(kullaniciId)) {
        return;
      }

      // State'i dosyadan oku
      const state = await stateYukle(kullaniciId, stateDir);

      // State yoksa veya aktif değilse timer'ı durdur
      if (!state || state.durum !== SABITLER.DURUM_AKTIF) {
        console.log(`[PANEL] State aktif değil, timer durduruluyor: ${kullaniciId}`);
        clearInterval(timerInterval);
        aktifTimerlar.delete(kullaniciId);
        aktifInteractionlar.delete(kullaniciId);
        return;
      }

      const simdi = Date.now();

      // Süre doldu mu kontrol
      if (simdi >= state.bitisZamani) {
        console.log(`[PANEL] Süre doldu, panel kapatılıyor: ${kullaniciId}`);

        // Timer'ı durdur
        clearInterval(timerInterval);
        aktifTimerlar.delete(kullaniciId);

        // Durumu güncelle
        state.durum = SABITLER.DURUM_SURESI_DOLDU;
        state.kapanisZamani = simdi;
        state.kapanisSebebi = 'timeout';
        await stateKaydet(kullaniciId, state, stateDir);

        // Log kaydet
        try {
          await LogYonetim.panelKapandi(kullaniciId, 'timeout', state.sunucuId, state.traceId);
        } catch (logHatasi) {
          console.error('[PANEL] Panel kapanış log hatası:', logHatasi.message);
        }

        // Kullanıcıya bildir
        const dolduEmbed = hataEmbedOlustur(
          '⏰ Panel Süresi Doldu',
          'Panelin süresi doldu.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
        );

        // Önce interaction ile dene
        const kayitliVeri = aktifInteractionlar.get(kullaniciId);
        let guncellendi = false;

        if (kayitliVeri && kayitliVeri.interaction) {
          try {
            await kayitliVeri.interaction.editReply({ embeds: [dolduEmbed], components: [] });
            guncellendi = true;
          } catch (interactionHatasi) {
            // Interaction expired - fallback dene
            console.log(`[PANEL] Interaction expired, fallback deneniyor: ${kullaniciId}`);
            if (kayitliVeri.messageId && kayitliVeri.channelId && client) {
              guncellendi = await fallbackMesajDuzenle(client, kayitliVeri.channelId, kayitliVeri.messageId, {
                embeds: [dolduEmbed],
                components: []
              });
            }
          }
        }

        if (!guncellendi) {
          console.log(`[PANEL] Süre doldu bildirimi gönderilemedi:  ${kullaniciId}`);
        }

                // State'i sil
        await stateSil(kullaniciId, stateDir);
        aktifInteractionlar.delete(kullaniciId);

        return;
      }

      // Embed'i güncelle
      const kayitliVeri = aktifInteractionlar.get(kullaniciId);
      if (! kayitliVeri) {
        console.log(`[PANEL] Interaction referansı yok, timer durduruluyor: ${kullaniciId}`);
        clearInterval(timerInterval);
        aktifTimerlar.delete(kullaniciId);
        return;
      }

      try {
        const toplamSayfa = await sayfaSayisiAl(sayfalarDir);
        const embed = await panelEmbedOlustur(kullaniciId, state, state.mevcutSayfa, sayfalarDir, db);
        const butonlar = panelButonlariOlustur(state.mevcutSayfa, toplamSayfa);

        if (embed && kayitliVeri.interaction) {
          try {
            await kayitliVeri.interaction.editReply({ embeds:  [embed], components:  butonlar });
          } catch (interactionHatasi) {
            // Interaction expired - fallback dene
            if (yoksayilabilirHataMi(interactionHatasi.code)) {
              console.log(`[PANEL] Interaction expired (${interactionHatasi.code}), fallback deneniyor:  ${kullaniciId}`);

              if (kayitliVeri.messageId && kayitliVeri.channelId && client) {
                const fallbackBasarili = await fallbackMesajDuzenle(
                  client,
                  kayitliVeri.channelId,
                  kayitliVeri.messageId,
                  { embeds: [embed], components: butonlar }
                );

                if (! fallbackBasarili) {
                  console.log(`[PANEL] Fallback da başarısız, timer durduruluyor: ${kullaniciId}`);
                  clearInterval(timerInterval);
                  aktifTimerlar.delete(kullaniciId);
                  await stateSil(kullaniciId, stateDir);
                }
              } else {
                console.log(`[PANEL] Fallback bilgisi yok, timer durduruluyor: ${kullaniciId}`);
                clearInterval(timerInterval);
                aktifTimerlar.delete(kullaniciId);
                await stateSil(kullaniciId, stateDir);
              }
            } else {
              console.error('[PANEL] Timer güncelleme hatası:', interactionHatasi.message);
            }
          }
        }
      } catch (guncellemeHatasi) {
        console.error('[PANEL] Timer embed güncelleme hatası:', guncellemeHatasi.message);
      }
    } catch (timerHatasi) {
      console.error('[PANEL] Timer döngü hatası:', timerHatasi.message);
    }
  }, SABITLER.TIMER_ARALIK_MS);

  aktifTimerlar.set(kullaniciId, timerInterval);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SÜRE SIFIRLAMA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Panel timeout süresini sıfırlar (her etkileşimde çağrılır)
 * @param {Object} state - Panel state'i
 * @param {string} stateDir - State dizini
 * @param {number} contextPanelSuresi - Context'ten gelen panel süresi
 * @returns {Promise<Object>} Güncellenmiş state
 */
async function panelSuresiniSifirla(state, stateDir, contextPanelSuresi) {
  const panelSuresi = panelSuresiAl(contextPanelSuresi, SABITLER.VARSAYILAN_SURE_SANIYE);

  const simdi = Date.now();
  state.sonIslemZamani = simdi;
  state.bitisZamani = simdi + (panelSuresi * 1000);
  state.panelSuresi = panelSuresi;

  await stateKaydet(state.kullaniciId, state, stateDir);
  return state;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODÜL EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  data: new SlashCommandBuilder()
    .setName('islem_paneli')
    .setDescription('İşlem paneli açar ve sorgu yapmanızı sağlar'),

  permission: 'user',
  skipDefer: true,

  // ═══════════════════════════════════════════════════════════════════════════
  // ANA EXECUTE FONKSİYONU
  // ═══════════════════════════════════════════════════════════════════════════

  execute: async (interaction, context) => {
    const { client, db, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const kullaniciId = interaction.user.id;
    const sunucuId = interaction.guildId;
    const kanalId = interaction.channelId;

    let kilitSerbest = null;

    try {
      // Log kaydet
      try {
        await LogYonetim.info('panel_komut_calistirma', `Komut:  /islem_paneli - Kullanıcı: ${kullaniciId}`, {
          klasor: 'sunucular',
          key: 'komut',
          kullaniciID: kullaniciId,
          guildID: sunucuId,
          traceID: traceId
        });
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      // Kilit kontrolü
      if (kilitliMi(kullaniciId)) {
        const mesgulEmbed = hataEmbedOlustur(
          '⏳ İşlem Devam Ediyor',
          'Önceki işleminiz henüz tamamlanmadı. Lütfen bekleyin.',
          traceId
        );
        await guvenliYanit(interaction, { embeds: [mesgulEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      // Kilidi al
      kilitSerbest = await kilitAl(kullaniciId);

      // Mevcut state kontrolü
      const mevcutState = await stateYukle(kullaniciId, STATELER_DIR);

      if (mevcutState && mevcutState.durum === SABITLER.DURUM_AKTIF && Date.now() < mevcutState.bitisZamani) {
        // Aktif panel var
        const kalanSure = kalanSureHesapla(mevcutState.bitisZamani);
        const kalanSureStr = kalanSureFormatiAl(kalanSure);

        const uyariEmbed = new EmbedBuilder()
          .setColor(SABITLER.RENK_UYARI)
          .setTitle('⚠️ Panel Zaten Açık')
          .setDescription('Sizin zaten bir aktif paneliniz var.\n\nYeni panel açmak için mevcut paneli kapatmanız gerekiyor.')
          .addFields(
            { name:  '⏱️ Kalan Süre', value: `\`${kalanSureStr}\``, inline: true },
            { name: '📑 Sayfa', value: `${mevcutState.mevcutSayfa}`, inline: true }
          )
          .setTimestamp();

        await guvenliYanit(interaction, {
          embeds:  [uyariEmbed],
          components: kapatmaButonuOlustur(),
          flags: MessageFlags.Ephemeral
        });

        if (kilitSerbest) kilitSerbest();
        return;
      }

      // Eski verileri temizle
      tumKullaniciVerileriniTemizle(kullaniciId);
      if (mevcutState) {
        await stateSil(kullaniciId, STATELER_DIR);
      }

      // Yeni panel oluştur
      const simdi = Date.now();
      const panelSuresi = panelSuresiAl(PANEL_DEAKTIF_SANIYE, SABITLER.VARSAYILAN_SURE_SANIYE);

      const yeniState = {
        kullaniciId:  kullaniciId,
        sunucuId: sunucuId,
        kanalId: kanalId,
        traceId: traceId,
        durum: SABITLER.DURUM_AKTIF,
        mevcutSayfa: 1,
        olusturmaZamani: simdi,
        olusturmaZamaniFormati: tamTarihSaatAl(),
        sonIslemZamani: simdi,
        bitisZamani: simdi + (panelSuresi * 1000),
        panelSuresi: panelSuresi,
        sonSorgu: null,
        sorguGecmisi: [],
        secimler: {},
        sonKayit: simdi
      };

      // State'i kaydet
      const kaydedildi = await stateKaydet(kullaniciId, yeniState, STATELER_DIR);
      if (! kaydedildi) {
        const hataEmbed = hataEmbedOlustur(
          '❌ Hata',
          'Panel açılırken hata oluştu.Lütfen tekrar deneyin.',
          traceId
        );
        await guvenliYanit(interaction, { embeds: [hataEmbed], flags: MessageFlags.Ephemeral });
        if (kilitSerbest) kilitSerbest();
        return;
      }

      // Log kaydet
      try {
        await LogYonetim.panelAcildi(kullaniciId, 1, sunucuId, traceId);
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      // Embed ve butonları oluştur
      const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);
      const panelEmbed = await panelEmbedOlustur(kullaniciId, yeniState, 1, SAYFALAR_DIR, db);
      const panelButonlari = panelButonlariOlustur(1, toplamSayfa);

      if (! panelEmbed) {
        const hataEmbed = hataEmbedOlustur(
          '❌ Hata',
          'Panel oluşturulamadı.Lütfen tekrar deneyin.',
          traceId
        );
        await guvenliYanit(interaction, { embeds: [hataEmbed], flags:  MessageFlags.Ephemeral });
        if (kilitSerbest) kilitSerbest();
        return;
      }

      // Paneli gönder
     // YENİ - BU ŞEKİLDE DEĞİŞTİR
await interaction.reply({
  embeds: [panelEmbed],
  components: panelButonlari,
  flags:  MessageFlags.Ephemeral
});

// Mesajı ayrı olarak al
const yanitMesaji = await interaction.fetchReply();

      // Message ID'yi kaydet (fallback için)
      if (yanitMesaji && yanitMesaji.id) {
        messageIdKaydet(kullaniciId, yanitMesaji.id, kanalId);
      }

      // Timer'ı başlat
      panelTimerBaslat(kullaniciId, STATELER_DIR, SAYFALAR_DIR, db, interaction, client);

      if (kilitSerbest) kilitSerbest();

    } catch (hata) {
      console.error('[PANEL] Execute hatası:', hata.message);

      try {
        await LogYonetim.panelHata(kullaniciId, hata.message, sunucuId, traceId);
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      const hataEmbed = hataEmbedOlustur(
        '❌ Hata',
        'Panel açılırken beklenmeyen bir hata oluştu.',
        traceId
      );

      await guvenliYanit(interaction, { embeds:  [hataEmbed], flags: MessageFlags.Ephemeral });

      if (kilitSerbest) kilitSerbest();
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BUTTON HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  handleButton: async (interaction, butonId, context) => {
    const { client, db, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const kullaniciId = interaction.user.id;
    const sunucuId = interaction.guildId;

    let kilitSerbest = null;

    try {
      // ═══════════ GÖSTERGE BUTONU (Disabled - sadece bilgi amaçlı) ═══════════
      if (butonId === SABITLER.BUTON_SAYFA_GOSTERGE) {
        // Bu buton disabled olmalı, ama yine de tıklanırsa sessizce geç
        await guvenliDefer(interaction, true);
        return;
      }

      // ═══════════ ZORLA KAPAT ═══════════
      if (butonId === SABITLER.BUTON_ZORLA_KAPAT) {
        const state = await stateYukle(kullaniciId, STATELER_DIR);
        await paneliKapat(kullaniciId, STATELER_DIR, 'zorla_kapatma', sunucuId, state?.traceId || traceId);

        const kapatildiEmbed = basariEmbedOlustur(
          '✅ Panel Kapatıldı',
          'Eski panel kapatıldı.Şimdi `/islem_paneli` ile yeni panel açabilirsiniz.'
        );

        await guvenliGuncelle(interaction, { embeds: [kapatildiEmbed], components: [] });
        return;
      }

      // ═══════════ NORMAL KAPAT ═══════════
      if (butonId === SABITLER.BUTON_KAPAT) {
        const state = await stateYukle(kullaniciId, STATELER_DIR);
        await paneliKapat(kullaniciId, STATELER_DIR, 'kullanici', sunucuId, state?.traceId || traceId);

        const kapatildiEmbed = basariEmbedOlustur(
          '✅ Panel Kapatıldı',
          'Panel başarıyla kapatıldı.\n\nYeni panel açmak için `/islem_paneli` yazabilirsiniz.'
        );

        await guvenliGuncelle(interaction, { embeds: [kapatildiEmbed], components: [] });
        return;
      }

      // Kilit kontrolü
      if (kilitliMi(kullaniciId)) {
        await guvenliDefer(interaction, true);
        return;
      }

      kilitSerbest = await kilitAl(kullaniciId);

      try {
        // State'i dosyadan oku
        let state = await stateYukle(kullaniciId, STATELER_DIR);

        if (!state || state.durum !== SABITLER.DURUM_AKTIF) {
          const kapaliEmbed = hataEmbedOlustur(
            '❌ Panel Kapalı',
            'Bu panel artık aktif değil.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliGuncelle(interaction, { embeds:  [kapaliEmbed], components: [] });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süre kontrolü
        if (Date.now() >= state.bitisZamani) {
          await paneliKapat(kullaniciId, STATELER_DIR, 'timeout', sunucuId, state.traceId);

          const dolduEmbed = hataEmbedOlustur(
            '⏰ Panel Süresi Doldu',
            'Panelin süresi doldu.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliGuncelle(interaction, { embeds: [dolduEmbed], components: [] });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süreyi sıfırla
        state = await panelSuresiniSifirla(state, STATELER_DIR, PANEL_DEAKTIF_SANIYE);

        // Interaction aktivitesini güncelle
        interactionAktiviteGuncelle(kullaniciId, interaction);

        // ═══════════ ÖNCEKİ SAYFA ═══════════
        if (butonId.startsWith(SABITLER.BUTON_ONCEKI)) {
          const mevcutSayfa = guvenliButonSayfaParse(butonId, state.mevcutSayfa);
          const yeniSayfa = Math.max(1, mevcutSayfa - 1);

          if (yeniSayfa !== state.mevcutSayfa) {
            try {
              await LogYonetim.panelSayfaDegisti(kullaniciId, state.mevcutSayfa, yeniSayfa, sunucuId, state.traceId);
            } catch (logHatasi) {
              // Log hatası kritik değil
            }
          }

          state.mevcutSayfa = yeniSayfa;
          await stateKaydet(kullaniciId, state, STATELER_DIR);

          const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);
          const embed = await panelEmbedOlustur(kullaniciId, state, yeniSayfa, SAYFALAR_DIR, db);
          const butonlar = panelButonlariOlustur(yeniSayfa, toplamSayfa);

          if (embed) {
            await guvenliGuncelle(interaction, { embeds: [embed], components: butonlar });
          }
        }

        // ═══════════ SONRAKİ SAYFA ═══════════
        else if (butonId.startsWith(SABITLER.BUTON_SONRAKI)) {
          const mevcutSayfa = guvenliButonSayfaParse(butonId, state.mevcutSayfa);
          const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);
          const yeniSayfa = Math.min(toplamSayfa, mevcutSayfa + 1);

          if (yeniSayfa !== state.mevcutSayfa) {
            try {
              await LogYonetim.panelSayfaDegisti(kullaniciId, state.mevcutSayfa, yeniSayfa, sunucuId, state.traceId);
            } catch (logHatasi) {
              // Log hatası kritik değil
            }
          }

          state.mevcutSayfa = yeniSayfa;
          await stateKaydet(kullaniciId, state, STATELER_DIR);

          const embed = await panelEmbedOlustur(kullaniciId, state, yeniSayfa, SAYFALAR_DIR, db);
          const butonlar = panelButonlariOlustur(yeniSayfa, toplamSayfa);

          if (embed) {
            await guvenliGuncelle(interaction, { embeds:  [embed], components:  butonlar });
          }
        }

        // ═══════════ SAYFA SEÇ ═══════════
        else if (butonId === SABITLER.BUTON_SAYFA_SEC) {
          const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);
          const modal = sayfaSecimModalOlustur(toplamSayfa);

          try {
            if (! interaction.replied && ! interaction.deferred) {
  await interaction.showModal(modal);
} else {
  // Modal gösterilemez, kullanıcıya bilgi ver
  console.log('[PANEL] Modal gösterilemedi - interaction zaten yanıtlanmış');
}
          } catch (modalHatasi) {
            console.error('[PANEL] Modal gösterme hatası:', modalHatasi.message);

            const hataEmbed = hataEmbedOlustur(
              '❌ Hata',
              'Sayfa seçim penceresi açılamadı. Lütfen tekrar deneyin.'
            );
            await guvenliYanit(interaction, { embeds: [hataEmbed], flags: MessageFlags.Ephemeral });
          }

          if (kilitSerbest) kilitSerbest();
          return;
        }

        // ═══════════ YENİLE ═══════════
        else if (butonId === SABITLER.BUTON_YENILE) {
          const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);
          const embed = await panelEmbedOlustur(kullaniciId, state, state.mevcutSayfa, SAYFALAR_DIR, db);
          const butonlar = panelButonlariOlustur(state.mevcutSayfa, toplamSayfa);

          if (embed) {
            await guvenliGuncelle(interaction, { embeds: [embed], components: butonlar });
          }
        }

        // YENİ - BU ŞEKİLDE DEĞİŞTİR
// ═══════════ SORGULA ═══════════
else if (butonId === SABITLER.BUTON_SORGULA) {
  const sayfa = await sayfaYukle(state.mevcutSayfa, SAYFALAR_DIR);

  if (sayfa && typeof sayfa.getQueryModal === 'function') {
    try {
      const modal = await sayfa. getQueryModal();
      if (modal) {
        // Modal göstermeden önce interaction durumunu kontrol et
        if (! interaction.replied && ! interaction.deferred) {
          await interaction.showModal(modal);
          if (kilitSerbest) kilitSerbest();
          return;
        } else {
          // Interaction zaten yanıtlanmış - modal gösterilemez
          console. log('[PANEL] Sorgula modal gösterilemedi - interaction zaten işlenmiş');
          const uyariEmbed = uyariEmbedOlustur(
            '⚠️ Tekrar Deneyin',
            'İşlem zaten başlatılmış.  Lütfen paneli kapatıp tekrar açın.'
          );
          await guvenliYanit(interaction, { embeds: [uyariEmbed], flags:  MessageFlags.Ephemeral });
          if (kilitSerbest) kilitSerbest();
          return;
        }
      }
    } catch (modalHatasi) {
      console.error('[PANEL] Sorgu modal hatası:', modalHatasi. message);
      
      // Hata durumunda kullanıcıya bilgi ver
      if (! interaction.replied && ! interaction.deferred) {
        const hataEmbed = hataEmbedOlustur(
          '❌ Hata',
          'Sorgu penceresi açılamadı. Lütfen tekrar deneyin.'
        );
        await guvenliYanit(interaction, { embeds: [hataEmbed], flags:  MessageFlags.Ephemeral });
      }
      if (kilitSerbest) kilitSerbest();
      return;
    }
  }

  // Modal yoksa veya hata olduysa bilgilendir
  const sorguYokEmbed = uyariEmbedOlustur(
    '⚠️ Sorgu Yok',
    'Bu sayfada sorgu işlemi bulunmamaktadır.'
  );

  await guvenliYanit(interaction, { embeds: [sorguYokEmbed], flags: MessageFlags.Ephemeral });
  if (kilitSerbest) kilitSerbest();
}

        // ═══════════ BİLİNMEYEN BUTON ═══════════
        else {
          console.warn(`[PANEL] Bilinmeyen buton ID: ${butonId}`);
          await guvenliDefer(interaction, true);
        }

        if (kilitSerbest) kilitSerbest();

      } catch (icHata) {
        if (kilitSerbest) kilitSerbest();
        throw icHata;
      }

    } catch (hata) {
      console.error('[PANEL] Button hatası:', hata.message);
      if (kilitSerbest) kilitSerbest();

      try {
        await LogYonetim.panelHata(kullaniciId, hata.message, sunucuId, traceId);
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      const hataEmbed = hataEmbedOlustur('❌ Hata', 'Buton işlenirken hata oluştu.', traceId);
      await guvenliYanit(interaction, { embeds:  [hataEmbed], flags: MessageFlags.Ephemeral });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  handleModal: async (interaction, modalId, context) => {
    const { client, db, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const kullaniciId = interaction.user.id;
    const sunucuId = interaction.guildId;

    let kilitSerbest = null;

    try {
      // Kilit kontrolü
      if (kilitliMi(kullaniciId)) {
        await guvenliDefer(interaction, false);
        return;
      }

      kilitSerbest = await kilitAl(kullaniciId);

      try {
        // State'i dosyadan oku
        let state = await stateYukle(kullaniciId, STATELER_DIR);

        if (!state || state.durum !== SABITLER.DURUM_AKTIF) {
          const kapaliEmbed = hataEmbedOlustur(
            '❌ Panel Kapalı',
            'Panel artık aktif değil.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliYanit(interaction, { embeds: [kapaliEmbed], flags: MessageFlags.Ephemeral });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süre kontrolü
        if (Date.now() >= state.bitisZamani) {
          await paneliKapat(kullaniciId, STATELER_DIR, 'timeout', sunucuId, state.traceId);

          const dolduEmbed = hataEmbedOlustur(
            '⏰ Panel Süresi Doldu',
            'Panelin süresi doldu.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliYanit(interaction, { embeds: [dolduEmbed], flags: MessageFlags.Ephemeral });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süreyi sıfırla
        state = await panelSuresiniSifirla(state, STATELER_DIR, PANEL_DEAKTIF_SANIYE);

        // Interaction aktivitesini güncelle
        interactionAktiviteGuncelle(kullaniciId, interaction);

        // ═══════════ SAYFA SEÇİM MODALI ═══════════
        if (modalId === SABITLER.MODAL_SAYFA_SECIM) {
          // Field değerini al - strict kontrol
          let sayfaNumarasiStr = '';
          try {
            sayfaNumarasiStr = interaction.fields.getTextInputValue(SABITLER.MODAL_SAYFA_NUMARASI_FIELD);
          } catch (fieldHatasi) {
            console.error('[PANEL] Modal field okuma hatası:', fieldHatasi.message);

            const hataEmbed = hataEmbedOlustur(
              '❌ Hata',
              'Sayfa numarası okunamadı. Lütfen tekrar deneyin.'
            );
            await guvenliYanit(interaction, { embeds: [hataEmbed], flags: MessageFlags.Ephemeral });
            if (kilitSerbest) kilitSerbest();
            return;
          }

          // Integer doğrulaması - strict
          const temizlenmisGirdi = sayfaNumarasiStr.trim();
          
          // Sadece rakam içeriyor mu kontrol
          if (!/^\d+$/.test(temizlenmisGirdi)) {
            const gecersizEmbed = uyariEmbedOlustur(
              '⚠️ Geçersiz Değer',
              `Girdiğiniz değer (\`${metniKes(sayfaNumarasiStr, 20)}\`) geçerli bir sayı değil.\n\nLütfen sadece rakam girin.`
            );

            await guvenliYanit(interaction, { embeds:  [gecersizEmbed], flags: MessageFlags.Ephemeral });
            if (kilitSerbest) kilitSerbest();
            return;
          }

          const sayfaNo = parseInt(temizlenmisGirdi, 10);

          // Minimum değer kontrolü
          if (sayfaNo < 1) {
            const gecersizEmbed = uyariEmbedOlustur(
              '⚠️ Geçersiz Sayfa',
              'Sayfa numarası 1\'den küçük olamaz.\n\nLütfen 1 veya daha büyük bir sayı girin.'
            );

            await guvenliYanit(interaction, { embeds: [gecersizEmbed], flags: MessageFlags.Ephemeral });
            if (kilitSerbest) kilitSerbest();
            return;
          }

          const toplamSayfa = await sayfaSayisiAl(SAYFALAR_DIR);

          // Maksimum değer kontrolü
          if (sayfaNo > toplamSayfa) {
            const gecersizEmbed = uyariEmbedOlustur(
              '⚠️ Sayfa Bulunamadı',
              `Girdiğiniz sayfa numarası (${sayfaNo}) geçersiz.\n\nMaksimum sayfa:  **${toplamSayfa}**`
            );

            await guvenliYanit(interaction, { embeds: [gecersizEmbed], flags: MessageFlags.Ephemeral });
            if (kilitSerbest) kilitSerbest();
            return;
          }

          // Sayfa değişikliğini logla
          if (sayfaNo !== state.mevcutSayfa) {
            try {
              await LogYonetim.panelSayfaDegisti(kullaniciId, state.mevcutSayfa, sayfaNo, sunucuId, state.traceId);
            } catch (logHatasi) {
              // Log hatası kritik değil
            }
          }

          // State'i güncelle
          state.mevcutSayfa = sayfaNo;
          await stateKaydet(kullaniciId, state, STATELER_DIR);

          // Yeni embed ve butonları oluştur
          const embed = await panelEmbedOlustur(kullaniciId, state, sayfaNo, SAYFALAR_DIR, db);
          const butonlar = panelButonlariOlustur(sayfaNo, toplamSayfa);

          if (embed) {
            await guvenliYanit(interaction, { embeds: [embed], components: butonlar, flags: MessageFlags.Ephemeral });
          }
        }

        // ═══════════ SAYFA SORGU MODALLARI ═══════════
        else if (modalId.startsWith('sayfa_') && modalId.endsWith('_sorgu_modal')) {
          const sayfa = await sayfaYukle(state.mevcutSayfa, SAYFALAR_DIR);

          if (sayfa && typeof sayfa.handleQueryModal === 'function') {
            try {
              // Sorgu değerini state'e kaydetmeye çalış
              let sorguDegeri = null;

              // Olası field isimlerini dene
              const olasiFieldlar = ['io7r_tc', 'query_input', 'sorgu_input', 'tc_input', 'sorgu_degeri', 'sorgu'];
              for (const fieldAdi of olasiFieldlar) {
                try {
                  const deger = interaction.fields.getTextInputValue(fieldAdi);
                  if (deger) {
                    sorguDegeri = deger;
                    break;
                  }
                } catch (fieldHatasi) {
                  // Bu field yok, sonrakini dene
                  continue;
                }
              }

              // Sorgu değerini state'e kaydet
              if (sorguDegeri) {
                state.sonSorgu = sorguDegeri;

                if (! Array.isArray(state.sorguGecmisi)) {
                  state.sorguGecmisi = [];
                }

                state.sorguGecmisi.push({
                  sorgu: sorguDegeri,
                  zaman: Date.now(),
                  zamanFormati: tamTarihSaatAl(),
                  sayfa: state.mevcutSayfa
                });

                // Maksimum sorgu geçmişi sınırı
                if (state.sorguGecmisi.length > SABITLER.MAX_SORGU_GECMISI) {
                  state.sorguGecmisi = state.sorguGecmisi.slice(-SABITLER.MAX_SORGU_GECMISI);
                }

                await stateKaydet(kullaniciId, state, STATELER_DIR);
              }

              // Sayfa handler'ını çağır
              await sayfa.handleQueryModal(interaction, {
                db:  db,
                client: client,
                safeReply: guvenliYanit,
                safeUpdate: guvenliGuncelle,
                LogYonetim:  LogYonetim,
                traceId: state.traceId || traceId,
                userId: kullaniciId,
                kullaniciId: kullaniciId,
                state: state
              });

            } catch (sorguHatasi) {
              console.error('[PANEL] Sorgu modal hatası:', sorguHatasi.message);

              try {
                await LogYonetim.sorguHatasi(kullaniciId, 'modal_sorgu', sorguHatasi.message, sunucuId, state.traceId);
              } catch (logHatasi) {
                // Log hatası kritik değil
              }

              const hataEmbed = hataEmbedOlustur('❌ Sorgu Hatası', 'Sorgu işlenirken hata oluştu.', state.traceId);
              await guvenliYanit(interaction, { embeds: [hataEmbed], flags: MessageFlags.Ephemeral });
            }
          } else {
            const handlerYokEmbed = uyariEmbedOlustur(
              '⚠️ Sorgu İşlenemedi',
              'Bu sayfa için sorgu handler bulunamadı.'
            );

            await guvenliYanit(interaction, { embeds: [handlerYokEmbed], flags: MessageFlags.Ephemeral });
          }
        }

        // ═══════════ BİLİNMEYEN MODAL ═══════════
        else {
          console.warn(`[PANEL] Bilinmeyen modal ID: ${modalId}`);

          // Sayfaya özel modal olabilir, sayfaya ilet
          const sayfa = await sayfaYukle(state.mevcutSayfa, SAYFALAR_DIR);

          if (sayfa && typeof sayfa.handleModal === 'function') {
            try {
              await sayfa.handleModal(interaction, modalId, {
                db: db,
                client:  client,
                safeReply: guvenliYanit,
                safeUpdate: guvenliGuncelle,
                LogYonetim: LogYonetim,
                traceId: state.traceId || traceId,
                userId: kullaniciId,
                kullaniciId:  kullaniciId,
                state: state
              });
            } catch (sayfaModalHatasi) {
              console.error('[PANEL] Sayfa modal handler hatası:', sayfaModalHatasi.message);
              await guvenliDefer(interaction, false);
            }
          } else {
            await guvenliDefer(interaction, false);
          }
        }

        if (kilitSerbest) kilitSerbest();

      } catch (icHata) {
        if (kilitSerbest) kilitSerbest();
        throw icHata;
      }

    } catch (hata) {
      console.error('[PANEL] Modal hatası:', hata.message);
      if (kilitSerbest) kilitSerbest();

      try {
        await LogYonetim.panelHata(kullaniciId, hata.message, sunucuId, traceId);
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      const hataEmbed = hataEmbedOlustur('❌ Hata', 'Modal işlenirken hata oluştu.', traceId);
      await guvenliYanit(interaction, { embeds: [hataEmbed], flags:  MessageFlags.Ephemeral });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECT MENU HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  handleSelectMenu: async (interaction, menuId, context) => {
    const { client, db, traceId, PANEL_DEAKTIF_SANIYE, STATELER_DIR, SAYFALAR_DIR } = context;
    const kullaniciId = interaction.user.id;
    const sunucuId = interaction.guildId;

    let kilitSerbest = null;

    try {
      // Kilit kontrolü
      if (kilitliMi(kullaniciId)) {
        await guvenliDefer(interaction, true);
        return;
      }

      kilitSerbest = await kilitAl(kullaniciId);

      try {
        // Seçilen değeri al
        const secilenDeger = interaction.values && interaction.values[0] ? interaction.values[0] : 'bilinmiyor';

        // State'i dosyadan oku
        let state = await stateYukle(kullaniciId, STATELER_DIR);

        if (!state || state.durum !== SABITLER.DURUM_AKTIF) {
          const kapaliEmbed = hataEmbedOlustur(
            '❌ Panel Kapalı',
            'Panel artık aktif değil.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliYanit(interaction, { embeds:  [kapaliEmbed], flags: MessageFlags.Ephemeral });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süre kontrolü
        if (Date.now() >= state.bitisZamani) {
          await paneliKapat(kullaniciId, STATELER_DIR, 'timeout', sunucuId, state.traceId);

          const dolduEmbed = hataEmbedOlustur(
            '⏰ Panel Süresi Doldu',
            'Panelin süresi doldu.\n\nYeni bir panel açmak için `/islem_paneli` yazın.'
          );

          await guvenliYanit(interaction, { embeds: [dolduEmbed], flags: MessageFlags.Ephemeral });
          if (kilitSerbest) kilitSerbest();
          return;
        }

        // Süreyi sıfırla (idle refresh)
        state = await panelSuresiniSifirla(state, STATELER_DIR, PANEL_DEAKTIF_SANIYE);

        // Seçimi state'e kaydet
        if (! state.secimler || typeof state.secimler !== 'object') {
          state.secimler = {};
        }
        state.secimler[menuId] = secilenDeger;
        await stateKaydet(kullaniciId, state, STATELER_DIR);

        // Interaction aktivitesini güncelle
        interactionAktiviteGuncelle(kullaniciId, interaction);

        // Sayfa handler'ını çağır
        const sayfa = await sayfaYukle(state.mevcutSayfa, SAYFALAR_DIR);

        if (sayfa && typeof sayfa.handleSelectMenu === 'function') {
          try {
            await sayfa.handleSelectMenu(interaction, menuId, secilenDeger, {
              db: db,
              client:  client,
              safeReply: guvenliYanit,
              safeUpdate: guvenliGuncelle,
              LogYonetim: LogYonetim,
              traceId: state.traceId || traceId,
              userId: kullaniciId,
              kullaniciId:  kullaniciId,
              state: state
            });
          } catch (selectHatasi) {
            console.error('[PANEL] SelectMenu handler hatası:', selectHatasi.message);

            try {
              await LogYonetim.error('panel_select_hatasi', 'SelectMenu işlenirken hata', {
                klasor: 'panel',
                key: 'select',
                kullaniciID: kullaniciId,
                menuId: menuId,
                hata: selectHatasi.message
              });
            } catch (logHatasi) {
              // Log hatası kritik değil
            }

            const hataEmbed = hataEmbedOlustur('❌ Hata', 'Seçim işlenirken hata oluştu.', state.traceId);
            await guvenliYanit(interaction, { embeds: [hataEmbed], flags: MessageFlags.Ephemeral });
          }
        } else {
          // Handler yoksa sadece defer yap
          await guvenliDefer(interaction, true);
        }

        if (kilitSerbest) kilitSerbest();

      } catch (icHata) {
        if (kilitSerbest) kilitSerbest();
        throw icHata;
      }

    } catch (hata) {
      console.error('[PANEL] SelectMenu hatası:', hata.message);
      if (kilitSerbest) kilitSerbest();

      try {
        await LogYonetim.panelHata(kullaniciId, hata.message, sunucuId, traceId);
      } catch (logHatasi) {
        // Log hatası kritik değil
      }

      const hataEmbed = hataEmbedOlustur('❌ Hata', 'Seçim işlenirken hata oluştu.', traceId);
      await guvenliYanit(interaction, { embeds:  [hataEmbed], flags: MessageFlags.Ephemeral });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOCOMPLETE HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  handleAutocomplete: async (interaction, context) => {
    const { SAYFALAR_DIR, STATELER_DIR } = context;
    const kullaniciId = interaction.user.id;

    try {
      // State kontrolü - activity update için
      const state = await stateYukle(kullaniciId, STATELER_DIR);

      if (!state || state.durum !== SABITLER.DURUM_AKTIF) {
        await interaction.respond([]);
        return;
      }

      // Aktivite güncelle (autocomplete de aktivite sayılır)
      const kayitliVeri = aktifInteractionlar.get(kullaniciId);
      if (kayitliVeri) {
        kayitliVeri.sonAktivite = Date.now();
        aktifInteractionlar.set(kullaniciId, kayitliVeri);
      }

      // Sayfa handler'ını kontrol et
      const sayfa = await sayfaYukle(state.mevcutSayfa, SAYFALAR_DIR);

      if (sayfa && typeof sayfa.handleAutocomplete === 'function') {
        try {
          await sayfa.handleAutocomplete(interaction, {
            userId: kullaniciId,
            kullaniciId: kullaniciId,
            state: state
          });
        } catch (autoHatasi) {
          console.error('[PANEL] Autocomplete hatası:', autoHatasi.message);
          await interaction.respond([]);
        }
      } else {
        await interaction.respond([]);
      }

    } catch (hata) {
      console.error('[PANEL] Autocomplete genel hatası:', hata.message);
      try {
        await interaction.respond([]);
      } catch (yanitHatasi) {
        // Yanıt hatası önemsiz
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // YARDIMCI METODLAR - DIŞ ERİŞİM
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Kullanıcının timer'ını ve tüm verilerini temizler
   * @param {string} kullaniciId - Kullanıcı ID'si
   */
  kullaniciTemizle: async (kullaniciId) => {
    tumKullaniciVerileriniTemizle(kullaniciId);
  },

  /**
   * Aktif timer'ları olan kullanıcı ID'lerini döndürür
   * @returns {string[]} Kullanıcı ID listesi
   */
  aktifKullanicilariAl: () => {
    return Array.from(aktifTimerlar.keys());
  },

  /**
   * Aktif timer sayısını döndürür
   * @returns {number} Timer sayısı
   */
  aktifTimerSayisiAl: () => {
    return aktifTimerlar.size;
  },

  /**
   * Kullanıcının aktif paneli olup olmadığını kontrol eder
   * @param {string} kullaniciId - Kullanıcı ID'si
   * @returns {boolean} Aktiflik durumu
   */
  kullaniciAktifMi: (kullaniciId) => {
    return aktifTimerlar.has(kullaniciId);
  },

  /**
   * Tüm timer'ları ve verileri temizler (bot kapatılırken kullanılır)
   */
  tumVerileriTemizle:  () => {
    console.log(`[PANEL] Tüm veriler temizleniyor. Aktif timer: ${aktifTimerlar.size}`);

    for (const [kullaniciId, timerId] of aktifTimerlar) {
      clearInterval(timerId);
      console.log(`[PANEL] Timer temizlendi: ${kullaniciId}`);
    }

    aktifTimerlar.clear();
    aktifInteractionlar.clear();
    oturumKilitleri.clear();

    // Idle temizlik interval'ı da durdur
    idleTemizlikDurdur();

    console.log('[PANEL] Tüm veriler temizlendi.');
  },

  /**
   * Belirli bir kullanıcının state'ini döndürür (read-only)
   * @param {string} kullaniciId - Kullanıcı ID'si
   * @param {string} stateDir - State dizini
   * @returns {Promise<Object|null>} State veya null
   */
  kullaniciStateAl: async (kullaniciId, stateDir) => {
    return await stateYukle(kullaniciId, stateDir);
  },

  /**
   * Panel istatistiklerini döndürür
   * @returns {Object} İstatistikler
   */
  istatistiklerAl: () => {
    return {
      aktifTimerSayisi: aktifTimerlar.size,
      aktifInteractionSayisi: aktifInteractionlar.size,
      aktifKilitSayisi: oturumKilitleri.size,
      timerKullanicilari: Array.from(aktifTimerlar.keys()),
      interactionKullanicilari: Array.from(aktifInteractionlar.keys()),
      kilitKullanicilari: Array.from(oturumKilitleri.keys())
    };
  },

  /**
   * Belirli bir kullanıcının panelini zorla kapatır (admin kullanımı)
   * @param {string} kullaniciId - Kullanıcı ID'si
   * @param {string} stateDir - State dizini
   * @param {string} sebep - Kapatma sebebi
   * @returns {Promise<boolean>} Başarı durumu
   */
  zorlaKapat: async (kullaniciId, stateDir, sebep = 'admin') => {
    try {
      console.log(`[PANEL] Panel zorla kapatılıyor: ${kullaniciId}, Sebep: ${sebep}`);

      const state = await stateYukle(kullaniciId, stateDir);

      if (state) {
        state.durum = SABITLER.DURUM_ZORLA_KAPATILDI;
        state.kapanisZamani = Date.now();
        state.kapanisSebebi = `zorla_${sebep}`;
        await stateKaydet(kullaniciId, state, stateDir);

        try {
          await LogYonetim.panelKapandi(kullaniciId, `zorla_${sebep}`, state.sunucuId, state.traceId);
        } catch (logHatasi) {
          // Log hatası kritik değil
        }
      }

      tumKullaniciVerileriniTemizle(kullaniciId);
      await stateSil(kullaniciId, stateDir);

      return true;
    } catch (hata) {
      console.error(`[PANEL] Zorla kapatma hatası:  ${hata.message}`);
      return false;
    }
  },

  /**
   * Tüm aktif panelleri zorla kapatır (bakım modu)
   * @param {string} stateDir - State dizini
   * @param {string} sebep - Kapatma sebebi
   * @returns {Promise<number>} Kapatılan panel sayısı
   */
  tumPanelleriKapat: async (stateDir, sebep = 'bakim') => {
    const kullaniciIdleri = Array.from(aktifTimerlar.keys());
    let kapatilmaSayisi = 0;

    console.log(`[PANEL] Tüm paneller kapatılıyor. Toplam:  ${kullaniciIdleri.length}, Sebep: ${sebep}`);

    for (const kullaniciId of kullaniciIdleri) {
      try {
        const state = await stateYukle(kullaniciId, stateDir);

        if (state) {
          state.durum = SABITLER.DURUM_ZORLA_KAPATILDI;
          state.kapanisZamani = Date.now();
          state.kapanisSebebi = `toplu_${sebep}`;
          await stateKaydet(kullaniciId, state, stateDir);
        }

        tumKullaniciVerileriniTemizle(kullaniciId);
        await stateSil(kullaniciId, stateDir);

        kapatilmaSayisi++;
      } catch (hata) {
        console.error(`[PANEL] Panel kapatılamadı (${kullaniciId}): ${hata.message}`);
      }
    }

    console.log(`[PANEL] Toplam ${kapatilmaSayisi} panel kapatıldı.`);
    return kapatilmaSayisi;
  },

  /**
   * Bot restart sonrası aktif state'leri kontrol eder
   * Süresi dolmuş olanları temizler
   * @param {string} stateDir - State dizini
   * @returns {Promise<Object>} Sonuç istatistikleri
   */
  stateleriKontrolEt: async (stateDir) => {
    const sonuc = {
      kontrolEdilen: 0,
      temizlenen: 0,
      gecerli: 0,
      hatali: 0
    };

    try {
      await fsp.mkdir(stateDir, { recursive: true });
      const dosyalar = await fsp.readdir(stateDir);
      const jsonDosyalari = dosyalar.filter(f => f.endsWith('.json') && !f.includes('.tmp'));

      console.log(`[PANEL] ${jsonDosyalari.length} state dosyası kontrol ediliyor.`);

      for (const dosya of jsonDosyalari) {
        sonuc.kontrolEdilen++;

        try {
          const kullaniciId = dosya.replace('.json', '');
          const state = await stateYukle(kullaniciId, stateDir);

          if (! state) {
            sonuc.hatali++;
            continue;
          }

          // Süresi dolmuş veya aktif olmayan state'leri temizle
          if (Date.now() >= state.bitisZamani || state.durum !== SABITLER.DURUM_AKTIF) {
            console.log(`[PANEL] Süresi dolmuş/inaktif state temizleniyor:  ${kullaniciId}`);
            await stateSil(kullaniciId, stateDir);
            sonuc.temizlenen++;
            continue;
          }

          // State geçerli
          console.log(`[PANEL] Geçerli state bulundu: ${kullaniciId}`);
          sonuc.gecerli++;

        } catch (dosyaHatasi) {
          console.error(`[PANEL] State dosyası işlenemedi (${dosya}): ${dosyaHatasi.message}`);
          sonuc.hatali++;
        }
      }

      console.log(`[PANEL] State kontrolü tamamlandı.Kontrol:  ${sonuc.kontrolEdilen}, Geçerli: ${sonuc.gecerli}, Temizlenen: ${sonuc.temizlenen}, Hatalı: ${sonuc.hatali}`);

    } catch (hata) {
      console.error('[PANEL] State kontrolü hatası:', hata.message);
    }

    return sonuc;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SABİTLER EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  SABITLER:  SABITLER

};

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS CLEANUP - BOT KAPATILIRKEN TEMİZLİK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process sinyallerinde temizlik yapar
 * @param {string} sinyal - Alınan sinyal adı
 */
function processTemizligi(sinyal) {
  console.log(`[PANEL] ${sinyal} sinyali alındı, temizlik başlatılıyor...`);
  module.exports.tumVerileriTemizle();
}

// SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  processTemizligi('SIGINT');
});

// SIGTERM (kill komutu)
process.on('SIGTERM', () => {
  processTemizligi('SIGTERM');
});

// Uncaught Exception - loglama ama temizlik yok (kritik olmayan)
process.on('uncaughtException', (hata) => {
  console.error('[PANEL] Yakalanmamış exception:', hata.message);
  console.error('[PANEL] Stack:', hata.stack);
  // Timer'ları temizlemiyoruz - uygulama devam edebilir
});

// Unhandled Rejection - loglama ama temizlik yok (kritik olmayan)
process.on('unhandledRejection', (sebep, promise) => {
  console.error('[PANEL] İşlenmemiş promise rejection:', sebep);
  // Timer'ları temizlemiyoruz - uygulama devam edebilir
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODÜL SONU
// ═══════════════════════════════════════════════════════════════════════════════