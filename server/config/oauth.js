export function getGoogleOAuthConfig(env = process.env) {
  return {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  };
}

export function isGoogleOAuthConfigured(config = getGoogleOAuthConfig()) {
  return Boolean(config.clientId && config.clientSecret);
}

export function getFacebookOAuthConfig(env = process.env) {
  return {
    clientId: env.FACEBOOK_CLIENT_ID || '',
    clientSecret: env.FACEBOOK_CLIENT_SECRET || '',
    redirectUri: env.FACEBOOK_REDIRECT_URI || 'http://localhost:3000/api/auth/facebook/callback'
  };
}

export function isFacebookOAuthConfigured(config = getFacebookOAuthConfig()) {
  return Boolean(config.clientId && config.clientSecret);
}
