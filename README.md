# HeroDev Desktop

> **Projeto em desenvolvimento** - Esta aplicação está em constante evolução e não é um produto final. Oferecida "como está", sem suporte oficial. Contribuições via pull request são bem-vindas!

Aplicação desktop Electron para gerenciamento do HeroDev Container. Fornece interface gráfica para controle de serviços, monitoramento de status em tempo real e acesso rápido aos recursos do ambiente de desenvolvimento.

## Índice

- [Visão geral](#visao-geral)
- [Requisitos](#requisitos)
- [Instalação](#instalacao)
- [Arquitetura](#arquitetura)
- [Arquivos do projeto](#arquivos-do-projeto)
- [Funcionalidades](#funcionalidades)
- [Interface](#interface)
- [API IPC](#api-ipc)
- [Serviços monitorados](#serviços-monitorados)
- [Configuração](#configuracao)
- [Desenvolvimento](#desenvolvimento)
- [Build](#build)
- [Uso](#uso)

---

## Visão geral

HeroDev Desktop é uma aplicação desktop construída com Electron que atua como painel de controle para o HeroDev Container. Permite gerenciar serviços, visualizar status em tempo real e acessar interfaces web de forma integrada através de um sistema de abas.

### Características principais

- Gerenciamento de container (start/stop/restart)
- Controle individual de serviços
- Monitoramento de status em tempo real (polling de 5 segundos)
- Sistema de abas para serviços web
- Tray icon com menu de contexto
- Temas claro e escuro
- Visualizador de logs
- Modal de configurações

---

## Requisitos

### Para execução
- Windows 10/11 (x64)
- Podman instalado e configurado
- Container HeroDev criado

### Para desenvolvimento
- Node.js 20.x ou superior
- npm 10.x ou superior
- Acesso ao container HeroDev para compilação

---

## Instalação

### Via script (recomendado)

Na pasta raiz do herodev-cont:

```cmd
setup-herodev-desk.bat
```

### Via linha de comando

1. Acesse o container:
```cmd
podman exec -it herodev bash
```

2. Navegue até a pasta:
```bash
cd /workspace/herodev-desk
```

3. Instale dependências:
```bash
npm install
```

4. Compile para Windows:
```bash
npm run package:win
```

Ou para macOS:
```bash
# macOS Apple Silicon (M1/M2/M3)
npm run package:mac_arm64

# macOS Intel
npm run package:mac_x64
```

5. O executável será gerado em:
```
# Windows
out/herodev-desk-win32-x64/herodev-desk.exe

# macOS ARM64
out/herodev-desk-darwin-arm64/herodev-desk.app

# macOS x64
out/herodev-desk-darwin-x64/herodev-desk.app
```

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐│
│  │   main.js   │  │  services.js │  │      tray.js        ││
│  │             │  │              │  │                     ││
│  │ - Window    │  │ - Podman CLI │  │ - System Tray       ││
│  │ - IPC       │  │ - Container  │  │ - Context Menu      ││
│  │ - Tabs      │  │ - Services   │  │ - Status Icon       ││
│  └─────────────┘  └──────────────┘  └─────────────────────┘│
└────────────────────────┬────────────────────────────────────┘
                         │ IPC (preload.js)
┌────────────────────────▼────────────────────────────────────┐
│                    Renderer Process                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                     index.html                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ││
│  │  │   app.js     │  │   style.css  │  │  Bootstrap   │  ││
│  │  │              │  │              │  │  FontAwesome │  ││
│  │  │ - UI Logic   │  │ - Themes     │  │              │  ││
│  │  │ - Handlers   │  │ - Layout     │  │              │  ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Arquivos do projeto

### main.js

Processo principal do Electron. Gerencia janela, abas e comunicação IPC.

**Responsabilidades:**
- Criação e gerenciamento da janela principal (BaseWindow)
- Sistema de abas (WebContentsView)
- Handlers IPC para comunicação com renderer
- Polling de status dos serviços (5 segundos)
- Gerenciamento de configurações
- Atalhos globais (Ctrl+Shift+I para DevTools)

**Constantes:**
```javascript
const TAB_BAR_HEIGHT = 42;      // Altura da barra de abas
const STATUS_BAR_HEIGHT = 40;   // Altura da barra de status
const CONFIG_PATH = path.join(__dirname, 'config.json');
```

**Funções principais:**

| Função | Descrição |
|--------|-----------|
| `createWindow()` | Cria janela principal e configura views |
| `createTab(tabId, url, title)` | Cria nova aba com WebContentsView |
| `activateTab(tabId)` | Ativa aba específica |
| `closeTab(tabId)` | Fecha aba (exceto Home) |
| `ensureHomeTab()` | Garante existência da aba Home |
| `updateViewBounds()` | Atualiza dimensões das views |
| `sendServicesStatus()` | Envia status para renderer |
| `loadConfig()` | Carrega configurações do arquivo |
| `saveConfig(config)` | Salva configurações no arquivo |

### services.js

Wrapper para comandos Podman e gerenciamento de serviços.

**Constantes:**
```javascript
const CONTAINER_NAME = 'herodev';

const SERVICES = {
    apache2: { name: 'Apache', port: 8080, hasUI: true },
    mariadb: { name: 'MariaDB', port: 3306, hasUI: false },
    'code-server': { name: 'VSCode', port: 12777, hasUI: true },
    filebrowser: { name: 'Arquivos', port: 8081, hasUI: true, optional: true },
    'redis-server': { name: 'Redis', port: 6379, hasUI: false, optional: true },
    mongod: { name: 'MongoDB', port: 27017, hasUI: false, optional: true },
    'mongo-express': { name: 'Mongo UI', port: 8082, hasUI: true, optional: true },
    nginx: { name: 'NGINX', port: 8083, hasUI: true, optional: true },
    prometheus: { name: 'Prometheus', port: 9090, hasUI: true, optional: true },
    'grafana-server': { name: 'Grafana', port: 3000, hasUI: true, optional: true }
};
```

**Funções exportadas:**

| Função | Parâmetros | Retorno | Descrição |
|--------|------------|---------|-----------|
| `isContainerRunning()` | - | boolean | Verifica se container está rodando |
| `getServiceStatus(serviceName)` | string | boolean | Verifica status de serviço |
| `getAllServicesStatus()` | - | object | Retorna status de todos serviços |
| `startService(serviceName)` | string | string | Inicia serviço |
| `stopService(serviceName)` | string | string | Para serviço |
| `restartService(serviceName)` | string | string | Reinicia serviço |
| `getServiceLogs(serviceName, lines)` | string, number | string | Obtém logs |
| `startContainer()` | - | boolean | Inicia container |
| `stopContainer()` | - | boolean | Para container |
| `restartContainer()` | - | boolean | Reinicia container |
| `getContainerInfo()` | - | object | Informações do container |
| `getHealthCheck()` | - | object | Status de saúde |

### preload.js

Script de preload que expõe APIs seguras para o renderer.

**API exposta (window.api):**

| Método | Tipo | Descrição |
|--------|------|-----------|
| `openService(url, openType, serviceName)` | send | Abre serviço (tab/window/browser) |
| `openExternal(url)` | send | Abre URL no navegador padrão |
| `tabActivate(tabId)` | send | Ativa aba |
| `tabClose(tabId)` | send | Fecha aba |
| `tabCloseAll()` | send | Fecha todas as abas |
| `onTabsUpdated(callback)` | listener | Listener para atualização de abas |
| `onHomeVisibility(callback)` | listener | Listener para visibilidade da Home |
| `serviceAction(service, action)` | invoke | Executa ação em serviço |
| `containerAction(action)` | invoke | Executa ação no container |
| `getServicesStatus()` | invoke | Obtém status dos serviços |
| `getServiceLogs(service, lines)` | invoke | Obtém logs de serviço |
| `getContainerInfo()` | invoke | Obtém info do container |
| `onServicesStatus(callback)` | listener | Listener para status |
| `getConfig()` | invoke | Obtém configurações |
| `saveConfig(config)` | invoke | Salva configurações |
| `toggleDevTools()` | send | Abre/fecha DevTools |

### app.js

Lógica da interface do usuário no renderer process.

**Variáveis globais:**
```javascript
let resourcesLoaded = false;  // Recursos DOM carregados
let imagesLoaded = false;     // Imagens carregadas
let currentStatus = {};       // Status atual dos servicos
let appConfig = null;         // Configuracoes da aplicacao
```

**Funções principais:**

| Função | Descrição |
|--------|-----------|
| `checkAndHideSplash()` | Esconde splash screen quando pronto |
| `initStatusListener()` | Inicializa listeners de status |
| `setHomeVisibility(isVisible)` | Controla visibilidade dos cards |
| `openService(url, openType, serviceName)` | Abre serviço |
| `serviceAction(service, action)` | Executa ação em serviço |
| `containerAction(action)` | Executa ação no container |
| `updateStatusBar(status)` | Atualiza barra de status |
| `showServiceLogs(service)` | Exibe modal de logs |
| `activateTab(tabId)` | Ativa aba |
| `closeTab(tabId, event)` | Fecha aba |
| `closeAllTabs()` | Fecha todas as abas |
| `renderTabs(tabs)` | Renderiza barra de abas |
| `loadConfig()` | Carrega configurações |
| `saveConfig(config)` | Salva configurações |
| `applyTheme(theme)` | Aplica tema (light/dark) |
| `openSettings()` | Abre modal de configurações |

### tray.js

Gerenciamento do ícone na bandeja do sistema.

**Funções exportadas:**

| Funcao | Descricao |
|--------|-----------|
| `createTray(window)` | Cria tray icon |
| `updateTrayMenu()` | Atualiza menu de contexto |
| `destroyTray()` | Remove tray icon |

**Menu de contexto:**
- Status do container
- Lista de serviços com submenu (Iniciar/Reiniciar/Parar)
- Abrir janela principal
- Sair da aplicação

### index.html

Interface HTML principal.

**Estrutura:**
```html
<!DOCTYPE html>
<html>
<head>
    <!-- Bootstrap CSS -->
    <!-- FontAwesome -->
    <!-- style.css -->
</head>
<body>
    <!-- Splash Screen -->
    <div id="splashScreen">...</div>
    
    <!-- Tab Bar -->
    <div id="tabBar">...</div>
    
    <!-- Cards Container (Home) -->
    <div id="cardsContainer">
        <!-- Service Cards -->
    </div>
    
    <!-- Status Bar -->
    <div id="statusBar">...</div>
    
    <!-- Scripts -->
</body>
</html>
```

### style.css

Estilos da aplicação incluindo temas.

**Classes de tema:**
```css
.theme-light { /* Tema claro */ }
.theme-dark { /* Tema escuro */ }
```

**Componentes estilizados:**
- Splash screen
- Tab bar
- Service cards
- Status bar
- Modals
- Dropdowns

### config.json

Arquivo de configuração da aplicação.

**Estrutura:**
```json
{
    "theme": "light",
    "startMinimized": false,
    "autoStart": false
}
```

### forge.config.js

Configuração do Electron Forge para build.

### package.json

Definição do projeto e dependências.

**Scripts:**
```json
{
    "start": "electron-forge start",
    "package": "electron-forge package",
    "package:win": "electron-forge package --platform=win32 --arch=x64",
    "make": "electron-forge make"
}
```

**Dependências:**
- electron: ^39.x
- bootstrap: ^5.3.x
- @fortawesome/fontawesome-free: ^7.x
- electron-squirrel-startup: ^1.x

---

## Funcionalidades

### Gerenciamento de container

**Ações disponíveis:**
- Iniciar container (`podman start herodev`)
- Parar container (`podman stop herodev`)
- Reiniciar container (`podman restart herodev`)

**Acesso:** Menu dropdown na barra de status ou tray icon.

### Gerenciamento de serviços

Cada serviço possui controles individuais:
- Iniciar (`systemctl start <service>`)
- Parar (`systemctl stop <service>`)
- Reiniciar (`systemctl restart <service>`)
- Ver logs (`journalctl -u <service>`)

**Acesso:** Menu dropdown de cada serviço na barra de status.

### Sistema de abas

- Aba Home (não fechável) exibe cards de serviços
- Abas de serviços web carregam URLs em WebContentsView
- Fechamento individual ou em lote
- Navegação entre abas

**Modos de abertura:**
- `tab`: Abre em nova aba dentro da aplicacao
- `window`: Abre em janela separada
- `browser`: Abre no navegador padrao do sistema

### Monitoramento em tempo real

- Polling de status a cada 5 segundos
- Atualização automática da interface
- Indicadores visuais de status (verde/vermelho)
- Tray icon muda cor conforme status

### Visualizador de logs

- Modal com logs do serviço selecionado
- Últimas 100 linhas por padrão
- Formatação de texto pré-formatado
- Scroll automático

### Configurações

**Opções disponíveis:**
- Tema (claro/escuro)
- Iniciar minimizado
- Iniciar com Windows (futuro)

---

## Interface

### Barra de abas (tab bar)

Localizada no topo da janela. Exibida quando há abas abertas.

| Elemento | Descrição |
|----------|-----------|
| Aba Home | Ícone de casa, sempre presente quando há abas |
| Abas de serviço | Título do serviço, botão de fechar |
| Botão fechar todas | Fecha todas as abas de uma vez |

### Área de conteúdo

- Home: grid de cards de serviços
- Abas: WebContentsView com conteúdo web

### Cards de serviços (home)

Cada card exibe:
- Ícone do serviço
- Nome do serviço
- Descrição
- Botões de ação (abrir em aba, nova janela, navegador)

### Barra de status

Localizada no rodapé da janela.

| Elemento | Descrição |
|----------|-----------|
| Botão configurações | Abre modal de configurações |
| Dropdown container | Status e ações do container |
| Dropdowns serviços | Status e ações de cada serviço |

### Tray icon

Ícone na bandeja do sistema.

| Estado | Cor |
|--------|-----|
| Container rodando | Verde |
| Container parado | Vermelho |

---

## API IPC

### Canais send (main <- renderer)

| Canal | Payload | Descrição |
|-------|---------|-----------|
| `open-service` | `{url, openType, serviceName}` | Abre serviço |
| `open-external` | `url` | Abre URL externa |
| `tab-activate` | `tabId` | Ativa aba |
| `tab-close` | `tabId` | Fecha aba |
| `tab-close-all` | - | Fecha todas abas |
| `toggle-devtools` | - | Toggle DevTools |

### Canais invoke (main <-> renderer)

| Canal | Payload | Retorno | Descrição |
|-------|---------|---------|-----------|
| `service-action` | `{service, action}` | `{success, error?}` | Ação em serviço |
| `container-action` | `action` | `{success, error?}` | Ação em container |
| `get-services-status` | - | `object` | Status dos serviços |
| `get-service-logs` | `{service, lines}` | `string` | Logs do serviço |
| `get-container-info` | - | `object` | Info do container |
| `get-config` | - | `object` | Configurações |
| `save-config` | `config` | `boolean` | Salvar configurações |

### Canais listen (main -> renderer)

| Canal | Payload | Descrição |
|-------|---------|-----------|
| `services-status` | `object` | Atualização de status |
| `tabs-updated` | `array` | Atualização de abas |
| `home-visibility` | `boolean` | Visibilidade da Home |

---

## Serviços monitorados

### Serviços core

| Serviço | Nome display | Porta | Interface web |
|---------|--------------|-------|---------------|
| apache2 | Apache | 8080 | Sim |
| mariadb | MariaDB | 3306 | Não |
| code-server | VSCode | 12777 | Sim |

### Serviços opcionais

| Serviço | Nome display | Porta | Interface web |
|---------|--------------|-------|---------------|
| filebrowser | Arquivos | 8081 | Sim |
| redis-server | Redis | 6379 | Não |
| mongod | MongoDB | 27017 | Não |
| mongo-express | Mongo UI | 8082 | Sim |
| nginx | NGINX | 8083 | Sim |
| prometheus | Prometheus | 9090 | Sim |
| grafana-server | Grafana | 3000 | Sim |

---

## Configuração

### config.json

```json
{
    "theme": "light",
    "startMinimized": false,
    "autoStart": false
}
```

| Propriedade | Tipo | Padrao | Descricao |
|-------------|------|--------|-----------|
| theme | string | "light" | Tema da interface (light/dark) |
| startMinimized | boolean | false | Iniciar minimizado na bandeja |
| autoStart | boolean | false | Iniciar com Windows |

### Alterando tema

Via interface:
1. Clique no ícone de engrenagem na barra de status
2. Selecione o tema desejado
3. Clique em salvar

Via arquivo:
1. Edite `config.json`
2. Altere o valor de `theme` para `"light"` ou `"dark"`
3. Reinicie a aplicação

---

## Desenvolvimento

### Ambiente de desenvolvimento

1. Acesse o container:
```cmd
podman exec -it herodev bash
```

2. Navegue até a pasta:
```bash
cd /workspace/herodev-desk
```

3. Instale dependências:
```bash
npm install
```

4. Execute em modo desenvolvimento:
```bash
npm start
```

### Estrutura de diretórios

```
herodev-desk/
├── main.js           # Processo principal
├── preload.js        # Bridge IPC
├── services.js       # Wrapper Podman
├── tray.js           # Tray icon
├── index.html        # Interface HTML
├── app.js            # Logica do renderer
├── style.css         # Estilos
├── config.json       # Configurações
├── package.json      # Dependências
├── forge.config.js   # Config Electron Forge
└── assets/
    └── icons/        # Ícones dos serviços
```

### Debug

- DevTools: `Ctrl+Shift+I`
- Logs do main process: console do terminal
- Logs do renderer: DevTools Console

---

## Build

### Build para Windows

```bash
npm run package:win
```

Gera executável em: `out/herodev-desk-win32-x64/herodev-desk.exe`

### Build genérico

```bash
npm run package
```

### Criar instalador

```bash
npm run make
```

---

## Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

**Oferecido "COMO ESTÁ"** sem garantias de qualquer tipo, expressas ou implícitas.

---

## Contribuindo

Contribuições são bem-vindas! Este projeto está em desenvolvimento ativo e não há suporte oficial, mas você pode:

- Reportar bugs abrindo uma issue
- Sugerir melhorias
- Fazer pull requests com correções ou novas funcionalidades
- Melhorar a documentação

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para mais detalhes.

---

## Uso

### Execução

Via arquivo executável:
```cmd
volumes\workspace\herodev-desk\out\herodev-desk-win32-x64\herodev-desk.exe
```

Via start-herodev.bat:
- Selecione "S" quando perguntado sobre GUI

### Fluxo de uso

1. Inicie a aplicação
2. Aguarde carregamento (splash screen)
3. Verifique status do container na barra de status
4. Inicie o container se necessário
5. Acesse serviços pelos cards ou barra de status
6. Gerencie abas conforme necessidade
7. Minimize para tray para continuar usando em segundo plano
