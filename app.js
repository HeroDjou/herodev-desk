let resourcesLoaded = false;
let imagesLoaded = false;
let currentStatus = { containerRunning: false, services: {} };
// Nos disponiveis (local x Raspberry) e qual esta ativo. Preenchido por
// refreshNodes(); a UI inteira deriva a URL dos servicos daqui.
let nodeState = { nodes: {}, activeNode: 'local', urlHost: 'localhost' };

window.addEventListener('load', () => {
    resourcesLoaded = true;
    checkAndHideSplash();
    initStatusListener();
});

const images = document.querySelectorAll('.service-icon');
let loadedCount = 0;
const totalImages = images.length;

if (totalImages === 0) {
    imagesLoaded = true;
    checkAndHideSplash();
} else {
    images.forEach(img => {
        if (img.complete) {
            loadedCount++;
        } else {
            img.addEventListener('load', onImageLoad);
            img.addEventListener('error', onImageLoad);
        }
    });

    if (loadedCount === totalImages) {
        imagesLoaded = true;
        checkAndHideSplash();
    }
}

function onImageLoad() {
    loadedCount++;
    if (loadedCount === totalImages) {
        imagesLoaded = true;
        checkAndHideSplash();
    }
}

function checkAndHideSplash() {
    if (resourcesLoaded && imagesLoaded) {
        document.getElementById('splashScreen').classList.add('hidden');
    }
}

function initStatusListener() {
    if (typeof window.api !== 'undefined' && window.api.onServicesStatus) {
        window.api.onServicesStatus(updateStatusBar);
    }
    if (typeof window.api !== 'undefined' && window.api.onTabsUpdated) {
        window.api.onTabsUpdated(renderTabs);
    }
    if (typeof window.api !== 'undefined' && window.api.onHomeVisibility) {
        window.api.onHomeVisibility(setHomeVisibility);
    }
    if (typeof window.api !== 'undefined' && window.api.onAppNotice) {
        window.api.onAppNotice(showAppNotice);
    }
    if (typeof window.api !== 'undefined' && window.api.onNodeChanged) {
        window.api.onNodeChanged(() => refreshNodes());
    }
    refreshNodes();
    loadStack();
}

// ============ NÓS (local x Raspberry) ============
async function refreshNodes() {
    if (typeof window.api === 'undefined' || !window.api.getNodes) return;
    try {
        nodeState = await window.api.getNodes();
        if (!appConfig) await loadConfig();
    } catch {
        return;
    }
    renderServiceCards();
    renderNodeIndicator();
    updateStatusBar(currentStatus);
    loadStack();
}

function activeNodeInfo() {
    const node = (nodeState.nodes || {})[nodeState.activeNode] || {};
    return { id: nodeState.activeNode, label: node.label || nodeState.activeNode, tunnel: node.tunnel || null };
}

function renderNodeIndicator() {
    const el = document.getElementById('nodeIndicator');
    if (!el) return;
    const node = activeNodeInfo();
    const viaTunel = node.tunnel && node.tunnel.enabled ? ' (túnel)' : '';
    el.textContent = `${node.label}${viaTunel} · ${nodeState.urlHost}`;
}

async function switchNode(nodeId) {
    if (nodeId === nodeState.activeNode) return;
    if (typeof window.api === 'undefined' || !window.api.setActiveNode) return;
    const result = await window.api.setActiveNode(nodeId);
    if (!result || !result.success) {
        showAppNotice({ text: `Não foi possível trocar de nó: ${result && result.error}` });
        return;
    }
    await refreshNodes();
}

async function toggleTunnel() {
    const node = activeNodeInfo();
    if (!node.tunnel) return;
    const result = await window.api.tunnelToggle(!node.tunnel.enabled);
    if (!result || !result.success) {
        showAppNotice({ text: `Túnel SSH: ${result && result.error}` });
    }
    await refreshNodes();
}

async function openHostTerminal() {
    if (typeof window.api === 'undefined' || !window.api.openTerminal) return;
    const result = await window.api.openTerminal();
    if (!result || !result.success) {
        showAppNotice({ text: `Terminal do host: ${result && result.error}` });
    }
}

// ============ CARDS DE SERVIÇO ============
// Um card por servico habilitado no config.json. O HTML nao guarda mais URL
// nenhuma: a do no ativo e resolvida no main.js na hora de abrir.
function renderServiceCards() {
    const grid = document.getElementById('serviceCards');
    if (!grid) return;

    const services = (appConfig && appConfig.services) || {};
    const entries = Object.entries(services).filter(([_, s]) => s && s.enabled !== false);

    if (!entries.length) {
        grid.innerHTML = '<div class="col-12 text-center text-muted small">Nenhum serviço habilitado nas configurações.</div>';
        return;
    }

    grid.innerHTML = entries.map(([key, service]) => {
        const name = service.name || key;
        const url = service.url || '';
        const icon = String(service.icon || '');
        const iconHtml = icon.startsWith('fa:')
            ? `<i class="fas ${escapeHtml(icon.slice(3))} service-icon mx-auto d-block mb-2"></i>`
            : `<img src="${escapeHtml(icon)}" alt="${escapeHtml(name)}" class="service-icon mx-auto d-block mb-2">`;

        // O Terminal ganha um botao extra: abrir no terminal nativo do host,
        // que funciona mesmo se o ttyd nao estiver instalado na imagem.
        const hostTerminalBtn = key === 'terminal'
            ? `<button class="btn btn-sm btn-outline-warning action-btn" data-open="host-terminal" title="Abrir no terminal do sistema">
                    <i class="fas fa-desktop"></i>
               </button>`
            : '';

        // data-* em vez de onclick inline: nome e URL vem do config.json, que o
        // usuario edita — aspas no valor quebrariam um literal JS no atributo.
        const attrs = `data-url="${escapeHtml(url)}" data-name="${escapeHtml(name)}"`;

        return `
            <div class="col">
                <div class="card h-100">
                    <div class="card-body text-center py-3">
                        ${iconHtml}
                        <h6 class="card-title mb-0 small">${escapeHtml(name)}</h6>
                    </div>
                    <div class="card-footer d-flex justify-content-around p-2">
                        <button class="btn btn-sm btn-outline-primary action-btn" data-open="window" ${attrs} title="Nova janela">
                            <i class="fas fa-window-maximize"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary action-btn" data-open="tab" ${attrs} title="Nova aba">
                            <i class="fas fa-folder-plus"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-info action-btn" data-open="browser" ${attrs} title="Navegador">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                        ${hostTerminalBtn}
                    </div>
                </div>
            </div>`;
    }).join('');

    applyTheme((appConfig && appConfig.theme) || 'dark');
}

// URL da interface web de um serviço monitorado. A porta do systemd nem sempre
// é a porta pública (o Mailpit e o ttyd saem pelo Apache em /mailpit e
// /terminal), então o config.json é quem manda — a porta fica de reserva.
function serviceUiUrl(info) {
    const fromConfig = info.configKey && appConfig && appConfig.services && appConfig.services[info.configKey];
    if (fromConfig && fromConfig.url) return fromConfig.url;
    return `http://${nodeState.urlHost || 'localhost'}:${info.port}`;
}

// Delegacao: cards e status bar sao re-renderizados a cada ciclo de polling e
// a cada troca de no — ouvir no documento evita religar listener toda vez.
document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-open]');
    if (!el) return;
    event.preventDefault();
    const openType = el.getAttribute('data-open');
    if (openType === 'host-terminal') {
        openHostTerminal();
        return;
    }
    openService(el.getAttribute('data-url'), openType, el.getAttribute('data-name'));
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function showAppNotice(notice) {
    let el = document.getElementById('appNotice');
    if (!notice || !notice.text) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.id = 'appNotice';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#8a2b2b;color:#fff;padding:8px 14px;font-size:13px;' +
            'text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35)';
        document.body.appendChild(el);
    }
    el.textContent = '⚠ ' + notice.text;
}

// Painel "Stack instalado": linguagens / ferramentas / servidores + versoes.
function loadStack() {
    const el = document.getElementById('stackContainer');
    if (!el || typeof window.api === 'undefined' || !window.api.getStack) return;
    window.api.getStack().then(stack => {
        stack = Array.isArray(stack) ? stack : [];
        if (!stack.length) { el.innerHTML = '<span class="text-muted small">Stack indisponível</span>'; return; }
        const cats = {};
        stack.forEach(it => { (cats[it.categoria] = cats[it.categoria] || []).push(it); });
        const chip = it => `
            <span class="d-inline-flex align-items-center gap-2"
                  style="background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.25);border-radius:20px;padding:5px 12px;font-size:13px">
                <i class="${it.icon}" style="opacity:.85"></i>
                <span>${it.nome}</span>
                <span style="opacity:.6;font-size:12px">${it.versao}</span>
            </span>`;
        el.innerHTML = Object.keys(cats).map(cat => `
            <div class="text-center">
                <div class="text-muted text-uppercase mb-2" style="font-size:11px;letter-spacing:.5px">${cat}</div>
                <div class="d-flex flex-wrap justify-content-center gap-2">${cats[cat].map(chip).join('')}</div>
            </div>`).join('');
    }).catch(() => { el.innerHTML = '<span class="text-muted small">Stack indisponível</span>'; });
}

function setHomeVisibility(isVisible) {
    const cardsContainer = document.getElementById('cardsContainer');
    if (cardsContainer) {
        if (isVisible) {
            cardsContainer.classList.remove('d-none');
        } else {
            cardsContainer.classList.add('d-none');
        }
    }
}

function openService(url, openType, serviceName) {
    if (typeof window.api !== 'undefined' && window.api.openService) {
        window.api.openService(url, openType, serviceName);
    } else {
        if (openType === 'window') {
            window.open(url, '_blank', 'width=1920,height=1080');
        } else {
            window.open(url, '_blank');
        }
    }
}

async function serviceAction(service, action) {
    const btn = event?.target?.closest('button');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }
    
    if (typeof window.api !== 'undefined' && window.api.serviceAction) {
        const result = await window.api.serviceAction(service, action);
        if (!result.success) {
            console.error(`Service action failed: ${result.error}`);
        }
    }
}

async function containerAction(action) {
    const statusBar = document.getElementById('statusBar');
    statusBar.classList.add('loading');
    
    if (typeof window.api !== 'undefined' && window.api.containerAction) {
        const result = await window.api.containerAction(action);
        if (!result.success) {
            console.error(`Container action failed: ${result.error}`);
        }
    }
    
    statusBar.classList.remove('loading');
}

function updateStatusBar(status) {
    currentStatus = status;
    const statusBar = document.getElementById('statusBar');
    const servicesContainer = document.getElementById('servicesStatus');
    
    // Botão de configurações sempre visível
    const settingsBtn = `
        <button class="btn btn-sm btn-link text-light p-0 me-2" onclick="openSettings()" title="Configurações">
            <i class="fas fa-cog"></i>
        </button>
    `;
    
    const containerStatusIcon = status.containerRunning
        ? '<i class="fas fa-circle text-success"></i>'
        : '<i class="fas fa-circle text-danger"></i>';

    // Seletor de nó: mesmo app, container desta máquina ou o do Raspberry.
    const node = activeNodeInfo();
    const nodeOptions = Object.entries(nodeState.nodes || {}).map(([id, info]) => `
        <li><a class="dropdown-item ${id === node.id ? 'active' : ''}" href="#" onclick="switchNode('${id}')">
            <i class="fas fa-${id === node.id ? 'check' : 'circle-notch'} me-1"></i> ${info.label || id}
        </a></li>
    `).join('');

    const tunnelItem = node.tunnel ? `
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item" href="#" onclick="toggleTunnel()">
            <i class="fas fa-${node.tunnel.enabled ? 'unlink' : 'link'} text-info"></i>
            ${node.tunnel.enabled ? 'Desligar túnel SSH' : 'Ligar túnel SSH (usar localhost)'}
        </a></li>
    ` : '';

    const nodeDropdown = `
        <div class="dropdown d-inline-block">
            <button class="btn btn-sm btn-dark dropdown-toggle" data-bs-toggle="dropdown" title="Nó ativo">
                <i class="fas fa-server"></i>
                <span class="ms-1">${node.label}</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-dark">
                <li class="dropdown-header">Nó ativo</li>
                ${nodeOptions}
                ${tunnelItem}
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="openHostTerminal()">
                    <i class="fas fa-terminal text-warning"></i> Abrir terminal do container
                </a></li>
            </ul>
        </div>
    `;

    const containerDropdown = `
        <div class="dropdown d-inline-block">
            <button class="btn btn-sm btn-dark dropdown-toggle" data-bs-toggle="dropdown">
                ${containerStatusIcon}
                <span class="ms-1">Container</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-dark">
                <li class="dropdown-header">Container ${status.containerRunning ? 'Ativo' : 'Parado'}</li>
                <li><hr class="dropdown-divider"></li>
                ${!status.containerRunning ? `
                    <li><a class="dropdown-item" href="#" onclick="containerAction('start')">
                        <i class="fas fa-play text-success"></i> Iniciar container
                    </a></li>
                ` : `
                    <li><a class="dropdown-item" href="#" onclick="containerAction('restart')">
                        <i class="fas fa-sync text-warning"></i> Reiniciar container
                    </a></li>
                    <li><a class="dropdown-item" href="#" onclick="containerAction('stop')">
                        <i class="fas fa-power-off text-danger"></i> Parar container
                    </a></li>
                `}
            </ul>
        </div>
    `;
    
    if (!status.containerRunning) {
        servicesContainer.innerHTML = settingsBtn + nodeDropdown + containerDropdown;
        return;
    }

    const serviceItems = Object.entries(status.services || {})
        .filter(([_, info]) => info.installed !== false)
        .map(([service, info]) => {
            const statusClass = info.active ? 'success' : 'danger';
            const statusIcon = info.active ? 'check-circle' : 'times-circle';
            
            return `
                <div class="dropdown d-inline-block">
                    <button class="btn btn-sm btn-dark dropdown-toggle service-btn" data-bs-toggle="dropdown">
                        <i class="fas fa-${statusIcon} text-${statusClass}"></i>
                        <span class="service-name">${info.name}</span>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark">
                        <li class="dropdown-header">${info.name}</li>
                        <li><hr class="dropdown-divider"></li>
                        ${info.active ? `
                            <li><a class="dropdown-item" href="#" onclick="serviceAction('${service}', 'restart')">
                                <i class="fas fa-sync text-warning"></i> Reiniciar
                            </a></li>
                            <li><a class="dropdown-item" href="#" onclick="serviceAction('${service}', 'stop')">
                                <i class="fas fa-stop text-danger"></i> Parar
                            </a></li>
                        ` : `
                            <li><a class="dropdown-item" href="#" onclick="serviceAction('${service}', 'start')">
                                <i class="fas fa-play text-success"></i> Iniciar
                            </a></li>
                        `}
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item" href="#" onclick="showServiceLogs('${service}')">
                            <i class="fas fa-file-alt text-info"></i> Ver logs
                        </a></li>
                        ${info.hasUI && info.active ? `
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item" href="#" data-open="tab"
                                   data-url="${escapeHtml(serviceUiUrl(info))}" data-name="${escapeHtml(info.name)}">
                                <i class="fas fa-folder-plus"></i> Abrir interface
                            </a></li>
                        ` : ''}
                    </ul>
                </div>
            `;
        }).join('');
    
    servicesContainer.innerHTML = settingsBtn + nodeDropdown + containerDropdown + serviceItems;
}

async function showServiceLogs(service) {
    if (typeof window.api === 'undefined' || !window.api.getServiceLogs) return;
    
    const logs = await window.api.getServiceLogs(service, 100);
    
    let modal = document.getElementById('logsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'logsModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content bg-dark text-light">
                    <div class="modal-header border-secondary">
                        <h5 class="modal-title">Logs do serviço</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <pre class="logs-content mb-0" style="font-size: 0.75rem; max-height: 60vh; overflow: auto;"></pre>
                    </div>
                    <div class="modal-footer border-secondary">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.querySelector('.modal-title').textContent = `Logs: ${service}`;
    modal.querySelector('.logs-content').textContent = logs || 'Nenhum log disponível';
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

function activateTab(tabId) {
    if (typeof window.api !== 'undefined' && window.api.tabActivate) {
        window.api.tabActivate(tabId);
    }
}

function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    if (typeof window.api !== 'undefined' && window.api.tabClose) {
        window.api.tabClose(tabId);
    }
}

function closeAllTabs() {
    if (typeof window.api !== 'undefined' && window.api.tabCloseAll) {
        window.api.tabCloseAll();
    }
}

function renderTabs(tabs) {
    const tabBar = document.getElementById('tabBar');
    const tabNav = document.getElementById('tabNav');
    const cardsContainer = document.getElementById('cardsContainer');
    
    // Se não há abas ou só tem a Home, esconder a barra de abas
    if (tabs.length === 0) {
        tabBar.classList.add('d-none');
        document.body.classList.remove('has-tabs');
        if (cardsContainer) cardsContainer.classList.remove('d-none');
        return;
    }
    
    tabBar.classList.remove('d-none');
    document.body.classList.add('has-tabs');
    
    // Verificar se Home está ativa para mostrar/esconder cards
    const homeTab = tabs.find(t => t.id === 'home');
    const isHomeActive = homeTab && homeTab.active;
    
    if (cardsContainer) {
        if (isHomeActive) {
            cardsContainer.classList.remove('d-none');
        } else {
            cardsContainer.classList.add('d-none');
        }
    }
    
    tabNav.innerHTML = tabs.map(tab => `
        <li class="nav-item" role="presentation">
            <button class="nav-link d-flex align-items-center gap-2 ${tab.active ? 'active' : ''}" 
                    type="button" 
                    onclick="activateTab('${tab.id}')">
                ${tab.id === 'home' ? '<i class="fas fa-home"></i>' : ''}
                <span class="text-truncate" style="max-width: 150px;">${tab.title}</span>
                ${tab.closeable ? `<i class="fas fa-times btn-close-tab" onclick="closeTab('${tab.id}', event)"></i>` : ''}
            </button>
        </li>
    `).join('') + `
        <li class="nav-item ms-2">
            <button class="btn btn-sm btn-outline-secondary" onclick="closeAllTabs()" title="Fechar todas as abas">
                <i class="fas fa-times-circle"></i>
            </button>
        </li>
    `;
}

// ============ CONFIGURAÇÕES ============
let appConfig = null;
let settingsModalInstance = null;

async function loadConfig() {
    if (typeof window.api !== 'undefined' && window.api.getConfig) {
        appConfig = await window.api.getConfig();
    }
    return appConfig;
}

async function saveConfig(config) {
    if (typeof window.api !== 'undefined' && window.api.saveConfig) {
        await window.api.saveConfig(config);
        appConfig = config;
        applyTheme(config.theme);
    }
}

function applyTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${theme}`);
    
    if (theme === 'light') {
        document.body.style.backgroundColor = '#f8f9fa';
        document.querySelectorAll('.card').forEach(card => {
            card.classList.remove('bg-dark', 'text-light');
        });
    } else {
        document.body.style.backgroundColor = '#1a1a2e';
        document.querySelectorAll('.card').forEach(card => {
            card.classList.add('bg-dark', 'text-light');
        });
    }
}

async function openSettings() {
    // Se o modal já está aberto, fecha ele (toggle)
    if (settingsModalInstance) {
        settingsModalInstance.hide();
        return;
    }
    
    if (!appConfig) {
        await loadConfig();
    }
    
    let modal = document.getElementById('settingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'settingsModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content bg-dark text-light">
                    <div class="modal-header border-secondary">
                        <h5 class="modal-title"><i class="fas fa-cog me-2"></i>Configurações</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <ul class="nav nav-tabs mb-3" role="tablist">
                            <li class="nav-item">
                                <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tabGeral">Geral</button>
                            </li>
                            <li class="nav-item">
                                <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabServicos">Serviços</button>
                            </li>
                        </ul>
                        <div class="tab-content">
                            <div class="tab-pane fade show active" id="tabGeral">
                                <div class="mb-3">
                                    <label class="form-label">Tema</label>
                                    <div class="btn-group w-100" role="group">
                                        <input type="radio" class="btn-check" name="theme" id="themeDark" value="dark">
                                        <label class="btn btn-outline-light" for="themeDark">
                                            <i class="fas fa-moon me-1"></i> Escuro
                                        </label>
                                        <input type="radio" class="btn-check" name="theme" id="themeLight" value="light">
                                        <label class="btn btn-outline-light" for="themeLight">
                                            <i class="fas fa-sun me-1"></i> Claro
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div class="tab-pane fade" id="tabServicos">
                                <div id="servicesConfigList"></div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-secondary">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveSettings()">Salvar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Preencher configurações atuais
    if (appConfig) {
        document.getElementById(appConfig.theme === 'light' ? 'themeLight' : 'themeDark').checked = true;
        renderServicesConfig();
    }
    
    settingsModalInstance = new bootstrap.Modal(modal);
    
    // Limpar a referência quando o modal for fechado
    modal.addEventListener('hidden.bs.modal', () => {
        settingsModalInstance = null;
    }, { once: true });
    
    settingsModalInstance.show();
}

function renderServicesConfig() {
    const container = document.getElementById('servicesConfigList');
    if (!container || !appConfig || !appConfig.services) return;
    
    container.innerHTML = Object.entries(appConfig.services).map(([key, service]) => `
        <div class="card bg-secondary mb-2">
            <div class="card-body p-2">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <strong>${service.name}</strong>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="enabled_${key}" ${service.enabled ? 'checked' : ''}>
                        <label class="form-check-label" for="enabled_${key}">Ativo</label>
                    </div>
                </div>
                <div class="row g-2">
                    <div class="col-md-8">
                        <label class="form-label small mb-1">URL</label>
                        <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary" 
                               id="url_${key}" value="${service.url}">
                    </div>
                    <div class="col-md-4">
                        <label class="form-label small mb-1">Porta</label>
                        <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary" 
                               id="port_${key}" value="${service.port}">
                    </div>
                </div>
                <div class="row g-2 mt-1">
                    <div class="col-md-6">
                        <label class="form-label small mb-1">Usuário</label>
                        <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary" 
                               id="user_${key}" value="${service.credentials?.username || ''}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1">Senha</label>
                        <input type="password" class="form-control form-control-sm bg-dark text-light border-secondary" 
                               id="pass_${key}" value="${service.credentials?.password || ''}">
                    </div>
                </div>
                <div class="form-check mt-2">
                    <input class="form-check-input" type="checkbox" id="autologin_${key}" ${service.autoLogin ? 'checked' : ''}>
                    <label class="form-check-label small" for="autologin_${key}">Login automático</label>
                </div>
            </div>
        </div>
    `).join('');
}

async function saveSettings() {
    if (!appConfig) return;
    
    // Tema
    const theme = document.getElementById('themeLight').checked ? 'light' : 'dark';
    appConfig.theme = theme;
    
    // Serviços
    Object.keys(appConfig.services).forEach(key => {
        const urlInput = document.getElementById(`url_${key}`);
        const portInput = document.getElementById(`port_${key}`);
        const enabledInput = document.getElementById(`enabled_${key}`);
        const userInput = document.getElementById(`user_${key}`);
        const passInput = document.getElementById(`pass_${key}`);
        const autoLoginInput = document.getElementById(`autologin_${key}`);
        
        if (urlInput) appConfig.services[key].url = urlInput.value;
        if (portInput) appConfig.services[key].port = parseInt(portInput.value);
        if (enabledInput) appConfig.services[key].enabled = enabledInput.checked;
        if (userInput) appConfig.services[key].credentials.username = userInput.value;
        if (passInput) appConfig.services[key].credentials.password = passInput.value;
        if (autoLoginInput) appConfig.services[key].autoLogin = autoLoginInput.checked;
    });
    
    await saveConfig(appConfig);
    // URL/porta/habilitado mudaram: os cards vem da config, então re-renderiza.
    renderServiceCards();

    const modal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
    if (modal) modal.hide();
}

// Carregar config ao iniciar
loadConfig().then(config => {
    if (config) {
        applyTheme(config.theme);
        renderServiceCards();
    }
});
