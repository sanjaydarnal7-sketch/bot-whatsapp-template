/**
 * Craftsmen & Co. - Final Production WhatsApp Engine
 */
const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

// 1. Express Port Binding for Render
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => res.send("Craftsmen & Co. Bot is Active & Running 24/7"));
app.listen(PORT, () => console.log(`[HTTP] Server bound successfully on port ${PORT}`));

// 2. Logger & Event Handlers Loader
const logger = pino({ level: "info" });

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

// Global reference to avoid duplicate socket loops
let sock = null;

async function startBot() {
  try {
    const authPath = path.join(__dirname, "auth_info");
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
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

    sock.ev.on("creds.update", saveCreds);

    // Dynamic Event Registration
    for (const { eventName, handler } of eventHandlers) {
      if (eventName === "connection.update") {
        sock.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect } = update;

          if (connection === "open") {
            console.log("\n==========================================");
            console.log("   SUCCESSFULLY CONNECTED TO WHATSAPP!");
            console.log("==========================================\n");
          }

          if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[Connection Closed] Status Code: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
              console.log("Session invalid or logged out. Resetting auth directory...");
              if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
              }
            }
            // Re-initialize cleanly after delay
            setTimeout(startBot, 5000);
          }

          // Pass to original handler
          handler(sock, logger, saveCreds, startBot)(update);
        });
      } else if (eventName === "messages.upsert") {
        sock.ev.on(eventName, handler(sock, logger, commands));
      } else {
        sock.ev.on(eventName, handler(sock, logger));
      }
    }

    // Pairing Code Generator
    if (!sock.authState.creds.registered) {
      const targetNumber = process.env.BOT_PHONE_NUMBER || "918766540537";
      const cleanNumber = targetNumber.replace(/[^0-9]/g, "");

      setTimeout(async () => {
        try {
          if (!sock.authState.creds.registered) {
            let pairingCode = await sock.requestPairingCode(cleanNumber);
            pairingCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
            console.log("\n==================================================");
            console.log(`  YOUR PAIRING CODE FOR WHATSAPP: ${pairingCode}`);
            console.log("==================================================\n");
          }
        } catch (err) {
          logger.error("Pairing code error", { error: err.message });
        }
      }, 7000);
    }
  } catch (error) {
    logger.error("Failed to start bot engine", { error: error.message });
    setTimeout(startBot, 5000);
  }
}

startBot();
