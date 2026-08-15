# Deploy to Render (quick guide)

## Quick Setup (PostgreSQL on Render Free)

1. **Push repository to GitHub**

2. **Create a Web Service on Render**:
   - Connect your GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: `Node 18`

3. **Create a PostgreSQL database on Render**:
   - Render Dashboard → **New** → **PostgreSQL**
   - Choose **Free** plan if available
   - Save the database

4. **Add Environment Variables**:
   - `ADMIN_PASSWORD` — mật khẩu admin
   - `SESSION_SECRET` — key cho JWT
   - `DATABASE_URL` — automatically filled by Render when the DB is linked
   - `DATA_DIR` — optional fallback only, e.g. `/tmp/meeting-vote-data`
   - (optional) `PORT` — Render tự gán nếu không khai báo

5. **Link your database to the web service**:
   - In the Web Service → **Environment** or **Connections**
   - Render will inject `DATABASE_URL` automatically

6. **Deploy**
   - The app will prefer PostgreSQL because `DATABASE_URL` is set.
   - If the DB is unreachable, it will fall back to local JSON data only for safety.

7. **Verify after deployment**:
   - Open the service URL
   - Create or update data
   - Restart the service
   - Data should remain because it is stored in PostgreSQL, not in a container filesystem

Run locally with Docker (example):
```
docker build -t meeting-vote .
docker run -p 3000:3000 -e ADMIN_PASSWORD=admin123 -e SESSION_SECRET=change-me-please meeting-vote
```
