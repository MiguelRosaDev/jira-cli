#!/usr/bin/env node
/**
 * Jira CLI & SDK Tool (Zero-Dependency, Node.js 18+)
 *
 * Connects to Jira Data Center / Server (Personal Access Token - Bearer)
 * or Jira Cloud (Email + API Token - Basic) using a local `.jira.config.json` file.
 *
 * Features:
 *  - Read Boards, Sprints, Epics, User Stories, Transitions, Comments & Remote Links
 *  - Create & Edit User Stories, Tasks, Bugs, Sub-tasks & Epics (auto-discovers Epic Name field)
 *  - Transition workflow statuses safely (validates available transitions first)
 *  - Add & Edit Comments with automatic Windows-1252 safe ASCII transliteration
 *  - Sprint & Board Health Dashboard (`board-summary`)
 *  - Automated Daily Standup Generator (`standup`)
 *  - Export User Story / Epic to Technical Markdown Spec (`export-story`)
 *  - Built-in Secret Scanner & `--dry-run` preview mode
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── ANSI Terminal Colors ────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  gray: isTTY ? '\x1b[90m' : '',
};

// ─── Windows-1252 Safe Transliteration & Secret Scanner ──────────────────────
const WIN1252_MAP = [
  [/→/g, '->'],
  [/←/g, '<-'],
  [/↔/g, '<->'],
  [/⇒/g, '=>'],
  [/⇐/g, '<='],
  [/✓|✔|✅/g, '(/)'],
  [/✗|✘|❌/g, '(x)'],
  [/⚠|⚠️/g, '(!)'],
  [/💡/g, '(on)'],
  [/⭐|★/g, '(*)'],
  [/•/g, '*'],
  [/—|–/g, '-'],
  [/“|”/g, '"'],
  [/‘|’/g, "'"],
  [/…/g, '...'],
];

export function sanitizeForJira(text, enabled = true) {
  if (!text || typeof text !== 'string' || !enabled) return text;
  let result = text;
  for (const [regex, replacement] of WIN1252_MAP) {
    result = result.replace(regex, replacement);
  }
  return result;
}

const SECRET_PATTERNS = [
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: 'Atlassian API Token', regex: /\bATATT3xFfGF0[A-Za-z0-9\-_+=]{20,}\b/ },
  { name: 'Generic Bearer/JWT Token', regex: /\bBearer\s+eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/ },
];

export function assertNoSecrets(text, allowSecrets = false) {
  if (!text || typeof text !== 'string' || allowSecrets) return;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(text)) {
      throw new Error(
        `[SEGURANÇA] Detetado possível segredo (${pattern.name}) no conteúdo a enviar para o Jira. Operação bloqueada.`
      );
    }
  }
}

// ─── Configuration Loader ────────────────────────────────────────────────────
export function findConfigPath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.JIRA_CONFIG_PATH) return path.resolve(process.env.JIRA_CONFIG_PATH);

  const candidates = [
    path.resolve(process.cwd(), 'jira.config.json'),
    path.resolve(__dirname, 'jira.config.json'),
    path.resolve(process.cwd(), '.jira.config.json'),
    path.resolve(__dirname, '.jira.config.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(process.cwd(), 'jira.config.json');
}

export function loadConfig(options = {}) {
  const configPath = findConfigPath(options.configPath);
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Erro ao ler ficheiro de configuração (${configPath}): ${err.message}`);
    }
  }

  const config = {
    configPath,
    baseUrl: (process.env.JIRA_BASE_URL || fileConfig.baseUrl || '').replace(/\/+$/, ''),
    personalKey: process.env.JIRA_PERSONAL_KEY || fileConfig.personalKey || '',
    authType: (process.env.JIRA_AUTH_TYPE || fileConfig.authType || '').toLowerCase(),
    email: process.env.JIRA_EMAIL || fileConfig.email || '',
    apiVersion: String(fileConfig.apiVersion || '2'),
    defaultProject: process.env.JIRA_DEFAULT_PROJECT || fileConfig.defaultProject || '',
    defaultBoardId: fileConfig.defaultBoardId || null,
    sanitizeWindows1252:
      fileConfig.sanitizeWindows1252 !== undefined ? Boolean(fileConfig.sanitizeWindows1252) : true,
    dryRun:
      options.dryRun !== undefined
        ? Boolean(options.dryRun)
        : process.env.JIRA_DRY_RUN === 'true' ||
          Boolean(fileConfig.dryRun),
    allowSecrets: Boolean(options.allowSecrets),
  };

  // Auto-detect authType if not explicitly set or if email is provided for Atlassian Cloud
  if (!config.authType) {
    config.authType = config.email ? 'basic' : 'bearer';
  } else if (config.authType === 'bearer' && config.email && config.baseUrl.includes('atlassian.net')) {
    config.authType = 'basic';
  }

  return config;
}

export function validateConfig(config) {
  if (!config.baseUrl || config.baseUrl === 'https://jira.example.com') {
    throw new Error(
      `Configuração incompleta: define o "baseUrl" no ficheiro de configuração:\n  -> ${config.configPath}\n` +
        `  ou executa: node tools/jira-cli/jira.mjs init --url https://jira.empresa.com --key <TUA_PERSONAL_KEY>`
    );
  }
  if (
    !config.personalKey ||
    config.personalKey === 'COLOCA_AQUI_A_TUA_PERSONAL_ACCESS_TOKEN'
  ) {
    throw new Error(
      `Personal Key em falta! Coloca a tua Personal Access Token no ficheiro:\n  -> ${config.configPath}\n` +
        `  Consulta o README.md para veres como obter a Personal Key no Jira.`
    );
  }
}

// ─── Jira REST & Agile Client ────────────────────────────────────────────────
export class JiraClient {
  constructor(config) {
    this.config = config;
  }

  getAuthHeader() {
    if (this.config.authType === 'basic') {
      if (!this.config.email) {
        throw new Error(
          'Para authType="basic" (Jira Cloud), tens de preencher o campo "email" em .jira.config.json.'
        );
      }
      const token = Buffer.from(`${this.config.email}:${this.config.personalKey}`).toString('base64');
      return `Basic ${token}`;
    }
    return `Bearer ${this.config.personalKey}`;
  }

  async request(method, endpoint, { query, body, isAgile = false } = {}) {
    validateConfig(this.config);

    const prefix = isAgile
      ? '/rest/agile/1.0'
      : endpoint.startsWith('/rest/')
      ? ''
      : `/rest/api/${this.config.apiVersion}`;

    const url = new URL(`${this.config.baseUrl}${prefix}${endpoint}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
    if (isWrite && this.config.dryRun) {
      return {
        __dryRun: true,
        method: method.toUpperCase(),
        url: url.toString(),
        payload: body || null,
      };
    }

    const headers = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method: method.toUpperCase(),
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const rawText = await response.text();
    const data = isJson && rawText ? JSON.parse(rawText) : rawText;

    if (!response.ok) {
      let detail = '';
      if (data && typeof data === 'object') {
        const errs = [
          ...(Array.isArray(data.errorMessages) ? data.errorMessages : []),
          ...(data.errors ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`) : []),
          ...(data.message ? [data.message] : []),
        ];
        detail = errs.join(' | ');
      } else if (typeof data === 'string') {
        detail = data.slice(0, 300);
      }

      if (response.status === 401) {
        throw new Error(
          `HTTP 401 Não Autorizado: Verifica se a tua Personal Key está correta e ativa em ${this.config.configPath}.`
        );
      }
      if (response.status === 403) {
        throw new Error(
          `HTTP 403 Acesso Negado: A tua conta/token não tem permissões para este recurso (${url.pathname}). ${detail}`
        );
      }
      if (response.status === 404) {
        throw new Error(
          `HTTP 404 Não Encontrado (ou sem visibilidade para o teu token): ${url.pathname}${detail ? ` — ${detail}` : ''}`
        );
      }
      throw new Error(`Erro Jira HTTP ${response.status} (${method} ${url.pathname}): ${detail || response.statusText}`);
    }

    return data;
  }

  // ── User & Server Info ──────────────────────────────────────────────────
  async getCurrentUser() {
    try {
      return await this.request('GET', '/myself');
    } catch {
      return await this.request('GET', '/rest/auth/1/session');
    }
  }

  async getServerInfo() {
    return await this.request('GET', '/serverInfo');
  }

  async searchUsers(query, maxResults = 20) {
    try {
      // Jira Data Center / Server v2 uses `username`, Cloud uses `query`
      return await this.request('GET', '/user/search', {
        query: { username: query, query, maxResults },
      });
    } catch {
      return await this.request('GET', '/user/search', {
        query: { query, maxResults },
      });
    }
  }

  // ── Projects, Issue Types & Create Metadata ─────────────────────────────
  async listProjects() {
    return await this.request('GET', '/project', { query: { expand: 'description,lead' } });
  }

  async getProject(projectKey) {
    return await this.request('GET', `/project/${encodeURIComponent(projectKey)}`);
  }

  async getProjectIssueTypes(projectKey) {
    const project = await this.getProject(projectKey);
    return project.issueTypes || [];
  }

  async getCreateFields(projectKey, issueTypeId) {
    try {
      // Jira 8.4+ / Data Center endpoint
      const res = await this.request(
        'GET',
        `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`
      );
      return res.values || res.fields || [];
    } catch {
      // Fallback to classic createmeta
      const res = await this.request('GET', '/issue/createmeta', {
        query: {
          projectKeys: projectKey,
          issuetypeIds: issueTypeId,
          expand: 'projects.issuetypes.fields',
        },
      });
      const proj = (res.projects || [])[0];
      const it = proj ? (proj.issuetypes || [])[0] : null;
      if (!it || !it.fields) return [];
      return Object.entries(it.fields).map(([fieldId, meta]) => ({
        fieldId,
        ...meta,
      }));
    }
  }

  async listAllFields() {
    return await this.request('GET', '/field');
  }

  async discoverEpicNameFieldId(projectKey) {
    // 1. Try createmeta for Epic issue type on this project
    try {
      const types = await this.getProjectIssueTypes(projectKey);
      const epicType = types.find((t) => t.name.toLowerCase() === 'epic' || t.name.toLowerCase() === 'épico');
      if (epicType) {
        const fields = await this.getCreateFields(projectKey, epicType.id);
        const epicNameField = fields.find(
          (f) =>
            (f.name && (f.name.toLowerCase() === 'epic name' || f.name.toLowerCase() === 'nome do épico')) ||
            (f.schema && f.schema.custom && f.schema.custom.includes('gh-epic-label'))
        );
        if (epicNameField) return epicNameField.fieldId || epicNameField.key;
      }
    } catch {
      // Ignore and try global fields
    }

    // 2. Fallback to /field global list
    const allFields = await this.listAllFields();
    const match = (allFields || []).find(
      (f) =>
        (f.name && (f.name.toLowerCase() === 'epic name' || f.name.toLowerCase() === 'nome do épico')) ||
        (f.schema && f.schema.custom && f.schema.custom.includes('gh-epic-label'))
    );
    return match ? match.id || match.key : null;
  }

  // ── Boards, Sprints & Epics (Agile API) ─────────────────────────────────
  async listBoards({ projectKeyOrId, type, name, startAt = 0, maxResults = 50, all = false } = {}) {
    const items = [];
    let currentStart = startAt;
    let total = null;
    let isLast = false;

    do {
      const res = await this.request('GET', '/board', {
        isAgile: true,
        query: {
          projectKeyOrId,
          type,
          name,
          startAt: currentStart,
          maxResults,
        },
      });
      const values = res.values || [];
      items.push(...values);
      total = res.total !== undefined ? res.total : null;
      isLast = Boolean(res.isLast) || values.length === 0 || (total !== null && items.length >= total);
      currentStart += values.length;
    } while (all && !isLast);

    return {
      values: items,
      total: total !== null ? total : items.length,
      truncated: !isLast,
    };
  }

  async listSprints(boardId, { state, startAt = 0, maxResults = 50, all = false } = {}) {
    const items = [];
    let currentStart = startAt;
    let isLast = false;

    do {
      const res = await this.request('GET', `/board/${encodeURIComponent(boardId)}/sprint`, {
        isAgile: true,
        query: { state, startAt: currentStart, maxResults },
      });
      const values = res.values || [];
      items.push(...values);
      isLast = Boolean(res.isLast) || values.length === 0;
      currentStart += values.length;
    } while (all && !isLast);

    return { values: items, truncated: !isLast };
  }

  async listEpics(boardId, { done, startAt = 0, maxResults = 50, all = false } = {}) {
    const items = [];
    let currentStart = startAt;
    let isLast = false;

    do {
      const res = await this.request('GET', `/board/${encodeURIComponent(boardId)}/epic`, {
        isAgile: true,
        query: { done, startAt: currentStart, maxResults },
      });
      const values = res.values || [];
      items.push(...values);
      isLast = Boolean(res.isLast) || values.length === 0;
      currentStart += values.length;
    } while (all && !isLast);

    return { values: items, truncated: !isLast };
  }

  async listBoardIssues(boardId, { jql, startAt = 0, maxResults = 50, fields, all = false } = {}) {
    const items = [];
    let currentStart = startAt;
    let total = 0;

    do {
      const res = await this.request('GET', `/board/${encodeURIComponent(boardId)}/issue`, {
        isAgile: true,
        query: {
          jql,
          startAt: currentStart,
          maxResults,
          fields: fields || 'summary,status,issuetype,priority,assignee,updated,created,labels,parent,customfield_10000',
        },
      });
      const issues = res.issues || [];
      items.push(...issues);
      total = res.total || items.length;
      currentStart += issues.length;
      if (issues.length === 0) break;
    } while (all && items.length < total);

    return {
      issues: items,
      total,
      truncated: items.length < total,
    };
  }

  async listSprintIssues(sprintId, { jql, startAt = 0, maxResults = 50, all = false } = {}) {
    const items = [];
    let currentStart = startAt;
    let total = 0;

    do {
      const res = await this.request('GET', `/sprint/${encodeURIComponent(sprintId)}/issue`, {
        isAgile: true,
        query: {
          jql,
          startAt: currentStart,
          maxResults,
        },
      });
      const issues = res.issues || [];
      items.push(...issues);
      total = res.total || items.length;
      currentStart += issues.length;
      if (issues.length === 0) break;
    } while (all && items.length < total);

    return {
      issues: items,
      total,
      truncated: items.length < total,
    };
  }

  // ── Issues & User Stories (Read & Search) ───────────────────────────────
  async getIssue(issueKey, { expand = 'renderedFields,names' } = {}) {
    return await this.request('GET', `/issue/${encodeURIComponent(issueKey)}`, {
      query: { expand },
    });
  }

  async getRemoteLinks(issueKey) {
    return await this.request('GET', `/issue/${encodeURIComponent(issueKey)}/remotelink`);
  }

  async searchIssues(jql, { startAt = 0, maxResults = 50, fields, all = false } = {}) {
    const defaultFields = [
      'summary',
      'status',
      'issuetype',
      'priority',
      'assignee',
      'reporter',
      'updated',
      'created',
      'labels',
      'parent',
    ];
    const fieldList = fields
      ? Array.isArray(fields)
        ? fields
        : String(fields).split(',').map((s) => s.trim())
      : defaultFields;

    const items = [];
    let currentStart = startAt;
    let total = 0;

    do {
      const res = await this.request('POST', '/search', {
        body: {
          jql,
          startAt: currentStart,
          maxResults,
          fields: fieldList,
        },
      });
      const issues = res.issues || [];
      items.push(...issues);
      total = res.total !== undefined ? res.total : items.length;
      currentStart += issues.length;
      if (issues.length === 0) break;
    } while (all && items.length < total);

    return {
      issues: items,
      total,
      truncated: items.length < total,
    };
  }

  // ── Create, Edit, Assign & Move Issues ──────────────────────────────────
  async createIssue({
    projectKey,
    issueTypeName = 'Story',
    summary,
    description,
    priority,
    labels,
    assignee,
    parentKey,
    epicKey,
    sprintId,
    additionalFields = {},
  }) {
    assertNoSecrets(summary, this.config.allowSecrets);
    assertNoSecrets(description, this.config.allowSecrets);

    const cleanSummary = sanitizeForJira(summary, this.config.sanitizeWindows1252);
    const cleanDescription = sanitizeForJira(description, this.config.sanitizeWindows1252);

    const fields = {
      project: { key: projectKey },
      issuetype: { name: issueTypeName },
      summary: cleanSummary,
      ...additionalFields,
    };

    if (cleanDescription !== undefined && cleanDescription !== '') {
      fields.description = cleanDescription;
    }
    if (priority) {
      fields.priority = { name: priority };
    }
    if (labels && labels.length > 0) {
      fields.labels = Array.isArray(labels) ? labels : String(labels).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (assignee) {
      fields.assignee = { name: assignee };
    }
    if (parentKey) {
      fields.parent = { key: parentKey };
    }

    const created = await this.request('POST', '/issue', { body: { fields } });

    if (created && !created.__dryRun && created.key) {
      if (epicKey) {
        await this.moveIssuesToEpic(epicKey, [created.key]);
      }
      if (sprintId) {
        await this.moveIssuesToSprint(sprintId, [created.key]);
      }
    }

    return created;
  }

  async createEpic({
    projectKey,
    summary,
    epicName,
    description,
    priority,
    labels,
    additionalFields = {},
  }) {
    const epicFieldId = await this.discoverEpicNameFieldId(projectKey);
    const extra = { ...additionalFields };
    if (epicFieldId) {
      extra[epicFieldId] = sanitizeForJira(epicName || summary, this.config.sanitizeWindows1252);
    }

    return await this.createIssue({
      projectKey,
      issueTypeName: 'Epic',
      summary,
      description,
      priority,
      labels,
      additionalFields: extra,
    });
  }

  async updateIssue(issueKey, { summary, description, priority, labels, addLabels, removeLabels, additionalFields = {} }) {
    assertNoSecrets(summary, this.config.allowSecrets);
    assertNoSecrets(description, this.config.allowSecrets);

    const fields = { ...additionalFields };
    const update = {};

    if (summary !== undefined) {
      fields.summary = sanitizeForJira(summary, this.config.sanitizeWindows1252);
    }
    if (description !== undefined) {
      fields.description = sanitizeForJira(description, this.config.sanitizeWindows1252);
    }
    if (priority !== undefined) {
      fields.priority = { name: priority };
    }
    if (labels !== undefined) {
      fields.labels = Array.isArray(labels) ? labels : String(labels).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (addLabels || removeLabels) {
      update.labels = [];
      if (addLabels) {
        const list = Array.isArray(addLabels) ? addLabels : String(addLabels).split(',').map((s) => s.trim());
        for (const l of list) if (l) update.labels.push({ add: l });
      }
      if (removeLabels) {
        const list = Array.isArray(removeLabels) ? removeLabels : String(removeLabels).split(',').map((s) => s.trim());
        for (const l of list) if (l) update.labels.push({ remove: l });
      }
    }

    const body = {};
    if (Object.keys(fields).length > 0) body.fields = fields;
    if (Object.keys(update).length > 0) body.update = update;

    return await this.request('PUT', `/issue/${encodeURIComponent(issueKey)}`, { body });
  }

  async assignIssue(issueKey, username) {
    // Pass null to unassign
    const body = username === null ? { name: null } : { name: username };
    return await this.request('PUT', `/issue/${encodeURIComponent(issueKey)}/assignee`, { body });
  }

  async moveIssuesToEpic(epicKey, issueKeys) {
    return await this.request('POST', `/epic/${encodeURIComponent(epicKey)}/issue`, {
      isAgile: true,
      body: { issues: issueKeys },
    });
  }

  async moveIssuesToSprint(sprintId, issueKeys) {
    return await this.request('POST', `/sprint/${encodeURIComponent(sprintId)}/issue`, {
      isAgile: true,
      body: { issues: issueKeys },
    });
  }

  // ── Workflow Transitions ────────────────────────────────────────────────
  async getTransitions(issueKey) {
    const res = await this.request('GET', `/issue/${encodeURIComponent(issueKey)}/transitions`, {
      query: { expand: 'transitions.fields' },
    });
    return res.transitions || [];
  }

  async transitionIssue(issueKey, transitionIdOrName, { comment, resolution } = {}) {
    const transitions = await this.getTransitions(issueKey);
    const target = String(transitionIdOrName).trim().toLowerCase();

    const matched = transitions.find(
      (t) =>
        String(t.id).toLowerCase() === target ||
        (t.name && t.name.toLowerCase() === target) ||
        (t.to && t.to.name && t.to.name.toLowerCase() === target)
    );

    if (!matched) {
      const available = transitions
        .map((t) => `[ID: ${t.id}] "${t.name}" -> Estado: "${t.to?.name || '?'}"`)
        .join('\n  - ');
      throw new Error(
        `Transição "${transitionIdOrName}" inválida para o estado atual de ${issueKey}.\n` +
          `Transições disponíveis neste momento:\n  - ${available || '(nenhuma transição disponível)'}`
      );
    }

    const body = { transition: { id: matched.id } };
    if (comment) {
      assertNoSecrets(comment, this.config.allowSecrets);
      body.update = {
        comment: [{ add: { body: sanitizeForJira(comment, this.config.sanitizeWindows1252) } }],
      };
    }
    if (resolution) {
      body.fields = { resolution: { name: resolution } };
    }

    const res = await this.request('POST', `/issue/${encodeURIComponent(issueKey)}/transitions`, { body });
    return { matchedTransition: matched, response: res };
  }

  // ── Comments ────────────────────────────────────────────────────────────
  async getComments(issueKey) {
    const res = await this.request('GET', `/issue/${encodeURIComponent(issueKey)}/comment`);
    return res.comments || [];
  }

  async addComment(issueKey, text) {
    assertNoSecrets(text, this.config.allowSecrets);
    const cleanBody = sanitizeForJira(text, this.config.sanitizeWindows1252);
    return await this.request('POST', `/issue/${encodeURIComponent(issueKey)}/comment`, {
      body: { body: cleanBody },
    });
  }

  async editComment(issueKey, commentId, text) {
    assertNoSecrets(text, this.config.allowSecrets);
    const cleanBody = sanitizeForJira(text, this.config.sanitizeWindows1252);
    return await this.request(
      'PUT',
      `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
      { body: { body: cleanBody } }
    );
  }

  // ── Worklogs & Issue Links ──────────────────────────────────────────────
  async addWorklog(issueKey, timeSpent, comment = '') {
    assertNoSecrets(comment, this.config.allowSecrets);
    const body = { timeSpent };
    if (comment) {
      body.comment = sanitizeForJira(comment, this.config.sanitizeWindows1252);
    }
    return await this.request('POST', `/issue/${encodeURIComponent(issueKey)}/worklog`, { body });
  }

  async getIssueLinkTypes() {
    const res = await this.request('GET', '/issueLinkType');
    return res.issueLinkTypes || [];
  }

  async linkIssues(inwardIssueKey, outwardIssueKey, linkTypeName = 'Relates', comment = '') {
    const types = await this.getIssueLinkTypes();
    const matched =
      types.find(
        (t) =>
          t.name.toLowerCase() === linkTypeName.toLowerCase() ||
          t.inward.toLowerCase() === linkTypeName.toLowerCase() ||
          t.outward.toLowerCase() === linkTypeName.toLowerCase()
      ) || types[0];

    if (!matched) {
      throw new Error('Não foram encontrados tipos de link de issues nesta instância Jira.');
    }

    const body = {
      type: { name: matched.name },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey },
    };
    if (comment) {
      body.comment = { body: sanitizeForJira(comment, this.config.sanitizeWindows1252) };
    }
    return await this.request('POST', '/issueLink', { body });
  }

  async addRemoteLink(issueKey, url, title, summary = '') {
    const body = {
      object: {
        url,
        title,
        summary: sanitizeForJira(summary, this.config.sanitizeWindows1252),
      },
    };
    return await this.request('POST', `/issue/${encodeURIComponent(issueKey)}/remotelink`, { body });
  }
}

// ─── CLI Argument Parser ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          if (flags[key] !== undefined) {
            flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
          } else {
            flags[key] = next;
          }
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-h') {
      flags.help = true;
    } else if (arg === '-j') {
      flags.json = true;
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] || 'help', args: positional.slice(1), flags };
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────
function pad(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len - 1) + '…' : s + ' '.repeat(len - s.length);
}

function statusBadge(statusObj) {
  if (!statusObj) return '-';
  const name = statusObj.name || '-';
  const catKey = statusObj.statusCategory?.key || '';
  if (catKey === 'done') return `${c.green}${name}${c.reset}`;
  if (catKey === 'indeterminate') return `${c.yellow}${name}${c.reset}`;
  return `${c.cyan}${name}${c.reset}`;
}

function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log(`${c.dim}(Sem resultados)${c.reset}`);
    return;
  }
  const widths = headers.map((h, idx) => {
    const maxRow = Math.max(...rows.map((r) => String(r[idx] ?? '').replace(/\x1b\[[0-9;]*m/g, '').length));
    return Math.min(Math.max(h.length, maxRow) + 2, 62);
  });

  const headerLine = headers.map((h, i) => `${c.bold}${pad(h, widths[i])}${c.reset}`).join(' ');
  const sepLine = widths.map((w) => '─'.repeat(w)).join('─');
  console.log(headerLine);
  console.log(`${c.gray}${sepLine}${c.reset}`);

  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const raw = String(cell ?? '');
        const plain = raw.replace(/\x1b\[[0-9;]*m/g, '');
        if (plain.length >= widths[i]) {
          return plain.slice(0, widths[i] - 1) + '…';
        }
        return raw + ' '.repeat(widths[i] - plain.length);
      })
      .join(' ');
    console.log(line);
  }
}

function printIssuesTable(issues, total, truncated) {
  const rows = issues.map((issue) => {
    const f = issue.fields || {};
    const type = f.issuetype?.name || '-';
    const status = statusBadge(f.status);
    const priority = f.priority?.name || '-';
    const assignee = f.assignee?.displayName || f.assignee?.name || 'Não atribuído';
    const summary = f.summary || '';
    return [`${c.bold}${issue.key}${c.reset}`, type, status, priority, assignee, summary];
  });

  printTable(['KEY', 'TIPO', 'ESTADO', 'PRIORIDADE', 'ASSIGNEE', 'RESUMO'], rows);
  console.log(
    `\n${c.dim}Mostrando ${issues.length} de ${total ?? issues.length} item(s).${
      truncated ? ' (Resultados truncados — usa --all para listar todas as páginas)' : ''
    }${c.reset}`
  );
}

function printDryRunIfApplicable(res) {
  if (res && res.__dryRun) {
    console.log(`\n${c.yellow}${c.bold}[DRY-RUN ATIVO]${c.reset} Nenhum dado foi enviado para o Jira.`);
    console.log(`${c.bold}Método:${c.reset} ${res.method}`);
    console.log(`${c.bold}Endpoint:${c.reset} ${res.url}`);
    console.log(`${c.bold}Payload JSON:${c.reset}\n${JSON.stringify(res.payload, null, 2)}`);
    return true;
  }
  return false;
}

function renderProgressBar(percent, width = 24) {
  const filled = Math.round((percent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${c.green}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset} ${c.bold}${percent}%${c.reset}`;
}

// ─── Help Menu ───────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold}${c.cyan}🚀 Jira CLI & SDK Tool${c.reset} — Liga-te ao Jira (Data Center / Server / Cloud)

${c.bold}CONFIGURAÇÃO & DIAGNÓSTICO:${c.reset}
  ${c.green}init${c.reset} --url <url> --key <pat> [--project <key>] [--board <id>] [--email <email>]
      Configura ou atualiza o ficheiro local ${c.bold}.jira.config.json${c.reset} (ignorado pelo Git).
  ${c.green}whoami${c.reset}
      Testa a ligação e mostra o utilizador autenticado e detalhes do servidor Jira.
  ${c.green}projects${c.reset} [--search <texto>]
      Lista os projetos Jira visíveis para o teu token.
  ${c.green}issue-types${c.reset} [--project <key>]
      Lista os tipos de issue reais do projeto (ex: Epic, Story, Task, Bug, Sub-task, Defect-PRD).
  ${c.green}fields${c.reset} [--project <key>] --type <typeIdOrName>
      Lista os campos obrigatórios e opcionais na criação de um tipo de issue num projeto.

${c.bold}BOARDS, SPRINTS & EPICS (AGILE):${c.reset}
  ${c.green}boards${c.reset} [--project <key>] [--type scrum|kanban] [--search <nome>] [--all]
      Lista as boards disponíveis.
  ${c.green}board-summary${c.reset} [boardId]
      ${c.magenta}★ Dashboard visual da Board / Sprint Ativa${c.reset} (barra de progresso, estados, carga por pessoa).
  ${c.green}board-issues${c.reset} [boardId] [--jql <filtro>] [--all]
      Lista as User Stories / Issues de uma board.
  ${c.green}sprints${c.reset} [boardId] [--state active,future,closed] [--all]
      Lista as sprints de uma board.
  ${c.green}sprint-issues${c.reset} <sprintId> [--all]
      Lista as User Stories / Issues de uma sprint específica.
  ${c.green}epics${c.reset} [boardId] [--only-open] [--all]
      Lista os épicos de uma board.

${c.bold}LER & PESQUISAR USER STORIES / ISSUES:${c.reset}
  ${c.green}get${c.reset} <issueKey>
      Mostra todos os detalhes da User Story / Issue (descrição, critérios, subtarefas, links Confluence e comentários).
  ${c.green}stories${c.reset} [--project <key>] [--epic <epicKey>] [--status <estado>] [--assignee <user>] [--all]
      Lista User Stories (ou issues abertas) de um projeto ou épico.
  ${c.green}my-issues${c.reset} [--project <key>] [--include-done]
      Lista todos os cards atribuídos a ti que ainda não estão concluídos.
  ${c.green}search${c.reset} "<JQL>" [--fields f1,f2] [--all]
      Executa uma pesquisa JQL personalizada.

${c.bold}CRIAR, EDITAR, TRANSIÇÕES & COMENTÁRIOS:${c.reset}
  ${c.green}create${c.reset} --summary "<título>" [--project <key>] [--type Story] [--description "<texto>"]
         [--priority <nome>] [--labels l1,l2] [--assignee <user>] [--epic <epicKey>] [--sprint <id>]
      Cria uma User Story, Task, Bug ou Sub-task e associa opcionalmente a Épico e Sprint.
  ${c.green}create-epic${c.reset} --summary "<título>" [--epic-name "<nome curto>"] [--project <key>] [--description "<texto>"]
      Cria um Épico descobrindo automaticamente o campo obrigatório "Epic Name" da instância.
  ${c.green}update${c.reset} <issueKey> [--summary "<novo>"] [--description "<nova>"] [--priority <p>]
         [--add-label <l>] [--remove-label <l>] [--epic <epicKey>] [--sprint <id>]
      Edita uma User Story / Issue existente.
  ${c.green}assign${c.reset} <issueKey> <username | --me | --unassign>
      Atribui ou desatribui um card.
  ${c.green}transitions${c.reset} <issueKey>
      Lista as transições de workflow disponíveis a partir do estado atual do card.
  ${c.green}transition${c.reset} <issueKey> "<idOuNomeTransição>" [--comment "<nota>"] [--resolution "<res>"]
      Move o card para um novo estado (ex: "In Progress", "Done").
  ${c.green}comments${c.reset} <issueKey>
      Lista todos os comentários do card.
  ${c.green}comment${c.reset} <issueKey> "<texto do comentário>"
      Adiciona um comentário ao card (com conversão segura Windows-1252).
  ${c.green}edit-comment${c.reset} <issueKey> <commentId> "<novo texto>"
      Edita um comentário existente.

${c.bold}PRODUTIVIDADE & ESPECIFICAÇÕES TÉCNICAS:${c.reset}
  ${c.green}standup${c.reset} [--days 2] [--project <key>]
      ${c.magenta}★ Gera o teu resumo de Daily Standup${c.reset} (O que fizeste recentemente, O que está In Progress, Bloqueios).
  ${c.green}export-story${c.reset} <issueKey> [--output <ficheiro.md>]
      ${c.magenta}★ Exporta uma User Story ou Épico para Markdown${c.reset} com Checklist Técnica de Implementação pronta para Dev/AI.
  ${c.green}worklog${c.reset} <issueKey> "<tempo>" ["<comentário>"]
      Regista tempo trabalhado no card (ex: "2h 30m").
  ${c.green}link${c.reset} <issueKey> <targetIssueKey> [--type Relates]
      Cria relação entre dois cards (ex: Blocks, Relates).
  ${c.green}remote-links${c.reset} <issueKey>
      Lista páginas Confluence e links externos associados ao card.
  ${c.green}link-url${c.reset} <issueKey> "<url>" "<título>"
      Associa um link externo ou página Confluence ao card.

${c.bold}FLAGS GLOBAIS:${c.reset}
  ${c.yellow}--dry-run${c.reset}       Simula operações de escrita mostrando o payload JSON sem enviar para o Jira.
  ${c.yellow}--json${c.reset}          Devolve o resultado em formato JSON puro (ideal para scripts e agentes AI).
  ${c.yellow}--config <path>${c.reset} Usa um ficheiro de configuração específico.
`);
}

// ─── CLI Command Execution ───────────────────────────────────────────────────
async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || flags.help) {
    printHelp();
    return;
  }

  // Handle `init` before validating existing config
  if (command === 'init') {
    const targetPath = findConfigPath(flags.config);
    let existing = {};
    if (fs.existsSync(targetPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      } catch {
        existing = {};
      }
    }

    const updated = {
      baseUrl: flags.url || existing.baseUrl || 'https://jira.example.com',
      personalKey: flags.key || existing.personalKey || 'COLOCA_AQUI_A_TUA_PERSONAL_ACCESS_TOKEN',
      authType: flags['auth-type'] || (flags.email ? 'basic' : existing.authType || 'bearer'),
      email: flags.email !== undefined ? flags.email : existing.email || '',
      apiVersion: flags['api-version'] || existing.apiVersion || '2',
      defaultProject: flags.project !== undefined ? flags.project : existing.defaultProject || '',
      defaultBoardId: flags.board !== undefined ? Number(flags.board) : existing.defaultBoardId || null,
      sanitizeWindows1252:
        flags.sanitize !== undefined ? flags.sanitize !== 'false' : existing.sanitizeWindows1252 ?? true,
      dryRun: flags['dry-run'] ? true : existing.dryRun ?? false,
    };

    fs.writeFileSync(targetPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    console.log(`${c.green}✔ Configuração guardada com sucesso em:${c.reset} ${targetPath}`);
    console.log(`${c.dim}(Este ficheiro está protegido no .gitignore para nunca expor a tua Personal Key)${c.reset}`);
    return;
  }

  const config = loadConfig({
    configPath: flags.config,
    dryRun: flags['dry-run'],
    allowSecrets: flags['allow-secrets'],
  });
  const client = new JiraClient(config);

  switch (command) {
    // ── 1. WHOAMI ─────────────────────────────────────────────────────────
    case 'whoami':
    case 'me': {
      const user = await client.getCurrentUser();
      let server = null;
      try {
        server = await client.getServerInfo();
      } catch {
        // Optional
      }

      if (flags.json) {
        console.log(JSON.stringify({ user, server }, null, 2));
        return;
      }

      console.log(`\n${c.green}${c.bold}✔ Ligação ao Jira estabelecida com sucesso!${c.reset}`);
      console.log(`  ${c.bold}Servidor:${c.reset}       ${server?.serverTitle || config.baseUrl} (${config.baseUrl})`);
      if (server?.version) {
        console.log(`  ${c.bold}Versão Jira:${c.reset}    ${server.version} (${server.deploymentType || 'Server/DC'})`);
      }
      console.log(`  ${c.bold}Utilizador:${c.reset}     ${user.displayName || user.name || '-'}`);
      console.log(`  ${c.bold}Username/Key:${c.reset}   ${user.name || user.accountId || '-'}`);
      console.log(`  ${c.bold}Email:${c.reset}          ${user.emailAddress || '-'}`);
      console.log(`  ${c.bold}Autenticação:${c.reset}   ${config.authType.toUpperCase()}`);
      console.log(`  ${c.bold}Config Local:${c.reset}   ${config.configPath}`);

      const lowerName = `${user.displayName || ''} ${user.name || ''}`.toLowerCase();
      if (lowerName.includes('service') || lowerName.includes('bot') || lowerName.includes('integration')) {
        console.log(
          `\n  ${c.yellow}⚠️ Nota:${c.reset} O token parece pertencer a uma conta de serviço (${user.displayName}).`
        );
      }
      break;
    }

    // ── 2. PROJECTS ───────────────────────────────────────────────────────
    case 'projects': {
      let projects = await client.listProjects();
      if (flags.search) {
        const q = String(flags.search).toLowerCase();
        projects = projects.filter(
          (p) =>
            p.key.toLowerCase().includes(q) ||
            (p.name && p.name.toLowerCase().includes(q))
        );
      }

      if (flags.json) {
        console.log(JSON.stringify(projects, null, 2));
        return;
      }

      const rows = projects.map((p) => [
        `${c.bold}${p.key}${c.reset}`,
        p.name || '-',
        p.lead?.displayName || p.lead?.name || '-',
        p.projectTypeKey || '-',
      ]);
      printTable(['KEY', 'NOME DO PROJETO', 'LEAD', 'TIPO'], rows);
      console.log(`\n${c.dim}Total: ${projects.length} projeto(s) visíveis para o teu token.${c.reset}`);
      break;
    }

    // ── 3. ISSUE TYPES & CREATE FIELDS ────────────────────────────────────
    case 'issue-types':
    case 'types': {
      const projectKey = flags.project || args[0] || config.defaultProject;
      if (!projectKey) {
        throw new Error('Indica o projeto com --project <KEY> (ex: node jira.mjs issue-types --project PROJ)');
      }
      const types = await client.getProjectIssueTypes(projectKey);
      if (flags.json) {
        console.log(JSON.stringify(types, null, 2));
        return;
      }

      console.log(`\n${c.bold}Tipos de Issue disponíveis no projeto ${c.cyan}${projectKey}${c.reset}:\n`);
      const rows = types.map((t) => [
        t.id,
        `${c.bold}${t.name}${c.reset}`,
        t.subtask ? 'Sub-task' : 'Standard',
        t.description || '-',
      ]);
      printTable(['ID', 'NOME EXATO', 'CATEGORIA', 'DESCRIÇÃO'], rows);
      break;
    }

    case 'fields':
    case 'create-fields': {
      const projectKey = flags.project || config.defaultProject;
      const typeArg = flags.type || args[0];
      if (!projectKey || !typeArg) {
        throw new Error(
          'Indica o projeto e o tipo de issue: node jira.mjs fields --project <KEY> --type <NomeOuID>'
        );
      }

      const types = await client.getProjectIssueTypes(projectKey);
      const matchedType = types.find(
        (t) => String(t.id) === String(typeArg) || t.name.toLowerCase() === String(typeArg).toLowerCase()
      );
      if (!matchedType) {
        throw new Error(
          `Tipo "${typeArg}" não encontrado em ${projectKey}. Tipos válidos: ${types.map((t) => t.name).join(', ')}`
        );
      }

      const fields = await client.getCreateFields(projectKey, matchedType.id);
      if (flags.json) {
        console.log(JSON.stringify(fields, null, 2));
        return;
      }

      console.log(
        `\n${c.bold}Campos de criação para ${c.cyan}${projectKey}${c.reset} / ${c.bold}${matchedType.name}${c.reset} (ID ${matchedType.id}):\n`
      );
      const rows = fields.map((f) => [
        `${c.bold}${f.fieldId || f.key}${c.reset}`,
        f.name || '-',
        f.required ? `${c.red}OBRIGATÓRIO${c.reset}` : 'Opcional',
        f.schema?.type || '-',
      ]);
      printTable(['FIELD ID', 'NOME', 'OBRIGATORIEDADE', 'TIPO DE DADOS'], rows);
      break;
    }

    // ── 4. BOARDS, SPRINTS & EPICS ────────────────────────────────────────
    case 'boards': {
      const res = await client.listBoards({
        projectKeyOrId: flags.project || config.defaultProject || undefined,
        type: flags.type,
        name: flags.search || flags.name,
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const rows = res.values.map((b) => [
        `${c.bold}${b.id}${c.reset}`,
        b.name || '-',
        b.type || '-',
        b.location?.projectKey || b.location?.displayName || '-',
      ]);
      printTable(['BOARD ID', 'NOME DA BOARD', 'TIPO', 'PROJETO / LOCALIZAÇÃO'], rows);
      console.log(
        `\n${c.dim}Mostrando ${res.values.length} de ${res.total} board(s).${
          res.truncated ? ' (Usa --all para percorrer todas as páginas)' : ''
        }${c.reset}`
      );
      break;
    }

    case 'sprints': {
      const boardId = args[0] || flags.board || config.defaultBoardId;
      if (!boardId) {
        throw new Error('Indica o ID da board: node jira.mjs sprints <boardId>');
      }
      const res = await client.listSprints(boardId, {
        state: flags.state,
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const rows = res.values.map((s) => [
        `${c.bold}${s.id}${c.reset}`,
        s.name || '-',
        s.state === 'active'
          ? `${c.green}ACTIVE${c.reset}`
          : s.state === 'future'
          ? `${c.cyan}FUTURE${c.reset}`
          : `${c.gray}${s.state}${c.reset}`,
        s.startDate ? s.startDate.slice(0, 10) : '-',
        s.endDate ? s.endDate.slice(0, 10) : '-',
        s.goal || '-',
      ]);
      printTable(['SPRINT ID', 'NOME', 'ESTADO', 'INÍCIO', 'FIM', 'OBJETIVO (GOAL)'], rows);
      break;
    }

    case 'epics': {
      const boardId = args[0] || flags.board || config.defaultBoardId;
      if (!boardId) {
        throw new Error('Indica o ID da board: node jira.mjs epics <boardId>');
      }
      const res = await client.listEpics(boardId, {
        done: flags['only-open'] ? 'false' : undefined,
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const rows = res.values.map((e) => [
        `${c.bold}${e.key}${c.reset}`,
        e.name || '-',
        e.done ? `${c.green}Concluído${c.reset}` : `${c.yellow}Aberto${c.reset}`,
        e.summary || '-',
      ]);
      printTable(['EPIC KEY', 'EPIC NAME', 'ESTADO', 'RESUMO'], rows);
      break;
    }

    case 'board-issues': {
      const boardId = args[0] || flags.board || config.defaultBoardId;
      if (!boardId) {
        throw new Error('Indica o ID da board: node jira.mjs board-issues <boardId>');
      }
      const res = await client.listBoardIssues(boardId, {
        jql: flags.jql,
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      printIssuesTable(res.issues, res.total, res.truncated);
      break;
    }

    case 'sprint-issues': {
      const sprintId = args[0] || flags.sprint;
      if (!sprintId) {
        throw new Error('Indica o ID da sprint: node jira.mjs sprint-issues <sprintId>');
      }
      const res = await client.listSprintIssues(sprintId, {
        jql: flags.jql,
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      printIssuesTable(res.issues, res.total, res.truncated);
      break;
    }

    // ── 5. BOARD / SPRINT HEALTH DASHBOARD ────────────────────────────────
    case 'board-summary': {
      const boardId = args[0] || flags.board || config.defaultBoardId;
      if (!boardId) {
        throw new Error('Indica o ID da board: node jira.mjs board-summary <boardId>');
      }

      let activeSprint = null;
      let issues = [];
      try {
        const sprints = await client.listSprints(boardId, { state: 'active' });
        activeSprint = (sprints.values || [])[0] || null;
      } catch {
        // Kanban boards may not have sprints
      }

      if (activeSprint) {
        const res = await client.listSprintIssues(activeSprint.id, { all: true });
        issues = res.issues;
      } else {
        const res = await client.listBoardIssues(boardId, {
          jql: 'statusCategory != Done',
          all: true,
        });
        issues = res.issues;
      }

      const byCategory = { todo: 0, inProgress: 0, done: 0 };
      const byStatus = {};
      const byAssignee = {};
      const highPriority = [];

      for (const issue of issues) {
        const f = issue.fields || {};
        const statusName = f.status?.name || 'Desconhecido';
        const catKey = f.status?.statusCategory?.key || 'undefined';
        const assignee = f.assignee?.displayName || f.assignee?.name || 'Não atribuído';
        const prio = f.priority?.name || '';

        byStatus[statusName] = (byStatus[statusName] || 0) + 1;
        byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;

        if (catKey === 'done') byCategory.done++;
        else if (catKey === 'indeterminate') byCategory.inProgress++;
        else byCategory.todo++;

        if (
          catKey !== 'done' &&
          (prio.toLowerCase().includes('high') ||
            prio.toLowerCase().includes('critical') ||
            prio.toLowerCase().includes('blocker') ||
            prio.toLowerCase().includes('alta') ||
            prio.toLowerCase().includes('crítica'))
        ) {
          highPriority.push(issue);
        }
      }

      const total = issues.length;
      const pctDone = total > 0 ? Math.round((byCategory.done / total) * 100) : 0;

      if (flags.json) {
        console.log(
          JSON.stringify({ boardId, activeSprint, total, pctDone, byCategory, byStatus, byAssignee }, null, 2)
        );
        return;
      }

      console.log(`\n${c.bold}${c.cyan}📊 RESUMO DA BOARD #${boardId}${c.reset}`);
      if (activeSprint) {
        console.log(
          `${c.bold}Sprint Ativa:${c.reset} ${activeSprint.name} (#${activeSprint.id}) | ${
            activeSprint.startDate ? activeSprint.startDate.slice(0, 10) : '?'
          } -> ${activeSprint.endDate ? activeSprint.endDate.slice(0, 10) : '?'}`
        );
        if (activeSprint.goal) {
          console.log(`${c.bold}Goal:${c.reset}         ${activeSprint.goal}`);
        }
      } else {
        console.log(`${c.dim}(Board sem Sprint ativa / Kanban — a mostrar items abertos)${c.reset}`);
      }

      console.log(`\n${c.bold}Progresso Geral:${c.reset} ${renderProgressBar(pctDone)} (${byCategory.done}/${total} concluídos)`);
      console.log(
        `  • ${c.cyan}Por Iniciar (To Do):${c.reset} ${byCategory.todo}   |   ` +
          `• ${c.yellow}Em Curso (In Progress):${c.reset} ${byCategory.inProgress}   |   ` +
          `• ${c.green}Concluídos (Done):${c.reset} ${byCategory.done}`
      );

      console.log(`\n${c.bold}Distribuição por Estado:${c.reset}`);
      for (const [st, count] of Object.entries(byStatus)) {
        console.log(`  - ${pad(st, 28)} ${c.bold}${count}${c.reset}`);
      }

      console.log(`\n${c.bold}Carga por Membro da Equipa:${c.reset}`);
      for (const [person, count] of Object.entries(byAssignee).sort((a, b) => b[1] - a[1])) {
        console.log(`  - ${pad(person, 28)} ${c.bold}${count}${c.reset} card(s)`);
      }

      if (highPriority.length > 0) {
        console.log(`\n${c.red}${c.bold}🔥 Cards Prioritários / Críticos em Aberto (${highPriority.length}):${c.reset}`);
        for (const hp of highPriority.slice(0, 10)) {
          console.log(
            `  • ${c.bold}${hp.key}${c.reset} [${hp.fields?.priority?.name}] (${hp.fields?.status?.name}) — ${hp.fields?.summary}`
          );
        }
      }
      break;
    }

    // ── 6. GET ISSUE / USER STORY DETAILS ─────────────────────────────────
    case 'get':
    case 'issue':
    case 'story': {
      const issueKey = args[0] || flags.key;
      if (!issueKey) {
        throw new Error('Indica a chave do card: node jira.mjs get <ISSUE-KEY>');
      }

      const [issue, remoteLinks] = await Promise.all([
        client.getIssue(issueKey),
        client.getRemoteLinks(issueKey).catch(() => []),
      ]);

      if (flags.json) {
        console.log(JSON.stringify({ issue, remoteLinks }, null, 2));
        return;
      }

      const f = issue.fields || {};
      console.log(`\n${c.bold}${c.cyan}[${issue.key}] ${f.summary || ''}${c.reset}`);
      console.log(`${c.gray}${'═'.repeat(72)}${c.reset}`);
      console.log(`  ${c.bold}Tipo:${c.reset}        ${f.issuetype?.name || '-'}`);
      console.log(
        `  ${c.bold}Estado:${c.reset}      ${statusBadge(f.status)} ${c.dim}(Categoria: ${
          f.status?.statusCategory?.name || '-'
        })${c.reset}`
      );
      console.log(`  ${c.bold}Prioridade:${c.reset}  ${f.priority?.name || '-'}`);
      console.log(`  ${c.bold}Assignee:${c.reset}    ${f.assignee?.displayName || f.assignee?.name || 'Não atribuído'}`);
      console.log(`  ${c.bold}Reporter:${c.reset}    ${f.reporter?.displayName || f.reporter?.name || '-'}`);
      console.log(`  ${c.bold}Labels:${c.reset}      ${(f.labels || []).join(', ') || '-'}`);
      if (f.parent) {
        console.log(`  ${c.bold}Parent/Epic:${c.reset} ${f.parent.key} — ${f.parent.fields?.summary || ''}`);
      }
      console.log(`  ${c.bold}URL:${c.reset}         ${config.baseUrl}/browse/${issue.key}`);

      console.log(`\n${c.bold}📝 Descrição:${c.reset}`);
      console.log(`${c.gray}${'─'.repeat(72)}${c.reset}`);
      console.log(f.description ? String(f.description).trim() : `${c.dim}(Sem descrição)${c.reset}`);

      if (Array.isArray(f.subtasks) && f.subtasks.length > 0) {
        console.log(`\n${c.bold}📌 Subtarefas (${f.subtasks.length}):${c.reset}`);
        for (const st of f.subtasks) {
          console.log(`  • ${c.bold}${st.key}${c.reset} [${ statusBadge(st.fields?.status) }] ${st.fields?.summary || ''}`);
        }
      }

      if (Array.isArray(f.issuelinks) && f.issuelinks.length > 0) {
        console.log(`\n${c.bold}🔗 Issues Relacionadas (${f.issuelinks.length}):${c.reset}`);
        for (const link of f.issuelinks) {
          if (link.outwardIssue) {
            console.log(
              `  • ${link.type?.outward || 'Relates'}: ${c.bold}${link.outwardIssue.key}${c.reset} (${
                link.outwardIssue.fields?.status?.name || ''
              }) — ${link.outwardIssue.fields?.summary || ''}`
            );
          } else if (link.inwardIssue) {
            console.log(
              `  • ${link.type?.inward || 'Relates'}: ${c.bold}${link.inwardIssue.key}${c.reset} (${
                link.inwardIssue.fields?.status?.name || ''
              }) — ${link.inwardIssue.fields?.summary || ''}`
            );
          }
        }
      }

      if (Array.isArray(remoteLinks) && remoteLinks.length > 0) {
        console.log(`\n${c.bold}📚 Documentação Confluence / Remote Links (${remoteLinks.length}):${c.reset}`);
        for (const rl of remoteLinks) {
          console.log(`  • ${c.bold}${rl.object?.title || 'Link'}:${c.reset} ${rl.object?.url || '-'}`);
        }
      }

      const comments = f.comment?.comments || [];
      if (comments.length > 0) {
        console.log(`\n${c.bold}💬 Comentários (${comments.length}):${c.reset}`);
        console.log(`${c.gray}${'─'.repeat(72)}${c.reset}`);
        for (const cm of comments.slice(-5)) {
          const author = cm.author?.displayName || cm.author?.name || 'Utilizador';
          const date = cm.created ? cm.created.slice(0, 16).replace('T', ' ') : '';
          console.log(`${c.bold}[ID: ${cm.id}] ${author}${c.reset} ${c.dim}(${date})${c.reset}:`);
          console.log(`  ${String(cm.body || '').split('\n').join('\n  ')}\n`);
        }
        if (comments.length > 5) {
          console.log(`${c.dim}(Usa "node jira.mjs comments ${issue.key}" para ver todos os ${comments.length} comentários)${c.reset}`);
        }
      }
      break;
    }

    // ── 7. SEARCH, STORIES & MY-ISSUES ────────────────────────────────────
    case 'stories': {
      const projectKey = flags.project || config.defaultProject;
      const clauses = [];
      if (projectKey) clauses.push(`project = "${projectKey}"`);
      if (flags.epic) clauses.push(`("Epic Link" = "${flags.epic}" OR parent = "${flags.epic}")`);
      if (flags.status) clauses.push(`status = "${flags.status}"`);
      else if (!flags['include-done']) clauses.push(`statusCategory != Done`);
      if (flags.assignee) clauses.push(`assignee = "${flags.assignee}"`);
      if (flags.type) clauses.push(`issuetype = "${flags.type}"`);

      const jql = `${clauses.join(' AND ') || 'statusCategory != Done'} ORDER BY updated DESC`;
      const res = await client.searchIssues(jql, {
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`${c.dim}JQL: ${jql}${c.reset}\n`);
      printIssuesTable(res.issues, res.total, res.truncated);
      break;
    }

    case 'my-issues': {
      const clauses = ['assignee = currentUser()'];
      const projectKey = flags.project || config.defaultProject;
      if (projectKey) clauses.push(`project = "${projectKey}"`);
      if (!flags['include-done']) clauses.push('statusCategory != Done');

      const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
      const res = await client.searchIssues(jql, {
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      printIssuesTable(res.issues, res.total, res.truncated);
      break;
    }

    case 'search': {
      const jql = args[0] || flags.jql;
      if (!jql) {
        throw new Error('Indica a expressão JQL: node jira.mjs search "project = PROJ AND statusCategory != Done"');
      }
      const res = await client.searchIssues(jql, {
        fields: flags.fields,
        maxResults: Number(flags.limit || 50),
        all: Boolean(flags.all),
      });

      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      printIssuesTable(res.issues, res.total, res.truncated);
      break;
    }

    // ── 8. CREATE ISSUE / USER STORY / EPIC ───────────────────────────────
    case 'create': {
      const projectKey = flags.project || config.defaultProject;
      const summary = flags.summary || args[0];
      if (!projectKey || !summary) {
        throw new Error(
          'Uso: node jira.mjs create --project <KEY> --summary "<Título>" [--type Story] [--description "<Texto>"] [--epic <EPIC-KEY>]'
        );
      }

      let description = flags.description || '';
      if (flags['description-file']) {
        description = fs.readFileSync(path.resolve(flags['description-file']), 'utf8');
      }

      let additionalFields = {};
      if (flags['fields-json']) {
        additionalFields = JSON.parse(flags['fields-json']);
      }

      const res = await client.createIssue({
        projectKey,
        issueTypeName: flags.type || 'Story',
        summary,
        description,
        priority: flags.priority,
        labels: flags.labels,
        assignee: flags.assignee,
        parentKey: flags.parent,
        epicKey: flags.epic,
        sprintId: flags.sprint,
        additionalFields,
      });

      if (printDryRunIfApplicable(res)) return;
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      console.log(
        `\n${c.green}${c.bold}✔ Card criado com sucesso:${c.reset} ${c.bold}${res.key}${c.reset} (${config.baseUrl}/browse/${res.key})`
      );
      break;
    }

    case 'create-epic': {
      const projectKey = flags.project || config.defaultProject;
      const summary = flags.summary || args[0];
      if (!projectKey || !summary) {
        throw new Error(
          'Uso: node jira.mjs create-epic --project <KEY> --summary "<Título do Épico>" [--epic-name "<Nome Curto>"] [--description "<Texto>"]'
        );
      }

      const res = await client.createEpic({
        projectKey,
        summary,
        epicName: flags['epic-name'] || summary,
        description: flags.description || '',
        priority: flags.priority,
        labels: flags.labels,
      });

      if (printDryRunIfApplicable(res)) return;
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      console.log(
        `\n${c.green}${c.bold}✔ Épico criado com sucesso:${c.reset} ${c.bold}${res.key}${c.reset} (${config.baseUrl}/browse/${res.key})`
      );
      break;
    }

    // ── 9. UPDATE & ASSIGN ISSUE ──────────────────────────────────────────
    case 'update':
    case 'edit': {
      const issueKey = args[0] || flags.key;
      if (!issueKey) {
        throw new Error(
          'Uso: node jira.mjs update <ISSUE-KEY> [--summary "<Novo>"] [--description "<Nova>"] [--priority <P>] [--add-label <L>]'
        );
      }

      let description = flags.description;
      if (flags['description-file']) {
        description = fs.readFileSync(path.resolve(flags['description-file']), 'utf8');
      }

      let additionalFields = {};
      if (flags['fields-json']) {
        additionalFields = JSON.parse(flags['fields-json']);
      }

      const hasFieldUpdates =
        flags.summary !== undefined ||
        description !== undefined ||
        flags.priority !== undefined ||
        flags.labels !== undefined ||
        flags['add-label'] !== undefined ||
        flags['remove-label'] !== undefined ||
        Object.keys(additionalFields).length > 0;

      if (hasFieldUpdates) {
        const res = await client.updateIssue(issueKey, {
          summary: flags.summary,
          description,
          priority: flags.priority,
          labels: flags.labels,
          addLabels: flags['add-label'],
          removeLabels: flags['remove-label'],
          additionalFields,
        });
        if (printDryRunIfApplicable(res)) return;
      }

      if (flags.epic) {
        const res = await client.moveIssuesToEpic(flags.epic, [issueKey]);
        if (printDryRunIfApplicable(res)) return;
      }
      if (flags.sprint) {
        const res = await client.moveIssuesToSprint(flags.sprint, [issueKey]);
        if (printDryRunIfApplicable(res)) return;
      }

      console.log(`${c.green}✔ Card ${c.bold}${issueKey}${c.reset}${c.green} atualizado com sucesso!${c.reset}`);
      break;
    }

    case 'assign': {
      const issueKey = args[0];
      if (!issueKey) {
        throw new Error('Uso: node jira.mjs assign <ISSUE-KEY> <username | --me | --unassign>');
      }

      let targetUser = args[1] || flags.user;
      if (flags.unassign) {
        targetUser = null;
      } else if (flags.me) {
        const me = await client.getCurrentUser();
        targetUser = me.name || me.accountId;
      }

      if (targetUser === undefined) {
        throw new Error('Indica o username, --me ou --unassign.');
      }

      const res = await client.assignIssue(issueKey, targetUser);
      if (printDryRunIfApplicable(res)) return;
      console.log(
        `${c.green}✔ Card ${c.bold}${issueKey}${c.reset}${c.green} atribuído a: ${
          targetUser === null ? '(Não atribuído)' : targetUser
        }${c.reset}`
      );
      break;
    }

    // ── 10. WORKFLOW TRANSITIONS ──────────────────────────────────────────
    case 'transitions': {
      const issueKey = args[0] || flags.key;
      if (!issueKey) {
        throw new Error('Uso: node jira.mjs transitions <ISSUE-KEY>');
      }
      const transitions = await client.getTransitions(issueKey);
      if (flags.json) {
        console.log(JSON.stringify(transitions, null, 2));
        return;
      }

      console.log(`\n${c.bold}Transições disponíveis para ${c.cyan}${issueKey}${c.reset}:\n`);
      const rows = transitions.map((t) => [
        `${c.bold}${t.id}${c.reset}`,
        t.name || '-',
        statusBadge(t.to),
        t.to?.statusCategory?.name || '-',
      ]);
      printTable(['ID', 'NOME DA TRANSIÇÃO', 'ESTADO DESTINO', 'CATEGORIA'], rows);
      break;
    }

    case 'transition':
    case 'move': {
      const issueKey = args[0];
      const targetTransition = args[1] || flags.to;
      if (!issueKey || !targetTransition) {
        throw new Error(
          'Uso: node jira.mjs transition <ISSUE-KEY> "<ID ou Nome da Transição>" [--comment "<Nota>"]'
        );
      }

      const { matchedTransition, response } = await client.transitionIssue(issueKey, targetTransition, {
        comment: flags.comment,
        resolution: flags.resolution,
      });

      if (printDryRunIfApplicable(response)) return;
      console.log(
        `${c.green}✔ ${c.bold}${issueKey}${c.reset}${c.green} movido através da transição "${matchedTransition.name}" -> ${c.bold}${matchedTransition.to?.name}${c.reset}`
      );
      break;
    }

    // ── 11. COMMENTS ──────────────────────────────────────────────────────
    case 'comments': {
      const issueKey = args[0] || flags.key;
      if (!issueKey) {
        throw new Error('Uso: node jira.mjs comments <ISSUE-KEY>');
      }
      const comments = await client.getComments(issueKey);
      if (flags.json) {
        console.log(JSON.stringify(comments, null, 2));
        return;
      }

      console.log(`\n${c.bold}💬 Comentários em ${c.cyan}${issueKey}${c.reset} (${comments.length}):\n`);
      for (const cm of comments) {
        const author = cm.author?.displayName || cm.author?.name || 'Utilizador';
        const date = cm.created ? cm.created.slice(0, 16).replace('T', ' ') : '';
        console.log(`${c.bold}[ID: ${cm.id}] ${author}${c.reset} ${c.dim}(${date})${c.reset}:`);
        console.log(`  ${String(cm.body || '').split('\n').join('\n  ')}`);
        console.log(`${c.gray}${'─'.repeat(64)}${c.reset}`);
      }
      break;
    }

    case 'comment': {
      const issueKey = args[0];
      const text = args.slice(1).join(' ') || flags.text || flags.body;
      if (!issueKey || !text) {
        throw new Error('Uso: node jira.mjs comment <ISSUE-KEY> "<Texto do comentário>"');
      }

      const res = await client.addComment(issueKey, text);
      if (printDryRunIfApplicable(res)) return;
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`${c.green}✔ Comentário adicionado a ${c.bold}${issueKey}${c.reset} (ID: ${res.id})`);
      break;
    }

    case 'edit-comment': {
      const issueKey = args[0];
      const commentId = args[1];
      const text = args.slice(2).join(' ') || flags.text || flags.body;
      if (!issueKey || !commentId || !text) {
        throw new Error('Uso: node jira.mjs edit-comment <ISSUE-KEY> <COMMENT-ID> "<Novo texto>"');
      }

      const res = await client.editComment(issueKey, commentId, text);
      if (printDryRunIfApplicable(res)) return;
      console.log(`${c.green}✔ Comentário #${commentId} em ${c.bold}${issueKey}${c.reset} atualizado com sucesso!`);
      break;
    }

    // ── 12. WORKLOG, ISSUE LINKS & REMOTE LINKS ───────────────────────────
    case 'move-to-epic': {
      const epicKey = args[0] || flags.epic;
      const issueKeys = args.slice(1);
      if (!epicKey || issueKeys.length === 0) {
        throw new Error('Uso: node jira.mjs move-to-epic <EPIC-KEY> <ISSUE-1> [ISSUE-2 ...]');
      }
      const res = await client.moveIssuesToEpic(epicKey, issueKeys);
      if (printDryRunIfApplicable(res)) return;
      console.log(
        `${c.green}✔ Card(s) ${c.bold}${issueKeys.join(', ')}${c.reset}${c.green} associado(s) ao épico ${c.bold}${epicKey}${c.reset}`
      );
      break;
    }

    case 'move-to-sprint': {
      const sprintId = args[0] || flags.sprint;
      const issueKeys = args.slice(1);
      if (!sprintId || issueKeys.length === 0) {
        throw new Error('Uso: node jira.mjs move-to-sprint <SPRINT-ID> <ISSUE-1> [ISSUE-2 ...]');
      }
      const res = await client.moveIssuesToSprint(sprintId, issueKeys);
      if (printDryRunIfApplicable(res)) return;
      console.log(
        `${c.green}✔ Card(s) ${c.bold}${issueKeys.join(', ')}${c.reset}${c.green} movido(s) para a sprint #${c.bold}${sprintId}${c.reset}`
      );
      break;
    }

    case 'worklog': {
      const issueKey = args[0];
      const timeSpent = args[1] || flags.time;
      const comment = args.slice(2).join(' ') || flags.comment || '';
      if (!issueKey || !timeSpent) {
        throw new Error('Uso: node jira.mjs worklog <ISSUE-KEY> "<Tempo ex: 2h 30m>" ["<Comentário>"]');
      }
      const res = await client.addWorklog(issueKey, timeSpent, comment);
      if (printDryRunIfApplicable(res)) return;
      console.log(`${c.green}✔ Registado worklog de ${c.bold}${timeSpent}${c.reset}${c.green} em ${issueKey}!${c.reset}`);
      break;
    }

    case 'link': {
      const inwardKey = args[0];
      const outwardKey = args[1];
      if (!inwardKey || !outwardKey) {
        throw new Error('Uso: node jira.mjs link <ISSUE-1> <ISSUE-2> [--type Relates]');
      }
      const res = await client.linkIssues(inwardKey, outwardKey, flags.type || 'Relates', flags.comment);
      if (printDryRunIfApplicable(res)) return;
      console.log(`${c.green}✔ Link criado entre ${c.bold}${inwardKey}${c.reset}${c.green} e ${c.bold}${outwardKey}${c.reset}`);
      break;
    }

    case 'remote-links': {
      const issueKey = args[0];
      if (!issueKey) {
        throw new Error('Uso: node jira.mjs remote-links <ISSUE-KEY>');
      }
      const links = await client.getRemoteLinks(issueKey);
      if (flags.json) {
        console.log(JSON.stringify(links, null, 2));
        return;
      }
      const rows = (links || []).map((l) => [
        l.id,
        l.object?.title || '-',
        l.object?.url || '-',
        l.application?.name || '-',
      ]);
      printTable(['ID', 'TÍTULO', 'URL', 'APLICAÇÃO'], rows);
      break;
    }

    case 'link-url': {
      const issueKey = args[0];
      const url = args[1] || flags.url;
      const title = args[2] || flags.title || url;
      if (!issueKey || !url) {
        throw new Error('Uso: node jira.mjs link-url <ISSUE-KEY> "<URL>" "<Título da página>"');
      }
      const res = await client.addRemoteLink(issueKey, url, title, flags.summary || '');
      if (printDryRunIfApplicable(res)) return;
      console.log(`${c.green}✔ Link remoto associado a ${c.bold}${issueKey}${c.reset}: ${title}`);
      break;
    }

    // ── 13. DAILY STANDUP GENERATOR ───────────────────────────────────────
    case 'standup': {
      const days = Number(flags.days || 2);
      const projectClause = flags.project || config.defaultProject ? ` AND project = "${flags.project || config.defaultProject}"` : '';

      const [doneRes, openRes] = await Promise.all([
        client.searchIssues(
          `assignee = currentUser() AND statusCategory = Done AND updated >= -${days}d${projectClause} ORDER BY updated DESC`,
          { maxResults: 30 }
        ),
        client.searchIssues(
          `assignee = currentUser() AND statusCategory != Done${projectClause} ORDER BY priority DESC, updated DESC`,
          { maxResults: 50 }
        ),
      ]);

      const inProgress = openRes.issues.filter((i) => i.fields?.status?.statusCategory?.key === 'indeterminate');
      const todo = openRes.issues.filter((i) => i.fields?.status?.statusCategory?.key !== 'indeterminate');

      if (flags.json) {
        console.log(JSON.stringify({ doneRecently: doneRes.issues, inProgress, todo }, null, 2));
        return;
      }

      console.log(`\n${c.bold}${c.cyan}🎙️  RESUMO PARA DAILY STANDUP (Últimos ${days} dias)${c.reset}`);
      console.log(`${c.gray}${'═'.repeat(68)}${c.reset}`);

      console.log(`\n${c.green}${c.bold}✔ O que concluí recentemente (${doneRes.issues.length}):${c.reset}`);
      if (doneRes.issues.length === 0) {
        console.log(`  ${c.dim}(Nenhum card fechado nos últimos ${days} dias)${c.reset}`);
      } else {
        for (const i of doneRes.issues) {
          console.log(`  • ${c.bold}${i.key}${c.reset} — ${i.fields?.summary} (${i.fields?.status?.name})`);
        }
      }

      console.log(`\n${c.yellow}${c.bold}🚧 Em que estou a trabalhar agora (${inProgress.length}):${c.reset}`);
      if (inProgress.length === 0) {
        console.log(`  ${c.dim}(Nenhum card na categoria In Progress)${c.reset}`);
      } else {
        for (const i of inProgress) {
          console.log(`  • ${c.bold}${i.key}${c.reset} [${i.fields?.status?.name}] — ${i.fields?.summary}`);
        }
      }

      console.log(`\n${c.cyan}${c.bold}📋 Próximos em fila / To Do (${todo.length}):${c.reset}`);
      for (const i of todo.slice(0, 8)) {
        console.log(`  • ${c.bold}${i.key}${c.reset} [${i.fields?.status?.name}] — ${i.fields?.summary}`);
      }
      break;
    }

    // ── 14. EXPORT STORY TO MARKDOWN SPEC ─────────────────
    case 'export-story': {
      const issueKey = args[0] || flags.key;
      if (!issueKey) {
        throw new Error('Uso: node jira.mjs export-story <ISSUE-KEY> [--output spec.md]');
      }

      const [issue, remoteLinks] = await Promise.all([
        client.getIssue(issueKey),
        client.getRemoteLinks(issueKey).catch(() => []),
      ]);

      const f = issue.fields || {};
      const comments = f.comment?.comments || [];
      const subtasks = f.subtasks || [];

      const mdLines = [
        `# [${issue.key}] ${f.summary || 'User Story'}`,
        ``,
        `> **Tipo:** ${f.issuetype?.name || '-'} | **Estado:** ${f.status?.name || '-'} | **Prioridade:** ${f.priority?.name || '-'}`,
        `> **Assignee:** ${f.assignee?.displayName || 'Não atribuído'} | **URL:** ${config.baseUrl}/browse/${issue.key}`,
        ``,
        `## 1. Descrição & Contexto de Negócio`,
        ``,
        f.description ? String(f.description).trim() : '_Sem descrição detalhada no card._',
        ``,
      ];

      if (subtasks.length > 0) {
        mdLines.push(`## 2. Subtarefas no Jira`);
        mdLines.push(``);
        for (const st of subtasks) {
          const isDone = st.fields?.status?.statusCategory?.key === 'done';
          mdLines.push(`- [${isDone ? 'x' : ' '}] **${st.key}**: ${st.fields?.summary || ''} _(${st.fields?.status?.name || ''})_`);
        }
        mdLines.push(``);
      }

      if (Array.isArray(remoteLinks) && remoteLinks.length > 0) {
        mdLines.push(`## 3. Documentação Confluence & Links Associados`);
        mdLines.push(``);
        for (const rl of remoteLinks) {
          mdLines.push(`- [${rl.object?.title || rl.object?.url}](${rl.object?.url})`);
        }
        mdLines.push(``);
      }

      if (comments.length > 0) {
        mdLines.push(`## 4. Notas Técnicas & Comentários Recentes`);
        mdLines.push(``);
        for (const cm of comments.slice(-5)) {
          const author = cm.author?.displayName || cm.author?.name || 'Utilizador';
          const date = cm.created ? cm.created.slice(0, 10) : '';
          mdLines.push(`### ${author} (${date})`);
          mdLines.push(String(cm.body || '').trim());
          mdLines.push(``);
        }
      }

      mdLines.push(
        `## 5. Checklist Técnica de Implementação (Definition of Done)`,
        ``,
        `- [ ] **Arquitetura & Design**: Alinhamento com a arquitetura do projeto e separação clara de responsabilidades.`,
        `- [ ] **Contratos de Dados & APIs**: Validação de modelos de dados, inputs/outputs e tratamento consistente de erros.`,
        `- [ ] **Testes**: Implementação e validação de testes unitários e de integração para os critérios de aceitação.`,
        `- [ ] **Segurança & Boas Práticas**: Validação de permissões, sanitização de inputs e proteção de dados sensíveis.`,
        `- [ ] **Revisão & Documentação**: Code review efetuado e documentação técnica atualizada.`
      );

      const markdown = mdLines.join('\n') + '\n';

      if (flags.output) {
        const outPath = path.resolve(flags.output);
        fs.writeFileSync(outPath, markdown, 'utf8');
        console.log(`${c.green}✔ Especificação exportada com sucesso para:${c.reset} ${outPath}`);
      } else {
        console.log(markdown);
      }
      break;
    }

    default:
      throw new Error(`Comando desconhecido: "${command}". Executa "node tools/jira-cli/jira.mjs help" para ver os comandos.`);
  }
}

// Run CLI if invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(`\n${c.red}${c.bold}✖ Erro:${c.reset} ${err.message}\n`);
    process.exit(1);
  });
}
