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

For Gmail, use `smtp.gmail.com`, port `587`, and `SMTP_SECURE=false`. Set `SMTP_USER` and the address in `SMTP_FROM` to your Gmail address, and use a Google App Password for `SMTP_PASSWORD` (requires 2-Step Verification). To verify the connection and send a test email, run `npm run test:email -- recipient@example.com` from `backend`.

The API listens on `http://localhost:5000`. The frontend should run on `http://localhost:5173`. Uploaded post and story photos/videos are saved in `backend/uploads` (up to 50 MB per file). Stories are visible to friends for 24 hours and then removed. For production, configure durable media storage rather than relying on local disk.

## Deploy to Render

The repository-root `render.yaml` creates both the API and frontend services in one Render Blueprint. Connect the repository to Render and create a Blueprint from that file. The API uses a paid `0.5c-512mb` web-service plan and a 1 GB persistent disk so uploaded media and profile pictures survive deploys and restarts. Review current Render pricing before creating the service.

When Render prompts for environment values, provide:

- `MONGODB_URI`: your production MongoDB Atlas connection string. Allow Render's outbound connections in the Atlas network access settings.
- `CLIENT_ORIGIN`: the deployed frontend origin. The Blueprint defaults to `https://facebook-clone-91m6.vercel.app`; change it if your Vercel domain differs (no trailing slash).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`: the credentials and sender address from your SMTP provider.

The Blueprint generates `JWT_SECRET` and mounts the media disk at `/var/data`. The API allows the configured `CLIENT_ORIGIN` values and the deployed Vercel origin above. Never add production secrets to this repository. If you use a different frontend domain, set its exact origin in `CLIENT_ORIGIN` and redeploy the API.

`MONGODB_URI` and SMTP credentials belong only in the backend service environment. If you change the API URL or use a custom API domain, update the frontend's `VITE_API_URL` reference in the Blueprint and redeploy the frontend.

## Authentication endpoints

- `POST /api/auth/register` (also available as `/api/auth/signup`), `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`
- `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token` (legacy `POST /api/auth/reset-password` also supported), `GET /api/auth/me`

Registration sends a 6-digit email verification code. The account can sign in only after email verification. SMTP credentials stay in the backend environment and must not be added to the frontend.

## Other endpoints

- `GET /api/posts`, `POST /api/posts`, `POST /api/posts/:postId/like`, `POST /api/posts/:postId/comments`
- `DELETE /api/posts/:postId` (author only)
- `GET /api/stories`, `POST /api/stories`, `DELETE /api/stories/:storyId` (author only)
- `GET /api/friends`, `GET /api/friends/discover`, `POST /api/friends/:userId`, `PATCH /api/friends/:requestId/accept`, `DELETE /api/friends/:requestId`
- `GET /api/messages/:userId`, `POST /api/messages/:userId`

All authentication endpoints and the health endpoint are public. Other API routes require an `Authorization: Bearer <token>` header.
