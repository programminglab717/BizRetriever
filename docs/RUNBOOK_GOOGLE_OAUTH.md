# Runbook: turn on "Continue with Google"

Google sign-in is fully built but switched off until these two env vars are set:
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. A Google OAuth client is **free** (ADR-026).

## Steps (about 10 minutes, owner)

1. Go to the Google Cloud console (console.cloud.google.com) and create a project, e.g. "BizRetriever".
2. **APIs & Services → OAuth consent screen**:
   - user type **External**
   - app name "BizRetriever"
   - your support email
   - scopes: just the defaults (`openid`, `email`, `profile`)
   - while testing, add your own Google account under **Test users**
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - application type **Web application**
   - **Authorised JavaScript origins:** `http://localhost:3000`, plus the hosted URL later
   - **Authorised redirect URIs:** `http://localhost:3000/api/auth/callback/google`, plus
     `https://<hosted-domain>/api/auth/callback/google` later
4. Copy the client ID and secret into `.env` (locally) or the host's env vars:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

5. Restart the app. "Continue with Google" now appears on the sign-in and sign-up pages.

## Notes

- Never commit these values. Keep them only in env vars (safety rule 7).
- While the consent screen is in "Testing" mode, only listed test users can sign in. Publishing the
  app (free) removes that limit; Google may ask for a privacy policy URL first.
- `APP_URL` must match the origin people use, or sign-in is rejected as "Invalid origin".
