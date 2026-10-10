import type { AudioQualityPreference, ProviderAudioSource } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/ytmusicTransport.ts

export type YtmusicOperation =
    | 'search'
    | 'auth-status'
    | 'auth-login'
    | 'auth-logout'
    | 'playlists'
    | 'playlist-tracks'
    | 'playlist-detail'
    | 'song-detail'
    | 'audio-source';

export type YtmusicParams = Record<string, unknown>;

export interface YtmusicAuthStatus {
    connected: boolean;
    user?: {
        id: string;
        nickname: string;
        avatarUrl?: string;
    } | null;
}

export interface YtmusicPlaylistsResponse {
    items: unknown[];
    total?: number;
    hasMore?: boolean;
    continuation?: string;
}

export interface YtmusicPlaylistTracksResponse {
    items: unknown[];
    total?: number;
    hasMore?: boolean;
    playlist?: {
        id: string;
        title: string;
        description?: string;
        thumbnails?: Array<{ url: string; width?: number; height?: number }>;
        trackCount?: number;
        author?: string;
    } | null;
}

export interface YtmusicPlaylistDetailResponse {
    playlist?: {
        id: string;
        title: string;
        description?: string;
        thumbnails?: Array<{ url: string; width?: number; height?: number }>;
        trackCount?: number;
        author?: string;
    } | null;
}

export interface YtmusicBridgeResult<T = unknown> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export const getYtmusicTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.ytmusicRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestYtmusic<T = unknown>(
    operation: YtmusicOperation,
    params: YtmusicParams = {},
): Promise<T> {
    if (!getYtmusicTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'YouTube Music requires the desktop app', 'ytmusic');
    }
    let result: YtmusicBridgeResult<T>;
    try {
        result = (await window.electron!.ytmusicRequest(operation, params)) as YtmusicBridgeResult<T>;
    } catch {
        throw new OnlineProviderError('network', 'YouTube Music desktop request failed', 'ytmusic');
    }
    if (!result.ok) {
        throw new OnlineProviderError(
            (result.error?.code as any) || 'invalid-response',
            result.error?.message || 'YouTube Music request failed',
            'ytmusic',
        );
    }
    return result.data as T;
}

export async function getYtmusicAuthStatus(): Promise<YtmusicAuthStatus> {
    if (!getYtmusicTransportAvailability().configured) {
        return { connected: false, user: null };
    }
    return requestYtmusic<YtmusicAuthStatus>('auth-status');
}

export async function loginYtmusic(): Promise<YtmusicAuthStatus> {
    return requestYtmusic<YtmusicAuthStatus>('auth-login');
}

export async function logoutYtmusic(): Promise<YtmusicAuthStatus> {
    return requestYtmusic<YtmusicAuthStatus>('auth-logout');
}

export async function getYtmusicPlaylists(limit?: number, offset?: number): Promise<YtmusicPlaylistsResponse> {
    return requestYtmusic<YtmusicPlaylistsResponse>('playlists', { limit, offset });
}

export async function getYtmusicPlaylistTracks(
    id: string,
    limit?: number,
    offset?: number,
): Promise<YtmusicPlaylistTracksResponse> {
    return requestYtmusic<YtmusicPlaylistTracksResponse>('playlist-tracks', { id, limit, offset });
}

export async function getYtmusicPlaylistDetail(id: string): Promise<YtmusicPlaylistDetailResponse> {
    return requestYtmusic<YtmusicPlaylistDetailResponse>('playlist-detail', { id });
}

export interface YtmusicSongDetailResponse {
    song?: unknown;
}

export async function getYtmusicSongDetail(id: string): Promise<YtmusicSongDetailResponse> {
    return requestYtmusic<YtmusicSongDetailResponse>('song-detail', { id });
}

export async function getYtmusicAudioSource(
    id: string,
    quality?: AudioQualityPreference,
): Promise<ProviderAudioSource> {
    return requestYtmusic<ProviderAudioSource>('audio-source', { id, quality });
}
