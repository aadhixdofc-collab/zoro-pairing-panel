const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ============================================
// CRASH PREVENTION (OOM & UNCAUGHT EXCEPTIONS)
// ============================================
process.on('uncaughtException', (err) => {
    console.error('⚠️ Caught Uncaught Exception: ', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ============================================
// DUAL TEMP STORAGE CLEANUP SYSTEM (SAFE MODE)
// ============================================

// 1. General Temp Cleaner (Every 2 Minutes - Safe 3 minutes gap for active files)
function clearGeneralTempStorage() {
    const tempDirs = [
        path.join(__dirname, 'temp'),
        path.join(__dirname, 'tmp'),
        path.join(__dirname, 'temp_update'),
        path.join(__dirname, 'ffmpeg_extract')
    ];

    for (const dir of tempDirs) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {}
            continue;
        }

        try {
            const files = fs.readdirSync(dir);
            const now = Date.now();
            for (const file of files) {
                if (file === 'songs') continue; // songs ഫോൾഡർ ഇവിടെ സ്കിപ്പ് ചെയ്യും

                const filePath = path.join(dir, file);
                try {
                    const stats = fs.statSync(filePath);
                    // പ്രൊസസ്സിംഗിൽ ഇരിക്കുന്ന ഫയലുകൾ തടസ്സപ്പെടാതിരിക്കാൻ 3 മിനിറ്റിൽ കൂടുതൽ പഴക്കമുള്ളവ മാത്രം ഡിലീറ്റ് ചെയ്യുക
                    if (now - stats.mtimeMs > 180000) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    }
                } catch (err) {}
            }
        } catch (e) {}
    }
}

// 2. Dedicated Song Folder Cleaner (Only clears song files after 5 minutes of safety gap)[span_1](start_span)[span_1](end_span)
function clearSongTempStorage() {
    const songDirs = [
        path.join(__dirname, 'temp', 'songs'),
        path.join(__dirname, 'tmp', 'songs')
    ];

    for (const dir of songDirs) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {}
            continue;
        }

        try {
            const files = fs.readdirSync(dir);
            const now = Date.now();
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stats = fs.statSync(filePath);
                    // സോംഗ് ഡൗൺലോഡിംഗിനും സെൻഡിംഗിനും പക്കാ ടൈം കിട്ടാൻ കൃത്യം 5 മിനിറ്റ് കഴിഞ്ഞു മാത്രം ഡിലീറ്റ് ചെയ്യും[span_2](start_span)[span_2](end_span)
                    if (now - stats.mtimeMs > 300000) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                        console.log(`🎵 Cleared old song temp file: ${file}`);
                    }
                } catch (err) {}
            }
        } catch (e) {}
    }
}

// Run Cleaners on Startup & Intervals
clearGeneralTempStorage();
clearSongTempStorage();

setInterval(() => {
    clearGeneralTempStorage();
}, 120000); // Every 2 Minutes for General Temp

setInterval(() => {
    clearSongTempStorage();
}, 300000); // Every 5 Minutes for Songs Temp[span_3](start_span)[span_3](end_span)

// ============================================
// INDIAN TIME HELPER (Asia/Kolkata)
// ============================================
function getIndianDateTime() {
    const now = new Date();
    const dateOptions = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' };
    const currentDate = new Intl.DateTimeFormat('en-GB', dateOptions).format(now);
    const timeOptions = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true };
    const currentTime = new Intl.DateTimeFormat('en-GB', timeOptions).format(now);
    const dayOptions = { timeZone: 'Asia/Kolkata', weekday: 'long' };
    const currentDay = new Intl.DateTimeFormat('en-GB', dayOptions).format(now).toLowerCase();
    return { currentDate, currentTime, currentDay };
}

// ============================================
// MODULE UPDATER
// ============================================
async function downloadAndExtractModules() {
    const settingsPath = path.join(__dirname, 'settings.js');
    const modulesInstalledFlag = path.join(__dirname, '.modules_installed');
    
    if (fs.existsSync(modulesInstalledFlag)) {
        console.log('✅ Modules already installed, skipping download');
        return true;
    }
    
    if (!fs.existsSync(settingsPath)) {
        console.log('⚠️ settings.js not found, skipping module update');
        return false;
    }
    
    const settings = require('./settings');
    const zipUrl = settings.updateZipUrl;
    
    if (!zipUrl) {
        console.log('⚠️ No updateZipUrl configured in settings.js');
        return false;
    }

    const TEMP_DIR = path.join(__dirname, 'temp_update');
    const ZIP_FILE = path.join(TEMP_DIR, 'modules.zip');
    const EXTRACT_DIR = path.join(TEMP_DIR, 'extracted');

    console.log('📥 DOWNLOADING MODULES FROM REPOSITORY...');
    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        const response = await axios({
            method: 'get',
            url: zipUrl,
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        fs.writeFileSync(ZIP_FILE, response.data);
        if (fs.existsSync(EXTRACT_DIR)) {
            fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(EXTRACT_DIR, { recursive: true });

        console.log('📦 EXTRACTING FILES...');
        execSync(`unzip -o "${ZIP_FILE}" -d "${EXTRACT_DIR}"`, { stdio: 'pipe' });

        const extractedFolders = fs.readdirSync(EXTRACT_DIR);
        const moduleFolder = extractedFolders.find(f => f.includes('ZORO-MD-MODULES') || f.includes('MODULES'));
        
        if (!moduleFolder) {
            console.log('❌ Could not find modules folder in extracted files');
            return false;
        }

        const sourcePath = path.join(EXTRACT_DIR, moduleFolder);
        const basePath = __dirname;
        const foldersToSync = ['lib', 'plugins', 'data', 'media'];
        const filesToSync = ['main.js', 'config.js'];

        for (const folder of foldersToSync) {
            const sourceFolder = path.join(sourcePath, folder);
            const destFolder = path.join(basePath, folder);
            if (fs.existsSync(sourceFolder)) {
                if (!fs.existsSync(destFolder)) {
                    fs.mkdirSync(destFolder, { recursive: true });
                }
                fs.cpSync(sourceFolder, destFolder, { recursive: true, force: true });
                console.log(`✅ SYNCED FOLDER: ${folder}`);
            }
        }

        for (const file of filesToSync) {
            const sourceFile = path.join(sourcePath, file);
            const destFile = path.join(basePath, file);
            if (fs.existsSync(sourceFile)) {
                fs.copyFileSync(sourceFile, destFile);
                console.log(`✅ SYNCED FILE: ${file}`);
            }
        }

        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        fs.writeFileSync(modulesInstalledFlag, new Date().toISOString());
        console.log('🎉 MODULES UPDATED SUCCESSFULLY!');
        return true;
    } catch (error) {
        console.error('❌ Error updating modules:', error.message);
        if (fs.existsSync(TEMP_DIR)) {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        }
        return false;
    }
}

// ============================================
// FFMPEG CHECK AND AUTO-INSTALL
// ============================================
async function checkAndInstallFFmpeg() {
    console.log('🎬 CHECKING FFMPEG INSTALLATION...');
    const ffmpegDir = path.join(__dirname, 'ffmpeg_bin');
    const ffmpegPath = path.join(ffmpegDir, 'ffmpeg');
    const ffprobePath = path.join(ffmpegDir, 'ffprobe');
    
    try {
        execSync('ffmpeg -version', { stdio: 'pipe', encoding: 'utf8' });
        console.log('✅ FFMPEG FOUND IN SYSTEM');
        return true;
    } catch (error) {
        console.log('⚠️ FFmpeg not found in system PATH, checking locally...');
    }
    
    if (fs.existsSync(ffmpegPath)) {
        process.env.PATH = `${ffmpegDir}:${process.env.PATH}`;
        console.log('✅ LOCAL FFMPEG ADDED TO PATH');
        return true;
    }
    
    console.log('📥 DOWNLOADING FFMPEG AUTOMATICALLY...');
    try {
        if (!fs.existsSync(ffmpegDir)) {
            fs.mkdirSync(ffmpegDir, { recursive: true });
        }
        const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
        const tempFile = path.join(__dirname, 'ffmpeg_temp.tar.xz');
        const extractDir = path.join(__dirname, 'ffmpeg_extract');
        
        const response = await axios({ method: 'get', url: FFMPEG_URL, responseType: 'arraybuffer', timeout: 300000 });
        fs.writeFileSync(tempFile, response.data);
        
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`tar -xf "${tempFile}" -C "${extractDir}"`, { stdio: 'pipe' });
        
        const extractedFolders = fs.readdirSync(extractDir);
        const ffmpegFolder = extractedFolders.find(f => f.includes('ffmpeg'));
        if (ffmpegFolder) {
            const srcFFmpeg = path.join(extractDir, ffmpegFolder, 'ffmpeg');
            const srcFFprobe = path.join(extractDir, ffmpegFolder, 'ffprobe');
            if (fs.existsSync(srcFFmpeg)) {
                fs.copyFileSync(srcFFmpeg, ffmpegPath);
                fs.chmodSync(ffmpegPath, '755');
            }
            if (fs.existsSync(srcFFprobe)) {
                fs.copyFileSync(srcFFprobe, ffprobePath);
                fs.chmodSync(ffprobePath, '755');
            }
        }
        fs.unlinkSync(tempFile);
        fs.rmSync(extractDir, { recursive: true, force: true });
        process.env.PATH = `${ffmpegDir}:${process.env.PATH}`;
        console.log('✅ FFMPEG INSTALLED SUCCESSFULLY');
        return true;
    } catch (error) {
        console.error('❌ Failed to download FFmpeg:', error.message);
        return false;
    }
}

// ============================================
// STRICLY ORDERED QUEUE FOR HEAVY COMMANDS (8 SECONDS GAP)
// ============================================
const activeSessions = {};
const sessionQueues = {};

async function processQueue(phone, sock) {
    if (!sessionQueues[phone]) return;
    if (sessionQueues[phone].isProcessing) return;
    sessionQueues[phone].isProcessing = true;

    while (sessionQueues[phone].queue.length > 0) {
        const { currentSock, currentUpdate } = sessionQueues[phone].queue.shift();
        try {
            const mek = currentUpdate.messages[0];
            if (!mek.message) continue;
            
            const { handleMessages, handleStatus } = require('./main');
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                if (typeof handleStatus === 'function') await handleStatus(currentSock, currentUpdate);
                continue;
            }
            if (typeof handleMessages === 'function') {
                await handleMessages(currentSock, currentUpdate, true);
            }
        } catch (err) {
            console.error("Queue Processing Error:", err.message);
        }

        if (global.gc) {
            try { global.gc(); } catch (e) {}
        }

        // കൃത്യം 8 സെക്കൻഡ് വെയിറ്റ് ചെയ്ത ശേഷമേ അടുത്ത ആളിന്റെ റിപ്ലൈ പോകൂ
        await new Promise(resolve => setTimeout(resolve, 8000));
    }
    sessionQueues[phone].isProcessing = false;
}

// ============================================
// UNIFIED ROBUST MULTI-SESSION RUNNER & PAIRING
// ============================================
async function startZoroSession(phone, res = null) {
    const sessionName = `session_${phone}`;
    const sessionPath = path.join(SESSIONS_DIR, sessionName);

    if (activeSessions[phone]) {
        try {
            await activeSessions[phone].end(undefined);
        } catch (e) {}
        delete activeSessions[phone];
    }

    if (!sessionQueues[phone]) {
        sessionQueues[phone] = { queue: [], isProcessing: false };
    }

    try {
        const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = require('@aadhixd777/baileys');
        const pino = require("pino");
        const NodeCache = require("node-cache");
        const store = require('./lib/lightweight_store');
        const { handleGroupParticipantUpdate } = require('./main');

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        const msgRetryCounterCache = new NodeCache();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            msgRetryCounterCache,
        });

        activeSessions[phone] = sock;

        if (store && store.bind) {
            store.bind(sock.ev);
        }

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered && res) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phone);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) {
                        res.json({ code });
                    }
                } catch (err) {
                    console.error("Pairing code error for:", phone, err);
                    if (!res.headersSent) {
                        res.json({ error: 'Failed to request pairing code. Try again.' });
                    }
                }
            }, 6000);
        }

        let hasSentConnectMsg = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "open") {
                delete activeSessions[phone];
                const { currentDate, currentTime, currentDay } = getIndianDateTime();

                console.log('\n╔════════════════════════════════════╗');
                console.log(`║  ✅ ZORO MD CONNECTED SUCCESSFUL!  ║`);
                console.log('╠════════════════════════════════════╣');
                console.log(`║ 📱 Phone: ${phone}                 ║`);
                console.log(`║ ⏰ Time: ${currentTime}, ${currentDate} ║`);
                console.log('╚════════════════════════════════════╝\n');

                if (!hasSentConnectMsg) {
                    hasSentConnectMsg = true;
                    try {
                        const mode = process.env.MODE || "private";
                        const headerText = `*ʜᴇʏ ᴢᴏʀᴏ <3*`;
                        const connectMessage = `
\`ᴢᴏʀᴏxᴍᴅ -ᴍɪɴɪ sᴛᴀʀᴛᴇᴅ\`
╭═══════════════⟥⟢
➦ ᴠᴇʀsᴏɴ : 0.0.1
➦ ᴘʀᴇᴍɪx : [.]
➦ ᴍᴏᴅᴇ : ${mode}
➦ ᴏᴡɴᴇʀ : 918136880986
╰═══════════════⟥⟢
\`ʙᴀsɪᴄ - ᴄᴏᴍᴍᴀɴᴅs\`
╭═══════════════⟥⟢
➦ .ᴘɪɴɢ - sᴇᴇ ᱨᱮsᴘᴏɴᴄᴇ sᴘᴇᴇᴅ
➦ .ᴍᴇɴᴜ - ᴛഒ sᱟᱣ ᱟʟʟ ᴄᴍᴅs
➦ .ᴀʟɪᴠᴇ - sᴇᴇ ʙᴎᴛ ᱨᴜɴᴛɪᴍᴇ
➦ .ᴏᴡɴᴇʀ - ᴅᴇᴠᴇʟᴏＰＥʀ ᴏғ ʙᴏᴛ
➦ .ᴘᴀɪʀ - ᴄᴏɴɴᴇᴄᴛ ᴛʜᴇ ʙᴏᴛ
╰═══════════════⟥⟢
\`ᴀʙᴏᴜᴛ ᴛʜɪs xᴍᴅ ʙᴏᴛ\`
╭═══════════════⟥⟢
➦ ᴅᴀᴛᴇ : ${currentDate}
➦ ᴛɪᴍᴇ : ${currentTime}
➦ ᴅᴀʏ : ${currentDay}
╰═══════════════⟥⟢
                        `.trim();

                        const targetJid = phone + '@s.whatsapp.net';

                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(targetJid, { text: headerText });
                                setTimeout(async () => {
                                    await sock.sendMessage(targetJid, { 
                                        image: { url: "https://files.catbox.moe/39mfsh.png" }, 
                                        caption: connectMessage 
                                    });
                                }, 1000);
                            } catch (sendErr) {}
                        }, 4000);

                    } catch (err) {}
                }

            } else if (connection === 'close') {
                delete activeSessions[phone];
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`⚠️ Connection closed for ${phone}, status: ${statusCode}`);
                
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
                    try {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                        console.log(`🗑️ Logged out session cleaned up for: ${phone}`);
                    } catch (e) {}
                } else {
                    setTimeout(() => startZoroSession(phone), 5000);
                }
            }
        });

        // ============================================
        // SELECTIVE MESSAGE UPSERT HANDLER (.menu, .alive, .song)
        // ============================================
        sock.ev.on('messages.upsert', async chatUpdate => {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            
            const text = (
                mek.message?.conversation || 
                mek.message?.extendedTextMessage?.text || 
                mek.message?.imageMessage?.caption || 
                mek.message?.videoMessage?.caption || 
                ''
            ).toLowerCase().trim();

            // .menu, .alive, .song തുടങ്ങിയ ഹെവി കമാൻഡുകൾക്ക് മാത്രം ക്യൂ കൊടുക്കുക
            if (
                text.startsWith('.menu') || 
                text.startsWith('.alive') || 
                text.startsWith('.help') || 
                text.startsWith('.song') || 
                text.startsWith('.play') ||
                text.startsWith('.mp3') ||
                text.startsWith('.ytmp3')
            ) {
                if (!sessionQueues[phone]) {
                    sessionQueues[phone] = { queue: [], isProcessing: false };
                }
                sessionQueues[phone].queue.push({ currentSock: sock, currentUpdate: chatUpdate });
                processQueue(phone, sock);
            } else {
                // ബാക്കി എല്ലാ കമാൻഡുകളും (ഉദാഹരണത്തിന് .ping) ഇൻസ്റ്റന്റ് ആയി സ്മൂത്തായി വർക്ക് ചെയ്യും
                const { handleMessages } = require('./main');
                await handleMessages(sock, chatUpdate, true);
            }
        });

        sock.ev.on('group-participants.update', async (update) => {
            try {
                if (typeof handleGroupParticipantUpdate === 'function') await handleGroupParticipantUpdate(sock, update);
            } catch (err) {}
        });

        return sock;
    } catch (e) {
        console.error(`❌ Error in session for ${phone}:`, e);
    }
}

// ============================================
// RESTORE EXISTING SESSIONS ON STARTUP
// ============================================
async function restoreExistingSessions() {
    if (fs.existsSync(SESSIONS_DIR)) {
        const sessionFolders = fs.readdirSync(SESSIONS_DIR);
        for (const folder of sessionFolders) {
            if (folder.startsWith('session_')) {
                const phone = folder.replace('session_', '');
                console.log(`🔄 Restoring active session on restart for: ${phone}`);
                startZoroSession(phone);
            }
        }
    }
}

// ============================================
// DASHBOARD UI & KEEP-ALIVE PING ROUTE
// ============================================
app.get('/ping', (req, res) => {
    res.send('Zoro MD is active!');
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Zoro MD Multi-User Pairing Panel</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 400px; text-align: center; }
                h2 { color: #38bdf8; margin-bottom: 20px; }
                input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #fff; box-sizing: border-box; }
                button { background: #0284c7; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; cursor: pointer; font-weight: bold; }
                button:hover { background: #0ea5e9; }
                #result { margin-top: 15px; font-size: 16px; word-break: break-all; color: #4ade80; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Zoro MD Pairing</h2>
                <form id="pairForm">
                    <input type="text" id="phone" placeholder="Enter phone with country code (e.g., 919876543210)" required>
                    <button type="submit">Get Pairing Code</button>
                </form>
                <div id="result"></div>
            </div>
            <script>
                document.getElementById('pairForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const phone = document.getElementById('phone').value.trim();
                    const resultDiv = document.getElementById('result');
                    resultDiv.innerText = "Generating code...";
                    try {
                        const res = await fetch('/pair?phone=' + phone);
                        const data = await res.json();
                        if(data.code) {
                            resultDiv.innerHTML = "Your Pairing Code: <br><h1 style='color:#f43f5e;'>" + data.code + "</h1>";
                        } else {
                            resultDiv.innerText = "Error: " + (data.error || "Failed to generate code");
                        }
                    } catch(err) {
                        resultDiv.innerText = "Server error occurred!";
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// ============================================
// PAIRING ENDPOINT
// ============================================
app.get('/pair', async (req, res) => {
    let phone = req.query.phone;
    if (!phone) {
        return res.json({ error: 'Phone number is required' });
    }
    phone = phone.replace(/[^0-9]/g, '');

    const sessionPath = path.join(SESSIONS_DIR, `session_${phone}`);

    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        await startZoroSession(phone, res);

    } catch (e) {
        console.error("Pairing Endpoint Error:", e);
        if (!res.headersSent) {
            res.json({ error: 'Internal server error during pairing' });
        }
    }
});

// ============================================
// SERVER STARTUP
// ============================================
async function startBot() {
    app.listen(PORT, () => {
        console.log(`🚀 Zoro MD Pairing Server running on port ${PORT}`);
    });

    console.log('\n╔════════════════════════════════════╗');
    console.log('║  🚀 ZORO MD BOT STARTING...        ║');
    console.log('╚════════════════════════════════════╝\n');
    
    await downloadAndExtractModules();
    await checkAndInstallFFmpeg();
    await restoreExistingSessions();
    
    try {
        require('./settings');
    } catch (e) {
        console.log('settings.js not loaded yet.');
    }
    
    console.log('\n\n╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮');
    console.log(`│     🔥 ZORO MD PAIRING PANEL 🔥    │`);
    console.log('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n');
}

startBot().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
