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
    // DevTools toggle
    toggleDevTools: () => {
        ipcRenderer.send('toggle-devtools');
    }
});
