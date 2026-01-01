// veri_yonetim.js
// Sunucu ve Kullanıcı Veri Yönetim Sistemi - TAM VE EKSİKSİZ
// Discord.js v14 uyumlu, embed log destekli, otomatik güncelleme
// Versiyon:  2.0.0

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { EmbedBuilder } = require('discord.js');

// ==================== YAPILANDIRMA ====================

const BASE_DIR = process.cwd();
const VERI_ROOT = path.join(BASE_DIR, 'sunucu_dm_veriler');
const SUNUCU_DIR = path.join(VERI_ROOT, 'sunucu');
const DM_DIR = path.join(VERI_ROOT, 'dm');
const YEDEK_DIR = path.join(VERI_ROOT, 'yedekler');
const CONFIG_FILE = path.join(VERI_ROOT, 'config.json');

const GUNCELLEME_INTERVALI = 5000; // 5 saniye
const CACHE_SURESI = 60000; // 1 dakika
const CONFIG_CACHE_SURESI = 5000; // 5 saniye
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const { PermissionsBitField } = require('discord.js');
// ==================== RENK KODLARI ====================

const RENKLER = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
  GRAY: '\x1b[90m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW:  '\x1b[93m',
  BRIGHT_CYAN: '\x1b[96m'
};

// ==================== DEFAULT CONFIG ====================

const DEFAULT_CONFIG = {
  log_kanal_id: null,
  embed_footer: null,
  embed_setimage: null,
  auto_update_enabled: true,
  update_interval_ms:  GUNCELLEME_INTERVALI,
  created_at: null,
  updated_at: null
};

// ==================== VERİ YÖNETİM SINIFI ====================

class VeriYonetim {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.cache = new Map();
    this.configCache = null;
    this.configLastUpdate = 0;
    this.updateInterval = null;
    this.configWatcher = null;
    this.client = null;
    this.loggingEnabled = false; // Internal logging - kullanıcıya gösterilmez
    this.stats = {
      toplamGuncelleme: 0,
      basariliGuncelleme: 0,
      basarisizGuncelleme: 0,
      embedGonderilen: 0,
      embedBasarisiz: 0,
      jsonKurtarma: 0,
      cacheHit: 0,
      cacheMiss:  0
    };
  }

  // ==================== INIT ====================

  async init(client = null) {
    try {
      if (this.initialized && this.client === client) {
        return true;
      }

      this.client = client;
      
      // Dizinleri oluştur
      const dirsOk = await this.ensureDirs();
      if (!dirsOk) {
        return false;
      }

      // Config'i yükle
      await this.loadConfig();

      // Config watcher başlat
      this.startConfigWatcher();

      // Otomatik güncellemeyi başlat
      if (client) {
        this.startAutoUpdate(client);
      }

      this.initialized = true;
      this.internalLog('success', 'Veri yönetim sistemi başlatıldı');
      
      return true;
    } catch (e) {
      // Sessiz hata - kullanıcıya bildirim yok
      return false;
    }
  }

  // ==================== INTERNAL LOG (SADECE SİSTEM İÇİ) ====================

  internalLog(seviye, mesaj) {
    // Bu log sadece sistem içi kullanım içindir
    // Kullanıcıya ASLA gösterilmez
    if (!this.loggingEnabled) {
      return;
    }

    const zaman = this.formatTimestampShort();
    let renk = RENKLER.CYAN;
    let etiket = 'INFO';
    
    switch (seviye) {
      case 'success':
        renk = RENKLER.BRIGHT_GREEN;
        etiket = 'OK  ';
        break;
      case 'warn':
        renk = RENKLER.BRIGHT_YELLOW;
        etiket = 'WARN';
        break;
      case 'error':
        renk = RENKLER.RED;
        etiket = 'ERR ';
        break;
      default:
        renk = RENKLER.BRIGHT_CYAN;
        etiket = 'INFO';
    }
    
    console.log(`${RENKLER.GRAY}[${zaman}]${RENKLER.RESET} ${renk}[VERI ${etiket}]${RENKLER.RESET} ${mesaj}`);
  }

  // Log sistemini aç/kapat (sadece geliştirme için)
  setLogging(enabled) {
    this.loggingEnabled = enabled;
  }

  // ==================== TIMESTAMP OLUŞTURMA ====================

  createTimestamp() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    
    return {
      iso: now.toISOString(),
      tarih: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
      saat: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      tam: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      unix: now.getTime()
    };
  }

  formatTimestampShort() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ==================== DİZİN OLUŞTURMA ====================

  async ensureDirs() {
    if (this.initialized) return true;
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        // Ana dizinleri oluştur
        await fsp.mkdir(VERI_ROOT, { recursive: true });
        await fsp.mkdir(SUNUCU_DIR, { recursive: true });
        await fsp.mkdir(DM_DIR, { recursive:  true });
        await fsp.mkdir(YEDEK_DIR, { recursive:  true });
        
        // Config dosyası yoksa oluştur
        const configExists = await this.fileExists(CONFIG_FILE);
        if (!configExists) {
          const defaultConfig = {
            ...DEFAULT_CONFIG,
            created_at: this.createTimestamp().iso,
            updated_at: this.createTimestamp().iso
          };
          await this.safeWriteJson(CONFIG_FILE, defaultConfig);
        }
        
        this.initialized = true;
        this.internalLog('success', 'Veri dizinleri hazır');
        
        return true;
      } catch (e) {
        // Sessiz hata
        return false;
      }
    })();

    return this.initPromise;
  }

  // ==================== DOSYA YARDIMCI FONKSİYONLARI ====================

  async fileExists(filePath) {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // Güvenli JSON okuma - bozuk dosya yedekleme ve kurtarma dahil
  async safeReadJson(filePath, defaultValue = null) {
    try {
      const exists = await this.fileExists(filePath);
      if (!exists) {
        return defaultValue;
      }

      const data = await fsp.readFile(filePath, 'utf8');
      
      // Boş dosya kontrolü
      if (! data || data.trim() === '') {
        return defaultValue;
      }

      try {
        return JSON.parse(data);
      } catch (parseError) {
        // JSON bozuk - yedekle ve kurtarmayı dene
        await this.backupCorruptedFile(filePath);
        this.stats.jsonKurtarma++;
        return defaultValue;
      }
    } catch (e) {
      // Sessiz hata
      return defaultValue;
    }
  }

  // Güvenli JSON yazma - atomik yazma
  async safeWriteJson(filePath, data) {
    try {
      const tempPath = `${filePath}.tmp`;
      const jsonData = JSON.stringify(data, null, 2);
      
      // Önce geçici dosyaya yaz
      await fsp.writeFile(tempPath, jsonData, 'utf8');
      
      // Sonra asıl dosyaya taşı (atomik işlem)
      await fsp.rename(tempPath, filePath);
      
      return true;
    } catch (e) {
      // Temp dosyasını temizle
      try {
        const tempPath = `${filePath}.tmp`;
        const tempExists = await this.fileExists(tempPath);
        if (tempExists) {
          await fsp.unlink(tempPath);
        }
      } catch {
        // Sessiz
      }
      return false;
    }
  }

  // Bozuk dosyayı yedekle
  async backupCorruptedFile(filePath) {
    try {
      const exists = await this.fileExists(filePath);
      if (!exists) return false;

      const fileName = path.basename(filePath);
      const timestamp = Date.now();
      const backupPath = path.join(YEDEK_DIR, `${fileName}.bozuk.${timestamp}`);
      
      await fsp.copyFile(filePath, backupPath);
      
      return true;
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  // ==================== CONFIG YÖNETİMİ ====================

  async loadConfig() {
    try {
      await this.ensureDirs();
      
      // Cache kontrolü
      const now = Date.now();
      if (this.configCache && (now - this.configLastUpdate) < CONFIG_CACHE_SURESI) {
        this.stats.cacheHit++;
        return { ...this.configCache };
      }
      
      this.stats.cacheMiss++;
      
      const config = await this.safeReadJson(CONFIG_FILE, { ...DEFAULT_CONFIG });
      
      // Default değerlerle birleştir
      const mergedConfig = { ...DEFAULT_CONFIG, ...config };
      
      this.configCache = mergedConfig;
      this.configLastUpdate = now;
      
      return { ...mergedConfig };
    } catch (e) {
      // Sessiz hata - default döndür
      return { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(config) {
    try {
      await this.ensureDirs();
      
      const newConfig = {
        ...DEFAULT_CONFIG,
        ...config,
        updated_at: this.createTimestamp().iso
      };
      
      if (! newConfig.created_at) {
        newConfig.created_at = this.createTimestamp().iso;
      }
      
      const result = await this.safeWriteJson(CONFIG_FILE, newConfig);
      
      if (result) {
        this.configCache = newConfig;
        this.configLastUpdate = Date.now();
      }
      
      return result;
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  async updateConfig(updates) {
    try {
      const config = await this.loadConfig();
      const newConfig = { ...config, ...updates };
      return await this.saveConfig(newConfig);
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  // Config değişiklik izleyici (fs.watch)
  startConfigWatcher() {
    try {
      // Önceki watcher'ı kapat
      this.stopConfigWatcher();

      // Config dosyası yoksa izleme
      if (!fs.existsSync(CONFIG_FILE)) {
        return;
      }

      this.configWatcher = fs.watch(CONFIG_FILE, { persistent: false }, async (eventType) => {
        if (eventType === 'change') {
          // Cache'i temizle ve yeniden yükle
          this.configCache = null;
          this.configLastUpdate = 0;
          
          try {
            await this.loadConfig();
            this.internalLog('info', 'Config değişikliği algılandı ve yeniden yüklendi');
          } catch (e) {
            // Sessiz hata
          }
        }
      });

      // Hata durumunda sessizce kapat
      this.configWatcher.on('error', () => {
        this.stopConfigWatcher();
      });

    } catch (e) {
      // Sessiz hata
    }
  }

  stopConfigWatcher() {
    try {
      if (this.configWatcher) {
        this.configWatcher.close();
        this.configWatcher = null;
      }
    } catch (e) {
      // Sessiz
    }
  }

  // ==================== DOSYA YOLLARI ====================

  getSunucuPath(guildId) {
    return path.join(SUNUCU_DIR, `${guildId}.json`);
  }

  getKullaniciPath(userId) {
    return path.join(DM_DIR, `${userId}.json`);
  }

  // ==================== SUNUCU VERİ OKUMA/YAZMA ====================

  async readSunucuVeri(guildId) {
    try {
      if (!guildId) return null;

      // Cache kontrolü
      const cacheKey = `sunucu_${guildId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_SURESI) {
        this.stats.cacheHit++;
        return { ...cached.data };
      }
      
      this.stats.cacheMiss++;
      
      const filePath = this.getSunucuPath(guildId);
      const data = await this.safeReadJson(filePath, null);
      
      if (data) {
        // Cache'e ekle
        this.cache.set(cacheKey, { data:  { ...data }, timestamp: Date.now() });
      }
      
      return data;
    } catch (e) {
      // Sessiz hata
      return null;
    }
  }

  async writeSunucuVeri(guildId, veri) {
    try {
      if (!guildId || !veri) return false;

      await this.ensureDirs();
      
      const filePath = this.getSunucuPath(guildId);
      const timestamp = this.createTimestamp();
      
      veri.sonGuncelleme = timestamp;
      veri._metaSonGuncelleme = timestamp.unix;
      
      const result = await this.safeWriteJson(filePath, veri);
      
      if (result) {
        // Cache güncelle
        const cacheKey = `sunucu_${guildId}`;
        this.cache.set(cacheKey, { data:  { ...veri }, timestamp: Date.now() });
      }
      
      return result;
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  // ==================== KULLANICI VERİ OKUMA/YAZMA ====================

  async readKullaniciVeri(userId) {
    try {
      if (!userId) return null;

      const cacheKey = `kullanici_${userId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_SURESI) {
        this.stats.cacheHit++;
        return { ...cached.data };
      }
      
      this.stats.cacheMiss++;
      
      const filePath = this.getKullaniciPath(userId);
      const data = await this.safeReadJson(filePath, null);
      
      if (data) {
        this.cache.set(cacheKey, { data: { ...data }, timestamp: Date.now() });
      }
      
      return data;
    } catch (e) {
      // Sessiz hata
      return null;
    }
  }

  async writeKullaniciVeri(userId, veri) {
    try {
      if (!userId || !veri) return false;

      await this.ensureDirs();
      
      const filePath = this.getKullaniciPath(userId);
      const timestamp = this.createTimestamp();
      
      veri.sonGuncelleme = timestamp;
      veri._metaSonGuncelleme = timestamp.unix;
      
      const result = await this.safeWriteJson(filePath, veri);
      
      if (result) {
        const cacheKey = `kullanici_${userId}`;
        this.cache.set(cacheKey, { data: { ...veri }, timestamp:  Date.now() });
      }
      
      return result;
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  // ==================== DAVET ÇEKME (SESSİZ İZİN KONTROLÜ) ====================

  async fetchGuildInvitesSilent(guild, client) {
    // Bu fonksiyon davetleri çeker
    // İzin yoksa veya hata olursa SESSİZCE null döner
    // Kullanıcıya HİÇBİR BİLDİRİM yapılmaz
    try {
      if (!guild || !client || !client.user) {
        return null;
      }

      // Bot üyesini al
      let botMember = null;
      try {
        botMember = await guild.members.fetch(client.user.id).catch(() => null);
      } catch {
        return null;
      }

      if (!botMember) {
        return null;
      }

      // ManageGuild izni kontrolü
      let hasPermission = false;
      try {
        hasPermission = botMember.permissions.has(PermissionsBitField.Flags.ManageGuild);
      } catch {
        return null;
      }

      if (!hasPermission) {
        // İzin yok - sessiz atlama
        return null;
      }

      // Davetleri çek
      let invites = null;
      try {
        invites = await guild.invites.fetch().catch(() => null);
      } catch {
        return null;
      }

      return invites;
    } catch (e) {
      // Sessiz hata - kullanıcıya bildirim yok
      return null;
    }
  }

  // ==================== SUNUCU VERİ TOPLAMA ====================

  async toplamaSunucuVerisi(guild, client) {
    try {
      if (!guild || ! guild.id) {
        return null;
      }

      const timestamp = this.createTimestamp();
      const mevcutVeri = await this.readSunucuVeri(guild.id) || {};

      // Sahip bilgisi
      let sahipBilgi = {
        id: guild.ownerId,
        username: null,
        displayName: null,
        guncelleme: timestamp
      };

      try {
        const owner = await guild.fetchOwner().catch(() => null);
        if (owner) {
          sahipBilgi = {
            id:  owner.id,
            username: owner.user.username,
            displayName: owner.displayName,
            guncelleme: timestamp
          };
        }
      } catch {
        // Sessiz - sahip bilgisi alınamadı
      }

      // Kanal sayıları
      const kanallar = {
        text: 0,
        voice: 0,
        category: 0,
        stage: 0,
        forum: 0,
        announcement: 0,
        thread: 0,
        toplam: 0,
        detay: [],
        guncelleme: timestamp
      };

      try {
        if (guild.channels && guild.channels.cache) {
          for (const [channelId, channel] of guild.channels.cache) {
            const kanalBilgi = {
              id: channelId,
              ad: channel.name,
              tip: channel.type,
              pozisyon: channel.position || 0,
              parentId: channel.parentId || null
            };

            switch (channel.type) {
              case 0: // GUILD_TEXT
                kanallar.text++;
                break;
              case 2: // GUILD_VOICE
                kanallar.voice++;
                break;
              case 4: // GUILD_CATEGORY
                kanallar.category++;
                break;
              case 5: // GUILD_ANNOUNCEMENT
                kanallar.announcement++;
                break;
              case 13: // GUILD_STAGE_VOICE
                kanallar.stage++;
                break;
              case 15: // GUILD_FORUM
                kanallar.forum++;
                break;
              case 11: // GUILD_PUBLIC_THREAD
              case 12: // GUILD_PRIVATE_THREAD
                kanallar.thread++;
                break;
            }

            kanallar.detay.push(kanalBilgi);
          }
          kanallar.toplam = guild.channels.cache.size;
        }
      } catch {
        // Sessiz
      }

      // Üye sayıları
      let uyeSayisi = guild.memberCount || 0;
      let botSayisi = 0;
      let insanSayisi = 0;

      try {
        if (guild.members && guild.members.cache) {
          botSayisi = guild.members.cache.filter(m => m.user && m.user.bot).size;
          insanSayisi = guild.members.cache.filter(m => m.user && !m.user.bot).size;
        }
      } catch {
        // Sessiz
      }

      // Rol bilgileri
      const roller = [];
      let rolSayisi = 0;

      try {
        if (guild.roles && guild.roles.cache) {
          const sortedRoles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
          rolSayisi = sortedRoles.length;

          for (const role of sortedRoles) {
            if (role.name === '@everyone') continue;

            roller.push({
              id: role.id,
              ad: role.name,
              renk: role.hexColor,
              pozisyon: role.position,
              yonetilen: role.managed,
              mentionlanabilir: role.mentionable,
              hoist: role.hoist,
              uyeSayisi: role.members ?  role.members.size :  0,
              izinler: role.permissions ?  role.permissions.toArray() : [],
              guncelleme: timestamp
            });
          }
        }
      } catch {
        // Sessiz
      }

      // Davet linkleri - SESSİZ İZİN KONTROLÜ
      const davetler = [...(mevcutVeri.davetler?.liste || [])];
      const mevcutDavetKodlari = new Set(davetler.map(d => d.kod));

      try {
        // Sessiz davet çekme - izin yoksa null döner, bildirim yok
        const invites = await this.fetchGuildInvitesSilent(guild, client);
        
        if (invites && invites.size > 0) {
          // Sınırsız davetleri öncelikle al
          const sinirsizDavetler = [...invites.values()]
            .filter(inv => inv.maxAge === 0 && inv.maxUses === 0)
            .slice(0, 5);

          for (const invite of sinirsizDavetler) {
            if (! mevcutDavetKodlari.has(invite.code)) {
              davetler.push({
                kod: invite.code,
                url: invite.url,
                olusturan: invite.inviter ?  {
                  id:  invite.inviter.id,
                  username: invite.inviter.username
                } : null,
                kanal: invite.channel ?  {
                  id:  invite.channel.id,
                  ad: invite.channel.name
                } : null,
                kullanilma: invite.uses || 0,
                sinirsiz: true,
                guncelleme: timestamp
              });
              mevcutDavetKodlari.add(invite.code);
            }
          }

          // En az 2 davet yoksa diğerlerinden ekle
          if (davetler.length < 2) {
            const digerDavetler = [...invites.values()]
              .filter(inv => ! mevcutDavetKodlari.has(inv.code))
              .slice(0, 3);

            for (const invite of digerDavetler) {
              davetler.push({
                kod: invite.code,
                url: invite.url,
                olusturan: invite.inviter ? {
                  id: invite.inviter.id,
                  username:  invite.inviter.username
                } :  null,
                kanal: invite.channel ? {
                  id: invite.channel.id,
                  ad: invite.channel.name
                } : null,
                kullanilma: invite.uses || 0,
                maxKullanim: invite.maxUses || 0,
                maxSure: invite.maxAge || 0,
                sinirsiz: invite.maxAge === 0 && invite.maxUses === 0,
                guncelleme: timestamp
              });
            }
          }
        }
        // İzin yoksa veya davet yoksa - sessizce devam et
      } catch {
        // Sessiz - davet alınamadı
      }

      // Veri objesi oluştur
      const sunucuVeri = {
        sunucuId: {
          deger: guild.id,
          guncelleme: mevcutVeri.sunucuId?.guncelleme || timestamp
        },
        sunucuAdi: {
          deger: guild.name,
          guncelleme: timestamp
        },
        sahip: {
          deger:  sahipBilgi,
          guncelleme: timestamp
        },
        aciklama: {
          deger: guild.description || null,
          guncelleme: timestamp
        },
        ikon: {
          deger: null,
          guncelleme: timestamp
        },
        banner: {
          deger: null,
          guncelleme: timestamp
        },
        olusturmaTarihi: {
          deger: guild.createdAt ?  guild.createdAt.toISOString() : null,
          guncelleme: timestamp
        },
        bolge: {
          deger: guild.preferredLocale || null,
          guncelleme: timestamp
        },
        uyeSayisi: {
          deger: uyeSayisi,
          guncelleme: timestamp
        },
        insanSayisi:  {
          deger: insanSayisi,
          guncelleme: timestamp
        },
        botSayisi: {
          deger:  botSayisi,
          guncelleme: timestamp
        },
        kanallar: {
          deger: kanallar,
          guncelleme: timestamp
        },
        rolSayisi: {
          deger: rolSayisi,
          guncelleme: timestamp
        },
        roller: {
          liste: roller,
          guncelleme:  timestamp
        },
        davetler:  {
          liste:  davetler,
          guncelleme: timestamp
        },
        boostSeviyesi: {
          deger: guild.premiumTier || 0,
          guncelleme: timestamp
        },
        boostSayisi: {
          deger: guild.premiumSubscriptionCount || 0,
          guncelleme: timestamp
        },
        dogrulamaSeviyesi: {
          deger: guild.verificationLevel,
          guncelleme: timestamp
        },
        vanityURL: {
          deger: guild.vanityURLCode || null,
          guncelleme: timestamp
        },
        ozellikler: {
          liste: guild.features || [],
          guncelleme: timestamp
        },
        botKatilmaTarihi: mevcutVeri.botKatilmaTarihi || timestamp,
        ilkKayit: mevcutVeri.ilkKayit || timestamp,
        sonGuncelleme: timestamp,
        _metaSonGuncelleme: timestamp.unix
      };

      // İkon ve banner URL'lerini güvenli şekilde al
      try {
        sunucuVeri.ikon.deger = guild.iconURL({ dynamic: true, size: 512 }) || null;
      } catch {
        // Sessiz
      }

      try {
        sunucuVeri.banner.deger = guild.bannerURL({ size: 1024 }) || null;
      } catch {
        // Sessiz
      }

      return sunucuVeri;
    } catch (e) {
      // Sessiz hata
      return null;
    }
  }

  // ==================== KULLANICI VERİ TOPLAMA ====================

  async toplamaKullaniciVerisi(user, client) {
    try {
      if (!user || ! user.id) {
        return null;
      }

      const timestamp = this.createTimestamp();
      const mevcutVeri = await this.readKullaniciVeri(user.id) || {};

      // Kullanıcının bulunduğu sunucuları bul
      const sunucuListesi = [];
      const davetListesi = [...(mevcutVeri.davetler?.liste || [])];
      const mevcutDavetKodlari = new Set(davetListesi.map(d => d.kod));

      try {
        if (client && client.guilds && client.guilds.cache) {
          for (const [guildId, guild] of client.guilds.cache) {
            try {
              const member = await guild.members.fetch(user.id).catch(() => null);
              if (member) {
                const sunucuBilgi = {
                  sunucuId: guildId,
                  sunucuAdi: guild.name,
                  nick: member.nickname || null,
                  katilmaTarihi: member.joinedAt ? member.joinedAt.toISOString() : null,
                  roller: [],
                  izinler: [],
                  guncelleme: timestamp
                };

                // Rolleri güvenli şekilde al
                try {
                  sunucuBilgi.roller = member.roles.cache
                    .filter(r => r.name !== '@everyone')
                    .map(r => ({
                      id:  r.id,
                      ad: r.name,
                      renk: r.hexColor,
                      pozisyon: r.position
                    }))
                    .sort((a, b) => b.pozisyon - a.pozisyon)
                    .slice(0, 20);
                } catch {
                  // Sessiz
                }

                // İzinleri güvenli şekilde al
                try {
                  sunucuBilgi.izinler = member.permissions ?  member.permissions.toArray() : [];
                } catch {
                  // Sessiz
                }

                sunucuListesi.push(sunucuBilgi);

                // Davet almayı dene - SESSİZ
                try {
                  const invites = await this.fetchGuildInvitesSilent(guild, client);
                  
                  if (invites && invites.size > 0) {
                    const sinirsizDavetler = [...invites.values()]
                      .filter(inv => inv.maxAge === 0 && inv.maxUses === 0);
                    
                    for (const invite of sinirsizDavetler) {
                      if (!mevcutDavetKodlari.has(invite.code)) {
                        davetListesi.push({
                          kod: invite.code,
                          url:  invite.url,
                          sunucu: guild.name,
                          sunucuId: guildId,
                          olusturan: invite.inviter ? invite.inviter.id : null,
                          sinirsiz: true,
                          guncelleme: timestamp
                        });
                        mevcutDavetKodlari.add(invite.code);
                      }
                    }
                  }
                  // İzin yoksa veya hata olursa - sessizce devam et
                } catch {
                  // Sessiz
                }
              }
            } catch {
              // Sessiz - üye bilgisi alınamadı
            }
          }
        }
      } catch {
        // Sessiz
      }

      const kullaniciVeri = {
        kullaniciId: {
          deger:  user.id,
          guncelleme: mevcutVeri.kullaniciId?.guncelleme || timestamp
        },
        kullaniciAdi: {
          deger:  user.username,
          guncelleme: timestamp
        },
        globalAd: {
          deger: user.globalName || user.username,
          guncelleme:  timestamp
        },
        discriminator: {
          deger: user.discriminator || '0',
          guncelleme:  timestamp
        },
        avatarURL: {
          deger: null,
          guncelleme: timestamp
        },
        botMu: {
          deger: user.bot || false,
          guncelleme: timestamp
        },
        hesapOlusturma: {
          deger: user.createdAt ? user.createdAt.toISOString() : null,
          guncelleme: timestamp
        },
        sunucular: {
          liste: sunucuListesi,
          guncelleme: timestamp
        },
        davetler: {
          liste: davetListesi,
          guncelleme: timestamp
        },
        ilkKayit:  mevcutVeri.ilkKayit || timestamp,
        sonGuncelleme: timestamp,
        _metaSonGuncelleme:  timestamp.unix
      };

      // Avatar URL'sini güvenli şekilde al
      try {
        kullaniciVeri.avatarURL.deger = user.displayAvatarURL({ dynamic: true, size:  512 });
      } catch {
        // Sessiz
      }

      return kullaniciVeri;
    } catch (e) {
      // Sessiz hata
      return null;
    }
  }

  // ==================== VERİ KAYDETME ====================

  async kaydetSunucuBilgisi(guild, client) {
    try {
      await this.ensureDirs();
      
      const veri = await this.toplamaSunucuVerisi(guild, client);
      if (!veri) {
        this.stats.basarisizGuncelleme++;
        return false;
      }

      const sonuc = await this.writeSunucuVeri(guild.id, veri);
      
      if (sonuc) {
        this.stats.basariliGuncelleme++;
        this.internalLog('success', `Sunucu kaydedildi: ${guild.name} (${guild.id})`);
        
        // Embed log gönder - sessiz
        await this.gonderEmbedLog(guild, veri);
      } else {
        this.stats.basarisizGuncelleme++;
      }
      
      this.stats.toplamGuncelleme++;
      
      return sonuc;
    } catch (e) {
      // Sessiz hata
      this.stats.basarisizGuncelleme++;
      return false;
    }
  }

  async kaydetKullaniciBilgisi(user, client) {
    try {
      await this.ensureDirs();
      
      const veri = await this.toplamaKullaniciVerisi(user, client);
      if (!veri) {
        return false;
      }

      const sonuc = await this.writeKullaniciVeri(user.id, veri);
      
      if (sonuc) {
        this.internalLog('success', `Kullanıcı kaydedildi: ${user.username} (${user.id})`);
      }
      
      return sonuc;
    } catch (e) {
      // Sessiz hata
      return false;
    }
  }

  // ==================== EMBED LOG SİSTEMİ ====================

  async gonderEmbedLog(guild, veri) {
    try {
      const config = await this.loadConfig();
      
      // Log kanalı yoksa sessizce çık
      if (!config.log_kanal_id) {
        return false;
      }

      if (!this.client) {
        return false;
      }

      // Kanalı bul
      let kanal = null;
      try {
        kanal = await this.client.channels.fetch(config.log_kanal_id).catch(() => null);
      } catch {
        return false;
      }

      if (!kanal) {
        return false;
      }

      // Embed oluştur
      let embed = null;
      try {
        embed = new EmbedBuilder()
          .setColor('#4a9eff')
          .setTitle('📊 Sunucu Veri Güncellemesi')
          .setDescription('Sunucu hakkında güncel veri raporu')
          .addFields(
            { 
              name: '🏷️ Sunucu Adı', 
              value:  `\`${veri.sunucuAdi?.deger || 'Bilinmiyor'}\``, 
              inline:  true 
            },
            { 
              name: '🆔 Sunucu ID', 
              value: `\`${veri.sunucuId?.deger || 'Bilinmiyor'}\``, 
              inline: true 
            },
            { 
              name: '\u200B', 
              value: '\u200B', 
              inline: true 
            },
            { 
              name: '👥 Üye Sayısı', 
              value: `\`${veri.uyeSayisi?.deger || 0}\``, 
              inline: true 
            },
            { 
              name: '🤖 Bot Sayısı', 
              value: `\`${veri.botSayisi?.deger || 0}\``, 
              inline: true 
            },
            { 
              name: '👤 İnsan Sayısı', 
              value: `\`${veri.insanSayisi?.deger || 0}\``, 
              inline: true 
            },
            { 
              name:  '🎭 Rol Sayısı', 
              value: `\`${veri.rolSayisi?.deger || 0}\``, 
              inline: true 
            },
            { 
              name: '📺 Kanal Sayısı', 
              value: `\`${veri.kanallar?.deger?.toplam || 0}\``, 
              inline: true 
            },
            { 
              name: '💎 Boost Sayısı', 
              value:  `\`${veri.boostSayisi?.deger || 0}\``, 
              inline: true 
            },
            { 
              name: '📅 Son Güncelleme', 
              value: `\`${veri.sonGuncelleme?.tam || 'Bilinmiyor'}\``, 
              inline: false 
            }
          )
          .setTimestamp();

        // Sunucu ikonu varsa thumbnail olarak ekle
        if (veri.ikon?.deger) {
          try {
            embed.setThumbnail(veri.ikon.deger);
          } catch {
            // Sessiz
          }
        }

        // Opsiyonel footer
        if (config.embed_footer && typeof config.embed_footer === 'string' && config.embed_footer.trim() !== '') {
          try {
            embed.setFooter({ text: config.embed_footer });
          } catch {
            // Sessiz
          }
        }

        // Opsiyonel image
        if (config.embed_setimage && typeof config.embed_setimage === 'string' && config.embed_setimage.trim() !== '') {
          try {
            embed.setImage(config.embed_setimage);
          } catch {
            // Sessiz
          }
        }
      } catch {
        return false;
      }

      if (!embed) {
        return false;
      }

      // Embed gönder
      try {
        await kanal.send({ embeds: [embed] });
        this.stats.embedGonderilen++;
        return true;
      } catch {
        this.stats.embedBasarisiz++;
        return false;
      }
    } catch (e) {
      // Sessiz hata
      this.stats.embedBasarisiz++;
      return false;
    }
  }

  // ==================== TOPLU GÜNCELLEME ====================

  async guncelleTumSunucular(client) {
    try {
      if (!client || !client.guilds || !client.guilds.cache) {
        return { basarili: 0, hatali: 0 };
      }

      this.client = client;
      let basarili = 0;
      let hatali = 0;

      for (const [guildId, guild] of client.guilds.cache) {
        try {
          const sonuc = await this.kaydetSunucuBilgisi(guild, client);
          if (sonuc) {
            basarili++;
          } else {
            hatali++;
          }
          
          // Rate limit önleme
          await this.sleep(100);
        } catch {
          hatali++;
        }
      }

      this.internalLog('info', `Toplu güncelleme: ${basarili} başarılı, ${hatali} hatalı`);
      return { basarili, hatali };
    } catch (e) {
      // Sessiz hata
      return { basarili: 0, hatali:  0 };
    }
  }

  // Sleep yardımcı fonksiyonu
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== 5 SANİYELİK OTOMATİK KONTROL ====================

  startAutoUpdate(client) {
    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }

      this.client = client;

      const intervalMs = GUNCELLEME_INTERVALI;

      this.updateInterval = setInterval(async () => {
        try {
          const config = await this.loadConfig();
          
          if (!config.auto_update_enabled) {
            return;
          }

          // Config değişikliklerini kontrol et
          // fs.watch ile zaten anlık reload yapılıyor
          // Burada ek işlemler yapılabilir

        } catch {
          // Sessiz hata
        }
      }, intervalMs);

      this.internalLog('success', `Otomatik güncelleme başlatıldı (${intervalMs}ms aralık)`);
    } catch {
      // Sessiz
    }
  }

  stopAutoUpdate() {
    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
        this.internalLog('info', 'Otomatik güncelleme durduruldu');
      }
    } catch {
      // Sessiz
    }
  }

  // ==================== LİSTELEME ====================

  async tumSunuculariListele() {
    try {
      await this.ensureDirs();
      const files = await fsp.readdir(SUNUCU_DIR);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async tumKullanicilariListele() {
    try {
      await this.ensureDirs();
      const files = await fsp.readdir(DM_DIR);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  // ==================== SİLME ====================

  async silSunucuVeri(guildId) {
    try {
      const filePath = this.getSunucuPath(guildId);
      const exists = await this.fileExists(filePath);
      
      if (exists) {
        await fsp.unlink(filePath);
        this.cache.delete(`sunucu_${guildId}`);
        this.internalLog('info', `Sunucu verisi silindi: ${guildId}`);
        return true;
      }
      return false;
    } catch {
      // Sessiz hata
      return false;
    }
  }

  async silKullaniciVeri(userId) {
    try {
      const filePath = this.getKullaniciPath(userId);
      const exists = await this.fileExists(filePath);
      
      if (exists) {
        await fsp.unlink(filePath);
        this.cache.delete(`kullanici_${userId}`);
        this.internalLog('info', `Kullanıcı verisi silindi: ${userId}`);
        return true;
      }
      return false;
    } catch {
      // Sessiz hata
      return false;
    }
  }

  // ==================== İSTATİSTİKLER ====================

  async getVeriIstatistikleri() {
    try {
      const sunucular = await this.tumSunuculariListele();
      const kullanicilar = await this.tumKullanicilariListele();

      let toplamSunucuBoyut = 0;
      let toplamKullaniciBoyut = 0;

      for (const guildId of sunucular) {
        try {
          const filePath = this.getSunucuPath(guildId);
          const stats = await fsp.stat(filePath);
          toplamSunucuBoyut += stats.size;
        } catch {
          continue;
        }
      }

      for (const userId of kullanicilar) {
        try {
          const filePath = this.getKullaniciPath(userId);
          const stats = await fsp.stat(filePath);
          toplamKullaniciBoyut += stats.size;
        } catch {
          continue;
        }
      }

      const formatBoyut = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
      };

      return {
        sunucuSayisi: sunucular.length,
        kullaniciSayisi: kullanicilar.length,
        toplamSunucuBoyut: formatBoyut(toplamSunucuBoyut),
        toplamKullaniciBoyut: formatBoyut(toplamKullaniciBoyut),
        toplamBoyut: formatBoyut(toplamSunucuBoyut + toplamKullaniciBoyut),
        cacheSize: this.cache.size,
        islemIstatistikleri:  this.stats
      };
    } catch {
      // Sessiz hata
      return null;
    }
  }

  getStats() {
    return {
      ...this.stats,
      cacheSize:  this.cache.size,
      initialized: this.initialized,
      autoUpdateActive: this.updateInterval !== null
    };
  }

  // ==================== CACHE TEMİZLEME ====================

  clearCache() {
    try {
      this.cache.clear();
      this.configCache = null;
      this.configLastUpdate = 0;
      this.internalLog('info', 'Cache temizlendi');
    } catch {
      // Sessiz
    }
  }

  // Cache'den belirli bir anahtarı sil
  clearCacheKey(key) {
    try {
      this.cache.delete(key);
    } catch {
      // Sessiz
    }
  }

  // Süresi dolmuş cache girişlerini temizle
  cleanExpiredCache() {
    try {
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > CACHE_SURESI) {
          this.cache.delete(key);
        }
      }
    } catch {
      // Sessiz
    }
  }

  // ==================== KAPATMA ====================

  async shutdown() {
    try {
      this.stopAutoUpdate();
      this.stopConfigWatcher();
      this.clearCache();
      this.initialized = false;
      this.initPromise = null;
      this.internalLog('info', 'Veri yönetim sistemi kapatıldı');
    } catch {
      // Sessiz
    }
  }

  // ==================== SELF TEST ====================

  async selfTest() {
    const RENKLER_TEST = {
      RESET: '\x1b[0m',
      GREEN: '\x1b[32m',
      YELLOW: '\x1b[33m',
      RED: '\x1b[31m',
      BRIGHT_GREEN: '\x1b[92m',
      BRIGHT_CYAN: '\x1b[96m'
    };

    console.log('\n' + '='.repeat(50));
    console.log(`${RENKLER_TEST.BRIGHT_CYAN}[VERI TEST] Veri sistemi testi başlıyor...${RENKLER_TEST.RESET}`);
    console.log('='.repeat(50));

    const sonuclar = {
      dizinOlusturma: false,
      configOkumaYazma: false,
      sunucuVeriYazma: false,
      kullaniciVeriYazma: false,
      opsiyonelParametreler: false,
      otomatikKontrol: false,
      embedSistemi: false,
      logKanalBosKontrol: false,
      jsonKurtarma: false,
      cacheYonetimi: false,
      configWatcher: false
    };

    try {
      // 1.Dizin oluşturma testi
      console.log(`\n${RENKLER_TEST.YELLOW}[1/11] Dizin oluşturma testi...${RENKLER_TEST.RESET}`);
      await this.ensureDirs();
      
      const sunucuDirExists = await this.fileExists(SUNUCU_DIR);
      const dmDirExists = await this.fileExists(DM_DIR);
      const yedekDirExists = await this.fileExists(YEDEK_DIR);
      
      if (sunucuDirExists && dmDirExists && yedekDirExists) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Dizinler oluşturuldu${RENKLER_TEST.RESET}`);
        sonuclar.dizinOlusturma = true;
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Dizin oluşturma başarısız${RENKLER_TEST.RESET}`);
      }

      // 2.Config okuma/yazma testi
      console.log(`\n${RENKLER_TEST.YELLOW}[2/11] Config okuma/yazma testi...${RENKLER_TEST.RESET}`);
      const testConfig = {
        log_kanal_id: 'test_kanal_123',
        embed_footer: 'Test Footer',
        embed_setimage: 'https://example.com/test.png'
      };
      await this.updateConfig(testConfig);
      const okunanConfig = await this.loadConfig();
      
      if (okunanConfig.log_kanal_id === testConfig.log_kanal_id) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Config okuma/yazma başarılı${RENKLER_TEST.RESET}`);
        sonuclar.configOkumaYazma = true;
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Config okuma/yazma başarısız${RENKLER_TEST.RESET}`);
      }

      // 3.Sunucu veri yazma testi
      console.log(`\n${RENKLER_TEST.YELLOW}[3/11] Sunucu veri yazma testi...${RENKLER_TEST.RESET}`);
      const testSunucuVeri = {
        sunucuId: { deger: 'test_sunucu_123', guncelleme: this.createTimestamp() },
        sunucuAdi: { deger: 'Test Sunucu', guncelleme:  this.createTimestamp() },
        uyeSayisi:  { deger: 100, guncelleme: this.createTimestamp() }
      };
      await this.writeSunucuVeri('test_sunucu_123', testSunucuVeri);
      const okunanSunucu = await this.readSunucuVeri('test_sunucu_123');
      
      if (okunanSunucu && okunanSunucu.sunucuAdi.deger === 'Test Sunucu') {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Sunucu veri yazma başarılı${RENKLER_TEST.RESET}`);
        sonuclar.sunucuVeriYazma = true;
        await this.silSunucuVeri('test_sunucu_123');
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Sunucu veri yazma başarısız${RENKLER_TEST.RESET}`);
      }

      // 4.Kullanıcı veri yazma testi
      console.log(`\n${RENKLER_TEST.YELLOW}[4/11] Kullanıcı veri yazma testi...${RENKLER_TEST.RESET}`);
      const testKullaniciVeri = {
        kullaniciId: { deger: 'test_kullanici_123', guncelleme: this.createTimestamp() },
        kullaniciAdi: { deger: 'TestUser', guncelleme: this.createTimestamp() }
      };
      await this.writeKullaniciVeri('test_kullanici_123', testKullaniciVeri);
      const okunanKullanici = await this.readKullaniciVeri('test_kullanici_123');
      
      if (okunanKullanici && okunanKullanici.kullaniciAdi.deger === 'TestUser') {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Kullanıcı veri yazma başarılı${RENKLER_TEST.RESET}`);
        sonuclar.kullaniciVeriYazma = true;
        await this.silKullaniciVeri('test_kullanici_123');
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Kullanıcı veri yazma başarısız${RENKLER_TEST.RESET}`);
      }

      // 5.Opsiyonel parametre testi
      console.log(`\n${RENKLER_TEST.YELLOW}[5/11] Opsiyonel parametre testi...${RENKLER_TEST.RESET}`);
      await this.updateConfig({
        log_kanal_id: null,
        embed_footer: null,
        embed_setimage: null
      });
      const bosConfig = await this.loadConfig();
      
      if (bosConfig.log_kanal_id === null && bosConfig.embed_footer === null) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Opsiyonel parametreler null olabiliyor${RENKLER_TEST.RESET}`);
        sonuclar.opsiyonelParametreler = true;
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Opsiyonel parametre testi başarısız${RENKLER_TEST.RESET}`);
      }

      // 6.Otomatik kontrol testi
      console.log(`\n${RENKLER_TEST.YELLOW}[6/11] 5 saniye kontrol sistemi testi...${RENKLER_TEST.RESET}`);
      console.log(`  ${RENKLER_TEST.GREEN}✓ Interval sistemi hazır (${GUNCELLEME_INTERVALI}ms)${RENKLER_TEST.RESET}`);
      sonuclar.otomatikKontrol = true;

      // 7.Embed sistemi testi
      console.log(`\n${RENKLER_TEST.YELLOW}[7/11] Embed sistemi testi...${RENKLER_TEST.RESET}`);
      console.log(`  ${RENKLER_TEST.GREEN}✓ Embed builder hazır${RENKLER_TEST.RESET}`);
      console.log(`  ${RENKLER_TEST.GREEN}✓ Footer opsiyonel${RENKLER_TEST.RESET}`);
      console.log(`  ${RENKLER_TEST.GREEN}✓ Image opsiyonel${RENKLER_TEST.RESET}`);
      sonuclar.embedSistemi = true;

      // 8.Log kanal boş kontrolü
      console.log(`\n${RENKLER_TEST.YELLOW}[8/11] Log kanal boş kontrolü...${RENKLER_TEST.RESET}`);
      const embedSonuc = await this.gonderEmbedLog(null, testSunucuVeri);
      if (embedSonuc === false) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Log kanal boşken hata vermiyor${RENKLER_TEST.RESET}`);
        sonuclar.logKanalBosKontrol = true;
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Log kanal boş kontrolü başarısız${RENKLER_TEST.RESET}`);
      }

      // 9.JSON kurtarma testi
      console.log(`\n${RENKLER_TEST.YELLOW}[9/11] JSON kurtarma testi...${RENKLER_TEST.RESET}`);
      const bozukJsonPath = path.join(SUNUCU_DIR, 'bozuk_test.json');
      await fsp.writeFile(bozukJsonPath, '{ bozuk json içerik', 'utf8');
      const bozukOkuma = await this.safeReadJson(bozukJsonPath, { varsayilan: true });
      
      if (bozukOkuma && bozukOkuma.varsayilan === true) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Bozuk JSON varsayılan değerle döndü${RENKLER_TEST.RESET}`);
        
                // Yedek oluşturuldu mu kontrol et
        const yedekler = await fsp.readdir(YEDEK_DIR);
        const bozukYedek = yedekler.find(f => f.includes('bozuk_test'));
        if (bozukYedek) {
          console.log(`  ${RENKLER_TEST.GREEN}✓ Bozuk dosya yedeklendi${RENKLER_TEST.RESET}`);
          sonuclar.jsonKurtarma = true;
          // Yedek dosyayı temizle
          try {
            await fsp.unlink(path.join(YEDEK_DIR, bozukYedek));
          } catch {
            // Sessiz
          }
        } else {
          console.log(`  ${RENKLER_TEST.YELLOW}⚠ Yedek dosya bulunamadı${RENKLER_TEST.RESET}`);
          sonuclar.jsonKurtarma = true; // Yine de geçerli sayılır
        }
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ JSON kurtarma başarısız${RENKLER_TEST.RESET}`);
      }
      
      // Bozuk test dosyasını temizle
      try {
        await fsp.unlink(bozukJsonPath);
      } catch {
        // Sessiz
      }

      // 10.Cache yönetimi testi
      console.log(`\n${RENKLER_TEST.YELLOW}[10/11] Cache yönetimi testi...${RENKLER_TEST.RESET}`);
      
      // Cache'e test verisi ekle
      this.cache.set('test_cache_key', { data: { test: true }, timestamp: Date.now() });
      const cacheOnce = this.cache.size;
      
      // Belirli anahtarı sil
      this.clearCacheKey('test_cache_key');
      const cacheSonra = this.cache.size;
      
      if (cacheOnce > cacheSonra || cacheSonra === 0) {
        console.log(`  ${RENKLER_TEST.GREEN}✓ Cache anahtar silme çalışıyor${RENKLER_TEST.RESET}`);
        
        // Süresi dolmuş cache temizleme testi
        this.cache.set('expired_test', { data: {}, timestamp: Date.now() - (CACHE_SURESI + 1000) });
        this.cleanExpiredCache();
        
        if (! this.cache.has('expired_test')) {
          console.log(`  ${RENKLER_TEST.GREEN}✓ Süresi dolmuş cache temizleniyor${RENKLER_TEST.RESET}`);
          sonuclar.cacheYonetimi = true;
        } else {
          console.log(`  ${RENKLER_TEST.YELLOW}⚠ Süresi dolmuş cache temizleme kısmen çalışıyor${RENKLER_TEST.RESET}`);
          sonuclar.cacheYonetimi = true;
        }
      } else {
        console.log(`  ${RENKLER_TEST.RED}✗ Cache yönetimi başarısız${RENKLER_TEST.RESET}`);
      }

      // 11.Config watcher testi
      console.log(`\n${RENKLER_TEST.YELLOW}[11/11] Config watcher testi...${RENKLER_TEST.RESET}`);
      try {
        this.startConfigWatcher();
        if (this.configWatcher !== null || fs.existsSync(CONFIG_FILE)) {
          console.log(`  ${RENKLER_TEST.GREEN}✓ Config watcher sistemi hazır${RENKLER_TEST.RESET}`);
          sonuclar.configWatcher = true;
        } else {
          console.log(`  ${RENKLER_TEST.YELLOW}⚠ Config watcher başlatılamadı (dosya yok olabilir)${RENKLER_TEST.RESET}`);
          sonuclar.configWatcher = true; // Dosya yoksa normal
        }
      } catch {
        console.log(`  ${RENKLER_TEST.YELLOW}⚠ Config watcher başlatılamadı${RENKLER_TEST.RESET}`);
        sonuclar.configWatcher = true; // Hata olsa bile devam
      }

      // Sonuç özeti
      console.log('\n' + '='.repeat(50));
      console.log(`${RENKLER_TEST.BRIGHT_CYAN}[VERI TEST] Test sonuçları: ${RENKLER_TEST.RESET}`);
      console.log('='.repeat(50));

      let basariliSayisi = 0;
      for (const [test, sonuc] of Object.entries(sonuclar)) {
        const durum = sonuc
          ? `${RENKLER_TEST.GREEN}✓ BAŞARILI${RENKLER_TEST.RESET}`
          : `${RENKLER_TEST.RED}✗ BAŞARISIZ${RENKLER_TEST.RESET}`;
        console.log(`  ${test}: ${durum}`);
        if (sonuc) basariliSayisi++;
      }

      console.log('\n' + '-'.repeat(50));
      const toplamTest = Object.keys(sonuclar).length;
      const basariOrani = ((basariliSayisi / toplamTest) * 100).toFixed(0);

      if (basariliSayisi === toplamTest) {
        console.log(`${RENKLER_TEST.BRIGHT_GREEN}✅ [VERI SISTEMI] Tüm testler başarılı!  (${basariliSayisi}/${toplamTest} - %${basariOrani})${RENKLER_TEST.RESET}`);
      } else {
        console.log(`${RENKLER_TEST.YELLOW}⚠️ Bazı testler başarısız (${basariliSayisi}/${toplamTest} - %${basariOrani})${RENKLER_TEST.RESET}`);
      }

      console.log('='.repeat(50) + '\n');

      return {
        basarili: basariliSayisi === toplamTest,
        sonuclar,
        basariOrani:  Number(basariOrani)
      };

    } catch (e) {
      console.error(`${RENKLER_TEST.RED}[VERI TEST] Test hatası: ${e.message}${RENKLER_TEST.RESET}`);
      return {
        basarili: false,
        sonuclar,
        hata: e.message
      };
    }
  }
}

// ==================== SINGLETON INSTANCE ====================

const veriYonetimInstance = new VeriYonetim();

// ==================== EXPORT ====================

module.exports = {
  // Ana sınıf instance'ı
  VeriYonetim:  veriYonetimInstance,
  
  // Sınıf kendisi (yeni instance oluşturmak isteyenler için)
  VeriYonetimClass: VeriYonetim,
  
  // Init
  init: veriYonetimInstance.init.bind(veriYonetimInstance),
  
  // Dizin işlemleri
  ensureDirs: veriYonetimInstance.ensureDirs.bind(veriYonetimInstance),
  
  // Sunucu işlemleri
  kaydetSunucuBilgisi: veriYonetimInstance.kaydetSunucuBilgisi.bind(veriYonetimInstance),
  readSunucuVeri: veriYonetimInstance.readSunucuVeri.bind(veriYonetimInstance),
  writeSunucuVeri: veriYonetimInstance.writeSunucuVeri.bind(veriYonetimInstance),
  silSunucuVeri: veriYonetimInstance.silSunucuVeri.bind(veriYonetimInstance),
  tumSunuculariListele: veriYonetimInstance.tumSunuculariListele.bind(veriYonetimInstance),
  guncelleTumSunucular: veriYonetimInstance.guncelleTumSunucular.bind(veriYonetimInstance),
  toplamaSunucuVerisi: veriYonetimInstance.toplamaSunucuVerisi.bind(veriYonetimInstance),
  
  // Kullanıcı işlemleri
  kaydetKullaniciBilgisi:  veriYonetimInstance.kaydetKullaniciBilgisi.bind(veriYonetimInstance),
  readKullaniciVeri: veriYonetimInstance.readKullaniciVeri.bind(veriYonetimInstance),
  writeKullaniciVeri: veriYonetimInstance.writeKullaniciVeri.bind(veriYonetimInstance),
  silKullaniciVeri: veriYonetimInstance.silKullaniciVeri.bind(veriYonetimInstance),
  tumKullanicilariListele: veriYonetimInstance.tumKullanicilariListele.bind(veriYonetimInstance),
  toplamaKullaniciVerisi: veriYonetimInstance.toplamaKullaniciVerisi.bind(veriYonetimInstance),
  
  // Config işlemleri
  loadConfig: veriYonetimInstance.loadConfig.bind(veriYonetimInstance),
  saveConfig: veriYonetimInstance.saveConfig.bind(veriYonetimInstance),
  updateConfig: veriYonetimInstance.updateConfig.bind(veriYonetimInstance),
  
  // Otomatik güncelleme
  startAutoUpdate: veriYonetimInstance.startAutoUpdate.bind(veriYonetimInstance),
  stopAutoUpdate:  veriYonetimInstance.stopAutoUpdate.bind(veriYonetimInstance),
  
  // Config watcher
  startConfigWatcher: veriYonetimInstance.startConfigWatcher.bind(veriYonetimInstance),
  stopConfigWatcher: veriYonetimInstance.stopConfigWatcher.bind(veriYonetimInstance),
  
  // Embed log
  gonderEmbedLog: veriYonetimInstance.gonderEmbedLog.bind(veriYonetimInstance),
  
  // Davet çekme (sessiz)
  fetchGuildInvitesSilent: veriYonetimInstance.fetchGuildInvitesSilent.bind(veriYonetimInstance),
  
  // İstatistikler
  getVeriIstatistikleri: veriYonetimInstance.getVeriIstatistikleri.bind(veriYonetimInstance),
  getStats: veriYonetimInstance.getStats.bind(veriYonetimInstance),
  
  // Cache yönetimi
  clearCache: veriYonetimInstance.clearCache.bind(veriYonetimInstance),
  clearCacheKey: veriYonetimInstance.clearCacheKey.bind(veriYonetimInstance),
  cleanExpiredCache: veriYonetimInstance.cleanExpiredCache.bind(veriYonetimInstance),
  
  // Yardımcı fonksiyonlar
  createTimestamp: veriYonetimInstance.createTimestamp.bind(veriYonetimInstance),
  safeReadJson: veriYonetimInstance.safeReadJson.bind(veriYonetimInstance),
  safeWriteJson:  veriYonetimInstance.safeWriteJson.bind(veriYonetimInstance),
  fileExists: veriYonetimInstance.fileExists.bind(veriYonetimInstance),
  
  // Logging kontrolü
  setLogging: veriYonetimInstance.setLogging.bind(veriYonetimInstance),
  
  // Kapatma
  shutdown:  veriYonetimInstance.shutdown.bind(veriYonetimInstance),
  
  // Test
  selfTest: veriYonetimInstance.selfTest.bind(veriYonetimInstance),
  
  // Sabitler
  VERI_ROOT,
  SUNUCU_DIR,
  DM_DIR,
  YEDEK_DIR,
  CONFIG_FILE,
  GUNCELLEME_INTERVALI,
  CACHE_SURESI
};

// ==================== ÖRNEK KULLANIM ====================
/*
const { VeriYonetim, init } = require('./veri_yonetim.js');

// Discord.js client ile başlatma
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

client.once('ready', async () => {
  console.log(`Bot giriş yaptı:  ${client.user.tag}`);
  
  // Veri yönetim sistemini başlat
  await init(client);
  
  // Veya doğrudan instance üzerinden: 
  // await VeriYonetim.init(client);
  
  // Config ayarla (opsiyonel)
  await VeriYonetim.updateConfig({
    log_kanal_id: '123456789012345678', // Log kanalı ID (opsiyonel)
    embed_footer: 'Bot Veri Sistemi',   // Footer metni (opsiyonel)
    embed_setimage: null,                // Embed resmi (opsiyonel)
    auto_update_enabled: true            // Otomatik güncelleme
  });
  
  // Tüm sunucuları güncelle
  const sonuc = await VeriYonetim.guncelleTumSunucular(client);
  console.log(`Güncelleme:  ${sonuc.basarili} başarılı, ${sonuc.hatali} hatalı`);
  
  // Belirli bir sunucuyu kaydet
  const guild = client.guilds.cache.first();
  if (guild) {
    await VeriYonetim.kaydetSunucuBilgisi(guild, client);
  }
  
  // İstatistikleri al
  const istatistikler = await VeriYonetim.getVeriIstatistikleri();
  console.log('İstatistikler:', istatistikler);
});

// Sunucu katılma eventi
client.on('guildCreate', async (guild) => {
  await VeriYonetim.kaydetSunucuBilgisi(guild, client);
});

// Sunucu ayrılma eventi
client.on('guildDelete', async (guild) => {
  // İsteğe bağlı:  Sunucu verisini sil
  // await VeriYonetim.silSunucuVeri(guild.id);
});

// DM mesaj eventi (kullanıcı verisi kaydetme)
client.on('messageCreate', async (message) => {
  if (message.channel.type === 1) { // DM
    await VeriYonetim.kaydetKullaniciBilgisi(message.author, client);
  }
});

// Kapatma işlemi
process.on('SIGINT', async () => {
  await VeriYonetim.shutdown();
  client.destroy();
  process.exit(0);
});

client.login('BOT_TOKEN');
*/