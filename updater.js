// ============================================================
// HeroDev Desktop - atualizacao do proprio app.
//
// Dois sinais de "tem versao nova", mostrados na mesma barra:
//   (1) o codigo em volumes/workspace/herodev-desk esta mais novo que o bundle
//       compilado em out/ (voce editou o app e nao recompilou);
//   (2) o origin/master tem commits que este checkout nao tem.
//
// Tudo aqui aponta pro container LOCAL (podman exec herodev, sem --connection)
// e pro checkout local, independente do no ativo: o app que vai ser substituido
// e o desta maquina, nao o do Raspberry. Sem container local, cai pro npm do
// host; sem os dois, erro claro.
//
// A compilacao NAO escreve em out/ direto: o forge apaga e recria a pasta de
// saida, e no macOS ela contem o .app que esta rodando. Vai pra out-build/
// (HERODEV_OUT_DIR, ver forge.config.js) e a troca acontece depois que o app
// sai, feita por um script solto que sobrevive ao encerramento.
// ============================================================
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./logger');

const CONTAINER = 'herodev';
const SRC_IN_CONTAINER = '/workspace/herodev-desk';
const STAGE_DIR = 'out-build';
const PROBE_TIMEOUT = 8 * 1000;
const GIT_TIMEOUT = 45 * 1000;          // fetch passa pela rede
const BUILD_TIMEOUT = 30 * 60 * 1000;   // npm install + package numa maquina lenta

// O main injeta o que so ele sabe achar (mesma ideia do createTray).
let deps = { findRepoRoot: () => null };
function configure(next) { deps = { ...deps, ...next }; }

// ============================================================
// Execucao de comandos
// ============================================================
// spawn com lista de argumentos de proposito: sem shell no meio, nao ha
// diferenca de aspas entre sh e cmd.exe (o resto do app comenta esse mesmo
// perigo em services.js).
function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        let proc;
        try {
            proc = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
        } catch (error) {
            resolve({ code: 1, stdout: '', stderr: error.message });
            return;
        }

        let stdout = '';
        let stderr = '';
        let estourou = false;
        const timer = opts.timeout ? setTimeout(() => {
            estourou = true;
            try { proc.kill(); } catch { /* ignore */ }
        }, opts.timeout) : null;

        const acumular = (buf, destino) => {
            const texto = buf.toString();
            if (destino === 'out') stdout += texto; else stderr += texto;
            if (!opts.onLine) return;
            texto.split('\n').map(l => l.trim()).filter(Boolean).forEach(opts.onLine);
        };

        proc.stdout.on('data', b => acumular(b, 'out'));
        proc.stderr.on('data', b => acumular(b, 'err'));
        proc.on('error', (error) => {
            if (timer) clearTimeout(timer);
            resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
        });
        proc.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (estourou) resolve({ code: 1, stdout, stderr: `${stderr}\n[tempo esgotado]` });
            else resolve({ code: code === null ? 1 : code, stdout, stderr });
        });
    });
}

async function containerDisponivel() {
    const r = await run('podman', ['exec', CONTAINER, 'true'], { timeout: PROBE_TIMEOUT });
    return r.code === 0;
}

// Variaveis de ambiente compostas na sintaxe de cada shell.
function comEnv(shellCmd, env, windows) {
    const pares = Object.entries(env || {});
    if (!pares.length) return shellCmd;
    if (windows) return pares.map(([k, v]) => `set "${k}=${v}"`).join(' && ') + ` && ${shellCmd}`;
    return pares.map(([k, v]) => `${k}=${v}`).join(' ') + ` ${shellCmd}`;
}

// Roda um comando na pasta do codigo: no container quando ele existe (o
// toolchain e garantido la, e e onde o build sempre rodou), senao no host.
async function runInSource(shellCmd, opts = {}) {
    const dir = sourceDir();
    if (!dir) return { code: 1, stdout: '', stderr: 'Codigo-fonte do app nao encontrado.' };

    if (await containerDisponivel()) {
        const cmd = comEnv(shellCmd, opts.env, false);
        return run('podman', ['exec', CONTAINER, 'bash', '-lc', `cd ${SRC_IN_CONTAINER} && ${cmd}`], opts);
    }
    if (process.platform === 'win32') {
        return run('cmd.exe', ['/c', comEnv(shellCmd, opts.env, true)], { ...opts, cwd: dir });
    }
    return run('bash', ['-lc', comEnv(shellCmd, opts.env, false)], { ...opts, cwd: dir });
}

// ============================================================
// Caminhos
// ============================================================
function sourceDir() {
    // Em dev o app ja roda da pasta do codigo.
    if (!app.isPackaged) return app.getAppPath();
    // Empacotado, app.getAppPath() aponta pra dentro do asar — e o asar tem
    // package.json, entao subir procurando package.json acharia o lugar errado.
    // A ancora e a raiz do repo (herodev.conf + _mac/), como no tunel.
    const root = deps.findRepoRoot();
    if (!root) return null;
    const dir = path.join(root, 'volumes', 'workspace', 'herodev-desk');
    return fs.existsSync(path.join(dir, 'forge.config.js')) ? dir : null;
}

// O script package:win e fixo em --arch=x64; nos outros vale a arquitetura
// desta maquina.
function targetArch() {
    return process.platform === 'win32' ? 'x64' : process.arch;
}

function buildTarget() {
    if (process.platform === 'darwin') return process.arch === 'arm64' ? 'package:mac_arm64' : 'package:mac_x64';
    if (process.platform === 'win32') return 'package:win';
    return 'package';
}

function bundleDirName() {
    return `herodev-desk-${process.platform}-${targetArch()}`;
}

function bundlePath(base) {
    const dir = path.join(base, bundleDirName());
    if (process.platform === 'darwin') return path.join(dir, 'herodev-desk.app');
    if (process.platform === 'win32') return path.join(dir, 'herodev-desk.exe');
    return path.join(dir, 'herodev-desk');
}

const IGNORAR = new Set(['node_modules', 'out', STAGE_DIR, 'logs']);
// package-lock.json fica de fora: o npm install reescreve o arquivo sem que
// nada do app tenha mudado, e isso acenderia o aviso de "versao nova" sozinho.
// Mudanca de dependencia continua aparecendo pelo package.json.
const IGNORAR_ARQUIVOS = new Set(['package-lock.json']);
const EXTENSOES = new Set(['.js', '.html', '.css', '.json']);

// mtime mais recente do codigo. Na raiz so conta arquivo de codigo (um .zip
// largado ali nao e "versao nova"); dentro de assets/ conta qualquer arquivo.
function newestSourceMtime(dir, profundidade = 0) {
    let maior = 0;
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }

    for (const entrada of entradas) {
        if (entrada.name.startsWith('.') || IGNORAR.has(entrada.name)) continue;
        if (IGNORAR_ARQUIVOS.has(entrada.name)) continue;
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
            if (profundidade < 3) maior = Math.max(maior, newestSourceMtime(completo, profundidade + 1));
            continue;
        }
        if (profundidade === 0 && !EXTENSOES.has(path.extname(entrada.name))) continue;
        try { maior = Math.max(maior, fs.statSync(completo).mtimeMs); } catch { /* ignore */ }
    }
    return maior;
}

function mtimeDe(caminho) {
    try { return fs.statSync(caminho).mtimeMs; } catch { return 0; }
}

// ============================================================
// Git
// ============================================================
async function gitInfo() {
    const info = { commitsBehind: 0, dirty: false, branch: '', offline: false };

    const fetch = await runInSource('git fetch --quiet origin', { timeout: GIT_TIMEOUT });
    if (fetch.code !== 0) info.offline = true;   // sem rede nao e erro pro usuario

    const atras = await runInSource('git rev-list --count HEAD..@{u}', { timeout: PROBE_TIMEOUT });
    if (atras.code === 0) {
        const n = parseInt(atras.stdout.trim(), 10);
        if (Number.isFinite(n)) info.commitsBehind = n;
    }

    const sujo = await runInSource('git status --porcelain', { timeout: PROBE_TIMEOUT });
    if (sujo.code === 0) info.dirty = sujo.stdout.trim().length > 0;

    const branch = await runInSource('git rev-parse --abbrev-ref HEAD', { timeout: PROBE_TIMEOUT });
    if (branch.code === 0) info.branch = branch.stdout.trim();

    return info;
}

// ============================================================
// API
// ============================================================
async function checkUpdate() {
    const estado = {
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        target: buildTarget(),
        localNewer: false,
        builtAt: null,
        sourceAt: null,
        commitsBehind: 0,
        dirty: false,
        offline: false,
        branch: '',
        error: null
    };

    const dir = sourceDir();
    if (!dir) {
        estado.error = 'Codigo-fonte do app nao encontrado a partir do bundle.';
        return estado;
    }

    const built = app.isPackaged ? mtimeDe(bundlePath(path.join(dir, 'out'))) : 0;
    const fonte = newestSourceMtime(dir);
    estado.builtAt = built || null;
    estado.sourceAt = fonte || null;
    // Em dev nao ha bundle pra comparar: quem responde por "versao nova" e o git.
    estado.localNewer = !!(app.isPackaged && built && fonte > built);

    try {
        const git = await gitInfo();
        Object.assign(estado, git);
    } catch (error) {
        log.warn('Checagem de git falhou (ignorado):', error.message);
    }

    return estado;
}

function temAtualizacao(estado) {
    return !!estado && !estado.error && (estado.localNewer || estado.commitsBehind > 0);
}

async function runUpdate(onLine = () => {}) {
    const dir = sourceDir();
    if (!dir) return { success: false, error: 'Codigo-fonte do app nao encontrado.' };

    const git = await gitInfo();
    let pulled = false;
    let pullPulado = false;

    if (git.commitsBehind > 0) {
        if (git.dirty) {
            pullPulado = true;
            onLine('Ha alteracoes locais nao commitadas: pulando o git pull e recompilando o codigo atual.');
        } else {
            onLine('git pull --ff-only');
            const r = await runInSource('git pull --ff-only', { timeout: GIT_TIMEOUT, onLine });
            if (r.code !== 0) {
                return { success: false, error: `git pull falhou: ${(r.stderr || r.stdout).trim().slice(-200)}` };
            }
            pulled = true;
        }
    }

    onLine('npm install');
    const instalar = await runInSource('npm install', { timeout: BUILD_TIMEOUT, onLine });
    if (instalar.code !== 0) return { success: false, error: 'npm install falhou (veja o log).' };

    // Em dev nao ha bundle: relançar ja pega o codigo novo, empacotar seria
    // gastar minutos a toa.
    if (!app.isPackaged) return { success: true, dev: true, pulled, pullPulado };

    const target = buildTarget();
    onLine(`npm run ${target}`);
    const build = await runInSource(`npm run ${target}`, {
        timeout: BUILD_TIMEOUT, onLine, env: { HERODEV_OUT_DIR: STAGE_DIR }
    });
    if (build.code !== 0) return { success: false, error: `Compilacao falhou (npm run ${target}).` };

    // Confere no disco em vez de confiar so no exit code, mesmo motivo do
    // runBackup(): pipeline longo com redirecionamento mente sobre o status.
    const staged = bundlePath(path.join(dir, STAGE_DIR));
    if (!fs.existsSync(staged)) {
        return { success: false, error: `A compilacao terminou mas ${staged} nao apareceu.` };
    }

    return { success: true, pulled, pullPulado, staged };
}

// Script solto que troca o bundle DEPOIS que este processo morre. No macOS da
// pra apagar o .app em execucao, mas o app perde o proprio asar no meio do
// caminho; no Windows o .exe fica travado enquanto roda. Esperar a saida
// resolve os dois.
function scriptDeTroca({ pid, origem, destino, alvo, stage }) {
    if (process.platform === 'win32') {
        return { extensao: '.bat', conteudo: [
            '@echo off',
            ':espera',
            `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
            'if not errorlevel 1 (',
            '  timeout /t 1 /nobreak >nul',
            '  goto espera',
            ')',
            `rmdir /s /q "${destino}" 2>nul`,
            `move "${origem}" "${destino}"`,
            `rmdir /q "${stage}" 2>nul`,
            `start "" "${alvo}"`,
            ''
        ].join('\r\n') };
    }

    const abrir = process.platform === 'darwin' ? `open "${alvo}"` : `"${alvo}" &`;
    return { extensao: '.sh', conteudo: [
        '#!/bin/bash',
        '# Troca o bundle do HeroDev Desktop depois que ele encerra.',
        `for _i in $(seq 1 120); do kill -0 ${pid} 2>/dev/null || break; sleep 0.5; done`,
        `rm -rf "${destino}"`,
        `mkdir -p "$(dirname "${destino}")"`,
        `mv "${origem}" "${destino}"`,
        `rmdir "${stage}" 2>/dev/null || true`,
        abrir,
        ''
    ].join('\n') };
}

function applyAndRestart() {
    const dir = sourceDir();
    if (!dir) return { success: false, error: 'Codigo-fonte do app nao encontrado.' };

    const origem = path.join(dir, STAGE_DIR, bundleDirName());
    const destino = path.join(dir, 'out', bundleDirName());
    const alvo = bundlePath(path.join(dir, 'out'));
    const stage = path.join(dir, STAGE_DIR);

    // O script usa aspas duplas nos caminhos; uma aspa dentro do caminho
    // quebraria o comando. Melhor recusar do que executar algo torto.
    if ([origem, destino, alvo, stage].some(p => p.includes('"'))) {
        return { success: false, error: 'Caminho do app contem aspas; troque a pasta de lugar.' };
    }
    if (!fs.existsSync(origem)) {
        return { success: false, error: `Nada compilado em ${origem}.` };
    }

    const { extensao, conteudo } = scriptDeTroca({ pid: process.pid, origem, destino, alvo, stage });
    const script = path.join(os.tmpdir(), `herodev-desk-update-${Date.now()}${extensao}`);
    try {
        fs.writeFileSync(script, conteudo, { mode: 0o755 });
    } catch (error) {
        return { success: false, error: `Nao foi possivel preparar a troca: ${error.message}` };
    }

    try {
        const proc = process.platform === 'win32'
            ? spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true })
            : spawn('bash', [script], { detached: true, stdio: 'ignore' });
        proc.on('error', (e) => log.error('Script de troca falhou:', e.message));
        proc.unref();
    } catch (error) {
        return { success: false, error: `Nao foi possivel iniciar a troca: ${error.message}` };
    }

    log.info(`Troca agendada: ${origem} -> ${destino}`);
    return { success: true, script };
}

module.exports = {
    configure,
    checkUpdate,
    temAtualizacao,
    runUpdate,
    applyAndRestart,
    buildTarget,
    sourceDir
};
