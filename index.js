/**
 * WhatsApp Bot Entry Point
 * Craftsmen & Co. - Auto-Clean Session & Pairing Code Support
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
  res.send("Craftsmen & Co. WhatsApp Bot Active");
});

app.listen(PORT, () => {
  console.log(`Port bound successfully to ${PORT}`);
});

// Logging
const baseLogger = pino({ level: "info" });
const logger = createLogger(baseLogger);

const commands = new Map();
if (fs.existsSync("./commands")) {
  fs.readdirSync("./commands").forEach((file) => {
    const cmd = require(`./commands/${file}`);
    commands.set(cmd.name, cmd);
  });
}

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

async function startBot() {
  try {
    const authPath = path.join(__dirname, "auth_info");

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,
    });

    // Handle logout error code 401 automatically by clearing folder
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === 401) {
          console.log("Logged out by WhatsApp! Auto-clearing session...");
          if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
          }
          startBot();
          return;
        }
      }
    });

    if (!sock.authState.creds.registered) {
      const targetNumber = process.env.BOT_PHONE_NUMBER || "918766540537";
      const cleanNumber = targetNumber.replace(/[^0-9]/g, "");

      setTimeout(async () => {
        try {
          let pairingCode = await sock.requestPairingCode(cleanNumber);
          pairingCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
          console.log("\n==================================================");
          console.log(`  YOUR FRESH PAIRING CODE: ${pairingCode}`);
          console.log("==================================================\n");
        } catch (err) {
          logger.error("Error generating pairing code", { error: err.message });
        }
      }, 5000);
    }

    sock.ev.on("creds.update", saveCreds);

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
    logger.error("Failed to start bot", { error: error.message });
    setTimeout(startBot, 5000);
  }
}

startBot();
