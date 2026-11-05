// AG Studio licence key, read from the build environment (VITE_AG_STUDIO_LICENSE_KEY; never commit
// a key). AgStudioLicenseManager.setLicenseKey is exported by ag-studio 3.0.0 and is what
// <AgStudioProvider licenseKey> calls internally; calling it once at module load sets the key
// before any Studio instance is created. With no key nothing is called, so Studio behaves exactly
// as it does unlicensed (watermark and console notice).
import { AgStudioLicenseManager } from 'ag-studio';

let applied = false;

export function studioLicenseKey(env) {
  const key = env?.VITE_AG_STUDIO_LICENSE_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

export function applyStudioLicense(env, manager = AgStudioLicenseManager) {
  const key = studioLicenseKey(env);
  if (!key || applied) return false;
  manager.setLicenseKey(key);
  applied = true;
  return true;
}

// Tests only.
export function resetStudioLicenseForTests() {
  applied = false;
}
