import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/ytmusicProvider.test.ts

const request = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const loginMock = vi.hoisted(() => vi.fn());
const logoutMock = vi.hoisted(() => vi.fn());
const getPlaylistsMock = vi.hoisted(() => vi.fn());
const getPlaylistTracksMock = vi.hoisted(() => vi.fn());
const getPlaylistDetailMock = vi.hoisted(() => vi.fn());
const getAudioSourceMock = vi.hoisted(() => vi.fn());
const getSongDetailMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/ytmusicTransport', () => ({
    requestYtmusic: request,
    getYtmusicTransportAvailability: () => ({ configured: true }),
    getYtmusicAuthStatus: getAuthStatusMock,
    loginYtmusic: loginMock,
    logoutYtmusic: logoutMock,
    getYtmusicPlaylists: getPlaylistsMock,
    getYtmusicPlaylistTracks: getPlaylistTracksMock,
    getYtmusicPlaylistDetail: getPlaylistDetailMock,
    getYtmusicAudioSource: getAudioSourceMock,
    getYtmusicSongDetail: getSongDetailMock,
}));

import { ytmusicProvider } from '@/services/onlineMusic/ytmusicProvider';
import {
    normalizeYtmusicCollection,
    normalizeYtmusicSong,
    normalizeYtmusicThumbnail,
    normalizeYtmusicUser,
} from '@/services/onlineMusic/ytmusicNormalize';
import { getOnlineMusicProvider, providerSupports } from '@/services/onlineMusic/providerRegistry';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

const sampleRawSong = {
    id: 'by4SYYWlhEs',
    title: '夜に駆ける',
    artists: [
        { id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' },
    ],
    album: {
        id: 'MPREb_LfJd6hctedK',
        name: '夜に駆ける',
    },
    durationSeconds: 262,
    thumbnails: [
        { url: 'https://yt3.googleusercontent.com/cover=w120-h120', width: 120, height: 120 },
        { url: 'https://yt3.googleusercontent.com/cover=w512-h512', width: 512, height: 512 },
    ],
};

beforeEach(() => {
    request.mockReset();
    getAuthStatusMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    getPlaylistsMock.mockReset();
    getPlaylistTracksMock.mockReset();
    getPlaylistDetailMock.mockReset();
    getAudioSourceMock.mockReset();
    getSongDetailMock.mockReset();
});

describe('YouTube Music provider', () => {
    it('is registered with search, auth, userLibrary, playlists, and playback capabilities enabled in Phase 5', () => {
        expect(getOnlineMusicProvider('ytmusic')).toBe(ytmusicProvider);
        expect(providerSupports(ytmusicProvider, 'search')).toBe(true);
        expect(providerSupports(ytmusicProvider, 'auth')).toBe(true);
        expect(providerSupports(ytmusicProvider, 'userLibrary')).toBe(true);
        expect(providerSupports(ytmusicProvider, 'playlists')).toBe(true);
        expect(providerSupports(ytmusicProvider, 'playback')).toBe(true);
        expect(providerSupports(ytmusicProvider, 'lyrics')).toBe(false);
        expect(providerSupports(ytmusicProvider, 'albums')).toBe(false);
        expect(providerSupports(ytmusicProvider, 'artists')).toBe(false);
        expect(providerSupports(ytmusicProvider, 'recommendations')).toBe(false);
        expect(providerSupports(ytmusicProvider, 'mutations')).toBe(false);
        expect(ytmusicProvider.id).toBe('ytmusic');
        expect(ytmusicProvider.displayName).toBe('YouTube Music');
    });

    it('returns authenticated user via auth.getLoginStatus when session is connected', async () => {
        getAuthStatusMock.mockResolvedValue({
            connected: true,
            user: { id: '@alice', nickname: 'Alice', avatarUrl: 'https://avatar' },
        });

        const user = await ytmusicProvider.auth!.getLoginStatus();
        expect(user).toMatchObject({
            id: '@alice',
            nickname: 'Alice',
            avatarUrl: 'https://avatar',
        });
    });

    it('returns null via auth.getLoginStatus when session is disconnected', async () => {
        getAuthStatusMock.mockResolvedValue({ connected: false, user: null });

        const user = await ytmusicProvider.auth!.getLoginStatus();
        expect(user).toBeNull();
    });

    it('triggers interactive login via auth.login and returns user', async () => {
        loginMock.mockResolvedValue({
            connected: true,
            user: { id: '@bob', nickname: 'Bob' },
        });

        const user = await ytmusicProvider.auth!.login!();
        expect(user).toMatchObject({
            id: '@bob',
            nickname: 'Bob',
        });
        expect(loginMock).toHaveBeenCalled();
    });

    it('triggers logout via auth.logout', async () => {
        logoutMock.mockResolvedValue({ connected: false, user: null });

        await ytmusicProvider.auth!.logout();
        expect(logoutMock).toHaveBeenCalled();
    });

    it('fetches user playlists via library.getUserPlaylists and normalizes collections', async () => {
        getPlaylistsMock.mockResolvedValue({
            items: [
                {
                    id: 'LM',
                    name: 'Liked Music',
                    trackCount: 50,
                    thumbnails: [{ url: 'https://img/liked.jpg', width: 512, height: 512 }],
                },
                {
                    id: 'PLtest',
                    name: 'My Playlist',
                    trackCount: 20,
                    author: 'Alice',
                    thumbnails: [{ url: 'https://img/pl.jpg', width: 512, height: 512 }],
                },
            ],
            total: 2,
        });

        const page = await ytmusicProvider.library!.getUserPlaylists('user-1', 50, 0);
        expect(getPlaylistsMock).toHaveBeenCalledWith(50, 0);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({
            providerId: 'ytmusic',
            id: 'LM',
            name: 'Liked Music',
            trackCount: 50,
        });
        expect(page.items[1]).toMatchObject({
            providerId: 'ytmusic',
            id: 'PLtest',
            name: 'My Playlist',
            trackCount: 20,
        });
    });

    it('fetches playlist tracks via catalog.getPlaylistTracks and normalizes songs', async () => {
        getPlaylistTracksMock.mockResolvedValue({
            items: [sampleRawSong],
            total: 1,
        });

        const page = await ytmusicProvider.catalog!.getPlaylistTracks!('PLtest', 50, 0);
        expect(getPlaylistTracksMock).toHaveBeenCalledWith('PLtest', 50, 0);
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
            id: 'by4SYYWlhEs',
            name: '夜に駆ける',
            sourceRef: {
                kind: 'online',
                providerId: 'ytmusic',
                mediaId: 'by4SYYWlhEs',
            },
        });
    });

    it('fetches playlist detail via catalog.getPlaylistDetail', async () => {
        getPlaylistDetailMock.mockResolvedValue({
            playlist: {
                id: 'PLtest',
                title: 'Playlist Detail',
                trackCount: 15,
                thumbnails: [{ url: 'https://img/cover.jpg', width: 512, height: 512 }],
            },
        });

        const detail = await ytmusicProvider.catalog!.getPlaylistDetail!('PLtest');
        expect(getPlaylistDetailMock).toHaveBeenCalledWith('PLtest');
        expect(detail).toMatchObject({
            providerId: 'ytmusic',
            id: 'PLtest',
            name: 'Playlist Detail',
            trackCount: 15,
        });
    });

    it('normalizes track identity, artists, album, duration, and sourceRef', () => {
        const song = normalizeYtmusicSong(sampleRawSong);

        expect(song).toMatchObject({
            id: 'by4SYYWlhEs',
            name: '夜に駆ける',
            durationMs: 262000,
            album: {
                id: 'MPREb_LfJd6hctedK',
                name: '夜に駆ける',
                catalogRef: { providerId: 'ytmusic', kind: 'album', id: 'MPREb_LfJd6hctedK' },
            },
            sourceRef: {
                kind: 'online',
                providerId: 'ytmusic',
                mediaId: 'by4SYYWlhEs',
            },
        });
        expect(song.artists[0]).toMatchObject({
            name: 'YOASOBI',
            catalogRef: { providerId: 'ytmusic', kind: 'artist', id: 'UCI6B8NkZKqlFWoiC_xE-hzA' },
        });
        expect(getPlaybackSongKey(song)).toBe('online:ytmusic:by4SYYWlhEs');
        expect(normalizeYtmusicSong(song)).toEqual(song);
    });

    it('throws invalid-response when normalizing a track missing an id', () => {
        expect(() => normalizeYtmusicSong({})).toThrow('YouTube Music song has no id');
    });

    it('optimizes thumbnail resolution to 512px', () => {
        const url = normalizeYtmusicThumbnail(sampleRawSong.thumbnails);
        expect(url).toBe('https://yt3.googleusercontent.com/cover=w512-h512');
    });

    it('normalizes users and collections safely, stripping VL prefixes', () => {
        const user = normalizeYtmusicUser({ id: 'channel-1', nickname: 'Test User' });
        expect(user).toMatchObject({ id: 'channel-1', nickname: 'Test User' });

        const collection = normalizeYtmusicCollection({ id: 'VLPL123', name: 'My Playlist', trackCount: 42 });
        expect(collection).toMatchObject({
            providerId: 'ytmusic',
            id: 'PL123',
            name: 'My Playlist',
            trackCount: 42,
        });
    });

    it('returns an empty page on empty search query without invoking transport', async () => {
        const result = await ytmusicProvider.search!.searchSongs('   ', 20, 0);
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
        expect(request).not.toHaveBeenCalled();
    });

    it('delegates search to transport and returns normalized songs', async () => {
        request.mockResolvedValue({
            items: [sampleRawSong],
            total: 1,
        });

        const result = await ytmusicProvider.search!.searchSongs('YOASOBI', 20, 0);
        expect(request).toHaveBeenCalledWith('search', {
            query: 'YOASOBI',
            limit: 20,
            offset: 0,
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].name).toBe('夜に駆ける');
        expect(result.items[0].sourceRef).toEqual({
            kind: 'online',
            providerId: 'ytmusic',
            mediaId: 'by4SYYWlhEs',
        });
    });

    it('delegates getAudioSource to getYtmusicAudioSource', async () => {
        const song = normalizeYtmusicSong(sampleRawSong);
        getAudioSourceMock.mockResolvedValue({
            url: 'https://rr1---sn.googlevideo.com/videoplayback?expire=123',
            fetchedAt: 12345,
            quality: 'high',
        });

        const audio = await ytmusicProvider.playback!.getAudioSource(song, 'high');
        expect(getAudioSourceMock).toHaveBeenCalledWith('by4SYYWlhEs', 'high');
        expect(audio?.url).toBe('https://rr1---sn.googlevideo.com/videoplayback?expire=123');
    });

    it('rejects getAudioSource if song belongs to another provider', async () => {
        const foreignSong = {
            id: '123',
            name: 'Foreign Song',
            artists: [],
            album: { id: 0, name: '' },
            durationMs: 1000,
            sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '123' },
        };

        await expect(ytmusicProvider.playback!.getAudioSource(foreignSong as any, 'standard')).rejects.toThrow(
            'Song does not belong to YouTube Music',
        );
    });

    it('delegates getSongDetail to getYtmusicSongDetail and normalizes result', async () => {
        getSongDetailMock.mockResolvedValue({
            song: sampleRawSong,
        });

        const detail = await ytmusicProvider.playback!.getSongDetail('by4SYYWlhEs');
        expect(getSongDetailMock).toHaveBeenCalledWith('by4SYYWlhEs');
        expect(detail?.id).toBe('by4SYYWlhEs');
        expect(detail?.name).toBe('夜に駆ける');
    });

    it('reports availability as playable', () => {
        const song = normalizeYtmusicSong(sampleRawSong);
        expect(ytmusicProvider.playback!.getAvailability!(song)).toEqual({ state: 'playable' });
    });
});
