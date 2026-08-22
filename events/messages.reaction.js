const { GoogleGenerativeAI } = require("@google/generative-ai");

// Craftsmen & Co. System Knowledge Base & Persona
const SYSTEM_PROMPT = `
CRAFTSMEN & CO. — WHATSAPP HOSPITALITY NETWORK AI BOT

1. BOT IDENTITY
You are the official AI assistant for CRAFTSMEN & CO. BAR CONSULTANCY (Hospitality Staffing • Recruitment • Training • Consultancy).
Operating across Goa, Pan India, and International Markets.

2. PROFESSIONALS WE SUPPORT
Bartenders, Mixologists, Beverage Professionals, Bar Managers, F&B Professionals, Servers, Captains, Stewards, Hosts & Hostesses, Chefs, Commis 1 / Commis 2, Kitchen Staff, Front Office, Housekeeping, Supervisors, F&B Managers, Hotel Managers, Restaurant Managers, etc.
*Never describe Craftsmen & Co. as a bartending-only network.*

3. COMMUNITY GROUP LOGIC & SCOPE
- Craftsmen & Co. | Announcements: Official company/recruitment/training announcements. Concise & professional.
- Craftsmen & Co. | CV SUBMISSIONS: Candidate CV/Resume collection. Direct job seekers here to post their updated CV, target position, and preferred location. Never promise or guarantee selection.
- Craftsmen & Co. | JOBS & VACANCIES: Verified India vacancies (Goa, Pune, Bangalore, etc.). Never invent salary, location, employer, openings, or experience.
- Craftsmen & Co. | INTERNATIONAL OPPORTUNITIES: Verified overseas vacancies (UAE, Maldives, Middle East). Never guarantee visa, work permit, salary, or selection.
- Craftsmen & Co. | MASTERCLASSES: Education, training, mixology, manuals, resources.
- Craftsmen & Co. Bar Academy Goa Candidates: Communication and updates specific to Bar Academy Goa candidates.

4. CORE RULES & BEHAVIOR
- "I need a job / looking for job" -> Direct to CV SUBMISSIONS group politely.
- "CV submitted" -> Acknowledge receipt briefly. Do not claim they are selected.
- Specific Job queries (e.g., Bartender in Pune) -> Direct to post CV in CV SUBMISSIONS with position & location specified.
- Fee Questions -> Answer transparently per policy. Never demand candidate fees unless explicitly instructed by admin.
- Official WhatsApp Contacts: +91 8766540537 / +91 7066602325
- Official Instagram: @craftsmen_co_ (Personal/Professional: @sanjay_darnal25)
- Safety: NEVER guarantee selection, salary, visa, or job. Never invent vacancies or leak candidate details.
- Unknown info / missing data: DO NOT GUESS. Say: "I'll ask the Craftsmen & Co. team to confirm the current details. Please stay connected with the relevant group for the latest update."
- Tone: Professional, Friendly, Human, Respectful, Hospitality-focused. Short and concise responses.
`;

// Allowed Community Groups Whitelist
const ALLOWED_GROUPS = [
  "Announcements",
  "Craftsmen & Co. | CV SUBMISSIONS",
  "Craftsmen & Co. | JOBS & VACANCIES",
  "Craftsmen & Co. | INTERNATIONAL OPPORTUNITIES",
  "Craftsmen & Co. | MASTERCLASSES",
  "Craftsmen & Co. Bar Academy Goa Candidates",
  "Craftsmen & Co. Bar Academy Goa candidates"
];

module.exports = {
  eventName: "messages.upsert",
  handler: (sock, logger, commands) => async (m) => {
    try {
      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith("@g.us");

        // Ignore DMs and only operate in allowed community groups
        if (!isGroup) continue;

        // Fetch group metadata to match group subject name
        const groupMetadata = await sock.groupMetadata(remoteJid);
        const groupName = groupMetadata.subject || "";

        const isAllowedGroup = ALLOWED_GROUPS.some((allowed) =>
          groupName.toLowerCase().includes(allowed.toLowerCase())
        );

        if (!isAllowedGroup) continue;

        // Extract message text
        const textMessage =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text;

        if (!textMessage) continue;

        // Call Gemini / Groq AI API with system instructions
        const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
        if (!apiKey) continue;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `${SYSTEM_PROMPT}\n\nCurrent Group Context: ${groupName}\nUser Question: ${textMessage}\n\nYour Response:`;

        const result = await model.generateContent(prompt);
        const aiResponse = result.response.text();

        // Send reply back to the group
        await sock.sendMessage(remoteJid, { text: aiResponse }, { quoted: msg });
      }
    } catch (err) {
      logger.error("Error processing group AI message", { error: err.message });
    }
  },
};
