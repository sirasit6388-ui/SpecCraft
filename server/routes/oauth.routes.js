import { getFacebookOAuthConfig, getGoogleOAuthConfig, isFacebookOAuthConfigured, isGoogleOAuthConfigured } from '../config/oauth.js';
import { createSessionCookie } from '../services/auth.service.js';
import {
  buildFacebookAuthUrl,
  buildGoogleAuthUrl,
  createOAuthState,
  exchangeFacebookCode as exchangeFacebookCodeService,
  exchangeGoogleCode as exchangeGoogleCodeService,
  fetchFacebookProfile as fetchFacebookProfileService,
  fetchGoogleProfile as fetchGoogleProfileService,
  loginWithFacebook as loginWithFacebookService,
  loginWithGoogle as loginWithGoogleService
} from '../services/oauth.service.js';

const stateCookieName = 'pc_oauth_state';

export function createOAuthRoutes(options = {}) {
  const providers = {
    google: {
      getConfig: options.getGoogleOAuthConfig || getGoogleOAuthConfig,
      isConfigured: isGoogleOAuthConfigured,
      buildAuthUrl: buildGoogleAuthUrl,
      exchangeCode: options.exchangeGoogleCode || exchangeGoogleCodeService,
      fetchProfile: options.fetchGoogleProfile || fetchGoogleProfileService,
      login: options.loginWithGoogle || loginWithGoogleService
    },
    facebook: {
      getConfig: options.getFacebookOAuthConfig || getFacebookOAuthConfig,
      isConfigured: isFacebookOAuthConfigured,
      buildAuthUrl: buildFacebookAuthUrl,
      exchangeCode: options.exchangeFacebookCode || exchangeFacebookCodeService,
      fetchProfile: options.fetchFacebookProfile || fetchFacebookProfileService,
      login: options.loginWithFacebook || loginWithFacebookService
    }
  };

  return async function oauthRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'GET') {
      return false;
    }

    const providerName = requestUrl.pathname.startsWith('/api/auth/google')
      ? 'google'
      : requestUrl.pathname.startsWith('/api/auth/facebook')
        ? 'facebook'
        : null;

    if (!providerName) {
      return false;
    }

    const provider = providers[providerName];
    const config = provider.getConfig();

    if (!provider.isConfigured(config)) {
      redirectWithError(response, `${providerName}_not_configured`);
      return true;
    }

    if (requestUrl.pathname === `/api/auth/${providerName}`) {
      const state = createOAuthState();
      response.writeHead(302, {
        Location: provider.buildAuthUrl(state, config),
        'Set-Cookie': `${stateCookieName}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
      });
      response.end();
      return true;
    }

    if (requestUrl.pathname === `/api/auth/${providerName}/callback`) {
      const cookies = parseCookieHeader(request.headers?.cookie || request.headers?.Cookie || '');
      const expectedState = cookies[stateCookieName];
      const returnedState = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');

      if (requestUrl.searchParams.get('error')) {
        redirectWithError(response, `${providerName}_access_denied`);
        return true;
      }

      if (!code || !expectedState || expectedState !== returnedState) {
        redirectWithError(response, `${providerName}_state_mismatch`);
        return true;
      }

      try {
        const tokenPayload = await provider.exchangeCode(code, { config });
        const profile = await provider.fetchProfile(tokenPayload.access_token);
        const result = await provider.login(profile);

        response.writeHead(302, {
          Location: '/',
          'Set-Cookie': [createSessionCookie(result.token), clearStateCookie()]
        });
        response.end();
      } catch {
        response.writeHead(302, {
          Location: `/?authError=${providerName}_login_failed`,
          'Set-Cookie': clearStateCookie()
        });
        response.end();
      }

      return true;
    }

    return false;
  };
}

function redirectWithError(response, reason) {
  response.writeHead(302, {
    Location: `/?authError=${encodeURIComponent(reason)}`,
    'Set-Cookie': clearStateCookie()
  });
  response.end();
}

function clearStateCookie() {
  return `${stateCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookieHeader(header) {
  return String(header).split(';').reduce((cookies, part) => {
    const [name, ...valueParts] = part.trim().split('=');

    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join('=') || '');
    return cookies;
  }, {});
}
