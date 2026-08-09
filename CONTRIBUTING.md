# Contribuindo para HeroDev Desktop

Obrigado pelo interesse em contribuir! Este projeto está em desenvolvimento ativo e toda ajuda é bem-vinda.

## Como Contribuir

### Reportando Bugs

Se você encontrou um bug:

1. Verifique se já não existe uma issue aberta sobre o problema
2. Crie uma nova issue incluindo:
   - Descrição clara do problema
   - Passos para reproduzir
   - Comportamento esperado vs. comportamento atual
   - Sistema operacional e versão do Electron
   - Screenshots, se aplicável

### Sugerindo Melhorias

Para sugerir novas funcionalidades ou melhorias:

1. Abra uma issue descrevendo:
   - O problema que você quer resolver
   - Sua solução proposta
   - Por que isso seria útil para outros usuários

### Pull Requests

1. **Fork** o repositório
2. **Clone** seu fork localmente
3. **Crie uma branch** para sua feature/correção:
   ```bash
   git checkout -b minha-contribuicao
   ```
4. **Faça suas mudanças** seguindo o estilo do código existente
5. **Teste** suas mudanças localmente
6. **Commit** suas mudanças com mensagens claras:
   ```bash
   git commit -m "Adiciona funcionalidade X"
   ```
7. **Push** para seu fork:
   ```bash
   git push origin minha-contribuicao
   ```
8. **Abra um Pull Request** descrevendo suas mudanças

### Diretrizes de Código

- Mantenha o código consistente com o estilo existente
- Comente código complexo quando necessário
- Teste suas mudanças antes de submeter
- Atualize a documentação se necessário

### Áreas que Precisam de Ajuda

- Melhorias de UI/UX
- Correção de bugs
- Suporte para outras plataformas
- Documentação e exemplos
- Testes automatizados
- Internacionalização

## Estrutura do Projeto

```
herodev-desk/
├── main.js          # Processo principal do Electron
├── preload.js       # Script de preload (bridge IPC)
├── services.js      # Gerenciamento de serviços Podman
├── tray.js          # Sistema de tray icon
├── app.js           # Lógica da interface (renderer)
├── index.html       # Interface principal
├── style.css        # Estilos
└── config.json      # Configurações padrão
```

## Processo de Build

### Desenvolvimento
```bash
npm install
npm start
```

### Build para produção
```bash
# Windows
npm run package:win

# macOS ARM64
npm run package:mac_arm64

# macOS Intel
npm run package:mac_x64
```

## Código de Conduta

Este projeto segue nosso [Código de Conduta](CODE_OF_CONDUCT.md). Ao participar, você concorda em manter um ambiente respeitoso e inclusivo.

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a Licença MIT.

## Dúvidas?

Se tiver dúvidas sobre como contribuir, sinta-se à vontade para abrir uma issue perguntando!

---

**Nota:** Como este projeto não oferece suporte oficial, o tempo de resposta pode variar. Agradecemos sua paciência e compreensão.
