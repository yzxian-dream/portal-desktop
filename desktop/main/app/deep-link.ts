import { app } from 'electron';

export const BEING_APP_RETURN_URL = 'being-app://connector/complete';

export function isBeingAppReturn(url: string): boolean {
  return url === BEING_APP_RETURN_URL;
}

export function registerBeingAppProtocol() {
  if (process.defaultApp) {
    // Development launches must retain both the app entry and its isolated profile.
    return app.setAsDefaultProtocolClient('being-app', process.execPath, [
      app.getAppPath(), `--portal-desktop-user-data=${app.getPath('userData')}`,
    ]);
  }
  return app.setAsDefaultProtocolClient('being-app');
}
