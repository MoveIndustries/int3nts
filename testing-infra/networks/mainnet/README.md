# Mainnet Deployment

## EC2 Service Deployment

Deploy coordinator, integrated-gmp, solver, and frontend to 3 EC2 instances.

See [ec2-deploy.sh](ec2-deploy.sh) for full usage.

```bash
# First deploy
./ec2-deploy.sh deploy

# Code updates
./ec2-deploy.sh redeploy

# Tear down
./ec2-deploy.sh kill
```

## Local Validation Before Deploying

Test the frontend build without env vars (catches missing `NEXT_PUBLIC_*` config):

```bash
docker run --rm -v "$(pwd)/../../..":/src:ro -w /build node:22 bash -c "\
  cp -r /src/packages/sdk /build/sdk && \
  cp -r /src/frontend /build/frontend && \
  rm -f /build/frontend/.env.local && \
  rm -rf /build/sdk/node_modules /build/frontend/node_modules && \
  cd /build/sdk && npm install && npm run build && \
  cd /build/frontend && npm install --legacy-peer-deps && \
  rm -rf node_modules/@int3nts/sdk && cp -r /build/sdk node_modules/@int3nts/sdk && \
  npm run build"
```

## Prerequisites

- AWS CLI configured with SSO (see `.ec2-config` for profile name)
- SSH key pair: see ec2-deploy.sh header for creation instructions
- `.env.mainnet` populated (copy from `env.mainnet.example`)
- `.ec2-config` populated (copy from `ec2-config.example`)
- Service config files: `coordinator_mainnet.toml`, `solver_mainnet.toml`, `integrated-gmp_mainnet.toml`

## Custom Domain + HTTPS

The frontend is served over HTTPS via Caddy with automatic Let's Encrypt certificates. Browser wallet extensions (Nightly, Phantom) require a secure context — HTTPS is mandatory.

### One-time domain setup

1. **Buy a domain** (e.g. `example.xyz`).
2. **Point DNS to the coordinator IP**: add an `A` record at your DNS provider:
   - Type: `A`, Name: `@`, Value: `<coordinator public IP>`, TTL: 30 min
   - Remove any other `A` records on `@` (e.g. the provider's default parking page) — extra records cause round-robin that breaks Let's Encrypt validation.
3. **Set `FRONTEND_DOMAIN`** in `.ec2-config` to your domain.
4. **Wait for DNS propagation**: `dig <domain> +short` should return only the coordinator IP.
5. **Deploy** (`./ec2-deploy.sh deploy`). Caddy auto-fetches the cert on first start.

### If you need to update the Caddyfile on a running instance

Without a full redeploy:

```bash
ssh -i ~/.ssh/int3nts-ec2.pem ec2-user@<coordinator-ip> "sudo tee /etc/caddy/Caddyfile > /dev/null" << 'CADDY'
<your-domain> {
    handle /api/* {
        reverse_proxy localhost:3333
    }
    handle {
        reverse_proxy localhost:3000
    }
}
CADDY
ssh -i ~/.ssh/int3nts-ec2.pem ec2-user@<coordinator-ip> "sudo systemctl reload caddy"
```
