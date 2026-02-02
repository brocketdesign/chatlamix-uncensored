# Deploying on Vercel and FUNCTION_INVOCATION_FAILED

This app is a **long-running Node server** (Fastify + MongoDB + cron + WebSockets). Vercel runs **serverless functions** (short-lived, per-request). That mismatch can cause `FUNCTION_INVOCATION_FAILED` (500) when:

- The Node process crashes (unhandled rejection or uncaught exception)
- Required env vars are missing (e.g. `MONGODB_URI`)
- Startup code assumes a persistent process (cron, WebSockets, or sync file reads)

## What we fixed in this repo

1. **Global handlers** – `unhandledRejection` and `uncaughtException` are logged instead of crashing the process, so you see the real error in Vercel logs.
2. **MongoDB startup** – `fastify.ready()` no longer assumes MongoDB is connected; it skips DB tasks if `mongo`/`db` is missing.
3. **Route bug** – `/about` no longer uses an undefined `translations` variable (it now uses `request.translations`), avoiding a runtime crash.

## If you deploy this app on Vercel

1. **Set all required env vars** in the Vercel project (e.g. `MONGODB_URI`, `MONGODB_NAME`, `JWT_SECRET`, etc.). Missing `MONGODB_URI` is a common cause of invocation failure.
2. **Check Vercel Function Logs** after a failed request; you should now see `UNHANDLED_REJECTION` or `UNCAUGHT_EXCEPTION` with the real error.
3. **Limitations on Vercel**:
   - In-process cron (`node-cron`) does not run reliably in serverless.
   - WebSockets may not behave as in a long-running server.
   - Prefer a **Node-friendly host** for the main app (e.g. Heroku, Railway, Render, Fly.io) and use Vercel for frontend or separate serverless APIs if needed.

## Optional: `vercel.json` for a Node server

If you use Vercel’s Node server support (e.g. `@vercel/node` with a single serverless entry that runs this app), ensure:

- Build command runs `npm install` (and any build steps you need).
- All env vars from `.env.example` are set in the Vercel project.
- Function timeout/memory are sufficient for your cold start and requests.

After deployment, use **Vercel → Project → Logs** (or Runtime Logs) to see the logged errors when a request fails.
