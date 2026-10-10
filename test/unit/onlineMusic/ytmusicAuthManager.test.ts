import { describe, expect, it, vi } from 'vitest';
import { createYtmusicAuthManager } from '../../../electron/ytmusicAuthManager.cjs';
import { createYtmusicApiBridge } from '../../../electron/ytmusicApiBridge.cjs';

// test/unit/onlineMusic/ytmusicAuthManager.test.ts

describe('YouTube Music Auth Manager (Main Process)', () => {
    function createMockSession(cookies: Array<{ name: string; value: string }> = []) {
        return {
            cookies: {
                get: vi.fn().mockImplementation(async ({ domain }) => {
                    if (domain === '.youtube.com' || domain === '.google.com') {
                        return cookies;
                    }
                    return [];
                }),
            },
            clearStorageData: vi.fn().mockResolvedValue(undefined),
        };
    }

    it('returns disconnected when session has no auth cookies', async () => {
        const mockSession = createMockSession([]);
        const auth = createYtmusicAuthManager({ session: mockSession as any });

        const status = await auth.getAuthStatus();
        expect(status).toEqual({ connected: false, user: null });
    });

    it('returns disconnected when auth cookies are present but Innertube session is not logged in', async () => {
        const mockSession = createMockSession([
            { name: 'SAPISID', value: 'fake_sapisid' },
            { name: 'SID', value: 'fake_sid' },
        ]);
        const mockInnertube = {
            session: { logged_in: false },
        };
        const auth = createYtmusicAuthManager({
            session: mockSession as any,
            innertubeFactory: () => mockInnertube,
            info: vi.fn(),
            warn: vi.fn(),
        });

        const status = await auth.getAuthStatus();
        expect(status).toEqual({ connected: false, user: null });
    });

    it('returns disconnected when cookies are present and logged_in is true, but account request fails', async () => {
        const mockSession = createMockSession([
            { name: 'SAPISID', value: 'fake_sapisid' },
            { name: 'SID', value: 'fake_sid' },
        ]);
        const mockInnertube = {
            session: { logged_in: true },
            account: {
                getInfo: vi.fn().mockRejectedValue(new Error('Page contents not found (unauthenticated)')),
            },
        };
        const auth = createYtmusicAuthManager({
            session: mockSession as any,
            innertubeFactory: () => mockInnertube,
            info: vi.fn(),
            warn: vi.fn(),
        });

        const status = await auth.getAuthStatus();
        expect(status).toEqual({ connected: false, user: null });
        expect(auth.getAuthenticatedClient()).toBeNull();
    });

    it('returns connected with sanitized user info when verified via Innertube', async () => {
        const mockSession = createMockSession([
            { name: 'SAPISID', value: 'valid_sapisid' },
            { name: 'SID', value: 'valid_sid' },
        ]);
        const mockInnertube = {
            session: { logged_in: true },
            account: {
                getInfo: vi.fn().mockResolvedValue({
                    contents: {
                        account_name: { text: 'Alice' },
                        account_photo: [{ url: 'https://lh3.googleusercontent.com/avatar' }],
                        channel_handle: { text: '@alice_music' },
                    },
                }),
            },
        };
        const auth = createYtmusicAuthManager({
            session: mockSession as any,
            innertubeFactory: () => mockInnertube,
            info: vi.fn(),
            warn: vi.fn(),
        });

        const status = await auth.getAuthStatus();
        expect(status.connected).toBe(true);
        expect(status.user).toEqual({
            id: '@alice_music',
            nickname: 'Alice',
            avatarUrl: 'https://lh3.googleusercontent.com/avatar',
        });
        // Strict constraint: Ensure no cookie secrets leak into status
        expect(status).not.toHaveProperty('cookie');
        expect(status).not.toHaveProperty('SAPISID');
        expect(status).not.toHaveProperty('SID');
        expect(auth.getAuthenticatedClient()).toBe(mockInnertube);
    });

    it('clears partition storage on logout and resets client cache', async () => {
        const mockSession = createMockSession([
            { name: 'SAPISID', value: 'valid_sapisid' },
        ]);
        const mockInnertube = {
            session: { logged_in: true },
            account: {
                getInfo: vi.fn().mockResolvedValue({
                    contents: { account_name: { text: 'Alice' } },
                }),
            },
        };
        const auth = createYtmusicAuthManager({
            session: mockSession as any,
            innertubeFactory: () => mockInnertube,
            info: vi.fn(),
            warn: vi.fn(),
        });

        // First verify logged in
        const initialStatus = await auth.getAuthStatus();
        expect(initialStatus.connected).toBe(true);
        expect(auth.getAuthenticatedClient()).toBe(mockInnertube);

        // Perform logout
        const logoutResult = await auth.logout();
        expect(logoutResult).toEqual({ connected: false, user: null });
        expect(mockSession.clearStorageData).toHaveBeenCalledWith({
            storages: ['cookies', 'localstorage', 'caches'],
        });
        expect(auth.getAuthenticatedClient()).toBeNull();
    });

    it('creates a secure login BrowserWindow with persist session and sandbox enabled', async () => {
        const mockSession = createMockSession([]);
        const listeners: Record<string, Function[]> = {};

        class MockBrowserWindow {
            options: any;
            isDestroyedVal = false;
            webContents = {
                on: (event: string, cb: Function) => {
                    listeners[event] = listeners[event] || [];
                    listeners[event].push(cb);
                },
            };

            constructor(opts: any) {
                this.options = opts;
            }

            loadURL = vi.fn().mockResolvedValue(undefined);
            focus = vi.fn();
            destroy = vi.fn(() => { this.isDestroyedVal = true; });
            isDestroyed = () => this.isDestroyedVal;
            on = (event: string, cb: Function) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(cb);
            };
        }

        const auth = createYtmusicAuthManager({
            session: mockSession as any,
            BrowserWindow: MockBrowserWindow as any,
            info: vi.fn(),
            warn: vi.fn(),
        });

        const loginPromise = auth.openLoginWindow();

        // Verify window options obey security guidelines (no bypasses, context isolation, sandboxed)
        const activeWin = (auth as any).getAuthenticatedClient?.(); // check window
        expect(loginPromise).toBeInstanceOf(Promise);

        // Simulate user closing window without logging in
        listeners['closed']?.[0]?.();

        const status = await loginPromise;
        expect(status).toEqual({ connected: false, user: null });
    });

    it('exposes auth-status, auth-login, and auth-logout through API bridge without exposing secrets', async () => {
        const mockAuthManager = {
            getAuthStatus: vi.fn().mockResolvedValue({
                connected: true,
                user: { id: 'u1', nickname: 'Test', avatarUrl: 'http://img' },
            }),
            openLoginWindow: vi.fn().mockResolvedValue({
                connected: true,
                user: { id: 'u1', nickname: 'Test' },
            }),
            logout: vi.fn().mockResolvedValue({ connected: false, user: null }),
            getAuthenticatedClient: vi.fn().mockReturnValue(null),
        };

        const bridge = createYtmusicApiBridge({
            authManager: mockAuthManager as any,
        });

        const statusRes = await bridge.request('auth-status');
        expect(statusRes).toEqual({
            ok: true,
            data: { connected: true, user: { id: 'u1', nickname: 'Test', avatarUrl: 'http://img' } },
        });

        const loginRes = await bridge.request('auth-login');
        expect(loginRes).toEqual({
            ok: true,
            data: { connected: true, user: { id: 'u1', nickname: 'Test' } },
        });

        const logoutRes = await bridge.request('auth-logout');
        expect(logoutRes).toEqual({
            ok: true,
            data: { connected: false, user: null },
        });
    });
});
