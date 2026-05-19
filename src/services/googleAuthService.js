const crypto = require('crypto');
const axios = require('axios');
const Sentry = require('@sentry/node');

/**
 * Normalizes and signs a JWT assertion using Google Service Account credentials,
 * exchanging it for an OAuth 2.0 Access Token to query private Google Sheets.
 */
class GoogleAuthService {
    constructor() {
        this.clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
        this.privateKey = process.env.GOOGLE_PRIVATE_KEY;
        this.accessToken = null;
        this.tokenExpiry = 0;
    }

    /**
     * Validates credentials structure on server startup.
     */
    validateCredentials() {
        if (!this.clientEmail || !this.privateKey) {
            console.warn('\x1b[33m[GOOGLE AUTH WARNING] GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY is missing. Google Sheet background sync will fall back to public sheet fetching.\x1b[0m');
            return false;
        }
        try {
            // Verify private key is a valid PEM RSA private key
            const cleanKey = this.privateKey.replace(/\\n/g, '\n');
            crypto.createSign('SHA256').update('test').sign(cleanKey);
            console.log('[GOOGLE AUTH] Service Account credentials successfully validated.');
            return true;
        } catch (err) {
            console.error('\x1b[31m[GOOGLE AUTH ERROR] GOOGLE_PRIVATE_KEY is invalid or malformed:\x1b[0m', err.message);
            if (process.env.SENTRY_DSN) {
                Sentry.captureException(err);
            }
            return false;
        }
    }

    /**
     * Obtains a valid OAuth Access Token using the JWT assertion flow.
     */
    async getAccessToken() {
        const now = Math.floor(Date.now() / 1000);
        
        // Re-use unexpired token (with 30-second buffer)
        if (this.accessToken && this.tokenExpiry > now + 30) {
            return this.accessToken;
        }

        if (!this.clientEmail || !this.privateKey) {
            return null; // Gracefully fall back to public fetch if env variables are empty
        }

        try {
            const privateKey = this.privateKey.replace(/\\n/g, '\n');
            const header = { alg: 'RS256', typ: 'JWT' };
            const payload = {
                iss: this.clientEmail,
                scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
                aud: 'https://oauth2.googleapis.com/token',
                exp: now + 3600,
                iat: now
            };

            const base64UrlEncode = (obj) => {
                return Buffer.from(JSON.stringify(obj))
                    .toString('base64')
                    .replace(/=/g, '')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_');
            };

            const unsignedJwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
            
            // Sign using standard RSA SHA-256
            const sign = crypto.createSign('SHA256');
            sign.update(unsignedJwt);
            const signature = sign.sign(privateKey, 'base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');

            const signedJwt = `${unsignedJwt}.${signature}`;

            // Exchange JWT for Access Token
            const response = await axios.post('https://oauth2.googleapis.com/token', 
                `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            this.accessToken = response.data.access_token;
            this.tokenExpiry = now + parseInt(response.data.expires_in);
            return this.accessToken;

        } catch (err) {
            console.error('[GOOGLE AUTH ERROR] Failed to fetch access token:', err.response?.data || err.message);
            if (process.env.SENTRY_DSN) {
                Sentry.captureException(err, { extra: { detail: err.response?.data } });
            }
            return null;
        }
    }
}

module.exports = new GoogleAuthService();
