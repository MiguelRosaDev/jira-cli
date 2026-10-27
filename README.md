# 🚀 Jira CLI (`jira-cli`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-success.svg)](package.json)

Ferramenta CLI & SDK genérica, agnóstica de tecnologia ou empresa, para interagir diretamente com as APIs REST (`/rest/api/2`) e Agile (`/rest/agile/1.0`) do **Jira** (compatível com **Jira Data Center / Server** e **Jira Cloud**).

- **Zero dependências externas**: Desenvolvida em Node.js ESM nativo com o `fetch` integrado.
- **Ficheiro de configuração único local**: Toda a configuração e chave pessoal ficam num único ficheiro (`jira.config.json`), protegido pelo `.gitignore` para nunca expor credenciais no Git.
- **Segurança integrada**: Scanner anti-segredos, transliteração Windows-1252 para Data Center e modo `--dry-run` para pré-visualização de alterações.

---

## 🔑 1. Onde Obter a Personal Key

A obtenção da chave depende da versão de Jira que utilizas:

### Opção A: Jira Data Center / Jira Server (Personal Access Token - PAT)
1. Abre o teu Jira no browser.
2. No canto superior direito, clica no teu **Avatar / Foto de Perfil** e seleciona **Profile** (*Perfil*).
3. No menu do teu perfil, clica em **Personal Access Tokens** (*Tokens de Acesso Pessoal*).
4. Clica no botão **Create token** (*Criar token*).
5. Atribui um nome (ex: `jira-cli`) e define o prazo de expiração pretendido.
6. Clica em **Create** e **copia imediatamente o token gerado** (o Jira só o exibe esta vez!).

### Opção B: Jira Cloud (`https://*.atlassian.net` — API Token)
1. Acede a: [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Clica no botão **Create API token**.
3. Dá uma etiqueta identificativa (ex: `jira-cli`) e clica em **Create**.
4. **Copia o token gerado**.

---

## ⚙️ 2. Onde Colocar a Chave no Ficheiro de Configuração

A ferramenta utiliza **apenas um único ficheiro**:
📂 `jira.config.json` (na raiz do projeto).

### Configuração rápida por comando:
```bash
# Para Jira Data Center / Server (PAT):
./jira.mjs init --url "https://jira.empresa.com" --key "O_TEU_TOKEN_AQUI"

# Para Jira Cloud (API Token + Email):
./jira.mjs init --url "https://empresa.atlassian.net" --email "teu.email@empresa.com" --key "O_TEU_TOKEN_AQUI"
```

### Ou copiando o template de exemplo:
```bash
cp jira.config.example.json jira.config.json
```
E editando os valores em `jira.config.json`:
```json
{
  "baseUrl": "https://jira.empresa.com",
  "personalKey": "COLA_AQUI_A_TUA_PERSONAL_KEY",
  "authType": "bearer",
  "email": "",
  "apiVersion": "2",
  "defaultProject": "PROJ",
  "defaultBoardId": null,
  "sanitizeWindows1252": true,
  "dryRun": false
}
```

* **`baseUrl`**: URL base da instância Jira.
* **`personalKey`**: O token que geraste no passo anterior.
* **`authType`**: `"bearer"` para Jira Data Center / Server (PAT), ou `"basic"` para Jira Cloud.
* **`email`**: O teu email (obrigatório apenas em Jira Cloud com `"authType": "basic"`).
* **`defaultProject`**: *(Opcional)* Chave de projeto por defeito (ex: `PROJ`) para evitar passar `--project` em todos os comandos.
* **`dryRun`**: Quando `true`, mostra o payload JSON sem efetuar qualquer escrita no Jira.

### Testar a ligação:
```bash
./jira.mjs whoami
```

---

## 📖 3. Guia de Comandos

> **Dica:** Podes executar diretamente com `./jira.mjs <comando>` ou criar um atalho global executando `npm link` para poderes usar simplesmente `jira <comando>` a partir de qualquer diretório.

### 1. Ler Boards e Sprints
```bash
# Listar boards disponíveis
./jira.mjs boards

# Filtrar boards por projeto ou nome
./jira.mjs boards --project PROJ --all
./jira.mjs boards --search "Backend"

# Listar sprints de uma board
./jira.mjs sprints <boardId>
./jira.mjs sprints <boardId> --state active

# Listar issues/stories de uma board ou sprint
./jira.mjs board-issues <boardId>
./jira.mjs sprint-issues <sprintId>
```

### 2. Ler e Pesquisar User Stories e Issues
```bash
# Ver detalhes completos de um card (descrição, critérios, subtarefas, links e comentários)
./jira.mjs get PROJ-123

# Listar cards atribuídos a ti que estão abertos
./jira.mjs my-issues

# Listar User Stories de um projeto ou épico
./jira.mjs stories --project PROJ
./jira.mjs stories --epic PROJ-10

# Pesquisa flexível com JQL
./jira.mjs search 'project = "PROJ" AND statusCategory != Done ORDER BY priority DESC'
```

### 3. Criar User Stories, Tarefas, Bugs e Épicos
```bash
# Criar uma User Story
./jira.mjs create \
  --project PROJ \
  --type "Story" \
  --summary "Autenticação OAuth2 com refresh tokens" \
  --description "Critérios de aceitação:\n- Validar tokens JWT\n- Endpoint /refresh"

# Criar associando a um Épico e a uma Sprint
./jira.mjs create \
  --project PROJ \
  --type "Story" \
  --summary "Paginação na API de listagem de utilizadores" \
  --priority "High" \
  --labels "api,performance" \
  --epic PROJ-10 \
  --sprint 45

# Criar um Épico (descobre automaticamente o custom field 'Epic Name' exigido pelo Jira)
./jira.mjs create-epic \
  --project PROJ \
  --summary "Refatoração do Módulo de Autenticação" \
  --epic-name "Auth v2" \
  --description "Iniciativa para modernizar a camada de autenticação."
```

### 4. Editar Cards, Atribuir e Workflow
```bash
# Atualizar resumo, descrição ou prioridade
./jira.mjs update PROJ-123 \
  --summary "Novo título da história" \
  --priority "High" \
  --add-label "backend"

# Atribuir card a ti próprio (--me) ou a outro colega
./jira.mjs assign PROJ-123 --me
./jira.mjs assign PROJ-123 outro.utilizador

# Associar o card a um Épico ou a uma Sprint
./jira.mjs move-to-epic PROJ-10 PROJ-123
./jira.mjs move-to-sprint 45 PROJ-123

# Ver as transições de workflow válidas a partir do estado atual
./jira.mjs transitions PROJ-123

# Mudar o estado do card
./jira.mjs transition PROJ-123 "In Progress"
./jira.mjs transition PROJ-123 "Done" --comment "Implementação concluída e validada."
```

### 5. Comentários, Worklogs e Links
```bash
# Listar todos os comentários
./jira.mjs comments PROJ-123

# Adicionar comentário
./jira.mjs comment PROJ-123 "Testes de carga executados com sucesso (p99 < 80ms)."

# Editar comentário existente
./jira.mjs edit-comment PROJ-123 <commentId> "Novo texto corrigido."

# Registar tempo despendido (worklog)
./jira.mjs worklog PROJ-123 "3h 30m" "Desenvolvimento de testes e refatoração"

# Ligar dois cards entre si
./jira.mjs link PROJ-123 PROJ-120 --type "Relates"

# Ver ou associar links remotos (páginas de documentação Confluence, repositórios, etc.)
./jira.mjs remote-links PROJ-123
./jira.mjs link-url PROJ-123 "https://wiki.empresa.com/doc/123" "Documentação Técnica da API"
```

---

## 💡 4. Funcionalidades de Produtividade

### 📊 Dashboard da Board / Sprint Ativa (`board-summary`)
Apresenta no terminal o estado geral da sprint ativa: barra de progresso, quantidade de cards por estado, distribuição de tarefas pela equipa e destaque para cards críticos:
```bash
./jira.mjs board-summary <boardId>
```

### 🎙️ Resumo para Daily Standup (`standup`)
Gera automaticamente o teu sumário diário:
- Cards fechados recentemente
- Cards em curso (*In Progress*)
- Próximos cards em fila (*To Do*)
```bash
./jira.mjs standup --days 2
```

### 📄 Exportar História para Markdown Técnico (`export-story`)
Exporta os dados de uma User Story (descrição, critérios, subtarefas, documentação e comentários) para Markdown com Checklist Técnica de Implementação:
```bash
./jira.mjs export-story PROJ-123 --output spec.md
```

### 🛡️ Proteções Integradas
* **Modo `--dry-run`**: Permite simular qualquer operação de escrita, mostrando o método HTTP e o payload JSON sem alterar dados no Jira.
* **Sanitização Windows-1252**: Translitera caracteres especiais (`→` para `->`, `✓` para `(/)`, `✗` para `(x)`) para prevenir problemas de codificação no Jira Data Center.
* **Scanner Anti-Segredos**: Bloqueia o envio de chaves privadas, certificados ou tokens em descrições e comentários.
* **Output `--json`**: Qualquer comando aceita `--json` para integração facilitada em scripts e pipelines CI/CD.

---

## 💻 5. Utilização Programática (Node.js SDK)

Também podes importar `JiraClient` em qualquer aplicação ou script Node.js:

```javascript
import { loadConfig, JiraClient } from './jira.mjs';

const config = loadConfig();
const jira = new JiraClient(config);

// Obter dados do utilizador autenticado
const me = await jira.getCurrentUser();
console.log(`Autenticado como: ${me.displayName}`);

// Pesquisar issues
const { issues } = await jira.searchIssues('assignee = currentUser() AND statusCategory != Done');
for (const issue of issues) {
  console.log(`- [${issue.key}] ${issue.fields.summary}`);
}
```

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
