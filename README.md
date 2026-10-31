# Civic Resolve

A privacy-conscious municipal issue-reporting platform. It lets citizens file and track location-aware reports, gives staff a protected operations queue, and publishes anonymized aggregate transparency data.

## Architecture

- `client/`: React + Vite single-page application. It owns reporting, tracking, public dashboard, and the staff operations UI.
- `server/`: Express REST API with SQLite persistence, upload validation, rate limiting, JWT-protected staff routes, audit history, work-order creation, and optional Gemini assistive triage.
- `server/civic-resolve.db`: automatically generated SQLite database. Never commit a live production database.

## Run locally

Needs Node 22.13 or newer (the API uses the built-in `node:sqlite`, so there is nothing native to compile).

1. Copy `server/.env.example` to `server/.env` and set a long `JWT_SECRET`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to enable the initial staff account. Add `GEMINI_API_KEY` only if Gemini triage is wanted. Add the `SMTP_*` values plus `SMTP_FROM` to send status emails to citizen contacts that are valid email addresses.
2. In one terminal run `cd server; npm install; npm run dev`.
3. In another terminal run `cd client; npm install; npm run dev`.
4. Open `http://localhost:5173`.

The app works without a Gemini key, using an explicitly labeled rule-based assistive triage method. Gemini is never treated as the final decision-maker.

## Production deployment

Set `NODE_ENV=production`, a unique high-entropy `JWT_SECRET`, `CLIENT_ORIGIN` to the deployed frontend origin, and serve the API behind HTTPS. Use managed PostgreSQL/object storage and a malware scan pipeline for production-scale data rather than the local SQLite/filesystem defaults. Restrict CORS to trusted origins, rotate credentials, back up the database, and place the API behind a TLS reverse proxy.

## Design assumptions

- A citizen can submit without an account and uses the report reference to track progress.
- GPS collection requires the browser’s explicit permission; an address is accepted when GPS is unavailable.
- Status notifications are sent by email when SMTP is configured. SMS/WhatsApp delivery needs an approved municipal messaging provider.
- Audio upload is stored securely but transcription is not available without a configured speech-to-text provider; text remains optional.
- When configured, Gemini reviews up to two uploaded image files below 4 MB alongside the report text. Video/audio analysis requires a separate approved media-processing pipeline.
