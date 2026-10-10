import type { Artist, UnifiedSong } from '../../types';
import type { ProviderCollection, ProviderPage, ProviderUser } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/ytmusicNormalize.ts

export type YtmusicRecord = Record<string, any>;

export const ytmusicRecord = (value: unknown): YtmusicRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? (value as YtmusicRecord) : {}
);

export const normalizeYtmusicThumbnail = (
    thumbnails?: Array<{ url: string; width?: number; height?: number }> | string,
): string => {
    if (typeof thumbnails === 'string') {
        return thumbnails.replace(/=w\d+-h\d+/, '=w512-h512');
    }
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
    const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    const best = sorted[0];
    if (!best?.url) return '';
    return best.url.replace(/=w\d+-h\d+/, '=w512-h512');
};

export const normalizeYtmusicSong = (raw: unknown): UnifiedSong => {
    const item = ytmusicRecord(raw);
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'ytmusic') {
        return item as UnifiedSong;
    }

    const id = String(item.id || item.videoId || '');
    if (!id) {
        throw new OnlineProviderError('invalid-response', 'YouTube Music song has no id', 'ytmusic');
    }

    const title = String(item.title || item.name || '').trim();
    const rawArtists = Array.isArray(item.artists)
        ? item.artists
        : item.artist
            ? (Array.isArray(item.artist) ? item.artist : [item.artist])
            : item.author
                ? (Array.isArray(item.author) ? item.author : [item.author])
                : item.uploader
                    ? [{ name: item.uploader }]
                    : [];

    const artists: Artist[] = rawArtists
        .map((a: any) => {
            const artistId = String(a?.channel_id || a?.id || 0);
            const name = String(typeof a === 'string' ? a : (a?.name || '')).trim();
            return {
                id: artistId,
                name,
                catalogRef: a?.channel_id || a?.id
                    ? { providerId: 'ytmusic' as const, kind: 'artist' as const, id: artistId }
                    : undefined,
            };
        })
        .filter((a: Artist) => a.name);

    const coverUrl = normalizeYtmusicThumbnail(item.thumbnails) || (item.thumbnail ? String(item.thumbnail) : undefined);
    const albumName = String(item.album?.name || item.album?.title || '').trim();
    const albumId = String(item.album?.id || item.album?.browseId || '');
    const album = {
        id: albumId || 0,
        name: albumName,
        coverUrl,
        catalogRef: albumId ? { providerId: 'ytmusic' as const, kind: 'album' as const, id: albumId } : undefined,
    };

    const durationMs = Number(
        item.durationMs ?? (item.durationSeconds ? Number(item.durationSeconds) * 1000 : (item.duration?.seconds ? Number(item.duration.seconds) * 1000 : 0))
    ) || 0;

    return {
        id,
        name: title || 'Unknown Title',
        artists: artists.length > 0 ? artists : [{ id: 0, name: 'Unknown Artist' }],
        album,
        durationMs,
        sourceRef: {
            kind: 'online',
            providerId: 'ytmusic',
            mediaId: id,
        },
    };
};

export const normalizeYtmusicUser = (raw: unknown): ProviderUser => {
    const user = ytmusicRecord(raw);
    return {
        id: String(user.id || user.channelId || 0),
        nickname: String(user.nickname || user.name || ''),
        avatarUrl: normalizeYtmusicThumbnail(user.thumbnails) || (user.avatarUrl ? String(user.avatarUrl) : undefined),
    };
};

export const normalizeYtmusicCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = ytmusicRecord(raw);
    if (item.providerId === 'ytmusic') return item as ProviderCollection;
    const id = String(item.id || item.playlistId || item.browseId || '');
    if (!id) {
        throw new OnlineProviderError('invalid-response', 'YouTube Music collection has no id', 'ytmusic');
    }
    const cleanId = id.startsWith('VL') ? id.slice(2) : id;
    return {
        providerId: 'ytmusic',
        id: cleanId,
        type,
        name: String(item.name || item.title || ''),
        coverUrl: normalizeYtmusicThumbnail(item.thumbnails) || (item.coverUrl ? String(item.coverUrl) : undefined),
        description: item.description ? String(item.description) : undefined,
        trackCount: Number(item.trackCount || item.songCount) || 0,
        creator: item.author ? { id: 0, nickname: String(item.author) } : undefined,
    };
};

export const ytmusicPage = <T>(
    items: T[],
    total?: number,
    offset = 0,
    limit = 20,
): ProviderPage<T> => ({
    items,
    total: typeof total === 'number' && Number.isFinite(total) ? total : (offset + items.length),
    hasMore: items.length >= limit,
    nextOffset: offset + items.length,
});
