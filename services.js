const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const log = require('./logger');

const CONTAINER_NAME = 'herodev';
const EXEC_TIMEOUT = 8000; // ms: evita que um podman travado empilhe chamadas

const SERVICES = {
    apache2: { name: 'Apache', port: 8080, hasUI: true },
    mariadb: { name: 'MariaDB', port: 3306, hasUI: false },
    'code-server': { name: 'VSCode', port: 12777, hasUI: true },
    mailpit: { name: 'Mailpit', port: 8025, hasUI: false },
    filebrowser: { name: 'Arquivos', port: 8081, hasUI: true, optional: true },
    'redis-server': { name: 'Redis', port: 6379, hasUI: false, optional: true },
    mongod: { name: 'MongoDB', port: 27017, hasUI: false, optional: true },
    'mongo-express': { name: 'Mongo UI', port: 8082, hasUI: true, optional: true },
    nginx: { name: 'NGINX', port: 8083, hasUI: true, optional: true },
    prometheus: { name: 'Prometheus', port: 9090, hasUI: true, optional: true },
    'grafana-server': { name: 'Grafana', port: 3000, hasUI: true, optional: true }
};

async function execInContainer(command) {
    try {
        const { stdout } = await execAsync(`podman exec ${CONTAINER_NAME} ${command}`, { timeout: EXEC_TIMEOUT });
        return stdout.trim();
    } catch (error) {
        log.warn(`Falha em 'podman exec ${command}':`, error.message);
        return null;
    }
}


async function checkPodman() {
    try {
        await execAsync('podman info');
        return true;
    } catch {
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
        const { stdout } = await execAsync(`podman ps --filter name=${CONTAINER_NAME} --format "{{.State}}"`, { timeout: EXEC_TIMEOUT });
        return stdout.trim() === 'running';
    } catch {
        return false;
    }
}

async function getServiceStatus(serviceName) {
    const result = await execInContainer(`bash -lc "systemctl is-active ${serviceName} 2>/dev/null || true"`);
    if (result === null) {
        return { active: false, installed: false };
    }

    const state = String(result).trim().toLowerCase();
    if (state === '' || state === 'unknown' || state === 'not-found') {
        return { active: false, installed: false };
    }

    return { active: state === 'active', installed: true };
}

async function getAllServicesStatus() {
    const containerRunning = await isContainerRunning();
    if (!containerRunning) {
        return { containerRunning: false, services: {} };
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

    return { containerRunning: true, services: statuses };
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
        await execAsync(`podman start ${CONTAINER_NAME}`);
        return true;
    } catch {
        return false;
    }
}

async function stopContainer() {
    if (!await checkPodman()) return false;

    try {
        await execAsync(`podman stop ${CONTAINER_NAME}`);
        return true;
    } catch {
        return false;
    }
}

async function restartContainer() {
    if (!await checkPodman()) return false;

    try {
        await execAsync(`podman restart ${CONTAINER_NAME}`);
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
