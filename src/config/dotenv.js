import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';

function getEnvFile() {
  if (process.env.ENV_FILE) {
    const envFileDirect = resolve(process.cwd(), process.env.ENV_FILE);

    if (existsSync(envFileDirect)) {
      return envFileDirect;
    }
  }

  if (process.env.NODE_ENV) {
    const envFileAuto = resolve(process.cwd(), `.env.${process.env.NODE_ENV}`);

    if (existsSync(envFileAuto)) {
      return envFileAuto;
    }
  }

  const envFile = resolve(process.cwd(), '.env');

  return existsSync(envFile) ? envFile : null;
}

const envFile = getEnvFile();

if (envFile) {
  loadEnvFile(envFile);
}
