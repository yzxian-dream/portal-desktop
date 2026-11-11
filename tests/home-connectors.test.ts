import { describe, expect, it, vi } from 'vitest';
import { HomeConnectors, connectorIconURL } from '../desktop/main/home/connectors';
import type { HomeClient } from '../desktop/main/home/client';
import { HomeError } from '../desktop/main/home/protocol';

describe('Home Connector uninstall retries', () => {
  it('resolves service-relative icons and preserves deployment prefixes', () => {
    expect(connectorIconURL('assets/connector-icons/qq_mail.svg')).toBe('https://home.beings.town/assets/connector-icons/qq_mail.svg');
    expect(connectorIconURL('assets/connector-icons/gmail.svg', 'https://dev.example/being-home')).toBe('https://dev.example/being-home/assets/connector-icons/gmail.svg');
    for (const value of [null, undefined, 'https://evil.example/a.svg', '../a.svg']) expect(connectorIconURL(value)).toBeNull();
  });
  it('distinguishes installation conflicts from a computer operation in progress', () => {
    const conflict = new HomeError(409, 'kit_installation_plan_changed');
    expect(conflict.message).toContain('安装冲突');
    expect(conflict.message).toContain('kit_installation_plan_changed');
    expect(conflict.message).not.toContain('正在处理其他操作');
    expect(new HomeError(409, 'kit_operation_in_progress').message).toContain('正在安装或卸载');
    expect(new HomeError(409, 'kit_connector_enable_changed').message).toContain('kit_connector_enable_changed');
    expect(new HomeError(409, 'operation_in_progress').message).toContain('电脑或账号正在处理其他操作');
  });
  it('preserves the caller request id and revision after a lost response', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ status: 'preparing' });
    const connectors = new HomeConnectors({ request } as unknown as HomeClient, async () => {});
    const requestId = '20000000-0000-4000-8000-000000000001';
    await expect(connectors.lifecycle('installation', 'uninstall', 7, requestId)).rejects.toThrow('response lost');
    await connectors.lifecycle('installation', 'uninstall', 7, requestId);
    for (const [path, options] of request.mock.calls) {
      expect(path).toBe('/v1/me/kit-installations/installation/actions');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ action: 'uninstall', expected_revision: 7, request_id: requestId });
    }
    expect(request).toHaveBeenCalledTimes(2);
  });
});
