// src/utils/lyrics/searchQuery.ts
// Shared helpers for constructing lyric search queries from song metadata.

import { normalizeLyricMatchText } from './matchScore';

const MAX_ALBUM_QUERY_LENGTH = 48;

const normalizeArtistIdentity = (value: string): string => (
    normalizeLyricMatchText(value).replace(/\s+/gu, '')
);

const VIDEO_NOISE_REGEX = /[\(\[（【〔〈《「『]\s*(?:official\s*(?:music\s*)?video|official\s*audio|music\s*video|official|audio|mv|lyrics?|lyric\s*video|full\s*ver(?:sion)?|hd|4k|m\/v|clip\s*officiel)\s*[\)\]）】〕〉》」』]/giu;
const TRAILING_NOISE_REGEX = /\s*[-–—|/]\s*(?:official\s*(?:music\s*)?video|official\s*audio|music\s*video|lyric\s*video|mv|audio)\s*$/giu;
const TRAILING_VIDEO_TAG_REGEX = /\s+(?:official\s*(?:music\s*)?video|official\s*audio|music\s*video|lyric\s*video|mv)\s*$/giu;
const FEAT_IN_TITLE_REGEX = /[\(\[（【]\s*(?:feat|ft|featuring)\.?\s+[^\)\]）】]+[\)\]）】]/giu;

export const cleanTitleNoise = (title: string): string => {
    return title
        .replace(VIDEO_NOISE_REGEX, '')
        .replace(TRAILING_NOISE_REGEX, '')
        .replace(TRAILING_VIDEO_TAG_REGEX, '')
        .trim();
};

// Removes a duplicated "artist - title" prefix when the provider already supplies artists separately,
// and strips video/audio tags commonly found in online/YouTube titles.
export const normalizeSongTitleForLyricSearch = (
    title?: string | null,
    artist?: string | null,
): string => {
    let trimmedTitle = title?.trim() || '';
    const trimmedArtist = artist?.trim() || '';
    if (!trimmedTitle) return '';

    // Check for "Artist「Title」" pattern
    const cornerBracketMatch = trimmedTitle.match(/^(.+?)\s*[「『]([^」』]+)[」』]/u);
    if (cornerBracketMatch && trimmedArtist && normalizeArtistIdentity(cornerBracketMatch[1]) === normalizeArtistIdentity(trimmedArtist)) {
        trimmedTitle = cornerBracketMatch[2].trim();
    } else {
        const separator = trimmedTitle.match(/^(.+?)\s+-\s+(.+)$/u);
        if (separator && trimmedArtist && normalizeArtistIdentity(separator[1]) === normalizeArtistIdentity(trimmedArtist)) {
            trimmedTitle = separator[2].trim();
        }
    }

    const cleaned = cleanTitleNoise(trimmedTitle).trim();

    return cleaned || trimmedTitle;
};

// Keeps long anime/single album names useful for provider search by dropping catalog notes and credits first.
const normalizeAlbumForLyricSearch = (album?: string | null): string | null => {
    const trimmedAlbum = album?.trim();
    if (!trimmedAlbum) {
        return null;
    }

    if (trimmedAlbum.length <= MAX_ALBUM_QUERY_LENGTH) {
        return trimmedAlbum;
    }

    const compactAlbum = trimmedAlbum
        .replace(/\s*※.*$/u, '')
        .replace(/\s*(歌|歌唱|アーティスト|Artist)\s*[:：]?\s*.+$/iu, '')
        .trim();

    if (compactAlbum.length <= MAX_ALBUM_QUERY_LENGTH) {
        return compactAlbum;
    }

    return compactAlbum.slice(0, MAX_ALBUM_QUERY_LENGTH).trim();
};

export const buildLyricSearchQuery = (
    title?: string | null,
    artist?: string | null,
    album?: string | null
): string => {
    return [normalizeSongTitleForLyricSearch(title, artist), artist?.trim(), normalizeAlbumForLyricSearch(album)]
        .map(part => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' - ');
};

export const buildKugouLyricSearchQuery = (keyword: string): string => {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return trimmedKeyword;
    }

    const structuredTitle = trimmedKeyword.split(/\s+-\s+/u)[0]?.trim();
    return structuredTitle || trimmedKeyword;
};
