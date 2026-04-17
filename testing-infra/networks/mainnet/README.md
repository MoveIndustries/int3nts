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
- Service config files: `coordinator_mainnet.toml`, `solver_mainnet.toml`, `integrated-gmp_mainnet.toml`
