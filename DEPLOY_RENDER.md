# Deploy to Render (quick guide)

## Quick Setup (Persistent Disk - Free Plan)

1. **Push repository to GitHub**

2. **Create Web Service on Render**:
   - Connect your GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: `Node 18`

3. **Add Environment Variables**:
   - `ADMIN_PASSWORD` — mật khẩu admin
   - `SESSION_SECRET` — key cho JWT  
   - `DATA_DIR` — `/opt/render/project/src/data`
   - (optional) `PORT` — Render sẽ tự gán nếu không khai báo

4. **Enable Persistent Disk** (Free Plan - 0.5GB max):
   - In Render Dashboard → Web Service → **Disk**
   - Click **"Add Disk"**
   - **Name**: `data-disk`
   - **Size**: 0.5 GB (free max)
   - **Mount Path**: `/opt/render/project/src/data`
   - Click **"Create"** and **Redeploy**

5. **Verify after deployment**:
   - Open service URL
   - Try creating/updating data
   - Restart service — data should persist
   - If voter list missing, add `config/voters.json` to repo

Run locally with Docker (example):
```
docker build -t meeting-vote .
docker run -p 3000:3000 -e ADMIN_PASSWORD=admin123 -e SESSION_SECRET=change-me-please meeting-vote
```
