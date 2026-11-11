import { afterEach, expect, it, vi } from 'vitest';
import { app } from 'electron';
import { BEING_APP_RETURN_URL, isBeingAppReturn, registerBeingAppProtocol } from '../desktop/main/app/deep-link';

vi.mock('electron', () => ({ app: {
  setAsDefaultProtocolClient: vi.fn(() => true),
  getAppPath: () => 'C:/Being/desktop', getPath: () => 'C:/Being/profile',
} }));
const original = process.defaultApp;
afterEach(() => { Object.defineProperty(process, 'defaultApp', { configurable: true, value: original }); vi.clearAllMocks(); });

it('registers a development return link with its app and profile', () => {
  Object.defineProperty(process, 'defaultApp', { configurable: true, value: true });
  expect(registerBeingAppProtocol()).toBe(true);
  expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('being-app', process.execPath,
    ['C:/Being/desktop', '--portal-desktop-user-data=C:/Being/profile']);
});

it('registers the packaged executable and accepts only the fixed return route', () => {
  Object.defineProperty(process, 'defaultApp', { configurable: true, value: false });
  registerBeingAppProtocol();
  expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('being-app');
  expect(isBeingAppReturn(BEING_APP_RETURN_URL)).toBe(true);
  for (const url of ['being-app://connector/complete?code=secret', 'being-app://connector/complete#token',
    'being-app://other/complete', 'beings://desktop/', 'https://example.com']) expect(isBeingAppReturn(url)).toBe(false);
});
