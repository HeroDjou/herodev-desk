// Config ÚNICA do Electron Forge.
//
// Ela morava duplicada: um bloco "config.forge" no package.json e este arquivo.
// O Forge lê o package.json PRIMEIRO e só cai neste arquivo se aquele não
// existir (@electron-forge/core, util/forge-config.js), então tudo daqui era
// ignorado em silêncio — inclusive o `asar: true` que o main.js comenta como
// se estivesse ativo. Agora o package.json não tem mais "config.forge" e este
// é o único lugar.
module.exports = {
  packagerConfig: {
    asar: true,
    appCopyright: 'Copyright © 2026 HeroDjou',
    appBundleId: 'com.herodjou.herodev-desk',
    appCategoryType: 'public.app-category.developer-tools',
    win32metadata: {
      CompanyName: 'HeroDjou',
      ProductName: 'HeroDev Desktop',
      FileDescription: 'HeroDev Desktop',
      OriginalFilename: 'herodev-desk.exe',
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Sem FusesPlugin de propósito: este pipeline empacota builds darwin/win32
    // NÃO assinadas de dentro do container Linux, e o fuse de integridade do
    // asar em app macOS sem assinatura é caminho conhecido pra "o app não
    // abre". Mexer nos fuses aqui exigiria assinar o bundle antes.
  ],
};
