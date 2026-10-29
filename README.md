# Social network API

This API uses Node.js, Express, and MongoDB. It provides account registration and login, posts with likes and comments, expiring photo/video stories, friend discovery and requests, and direct messages between accepted friends.

## Run locally

1. Install a local MongoDB server or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a unique `JWT_SECRET` of at least 32 characters.
3. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` to enable password reset emails. Use the SMTP settings provided by your email service; never commit real credentials.
4. Install and start the API:

   ```sh
   npm install
   npm run dev
   ```

The API listens on `http://localhost:5000`. The frontend should run on `http://localhost:5173`. Uploaded post and story photos/videos are saved in `backend/uploads` (up to 50 MB per file). Stories are visible to friends for 24 hours and then removed. For production, configure durable media storage rather than relying on local disk.

## Deploy to Render

The API deployment blueprint is `render.yaml`. Connect the main repository (the one containing the `backend` directory) to Render and select `backend/render.yaml` as the Blueprint file. The API uses a paid `0.5c-512mb` web-service plan and a 1 GB persistent disk so uploaded media survives deploys and restarts. Review current Render pricing before creating the service.

When Render prompts for environment values, provide:

- `MONGODB_URI`: your production MongoDB Atlas connection string. Allow Render's outbound connections in the Atlas network access settings.
- `CLIENT_ORIGIN`: the deployed frontend origin, for example `https://qavero-frontend.onrender.com` (no trailing slash).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`: the credentials and sender address from your SMTP provider.

Render generates `JWT_SECRET` and mounts the media disk at `/var/data`. Never add production secrets to this repository. After creating the frontend, confirm its exact URL is listed in `CLIENT_ORIGIN`, then redeploy the API.

## Endpoints

- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/posts`, `POST /api/posts`, `POST /api/posts/:postId/like`, `POST /api/posts/:postId/comments`
- `DELETE /api/posts/:postId` (author only)
- `GET /api/stories`, `POST /api/stories`, `DELETE /api/stories/:storyId` (author only)
- `GET /api/friends`, `GET /api/friends/discover`, `POST /api/friends/:userId`, `PATCH /api/friends/:requestId/accept`, `DELETE /api/friends/:requestId`
- `GET /api/messages/:userId`, `POST /api/messages/:userId`

All routes except health and signup/login require an `Authorization: Bearer <token>` header.
