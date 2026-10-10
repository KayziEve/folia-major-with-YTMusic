import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getYtmusicAudioSource,
    getYtmusicPlaylistDetail,
    getYtmusicPlaylists,
    getYtmusicPlaylistTracks,
    getYtmusicSongDetail,
    getYtmusicTransportAvailability,
    requestYtmusic,
} from '@/services/onlineMusic/ytmusicTransport';
import { OnlineProviderError } from '@/types/onlineMusic';

// test/unit/onlineMusic/ytmusicTransport.test.ts

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('YouTube Music transport', () => {
    it('detects desktop transport availability via window.electron.ytmusicRequest', () => {
        vi.stubGlobal('window', { electron: { ytmusicRequest: vi.fn() } });
        expect(getYtmusicTransportAvailability()).toEqual({ configured: true });

        vi.stubGlobal('window', {});
        expect(getYtmusicTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });

    it('throws unavailable error when runtime is not desktop', async () => {
        vi.stubGlobal('window', {});
        await expect(requestYtmusic('search', { query: 'test' })).rejects.toThrow(
            new OnlineProviderError('unavailable', 'YouTube Music requires the desktop app', 'ytmusic'),
        );
    });

    it('forwards requests to window.electron.ytmusicRequest', async () => {
        const mockData = { items: [{ id: '123', title: 'Test' }], total: 1 };
        const ytmusicRequest = vi.fn().mockResolvedValue({ ok: true, data: mockData });
        vi.stubGlobal('window', { electron: { ytmusicRequest } });

        const result = await requestYtmusic('search', { query: 'YOASOBI', limit: 20, offset: 0 });
        expect(result).toEqual(mockData);
        expect(ytmusicRequest).toHaveBeenCalledWith('search', { query: 'YOASOBI', limit: 20, offset: 0 });
    });

    it('forwards playlists, playlist-tracks, and playlist-detail operations correctly', async () => {
        const ytmusicRequest = vi.fn().mockResolvedValue({
            ok: true,
            data: { items: [], total: 0 },
        });
        vi.stubGlobal('window', { electron: { ytmusicRequest } });

        await getYtmusicPlaylists(50, 0);
        expect(ytmusicRequest).toHaveBeenCalledWith('playlists', { limit: 50, offset: 0 });

        await getYtmusicPlaylistTracks('PL123', 50, 0);
        expect(ytmusicRequest).toHaveBeenCalledWith('playlist-tracks', { id: 'PL123', limit: 50, offset: 0 });

        await getYtmusicPlaylistDetail('PL123');
        expect(ytmusicRequest).toHaveBeenCalledWith('playlist-detail', { id: 'PL123' });
    });

    it('forwards audio-source and song-detail operations correctly', async () => {
        const ytmusicRequest = vi.fn().mockResolvedValue({
            ok: true,
            data: { url: 'https://googlevideo.com/playback', fetchedAt: 12345, quality: 'high' },
        });
        vi.stubGlobal('window', { electron: { ytmusicRequest } });

        const audio = await getYtmusicAudioSource('video-123', 'high');
        expect(ytmusicRequest).toHaveBeenCalledWith('audio-source', { id: 'video-123', quality: 'high' });
        expect(audio.url).toBe('https://googlevideo.com/playback');

        await getYtmusicSongDetail('video-123');
        expect(ytmusicRequest).toHaveBeenCalledWith('song-detail', { id: 'video-123' });
    });

    it('handles transport failure and translates error code', async () => {
        const ytmusicRequest = vi.fn().mockResolvedValue({
            ok: false,
            error: { code: 'network', message: 'Failed to connect to YouTube Music' },
        });
        vi.stubGlobal('window', { electron: { ytmusicRequest } });

        await expect(requestYtmusic('search', { query: 'YOASOBI' })).rejects.toThrow(
            new OnlineProviderError('network', 'Failed to connect to YouTube Music', 'ytmusic'),
        );
    });
});
