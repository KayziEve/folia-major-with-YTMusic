import { useCallback, useEffect, useRef } from 'react';
import { omni } from '../services/onlineMusic/omni';
import {
    clearProviderAccountSnapshot,
    loadProviderAccountSnapshot,
    saveProviderAccountSnapshot,
} from '../services/onlineMusic/providerAccountCache';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { OnlineProviderError } from '../types/onlineMusic';
import type { ProviderCollection } from '../types/onlineMusic';

// src/hooks/useYtmusicLibrary.ts
// YouTube Music library hook (Phase 4: personal playlists and library hydration).

export const useYtmusicLibrary = () => {
    const generation = useRef(0);
    const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

    const refresh = useCallback(async () => {
        const current = ++generation.current;
        const store = useOnlineProviderAccountStore.getState();
        try {
            if (!omni.getProviderAvailability('ytmusic').configured || !omni.getProviderCapabilities('ytmusic').auth) {
                store.clearAccount('ytmusic');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('ytmusic');
                return false;
            }
            store.updateAccount('ytmusic', { freshness: 'refreshing', error: undefined });
            const user = await omni.getLoginStatus('ytmusic');
            if (generation.current !== current) return false;
            if (!user) {
                store.clearAccount('ytmusic');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('ytmusic');
                return false;
            }

            // Restore public metadata only after the main-process session identifies the same account.
            const visibleUser = useOnlineProviderAccountStore.getState().accounts.ytmusic?.user;
            if (!visibleUser || String(visibleUser.id) !== String(user.id)) {
                store.clearAccount('ytmusic');
                const snapshot = await loadProviderAccountSnapshot('ytmusic').catch(() => null);
                if (generation.current !== current) return false;
                const matching = snapshot && String(snapshot.user.id) === String(user.id) ? snapshot : null;
                store.updateAccount('ytmusic', {
                    status: 'authenticated',
                    user,
                    collections: matching?.collections || [],
                    likedSongIds: matching?.likedSongIds || [],
                    hydration: 'ready',
                    freshness: 'refreshing',
                    lastUpdatedAt: matching?.savedAt,
                    error: undefined,
                });
            }

            const collections: ProviderCollection[] = [];
            const capabilities = omni.getProviderCapabilities('ytmusic');
            let offset = 0;
            if (capabilities.userLibrary) {
                while (true) {
                    const page = await omni.getProviderUserPlaylists('ytmusic', user.id, { offset, limit: 50 });
                    if (generation.current !== current) return false;
                    collections.push(...page.items);
                    if (!page.hasMore || page.nextOffset <= offset) break;
                    offset = page.nextOffset;
                }
            }

            if (generation.current !== current) return false;
            const save = pendingSave.current.catch(() => {}).then(() => {
                if (generation.current !== current) return null;
                store.updateAccount('ytmusic', {
                    status: 'authenticated',
                    user,
                    collections,
                    likedSongIds: [],
                    hydration: 'ready',
                    error: undefined,
                });
                return saveProviderAccountSnapshot('ytmusic', { user, collections, likedSongIds: [] });
            });
            pendingSave.current = save;
            const saved = await save;
            if (generation.current !== current) return false;
            if (!saved) return false;
            store.updateAccount('ytmusic', { freshness: 'fresh', lastUpdatedAt: saved.savedAt });
            return true;
        } catch (error) {
            if (generation.current !== current) return false;
            if (error instanceof OnlineProviderError && error.code === 'auth-required') {
                store.clearAccount('ytmusic', 'auth-required');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('ytmusic');
            } else {
                store.updateAccount('ytmusic', {
                    hydration: 'ready',
                    freshness: 'error',
                    status: useOnlineProviderAccountStore.getState().accounts.ytmusic?.user ? 'authenticated' : 'error',
                    error: 'ytmusic-refresh-failed',
                });
            }
            return false;
        }
    }, []);

    const logout = useCallback(async () => {
        generation.current++;
        useOnlineProviderAccountStore.getState().clearAccount('ytmusic');
        await pendingSave.current.catch(() => {});
        await Promise.all([omni.logout('ytmusic'), clearProviderAccountSnapshot('ytmusic')]);
    }, []);

    useEffect(() => {
        useOnlineProviderAccountStore.getState().clearAccount('ytmusic');
        void refresh();
        return () => {
            generation.current++;
        };
    }, [refresh]);

    return { refresh, logout };
};
