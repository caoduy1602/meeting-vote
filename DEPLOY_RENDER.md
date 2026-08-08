# Deploy to Render (quick guide)

1. Push your repository to GitHub.

2. On Render dashboard, create a new **Web Service** and connect your GitHub repo.

3. Build & Start settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: `Node 18`

4. Add Environment Variables in Render's dashboard:
   - `ADMIN_PASSWORD` — mật khẩu admin
   - `SESSION_SECRET` — key cho JWT
   - `DATA_DIR=/opt/render/project/src/data`
   - (optionally) `PORT` — Render sẽ gán port nếu không khai báo

5. Enable a Persistent Disk on Render and mount it to:
   - `Mount Path: /opt/render/project/src/data`

6. After deploy, open the service URL. If voter list missing, create `config/voters.json` in repo.

Run locally with Docker (example):
```
docker build -t meeting-vote .
docker run -p 3000:3000 -e ADMIN_PASSWORD=admin123 -e SESSION_SECRET=change-me-please meeting-vote
```
