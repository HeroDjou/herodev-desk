const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    openService: (url, openType, serviceName) => {
        ipcRenderer.send('open-service', { url, openType, serviceName });
    },
    openExternal: (url) => {
        ipcRenderer.send('open-external', url);
    },
    tabActivate: (tabId) => {
        ipcRenderer.send('tab-activate', tabId);
    },
    tabClose: (tabId) => {
        ipcRenderer.send('tab-close', tabId);
    },
    tabCloseAll: () => {
        ipcRenderer.send('tab-close-all');
    },
    onTabsUpdated: (callback) => {
        ipcRenderer.on('tabs-updated', (event, tabs) => callback(tabs));
    },
    onHomeVisibility: (callback) => {
        ipcRenderer.on('home-visibility', (event, isVisible) => callback(isVisible));
    },
    serviceAction: (service, action) => {
        return ipcRenderer.invoke('service-action', { service, action });
    },
    containerAction: (action) => {
        return ipcRenderer.invoke('container-action', action);
    },
    getServicesStatus: () => {
        return ipcRenderer.invoke('get-services-status');
    },
    getServiceLogs: (service, lines = 50) => {
        return ipcRenderer.invoke('get-service-logs', { service, lines });
    },
    getContainerInfo: () => {
        return ipcRenderer.invoke('get-container-info');
    },
    getStack: () => {
        return ipcRenderer.invoke('get-stack');
    },
    // Aplicacoes do /workspace/www (raiz + pastas que agrupam apps)
    getWwwApps: () => {
        return ipcRenderer.invoke('get-www-apps');
    },
    onServicesStatus: (callback) => {
        ipcRenderer.on('services-status', (event, status) => callback(status));
    },
    onAppNotice: (callback) => {
        ipcRenderer.on('app-notice', (event, notice) => callback(notice));
    },
    // Config APIs
    getConfig: () => {
        return ipcRenderer.invoke('get-config');
    },
    saveConfig: (config) => {
        return ipcRenderer.invoke('save-config', config);
    },
    // Nos (local x Raspberry), terminal e tunel
    getNodes: () => {
        return ipcRenderer.invoke('get-nodes');
    },
    setActiveNode: (nodeId) => {
        return ipcRenderer.invoke('set-active-node', nodeId);
    },
    openTerminal: () => {
        return ipcRenderer.invoke('open-terminal');
    },
    tunnelToggle: (enabled) => {
        return ipcRenderer.invoke('tunnel-toggle', enabled);
    },
    onNodeChanged: (callback) => {
        ipcRenderer.on('node-changed', (event, node) => callback(node));
    },
    // Backup do banco sob demanda
    backupNow: () => {
        return ipcRenderer.invoke('backup-now');
    },
    getBackupStatus: () => {
        return ipcRenderer.invoke('get-backup-status');
    },
    onBackupState: (callback) => {
        ipcRenderer.on('backup-state', (event, state) => callback(state));
    },
    // Atualizacao do proprio app (checar, recompilar e reabrir)
    getAppInfo: () => {
        return ipcRenderer.invoke('get-app-info');
    },
    getAppUpdate: () => {
        return ipcRenderer.invoke('get-app-update');
    },
    runAppUpdate: () => {
        return ipcRenderer.invoke('app-update-run');
    },
    onAppUpdateState: (callback) => {
        ipcRenderer.on('app-update-state', (event, state) => callback(state));
    },
    // DevTools toggle
    toggleDevTools: () => {
        ipcRenderer.send('toggle-devtools');
    }
});
