// electron/ytmusicAuthManager.cjs

const AUTH_COOKIE_NAMES = new Set(['SAPISID', '__Secure-3PAPISID', 'SID']);

function ensurePlatformEval(Platform) {
  if (Platform && Platform.shim) {
    Platform.shim.eval = (data, env) => {
      try {
        const fn = new Function(...Object.keys(env), data.output);
        return fn(...Object.values(env));
      } catch (err) {
        throw new Error(`Failed to evaluate player decipher function: ${err.message}`);
      }
    };
  }
}

/**
 * Creates the YouTube Music authentication manager.
 * Runs strictly in the Electron main process.
 * Never leaks raw cookies, tokens, or sessions to the renderer process.
 *
 * @param {object} [options]
 * @param {import('electron').Session} [options.session]
 * @param {typeof import('electron').BrowserWindow} [options.BrowserWindow]
 * @param {Function} [options.innertubeFactory]
 * @param {Function} [options.warn]
 * @param {Function} [options.info]
 */
function createYtmusicAuthManager(options = {}) {
  const {
    session: electronSession,
    BrowserWindow,
    innertubeFactory,
    warn = console.warn,
    info = console.info,
  } = options;

  let activeLoginWindow = null;
  let activeLoginPromise = null;
  let cachedAuthenticatedClient = null;
  let cachedUser = null;

  function getSession() {
    if (electronSession) {
      return electronSession;
    }
    const { session } = require('electron');
    return session.fromPartition('persist:ytmusic');
  }

  async function getCookieHeader(ses) {
    if (!ses?.cookies?.get) return '';
    try {
      const youtubeCookies = await ses.cookies.get({ domain: '.youtube.com' });
      const googleCookies = await ses.cookies.get({ domain: '.google.com' });
      const map = new Map();
      for (const c of [...googleCookies, ...youtubeCookies]) {
        if (c && c.name && typeof c.value === 'string') {
          map.set(c.name, c.value);
        }
      }
      return Array.from(map.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    } catch (err) {
      warn('[YTMusicAuth] Failed to retrieve cookies from session', err?.message);
      return '';
    }
  }

  async function hasAuthCookies(ses) {
    if (!ses?.cookies?.get) return false;
    try {
      const cookies = await ses.cookies.get({ domain: '.youtube.com' });
      return cookies.some(c => AUTH_COOKIE_NAMES.has(c.name));
    } catch {
      return false;
    }
  }

  async function createInnertube(cookie) {
    if (typeof innertubeFactory === 'function') {
      return Promise.resolve(innertubeFactory({ cookie }));
    }
    const { Innertube, Platform } = await import('youtubei.js');
    ensurePlatformEval(Platform);
    return Innertube.create({ cookie });
  }

  /**
   * Sanitizes user information for safe transmission over IPC to renderer.
   */
  function sanitizeUser(rawInfo) {
    if (!rawInfo) return null;
    let nickname = 'YouTube Music User';
    let avatarUrl = undefined;
    let id = 'ytmusic_user';

    try {
      const item = rawInfo?.contents;
      if (item) {
        if (item.account_name?.text) {
          nickname = String(item.account_name.text);
        }
        if (Array.isArray(item.account_photo) && item.account_photo[0]?.url) {
          avatarUrl = String(item.account_photo[0].url);
        }
        if (item.channel_handle?.text) {
          id = String(item.channel_handle.text);
        }
      }
    } catch {
      // Fallback defaults
    }

    return { id, nickname, avatarUrl };
  }

  /**
   * Evaluates the current authentication status.
   * Distinguishes:
   * 1. No authentication cookies -> connected: false
   * 2. Cookies present but session not verified -> connected: false
   * 3. Authenticated and verified session -> connected: true, user
   *
   * @returns {Promise<{ connected: boolean, user?: { id: string, nickname: string, avatarUrl?: string } | null }>}
   */
  async function getAuthStatus() {
    const ses = getSession();
    const hasCookies = await hasAuthCookies(ses);
    if (!hasCookies) {
      cachedAuthenticatedClient = null;
      cachedUser = null;
      return { connected: false, user: null };
    }

    const cookieHeader = await getCookieHeader(ses);
    if (!cookieHeader) {
      cachedAuthenticatedClient = null;
      cachedUser = null;
      return { connected: false, user: null };
    }

    try {
      const yt = await createInnertube(cookieHeader);
      if (!yt?.session?.logged_in) {
        info('[YTMusicAuth] Cookies present but Innertube session is not logged in');
        cachedAuthenticatedClient = null;
        cachedUser = null;
        return { connected: false, user: null };
      }

      // Verify the session through a minimal authenticated account request
      let user = cachedUser;
      if (!user && yt.account?.getInfo) {
        const accountInfo = await yt.account.getInfo();
        user = sanitizeUser(accountInfo);
        cachedUser = user;
      }

      cachedAuthenticatedClient = yt;
      return {
        connected: true,
        user: user || { id: 'ytmusic_user', nickname: 'YouTube Music User' },
      };
    } catch (err) {
      warn('[YTMusicAuth] Session verification request failed:', err?.message);
      cachedAuthenticatedClient = null;
      cachedUser = null;
      return { connected: false, user: null };
    }
  }

  /**
   * Opens the dedicated Electron login window for YouTube Music / Google.
   */
  async function openLoginWindow() {
    if (activeLoginWindow && !activeLoginWindow.isDestroyed()) {
      activeLoginWindow.focus();
      return activeLoginPromise;
    }

    const ses = getSession();
    const WinClass = BrowserWindow || require('electron').BrowserWindow;

    activeLoginPromise = new Promise((resolve) => {
      let resolved = false;

      function finish(status) {
        if (resolved) return;
        resolved = true;
        if (activeLoginWindow && !activeLoginWindow.isDestroyed()) {
          activeLoginWindow.destroy();
        }
        activeLoginWindow = null;
        activeLoginPromise = null;
        resolve(status);
      }

      const win = new WinClass({
        width: 550,
        height: 750,
        title: 'Sign in to YouTube Music',
        autoHideMenuBar: true,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      activeLoginWindow = win;
      info('[YTMusicAuth] Login window opened');

      async function checkVerification() {
        const status = await getAuthStatus();
        if (status.connected) {
          info('[YTMusicAuth] Detected authenticated YouTube Music session');
          finish(status);
          return true;
        }
        return false;
      }

      win.webContents.on('did-navigate', async (_event, url) => {
        if (typeof url === 'string' && url.includes('music.youtube.com')) {
          await checkVerification();
        }
      });

      win.webContents.on('did-navigate-in-page', async (_event, url) => {
        if (typeof url === 'string' && url.includes('music.youtube.com')) {
          await checkVerification();
        }
      });

      win.on('closed', async () => {
        info('[YTMusicAuth] Login window closed by user');
        if (!resolved) {
          const finalStatus = await getAuthStatus();
          finish(finalStatus);
        }
      });

      // Load YouTube Music login entry point
      win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F')
        .catch((err) => {
          warn('[YTMusicAuth] Failed to load login URL:', err?.message);
        });
    });

    return activeLoginPromise;
  }

  /**
   * Disconnects / logs out by clearing partition storage and resetting client cache.
   */
  async function logout() {
    const ses = getSession();
    try {
      if (ses?.clearStorageData) {
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'caches'],
        });
      }
    } catch (err) {
      warn('[YTMusicAuth] Failed to clear session data:', err?.message);
    }
    cachedAuthenticatedClient = null;
    cachedUser = null;
    info('[YTMusicAuth] Disconnected / logged out');
    return { connected: false, user: null };
  }

  /**
   * Returns the authenticated Innertube client if logged in, or null.
   */
  function getAuthenticatedClient() {
    return cachedAuthenticatedClient;
  }

  return {
    getAuthStatus,
    openLoginWindow,
    logout,
    getAuthenticatedClient,
    getCookieHeader: () => getCookieHeader(getSession()),
  };
}

module.exports = {
  createYtmusicAuthManager,
  ensurePlatformEval,
  AUTH_COOKIE_NAMES,
};
