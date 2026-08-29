const state = {
  products: [],
  groups: [],
  jobs: [],
  settings: null,
  selectedProducts: new Set(),
  selectedGroups: new Set(),
  shuffle: false,
  ready: false,
  authenticated: false,
  user: null,
  authMode: 'login',
  authSettings: null,
  appLoaded: false,
  initialProductsLoaded: false,
  watchedJobs: new Set(),
  status: null,
  groupsLoading: false,
  activeView: 'offers',
};

const elements = {
  sidebar: document.getElementById('sidebar'),
  pageTitle: document.getElementById('pageTitle'),
  connectionText: document.getElementById('connectionText'),
  connectionPill: document.getElementById('connectionPill'),
  sidebarStatus: document.getElementById('sidebarStatus'),
  sidebarStatusDot: document.getElementById('sidebarStatusDot'),
  connectionOverlay: document.getElementById('connectionOverlay'),
  qrFrame: document.getElementById('qrFrame'),
  qrStatus: document.getElementById('qrStatus'),
  productTable: document.getElementById('productTable'),
  productEmpty: document.getElementById('productEmpty'),
  productCount: document.getElementById('productCount'),
  groupCount: document.getElementById('groupCount'),
  groupList: document.getElementById('groupList'),
  selectionSummary: document.getElementById('selectionSummary'),
  groupSummary: document.getElementById('groupSummary'),
  syncedGroupsList: document.getElementById('syncedGroupsList'),
  waRealStatus: document.getElementById('waRealStatus'),
  waAccount: document.getElementById('waAccount'),
  waState: document.getElementById('waState'),
  waVersion: document.getElementById('waVersion'),
  waGroupsCount: document.getElementById('waGroupsCount'),
  waLastSync: document.getElementById('waLastSync'),
  waError: document.getElementById('waError'),
  manualGroupId: document.getElementById('manualGroupId'),
  manualGroupName: document.getElementById('manualGroupName'),
  sendTotal: document.getElementById('sendTotal'),
  sendDetail: document.getElementById('sendDetail'),
  sendButton: document.getElementById('sendButton'),
  delayInput: document.getElementById('delayInput'),
  linkInput: document.getElementById('linkInput'),
  importButton: document.getElementById('importButton'),
  productSearch: document.getElementById('productSearch'),
  groupSearch: document.getElementById('groupSearch'),
  statusFilter: document.getElementById('statusFilter'),
  templateInput: document.getElementById('templateInput'),
  defaultDelayInput: document.getElementById('defaultDelayInput'),
  messagePreview: document.getElementById('messagePreview'),
  overviewJobs: document.getElementById('overviewJobs'),
  toastRegion: document.getElementById('toastRegion'),
  authOverlay: document.getElementById('authOverlay'),
  authForm: document.getElementById('authForm'),
  authTitle: document.getElementById('authTitle'),
  authSubtitle: document.getElementById('authSubtitle'),
  loginTab: document.getElementById('loginTab'),
  signupTab: document.getElementById('signupTab'),
  nameField: document.getElementById('nameField'),
  confirmPasswordField: document.getElementById('confirmPasswordField'),
  accessCodeField: document.getElementById('accessCodeField'),
  authName: document.getElementById('authName'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authPasswordConfirm: document.getElementById('authPasswordConfirm'),
  authAccessCode: document.getElementById('authAccessCode'),
  authSubmit: document.getElementById('authSubmit'),
  authFeedback: document.getElementById('authFeedback'),
  authConfigError: document.getElementById('authConfigError'),
  userCard: document.getElementById('userCard'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  userEmail: document.getElementById('userEmail'),
  logoutButton: document.getElementById('logoutButton'),
  togglePassword: document.getElementById('togglePassword'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? escapeHtml(url.href) : '';
  } catch (_) {
    return '';
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/api/auth/login', '/api/auth/signup', '/api/auth/me'].includes(path)) {
      state.authenticated = false;
      showAuth('Sua sessão terminou. Entre novamente.');
    }
    const error = new Error(data.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`.trim();
  item.textContent = message;
  elements.toastRegion.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function setAuthFeedback(message = '', type = 'error') {
  elements.authFeedback.hidden = !message;
  elements.authFeedback.textContent = message;
  elements.authFeedback.classList.toggle('success', type === 'success');
}

function renderUser() {
  const user = state.user || {};
  const displayName = user.name || String(user.email || '').split('@')[0] || 'Usuário';
  elements.userName.textContent = displayName;
  elements.userEmail.textContent = user.email || '—';
  elements.userAvatar.textContent = displayName.trim().slice(0, 1).toUpperCase() || 'U';
  elements.userCard.hidden = !state.authenticated;
}

function showAuth(message = '') {
  elements.authOverlay.hidden = false;
  elements.connectionOverlay.hidden = true;
  elements.userCard.hidden = true;
  if (message) setAuthFeedback(message, 'error');
}

function hideAuth() {
  setAuthFeedback('');
  elements.authOverlay.hidden = true;
  renderUser();
}

function setAuthMode(mode) {
  const signup = mode === 'signup' && state.authSettings && state.authSettings.allowSignups;
  state.authMode = signup ? 'signup' : 'login';
  elements.loginTab.classList.toggle('active', !signup);
  elements.signupTab.classList.toggle('active', signup);
  elements.loginTab.setAttribute('aria-selected', String(!signup));
  elements.signupTab.setAttribute('aria-selected', String(signup));
  elements.nameField.hidden = !signup;
  elements.confirmPasswordField.hidden = !signup;
  elements.accessCodeField.hidden = !signup;
  elements.authName.required = signup;
  elements.authPasswordConfirm.required = signup;
  elements.authAccessCode.required = signup;
  elements.authPassword.autocomplete = signup ? 'new-password' : 'current-password';
  elements.authTitle.textContent = signup ? 'Criar sua conta' : 'Entrar no painel';
  elements.authSubtitle.textContent = signup
    ? 'Cadastre-se com o código de acesso definido pelo administrador.'
    : 'Use seu e-mail e senha para continuar.';
  elements.authSubmit.textContent = signup ? 'Criar conta' : 'Entrar';
  elements.authPassword.value = '';
  elements.authPasswordConfirm.value = '';
  elements.authAccessCode.value = '';
  setAuthFeedback('');
}

async function startApp() {
  if (state.appLoaded) return;
  state.appLoaded = true;
  try {
    await refreshAll();
  } catch (error) {
    state.appLoaded = false;
    throw error;
  }
}

async function bootstrapAuth() {
  showAuth();
  try {
    state.authSettings = await api('/api/auth/settings');
  } catch (error) {
    elements.authConfigError.hidden = false;
    elements.authConfigError.textContent = `Não foi possível carregar a autenticação: ${error.message}`;
    elements.authSubmit.disabled = true;
    return;
  }

  if (!state.authSettings.configured) {
    elements.authConfigError.hidden = false;
    elements.authConfigError.textContent = 'Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no EasyPanel e implante novamente.';
    elements.authSubmit.disabled = true;
    elements.signupTab.hidden = true;
    return;
  }

  elements.authConfigError.hidden = true;
  elements.authSubmit.disabled = false;
  elements.signupTab.hidden = !state.authSettings.allowSignups;
  setAuthMode('login');

  try {
    const result = await api('/api/auth/me');
    state.authenticated = true;
    state.user = result.user;
    hideAuth();
    await startApp();
  } catch (error) {
    if (error.status !== 401) setAuthFeedback(error.message, 'error');
  }
}

function setView(view) {
  const titles = {
    overview: 'Visão geral',
    offers: 'Enviar ofertas',
    whatsapp: 'WhatsApp e grupos',
    settings: 'Modelo da mensagem',
  };
  state.activeView = view;
  document.querySelectorAll('.view').forEach((element) => {
    const active = element.id === `${view}View`;
    element.hidden = !active;
    element.classList.toggle('active-view', active);
  });
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  elements.pageTitle.textContent = titles[view];
  elements.sidebar.classList.remove('open');
  if (view === 'overview') renderOverview();
  if (view === 'whatsapp') renderConnectionDetails();
  if (view === 'settings') renderPreview();
}

function formatDate(value) {
  if (!value) return 'Nunca enviado';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch (_) {
    return '';
  }
}

function statusLabel(status) {
  return {
    saved: 'SALVO', sent: 'ENVIADO', queued: 'NA FILA', sending: 'ENVIANDO',
    completed: 'CONCLUÍDO', partial: 'PARCIAL', failed: 'FALHOU', interrupted: 'INTERROMPIDO',
  }[status] || String(status || '').toUpperCase();
}

function filteredProducts() {
  const query = elements.productSearch.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  return state.products.filter((product) => {
    const matchesText = !query || product.title.toLowerCase().includes(query) || product.affiliateUrl.toLowerCase().includes(query);
    const matchesStatus = status === 'all' || product.status === status;
    return matchesText && matchesStatus;
  });
}

function renderProducts() {
  const products = filteredProducts();
  elements.productCount.textContent = state.products.length;
  elements.productEmpty.hidden = products.length !== 0;
  elements.productTable.innerHTML = products.map((product) => {
    const checked = state.selectedProducts.has(product.id);
    const image = safeImage(product.image);
    return `
      <tr class="${checked ? 'selected-row' : ''}" data-product-id="${escapeHtml(product.id)}">
        <td><input type="checkbox" data-product-check="${escapeHtml(product.id)}" ${checked ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(product.title)}"></td>
        <td>
          <div class="product-cell">
            ${image ? `<img src="${image}" alt="" loading="lazy">` : '<span class="product-placeholder">↗</span>'}
            <div class="product-copy">
              <strong title="${escapeHtml(product.title)}">${escapeHtml(product.title)}</strong>
              <small>${escapeHtml(formatDate(product.lastSentAt))} · ${Number(product.sendCount || 0)} envio(s)</small>
            </div>
          </div>
        </td>
        <td><span class="price">${escapeHtml(product.price || 'Ver no link')}</span></td>
        <td><span class="discount">${escapeHtml(product.discount ? `-${product.discount}` : '—')}</span></td>
        <td><span class="status-tag ${escapeHtml(product.status)}">${escapeHtml(statusLabel(product.status))}</span></td>
        <td><button class="delete-button" data-delete-product="${escapeHtml(product.id)}" title="Excluir produto">×</button></td>
      </tr>`;
  }).join('');
  renderSelectionSummary();
}

function filteredGroups() {
  const query = elements.groupSearch.value.trim().toLowerCase();
  return state.groups.filter((group) => !query || group.name.toLowerCase().includes(query));
}

function renderGroups() {
  const groups = filteredGroups();
  elements.groupCount.textContent = state.groups.length;
  if (groups.length === 0) {
    elements.groupList.innerHTML = `<div class="group-empty">${state.ready
      ? 'Nenhum grupo sincronizado. Use ↻ Sincronizar ou adicione pelo convite em “WhatsApp e grupos”.'
      : 'Conecte o WhatsApp para carregar os grupos.'}</div>`;
  } else {
    elements.groupList.innerHTML = groups.map((group) => {
      const selected = state.selectedGroups.has(group.id);
      return `
        <label class="group-option ${selected ? 'selected' : ''}">
          <input type="checkbox" data-group-check="${escapeHtml(group.id)}" ${selected ? 'checked' : ''}>
          <div><strong>${escapeHtml(group.name)}</strong><small>${group.participants ? `${group.participants} participantes` : 'Grupo do WhatsApp'}</small></div>
          <span>›</span>
        </label>`;
    }).join('');
  }
  renderConnectionDetails();
  renderSelectionSummary();
}

function renderConnectionDetails() {
  const status = state.status || {};
  const account = status.account || {};
  if (elements.waRealStatus) {
    elements.waRealStatus.textContent = state.ready ? 'CONECTADO' : 'DESCONECTADO';
    elements.waRealStatus.className = `status-tag ${state.ready ? 'completed' : 'failed'}`;
    elements.waAccount.textContent = account.name
      ? `${account.name}${account.id ? ` · ${account.id}` : ''}`
      : (account.id || '—');
    elements.waState.textContent = status.state || (state.ready ? 'CONNECTED' : '—');
    elements.waVersion.textContent = status.webVersion || '—';
    elements.waGroupsCount.textContent = String(state.groups.length);
    elements.waLastSync.textContent = status.lastGroupSyncAt
      ? formatDate(status.lastGroupSyncAt)
      : 'Ainda não realizada';
    elements.waError.hidden = !status.error;
    elements.waError.textContent = status.error || '';
  }

  if (!elements.syncedGroupsList) return;
  if (state.groups.length === 0) {
    elements.syncedGroupsList.innerHTML = '<div class="group-empty">Nenhum grupo disponível ainda.</div>';
    return;
  }
  elements.syncedGroupsList.innerHTML = state.groups.map((group) => `
    <div class="synced-group-row">
      <span class="synced-group-icon">◉</span>
      <div><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.id)}${group.participants ? ` · ${group.participants} participantes` : ''}</small></div>
      <span class="status-tag completed">${group.source === 'manual' ? 'MANUAL' : 'WHATSAPP'}</span>
      ${group.source === 'manual' ? `<button class="delete-button" data-remove-group="${escapeHtml(group.id)}" title="Remover grupo manual">×</button>` : ''}
    </div>`).join('');
}

function renderSelectionSummary() {
  const products = state.selectedProducts.size;
  const groups = state.selectedGroups.size;
  const total = products * groups;
  elements.selectionSummary.textContent = `${products} selecionado${products === 1 ? '' : 's'}`;
  elements.groupSummary.textContent = `${groups} selecionado${groups === 1 ? '' : 's'}`;
  if (total > 0) {
    elements.sendTotal.textContent = `${products} produto${products === 1 ? '' : 's'} × ${groups} grupo${groups === 1 ? '' : 's'}`;
    elements.sendDetail.textContent = `${total} mensagem${total === 1 ? '' : 'ens'} no total${state.shuffle ? ' · ordem embaralhada' : ''}.`;
  } else {
    elements.sendTotal.textContent = 'Selecione produtos e grupos';
    elements.sendDetail.textContent = 'Os envios serão feitos pelo WhatsApp conectado.';
  }
  elements.sendButton.disabled = !state.ready || total === 0;
}

function renderOverview() {
  document.getElementById('statProducts').textContent = state.products.length;
  document.getElementById('statGroups').textContent = state.groups.length;
  document.getElementById('statSent').textContent = state.products.reduce((total, item) => total + Number(item.sendCount || 0), 0);
  const activeJob = state.jobs.find((job) => job.status === 'queued' || job.status === 'sending');
  document.getElementById('statQueue').textContent = activeJob ? `${activeJob.completed}/${activeJob.total}` : 'Livre';
  document.getElementById('statQueueDetail').textContent = activeJob ? (activeJob.currentProduct || 'Preparando lote') : 'Nenhum lote em andamento';
  renderJobs();
}

function renderJobs() {
  if (state.jobs.length === 0) {
    elements.overviewJobs.innerHTML = '<div class="group-empty">Nenhum lote enviado ainda.</div>';
    return;
  }
  elements.overviewJobs.innerHTML = state.jobs.slice(0, 6).map((job) => {
    const percent = job.total ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
    const errors = Array.isArray(job.errors) ? job.errors : [];
    const lastError = errors.length ? errors[errors.length - 1] : '';
    return `<div class="job-item">
      <div><strong>${job.productIds.length} produto(s) para ${job.groupIds.length} grupo(s)</strong><small>${escapeHtml(formatDate(job.createdAt))} · ${job.completed} enviados · ${job.failed} falhas</small>${lastError ? `<small class="job-error">Motivo: ${escapeHtml(lastError)}</small>` : ''}</div>
      <span class="status-tag ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
      <div class="job-progress"><span style="width:${Math.min(100, percent)}%"></span></div>
    </div>`;
  }).join('');
}

function renderPreview() {
  const template = elements.templateInput.value || '';
  const sample = {
    '{titulo}': 'Kit de potes herméticos em promoção',
    '{preco}': 'R$ 109,90',
    '{preco_original}': 'R$ 189,90',
    '{desconto}': '42%',
    '{link}': 'https://meli.la/seu-link',
  };
  let result = template;
  Object.entries(sample).forEach(([token, value]) => { result = result.split(token).join(value); });
  elements.messagePreview.textContent = result;
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    const wasReady = state.ready;
    state.status = status;
    state.ready = Boolean(status.ready);
    elements.connectionText.textContent = status.status;
    elements.sidebarStatus.textContent = status.ready ? 'Conectado' : 'Aguardando';
    elements.connectionPill.querySelector('.status-dot').classList.toggle('online', status.ready);
    elements.sidebarStatusDot.classList.toggle('online', status.ready);
    elements.connectionOverlay.hidden = status.ready;
    elements.qrStatus.textContent = status.status;
    if (!status.ready && status.qr) {
      elements.qrFrame.innerHTML = `<img src="${status.qr}" alt="QR Code do WhatsApp">`;
    } else if (!status.ready) {
      elements.qrFrame.innerHTML = '<span class="spinner"></span>';
    }
    if (!wasReady && status.ready) await loadGroups(true, true);
    else if (status.ready && Number(status.groupsCount) !== state.groups.length) await loadGroups(false, true);
    renderConnectionDetails();
    renderSelectionSummary();
  } catch (error) {
    elements.connectionText.textContent = 'Painel indisponível';
  }
}

async function loadProducts() {
  const data = await api('/api/products');
  state.products = data.products;
  if (!state.initialProductsLoaded) {
    state.initialProductsLoaded = true;
    if (state.products.length === 1) state.selectedProducts.add(state.products[0].id);
  }
  const valid = new Set(state.products.map((product) => product.id));
  state.selectedProducts.forEach((id) => { if (!valid.has(id)) state.selectedProducts.delete(id); });
  renderProducts();
}

async function loadGroups(force = false, quiet = false) {
  if (!state.ready) return renderGroups();
  if (state.groupsLoading) return;
  state.groupsLoading = true;
  try {
    const data = await api(force ? '/api/groups/sync' : '/api/groups', force ? { method: 'POST' } : {});
    state.groups = data.groups;
    if (state.status) state.status.lastGroupSyncAt = data.syncedAt || state.status.lastGroupSyncAt;
    const valid = new Set(state.groups.map((group) => group.id));
    state.selectedGroups.forEach((id) => { if (!valid.has(id)) state.selectedGroups.delete(id); });
  } catch (error) {
    if (!quiet) toast(error.message, 'error');
  } finally {
    state.groupsLoading = false;
  }
  renderGroups();
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  elements.templateInput.value = state.settings.template;
  elements.defaultDelayInput.value = state.settings.defaultDelaySeconds;
  elements.delayInput.value = state.settings.defaultDelaySeconds;
  renderPreview();
}

async function loadJobs() {
  const data = await api('/api/jobs');
  state.jobs = data.jobs;
  renderJobs();
  if (state.activeView === 'overview') renderOverview();
}

function jobFailureMessage(job) {
  const errors = Array.isArray(job.errors) ? job.errors.filter(Boolean) : [];
  return errors.length ? errors[errors.length - 1] : 'O WhatsApp não confirmou o envio.';
}

async function watchJob(jobId) {
  if (!jobId || state.watchedJobs.has(jobId)) return;
  state.watchedJobs.add(jobId);
  const deadline = Date.now() + (10 * 60 * 1000);

  try {
    while (state.authenticated && Date.now() < deadline) {
      await loadJobs();
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error('O lote não foi encontrado no histórico.');
      if (job.status === 'completed' || job.status === 'partial') {
        if (job.failed > 0) {
          const message = jobFailureMessage(job);
          elements.sendTotal.textContent = 'Lote concluído parcialmente';
          elements.sendDetail.textContent = `${job.completed} enviado(s), ${job.failed} falha(s). ${message}`;
          toast(`Lote concluído com ${job.completed} envio(s) e ${job.failed} falha(s): ${message}`, 'error');
        } else {
          elements.sendTotal.textContent = 'Envio confirmado';
          elements.sendDetail.textContent = `${job.completed} mensagem${job.completed === 1 ? '' : 'ens'} confirmada${job.completed === 1 ? '' : 's'} pelo WhatsApp.`;
          toast(`${job.completed} mensagem${job.completed === 1 ? '' : 'ens'} enviada${job.completed === 1 ? '' : 's'} e confirmada${job.completed === 1 ? '' : 's'} pelo WhatsApp.`, 'success');
        }
        await loadProducts();
        return;
      }
      if (job.status === 'failed' || job.status === 'interrupted') {
        const message = jobFailureMessage(job);
        elements.sendTotal.textContent = 'O envio falhou';
        elements.sendDetail.textContent = message;
        toast(`O envio falhou: ${message}`, 'error');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
  } catch (error) {
    toast(`Não foi possível acompanhar o lote: ${error.message}`, 'error');
  } finally {
    state.watchedJobs.delete(jobId);
  }
}

async function refreshAll() {
  await refreshStatus();
  await Promise.all([loadProducts(), loadSettings(), loadJobs()]);
  if (state.ready) await loadGroups();
  renderOverview();
}

elements.loginTab.addEventListener('click', () => setAuthMode('login'));
elements.signupTab.addEventListener('click', () => setAuthMode('signup'));

elements.togglePassword.addEventListener('click', () => {
  const show = elements.authPassword.type === 'password';
  [elements.authPassword, elements.authPasswordConfirm, elements.authAccessCode].forEach((input) => {
    input.type = show ? 'text' : 'password';
  });
  elements.togglePassword.textContent = show ? '◌' : '◉';
  elements.togglePassword.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
});

elements.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const signup = state.authMode === 'signup';
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  const name = elements.authName.value.trim();
  const accessCode = elements.authAccessCode.value;

  if (!email || !password) return setAuthFeedback('Informe e-mail e senha.');
  if (password.length < 8) return setAuthFeedback('A senha precisa ter pelo menos 8 caracteres.');
  if (signup && name.length < 2) return setAuthFeedback('Informe seu nome.');
  if (signup && password !== elements.authPasswordConfirm.value) {
    return setAuthFeedback('As senhas não são iguais.');
  }
  if (signup && accessCode.length < 8) return setAuthFeedback('Informe o código de acesso.');

  const original = elements.authSubmit.textContent;
  elements.authSubmit.disabled = true;
  elements.authSubmit.textContent = signup ? 'Criando conta...' : 'Entrando...';
  setAuthFeedback('');
  try {
    const result = await api(signup ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, accessCode }),
    });
    if (result.authenticated) {
      state.authenticated = true;
      state.user = result.user;
      hideAuth();
      await startApp();
      toast(signup ? 'Conta criada e painel liberado.' : 'Login realizado.', 'success');
    } else if (result.requiresEmailConfirmation) {
      setAuthMode('login');
      elements.authEmail.value = email;
      setAuthFeedback('Conta criada. Confirme o link enviado ao seu e-mail e depois entre.', 'success');
    }
  } catch (error) {
    setAuthFeedback(error.message, 'error');
  } finally {
    elements.authSubmit.disabled = false;
    elements.authSubmit.textContent = state.authMode === 'signup' ? 'Criar conta' : 'Entrar';
    if (!state.authSettings || !state.authSettings.configured) {
      elements.authSubmit.disabled = true;
      elements.authSubmit.textContent = original;
    }
  }
});

elements.logoutButton.addEventListener('click', async () => {
  elements.logoutButton.disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    // O cookie local será descartado ao recarregar mesmo se o serviço estiver indisponível.
  } finally {
    state.authenticated = false;
    state.user = null;
    state.appLoaded = false;
    state.products = [];
    state.groups = [];
    state.jobs = [];
    state.selectedProducts.clear();
    state.selectedGroups.clear();
    elements.logoutButton.disabled = false;
    setAuthMode('login');
    showAuth('Você saiu da conta.');
  }
});

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-go-offers]').forEach((button) => button.addEventListener('click', () => setView('offers')));
document.getElementById('menuButton').addEventListener('click', () => elements.sidebar.classList.toggle('open'));
document.getElementById('refreshButton').addEventListener('click', async () => {
  try { await refreshAll(); toast('Painel atualizado.', 'success'); } catch (error) { toast(error.message, 'error'); }
});

async function syncGroupsAction(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Sincronizando...';
  try {
    await refreshStatus();
    if (!state.ready) throw new Error('O WhatsApp ainda não está conectado de verdade.');
    await loadGroups(true);
    toast(`${state.groups.length} grupo(s) sincronizado(s).`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.getElementById('syncGroupsButton').addEventListener('click', (event) => syncGroupsAction(event.currentTarget));
document.getElementById('syncGroupsPageButton').addEventListener('click', (event) => syncGroupsAction(event.currentTarget));

async function reconnectAction(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Reconectando...';
  try {
    await api('/api/whatsapp/reconnect', { method: 'POST' });
    await refreshStatus();
    if (state.ready) await loadGroups(true);
    toast(state.ready ? 'WhatsApp reconectado.' : 'Reconexão iniciada; aguarde alguns segundos.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.querySelectorAll('[data-reconnect]').forEach((button) => {
  button.addEventListener('click', () => reconnectAction(button));
});

async function newQrAction(button) {
  if (!window.confirm('Gerar um novo QR desconectará a sessão atual. Continuar?')) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparando...';
  try {
    await api('/api/whatsapp/new-qr', { method: 'POST' });
    state.ready = false;
    state.groups = [];
    renderGroups();
    await refreshStatus();
    toast('Nova sessão iniciada. Aguarde o QR Code.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.querySelectorAll('[data-new-qr]').forEach((button) => {
  button.addEventListener('click', () => newQrAction(button));
});

document.getElementById('addManualGroupButton').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const id = elements.manualGroupId.value.trim();
  const name = elements.manualGroupName.value.trim();
  if (!id) return toast('Cole o link de convite ou o ID do grupo.', 'error');
  button.disabled = true;
  button.textContent = 'Consultando grupo...';
  try {
    const data = await api('/api/groups/manual', {
      method: 'POST',
      body: JSON.stringify({ id, name }),
    });
    state.groups = data.groups;
    elements.manualGroupId.value = '';
    elements.manualGroupName.value = '';
    renderGroups();
    toast('Grupo adicionado e pronto para seleção.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Adicionar grupo';
  }
});

elements.syncedGroupsList.addEventListener('click', async (event) => {
  const id = event.target.dataset.removeGroup;
  if (!id) return;
  try {
    const data = await api(`/api/groups/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.groups = data.groups;
    state.selectedGroups.delete(id);
    renderGroups();
    toast('Grupo manual removido.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
});

elements.importButton.addEventListener('click', async () => {
  const links = elements.linkInput.value.trim();
  if (!links) return toast('Cole pelo menos um link do Mercado Livre.', 'error');
  elements.importButton.disabled = true;
  elements.importButton.textContent = 'Buscando produtos...';
  try {
    const result = await api('/api/products/import', { method: 'POST', body: JSON.stringify({ links }) });
    elements.linkInput.value = '';
    result.imported.forEach((item) => state.selectedProducts.add(item.id));
    await loadProducts();
    const created = result.imported.filter((item) => item.created).length;
    toast(`${result.imported.length} produto(s) salvo(s)${created < result.imported.length ? ' — alguns já existiam' : ''}.`, 'success');
    if (result.errors.length) toast(`${result.errors.length} link(s) não puderam ser lidos.`, 'error');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    elements.importButton.disabled = false;
    elements.importButton.innerHTML = '<span>＋</span> Salvar produtos';
  }
});

elements.productTable.addEventListener('change', (event) => {
  const id = event.target.dataset.productCheck;
  if (!id) return;
  if (event.target.checked) state.selectedProducts.add(id); else state.selectedProducts.delete(id);
  renderSelectionSummary();
});

elements.productTable.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteProduct;
  if (id) {
    if (!window.confirm('Excluir este produto salvo?')) return;
    try {
      await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.selectedProducts.delete(id);
      await loadProducts();
      toast('Produto excluído.', 'success');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }

  if (event.target.closest('input,button,a')) return;
  const row = event.target.closest('[data-product-id]');
  if (!row) return;
  const productId = row.dataset.productId;
  if (state.selectedProducts.has(productId)) state.selectedProducts.delete(productId);
  else state.selectedProducts.add(productId);
  renderProducts();
});

elements.groupList.addEventListener('change', (event) => {
  const id = event.target.dataset.groupCheck;
  if (!id) return;
  if (event.target.checked) state.selectedGroups.add(id); else state.selectedGroups.delete(id);
  renderGroups();
});

document.getElementById('selectAllButton').addEventListener('click', () => {
  const visible = filteredProducts();
  const allSelected = visible.length > 0 && visible.every((product) => state.selectedProducts.has(product.id));
  visible.forEach((product) => allSelected ? state.selectedProducts.delete(product.id) : state.selectedProducts.add(product.id));
  renderProducts();
});

document.getElementById('selectAllGroups').addEventListener('click', () => {
  const visible = filteredGroups();
  const allSelected = visible.length > 0 && visible.every((group) => state.selectedGroups.has(group.id));
  visible.forEach((group) => allSelected ? state.selectedGroups.delete(group.id) : state.selectedGroups.add(group.id));
  renderGroups();
});

document.getElementById('shuffleButton').addEventListener('click', (event) => {
  state.shuffle = !state.shuffle;
  event.currentTarget.textContent = state.shuffle ? '✓ Ordem embaralhada' : '⇄ Embaralhar';
  renderSelectionSummary();
});

elements.productSearch.addEventListener('input', renderProducts);
elements.groupSearch.addEventListener('input', renderGroups);
elements.statusFilter.addEventListener('change', renderProducts);
elements.templateInput.addEventListener('input', renderPreview);

document.querySelectorAll('[data-token]').forEach((button) => button.addEventListener('click', () => {
  const input = elements.templateInput;
  const start = input.selectionStart;
  input.value = `${input.value.slice(0, start)}${button.dataset.token}${input.value.slice(input.selectionEnd)}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + button.dataset.token.length;
  renderPreview();
}));

document.getElementById('saveSettingsButton').addEventListener('click', async () => {
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        template: elements.templateInput.value,
        defaultDelaySeconds: Number(elements.defaultDelayInput.value),
      }),
    });
    elements.delayInput.value = state.settings.defaultDelaySeconds;
    toast('Modelo salvo.', 'success');
  } catch (error) { toast(error.message, 'error'); }
});

elements.sendButton.addEventListener('click', async () => {
  const productIds = [...state.selectedProducts];
  const groupIds = [...state.selectedGroups];
  const total = productIds.length * groupIds.length;
  if (!total) return;
  if (!window.confirm(`Iniciar ${total} envio(s) pelo WhatsApp?`)) return;

  elements.sendButton.disabled = true;
  elements.sendButton.textContent = 'Adicionando à fila...';
  try {
    const result = await api('/api/send-jobs', {
      method: 'POST',
      body: JSON.stringify({
        productIds,
        groupIds,
        delaySeconds: Number(elements.delayInput.value),
        template: state.settings.template,
        shuffle: state.shuffle,
      }),
    });
    state.selectedProducts.clear();
    renderProducts();
    toast('Lote na fila. Aguardando a confirmação real do WhatsApp.');
    await loadJobs();
    watchJob(result.job && result.job.id);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    elements.sendButton.textContent = 'Enviar ofertas';
    renderSelectionSummary();
  }
});

bootstrapAuth().catch((error) => setAuthFeedback(error.message, 'error'));
setInterval(() => {
  if (state.authenticated) refreshStatus();
}, 5000);
setInterval(async () => {
  if (!state.authenticated) return;
  try {
    await loadJobs();
    if (state.jobs.some((job) => job.status === 'sending' || job.status === 'queued')) await loadProducts();
  } catch (_) {
    // A próxima atualização tenta novamente.
  }
}, 4000);
