import { describe, expect, it, vi } from 'vitest';
import { createYtmusicApiBridge } from '../../../electron/ytmusicApiBridge.cjs';

// test/unit/onlineMusic/ytmusicApiBridge.test.ts

describe('YouTube Music Electron API Bridge', () => {
    it('returns empty results for empty or whitespace query without calling Innertube', async () => {
        const innertubeFactory = vi.fn();
        const bridge = createYtmusicApiBridge({ innertubeFactory });

        const result = await bridge.request('search', { query: '   ' });
        expect(result).toEqual({ ok: true, data: { items: [], total: 0 } });
        expect(innertubeFactory).not.toHaveBeenCalled();
    });

    it('returns unsupported error for unregistered operations', async () => {
        const bridge = createYtmusicApiBridge();
        const result = await bridge.request('unknown_op');
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('unsupported');
    });

    it('queries Innertube and extracts clean JSON song items', async () => {
        const mockSearch = vi.fn().mockResolvedValue({
            songs: {
                contents: [
                    {
                        id: 'test-video-id',
                        title: 'Test Song Title',
                        artists: [{ id: 'channel-1', name: 'Artist Name' }],
                        album: { id: 'album-1', name: 'Album Name' },
                        duration: { seconds: 180, text: '3:00' },
                        thumbnails: [{ url: 'https://img.youtube.com/vi/test/0.jpg', width: 120, height: 120 }],
                    },
                ],
            },
        });
        const mockInnertube = {
            music: {
                search: mockSearch,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('search', { query: 'Test Query' });
        expect(result.ok).toBe(true);
        expect(result.data?.items).toHaveLength(1);
        expect(result.data?.items[0]).toEqual({
            id: 'test-video-id',
            title: 'Test Song Title',
            artists: [{ id: 'channel-1', name: 'Artist Name' }],
            album: { id: 'album-1', name: 'Album Name' },
            durationSeconds: 180,
            durationText: '3:00',
            thumbnails: [{ url: 'https://img.youtube.com/vi/test/0.jpg', width: 120, height: 120 }],
        });
    });

    it('handles Innertube request exceptions gracefully', async () => {
        const mockSearch = vi.fn().mockRejectedValue(new Error('Network error from Google'));
        const mockInnertube = {
            music: {
                search: mockSearch,
            },
        };
        const bridge = createYtmusicApiBridge({
            innertubeFactory: () => mockInnertube,
            warn: vi.fn(),
        });

        const result = await bridge.request('search', { query: 'Failing Query' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('network');
        expect(result.error?.message).toContain('Network error from Google');
    });

    it('rejects playlists request with auth-required when not logged in', async () => {
        const mockInnertube = {
            session: { logged_in: false },
        };
        const bridge = createYtmusicApiBridge({
            innertubeFactory: () => mockInnertube,
            warn: vi.fn(),
        });

        const result = await bridge.request('playlists');
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('auth-required');
    });

    it('fetches user playlists and normalizes MusicTwoRowItems', async () => {
        const mockBrowse = vi.fn().mockResolvedValue({
            contents_memo: new Map([
                [
                    'MusicTwoRowItem',
                    [
                        {
                            id: 'LM',
                            title: { text: 'Liked Music' },
                            subtitle: { text: 'Auto playlist • 120 songs' },
                            item_count: '120 songs',
                            thumbnail: [{ url: 'https://img/liked.jpg', width: 512, height: 512 }],
                        },
                        {
                            endpoint: { payload: { browseId: 'VLPLtest123' } },
                            title: { text: 'My J-Pop Favorites' },
                            subtitle: { text: 'Playlist • 35 songs' },
                            item_count: '35 songs',
                            author: { name: 'Alice' },
                            thumbnail: [{ url: 'https://img/jpop.jpg', width: 512, height: 512 }],
                        },
                    ],
                ],
            ]),
        });
        const mockInnertube = {
            session: { logged_in: true },
            actions: {
                execute: mockBrowse,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('playlists', { limit: 50, offset: 0 });
        expect(result.ok).toBe(true);
        expect(result.data?.items).toHaveLength(2);
        expect(result.data?.items[0]).toEqual({
            id: 'LM',
            name: 'Liked Music',
            description: '',
            trackCount: 120,
            author: '',
            thumbnails: [{ url: 'https://img/liked.jpg', width: 512, height: 512 }],
        });
        expect(result.data?.items[1]).toEqual({
            id: 'PLtest123',
            name: 'My J-Pop Favorites',
            description: '',
            trackCount: 35,
            author: 'Alice',
            thumbnails: [{ url: 'https://img/jpop.jpg', width: 512, height: 512 }],
        });
        expect(mockBrowse).toHaveBeenCalledWith('/browse', {
            client: 'YTMUSIC',
            browseId: 'FEmusic_liked_playlists',
            parse: true,
        });
    });

    it('fetches playlist tracks, normalizes metadata and handles pagination', async () => {
        const mockGetPlaylist = vi.fn().mockResolvedValue({
            header: {
                title: { text: 'Super Playlist' },
                description: { text: 'Awesome tracks' },
                song_count: { text: '2 songs' },
                thumbnails: [{ url: 'https://img/cover.jpg', width: 512, height: 512 }],
                author: { name: 'Bob' },
            },
            items: [
                {
                    id: 'song-1',
                    title: 'Song One',
                    artists: [{ channel_id: 'art-1', name: 'Artist One' }],
                    album: { id: 'alb-1', name: 'Album One' },
                    duration: { seconds: 200, text: '3:20' },
                    thumbnails: [{ url: 'https://img/song1.jpg', width: 120, height: 120 }],
                },
                {
                    id: 'song-2',
                    title: 'Song Two',
                    artists: [{ channel_id: 'art-2', name: 'Artist Two' }],
                    album: { id: 'alb-2', name: 'Album Two' },
                    duration: { seconds: 180, text: '3:00' },
                    thumbnails: [{ url: 'https://img/song2.jpg', width: 120, height: 120 }],
                },
            ],
            has_continuation: false,
        });
        const mockInnertube = {
            session: { logged_in: true },
            music: {
                getPlaylist: mockGetPlaylist,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('playlist-tracks', { id: 'PLabc123', limit: 50, offset: 0 });
        expect(result.ok).toBe(true);
        expect(mockGetPlaylist).toHaveBeenCalledWith('PLabc123');
        expect(result.data?.items).toHaveLength(2);
        expect(result.data?.items[0]).toEqual({
            id: 'song-1',
            title: 'Song One',
            artists: [{ id: 'art-1', name: 'Artist One' }],
            album: { id: 'alb-1', name: 'Album One' },
            durationSeconds: 200,
            durationText: '3:20',
            thumbnails: [{ url: 'https://img/song1.jpg', width: 120, height: 120 }],
        });
        expect(result.data?.playlist).toEqual({
            id: 'PLabc123',
            title: 'Super Playlist',
            description: 'Awesome tracks',
            author: 'Bob',
            trackCount: 2,
            thumbnails: [{ url: 'https://img/cover.jpg', width: 512, height: 512 }],
        });
    });

    it('fetches playlist continuation when requested tracks exceed current items', async () => {
        const mockContinuation = vi.fn().mockResolvedValue({
            items: [
                {
                    id: 'song-3',
                    title: 'Song Three',
                    artists: [{ channel_id: 'art-3', name: 'Artist Three' }],
                    duration: { seconds: 240, text: '4:00' },
                },
            ],
            has_continuation: false,
        });
        const mockGetPlaylist = vi.fn().mockResolvedValue({
            header: {
                title: { text: 'Long Playlist' },
                song_count: { text: '3 songs' },
            },
            items: [
                { id: 'song-1', title: 'Song One' },
                { id: 'song-2', title: 'Song Two' },
            ],
            has_continuation: true,
            getContinuation: mockContinuation,
        });
        const mockInnertube = {
            session: { logged_in: true },
            music: {
                getPlaylist: mockGetPlaylist,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('playlist-tracks', { id: 'PLlong', limit: 3, offset: 0 });
        expect(result.ok).toBe(true);
        expect(mockContinuation).toHaveBeenCalled();
        expect(result.data?.items).toHaveLength(3);
        expect(result.data?.items[2].id).toBe('song-3');
    });

    it('handles empty playlists gracefully', async () => {
        const mockGetPlaylist = vi.fn().mockResolvedValue({
            header: {
                title: { text: 'Empty Playlist' },
                song_count: { text: '0 songs' },
            },
            items: [],
            has_continuation: false,
        });
        const mockInnertube = {
            session: { logged_in: true },
            music: {
                getPlaylist: mockGetPlaylist,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('playlist-tracks', { id: 'PLempty', limit: 50, offset: 0 });
        expect(result.ok).toBe(true);
        expect(result.data?.items).toEqual([]);
        expect(result.data?.total).toBe(0);
        expect(result.data?.hasMore).toBe(false);
    });

    it('retrieves playlist detail without reloading all tracks if cached', async () => {
        const mockGetPlaylist = vi.fn().mockResolvedValue({
            header: {
                title: { text: 'Detail Playlist' },
                description: { text: 'Playlist description' },
                song_count: { text: '5 songs' },
                thumbnails: [{ url: 'https://img/cover.jpg', width: 512, height: 512 }],
            },
            items: [],
            has_continuation: false,
        });
        const mockInnertube = {
            session: { logged_in: true },
            music: {
                getPlaylist: mockGetPlaylist,
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('playlist-detail', { id: 'PLdetail' });
        expect(result.ok).toBe(true);
        expect(result.data?.playlist).toEqual({
            id: 'PLdetail',
            title: 'Detail Playlist',
            description: 'Playlist description',
            trackCount: 5,
            thumbnails: [{ url: 'https://img/cover.jpg', width: 512, height: 512 }],
            author: '',
        });
    });

    it('requires a video ID for audio-source request', async () => {
        const bridge = createYtmusicApiBridge();
        const result = await bridge.request('audio-source', { id: '   ' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('unavailable');
    });

    it('resolves audio-source with format selection, deciphering, expiration, and replay gain', async () => {
        const mockDecipher251 = vi.fn().mockResolvedValue('https://rr1---sn.googlevideo.com/videoplayback?expire=1791480000&id=test');
        const mockDecipher140 = vi.fn().mockResolvedValue('https://rr1---sn.googlevideo.com/videoplayback?expire=1791480000&id=test-140');
        const mockInnertube = {
            session: { player: { mockPlayer: true } },
            music: {
                getInfo: vi.fn().mockResolvedValue({
                    playability_status: { status: 'OK' },
                    streaming_data: {
                        adaptive_formats: [
                            {
                                itag: 251,
                                mime_type: 'audio/webm; codecs="opus"',
                                bitrate: 160000,
                                has_audio: true,
                                has_video: false,
                                loudness_db: -5.5,
                                decipher: mockDecipher251,
                            },
                            {
                                itag: 140,
                                mime_type: 'audio/mp4; codecs="mp4a.40.2"',
                                bitrate: 128000,
                                has_audio: true,
                                has_video: false,
                                loudness_db: -5.5,
                                decipher: mockDecipher140,
                            },
                            {
                                itag: 137,
                                mime_type: 'video/mp4',
                                bitrate: 4000000,
                                has_audio: false,
                                has_video: true,
                            },
                        ],
                    },
                }),
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const resultHigh = await bridge.request('audio-source', { id: 'test-vid-1', quality: 'high' });
        expect(resultHigh.ok).toBe(true);
        expect(resultHigh.data?.url).toBe('https://rr1---sn.googlevideo.com/videoplayback?expire=1791480000&id=test');
        expect(resultHigh.data?.expiresAt).toBe(1791480000000);
        expect(resultHigh.data?.replayGain).toEqual({ trackGain: 5.5 });
        expect(mockDecipher251).toHaveBeenCalled();

        const resultStd = await bridge.request('audio-source', { id: 'test-vid-1', quality: 'standard' });
        expect(resultStd.ok).toBe(true);
        expect(resultStd.data?.url).toBe('https://rr1---sn.googlevideo.com/videoplayback?expire=1791480000&id=test-140');
        expect(mockDecipher140).toHaveBeenCalled();
    });

    it('rejects audio-source if video is unplayable or restricted', async () => {
        const mockInnertube = {
            session: {},
            music: {
                getInfo: vi.fn().mockResolvedValue({
                    playability_status: {
                        status: 'LOGIN_REQUIRED',
                        reason: 'Sign in to confirm your age',
                    },
                }),
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('audio-source', { id: 'age-gated-id' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('auth-required');
        expect(result.error?.message).toContain('Sign in');
    });

    it('rejects audio-source if no audio formats are available', async () => {
        const mockInnertube = {
            session: {},
            music: {
                getInfo: vi.fn().mockResolvedValue({
                    playability_status: { status: 'OK' },
                    streaming_data: {
                        adaptive_formats: [
                            { itag: 137, has_audio: false, has_video: true },
                        ],
                    },
                }),
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('audio-source', { id: 'no-audio-id' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('not-playable');
    });

    it('retrieves song-detail with sanitized metadata', async () => {
        const mockInnertube = {
            session: {},
            music: {
                getInfo: vi.fn().mockResolvedValue({
                    basic_info: {
                        id: 'song-xyz',
                        title: 'Song Title XYZ',
                        author: 'Song Artist',
                        channel_id: 'channel-xyz',
                        duration: 210,
                        thumbnail: [{ url: 'https://img/song.jpg', width: 500, height: 500 }],
                    },
                }),
            },
        };
        const bridge = createYtmusicApiBridge({ innertubeFactory: () => mockInnertube });

        const result = await bridge.request('song-detail', { id: 'song-xyz' });
        expect(result.ok).toBe(true);
        expect(result.data?.song).toEqual({
            id: 'song-xyz',
            title: 'Song Title XYZ',
            artists: [{ id: 'channel-xyz', name: 'Song Artist' }],
            durationSeconds: 210,
            durationText: '3:30',
            thumbnails: [{ url: 'https://img/song.jpg', width: 500, height: 500 }],
        });
    });
});
