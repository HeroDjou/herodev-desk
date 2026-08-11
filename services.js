const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const log = require('./logger');

const CONTAINER_NAME = 'herodev';
const EXEC_TIMEOUT = 8000; // ms: evita que um podman travado empilhe chamadas

// Cada entrada e uma unit do systemd DENTRO do container. "configKey" liga a
// unit ao servico correspondente do config.json, que e quem sabe a URL real
// (porta + path + host do no ativo) — a porta aqui e so informativa.
const SERVICES = {
    apache2: { name: 'Apache', port: 8080, hasUI: true, configKey: 'localhost' },
    mariadb: { name: 'MariaDB', port: 3306, hasUI: false },
    'code-server': { name: 'VSCode', port: 12777, hasUI: true, configKey: 'vscode' },
    mailpit: { name: 'Mailpit', port: 8025, hasUI: true, configKey: 'mailpit' },
    ttyd: { name: 'Terminal', port: 8080, hasUI: true, optional: true, configKey: 'terminal' },
    filebrowser: { name: 'Arquivos', port: 8081, hasUI: true, optional: true, configKey: 'filebrowser' },
    'redis-server': { name: 'Redis', port: 6379, hasUI: false, optional: true },
    mongod: { name: 'MongoDB', port: 27017, hasUI: false, optional: true },
    // A imagem instala o Mongoku (Containerfile), nao o mongo-express: a unit
    // se chama mongoku.service. Monitorar o nome errado deixava o card "Mongo
    // UI" permanentemente vermelho.
    mongoku: { name: 'Mongo UI', port: 8082, hasUI: true, optional: true, configKey: 'mongodb' },
    nginx: { name: 'NGINX', port: 8083, hasUI: true, optional: true, configKey: 'nginx' },
    prometheus: { name: 'Prometheus', port: 9090, hasUI: true, optional: true, configKey: 'prometheus' },
    'grafana-server': { name: 'Grafana', port: 3000, hasUI: true, optional: true, configKey: 'grafana' }
};

// ============================================================
// No ativo (local ou remoto)
//
// O container pode estar nesta maquina ou no Raspberry. A diferenca inteira
// entre os dois casos e um flag do podman: "--connection <nome>" fala com o
// socket do Pi por SSH (docs/herodev-develop-anywhere.md secao 9). Todo o
// resto — systemctl, journalctl, start/stop — continua igual.
// ============================================================
let activeNode = { id: 'local', label: 'Local', podmanConnection: '', host: 'localhost' };

function setNode(node) {
    activeNode = {
        id: (node && node.id) || 'local',
        label: (node && node.label) || 'Local',
        podmanConnection: (node && node.podmanConnection) || '',
        host: (node && node.host) || 'localhost'
    };
    log.info(`No ativo: ${activeNode.label} (podman connection: ${activeNode.podmanConnection || 'local'})`);
}

function getNode() {
    return { ...activeNode };
}

function isRemote() {
    return !!activeNode.podmanConnection;
}

// Prefixo de TODA chamada ao podman. Escapa aspas simples no nome da conexao
// porque ele vem do config.json (editavel pelo usuario) e cai numa shell.
function podmanBase() {
    if (!activeNode.podmanConnection) return 'podman';
    const conn = String(activeNode.podmanConnection).replace(/'/g, `'\\''`);
    return `podman --connection '${conn}'`;
}

// Comando de terminal interativo pro container do no ativo. Usado tanto pelo
// "abrir no terminal do host" quanto pela mensagem de fallback da UI.
function interactiveShellCommand() {
    return `${podmanBase()} exec -it ${CONTAINER_NAME} bash`;
}

async function execInContainer(command) {
    try {
        const { stdout } = await execAsync(`${podmanBase()} exec ${CONTAINER_NAME} ${command}`, { timeout: EXEC_TIMEOUT });
        return stdout.trim();
    } catch (error) {
        log.warn(`Falha em 'podman exec ${command}':`, error.message);
        return null;
    }
}


async function checkPodman() {
    try {
        await execAsync(`${podmanBase()} info`, { timeout: 10000 });
        return true;
    } catch {
        // "podman machine" so existe no no local (Mac/Windows). No Pi o podman
        // roda nativo: nao ha VM pra subir, entao insistir aqui so gastaria o
        // timeout de todo ciclo de polling.
        if (isRemote()) return false;
        try {
            // VM parada (ex: boot do Mac) → só inicia; machine stop falha se já parada
            await execAsync('podman machine start', { timeout: 60000 });
            await execAsync('podman info', { timeout: 10000 });
            return true;
        } catch {
            return false;
        }
    }
}


async function isContainerRunning() {
    try {
        const { stdout } = await execAsync(`${podmanBase()} ps --filter name=${CONTAINER_NAME} --format "{{.State}}"`, { timeout: EXEC_TIMEOUT });
        return stdout.trim() === 'running';
    } catch {
        return false;
    }
}

async function getServiceStatus(serviceName) {
    // LoadState (e não só `is-active`) porque unit inexistente responde
    // "inactive" ao is-active — indistinguível de um serviço instalado e
    // parado. Resultado: o card ficava vermelho pra sempre em vez de sumir,
    // como acontecia com o "Mongo UI" em imagem sem o Mongoku.
    const result = await execInContainer(
        `bash -lc "systemctl show -p LoadState -p ActiveState --value ${serviceName} 2>/dev/null || true"`
    );
    if (result === null) {
        return { active: false, installed: false };
    }

    const [loadState = '', activeState = ''] = String(result).trim().toLowerCase().split(/\r?\n/);
    if (loadState === '' || loadState === 'not-found' || loadState === 'masked') {
        return { active: false, installed: false };
    }

    return { active: activeState === 'active', installed: true };
}

async function getAllServicesStatus() {
    const containerRunning = await isContainerRunning();
    if (!containerRunning) {
        return { containerRunning: false, services: {}, node: getNode() };
    }

    const entries = Object.entries(SERVICES);
    const results = await Promise.all(entries.map(([service]) => getServiceStatus(service)));

    const statuses = {};
    entries.forEach(([service, info], i) => {
        statuses[service] = {
            ...info,
            service,
            active: results[i].active,
            installed: results[i].installed
        };
    });

    return { containerRunning: true, services: statuses, node: getNode() };
}

async function startService(serviceName) {
    return execInContainer(`systemctl start ${serviceName}`);
}

async function stopService(serviceName) {
    return execInContainer(`systemctl stop ${serviceName}`);
}

async function restartService(serviceName) {
    return execInContainer(`systemctl restart ${serviceName}`);
}

async function getServiceLogs(serviceName, lines = 50) {
    return execInContainer(`journalctl -u ${serviceName} -n ${lines} --no-pager`);
}

async function startContainer() {
    if (!await checkPodman()) return false;

    try {
        await execAsync(`${podmanBase()} start ${CONTAINER_NAME}`);
        return true;
    } catch {
        return false;
    }
}

async function stopContainer() {
    if (!await checkPodman()) return false;

    try {
        await execAsync(`${podmanBase()} stop ${CONTAINER_NAME}`);
        return true;
    } catch {
        return false;
    }
}

async function restartContainer() {
    if (!await checkPodman()) return false;

    try {
        await execAsync(`${podmanBase()} restart ${CONTAINER_NAME}`);
        return true;
    } catch {
        return false;
    }
}

async function getContainerInfo() {
    const result = await execInContainer('herodev-info');
    try {
        return JSON.parse(result);
    } catch {
        return null;
    }
}

async function getHealthCheck() {
    const result = await execInContainer('herodev-health');
    try {
        return JSON.parse(result);
    } catch {
        return null;
    }
}

async function getStack() {
    const result = await execInContainer('herodev-stack');
    try {
        return JSON.parse(result);
    } catch {
        return [];
    }
}

module.exports = {
    SERVICES,
    CONTAINER_NAME,
    setNode,
    getNode,
    isRemote,
    podmanBase,
    interactiveShellCommand,
    isContainerRunning,
    getServiceStatus,
    getAllServicesStatus,
    startService,
    stopService,
    restartService,
    getServiceLogs,
    startContainer,
    stopContainer,
    restartContainer,
    getContainerInfo,
    getHealthCheck,
    getStack
};
