const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
).trim();
const SUPABASE_SECRET_KEY = String(
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || '')
  .trim()
  .replace(/\/$/, '');

const ACCESS_COOKIE = 'pb_access_token';
const REFRESH_COOKIE = 'pb_refresh_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const PERMISSION_DEFINITIONS = Object.freeze([
  { key: 'overview', label: 'Visão geral', description: 'Ver indicadores e o histórico da operação.' },
  { key: 'products', label: 'Produtos', description: 'Ver, cadastrar e excluir links de produtos.' },
  { key: 'groups', label: 'Grupos', description: 'Ver, sincronizar e selecionar grupos de destino.' },
  { key: 'send', label: 'Envios', description: 'Criar lotes e acompanhar o envio das ofertas.' },
  { key: 'template', label: 'Modelo da mensagem', description: 'Ver e editar o texto usado nas publicações.' },
  { key: 'whatsapp', label: 'WhatsApp', description: 'Conectar, trocar e administrar a sessão do WhatsApp.' },
]);
const PERMISSION_KEYS = Object.freeze(PERMISSION_DEFINITIONS.map((item) => item.key));

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)
    && SUPABASE_KEY.length >= 20
    && SUPABASE_SECRET_KEY.length >= 20
    && validEmail(OWNER_EMAIL);
}

function isOwnerEmail(value) {
  return Boolean(OWNER_EMAIL)
    && String(value || '').trim().toLowerCase() === OWNER_EMAIL;
}

function normalizePermissions(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, source[key] === true]));
}

function accessForUser(user) {
  const owner = Boolean(user && isOwnerEmail(user.email));
  const stored = normalizePermissions(user && user.app_metadata && user.app_metadata.pb_permissions);
  const permissions = owner
    ? Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true]))
    : stored;
  return {
    owner,
    permissions,
    hasAnyPermission: owner || Object.values(permissions).some(Boolean),
  };
}

function createSupabaseClient() {
  if (!isConfigured()) throw new Error('A autenticação do painel ainda não foi configurada.');
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function createAdminClient() {
  if (!isConfigured()) throw new Error('A autenticação do painel ainda não foi configurada.');
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    try {
      result[name] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_) {
      result[name] = '';
    }
  }
  return result;
}

function usesSecureCookies(req) {
  if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'false') return false;
  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return process.env.NODE_ENV === 'production' || req.secure || forwarded === 'https';
}

function serializeCookie(name, value, req, maxAge = COOKIE_MAX_AGE) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    'Priority=High',
  ];
  if (usesSecureCookies(req)) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookies(req, res, session) {
  if (!session || !session.access_token || !session.refresh_token) return;
  res.append('Set-Cookie', serializeCookie(ACCESS_COOKIE, session.access_token, req));
  res.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, session.refresh_token, req));
  res.set('Cache-Control', 'private, no-store');
}

function clearSessionCookies(req, res) {
  res.append('Set-Cookie', serializeCookie(ACCESS_COOKIE, '', req, 0));
  res.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, '', req, 0));
  res.set('Cache-Control', 'private, no-store');
}

function publicUser(user) {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  const access = accessForUser(user);
  return {
    id: user.id,
    email: user.email || '',
    name: String(metadata.full_name || metadata.name || '').trim()
      || String(user.email || '').split('@')[0],
    emailConfirmed: Boolean(user.email_confirmed_at),
    createdAt: user.created_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    owner: access.owner,
    permissions: access.permissions,
    hasAnyPermission: access.hasAnyPermission,
  };
}

function friendlyAuthError(error) {
  const message = String((error && error.message) || 'Falha na autenticação.');
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/user already registered/i.test(message)) return 'Já existe uma conta com este e-mail.';
  if (/email address not authorized/i.test(message)) {
    return 'O serviço de e-mail ainda não está liberado para este endereço. Fale com o administrador.';
  }
  if (/password.*(weak|short|characters)/i.test(message)) {
    return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }
  return message;
}

function signupRedirectOptions() {
  if (!/^https?:\/\//i.test(PUBLIC_APP_URL)) return {};
  return { emailRedirectTo: PUBLIC_APP_URL };
}

async function signUp({ name, email, password }) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      ...signupRedirectOptions(),
    },
  });
  if (error) throw new Error(friendlyAuthError(error));
  return {
    user: publicUser(data.user),
    session: data.session,
    requiresEmailConfirmation: Boolean(data.user && !data.session),
  };
}

async function resendSignup(email) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: signupRedirectOptions(),
  });
  if (error) throw new Error(friendlyAuthError(error));
  return { ok: true };
}

async function signIn({ email, password }) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error));
  return { user: publicUser(data.user), session: data.session };
}

async function authenticateRequest(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  if (!isConfigured()) {
    return res.status(503).json({ error: 'O acesso ao painel ainda está em configuração.' });
  }

  const cookies = parseCookies(req);
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!accessToken || !refreshToken) {
    clearSessionCookies(req, res);
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }

  try {
    const supabase = createSupabaseClient();
    let currentAccessToken = accessToken;
    let { data, error } = await supabase.auth.getUser(currentAccessToken);

    if (error || !data.user) {
      const refreshed = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (refreshed.error || !refreshed.data.session) {
        clearSessionCookies(req, res);
        return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
      }
      setSessionCookies(req, res, refreshed.data.session);
      currentAccessToken = refreshed.data.session.access_token;
      ({ data, error } = await supabase.auth.getUser(currentAccessToken));
    }

    if (error || !data.user) {
      clearSessionCookies(req, res);
      return res.status(401).json({ error: 'Sua sessão não é mais válida.' });
    }

    req.authUser = data.user;
    req.authAccess = accessForUser(data.user);
    req.publicUser = publicUser(data.user);
    req.supabaseAccessToken = currentAccessToken;
    return next();
  } catch (_) {
    return res.status(503).json({ error: 'Não foi possível validar sua conta agora. Tente novamente.' });
  }
}

function requireOwner(req, res, next) {
  if (req.authAccess && req.authAccess.owner) return next();
  return res.status(403).json({ error: 'Somente o proprietário pode realizar esta ação.' });
}

function requirePermission(permission) {
  if (!PERMISSION_KEYS.includes(permission)) throw new Error(`Permissão inválida: ${permission}`);
  return (req, res, next) => {
    if (req.authAccess && (req.authAccess.owner || req.authAccess.permissions[permission])) {
      return next();
    }
    return res.status(403).json({ error: 'Sua conta ainda não tem permissão para esta função.' });
  };
}

function requireAnyPermission(...permissions) {
  const wanted = permissions.length > 0 ? permissions : PERMISSION_KEYS;
  if (wanted.some((permission) => !PERMISSION_KEYS.includes(permission))) {
    throw new Error('Uma permissão informada é inválida.');
  }
  return (req, res, next) => {
    const access = req.authAccess;
    if (access && (access.owner || wanted.some((key) => access.permissions[key]))) return next();
    return res.status(403).json({ error: 'Sua conta ainda não tem permissão para esta função.' });
  };
}

async function listUsers() {
  const admin = createAdminClient();
  const users = [];
  const perPage = 1000;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(friendlyAuthError(error));
    const batch = Array.isArray(data && data.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users
    .map(publicUser)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || a.email.localeCompare(b.email));
}

async function updateUserPermissions(userId, permissions) {
  const admin = createAdminClient();
  const { data: current, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError || !current || !current.user) {
    throw new Error(getError ? friendlyAuthError(getError) : 'Conta não encontrada.');
  }
  if (isOwnerEmail(current.user.email)) return publicUser(current.user);

  const appMetadata = current.user.app_metadata && typeof current.user.app_metadata === 'object'
    ? current.user.app_metadata
    : {};
  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...appMetadata,
      pb_permissions: normalizePermissions(permissions),
    },
  });
  if (error || !data.user) {
    throw new Error(error ? friendlyAuthError(error) : 'Não foi possível atualizar as permissões.');
  }
  return publicUser(data.user);
}

async function signOut(req, res) {
  const cookies = parseCookies(req);
  try {
    if (cookies[ACCESS_COOKIE] && cookies[REFRESH_COOKIE] && isConfigured()) {
      const supabase = createSupabaseClient();
      const session = await supabase.auth.setSession({
        access_token: cookies[ACCESS_COOKIE],
        refresh_token: cookies[REFRESH_COOKIE],
      });
      if (!session.error) await supabase.auth.signOut({ scope: 'local' });
    }
  } finally {
    clearSessionCookies(req, res);
  }
}

module.exports = {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  isConfigured,
  isOwnerEmail,
  normalizePermissions,
  accessForUser,
  signUp,
  resendSignup,
  signIn,
  signOut,
  authenticateRequest,
  requireOwner,
  requirePermission,
  requireAnyPermission,
  listUsers,
  updateUserPermissions,
  setSessionCookies,
  clearSessionCookies,
  publicUser,
};
