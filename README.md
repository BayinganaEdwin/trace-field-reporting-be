# Trace Field Reporting — Backend

REST API for the SiteLog construction reporting system. Handles users, sites, reports, notifications, and analytics. Includes AI-powered image verification using a MobileNetV2 model hosted on Flask, with a Claude vision fallback.

## Getting started

```bash
npm install
cp .env.example .env
node src/db/seed.js
npm run dev
```

The server runs on `http://localhost:3001` by default.

## Authentication

Every request must include the header `X-User-Id: <userId>`. The seed script creates demo users: `user-worker-1`, `user-manager-1`, and `user-owner-1`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /sites | List all sites |
| POST | /sites | Create a site |
| GET | /reports | List reports |
| POST | /reports | Submit a report with photo |
| PATCH | /users/me | Update own profile |
| GET | /analytics | Stage distribution and trends |
| GET | /notifications | User notifications |

## AI verification

When a report is submitted, the server first calls the MobileNetV2 Flask server on port 5001. If that is unavailable, it falls back to Claude Haiku vision. Set `ML_SERVER_URL` and `ANTHROPIC_API_KEY` in `.env`.

## Stack

- Node.js with Express
- sql.js (SQLite running in-process, persisted as JSON)
- Multer for image uploads
- Claude Haiku for vision fallback
