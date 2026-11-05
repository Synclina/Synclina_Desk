# Synclina Desk

Private ticket desk for Synclina's apps. It has no public pages: everything needs a login. It is separate from the public website, in its own repo, hosting and Firebase project.

| Who | Can do |
|---|---|
| Main account (`synclinaai@gmail.com`) | Everything: all apps, all activity, managing people |
| Maintainer | Read, change and reply on tickets for their app or apps; activity for those apps and their own actions |

## Status

- **Phase 1, foundation: live at https://synclina-desk.vercel.app** (Firebase project `synclina-desk`, Mumbai). Main account signed in on 5 November 2026. Login, sessions, activity log, main account setup.
- **Phase 2, DrivSync tickets: live.** Checked on 5 Nov 2026: a status and note saved in Desk reached the open ticket in the app on a phone by themselves.
- **Phase 3, people: live.** Invites, app access, resetting and removing, on the People page (main account only). Checked on the live site with a real invite in November 2026.
- **Phase 4, switch-over: done 5 November 2026.** The public website has no admin area (website commit `33c68a1`). Its Vercel settings and DrivSync key are deleted, and `admin_state` and `admin_audit` are gone from DrivSync's database.

## How it fits together

- **Next.js on Vercel**, Mumbai region (`vercel.json`). This is the only place tickets are managed.
- **Desk's own Firebase project** holds staff, sessions and activity. `firestore.rules` denies all browser and app access; only the server's key reaches it.
- **Tickets stay in each app's own Firebase project.** Desk holds one key per app, and uses it only after `canUseApp` in `src/lib/rules.ts` allows it.

## Database (Desk's Firestore)

| Collection | Document | Fields |
|---|---|---|
| `staff` | Hash of the lower-case email | `email`, `name`, `role` (`owner`/`maintainer`), `apps`, `active`, `passwordHash` (scrypt), `totpSecret` (AES-256-GCM, tied to this document), `recoveryHashes`, `usedRecovery`, `fails`, `lockedUntil`, `lastTotpStep`, `createdAt`, `setupExpiresAt` (while waiting for a link to be used), `removedAt` (record stays for the log, without secrets or apps) |
| `invites` | Hash of the link's token | `staffId`, `totpSecret` (AES-256-GCM, tied to that person), `createdAt`, `expiresAt`. Removed when used, replaced or the person is removed; a run-out one stays until then, and does nothing |
| `sessions` | Hash of the cookie | `staffId`, `createdAt`, `lastSeenAt` |
| `activity` | Automatic | `actorId`, `actor`, `action`, `detail`, `app`, `at` |
| `sign_in_limits` | Hash of the address | `count`, `since` |

## People

The main account manages everyone on the People page. Nobody else can see it or use its routes, and it can't change the main account: that's only `npm run desk:setup -- --reset`.

1. **Invite:** email, name and apps. This makes a maintainer who can't sign in yet, and a link that's emailed if Brevo is set up, and always shown once to copy.
2. **Join:** the link opens `/join`, where they choose a password, add Desk to their authenticator, prove it with a code, and save 8 recovery codes. Then they sign in as usual.
3. **Change apps:** applies on their next click.
4. **Reset:** ends their sessions and deletes their password, authenticator and recovery codes at once, then makes a new link. Also how someone gets a new link when theirs is lost or has run out.
5. **Remove:** ends their sessions and link, deletes their secrets and apps. The email can be invited again later, from scratch.

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
- Only hashes of cookies, addresses and link tokens are stored.
- Links work once, for 3 days, and a newer link ends the earlier one. The token sits after the `#`, so it isn't sent in page requests or kept in server logs. Made-up, used, run-out and taken-back links all answer the same, and link tries count towards the same per-address limit as sign-ins.
- The code used to join can't also sign in. Invites can only ever make maintainers.

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
