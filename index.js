// index.js
// Discord Bot - Enterprise Seviyesi
// Command signature system, permission handler, graceful startup

require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  InteractionType
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const DatabaseManager = require('./dbmanager');
const LogYonetim = require('./log_yonetim');

/* ==================== ORTAM DEĞİŞKENLERİ ====================*/
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;
const PANEL_DEAKTIF_SANIYE = Math.max(10, Number(process.env.PANEL_DEAKTIF_SANIYE || 60));

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ KRITIK: TOKEN ve CLIENT_ID gereklidir!  ');
  process.exit(1);
}

/* ==================== DOSYA YOLLARI ====================*/
const BASE = process.cwd();
const LOGLAR_ROOT = path.join(BASE, 'loglar');
const CACHE_DIR = path.join(BASE, '.   cache');
const KOMUTLAR_DIR = path.join(BASE, 'komutlar');
const OWNER_KOMUT_DIR = path.join(BASE, 'owner_komut');
const STATELER_DIR = path.join(BASE, 'stateler');
const SAYFALAR_DIR = path.join(BASE, 'sayfalar');
const ADMINLER_DOSYA = path.  join(BASE, 'adminler. json');
const COMMAND_SIGNATURE_FILE = path.  join(CACHE_DIR, 'command_signature.json');

/* ==================== DİZİN OLUŞTURMA ====================*/
async function ensureDirs() {
  const dirs = [
    LOGLAR_ROOT,
    path.join(LOGLAR_ROOT, 'sunucular'),
    path.join(LOGLAR_ROOT, 'dm'),
    path.join(LOGLAR_ROOT, 'bot_genel'),
    path.join(LOGLAR_ROOT, 'database'),
    path.join(LOGLAR_ROOT, 'panel'),
    path.join(LOGLAR_ROOT, 'log_kalici_arsiv'),
    CACHE_DIR,
    KOMUTLAR_DIR,
    OWNER_KOMUT_DIR,
    STATELER_DIR,
    SAYFALAR_DIR
  ];

  for (const d of dirs) {
    try {
      await fsp.mkdir(d, { recursive: true });
    } catch (e) {
      console.error('Dizin oluşturma hatası:', d, e && e.message);
    }
  }

  try {
    if (!fs.existsSync(ADMINLER_DOSYA)) {
      fs.writeFileSync(ADMINLER_DOSYA, JSON.stringify({ admins: [] }, null, 2), 'utf8');
    }
  } catch (_) {}

  try {
    if (!fs.existsSync(COMMAND_SIGNATURE_FILE)) {
      fs.writeFileSync(COMMAND_SIGNATURE_FILE, JSON.stringify({ commands: {} }, null, 2), 'utf8');
    }
  } catch (_) {}
}

ensureDirs().catch(() => {});

/* ==================== YETKİ SİSTEMİ ====================*/

async function getAdmins() {
  try {
    if (fs.existsSync(ADMINLER_DOSYA)) {
      const data = JSON.parse(fs.readFileSync(ADMINLER_DOSYA, 'utf8'));
      return data. admins || [];
    }
  } catch (e) {
    console.error('Admin dosyası okunamadı:', e && e.message);
  }
  return [];
}

function isOwner(userId) {
  return BOT_OWNER_ID && userId === BOT_OWNER_ID;
}

async function isAdmin(userId) {
  const admins = await getAdmins();
  return admins.includes(userId);
}

// ✅ YETKİ KONTROLÜ - OWNER + ADMIN BİRLEŞTİRİLMİŞ
async function hasPermission(userId, level = 'user') {
  if (level === 'owner') {
    return isOwner(userId);
  } else if (level === 'admin') {
    return isOwner(userId) || await isAdmin(userId);
  }
  return true; // user seviyesi herkes
}

async function checkPermission(interaction, requiredLevel = 'user') {
  const userId = interaction.user.id;

  if (requiredLevel === 'owner' && !isOwner(userId)) {
    await LogYonetim.yetkiHatasi(userId, '🚫 Owner-only komut', interaction.guildId);
    
    const embed = new EmbedBuilder()
      .setColor('#ff4444')
      .setTitle('🚫 Yetkisiz İşlem')
      .setDescription('Bu komut yalnızca bot sahibi tarafından kullanılabilir.')
      .setTimestamp();

    try {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (_) {}
    return false;
  }

  if (requiredLevel === 'admin' && !await hasPermission(userId, 'admin')) {
    await LogYonetim.yetkiHatasi(userId, '🚫 Admin-only komut', interaction.guildId);
    
    const embed = new EmbedBuilder()
      .setColor('#ff4444')
      .setTitle('🚫 Yetkisiz İşlem')
      .setDescription('Bu komut yalnızca yöneticiler tarafından kullanılabilir.')
      .setTimestamp();

    try {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (_) {}
    return false;
  }

  return true;
}

/* ==================== DATABASE STARTUP ====================*/
const dbManager = new DatabaseManager(null);

// ✅ DB ENV KONTROLÜ
const dbEnvValid = dbManager.checkEnvValidity();

if (dbEnvValid) {
  try {
    dbManager.register('main', {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.  env.DB_NAME || 'main'
    });

    LogYonetim.info('db_startup', '🟢 Veritabanı başlatıldı', {
      klasor: 'database',
      key: 'startup'
    }).catch(() => {});
  } catch (e) {
    LogYonetim.sistemHatasi(`❌ DB startup:  ${e && (e.stack || e.message)}`, 'ERROR').catch(() => {});
  }
}

// DBManager'a logger ata
dbManager.logger = {
  info: (event, message, opts) => {
    LogYonetim.info(event, message, Object.assign({}, opts, { klasor: 'database', key: 'db' })).catch(() => {});
  },
  warn: (event, message, opts) => {
    LogYonetim.  warn(event, message, Object.  assign({}, opts, { klasor: 'database', key: 'db' })).catch(() => {});
  },
  error: (event, message, opts) => {
    LogYonetim.error(event, message, Object.assign({}, opts, { klasor: 'database', key: 'db' })).catch(() => {});
  },
  debug: (event, message, opts) => {
    LogYonetim.  debug(event, message, Object.  assign({}, opts, { klasor: 'database', key: 'db' })).catch(() => {});
  },
  critical: (event, message, opts) => {
    LogYonetim.critical(event, message, Object.assign({}, opts, { klasor: 'database', key: 'db' })).catch(() => {});
  }
};

/* ==================== DISCORD CLIENT ====================*/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent  // ✅ MessageContent eklendi
  ],
  partials: [Partials.Channel]
});

const rest = new REST({ version: '10' }).setToken(TOKEN);
client.commands = new Map();
client.ownerCommands = new Map();

/* ==================== COMMAND SIGNATURE SYSTEM ✅ ====================*/

function getCommandSignature(cmdData) {
  try {
    const payload = JSON.stringify(cmdData);
    return crypto.createHash('md5').update(payload).digest('hex');
  } catch (e) {
    return null;
  }
}

async function loadCommandSignatures() {
  try {
    if (fs.existsSync(COMMAND_SIGNATURE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COMMAND_SIGNATURE_FILE, 'utf8'));
      return data.commands || {};
    }
  } catch (e) {
    console.error('❌ Command signature okunamadı:', e && e. message);
  }
  return {};
}

async function saveCommandSignatures(signatures) {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(COMMAND_SIGNATURE_FILE, JSON. stringify({ commands: signatures }, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Command signature kaydedilemedi:', e && e.message);
  }
}

/* ==================== KOMUT YÜKLEME ====================*/

async function loadCommandsFrom(folder, targetMap) {
  try {
    await fsp.mkdir(folder, { recursive: true });
    const files = await fsp.readdir(folder).catch(() => []);

    for (const f of files.  filter(x => x.endsWith('.js') || x.endsWith('.cjs'))) {
      const full = path.join(folder, f);
      try {
        delete require.cache[require.resolve(full)];
        const cmd = require(full);

        if (!  cmd || ! cmd.data || !cmd.data.name || typeof cmd.execute !== 'function') {
          await LogYonetim.warn('komut_gecersiz', `⚠️ Komut atlandı: ${f}`, {
            klasor: 'bot_genel',
            key:  'startup',
            dosya: f
          });
          continue;
        }

        targetMap.  set(cmd.data.name, cmd);

        await LogYonetim.info('komut_yuklendi', `✅ Komut yüklendi: ${cmd.data.name}`, {
          klasor: 'bot_genel',
          key: 'startup',
          komut: cmd.data.  name
        });
      } catch (e) {
        await LogYonetim.error('komut_yukleme_hata', `❌ Komut yükleme hatası: ${f}`, {
          klasor: 'bot_genel',
          key: 'startup',
          dosya:  f,
          hata: e && e.message
        });
      }
    }
  } catch (e) {
    await LogYonetim.error('komut_dizin_hata', '❌ Komut dizini okunamadı', {
      klasor: 'bot_genel',
      key: 'startup',
      dizin: folder,
      hata: e && e.message
    });
  }
}

async function registerAndLoadCommands() {
  await loadCommandsFrom(KOMUTLAR_DIR, client.commands);
  await loadCommandsFrom(OWNER_KOMUT_DIR, client.ownerCommands);

  // Owner commands priority
  for (const name of client.ownerCommands. keys()) {
    if (client.commands.has(name)) {
      client.commands.delete(name);
    }
  }

  try {
    // ✅ COMMAND SIGNATURE SYSTEM - PAYLOAD DIFF
    const payload = [];
    const currentSignatures = {};
    const previousSignatures = await loadCommandSignatures();
    let changedCount = 0;
    let addedCount = 0;
    let deletedCount = 0;

    // Normal komutlar
    for (const cmd of client.commands.values()) {
      if (cmd.data) {
        const cmdData = typeof cmd.data.  toJSON === 'function' ? cmd.data. toJSON() : cmd.data;
        const signature = getCommandSignature(cmdData);
        const cmdName = cmd.data.name;

        currentSignatures[cmdName] = signature;

        // Değişip değişmediğini kontrol et
        if (previousSignatures[cmdName] !== signature) {
          payload.push(cmdData);
          if (previousSignatures[cmdName]) {
            changedCount++;
          } else {
            addedCount++;
          }
        }
      }
    }

    // Owner komutlar
    for (const cmd of client.ownerCommands.  values()) {
      if (cmd.data) {
        const cmdData = typeof cmd.data. toJSON === 'function' ?  cmd.data.toJSON() : cmd.data;
        const signature = getCommandSignature(cmdData);
        const cmdName = cmd.  data.name;

        currentSignatures[cmdName] = signature;

        if (previousSignatures[cmdName] !== signature) {
          payload.  push(cmdData);
          if (previousSignatures[cmdName]) {
            changedCount++;
          } else {
            addedCount++;
          }
        }
      }
    }

    // Silinen komutları hesapla
    for (const prevCmd of Object.keys(previousSignatures)) {
      if (!  currentSignatures[prevCmd]) {
        deletedCount++;
      }
    }

    // Register et
    if (payload.length > 0 || deletedCount > 0) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: Object.keys(currentSignatures).length > 0 ? payload : [] });

      await LogYonetim.komutRegister(
        Object.keys(currentSignatures).length,
        changedCount,
        addedCount,
        deletedCount,
        null
      );

      // Signature'ları kaydet
      await saveCommandSignatures(currentSignatures);

      console.log(`📋 KOMUT REGISTER - Toplam: ${Object.keys(currentSignatures).length}, Değişen: ${changedCount}, Eklenen: ${addedCount}, Silinen: ${deletedCount}`);
    } else {
      console.log('✅ Tüm komutlar güncel - Register atlandı');
    }
  } catch (e) {
    await LogYonetim.error('komut_register_hata', '❌ Komut registeri başarısız', {
      klasor: 'bot_genel',
      key: 'startup',
      hata: e && e.message
    });
  }
}

registerAndLoadCommands().catch(e => {
  LogYonetim.sistemHatasi(`❌ Komut yükleme fatal: ${e && (e.stack || e.message)}`, 'CRITICAL').catch(() => {});
});

/* ==================== INTERACTION HANDLERS ====================*/

async function handleSlashCommand(interaction, traceId) {
  const commandName = interaction.commandName;
  const userId = interaction.user.id;

  try {
    await interaction.  deferReply({ ephemeral: true });

    // Owner komut kontrolü
    if (client.ownerCommands.has(commandName)) {
      const cmd = client.ownerCommands.  get(commandName);

      if (!  await checkPermission(interaction, 'owner')) {
        return;
      }

      try {
        await cmd. execute(interaction, {
          client,
          db:  dbManager,
          LogYonetim,
          traceId,
          PANEL_DEAKTIF_SANIYE,
          STATELER_DIR,
          SAYFALAR_DIR
        });

        await LogYonetim.  kullaniciKomut(userId, commandName, interaction.guildId, traceId);
      } catch (cmdErr) {
        await LogYonetim.error('komut_execute_hata', `❌ Komut hatası: ${commandName}`, {
          klasor: 'bot_genel',
          key: 'interaction',
          komut: commandName,
          kullaniciID: userId,
          hata: cmdErr && (cmdErr.stack || cmdErr.message),
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('❌ Komut Hatası')
          .setDescription('Komut çalıştırılırken hata oluştu.')
          .setTimestamp();

        try {
          await interaction. editReply({ embeds: [embed] });
        } catch (_) {}
      }
      return;
    }

    // Normal komut
    if (client.commands.has(commandName)) {
      const cmd = client.  commands.get(commandName);

      // Yetki kontrolü
      if (cmd.permission && !await checkPermission(interaction, cmd.permission)) {
        return;
      }

      try {
        await cmd.execute(interaction, {
          client,
          db: dbManager,
          LogYonetim,
          traceId,
          PANEL_DEAKTIF_SANIYE,
          STATELER_DIR,
          SAYFALAR_DIR
        });

        await LogYonetim. kullaniciKomut(userId, commandName, interaction.guildId, traceId);
      } catch (cmdErr) {
        await LogYonetim.error('komut_execute_hata', `❌ Komut hatası: ${commandName}`, {
          klasor: 'bot_genel',
          key: 'interaction',
          komut:  commandName,
          kullaniciID:   userId,
          hata: cmdErr && (cmdErr.stack || cmdErr.message),
          traceID: traceId
        });

        const embed = new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('❌ Komut Hatası')
          .setDescription('Komut çalıştırılırken hata oluştu.')
          .setTimestamp();

        try {
          await interaction.editReply({ embeds: [embed] });
        } catch (_) {}
      }
    } else {
      await LogYonetim.warn('komut_bulunamadi', `⚠️ Komut bulunamadı: ${commandName}`, {
        klasor: 'bot_genel',
        key: 'interaction',
        komut: commandName,
        kullaniciID: userId,
        traceID: traceId
      });
    }
  } catch (e) {
    await LogYonetim.  error('slash_handler_hata', '❌ Slash command handler hatası', {
      klasor:   'bot_genel',
      key: 'interaction',
      komut: commandName,
      kullaniciID: userId,
      hata: e && (e.stack || e.message),
      traceID: traceId
    });
  }
}

async function handleButton(interaction, traceId) {
  const buttonId = interaction.customId;
  const userId = interaction.user.  id;

  try {
    await interaction. deferReply({ ephemeral: true });

    if (buttonId && buttonId.startsWith('panel_')) {
      const sorgula = client.commands.get('sorgula');
      if (sorgula && typeof sorgula.handleButton === 'function') {
        try {
          await sorgula.  handleButton(interaction, buttonId, {
            client,
            db:   dbManager,
            LogYonetim,
            traceId,
            PANEL_DEAKTIF_SANIYE,
            STATELER_DIR,
            SAYFALAR_DIR
          });
        } catch (btnErr) {
          await LogYonetim.error('button_handler_hata', '❌ Button handler hatası', {
            klasor: 'panel',
            key: 'button',
            buttonId,
            kullaniciID: userId,
            hata: btnErr && (btnErr.stack || btnErr. message),
            traceID:  traceId
          });

          const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Hata')
            .setDescription('Buton işlenirken hata oluştu.')
            .setTimestamp();

          try {
            await interaction.  editReply({ embeds: [embed] });
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    await LogYonetim.error('button_handler_fatal', '❌ Button handler fatal hatası', {
      klasor:   'panel',
      key:   'button',
      buttonId,
      kullaniciID:   userId,
      hata:  e && (e.stack || e.  message),
      traceID: traceId
    });
  }
}

async function handleModal(interaction, traceId) {
  const modalId = interaction.  customId;
  const userId = interaction.user.id;

  try {
    await interaction.  deferReply({ ephemeral:   true });

    if (modalId && (modalId.startsWith('panel_') || modalId.includes('_modal'))) {
      const sorgula = client.commands.get('sorgula');
      if (sorgula && typeof sorgula.  handleModal === 'function') {
        try {
          await sorgula. handleModal(interaction, modalId, {
            client,
            db: dbManager,
            LogYonetim,
            traceId,
            PANEL_DEAKTIF_SANIYE,
            STATELER_DIR,
            SAYFALAR_DIR
          });
        } catch (mdlErr) {
          await LogYonetim.error('modal_handler_hata', '❌ Modal handler hatası', {
            klasor: 'panel',
            key: 'modal',
            modalId,
            kullaniciID: userId,
            hata: mdlErr && (mdlErr.stack || mdlErr.  message),
            traceID:   traceId
          });

          const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Hata')
            .setDescription('Modal işlenirken hata oluştu.')
            .setTimestamp();

          try {
            await interaction. editReply({ embeds: [embed] });
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    await LogYonetim.error('modal_handler_fatal', '❌ Modal handler fatal hatası', {
      klasor:  'panel',
      key:  'modal',
      modalId,
      kullaniciID:  userId,
      hata: e && (e.stack || e. message),
      traceID: traceId
    });
  }
}

async function handleSelectMenu(interaction, traceId) {
  const menuId = interaction.customId;
  const userId = interaction.user.id;

  try {
    await interaction.  deferReply({ ephemeral:  true });

    if (menuId && menuId.startsWith('panel_')) {
      const sorgula = client.commands.get('sorgula');
      if (sorgula && typeof sorgula.handleSelectMenu === 'function') {
        try {
          await sorgula.handleSelectMenu(interaction, menuId, {
            client,
            db: dbManager,
            LogYonetim,
            traceId,
            PANEL_DEAKTIF_SANIYE,
            STATELER_DIR,
            SAYFALAR_DIR
          });
        } catch (selErr) {
          await LogYonetim.error('selectmenu_handler_hata', '❌ SelectMenu handler hatası', {
            klasor: 'panel',
            key: 'selectmenu',
            menuId,
            kullaniciID: userId,
            hata: selErr && (selErr.stack || selErr.  message),
            traceID:   traceId
          });

          const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Hata')
            .setDescription('SelectMenu işlenirken hata oluştu.')
            .setTimestamp();

          try {
            await interaction.editReply({ embeds: [embed] });
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    await LogYonetim. error('selectmenu_handler_fatal', '❌ SelectMenu handler fatal hatası', {
      klasor:   'panel',
      key:   'selectmenu',
      menuId,
      kullaniciID: userId,
      hata: e && (e.stack || e. message),
      traceID: traceId
    });
  }
}

async function handleAutocomplete(interaction, traceId) {
  const commandName = interaction.commandName;
  const userId = interaction.user.id;

  try {
    let cmd = null;

    if (client.ownerCommands.has(commandName)) {
      cmd = client.  ownerCommands. get(commandName);
    } else if (client.commands.has(commandName)) {
      cmd = client.  commands.get(commandName);
    }

    if (cmd && typeof cmd.autocomplete === 'function') {
      try {
        const choices = await cmd.autocomplete(interaction, {
          client,
          db:  dbManager,
          LogYonetim,
          traceId,
          STATELER_DIR,
          SAYFALAR_DIR
        });

        if (Array.isArray(choices)) {
          await interaction.respond(choices).catch(() => {});
        }
      } catch (acErr) {
        await LogYonetim.warn('autocomplete_hata', `⚠️ Autocomplete hatası: ${commandName}`, {
          klasor: 'bot_genel',
          key:  'interaction',
          komut: commandName,
          hata: acErr && acErr.message,
          traceID: traceId
        });
      }
    }
  } catch (e) {
    await LogYonetim.  error('autocomplete_fatal', '❌ Autocomplete fatal hatası', {
      klasor: 'bot_genel',
      key: 'interaction',
      komut: commandName,
      kullaniciID: userId,
      hata: e && (e.  stack || e.message),
      traceID: traceId
    });
  }
}

/* ==================== MAIN INTERACTION HANDLER ====================*/

client.on('interactionCreate', (interaction) => {
  (async () => {
    const traceId = crypto.randomUUID ?   crypto.randomUUID() : crypto.randomBytes(12).toString('hex');

    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction, traceId);
      } else if (interaction.  isButton()) {
        await handleButton(interaction, traceId);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction, traceId);
      } else if (interaction.  isStringSelectMenu()) {
        await handleSelectMenu(interaction, traceId);
      } else if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, traceId);
      }
    } catch (e) {
      await LogYonetim.critical('interaction_fatal', '🔴 Fatal interaction hatası', {
        klasor: 'bot_genel',
        key: 'critical',
        hata: e && (e.stack || e.message),
        traceID: traceId,
        userId: interaction.user?.id
      });
    }
  })();
});

/* ==================== CLIENT EVENTS ====================*/

client.once('ready', () => {
  LogYonetim.sistemBasladi().catch(() => {});
  console.log(`✅ Bot hazır:  ${client.user.tag}`);
});

client.on('error', (error) => {
  LogYonetim.error('client_error', '❌ Discord client hatası', {
    klasor:   'bot_genel',
    key: 'client',
    hata: error && (error.stack || error.message)
  }).catch(() => {});
  console.error('❌ Client error:', error);
});

process.on('unhandledRejection', (reason) => {
  LogYonetim.warn('unhandled_rejection', '⚠️ Unhandled rejection', {
    klasor: 'bot_genel',
    key: 'process',
    reason:   String(reason)
  }).catch(() => {});
  console.error('❌ Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  LogYonetim.critical('uncaught_exception', '🔴 Uncaught exception', {
    klasor: 'bot_genel',
    key:  'process',
    hata: error && (error.stack || error.message)
  }).catch(() => {});
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

/* ==================== BOT BAŞLATMA ====================*/

client.login(TOKEN).catch(e => {
  console.error('❌ Login hatası:', e && (e.stack || e.message));
  LogYonetim.sistemHatasi(`❌ Login hatası: ${e && (e.stack || e.message)}`, 'CRITICAL').catch(() => {});
  process.exit(1);
});

/* ==================== GRACEFUL SHUTDOWN ====================*/

const gracefulShutdown = async () => {
  console.log('\n🛑 Bot kapatılıyor...');

  try {
    await LogYonetim.sistemKapandi();
  } catch (_) {}

  try {
    await dbManager.shutdown(5000);
  } catch (_) {}

  try {
    await client.destroy();
  } catch (_) {}

  console.log('✅ Bot kapatıldı');
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = { client, dbManager };