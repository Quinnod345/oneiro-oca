import { existsSync, readFileSync } from 'fs';

let cachedPath = null;
let cachedCredentials = {};

function trim(value) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : '';
}

function readCredentialsFile(env = process.env) {
  const credentialsPath = trim(env.ONEIRO_PROVIDER_CREDENTIALS_FILE || env.OCA_PROVIDER_CREDENTIALS_FILE);
  if (!credentialsPath) return {};
  if (credentialsPath === cachedPath) return cachedCredentials;

  cachedPath = credentialsPath;
  cachedCredentials = {};
  try {
    if (!existsSync(credentialsPath)) return cachedCredentials;
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    if (parsed && typeof parsed === 'object') cachedCredentials = parsed;
  } catch (e) {
    console.warn(`[credentials] could not read provider credentials: ${e.message}`);
  }
  return cachedCredentials;
}

export function getProviderCredential(name, env = process.env) {
  const direct = trim(env[name]);
  if (direct) return direct;

  const credentials = readCredentialsFile(env);
  switch (name) {
    case 'ANTHROPIC_API_KEY':
      return trim(credentials.anthropicApiKey || credentials.anthropic);
    case 'OPENAI_API_KEY':
      return trim(credentials.openaiApiKey || credentials.openai);
    default:
      return '';
  }
}

export function hasProviderCredential(name, env = process.env) {
  return getProviderCredential(name, env).length > 0;
}
