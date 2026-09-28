import { existsSync, readFileSync } from 'node:fs';

export function loadEnvFile(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((values, line) => {
      const separatorIndex = line.indexOf('=');

      if (separatorIndex === -1) {
        return values;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');

      if (key) {
        values[key] = value;
      }

      return values;
    }, {});
}

export function loadEnvFromFile(fileUrl = new URL('../../.env', import.meta.url)) {
  if (!existsSync(fileUrl)) {
    return {};
  }

  return loadEnvFile(readFileSync(fileUrl, 'utf8'));
}

export function applyEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
