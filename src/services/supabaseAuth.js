const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
).trim();
const APP_URL = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
const ALLOW_SIGNUPS = String(process.env.ALLOW_SIGNUPS || 'true').toLowerCase() !== 'false';
const SIGNUP_ACCESS_CODE = String(process.env.SIGNUP_ACCESS_CODE || '').trim();
const ACCESS_COOKIE = 'pb_access_token';
const REFRESH_COOKIE = 'pb_refresh_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)
    && SUPABASE_KEY.length >= 20;
}

function signupsEnabled() {
  return ALLOW_SIGNUPS && SIGNUP_ACCESS_CODE.length >= 8;
}

function verifySignupAccessCode(value) {
  if (!signupsEnabled()) return false;
  const received = crypto.createHash('sha256').update(String(value || '')).digest();
  const expected = crypto.createHash('sha256').update(SIGNUP_ACCESS_CODE).digest();
  return crypto.timingSafeEqual(received, expected);
}

function createSupabaseClient() {
  if (!isConfigured()) throw new Error('Supabase ainda não foi configurado no EasyPanel.');
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
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
  return {
    id: user.id,
    email: user.email || '',
    name: String(metadata.full_name || metadata.name || '').trim()
      || String(user.email || '').split('@')[0],
    emailConfirmed: Boolean(user.email_confirmed_at),
    createdAt: user.created_at || null,
  };
}

function friendlyAuthError(error) {
  const message = String((error && error.message) || 'Falha na autenticação.');
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/user already registered/i.test(message)) return 'Já existe uma conta com este e-mail.';
  if (/password.*(weak|short|characters)/i.test(message)) return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
  if (/rate limit|too many requests/i.test(message)) return 'Muitas tentativas. Aguarde alguns minutos.';
  return message;
}

async function signUp({ name, email, password, accessCode }) {
  if (!signupsEnabled()) {
    throw new Error('A criação de contas ainda não foi liberada pelo administrador.');
  }
  if (!verifySignupAccessCode(accessCode)) {
    throw new Error('Código de acesso incorreto.');
  }
  const supabase = createSupabaseClient();
  const options = {
    data: { full_name: name },
  };
  if (/^https?:\/\//i.test(APP_URL)) options.emailRedirectTo = APP_URL;

  const { data, error } = await supabase.auth.signUp({ email, password, options });
  if (error) throw new Error(friendlyAuthError(error));
  return {
    user: publicUser(data.user),
    session: data.session,
    requiresEmailConfirmation: Boolean(data.user && !data.session),
  };
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
    return res.status(503).json({ error: 'Configure o Supabase no EasyPanel para liberar o painel.' });
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
    req.publicUser = publicUser(data.user);
    req.supabaseAccessToken = currentAccessToken;
    return next();
  } catch (_) {
    return res.status(503).json({ error: 'Não foi possível validar sua conta agora. Tente novamente.' });
  }
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
  ALLOW_SIGNUPS,
  isConfigured,
  signupsEnabled,
  verifySignupAccessCode,
  signUp,
  signIn,
  signOut,
  authenticateRequest,
  setSessionCookies,
  clearSessionCookies,
  publicUser,
};
