// electron/ytmusicApiBridge.cjs

const { createYtmusicAuthManager, ensurePlatformEval } = require('./ytmusicAuthManager.cjs');

const YTMUSIC_OPERATIONS = [
  'search',
  'auth-status',
  'auth-login',
  'auth-logout',
  'playlists',
  'playlist-tracks',
  'playlist-detail',
  'song-detail',
  'audio-source',
];

function parseCount(text) {
  if (typeof text === 'number') return text;
  if (!text) return undefined;
  const match = String(text).replace(/,/g, '').match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function normalizeThumbnails(thumbs) {
  if (!Array.isArray(thumbs)) {
    if (thumbs && typeof thumbs.url === 'string') {
      return [{ url: thumbs.url, width: thumbs.width || 0, height: thumbs.height || 0 }];
    }
    return [];
  }
  return thumbs
    .map(t => ({
      url: String(t.url || ''),
      width: Number(t.width || 0),
      height: Number(t.height || 0),
    }))
    .filter(t => t.url);
}

function formatTrack(item) {
  if (!item) return null;
  const id = String(item.id || item.videoId || '');
  if (!id) return null;

  const title = String(item.title?.text || item.title || item.name || '').trim();
  const artists = Array.isArray(item.artists)
    ? item.artists
        .map(artist => ({
          id: String(artist.channel_id || artist.id || ''),
          name: String(artist.name || '').trim(),
        }))
        .filter(a => a.name)
    : (item.author ? [{ id: String(item.author.channel_id || ''), name: String(item.author.name || '').trim() }] : []);

  const album = item.album
    ? {
        id: String(item.album.id || item.album.browseId || ''),
        name: String(item.album.name || item.album.title || '').trim(),
      }
    : undefined;

  const durationSeconds = Number(item.duration?.seconds || (typeof item.duration === 'number' ? item.duration : 0));
  const durationText = String(
    item.duration?.text ||
      (durationSeconds ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}` : '')
  );
  const thumbnails = normalizeThumbnails(item.thumbnails || item.thumbnail?.contents || item.thumbnail);

  return {
    id,
    title,
    artists,
    album,
    durationSeconds,
    durationText,
    thumbnails,
  };
}

function formatPlaylist(item) {
  if (!item) return null;
  let id = String(item.id || item.browseId || item.endpoint?.payload?.browseId || '');
  if (id.startsWith('VL')) {
    id = id.slice(2);
  }
  if (!id) return null;

  const name = String(item.title?.text || item.title || item.name || '').trim();
  const description = String(item.description?.text || item.description || '').trim();
  const trackCount = parseCount(item.item_count || item.song_count?.text || item.subtitle?.text);
  const author = String(item.author?.name || item.author || '').trim();
  const thumbnails = normalizeThumbnails(item.thumbnails || item.thumbnail?.contents || item.thumbnail);

  return {
    id,
    name: name || 'Untitled Playlist',
    description,
    trackCount,
    author,
    thumbnails,
  };
}

/**
 * @param {{
 *   innertubeFactory?: () => any,
 *   authManager?: ReturnType<typeof createYtmusicAuthManager>,
 *   warn?: (...data: any[]) => void
 * }} [options]
 */
function createYtmusicApiBridge({
  innertubeFactory,
  authManager,
  warn = console.warn,
} = {}) {
  let innertubePromise = null;
  const auth = authManager || createYtmusicAuthManager({ innertubeFactory, warn });
  const playlistTrackCache = new Map();

  async function getInnertube() {
    let authenticated = auth.getAuthenticatedClient();
    if (!authenticated) {
      try {
        const status = await auth.getAuthStatus();
        if (status?.connected) {
          authenticated = auth.getAuthenticatedClient();
        }
      } catch {
        // Fall back to unauthenticated
      }
    }
    if (authenticated) {
      return authenticated;
    }
    if (!innertubePromise) {
      if (typeof innertubeFactory === 'function') {
        innertubePromise = Promise.resolve(innertubeFactory());
      } else {
        innertubePromise = import('youtubei.js').then(({ Innertube, Platform }) => {
          ensurePlatformEval(Platform);
          return Innertube.create();
        });
      }
    }
    return innertubePromise;
  }

  return {
    async request(operation, params = {}) {
      try {
        if (!YTMUSIC_OPERATIONS.includes(operation)) {
          return {
            ok: false,
            error: {
              code: 'unsupported',
              message: `Unsupported YouTube Music operation: ${operation}`,
            },
          };
        }

        if (operation === 'auth-status') {
          const status = await auth.getAuthStatus();
          return { ok: true, data: status };
        }

        if (operation === 'auth-login') {
          const status = await auth.openLoginWindow();
          return { ok: true, data: status };
        }

        if (operation === 'auth-logout') {
          playlistTrackCache.clear();
          const status = await auth.logout();
          return { ok: true, data: status };
        }

        if (operation === 'search') {
          const query = String(params.query || '').trim();
          if (!query) {
            return {
              ok: true,
              data: {
                items: [],
                total: 0,
              },
            };
          }

          const yt = await getInnertube();
          const searchResult = await yt.music.search(query, { type: 'song' });
          const rawItems = searchResult.songs?.contents || searchResult.contents || [];

          const items = rawItems
            .map(item => formatTrack(item))
            .filter(Boolean);

          return {
            ok: true,
            data: {
              items,
              total: items.length,
            },
          };
        }

        if (operation === 'playlists') {
          const yt = await getInnertube();
          if (!yt.session?.logged_in) {
            return {
              ok: false,
              error: {
                code: 'auth-required',
                message: 'Sign in to YouTube Music to view your library',
              },
            };
          }

          let browseData;
          if (params.continuation) {
            browseData = await yt.actions.execute('/browse', {
              client: 'YTMUSIC',
              continuation: params.continuation,
              parse: true,
            });
          } else {
            browseData = await yt.actions.execute('/browse', {
              client: 'YTMUSIC',
              browseId: 'FEmusic_liked_playlists',
              parse: true,
            });
          }

          const rawItems = [
            ...(browseData.contents_memo?.get?.('MusicTwoRowItem') || []),
            ...(browseData.contents_memo?.get?.('MusicResponsiveListItem') || []),
          ];

          if (rawItems.length === 0 && Array.isArray(browseData.items)) {
            rawItems.push(...browseData.items);
          }
          if (rawItems.length === 0 && Array.isArray(browseData.contents)) {
            for (const c of browseData.contents) {
              if (Array.isArray(c.items)) rawItems.push(...c.items);
              if (Array.isArray(c.contents)) rawItems.push(...c.contents);
            }
          }

          const seen = new Set();
          const items = [];
          for (const raw of rawItems) {
            const p = formatPlaylist(raw);
            if (p && !seen.has(p.id)) {
              seen.add(p.id);
              items.push(p);
            }
          }

          const continuationItem = browseData.contents_memo?.get?.('ContinuationItem')?.[0];
          const gridContinuation = browseData.contents_memo?.get?.('GridContinuation')?.[0];
          const nextContinuation =
            continuationItem?.continuation ||
            gridContinuation?.continuation ||
            browseData.continuation_contents?.continuation ||
            browseData.continuation;

          const limit = Number(params.limit || 50);
          const offset = Number(params.offset || 0);
          const pageItems = items.slice(offset, offset + limit);

          return {
            ok: true,
            data: {
              items: pageItems,
              total: items.length,
              hasMore: Boolean(nextContinuation) || items.length > (offset + limit),
              continuation: nextContinuation,
            },
          };
        }

        if (operation === 'playlist-tracks') {
          const yt = await getInnertube();
          let rawId = String(params.id || '').trim();
          if (!rawId) {
            return {
              ok: false,
              error: { code: 'unavailable', message: 'Playlist ID is required' },
            };
          }
          const cleanId = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const limit = Number(params.limit || 50);
          const offset = Number(params.offset || 0);

          let cached = playlistTrackCache.get(cleanId);
          const now = Date.now();
          if (!cached || offset === 0 || now - cached.fetchedAt > 180000) {
            const playlist = await yt.music.getPlaylist(cleanId);
            const initialTracks = (playlist.items || playlist.contents || []).map(formatTrack).filter(Boolean);
            cached = {
              playlist,
              tracks: initialTracks,
              header: playlist.header,
              fetchedAt: now,
            };
            playlistTrackCache.set(cleanId, cached);
          }

          const target = offset + limit;
          let continuationLimit = 0;
          while (cached.tracks.length < target && cached.playlist?.has_continuation && continuationLimit < 15) {
            continuationLimit++;
            cached.playlist = await cached.playlist.getContinuation();
            const nextTracks = (cached.playlist.items || cached.playlist.contents || []).map(formatTrack).filter(Boolean);
            if (nextTracks.length === 0) break;
            cached.tracks.push(...nextTracks);
          }

          const pageItems = cached.tracks.slice(offset, offset + limit);
          const header = cached.header;
          const trackCount = parseCount(header?.song_count?.text || header?.song_count || header?.item_count);
          const total = trackCount !== undefined ? trackCount : cached.tracks.length;
          const hasMore = Boolean(cached.playlist?.has_continuation) || cached.tracks.length > offset + limit;

          const playlistInfo = header
            ? {
                id: cleanId,
                title: String(header.title?.text || header.title || ''),
                description: String(header.description?.text || header.description || ''),
                thumbnails: normalizeThumbnails(header.thumbnails || header.thumbnail?.contents || header.thumbnail),
                trackCount: total,
                author: String(header.author?.name || header.author || header.subtitle?.text || ''),
              }
            : {
                id: cleanId,
                title: cleanId === 'LM' ? 'Liked Music' : 'Playlist',
                trackCount: total,
                thumbnails: [],
              };

          return {
            ok: true,
            data: {
              items: pageItems,
              total,
              hasMore,
              playlist: playlistInfo,
            },
          };
        }

        if (operation === 'playlist-detail') {
          const yt = await getInnertube();
          let rawId = String(params.id || '').trim();
          if (!rawId) {
            return {
              ok: false,
              error: { code: 'unavailable', message: 'Playlist ID is required' },
            };
          }
          const cleanId = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const cached = playlistTrackCache.get(cleanId);
          if (cached && cached.header) {
            const header = cached.header;
            const trackCount =
              parseCount(header.song_count?.text || header.song_count || header.item_count) || cached.tracks.length;
            return {
              ok: true,
              data: {
                playlist: {
                  id: cleanId,
                  title: String(header.title?.text || header.title || ''),
                  description: String(header.description?.text || header.description || ''),
                  thumbnails: normalizeThumbnails(header.thumbnails || header.thumbnail?.contents || header.thumbnail),
                  trackCount,
                  author: String(header.author?.name || header.author || header.subtitle?.text || ''),
                },
              },
            };
          }

          const playlist = await yt.music.getPlaylist(cleanId);
          const header = playlist.header;
          const trackCount = parseCount(header?.song_count?.text || header?.song_count || header?.item_count);
          return {
            ok: true,
            data: {
              playlist: {
                id: cleanId,
                title: String(header?.title?.text || header?.title || (cleanId === 'LM' ? 'Liked Music' : 'Playlist')),
                description: String(header?.description?.text || header?.description || ''),
                thumbnails: normalizeThumbnails(header?.thumbnails || header?.thumbnail?.contents || header?.thumbnail),
                trackCount: trackCount || 0,
                author: String(header?.author?.name || header?.author || header?.subtitle?.text || ''),
              },
            },
          };
        }

        if (operation === 'song-detail') {
          const rawId = String(params.id || '').trim();
          if (!rawId) {
            return {
              ok: false,
              error: { code: 'unavailable', message: 'Song ID is required' },
            };
          }
          const cleanId = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const yt = await getInnertube();
          let info;
          try {
            info = await yt.music.getInfo(cleanId);
          } catch {
            info = await yt.getBasicInfo(cleanId);
          }
          const basic = info?.basic_info;
          if (!basic) {
            return {
              ok: false,
              error: { code: 'unavailable', message: 'Song information not found' },
            };
          }
          const formatted = formatTrack({
            id: cleanId,
            title: basic.title,
            author: basic.author ? { channel_id: basic.channel_id, name: basic.author } : undefined,
            duration: basic.duration,
            thumbnails: basic.thumbnail,
          });
          return {
            ok: true,
            data: {
              song: formatted,
            },
          };
        }

        if (operation === 'audio-source') {
          const rawId = String(params.id || params.videoId || '').trim();
          if (!rawId) {
            return {
              ok: false,
              error: { code: 'unavailable', message: 'Video ID is required' },
            };
          }
          const cleanId = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const yt = await getInnertube();

          let info;
          try {
            info = await yt.music.getInfo(cleanId);
          } catch (musicErr) {
            try {
              info = await yt.getBasicInfo(cleanId);
            } catch {
              throw musicErr;
            }
          }

          if (info.playability_status && info.playability_status.status !== 'OK') {
            const status = String(info.playability_status.status || '');
            const reason = String(info.playability_status.reason || 'Track is not playable');
            let code = 'not-playable';
            if (/LOGIN_REQUIRED|AGE_CHECK_REQUIRED/i.test(status) || /sign in|login/i.test(reason)) {
              code = 'auth-required';
            } else if (/UNPLAYABLE/i.test(status) && /country|region/i.test(reason)) {
              code = 'region-restricted';
            } else if (/unavailable|private|deleted/i.test(reason)) {
              code = 'unavailable';
            }
            return {
              ok: false,
              error: { code, message: reason },
            };
          }

          const streamingData = info.streaming_data;
          const allFormats = [
            ...(streamingData?.adaptive_formats || []),
            ...(streamingData?.formats || []),
          ].filter(f => f && f.has_audio && !f.drm_families && !f.drm_track_type);

          const audioOnly = allFormats.filter(f => !f.has_video);
          const candidates = audioOnly.length > 0 ? audioOnly : allFormats;

          if (candidates.length === 0) {
            return {
              ok: false,
              error: {
                code: 'not-playable',
                message: 'No playable audio formats available for this track',
              },
            };
          }

          const sorted = [...candidates].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          const pref = String(params.quality || 'high').toLowerCase();
          let selectedFormat = null;

          if (pref === 'standard') {
            selectedFormat = sorted.find(f => (f.bitrate || 0) <= 140000 && (f.bitrate || 0) >= 96000);
            if (!selectedFormat) {
              selectedFormat = sorted[sorted.length - 1] || sorted[0];
            }
          } else {
            selectedFormat = sorted[0];
          }

          let resolvedUrl = '';
          if (typeof selectedFormat.decipher === 'function') {
            resolvedUrl = await selectedFormat.decipher(yt.session?.player);
          } else {
            resolvedUrl = selectedFormat.url || '';
          }

          if (!resolvedUrl) {
            return {
              ok: false,
              error: {
                code: 'not-playable',
                message: 'Could not obtain playable audio stream URL',
              },
            };
          }

          let expiresAt = undefined;
          try {
            const parsed = new URL(resolvedUrl);
            const exp = parsed.searchParams.get('expire');
            if (exp) {
              expiresAt = Number(exp) * 1000;
            }
          } catch {}
          if (!expiresAt) {
            expiresAt = Date.now() + 6 * 3600 * 1000;
          }

          const resolvedQuality = (selectedFormat.bitrate || 0) >= 200000 ? 'high' : 'standard';

          let replayGain = undefined;
          if (typeof selectedFormat.loudness_db === 'number' && Number.isFinite(selectedFormat.loudness_db)) {
            replayGain = {
              trackGain: -Number(selectedFormat.loudness_db.toFixed(2)),
            };
          }

          return {
            ok: true,
            data: {
              url: resolvedUrl,
              fetchedAt: Date.now(),
              expiresAt,
              quality: resolvedQuality,
              ...(replayGain ? { replayGain } : {}),
            },
          };
        }

        return {
          ok: false,
          error: {
            code: 'unsupported',
            message: `Unsupported operation: ${operation}`,
          },
        };
      } catch (error) {
        warn('[YtmusicApiBridge] Request failed:', error);
        const msg = error instanceof Error ? error.message : String(error);
        let code = 'network';
        if (/unauthenticated|login|sign in|auth|not logged in/i.test(msg)) {
          code = 'auth-required';
        } else if (/not found|unavailable|private|deleted/i.test(msg)) {
          code = 'unavailable';
        }
        return {
          ok: false,
          error: {
            code,
            message: msg || 'YouTube Music operation failed',
          },
        };
      }
    },
  };
}

module.exports = { createYtmusicApiBridge, YTMUSIC_OPERATIONS };
