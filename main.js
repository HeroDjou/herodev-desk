const {
	app,
	BaseWindow,
	WebContentsView,
	ipcMain,
	shell,
	globalShortcut,
	dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const log = require('./logger');
const services = require('./services');
const { createTray, updateTrayMenu, destroyTray } = require('./tray');

let mainWindow;
let mainView;
let tabs = new Map();
let activeTabId = null;
let statusInterval = null;
let statusPolling = false;      // guarda de reentrancia do polling
let memInterval = null;
let memWarned = false;
let isHandlingFatal = false;    // evita reentrancia no handler fatal
let recoverState = { tries: 0, nextAt: 0, running: false };
let tunnelProc = null;          // processo do tunel SSH, quando ligado

const TAB_BAR_HEIGHT = 42;

// config.json: o app empacotado e read-only (asar). Mantemos a copia gravavel
// do usuario em userData, semeando a partir do bundle na primeira execucao.
const BUNDLED_CONFIG_PATH = path.join(__dirname, 'config.json');
let CONFIG_PATH;
try {
	CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
	if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(BUNDLED_CONFIG_PATH)) {
		fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
		fs.copyFileSync(BUNDLED_CONFIG_PATH, CONFIG_PATH);
	} else {
		seedMissingConfigKeys();
	}
} catch (e) {
	CONFIG_PATH = BUNDLED_CONFIG_PATH;
}

// A copia em userData e semeada UMA vez e depois nunca mais tocada — entao
// quem ja usava o app antes desta versao ficaria sem os "nodes" e sem o
// servico "terminal", e a funcionalidade simplesmente nao apareceria. Aqui a
// gente completa o que falta a partir do bundle, sem sobrescrever nada que o
// usuario ja tenha ajustado (senhas, URLs, servicos desabilitados).
function seedMissingConfigKeys() {
	if (!fs.existsSync(BUNDLED_CONFIG_PATH) || !fs.existsSync(CONFIG_PATH)) return;
	let bundled, user;
	try {
		bundled = JSON.parse(fs.readFileSync(BUNDLED_CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
		user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
	} catch (e) {
		log.warn('Nao foi possivel migrar o config do usuario:', e.message);
		return;
	}

	let changed = false;
	for (const [key, value] of Object.entries(bundled)) {
		if (key === 'services') continue;
		if (user[key] === undefined) { user[key] = value; changed = true; }
	}
	if (bundled.services) {
		user.services = user.services || {};
		for (const [key, service] of Object.entries(bundled.services)) {
			if (user.services[key] === undefined) { user.services[key] = service; changed = true; }
			// "icon" e novo: sem ele o card do servico ficaria sem imagem.
			else if (user.services[key] && !user.services[key].icon && service.icon) {
				user.services[key].icon = service.icon;
				changed = true;
			}
		}
	}

	if (!changed) return;
	try {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(user, null, 4), 'utf8');
		log.info('Config do usuario atualizado com as chaves novas do bundle.');
	} catch (e) {
		log.warn('Falha ao gravar config migrado:', e.message);
	}
}

// ============================================================
// Handlers globais: o app NUNCA deve encerrar em silencio.
// ============================================================
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 2 * 60 * 1000;
function restartHistoryPath() {
	try { return path.join(app.getPath('userData'), 'restart-history.json'); }
	catch { return path.join(__dirname, 'restart-history.json'); }
}
function readRestartHistory() {
	try {
		const arr = JSON.parse(fs.readFileSync(restartHistoryPath(), 'utf8'));
		const cutoff = Date.now() - RESTART_WINDOW_MS;
		return Array.isArray(arr) ? arr.filter(t => t > cutoff) : [];
	} catch { return []; }
}
function recordRestart() {
	try {
		const arr = readRestartHistory();
		arr.push(Date.now());
		fs.writeFileSync(restartHistoryPath(), JSON.stringify(arr));
	} catch (e) { log.warn('Falha ao gravar restart-history:', e.message); }
}

function handleFatal(kind, err) {
	const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
	log.error(`[${kind}] ${msg}`);
	if (isHandlingFatal) return;
	isHandlingFatal = true;
	try {
		const looping = readRestartHistory().length >= MAX_RESTARTS;
		const buttons = looping ? ['Sair', 'Continuar assim mesmo'] : ['Reiniciar', 'Continuar', 'Sair'];
		dialog.showMessageBox(mainWindow || undefined, {
			type: 'error',
			buttons,
			defaultId: 0,
			noLink: true,
			title: 'HeroDev - erro inesperado',
			message: looping ? 'Falhas repetidas detectadas.' : 'Ocorreu um erro inesperado.',
			detail: (looping ? 'O app falhou varias vezes seguidas.\n\n' : '') +
				`Detalhe: ${msg}\n\nLog: ${log.getLogPath()}`
		}).then(({ response }) => {
			if (!looping && response === 0) { recordRestart(); app.relaunch(); app.exit(0); }
			else if (!looping && response === 2) { app.isQuitting = true; app.exit(1); }
			else if (looping && response === 0) { app.isQuitting = true; app.exit(1); }
			else { isHandlingFatal = false; } // continuar degradado: re-arma o handler
		}).catch(() => { isHandlingFatal = false; });
	} catch (e) {
		log.error('handleFatal falhou:', e.message);
		isHandlingFatal = false;
	}
}

process.on('uncaughtException', (e) => handleFatal('uncaughtException', e));
process.on('unhandledRejection', (r) => {
	const msg = (r && (r.stack || r.message)) ? (r.stack || r.message) : String(r);
	log.error(`[unhandledRejection] ${msg}`);
	setStatusDegraded('Um erro interno foi registrado (veja os logs).');
});
app.on('child-process-gone', (_e, d) => log.warn('[child-process-gone]', d && d.type, d && d.reason));

// ============================================================
// Resiliencia de webContents (renderer principal / abas / janelas)
// ============================================================
function errorPageDataUrl(label, reason, retryUrl) {
	const safeReason = String(reason || '').replace(/</g, '&lt;');
	const safeUrl = String(retryUrl || '').replace(/'/g, "%27");
	const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#1a1a2e;color:#e6e6e6;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{max-width:540px;text-align:center;padding:32px}h1{font-size:20px;margin:0 0 8px}
p{color:#9aa;line-height:1.5}code{color:#ffb86c;word-break:break-all}
button{margin-top:20px;padding:10px 20px;border:0;border-radius:8px;background:#4f7cff;
color:#fff;font-size:14px;cursor:pointer}button:hover{background:#3a63d0}</style></head>
<body><div class="box"><h1>Nao foi possivel carregar ${label}</h1>
<p>O servico pode estar reiniciando ou indisponivel no momento.</p>
<p><code>${safeReason}</code></p>
<button onclick="location.href='${safeUrl}'">Tentar novamente</button></div></body></html>`;
	return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function attachWebContentsResilience(view, { label, reloadUrl, isMain = false } = {}) {
	const wc = view && view.webContents;
	if (!wc) return;
	wc.on('render-process-gone', (_e, d) => {
		log.error(`[render-gone:${label}]`, d && d.reason, d && d.exitCode);
		if (isMain) {
			dialog.showMessageBox(mainWindow || undefined, {
				type: 'error', buttons: ['Recarregar', 'Sair'], defaultId: 0, noLink: true,
				title: 'HeroDev', message: 'A interface travou.',
				detail: `Motivo: ${d && d.reason}. Deseja recarregar?`
			}).then(({ response }) => {
				if (response === 0 && !wc.isDestroyed()) wc.reload();
				else { app.isQuitting = true; app.quit(); }
			}).catch(() => {});
		} else if (!wc.isDestroyed()) {
			wc.loadURL(errorPageDataUrl(label, (d && d.reason) || 'render-process-gone', reloadUrl));
		}
	});
	wc.on('unresponsive', () => {
		log.warn(`[unresponsive:${label}]`);
		if (isMain) {
			dialog.showMessageBox(mainWindow || undefined, {
				type: 'warning', buttons: ['Esperar', 'Recarregar'], defaultId: 0, noLink: true,
				title: 'HeroDev', message: 'A interface nao esta respondendo.'
			}).then(({ response }) => { if (response === 1 && !wc.isDestroyed()) wc.reload(); }).catch(() => {});
		}
	});
	wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
		if (!isMainFrame || code === -3) return; // ignora ERR_ABORTED
		log.warn(`[did-fail-load:${label}]`, code, desc, url);
		if (!isMain && !wc.isDestroyed()) {
			wc.loadURL(errorPageDataUrl(label, `${desc} (${code})`, url || reloadUrl));
		}
	});
}

// Funções de configuração
function loadConfig() {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
			const sanitized = raw.replace(/^\uFEFF/, '');
			return JSON.parse(sanitized);
		}
	} catch (error) {
		log.error('Erro lendo config:', error.message);
	}
	return null;
}

function saveConfig(config) {
	try {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf8');
		return true;
	} catch (error) {
		log.error('Erro salvando config:', error.message);
		return false;
	}
}

function normalizeUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		const cleanPath = parsed.pathname.replace(/\/+$/, '');
		return `${parsed.protocol}//${parsed.host}${cleanPath}`.toLowerCase();
	} catch {
		return String(rawUrl || '').trim().toLowerCase();
	}
}

// ============================================================
// Nos: local (esta maquina) x Raspberry Pi
//
// O config.json guarda as URLs dos servicos sempre em "localhost". O host
// real vem do no ativo: trocar de no reescreve so o hostname, preservando
// porta e path. Com tunel SSH ligado o host CONTINUA localhost de proposito
// — e o ponto do tunel (docs/herodev-develop-anywhere.md secao 5.3): projetos
// com URL fixa em localhost:8080 (WordPress etc.) seguem funcionando.
// ============================================================
const DEFAULT_NODES = {
	local: { label: 'Local', podmanConnection: '', host: 'localhost', tunnel: null }
};

function getNodes() {
	const config = loadConfig() || {};
	const nodes = (config.nodes && typeof config.nodes === 'object') ? config.nodes : DEFAULT_NODES;
	return Object.keys(nodes).length ? nodes : DEFAULT_NODES;
}

function getActiveNodeId() {
	const config = loadConfig() || {};
	const nodes = getNodes();
	const wanted = config.activeNode;
	if (wanted && nodes[wanted]) return wanted;
	return Object.keys(nodes)[0];
}

function getActiveNode() {
	const id = getActiveNodeId();
	const node = getNodes()[id] || DEFAULT_NODES.local;
	return { id, ...node };
}

// Host que a UI deve usar nas URLs. Com tunel ligado, localhost.
function activeUrlHost() {
	const node = getActiveNode();
	if (node.tunnel && node.tunnel.enabled) return 'localhost';
	return node.host || 'localhost';
}

function resolveServiceUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		parsed.hostname = activeUrlHost();
		return parsed.toString().replace(/\/$/, '');
	} catch {
		return rawUrl;
	}
}

function applyActiveNode() {
	const node = getActiveNode();
	services.setNode({
		id: node.id,
		label: node.label,
		podmanConnection: node.podmanConnection,
		host: node.host
	});
	return node;
}

// AutoLogin so em servico do HeroDev: localhost, 127.0.0.1 ou o host do no
// ativo. Sem incluir o host do no, apontar pro Pi mataria o autologin.
function isManagedServiceUrl(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		const allowed = new Set(['localhost', '127.0.0.1', activeUrlHost()]);
		const node = getActiveNode();
		if (node.host) allowed.add(node.host);
		return allowed.has(parsed.hostname);
	} catch {
		return false;
	}
}

function resolveServiceConfig(url, serviceName) {
	const config = loadConfig();
	if (!config || !config.services) return null;

	const entries = Object.entries(config.services);
	// Compara sempre com a URL ja resolvida pro no ativo: o config guarda
	// localhost, mas a aba pode ter sido aberta em herodev.local.
	const targetUrl = normalizeUrl(url);

	let match = entries.find(([_, service]) => normalizeUrl(resolveServiceUrl(service?.url || '')) === targetUrl);
	if (!match) {
		match = entries.find(([_, service]) => normalizeUrl(service?.url || '') === targetUrl);
	}
	if (!match && serviceName) {
		const targetName = String(serviceName).trim().toLowerCase();
		match = entries.find(([key, service]) => {
			const keyName = String(key || '').toLowerCase();
			const displayName = String(service?.name || '').toLowerCase();
			return keyName === targetName || displayName === targetName;
		});
	}

	if (!match) return null;
	const [key, service] = match;
	return { key, service };
}

function buildAutoLoginScript({ username, password, shouldTrySkip, shouldAutoSubmit }) {
	const payload = JSON.stringify({
		username: username || '',
		password: password || '',
		shouldTrySkip: !!shouldTrySkip,
		shouldAutoSubmit: !!shouldAutoSubmit
	});

	return `(() => {
		const cfg = ${payload};

		const setValue = (input, value) => {
			if (!input || typeof value !== 'string') return false;
			if (input.value === value) return false;
			input.focus();
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		};

		const firstVisible = (list) => list.find((el) => {
			if (!el || el.disabled) return false;
			const style = window.getComputedStyle(el);
			return style.display !== 'none' && style.visibility !== 'hidden';
		});

		const usernameCandidates = [
			...document.querySelectorAll('input[type="email"]'),
			...document.querySelectorAll('input[name*="user" i], input[id*="user" i]'),
			...document.querySelectorAll('input[name*="login" i], input[id*="login" i]'),
			...document.querySelectorAll('input[name*="email" i], input[id*="email" i]'),
			...document.querySelectorAll('input[type="text"]')
		];

		const passwordCandidates = [
			...document.querySelectorAll('input[type="password"]')
		];

		const userInput = firstVisible(usernameCandidates);
		const passInput = firstVisible(passwordCandidates);

		let changed = false;
		if (cfg.username && userInput) {
			changed = setValue(userInput, cfg.username) || changed;
		}
		if (cfg.password && passInput) {
			changed = setValue(passInput, cfg.password) || changed;
		}

		if (cfg.shouldAutoSubmit && passInput) {
			const submit = firstVisible([
				...document.querySelectorAll('button[type="submit"], input[type="submit"]'),
				...document.querySelectorAll('button, a')
			].filter((el) => {
				const txt = (el.textContent || el.value || '').toLowerCase();
				return /entrar|login|sign in|submit|acessar|connect/.test(txt);
			}));

			if (submit && (changed || !submit.disabled)) {
				submit.click();
			}
		}

		if (cfg.shouldTrySkip && passInput) {
			const skipEl = firstVisible([
				...document.querySelectorAll('a, button')
			].filter((el) => {
				const txt = (el.textContent || '').toLowerCase();
				const href = (el.getAttribute && el.getAttribute('href')) || '';
				return /skip|pular|ignorar|continuar sem|without login/.test(txt) || /skip/i.test(href);
			}));

			if (skipEl) {
				skipEl.click();
			}
		}
	})();`;
}

function setupHttpBasicAutoLogin(webContents, url, serviceName) {
	const resolved = resolveServiceConfig(url, serviceName);
	if (!resolved || !resolved.service || !resolved.service.autoLogin) return;
	if (!isManagedServiceUrl(url)) return;

	const credentials = resolved.service.credentials || {};
	const username = String(credentials.username || '');
	const password = String(credentials.password || '');
	if (!username && !password) return;

	let attempted = false;
	webContents.on('login', (event, _request, authInfo, callback) => {
		if (attempted) return;
		if (authInfo && authInfo.isProxy) return;

		attempted = true;
		event.preventDefault();
		callback(username, password);
	});
}

function setupAutoLogin(webContents, url, serviceName) {
	const resolved = resolveServiceConfig(url, serviceName);
	if (!resolved || !resolved.service || !resolved.service.autoLogin) return;
	if (!isManagedServiceUrl(url)) return;

	setupHttpBasicAutoLogin(webContents, url, serviceName);

	const credentials = resolved.service.credentials || {};
	const username = credentials.username || '';
	const password = credentials.password || '';
	const hasCredentials = !!(username || password);

	const script = buildAutoLoginScript({
		username,
		password,
		shouldTrySkip: !hasCredentials,
		shouldAutoSubmit: !!(username && password)
	});

	const runAutoLogin = () => {
		webContents.executeJavaScript(script).catch(() => {});
		setTimeout(() => {
			webContents.executeJavaScript(script).catch(() => {});
		}, 700);
	};

	webContents.on('did-finish-load', runAutoLogin);
	webContents.on('did-navigate-in-page', runAutoLogin);
}

function createWindow() {
	// Antes de qualquer polling: aponta o services.js pro no gravado na config
	// (e religa o tunel, se ele estava ligado quando o app foi fechado).
	const node = applyActiveNode();
	if (node.tunnel && node.tunnel.enabled) startTunnel(node);

	mainWindow = new BaseWindow({
		autoHideMenuBar: true,
		width: 1400,
		height: 900,
		minWidth: 1024,
		minHeight: 600,
		show: false
	});

	mainView = new WebContentsView({
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.contentView.addChildView(mainView);

	updateViewBounds();

	attachWebContentsResilience(mainView, { label: 'interface', isMain: true });
	mainView.webContents.loadFile('index.html');

	mainView.webContents.on('did-finish-load', () => {
		updateViewBounds();
		mainWindow.show();
		startStatusPolling();
		startMemoryMonitor();
	});

	mainWindow.on('resize', updateViewBounds);
	
	mainWindow.on('close', (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			mainWindow.hide();
		}
	});
	
	mainWindow.on('closed', () => {
		mainWindow = null;
		tabs.clear();
		stopStatusPolling();
	});

	createTray(mainWindow, {
		getNodes,
		switchNode: (id) => { switchNode(id).catch(e => log.error('switchNode (tray):', e.message)); },
		openTerminal: openHostTerminal
	});
}

function startStatusPolling() {
	pollOnce();
	statusInterval = setInterval(pollOnce, 5000);
}

function stopStatusPolling() {
	if (statusInterval) {
		clearInterval(statusInterval);
		statusInterval = null;
	}
	if (memInterval) {
		clearInterval(memInterval);
		memInterval = null;
	}
}

async function pollOnce() {
	if (statusPolling) return;       // nao empilha ticks se o podman travar
	statusPolling = true;
	try {
		await sendServicesStatus();
	} catch (err) {
		log.warn('pollOnce falhou (ignorado):', err && err.message);
	} finally {
		statusPolling = false;
	}
}

async function sendServicesStatus() {
	if (!mainView) return;
	let status;
	try {
		status = await services.getAllServicesStatus();
	} catch (err) {
		log.warn('getAllServicesStatus falhou:', err && err.message);
		status = { containerRunning: false, services: {}, error: err && err.message };
	}
	if (mainView && mainView.webContents && !mainView.webContents.isDestroyed()) {
		mainView.webContents.send('services-status', status);
	}
	try { await updateTrayMenu(status); } catch (e) { log.warn('updateTrayMenu falhou:', e && e.message); }
	onStatusObserved(status);
}

// ---- Aviso / estado degradado na UI (nao-bloqueante) ----
function setStatusDegraded(text) {
	try {
		if (mainView && mainView.webContents && !mainView.webContents.isDestroyed()) {
			mainView.webContents.send('app-notice', { level: text ? 'warn' : 'ok', text: text || '' });
		}
	} catch { /* ignore */ }
}

// ---- Auto-recuperacao do container com backoff exponencial ----
const RECOVERY_BACKOFF = [5000, 15000, 30000, 60000];
function onStatusObserved(status) {
	if (status && status.containerRunning) {
		if (recoverState.tries !== 0) setStatusDegraded('');
		recoverState = { tries: 0, nextAt: 0, running: false };
		return;
	}
	// Em no remoto, "container parado" quase sempre quer dizer "Pi desligado
	// ou fora da rede". Tentar `podman --connection pi start` em loop nao
	// resolve nada e ainda gasta o timeout de cada ciclo de polling — avisa e
	// deixa o usuario decidir (ligar o Pi, voltar pro no local).
	if (services.isRemote()) {
		const node = services.getNode();
		setStatusDegraded(`No "${node.label}" inacessivel - Pi desligado, fora da rede ou sem a conexao podman configurada.`);
		return;
	}
	if (recoverState.running || Date.now() < recoverState.nextAt) return;
	attemptContainerRecovery();
}

async function attemptContainerRecovery() {
	recoverState.running = true;
	const n = recoverState.tries + 1;
	setStatusDegraded(`Servicos fora do ar - tentando reiniciar (tentativa ${n})...`);
	log.warn(`Auto-recuperacao do container: tentativa ${n}`);
	try {
		const ok = await services.startContainer();
		if (ok) {
			log.info('Container recuperado.');
			recoverState = { tries: 0, nextAt: 0, running: false };
			setStatusDegraded('');
			return;
		}
		throw new Error('startContainer retornou false');
	} catch (e) {
		log.warn('Recuperacao falhou:', e && e.message);
		const idx = Math.min(n - 1, RECOVERY_BACKOFF.length - 1);
		recoverState.tries = n;
		recoverState.nextAt = Date.now() + RECOVERY_BACKOFF[idx];
		setStatusDegraded(`Falha ao reiniciar. Nova tentativa em ${RECOVERY_BACKOFF[idx] / 1000}s.`);
	} finally {
		recoverState.running = false;
	}
}

// ---- Monitor de memoria (avisa antes de OOM do proprio app) ----
const MEM_WARN_MB = 1500;
function startMemoryMonitor() {
	if (memInterval) return;
	memInterval = setInterval(() => {
		try {
			const metrics = app.getAppMetrics();
			const totalMB = metrics.reduce((s, m) => s + ((m.memory && m.memory.workingSetSize) || 0), 0) / 1024;
			if (totalMB > MEM_WARN_MB && !memWarned) {
				memWarned = true;
				log.warn(`Uso de memoria alto (~${Math.round(totalMB)} MB).`);
				setStatusDegraded('Memoria alta - considere reiniciar o HeroDev.');
			} else if (totalMB < MEM_WARN_MB * 0.7) {
				memWarned = false;
			}
		} catch (e) {
			log.warn('Monitor de memoria:', e && e.message);
		}
	}, 30000);
}

const STATUS_BAR_HEIGHT = 40;

function updateViewBounds() {
	if (!mainWindow) return;
	const bounds = mainWindow.getContentBounds();
	const hasActiveTabs = tabs.size > 0;
	
	// mainView sempre com altura completa
	mainView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });

	// Tabs ficam entre a barra de abas e o status bar, POR CIMA da mainView
	tabs.forEach((tab) => {
		if (tab.view) {
			tab.view.setBounds({
				x: 0,
				y: TAB_BAR_HEIGHT,
				width: bounds.width,
				height: bounds.height - TAB_BAR_HEIGHT - STATUS_BAR_HEIGHT
			});
		}
	});
}

function createTab(tabId, url, title) {
	if (tabs.has(tabId)) {
		activateTab(tabId);
		return;
	}

	// Garantir que a aba Home existe primeiro
	ensureHomeTab();

	const tabView = new WebContentsView({
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	// Adicionar tab depois da mainView para ficar por cima
	mainWindow.contentView.addChildView(tabView);
	attachWebContentsResilience(tabView, { label: title, reloadUrl: url });
	setupAutoLogin(tabView.webContents, url, title);
	tabView.webContents.loadURL(url);
	tabView.setVisible(true);

	tabs.set(tabId, {
		id: tabId,
		url: url,
		title: title,
		view: tabView,
		isHome: false
	});

	activateTab(tabId);
	updateViewBounds();
	notifyTabsUpdate();
}

function activateTab(tabId) {
	tabs.forEach((tab, id) => {
		if (tab.view) {
			tab.view.setVisible(id === tabId);
		}
	});
	activeTabId = tabId;
	
	// Notificar frontend se está mostrando Home (para mostrar/esconder cards)
	const isHomeActive = tabId === HOME_TAB_ID;
	mainView.webContents.send('home-visibility', isHomeActive);
	
	notifyTabsUpdate();
}

function closeTab(tabId) {
	const tab = tabs.get(tabId);
	if (!tab) return;
	
	// Não permitir fechar a aba Home
	if (tab.isHome) return;

	mainWindow.contentView.removeChildView(tab.view);
	tab.view.webContents.close();
	tabs.delete(tabId);

	// Se só sobrou a Home, remover a Home também (voltar ao estado normal)
	if (tabs.size === 1 && tabs.has(HOME_TAB_ID)) {
		tabs.delete(HOME_TAB_ID);
		activeTabId = null;
		mainView.webContents.send('home-visibility', true);
	} else if (activeTabId === tabId) {
		// Ativar a primeira aba que não seja a que foi fechada
		for (const [id] of tabs) {
			if (id !== tabId) {
				activateTab(id);
				break;
			}
		}
	}

	updateViewBounds();
	notifyTabsUpdate();
}

function notifyTabsUpdate() {
	if (!mainView) return;
	const tabsList = Array.from(tabs.values()).map(t => ({
		id: t.id,
		title: t.title,
		url: t.url,
		active: t.id === activeTabId,
		closeable: !t.isHome
	}));
	mainView.webContents.send('tabs-updated', tabsList);
}

const HOME_TAB_ID = 'home';

function ensureHomeTab() {
	// Se não há abas, criar a aba Home primeiro
	if (tabs.size === 0) {
		tabs.set(HOME_TAB_ID, {
			id: HOME_TAB_ID,
			url: 'home',
			title: 'Home',
			view: null,  // Home usa a mainView
			isHome: true
		});
	}
}

// ============================================================
// Terminal do container no terminal do HOST
//
// Complementa o terminal embutido (ttyd, aberto como aba): funciona mesmo
// quando o ttyd nao esta na imagem, e da um shell de verdade com o histor./
// clipboard do terminal nativo. Respeita o no ativo — no no "Raspberry Pi" o
// `podman --connection pi exec -it` abre um shell DENTRO do container do Pi.
// ============================================================
function openHostTerminal() {
	const cmd = services.interactiveShellCommand();
	log.info(`Abrindo terminal do host: ${cmd}`);

	if (process.platform === 'darwin') {
		// Escape pro literal de string do AppleScript.
		const applescriptCmd = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		const useITerm = fs.existsSync('/Applications/iTerm.app');
		const script = useITerm
			? `tell application "iTerm"
					activate
					set newWindow to (create window with default profile)
					tell current session of newWindow to write text "${applescriptCmd}"
				end tell`
			: `tell application "Terminal"
					activate
					do script "${applescriptCmd}"
				end tell`;
		const proc = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
		proc.on('error', (e) => log.error('Falha ao abrir terminal do host:', e.message));
		proc.unref();
		return { success: true };
	}

	if (process.platform === 'win32') {
		const proc = spawn('cmd.exe', ['/c', 'start', 'HeroDev Terminal', 'cmd', '/k', cmd], {
			detached: true, stdio: 'ignore', windowsVerbatimArguments: true
		});
		proc.on('error', (e) => log.error('Falha ao abrir terminal do host:', e.message));
		proc.unref();
		return { success: true };
	}

	// Linux: tenta os emuladores mais comuns, na ordem.
	for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
		try {
			const proc = spawn(term, ['-e', 'bash', '-lc', `${cmd}; exec bash`], { detached: true, stdio: 'ignore' });
			proc.unref();
			return { success: true };
		} catch { /* tenta o proximo */ }
	}
	return { success: false, error: 'Nenhum emulador de terminal encontrado.' };
}

// ============================================================
// Tunel SSH pro Pi
//
// Reusa os scripts que ja existem no repo (_mac/mac_tunnel-herodev.sh,
// _win/win_tunnel-herodev.ps1). Achamos a raiz do repo subindo a partir do
// app: tanto em dev (volumes/workspace/herodev-desk) quanto empacotado
// (…/out/…/herodev-desk.app/Contents/Resources/app) ela esta acima.
// ============================================================
function findRepoRoot() {
	let dir = app.getAppPath();
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, 'herodev.conf')) && fs.existsSync(path.join(dir, '_mac'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function stopTunnel() {
	if (!tunnelProc) return;
	try {
		// detached: mata o grupo inteiro (o ssh/autossh filho junto).
		if (process.platform === 'win32') tunnelProc.kill();
		else process.kill(-tunnelProc.pid, 'SIGTERM');
		log.info('Tunel SSH encerrado.');
	} catch (e) {
		log.warn('Falha ao encerrar tunel:', e.message);
	}
	tunnelProc = null;
}

function startTunnel(node) {
	stopTunnel();
	const root = findRepoRoot();
	if (!root) return { success: false, error: 'Raiz do repo herodev-container nao encontrada a partir do app.' };

	const sshTarget = (node.tunnel && node.tunnel.sshTarget) || '';
	const script = process.platform === 'win32'
		? path.join(root, '_win', 'win_tunnel-herodev.ps1')
		: path.join(root, '_mac', 'mac_tunnel-herodev.sh');
	if (!fs.existsSync(script)) return { success: false, error: `Script de tunel nao encontrado: ${script}` };

	try {
		tunnelProc = process.platform === 'win32'
			? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PiHost', sshTarget],
				{ detached: true, stdio: 'ignore' })
			: spawn('bash', [script, sshTarget], { detached: true, stdio: 'ignore' });

		tunnelProc.on('error', (e) => {
			log.error('Tunel SSH falhou:', e.message);
			setStatusDegraded(`Tunel SSH falhou: ${e.message}`);
			tunnelProc = null;
		});
		tunnelProc.on('exit', (code) => {
			log.warn(`Tunel SSH saiu (codigo ${code}).`);
			tunnelProc = null;
		});
		tunnelProc.unref();
		log.info(`Tunel SSH iniciado pro ${sshTarget}.`);
		return { success: true };
	} catch (e) {
		tunnelProc = null;
		return { success: false, error: e.message };
	}
}

// Troca de no: fecha as abas (as URLs mudam de host), liga/desliga o tunel,
// aponta o services.js pra nova conexao e forca um ciclo de status.
async function switchNode(nodeId) {
	const nodes = getNodes();
	if (!nodes[nodeId]) return { success: false, error: `No desconhecido: ${nodeId}` };

	const config = loadConfig() || {};
	config.activeNode = nodeId;
	saveConfig(config);

	closeAllTabs();

	const node = applyActiveNode();
	if (node.tunnel && node.tunnel.enabled) startTunnel(node);
	else stopTunnel();

	setStatusDegraded('');
	recoverState = { tries: 0, nextAt: 0, running: false };
	notifyNodeChanged();
	await pollOnce();
	return { success: true, node };
}

function notifyNodeChanged() {
	if (!mainView || mainView.webContents.isDestroyed()) return;
	const node = getActiveNode();
	mainView.webContents.send('node-changed', {
		id: node.id,
		label: node.label,
		urlHost: activeUrlHost(),
		tunnel: node.tunnel || null
	});
}

function closeAllTabs() {
	const tabIds = Array.from(tabs.keys());
	tabIds.forEach(id => { if (id !== HOME_TAB_ID) closeTab(id); });
	if (tabs.size === 1 && tabs.has(HOME_TAB_ID)) {
		tabs.delete(HOME_TAB_ID);
		activeTabId = null;
		if (mainView && !mainView.webContents.isDestroyed()) {
			mainView.webContents.send('home-visibility', true);
		}
		notifyTabsUpdate();
	}
}

ipcMain.on('open-service', (event, { url, openType, serviceName }) => {
	url = resolveServiceUrl(url);
	const title = serviceName || getServiceNameFromUrl(url);

	if (openType === 'window') {
		const serviceWindow = new BaseWindow({
			width: 1920,
			height: 1080,
			minWidth: 1024,
			minHeight: 768,
			title: `HeroDev - ${title}`
		});
		const serviceView = new WebContentsView();
		serviceWindow.contentView.addChildView(serviceView);
			attachWebContentsResilience(serviceView, { label: title, reloadUrl: url });
		setupAutoLogin(serviceView.webContents, url, title);
		serviceView.webContents.loadURL(url);
		
		// Atualizar título quando a página carregar
		serviceView.webContents.on('page-title-updated', (e, pageTitle) => {
			serviceWindow.setTitle(`HeroDev - ${title}`);
		});
		
		serviceWindow.on('resize', () => {
			const bounds = serviceWindow.getContentBounds();
			serviceView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
		});
		const bounds = serviceWindow.getContentBounds();
		serviceView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
	} else if (openType === 'tab') {
		const tabId = `tab-${Date.now()}`;
		createTab(tabId, url, title);
	} else if (openType === 'browser') {
		shell.openExternal(url);
	}
});

// Helper para obter nome do serviço baseado na URL
function getServiceNameFromUrl(url) {
	try {
		const urlObj = new URL(url);
		const port = urlObj.port;
		const byPath = { phpmyadmin: 'phpMyAdmin', mailpit: 'Mailpit', terminal: 'Terminal' };
		const hit = Object.keys(byPath).find(p => urlObj.pathname.includes(p));
		const portToName = {
			'8080': hit ? byPath[hit] : 'localhost',
			'12777': 'VSCode',
			'8081': 'Arquivos',
			'8082': 'Mongo UI',
			'8083': 'NGINX',
			'9090': 'Prometheus',
			'3000': 'Grafana'
		};
		return portToName[port] || urlObj.hostname;
	} catch {
		return url;
	}
}

ipcMain.on('tab-activate', (event, tabId) => {
	activateTab(tabId);
});

ipcMain.on('tab-close', (event, tabId) => {
	closeTab(tabId);
});

ipcMain.on('tab-close-all', () => {
	closeAllTabs();
});

ipcMain.on('open-external', (event, url) => {
	shell.openExternal(resolveServiceUrl(url));
});

// ---- Nos, terminal e tunel ----
ipcMain.handle('get-nodes', async () => {
	return { nodes: getNodes(), activeNode: getActiveNodeId(), urlHost: activeUrlHost() };
});

ipcMain.handle('set-active-node', async (event, nodeId) => {
	try {
		return await switchNode(nodeId);
	} catch (error) {
		log.error('Falha ao trocar de no:', error.message);
		return { success: false, error: error.message };
	}
});

ipcMain.handle('open-terminal', async () => {
	try {
		return openHostTerminal();
	} catch (error) {
		log.error('open-terminal falhou:', error.message);
		return { success: false, error: error.message };
	}
});

ipcMain.handle('tunnel-toggle', async (event, enabled) => {
	const config = loadConfig() || {};
	const nodeId = getActiveNodeId();
	const node = (config.nodes || {})[nodeId];
	if (!node || !node.tunnel) {
		return { success: false, error: 'O no ativo nao tem tunel configurado.' };
	}

	node.tunnel.enabled = !!enabled;
	saveConfig(config);

	const result = enabled ? startTunnel({ ...node, id: nodeId }) : (stopTunnel(), { success: true });
	if (!result.success) {
		// Nao deixa a config mentir: se o tunel nao subiu, volta o flag.
		node.tunnel.enabled = false;
		saveConfig(config);
		return result;
	}

	closeAllTabs();
	notifyNodeChanged();
	await pollOnce();
	return { success: true, enabled: !!enabled };
});

ipcMain.handle('service-action', async (event, { service, action }) => {
	try {
		switch (action) {
			case 'start':
				await services.startService(service);
				break;
			case 'stop':
				await services.stopService(service);
				break;
			case 'restart':
				await services.restartService(service);
				break;
		}
		await sendServicesStatus();
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle('container-action', async (event, action) => {
	try {
		switch (action) {
			case 'start':
				await services.startContainer();
				break;
			case 'stop':
				await services.stopContainer();
				break;
			case 'restart':
				await services.restartContainer();
				break;
		}
		await sendServicesStatus();
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle('get-services-status', async () => {
	return services.getAllServicesStatus();
});

ipcMain.handle('get-service-logs', async (event, { service, lines }) => {
	return services.getServiceLogs(service, lines);
});

ipcMain.handle('get-container-info', async () => {
	return services.getContainerInfo();
});

ipcMain.handle('get-stack', async () => {
	return services.getStack();
});

// Config handlers
ipcMain.handle('get-config', async () => {
	return loadConfig();
});

ipcMain.handle('save-config', async (event, config) => {
	return saveConfig(config);
});

// DevTools toggle
ipcMain.on('toggle-devtools', (event) => {
	if (mainView && mainView.webContents) {
		mainView.webContents.toggleDevTools();
	}
});

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
	});

	app.whenReady().then(() => {
		createWindow();

		// Registrar atalho global para DevTools (Ctrl+Shift+I)
		globalShortcut.register('CommandOrControl+Shift+I', () => {
			if (mainView && mainView.webContents) {
				mainView.webContents.toggleDevTools();
			}
		});
	});
}

app.on('will-quit', () => {
	// Desregistrar todos os atalhos
	globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
	app.isQuitting = true;
	stopTunnel();
	destroyTray();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (!mainWindow) {
		createWindow();
	} else {
		mainWindow.show();
	}
});
