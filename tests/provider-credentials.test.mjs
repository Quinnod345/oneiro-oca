import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getProviderCredential,
  hasProviderCredential
} from '../provider-credentials.js';

test('provider credentials load from a private file without env key values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oneiro-provider-creds-'));
  try {
    const credentialsPath = join(dir, 'provider-credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({
      openaiApiKey: 'sk-file',
      anthropicApiKey: 'sk-ant-file'
    }));

    const env = { ONEIRO_PROVIDER_CREDENTIALS_FILE: credentialsPath };
    assert.equal(getProviderCredential('OPENAI_API_KEY', env), 'sk-file');
    assert.equal(getProviderCredential('ANTHROPIC_API_KEY', env), 'sk-ant-file');
    assert.equal(hasProviderCredential('OPENAI_API_KEY', env), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider credentials prefer explicit env keys for local dev runs', () => {
  const env = {
    OPENAI_API_KEY: 'sk-env',
    ONEIRO_PROVIDER_CREDENTIALS_FILE: '/tmp/missing-oneiro-provider-creds.json'
  };

  assert.equal(getProviderCredential('OPENAI_API_KEY', env), 'sk-env');
});
