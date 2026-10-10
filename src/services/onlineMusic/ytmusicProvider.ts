import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderAudioSource,
    ProviderCollection,
    ProviderPage,
    ProviderSongAvailability,
    ProviderSongMetadata,
    ProviderUser,
} from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import {
    getYtmusicAudioSource,
    getYtmusicAuthStatus,
    getYtmusicPlaylistDetail,
    getYtmusicPlaylists,
    getYtmusicPlaylistTracks,
    getYtmusicSongDetail,
    getYtmusicTransportAvailability,
    loginYtmusic,
    logoutYtmusic,
    requestYtmusic,
} from './ytmusicTransport';
import {
    normalizeYtmusicCollection,
    normalizeYtmusicSong,
    normalizeYtmusicUser,
    ytmusicPage,
} from './ytmusicNormalize';

// src/services/onlineMusic/ytmusicProvider.ts

export const ytmusicProvider: OnlineMusicProvider = {
    id: 'ytmusic',
    displayName: 'YouTube Music',
    shortName: 'YT Music',
    getAvailability: getYtmusicTransportAvailability,
    capabilities: {
        search: true,
        playback: true,
        lyrics: false,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: false,
        artists: false,
        recommendations: false,
        mutations: false,
        wordByWordLyrics: false,
    },
    normalizeSong: normalizeYtmusicSong,
    normalizeUser: normalizeYtmusicUser,
    normalizeCollection: normalizeYtmusicCollection,
    songMetadata: {
        getSongMetadata(song: SongResult): ProviderSongMetadata {
            return createProviderSongMetadata(ytmusicProvider.normalizeSong(song));
        },
    },
    getSongPageUrl(song: SongResult): string | null {
        const mediaId = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'ytmusic'
            ? song.sourceRef.mediaId
            : song.id;
        return mediaId ? `https://music.youtube.com/watch?v=${encodeURIComponent(String(mediaId))}` : null;
    },
    search: {
        async searchSongs(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
            const trimmed = query.trim();
            if (!trimmed) {
                return ytmusicPage([], 0, offset, limit);
            }
            const data = await requestYtmusic<{ items?: unknown[]; total?: number }>('search', {
                query: trimmed,
                limit,
                offset,
            });
            const rawItems = Array.isArray(data?.items) ? data.items : [];
            const songs = rawItems.map(normalizeYtmusicSong);
            return ytmusicPage(songs, data?.total, offset, limit);
        },
    },
    auth: {
        async getLoginStatus(): Promise<ProviderUser | null> {
            const status = await getYtmusicAuthStatus();
            return status.connected && status.user ? normalizeYtmusicUser(status.user) : null;
        },
        async login(): Promise<ProviderUser | null> {
            const status = await loginYtmusic();
            return status.connected && status.user ? normalizeYtmusicUser(status.user) : null;
        },
        async logout(): Promise<void> {
            await logoutYtmusic();
        },
    },
    library: {
        async getUserPlaylists(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
            const data = await getYtmusicPlaylists(limit, offset);
            const rawItems = Array.isArray(data?.items) ? data.items : [];
            const collections = rawItems.map(item => normalizeYtmusicCollection(item, 'playlist'));
            return ytmusicPage(collections, data?.total, offset, limit);
        },
    },
    catalog: {
        canResolveSongCatalogRefs(song: UnifiedSong): boolean {
            return song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'ytmusic';
        },
        async resolveSongCatalogRefs(song: UnifiedSong): Promise<UnifiedSong> {
            return song;
        },
        async getPlaylistTracks(
            id: MediaId,
            limit: number,
            offset: number,
            collection?: ProviderCollection,
        ): Promise<ProviderPage<UnifiedSong>> {
            const data = await getYtmusicPlaylistTracks(String(id), limit, offset);
            const rawItems = Array.isArray(data?.items) ? data.items : [];
            const songs = rawItems.map(normalizeYtmusicSong);
            return ytmusicPage(songs, data?.total, offset, limit);
        },
        async getPlaylistDetail(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null> {
            if (collection && collection.id === id) {
                return collection;
            }
            const data = await getYtmusicPlaylistDetail(String(id));
            if (!data?.playlist) return collection ?? null;
            return normalizeYtmusicCollection(data.playlist, 'playlist');
        },
    },
    playback: {
        async getSongDetail(id: MediaId): Promise<UnifiedSong | null> {
            const mediaId = String(id).trim();
            if (!mediaId) return null;
            const data = await getYtmusicSongDetail(mediaId);
            return data?.song ? normalizeYtmusicSong(data.song) : null;
        },
        async getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource | null> {
            const source = song.sourceRef;
            if (source && (source.kind !== 'online' || source.providerId !== 'ytmusic')) {
                throw new OnlineProviderError('unsupported', 'Song does not belong to YouTube Music', 'ytmusic');
            }
            const mediaId = source?.kind === 'online' && source.providerId === 'ytmusic'
                ? source.mediaId
                : String(song.id || '').trim();
            if (!mediaId) {
                throw new OnlineProviderError('unavailable', 'YouTube Music song ID is missing', 'ytmusic');
            }
            return getYtmusicAudioSource(mediaId, quality);
        },
        getAvailability(song: SongResult): ProviderSongAvailability {
            return { state: 'playable' };
        },
    },
};
