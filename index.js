/**
 * WhatsApp Bot Entry Point
 * Craftsmen & Co. - Baileys Bot with Express Web Server & Pairing Code Support
 */
const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const { createLogger, withRetry, ...config } = require("./utils");

// Web Server for Render Port Binding
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Craftsmen & Co. WhatsApp Bot is Active 24/7!");
});

app.listen(PORT, () => {
  console.log(`Web server listening and bound to port ${PORT}`);
});

// Logging via pino
const baseLogger = pino({
  level: config.logging?.level || "info",
  transport: config.logging?.logToFile ? { target: "pino-pretty" } : undefined,
});
const logger = createLogger(baseLogger);

/**
 * Loads all command modules from the commands directory.
 */
const commands = new Map();
if (fs.existsSync("./commands")) {
  fs.readdirSync("./commands").forEach((file) => {
    const cmd = require(`./commands/${file}`);
    commands.set(cmd.name, cmd);
  });
}

/**
 * Loads all event handler modules from the events directory.
 */
const eventFiles = fs.existsSync("./events")
  ? fs.readdirSync("./events").filter((f) => f.endsWith(".js"))
  : [];
const eventHandlers = [];
for (const file of eventFiles) {
  const eventModule = require(`./events/${file}`);
  if (eventModule.eventName && typeof eventModule.handler === "function") {
    eventHandlers.push(eventModule);
  }
}

/**
 * Starts the WhatsApp bot and registers event handlers.
 */
async function startBot() {
  try {
    const { state, saveCreds } = await withRetry(
      () => useMultiFileAuthState("auth_info"),
      { retries: 3, delayMs: 1000 }
    );
    const { version, isLatest } = await withRetry(
      () => fetchLatestBaileysVersion(),
      { retries: 3, delayMs: 1000 }
    );
    logger.info("Starting WhatsApp bot", { version: version.join("."), isLatest });

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: config.bot?.online ?? true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,
    });

    // Request Pairing Code if device is not registered yet
    if (!sock.authState.creds.registered) {
      const targetNumber = process.env.BOT_PHONE_NUMBER || "918766540537"; 
      const cleanNumber = targetNumber.replace(/[^0-9]/g, "");

      setTimeout(async () => {
        try {
          let pairingCode = await sock.requestPairingCode(cleanNumber);
          pairingCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
          console.log("\n==================================================");
          console.log(`  YOUR PAIRING CODE FOR WHATSAPP: ${pairingCode}`);
          console.log("==================================================\n");
        } catch (err) {
          logger.error("Failed to generate pairing code", { error: err.message });
        }
      }, 5000);
    }

    // Save login credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Register all event handlers
    for (const { eventName, handler } of eventHandlers) {
      if (eventName === "connection.update") {
        sock.ev.on(eventName, handler(sock, logger, saveCreds, startBot));
      } else if (eventName === "messages.upsert") {
        sock.ev.on(eventName, handler(sock, logger, commands));
      } else {
        sock.ev.on(eventName, handler(sock, logger));
      }
    }
  } catch (error) {
    logger.error("Failed to start bot", { error: error.message, stack: error.stack });
    setTimeout(startBot, 5000);
  }
}

startBot();
