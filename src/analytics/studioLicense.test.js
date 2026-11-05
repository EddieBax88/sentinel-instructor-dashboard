import test from 'node:test';
import assert from 'node:assert/strict';
import { AgStudioLicenseManager } from 'ag-studio';
import { applyStudioLicense, resetStudioLicenseForTests, studioLicenseKey } from './studioLicense.js';

function fakeManager() {
  const calls = [];
  return { calls, setLicenseKey: (key) => calls.push(key) };
}

test.beforeEach(() => resetStudioLicenseForTests());

test('ag-studio 3.0.0 exports AgStudioLicenseManager.setLicenseKey', () => {
  assert.equal(typeof AgStudioLicenseManager.setLicenseKey, 'function');
});

test('no licence key: setLicenseKey is never called', () => {
  for (const env of [undefined, {}, { VITE_AG_STUDIO_LICENSE_KEY: '' }, { VITE_AG_STUDIO_LICENSE_KEY: '   ' }]) {
    const manager = fakeManager();
    assert.equal(applyStudioLicense(env, manager), false);
    assert.deepEqual(manager.calls, []);
    assert.equal(studioLicenseKey(env), undefined);
  }
});

test('licence key set: setLicenseKey is called exactly once with the trimmed key', () => {
  const manager = fakeManager();
  const env = { VITE_AG_STUDIO_LICENSE_KEY: '  fake-test-licence  ' };
  assert.equal(applyStudioLicense(env, manager), true);
  assert.equal(applyStudioLicense(env, manager), false);
  assert.equal(applyStudioLicense(env, manager), false);
  assert.deepEqual(manager.calls, ['fake-test-licence']);
});
