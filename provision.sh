#!/usr/bin/env bash
# MNB Omni Caller — one-shot server provisioning for Oracle Linux 9.
# Installs Node.js, the app, an nginx reverse proxy on port 80, a systemd
# service, and opens the OS firewall. Run with sudo on a fresh VM:
#   curl -fsSL https://raw.githubusercontent.com/mnbresearch/mnb-omni-caller/main/deploy/provision.sh | sudo bash
set -euo pipefail

APP_DIR=/opt/mnb-omni-caller
REPO=https://github.com/mnbresearch/mnb-omni-caller.git

echo "==> Installing Node.js 20, git, nginx"
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs git nginx

echo "==> Fetching app code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull
else
  git clone "$REPO" "$APP_DIR"
fi

echo "==> Installing dependencies"
cd "$APP_DIR"
npm install --omit=dev
mkdir -p "$APP_DIR/data"

echo "==> Writing .env (placeholders — secrets get filled in the next step)"
if [ ! -f "$APP_DIR/.env" ]; then
cat > "$APP_DIR/.env" <<EOF
OMNIDIM_API_KEY=REPLACE_ME
OMNIDIM_API_BASE=https://backend.omnidim.io/api/v1
ADMIN_EMAIL=mridulnanda2004@gmail.com
ADMIN_PASSWORD=REPLACE_ME
BRAND_NAME=MNB Omni Caller
PORT=3000
DATA_DIR=$APP_DIR/data
EOF
fi

echo "==> Creating systemd service"
cat > /etc/systemd/system/mnb.service <<EOF
[Unit]
Description=MNB Omni Caller
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mnb
systemctl restart mnb

echo "==> Configuring nginx reverse proxy (port 80 -> 3000)"
cat > /etc/nginx/conf.d/mnb.conf <<'EOF'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 30M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
# remove default server block if present
sed -i 's/    listen       80;/    listen 8081;/' /etc/nginx/nginx.conf || true
setsebool -P httpd_can_network_connect 1 || true
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "==> Opening OS firewall (80, 443)"
firewall-cmd --permanent --add-service=http || true
firewall-cmd --permanent --add-service=https || true
firewall-cmd --reload || true

echo "==> Done. App is running behind nginx on port 80."
echo "    Fill in secrets next, then: systemctl restart mnb"
