# Synclina Desk

Private ticket desk for Synclina's apps. It has no public pages: everything needs a login. It is separate from the public website, in its own repo, hosting and Firebase project.

| Who | Can do |
|---|---|
| Main account (`synclinaai@gmail.com`) | Everything: all apps, all activity, managing people |
| Maintainer | Read, change and reply on tickets for their app or apps; activity for those apps and their own actions |

## Status

- **Phase 1, foundation: live at https://synclina-desk.vercel.app** (Firebase project `synclina-desk`, Mumbai). Main account signed in on 5 November 2026. Login, sessions, activity log, main account setup.
- **Phase 2, DrivSync tickets: built and tested locally.** Live once `APP_DRIVSYNC_FIREBASE_KEY_B64` is added in Vercel.
- Phase 3, people (invites, app access, removing and resetting): not started.
- Phase 4, switch-over from the public website's admin area: not started.

## How it fits together

- **Next.js on Vercel**, Mumbai region (`vercel.json`). The website's public admin area keeps working until phase 4.
- **Desk's own Firebase project** holds staff, sessions and activity. `firestore.rules` denies all browser and app access; only the server's key reaches it.
- **Tickets stay in each app's own Firebase project.** Desk will hold one key per app, and use it only after `canUseApp` in `src/lib/rules.ts` allows it.

## Database (Desk's Firestore)

| Collection | Document | Fields |
|---|---|---|
| `staff` | Hash of the lower-case email | `email`, `name`, `role` (`owner`/`maintainer`), `apps`, `active`, `passwordHash` (scrypt), `totpSecret` (AES-256-GCM, tied to this document), `recoveryHashes`, `usedRecovery`, `fails`, `lockedUntil`, `lastTotpStep`, `createdAt` |
| `sessions` | Hash of the cookie | `staffId`, `createdAt`, `lastSeenAt` |
| `activity` | Automatic | `actorId`, `actor`, `action`, `detail`, `app`, `at` |
| `sign_in_limits` | Hash of the address | `count`, `since` |

## Connecting an app

1. In the app's Google Cloud project, make a service account with **Cloud Datastore User** and **Firebase Authentication Viewer**, and download a JSON key.
2. Set `firebaseProject` for the app in `src/lib/apps.ts`, then `npm run desk:app-key`.
3. Add `APP_<SLUG>_FIREBASE_KEY_B64` to Vercel, Production only, and redeploy. A key for any other project is refused.

The app must store tickets at `accounts/{uid}/support/{reference}` with `subject`, `topic`, `channel`, `createdAt` (timestamp), `status`, and optionally `message` and `deviceInfo`; reference prefixes are in `src/lib/apps.ts`. Desk writes `status`, `teamNote` and `updatedAt`. It needs a collection-group index on `support.createdAt`, descending.

## Security

- Email, password and authenticator are all required. A recovery code can stand in for the authenticator, once each.
- Unknown, turned-off, locked and wrong all answer identically, so nobody can find out which emails exist.
- 5 wrong tries lock that person only, for 15 minutes, then 30, then an hour at most. Tries during a lock don't extend it. Each address gets 20 tries in 15 minutes.
- Sessions end after 30 minutes idle or 8 hours. Turning someone off takes effect on their next click.
- Strict policy with a nonce on every page, no framing, no caching, hidden from search engines. Preview deployments answer nothing.
- Only hashes of cookies and addresses are stored.

## Commands

```bash
npm install
npm test
npm run desk:setup
```

`npm run desk:setup` creates the main account and `.env.desk` (never committed). `npm run desk:setup -- --reset` gives the main account new details and ends its sessions.

**End-to-end checks** run on a real build and the local emulator (needs Java 21), and touch no real project:

```bash
firebase emulators:start --only firestore,auth --project demo-desk
```

```bash
NEXT_DIST_DIR=.next-prod npx next build && npm run test:e2e
```

## Settings in Vercel (Production only)

| Name | What |
|---|---|
| `DESK_ENCRYPTION_KEY` | From `.env.desk`. Keep a safe copy: without it, nobody's authenticator can be read |
| `DESK_FIREBASE_KEY_B64` | From `.env.desk` |
| `APP_DRIVSYNC_FIREBASE_KEY_B64` | From `npm run desk:app-key`. One per connected app |
| `BREVO_API_KEY` | Security emails; without it none are sent |
| `DESK_ALERT_SENDER` | A sender verified in Brevo |

## Known audit findings (`npm audit --omit=dev`)

All come from inside `next` (`postcss`, used at build time) and `firebase-admin` 13 (`uuid`, through Google's libraries). The fixes need `next` 16 or `firebase-admin` 14, and version 14 crashed on Vercel on the public website. Review at each phase.
