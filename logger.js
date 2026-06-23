// ============================================================
// HeroDev VSDesktop - logger persistente SEM dependencias.
// Escreve em app.getPath('logs')/herodev.log (sempre gravavel em
// Windows/macOS/Linux, fora do asar). Rotaciona ao passar de ~5 MB.
// Projetado para NUNCA lancar excecao (log nunca derruba o app).
// ============================================================

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let logDir = null;
let logFile = null;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function ensure() {
    if (logFile) return;
    try {
        logDir = app.getPath('logs');
    } catch {
        try { logDir = path.join(app.getPath('userData'), 'logs'); }
        catch { logDir = path.join(__dirname, 'logs'); }
    }
    try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
    logFile = path.join(logDir, 'herodev.log');
}

function rotateIfNeeded() {
    try {
        const st = fs.statSync(logFile);
        if (st.size > MAX_SIZE) {
            const old = path.join(logDir, 'herodev.1.log');
            try { fs.rmSync(old, { force: true }); } catch { /* ignore */ }
            fs.renameSync(logFile, old);
        }
    } catch { /* arquivo ainda nao existe */ }
}

function safeStr(a) {
    if (a && a.stack) return a.stack;
    if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
}

function write(level, args) {
    try {
        ensure();
        rotateIfNeeded();
        const msg = args.map(safeStr).join(' ');
        const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
        fs.appendFile(logFile, line, () => {}); // assincrono; ignora erro de I/O
        const c = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);
        c(line.trimEnd());
    } catch { /* nunca derrubar o app por causa de log */ }
}

function getLogPath() {
    ensure();
    return logFile;
}

module.exports = {
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
    getLogPath
};
