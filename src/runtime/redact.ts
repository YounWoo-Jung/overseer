const SECRET_VALUE = '***';

const PREFIX_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{10,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /npm_[A-Za-z0-9]{10,}/g,
  /hf_[A-Za-z0-9]{10,}/g,
  /pypi-[A-Za-z0-9_-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g,
];

const ENV_ASSIGN_RE = /([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*(['"]?)([^\s'"]+)\2/gi;
const JSON_FIELD_RE = /("(?:api_?key|token|secret|password|access_token|refresh_token|authorization|private_key)")\s*:\s*"([^"]+)"/gi;
const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi;
const DB_URL_RE = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:)([^@\s]+)(@)/gi;
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

export function redactSecrets(text: string): string {
  let next = text;
  for (const pattern of PREFIX_PATTERNS) {
    next = next.replace(pattern, (token) => maskToken(token));
  }
  next = next.replace(ENV_ASSIGN_RE, (_match, key, quote) => `${key}=${quote}${SECRET_VALUE}${quote}`);
  next = next.replace(JSON_FIELD_RE, (_match, key) => `${key}: "${SECRET_VALUE}"`);
  next = next.replace(AUTH_HEADER_RE, (_match, prefix) => `${prefix}${SECRET_VALUE}`);
  next = next.replace(DB_URL_RE, (_match, prefix, _password, suffix) => `${prefix}${SECRET_VALUE}${suffix}`);
  next = next.replace(PRIVATE_KEY_RE, '-----BEGIN PRIVATE KEY-----\n***\n-----END PRIVATE KEY-----');
  return redactSensitiveUrlParams(next);
}

function maskToken(token: string): string {
  if (token.length < 18) return SECRET_VALUE;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function redactSensitiveUrlParams(text: string): string {
  return text.replace(/([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|client_secret|password|auth|jwt|secret|key|code)=)([^&#\s"']+)/gi, (_match, prefix) => `${prefix}${SECRET_VALUE}`);
}
