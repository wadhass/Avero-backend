# Social network API

This API uses Node.js, Express, MongoDB, and Socket.IO. It provides account registration and login, posts with likes and comments, expiring photo/video stories, friend discovery and requests, independent followers, real-time direct messages between accepted friends, and persisted in-app notifications.

## Run locally

1. Install a local MongoDB server or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a unique `JWT_SECRET` of at least 32 characters. Firebase ID tokens are verified for the Qavero project by default; set `FIREBASE_PROJECT_ID` only when using a different Firebase project. Optionally provide Firebase Admin credentials through `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` to enable revoked-token checks. Keep service-account private keys only in the backend environment; never put them in the frontend or commit them.
3. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env` to enable password reset emails. Use the SMTP settings provided by your email service; never commit real credentials.
4. Install and start the API:

   ```sh
   npm install
   npm run dev
   ```

Run the backend unit tests with `npm test`.

For Gmail, use `smtp.gmail.com`, port `587`, and `SMTP_SECURE=false`. Set `SMTP_USER` and the address in `SMTP_FROM` to your Gmail address, and use a Google App Password for `SMTP_PASSWORD` (requires 2-Step Verification). To verify the connection and send a test email, run `npm run test:email -- recipient@example.com` from `backend`.

The API listens on `http://localhost:5000`. The frontend should run on `http://localhost:5173`. Uploaded post and story photos/videos are saved in `backend/uploads` (up to 50 MB per file). Stories are visible to friends for 24 hours and then removed. Private message attachments and voice notes are stored outside the public uploads directory and served only to the sender/recipient while they remain friends. For production, configure durable media storage rather than relying on local disk. Socket.IO connections use the same signed bearer token as the REST API; no additional credentials are required.

## Deploy to Render

The repository-root `render.yaml` creates both the API and frontend services in one Render Blueprint. Connect the repository to Render and create a Blueprint from that file. The API uses a paid `0.5c-512mb` web-service plan and a 1 GB persistent disk so uploaded media and profile pictures survive deploys and restarts. Review current Render pricing before creating the service.

When Render prompts for environment values, provide:

- `MONGODB_URI`: your production MongoDB Atlas connection string. Allow Render's outbound connections in the Atlas network access settings.
- `FIREBASE_PROJECT_ID`: optional; defaults to `qavero-application`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: optional service-account JSON for Firebase Admin revoked-token checks. Store it as a protected backend environment value only; never commit or share its private key. Firebase ID token signature verification works without this credential.
- `CLIENT_ORIGIN`: the deployed frontend origin(s), as comma-separated origins without trailing slashes. The repository-root Blueprint allows `https://qavero-frontend.onrender.com` and `https://facebook-clone-91m6.vercel.app`; update the values if your deployed domains differ.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`: the credentials and sender address from your SMTP provider.

The Blueprint generates `JWT_SECRET` and mounts the media disk at `/var/data`. The repository-root Blueprint allows both configured frontend origins; the API-only Blueprint in `backend/render.yaml` defaults to the Vercel origin. Never add production secrets to this repository. If you use a different frontend domain, set its exact origin in `CLIENT_ORIGIN` and redeploy the API.

`MONGODB_URI` and SMTP credentials belong only in the backend service environment. If you change the API URL or use a custom API domain, update the frontend's `VITE_API_URL` reference in the Blueprint and redeploy the frontend.

## Authentication endpoints

- `POST /api/auth/register` (also available as `/api/auth/signup`), `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`
- `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token` (legacy `POST /api/auth/reset-password` also supported), `GET /api/auth/me`
- `POST /api/auth/firebase/session` verifies the Firebase ID token, links the verified Firebase UID to the matching MongoDB user by email, or creates a MongoDB user if one does not exist.

The frontend supports Firebase email/password and Google sign-in, Firebase email verification, and Firebase password-reset emails. Firebase ID tokens are verified by the Admin SDK for REST and Socket.IO authorization. Firebase users are linked to MongoDB records by verified email; profiles and social data remain in MongoDB. Existing custom JWT registration/login/verification endpoints remain available for legacy clients and accounts. SMTP credentials stay in the backend environment and must not be added to the frontend.

## Other endpoints

- `GET /api/posts`, `POST /api/posts`, `POST /api/posts/:postId/like`, `POST /api/posts/:postId/comments`
- `DELETE /api/posts/:postId` (author only)
- `GET /api/stories`, `POST /api/stories`, `DELETE /api/stories/:storyId` (author only)
- `GET /api/friends`, `GET /api/friends/discover`, `POST /api/friends/:userId`, `PATCH /api/friends/:requestId/accept`, `DELETE /api/friends/:requestId`
- `GET /api/follows/:userId`, `GET /api/follows/:userId/followers`, `GET /api/follows/:userId/following`, `POST /api/follows/:userId`, `DELETE /api/follows/:userId`
- `GET /api/messages/:userId`, `POST /api/messages/:userId`
- `GET /api/messages/unread-count`
- `GET /api/notifications?page=1`, `PATCH /api/notifications/:notificationId/read`, `PATCH /api/notifications/read-all`
- `GET /api/conversations`, `POST /api/conversations`, `GET /api/conversations/:conversationId`, `GET/POST /api/conversations/:conversationId/messages`
- `GET /api/calls/ice-servers`, `GET /api/calls`

Socket.IO clients send their Firebase ID token (or a legacy custom JWT) in `auth.token`. Direct and group message delivery, typing indicators, read receipts, friend/follow/post notifications, and live notification updates use the authenticated socket connection; REST remains available for loading and sending messages if a client disconnects. Group attachments are stored privately and only visible to current group members.

One-to-one audio/video calling uses Socket.IO for signaling and browser WebRTC for media. Configure `STUN_URLS` and, for connections across restrictive networks, `TURN_URLS`, `TURN_SHARED_SECRET`, and optionally `TURN_TTL_SECONDS` in the backend environment. The Render manifests declare `TURN_URLS` and `TURN_SHARED_SECRET`; set both to credentials from a TURN service in the API service environment. TURN URLs use the `turn:` or `turns:` scheme, and TURN credentials are generated per authenticated user with the shared secret; never expose that secret to the frontend. The default STUN server is suitable for development, but production calls need a TURN service to connect reliably across restrictive networks. Group calls are not supported.

All authentication endpoints and the health endpoint are public. Other API routes require an `Authorization: Bearer <token>` header.
