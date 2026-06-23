const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const services = require('./services');

let tray = null;
let mainWindow = null;

function createTrayIcon(isRunning = true) {
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    
    const color = isRunning ? { r: 40, g: 167, b: 69 } : { r: 220, g: 53, b: 69 };
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const cx = x - size / 2;
            const cy = y - size / 2;
            const dist = Math.sqrt(cx * cx + cy * cy);
            
            if (dist < size / 2 - 1) {
                canvas[idx] = color.r;
                canvas[idx + 1] = color.g;
                canvas[idx + 2] = color.b;
                canvas[idx + 3] = 255;
            } else if (dist < size / 2) {
                canvas[idx] = Math.floor(color.r * 0.8);
                canvas[idx + 1] = Math.floor(color.g * 0.8);
                canvas[idx + 2] = Math.floor(color.b * 0.8);
                canvas[idx + 3] = 255;
            } else {
                canvas[idx + 3] = 0;
            }
        }
    }
    
    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createTray(window) {
    mainWindow = window;
    
    const icon = createTrayIcon(false);
    
    tray = new Tray(icon);
    tray.setToolTip('HeroDev Manager');
    
    updateTrayMenu();
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
            }
        }
    });
    
    return tray;
}

async function updateTrayMenu(statusArg) {
    // Reusa o status ja calculado pelo polling (evita 2x getAllServicesStatus/5s).
    const status = statusArg || await services.getAllServicesStatus();

    if (!tray || (tray.isDestroyed && tray.isDestroyed())) return;

    tray.setImage(createTrayIcon(status.containerRunning));
    tray.setToolTip(`HeroDev - ${status.containerRunning ? 'Ativo' : 'Parado'}`);
    
    const serviceMenuItems = Object.entries(status.services || {})
        .filter(([_, info]) => info.installed !== false)
        .map(([service, info]) => ({
            label: `${info.name} ${info.active ? '✓' : '✗'}`,
            submenu: [
                {
                    label: info.active ? 'Reiniciar' : 'Iniciar',
                    click: async () => {
                        if (info.active) {
                            await services.restartService(service);
                        } else {
                            await services.startService(service);
                        }
                        updateTrayMenu();
                    }
                },
                {
                    label: 'Parar',
                    enabled: info.active,
                    click: async () => {
                        await services.stopService(service);
                        updateTrayMenu();
                    }
                }
            ]
        }));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: `HeroDev ${status.containerRunning ? '(Rodando)' : '(Parado)'}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'Abrir Painel',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Serviços',
            submenu: serviceMenuItems.length > 0 ? serviceMenuItems : [{ label: 'Nenhum disponível', enabled: false }]
        },
        { type: 'separator' },
        {
            label: 'Container',
            submenu: [
                {
                    label: 'Iniciar',
                    enabled: !status.containerRunning,
                    click: async () => {
                        await services.startContainer();
                        updateTrayMenu();
                    }
                },
                {
                    label: 'Parar',
                    enabled: status.containerRunning,
                    click: async () => {
                        await services.stopContainer();
                        updateTrayMenu();
                    }
                },
                {
                    label: 'Reiniciar',
                    enabled: status.containerRunning,
                    click: async () => {
                        await services.restartContainer();
                        updateTrayMenu();
                    }
                }
            ]
        },
        { type: 'separator' },
        {
            label: 'Atualizar Status',
            click: () => updateTrayMenu()
        },
        { type: 'separator' },
        {
            label: 'Sair',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setContextMenu(contextMenu);
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

module.exports = {
    createTray,
    updateTrayMenu,
    destroyTray
};
