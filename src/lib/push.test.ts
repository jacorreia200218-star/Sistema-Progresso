import { describe, expect, it } from 'vitest';
import { classifyPush, detectDevice, type PushEnv } from './push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const env = (o: Partial<PushEnv>): PushEnv => ({ userAgent: DESKTOP, standalone: false, supported: true, permission: 'default', subscribed: false, ...o });

describe('notificações neste dispositivo', () => {
  it('distingue computador, Android e iPhone (também o iPad que se apresenta como Mac)', () => {
    expect(detectDevice(DESKTOP)).toBe('computador');
    expect(detectDevice(ANDROID)).toBe('android');
    expect(detectDevice(IPHONE)).toBe('iphone');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('iphone');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe('computador');
  });

  it('no iPhone sem a app no ecrã principal é indisponível e pede a instalação', () => {
    expect(classifyPush(env({ userAgent: IPHONE, supported: false, permission: null }))).toMatchObject({ device: 'iphone', state: 'indisponivel', reason: 'instalar' });
    expect(classifyPush(env({ userAgent: IPHONE, standalone: true }))).toMatchObject({ state: 'por_autorizar', standalone: true });
    expect(classifyPush(env({ userAgent: IPHONE, standalone: true, supported: false, permission: null }))).toMatchObject({ state: 'indisponivel', reason: 'navegador' });
  });

  it('estados: indisponível, por autorizar, bloqueado e ativo', () => {
    expect(classifyPush(env({ supported: false, permission: null })).state).toBe('indisponivel');
    expect(classifyPush(env({ userAgent: ANDROID })).state).toBe('por_autorizar');
    expect(classifyPush(env({ permission: 'denied' })).state).toBe('bloqueado');
    expect(classifyPush(env({ permission: 'granted', subscribed: true })).state).toBe('ativo');
    // Autorizado no navegador mas sem este dispositivo registado: volta a ativar
    expect(classifyPush(env({ permission: 'granted', subscribed: false }))).toMatchObject({ state: 'por_autorizar', granted: true });
  });
});
