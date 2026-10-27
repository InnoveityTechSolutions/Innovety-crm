# Production Deployment Checklist & Verification Guide

Follow this step-by-step checklist to deploy the backend and frontend configuration updates for `https://crm.innoveity.tech`.

---

## 1. Production Requirements Overview

The deployment environment uses the following verified configuration:
- **Backend Port:** `3002` (managed via PM2)
- **Frontend Origin:** `https://crm.innoveity.tech`
- **API Base URL:** `https://crm.innoveity.tech/api`
- **Database Engine:** MySQL (as specified in `backend/prisma/schema.prisma`)

---

## 2. SSH into the Production VPS Server

Connect to your server:
```bash
ssh user@crm.innoveity.tech
```

Navigate to your application root directory:
```bash
cd /path/to/MRF-crm
```

---

## 3. Environment Variables Configuration (`backend/.env`)

Ensure your production `backend/.env` file contains:

```env
NODE_ENV=production
PORT=3002
DATABASE_URL="mysql://<user>:<password>@localhost:3306/innoveity_crm"
JWT_SECRET="<your_secure_production_jwt_secret>"
FRONTEND_URL="https://crm.innoveity.tech"
ALLOWED_ORIGINS="https://crm.innoveity.tech"
COMPANY_NAME="Innoveity"
MULTI_TENANT_ENABLED=true
```

> **Note on `backend/env`:** If a file named `backend/env` exists on the server, note that it is a legacy/stale file containing obsolete PostgreSQL settings. Production uses `backend/.env` with MySQL.

---

## 4. Frontend Build Instructions (Vite)

> **Important:** Vite environment variables are compiled into static client bundles at **build time**. 
> After updating `VITE_API_URL`, the frontend bundle must be rebuilt before changes take effect in the browser.

In the `frontend/` directory, build the production assets:

```bash
cd frontend
VITE_API_URL=https://crm.innoveity.tech/api npm run build
cd ..
```

---

## 5. Recommended Nginx Reverse Proxy Configuration

The deployment team must review and ensure `/etc/nginx/sites-available/innoveity-crm` or `/etc/nginx/conf.d/crm.conf` routes `/api/`, `/uploads/`, and `/socket.io/` to backend port `3002`:

```nginx
# 1. API Reverse Proxy to Backend Port 3002
location /api/ {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    client_max_body_size 25M;
}

# 2. Uploads Directory Reverse Proxy to Backend Port 3002
location /uploads/ {
    proxy_pass http://127.0.0.1:3002/uploads/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25M;
}

# 3. Socket.IO Real-Time WebSocket Proxy to Backend Port 3002
location /socket.io/ {
    proxy_pass http://127.0.0.1:3002/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# 4. Frontend Static Application Bundle
location / {
    root /path/to/MRF-crm/frontend/dist;
    index index.html;
    try_files $uri $uri/ /index.html;
}
```

Test syntax and reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Application Deployment & Restart

Execute the deployment sequence:

```bash
# 1. Pull latest changes
git pull

# 2. Backend dependency and Prisma sync
cd backend
npm install --production
npx prisma generate
npx prisma migrate deploy

# 3. Restart PM2 node application process with updated environment
pm2 restart all --update-env
# or: pm2 restart innoveity-crm-backend --update-env

# 4. Verify PM2 startup logs
pm2 logs --lines 50
```

Verify the log contains:
`[STARTUP] Enterprise CRM backend server is running on port 3002`
`[STARTUP] Frontend URL: https://crm.innoveity.tech`

---

## 7. Production Health & Sanity Verification

Run these verification commands directly on the server or from any terminal:

```bash
# 1. Verify health probe endpoint (Expect HTTP 200: {"status":"healthy"})
curl -I https://crm.innoveity.tech/api/health

# 2. Verify platform settings endpoint (Expect HTTP 200 OK)
curl -I https://crm.innoveity.tech/api/platform/settings

# 3. Verify organizations endpoint (Expect HTTP 200 OK)
curl -I https://crm.innoveity.tech/api/organizations

# 4. Run automated non-destructive live production probes
node backend/check_live_server.js
node backend/test_live_logins.js
```
