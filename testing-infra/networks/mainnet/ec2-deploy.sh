#!/bin/bash

# Deploy int3nts Services to EC2 (3 instances)
#
# Provisions 3 separate EC2 instances in the devnet AWS account:
#   - coordinator  (t3.nano)  — monitors intents, no keys
#   - integrated-gmp (t3.nano) — GMP message relay
#   - solver       (t3.micro) — fulfills intents, signs txs
#
# The solver instance doubles as the build machine (most RAM).
# Binaries are built there and copied to the nano instances.
#
# Estimated cost: ~$34/month (3x t3.micro + 3x public IPv4)
#
# Prerequisites:
#   - AWS CLI configured with SSO (aws sso login --sso-session Movement)
#   - SSH key pair created in the target AWS account
#   - .env.mainnet populated with keys and contract addresses
#   - Service config files created (*_mainnet.toml)
#
# Usage:
#   Main commands:
#     ./ec2-deploy.sh deploy                      # Provision, install deps, build, deploy, start
#     ./ec2-deploy.sh redeploy                    # Stop services, pull latest, rebuild, deploy, start
#     ./ec2-deploy.sh start                       # Start services
#     ./ec2-deploy.sh stop                        # Stop services
#     ./ec2-deploy.sh kill                        # Stop services, terminate instances, release IPs
#
#   Operations:
#     ./ec2-deploy.sh status                      # Show all service statuses
#     ./ec2-deploy.sh logs <service>              # Tail logs (coordinator|solver|integrated-gmp)
#     ./ec2-deploy.sh ssh <service>               # SSH to a specific instance
#
#   Use BUILD_BRANCH=<branch> to build from a specific branch (default: main)
#
#   Debugging (list int3nts-tagged instances in eu-central-1 via AWS CLI):
#     aws --profile movement:devnet --region eu-central-1 ec2 describe-instances --filters "Name=tag:Name,Values=int3nts-*" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].{ID:InstanceId,Name:Tags[?Key==`Name`].Value|[0],State:State.Name,IP:PublicIpAddress,Type:InstanceType}' --output table

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"

# Log all output
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ec2-deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# ---------------------------------------------------------------------------
# Configuration — edit these
# ---------------------------------------------------------------------------
AWS_PROFILE="movement:devnet"
AWS_REGION="eu-central-1"
KEY_NAME="int3nts-ec2"
SSH_KEY="$HOME/.ssh/int3nts-ec2.pem"

# Instance sizes (all t3.medium: 2 vCPU, 4 GB RAM, ~$30/month each)
COORDINATOR_INSTANCE_TYPE="t3.medium"
GMP_INSTANCE_TYPE="t3.medium"
SOLVER_INSTANCE_TYPE="t3.medium"

# Git branch to build from
BUILD_BRANCH="${BUILD_BRANCH:-main}"

# Service definitions: name, port, instance type
SERVICES=(coordinator integrated-gmp solver)

# State file
STATE_FILE="$SCRIPT_DIR/.ec2-state.env"

# Remote paths
REMOTE_USER="ec2-user"
REMOTE_DIR="/opt/int3nts"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

aws_cmd() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

load_state() {
    if [ -f "$STATE_FILE" ]; then
        source "$STATE_FILE"
    fi
}

save_state() {
    cat > "$STATE_FILE" << EOF
SG_ID=$SG_ID
COORDINATOR_INSTANCE_ID=$COORDINATOR_INSTANCE_ID
COORDINATOR_IP=$COORDINATOR_IP
COORDINATOR_PRIVATE_IP=$COORDINATOR_PRIVATE_IP
COORDINATOR_ALLOC_ID=$COORDINATOR_ALLOC_ID
GMP_INSTANCE_ID=$GMP_INSTANCE_ID
GMP_IP=$GMP_IP
GMP_PRIVATE_IP=$GMP_PRIVATE_IP
GMP_ALLOC_ID=$GMP_ALLOC_ID
SOLVER_INSTANCE_ID=$SOLVER_INSTANCE_ID
SOLVER_IP=$SOLVER_IP
SOLVER_PRIVATE_IP=$SOLVER_PRIVATE_IP
SOLVER_ALLOC_ID=$SOLVER_ALLOC_ID
EOF
}

require_state() {
    load_state
    if [ -z "$COORDINATOR_IP" ] || [ -z "$GMP_IP" ] || [ -z "$SOLVER_IP" ]; then
        echo "ERROR: Instances not provisioned. Run: $0 provision"
        exit 1
    fi
}

# Get the public IP for a service name
get_ip() {
    case "$1" in
        coordinator)    echo "$COORDINATOR_IP" ;;
        integrated-gmp) echo "$GMP_IP" ;;
        solver)         echo "$SOLVER_IP" ;;
        *) echo "ERROR: Unknown service $1" >&2; exit 1 ;;
    esac
}

get_private_ip() {
    case "$1" in
        coordinator)    echo "$COORDINATOR_PRIVATE_IP" ;;
        integrated-gmp) echo "$GMP_PRIVATE_IP" ;;
        solver)         echo "$SOLVER_PRIVATE_IP" ;;
        *) echo "ERROR: Unknown service $1" >&2; exit 1 ;;
    esac
}

ssh_to() {
    local svc="$1"; shift
    local ip=$(get_ip "$svc")
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i "$SSH_KEY" "$REMOTE_USER@$ip" "$@"
}

scp_to() {
    local svc="$1"; shift
    local ip=$(get_ip "$svc")
    scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i "$SSH_KEY" "$@" "$REMOTE_USER@$ip:"
}

wait_for_ssh() {
    local svc="$1"
    local ip=$(get_ip "$svc")
    echo "   Waiting for SSH on $svc ($ip)..."
    for i in $(seq 1 30); do
        if ssh_to "$svc" "true" 2>/dev/null; then
            return 0
        fi
        sleep 5
    done
    echo "ERROR: SSH not available on $svc after 150s"
    exit 1
}

# ---------------------------------------------------------------------------
# provision — Create 3 EC2 instances
# ---------------------------------------------------------------------------

launch_instance() {
    local name="$1"
    local instance_type="$2"
    local ami_id="$3"
    local sg_id="$4"

    echo "   Launching $name ($instance_type)..."
    local instance_id
    instance_id=$(aws_cmd ec2 run-instances \
        --image-id "$ami_id" \
        --instance-type "$instance_type" \
        --key-name "$KEY_NAME" \
        --security-group-ids "$sg_id" \
        --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=int3nts-$name}]" \
        --query 'Instances[0].InstanceId' --output text)
    echo "     $instance_id"
    echo "$instance_id"
}

cmd_provision() {
    load_state

    if [ -n "$COORDINATOR_INSTANCE_ID" ]; then
        echo "⚠️  Instances already provisioned — skipping provisioning."
        echo "   coordinator:    $COORDINATOR_IP"
        echo "   integrated-gmp: $GMP_IP"
        echo "   solver:         $SOLVER_IP"
        echo "   To re-provision, run: $0 kill && $0 deploy"
        return 0
    fi

    echo "=========================================="
    echo " Provisioning 3 EC2 instances"
    echo "=========================================="
    echo ""
    echo " AWS profile:  $AWS_PROFILE"
    echo " Region:       $AWS_REGION"
    echo ""
    echo " coordinator:    $COORDINATOR_INSTANCE_TYPE"
    echo " integrated-gmp: $GMP_INSTANCE_TYPE"
    echo " solver:         $SOLVER_INSTANCE_TYPE"
    echo ""

    # Verify AWS access
    echo " Verifying AWS access..."
    CALLER=$(aws_cmd sts get-caller-identity --query 'Arn' --output text 2>/dev/null) || {
        echo "ERROR: AWS auth failed. Run: aws sso login --sso-session Movement"
        exit 1
    }
    echo "   Authenticated as: $CALLER"

    # Verify key pair
    aws_cmd ec2 describe-key-pairs --key-names "$KEY_NAME" --query 'KeyPairs[0].KeyName' --output text 2>/dev/null || {
        echo "ERROR: Key pair '$KEY_NAME' not found in $AWS_REGION"
        echo ""
        echo "   Create one:"
        echo "   aws --profile $AWS_PROFILE --region $AWS_REGION ec2 create-key-pair \\"
        echo "     --key-name $KEY_NAME --query 'KeyMaterial' --output text > $SSH_KEY"
        echo "   chmod 400 $SSH_KEY"
        exit 1
    }

    # Get default VPC
    VPC_ID=$(aws_cmd ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
        --query 'Vpcs[0].VpcId' --output text)
    echo " VPC: $VPC_ID"

    # Create security group
    echo " Creating security group..."
    SG_ID=$(aws_cmd ec2 create-security-group \
        --group-name "int3nts-services" \
        --description "int3nts coordinator/solver/gmp services" \
        --vpc-id "$VPC_ID" \
        --query 'GroupId' --output text 2>/dev/null) || {
        SG_ID=$(aws_cmd ec2 describe-security-groups \
            --filters "Name=group-name,Values=int3nts-services" \
            --query 'SecurityGroups[0].GroupId' --output text)
    }
    echo "   $SG_ID"

    # Ingress rules
    echo " Configuring security group rules..."
    # SSH
    aws_cmd ec2 authorize-security-group-ingress --group-id "$SG_ID" \
        --protocol tcp --port 22 --cidr 0.0.0.0/0 > /dev/null 2>&1 || true
    # HTTPS (Caddy)
    aws_cmd ec2 authorize-security-group-ingress --group-id "$SG_ID" \
        --protocol tcp --port 443 --cidr 0.0.0.0/0 > /dev/null 2>&1 || true
    aws_cmd ec2 authorize-security-group-ingress --group-id "$SG_ID" \
        --protocol tcp --port 80 --cidr 0.0.0.0/0 > /dev/null 2>&1 || true
    # Inter-service: allow all TCP within the security group
    aws_cmd ec2 authorize-security-group-ingress --group-id "$SG_ID" \
        --protocol tcp --port 0-65535 --source-group "$SG_ID" > /dev/null 2>&1 || true
    echo "   SSH (22), HTTP (80), HTTPS (443) open externally"
    echo "   All TCP open between instances in this security group"

    # AMI
    AMI_ID=$(aws_cmd ssm get-parameters \
        --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
        --query 'Parameters[0].Value' --output text)
    echo " AMI: $AMI_ID (Amazon Linux 2023)"
    echo ""

    # Launch 3 instances
    echo " Launching instances..."
    COORDINATOR_INSTANCE_ID=$(launch_instance "coordinator" "$COORDINATOR_INSTANCE_TYPE" "$AMI_ID" "$SG_ID" | tail -1)
    GMP_INSTANCE_ID=$(launch_instance "integrated-gmp" "$GMP_INSTANCE_TYPE" "$AMI_ID" "$SG_ID" | tail -1)
    SOLVER_INSTANCE_ID=$(launch_instance "solver" "$SOLVER_INSTANCE_TYPE" "$AMI_ID" "$SG_ID" | tail -1)

    # Wait for all 3
    echo ""
    echo " Waiting for instances to be running..."
    aws_cmd ec2 wait instance-running \
        --instance-ids "$COORDINATOR_INSTANCE_ID" "$GMP_INSTANCE_ID" "$SOLVER_INSTANCE_ID"
    echo " Waiting for status checks..."
    aws_cmd ec2 wait instance-status-ok \
        --instance-ids "$COORDINATOR_INSTANCE_ID" "$GMP_INSTANCE_ID" "$SOLVER_INSTANCE_ID"

    # Get private IPs
    COORDINATOR_PRIVATE_IP=$(aws_cmd ec2 describe-instances --instance-ids "$COORDINATOR_INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
    GMP_PRIVATE_IP=$(aws_cmd ec2 describe-instances --instance-ids "$GMP_INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
    SOLVER_PRIVATE_IP=$(aws_cmd ec2 describe-instances --instance-ids "$SOLVER_INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)

    # Allocate and associate Elastic IPs
    echo ""
    echo " Allocating Elastic IPs..."
    for svc_var in COORDINATOR GMP SOLVER; do
        local svc_lower=$(echo "$svc_var" | tr '[:upper:]' '[:lower:]')
        ALLOC=$(aws_cmd ec2 allocate-address --domain vpc \
            --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=int3nts-$svc_lower}]" \
            --query '{AllocationId:AllocationId,PublicIp:PublicIp}' --output json)
        eval "${svc_var}_ALLOC_ID=$(echo "$ALLOC" | python3 -c "import sys,json; print(json.load(sys.stdin)['AllocationId'])")"
        eval "${svc_var}_IP=$(echo "$ALLOC" | python3 -c "import sys,json; print(json.load(sys.stdin)['PublicIp'])")"

        local_instance_id_var="${svc_var}_INSTANCE_ID"
        local_alloc_id_var="${svc_var}_ALLOC_ID"
        local_ip_var="${svc_var}_IP"
        aws_cmd ec2 associate-address \
            --instance-id "${!local_instance_id_var}" \
            --allocation-id "${!local_alloc_id_var}" > /dev/null 2>&1
        echo "   $svc_lower: ${!local_ip_var}"
    done

    save_state

    echo ""
    echo "=========================================="
    echo " Provisioning complete!"
    echo "=========================================="
    echo ""
    echo " coordinator:    $COORDINATOR_INSTANCE_ID  $COORDINATOR_IP (private: $COORDINATOR_PRIVATE_IP)"
    echo " integrated-gmp: $GMP_INSTANCE_ID  $GMP_IP (private: $GMP_PRIVATE_IP)"
    echo " solver:         $SOLVER_INSTANCE_ID  $SOLVER_IP (private: $SOLVER_PRIVATE_IP)"
    echo ""
}

# ---------------------------------------------------------------------------
# setup — Provision instances, install dependencies, clone repo, build
# ---------------------------------------------------------------------------

cmd_setup() {
    cmd_provision

    echo ""
    echo "=========================================="
    echo " Installing dependencies"
    echo "=========================================="
    echo ""

    for svc in "${SERVICES[@]}"; do
        wait_for_ssh "$svc"
    done

    # Install base packages on all instances
    for svc in "${SERVICES[@]}"; do
        echo ""
        echo " [$svc] Installing system packages..."
        ssh_to "$svc" "sudo dnf update -y -q && sudo dnf install -y -q git gcc openssl-devel pkg-config"
        echo " [$svc] Creating directories..."
        ssh_to "$svc" "sudo mkdir -p $REMOTE_DIR/{bin,config,env} && sudo chown -R $REMOTE_USER:$REMOTE_USER $REMOTE_DIR"
    done

    # Install Rust only on solver (build machine)
    echo ""
    echo " [solver] Installing Rust (build machine)..."
    ssh_to solver "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    echo " [solver] Cloning repository..."
    ssh_to solver "git clone https://github.com/MoveIndustries/int3nts.git $REMOTE_DIR/src"
    echo " [solver] Copying SSH key for binary distribution..."
    scp_to solver "$SSH_KEY"
    ssh_to solver "mkdir -p ~/.ssh && mv ~/$(basename $SSH_KEY) ~/.ssh/ && chmod 400 ~/.ssh/$(basename $SSH_KEY)"

    # Install Node.js on coordinator (for frontend)
    echo ""
    echo " [coordinator] Installing Node.js..."
    ssh_to coordinator "curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y -q nodejs"
    echo " [coordinator] Cloning repository..."
    ssh_to coordinator "git clone https://github.com/MoveIndustries/int3nts.git $REMOTE_DIR/src"

    # Install Caddy on coordinator and GMP (public-facing)
    for svc in coordinator integrated-gmp; do
        echo " [$svc] Installing Caddy..."
        ssh_to "$svc" "sudo dnf install -y -q 'dnf-command(copr)' && \
                        sudo dnf copr enable -y @caddy/caddy epel-9-x86_64 && \
                        sudo dnf install -y -q caddy"
    done

    # Build binaries
    cmd_build

    echo ""
    echo " Setup complete. Next: $0 deploy"
}

# ---------------------------------------------------------------------------
# build — Build all binaries on the solver instance
# ---------------------------------------------------------------------------

cmd_build() {
    require_state

    echo "=========================================="
    echo " Building on solver instance ($SOLVER_IP)"
    echo "=========================================="
    echo ""

    # Pull latest code on solver
    echo " Pulling latest code (branch: $BUILD_BRANCH)..."
    ssh_to solver "cd $REMOTE_DIR/src && git fetch origin && git checkout $BUILD_BRANCH && git pull origin $BUILD_BRANCH"

    echo ""
    echo " Building release binaries (first build may take several minutes)..."
    ssh_to solver "source \$HOME/.cargo/env && cd $REMOTE_DIR/src && \
                   cargo build --release --manifest-path coordinator/Cargo.toml && \
                   cargo build --release --manifest-path integrated-gmp/Cargo.toml && \
                   cargo build --release --manifest-path solver/Cargo.toml"

    # Copy solver binary locally on solver instance
    echo ""
    echo " Installing solver binary..."
    ssh_to solver "cp $REMOTE_DIR/src/solver/target/release/solver $REMOTE_DIR/bin/"

    # Copy coordinator and GMP binaries to their instances
    echo " Distributing coordinator binary..."
    ssh_to solver "scp -o StrictHostKeyChecking=no -i ~/.ssh/$(basename $SSH_KEY) \
        $REMOTE_DIR/src/coordinator/target/release/coordinator \
        $REMOTE_USER@$COORDINATOR_PRIVATE_IP:$REMOTE_DIR/bin/"

    echo " Distributing integrated-gmp binary..."
    ssh_to solver "scp -o StrictHostKeyChecking=no -i ~/.ssh/$(basename $SSH_KEY) \
        $REMOTE_DIR/src/integrated-gmp/target/release/integrated-gmp \
        $REMOTE_USER@$GMP_PRIVATE_IP:$REMOTE_DIR/bin/"

    # Build frontend on coordinator
    echo ""
    echo " Building frontend on coordinator..."
    ssh_to coordinator "cd $REMOTE_DIR/src && git fetch origin && git checkout $BUILD_BRANCH && git pull origin $BUILD_BRANCH"
    ssh_to coordinator "cd $REMOTE_DIR/src/packages/sdk && npm install && npm run build"
    ssh_to coordinator "cd $REMOTE_DIR/src/frontend && npm install --legacy-peer-deps"
    ssh_to coordinator "rm -rf $REMOTE_DIR/src/frontend/node_modules/@int3nts/sdk && cp -r $REMOTE_DIR/src/packages/sdk $REMOTE_DIR/src/frontend/node_modules/@int3nts/sdk"
    ssh_to coordinator "cd $REMOTE_DIR/src/frontend && npm run build"

    echo ""
    echo " Build complete. Next: $0 deploy"
}

# ---------------------------------------------------------------------------
# deploy — Push configs, install systemd units, start services
# ---------------------------------------------------------------------------

cmd_deploy() {
    require_state

    echo "=========================================="
    echo " Deploying configs and starting services"
    echo "=========================================="
    echo ""

    # Check required files exist locally
    for cfg in \
        "$PROJECT_ROOT/coordinator/config/coordinator_mainnet.toml" \
        "$PROJECT_ROOT/solver/config/solver_mainnet.toml" \
        "$PROJECT_ROOT/integrated-gmp/config/integrated-gmp_mainnet.toml" \
        "$SCRIPT_DIR/.env.mainnet"; do
        if [ ! -f "$cfg" ]; then
            echo "ERROR: Missing $cfg"
            exit 1
        fi
    done

    # --- Patch configs with inter-service private IPs ---

    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    # Coordinator config: solver_url -> solver private IP
    sed "s|http://localhost:4444|http://$SOLVER_PRIVATE_IP:4444|g" \
        "$PROJECT_ROOT/coordinator/config/coordinator_mainnet.toml" \
        > "$TEMP_DIR/coordinator_mainnet.toml"

    # Solver config: coordinator_url -> coordinator private IP, integrated_gmp_url -> GMP private IP
    sed -e "s|http://localhost:3333|http://$COORDINATOR_PRIVATE_IP:3333|g" \
        -e "s|http://localhost:3334|http://$GMP_PRIVATE_IP:3334|g" \
        "$PROJECT_ROOT/solver/config/solver_mainnet.toml" \
        > "$TEMP_DIR/solver_mainnet.toml"

    # GMP config: no inter-service URLs to patch, but bind to 0.0.0.0
    cp "$PROJECT_ROOT/integrated-gmp/config/integrated-gmp_mainnet.toml" \
       "$TEMP_DIR/integrated-gmp_mainnet.toml"

    echo " Patched configs with private IPs:"
    echo "   coordinator -> solver at $SOLVER_PRIVATE_IP:4444"
    echo "   solver -> coordinator at $COORDINATOR_PRIVATE_IP:3333"
    echo "   solver -> gmp at $GMP_PRIVATE_IP:3334"
    echo ""

    # --- Push configs and env to each instance ---

    for svc in "${SERVICES[@]}"; do
        local svc_file
        case "$svc" in
            coordinator)    svc_file="coordinator_mainnet.toml" ;;
            integrated-gmp) svc_file="integrated-gmp_mainnet.toml" ;;
            solver)         svc_file="solver_mainnet.toml" ;;
        esac

        echo " [$svc] Pushing config..."
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i "$SSH_KEY" \
            "$TEMP_DIR/$svc_file" \
            "$REMOTE_USER@$(get_ip "$svc"):$REMOTE_DIR/config/"

        echo " [$svc] Pushing .env.mainnet..."
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -i "$SSH_KEY" \
            "$SCRIPT_DIR/.env.mainnet" \
            "$REMOTE_USER@$(get_ip "$svc"):$REMOTE_DIR/env/"
        ssh_to "$svc" "chmod 600 $REMOTE_DIR/env/.env.mainnet"
    done

    # --- Install systemd units ---

    echo ""
    echo " Installing systemd units..."

    # Coordinator
    ssh_to coordinator "sudo tee /etc/systemd/system/int3nts.service > /dev/null" << 'UNIT'
[Unit]
Description=int3nts coordinator (mainnet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
EnvironmentFile=/opt/int3nts/env/.env.mainnet
Environment=COORDINATOR_CONFIG_PATH=/opt/int3nts/config/coordinator_mainnet.toml
Environment=RUST_LOG=info
ExecStart=/opt/int3nts/bin/coordinator --mainnet
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

    # Frontend (on coordinator instance)
    ssh_to coordinator "sudo tee /etc/systemd/system/int3nts-frontend.service > /dev/null" << UNIT
[Unit]
Description=int3nts frontend (mainnet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
EnvironmentFile=/opt/int3nts/env/.env.mainnet
Environment=NODE_ENV=production
Environment=PORT=3000
WorkingDirectory=$REMOTE_DIR/src/frontend
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

    # Integrated-GMP
    ssh_to integrated-gmp "sudo tee /etc/systemd/system/int3nts.service > /dev/null" << 'UNIT'
[Unit]
Description=int3nts integrated-gmp (mainnet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
EnvironmentFile=/opt/int3nts/env/.env.mainnet
Environment=INTEGRATED_GMP_CONFIG_PATH=/opt/int3nts/config/integrated-gmp_mainnet.toml
Environment=RUST_LOG=info
ExecStart=/opt/int3nts/bin/integrated-gmp --mainnet
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

    # Solver
    ssh_to solver "sudo tee /etc/systemd/system/int3nts.service > /dev/null" << 'UNIT'
[Unit]
Description=int3nts solver (mainnet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
EnvironmentFile=/opt/int3nts/env/.env.mainnet
Environment=SOLVER_CONFIG_PATH=/opt/int3nts/config/solver_mainnet.toml
Environment=RUST_LOG=info,solver::service::tracker=debug,solver::chains::hub=debug
ExecStart=/opt/int3nts/bin/solver
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

    # --- Configure Caddy on coordinator and GMP ---

    echo ""
    echo " Configuring Caddy reverse proxy..."

    ssh_to coordinator "sudo tee /etc/caddy/Caddyfile > /dev/null" << CADDY
:443 {
    handle /api/* {
        reverse_proxy localhost:3333
    }
    handle {
        reverse_proxy localhost:3000
    }
    tls internal
}
CADDY

    ssh_to integrated-gmp "sudo tee /etc/caddy/Caddyfile > /dev/null" << CADDY
:443 {
    reverse_proxy localhost:3334
    tls internal
}
CADDY

    # --- Bind services to 0.0.0.0 so they're reachable from other instances ---
    # The configs use host = "127.0.0.1" — patch to 0.0.0.0 on the instances
    for svc in "${SERVICES[@]}"; do
        ssh_to "$svc" "sed -i 's/host = \"127.0.0.1\"/host = \"0.0.0.0\"/' $REMOTE_DIR/config/*_mainnet.toml" 2>/dev/null || true
    done

    # --- Start services ---

    echo ""
    echo " Starting services..."

    # Start coordinator first (solver depends on it)
    ssh_to coordinator "sudo systemctl daemon-reload && sudo systemctl enable int3nts int3nts-frontend caddy && sudo systemctl restart int3nts int3nts-frontend caddy"
    echo "   coordinator + frontend started"
    sleep 2

    ssh_to integrated-gmp "sudo systemctl daemon-reload && sudo systemctl enable int3nts caddy && sudo systemctl restart int3nts caddy"
    echo "   integrated-gmp started"
    sleep 2

    ssh_to solver "sudo systemctl daemon-reload && sudo systemctl enable int3nts && sudo systemctl restart int3nts"
    echo "   solver started"

    echo ""
    echo "=========================================="
    echo " Deployment complete!"
    echo "=========================================="
    echo ""
    echo " Service status:"
    for svc in "${SERVICES[@]}"; do
        local status
        status=$(ssh_to "$svc" "sudo systemctl is-active int3nts" 2>/dev/null || echo "unknown")
        printf "   %-16s %s (%s)\n" "$svc" "$status" "$(get_ip "$svc")"
    done
    echo ""
    echo " Endpoints:"
    echo "   Frontend:    https://$COORDINATOR_IP"
    echo "   Coordinator: https://$COORDINATOR_IP/api"
    echo "   GMP:         https://$GMP_IP:443"
    echo "   Solver:      internal ($SOLVER_PRIVATE_IP:4444)"
    echo ""
    echo " Logs:    $0 logs <service>"
    echo " SSH:     $0 ssh <service>"
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
    require_state
    echo ""
    for svc in "${SERVICES[@]}"; do
        local ip=$(get_ip "$svc")
        echo " [$svc] $ip"
        ssh_to "$svc" "sudo systemctl status int3nts --no-pager -l 2>/dev/null" || echo "   (not running)"
        echo ""
    done
}

# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------

cmd_logs() {
    require_state
    local svc="${1:-}"

    if [ -z "$svc" ]; then
        echo "Usage: $0 logs <coordinator|integrated-gmp|solver>"
        exit 1
    fi

    # Validate service name
    get_ip "$svc" > /dev/null
    ssh_to "$svc" "sudo journalctl -u int3nts -f"
}

# ---------------------------------------------------------------------------
# ssh
# ---------------------------------------------------------------------------

cmd_ssh() {
    require_state
    local svc="${1:-}"

    if [ -z "$svc" ]; then
        echo "Usage: $0 ssh <coordinator|integrated-gmp|solver>"
        echo ""
        echo " Instances:"
        echo "   coordinator:    $COORDINATOR_IP"
        echo "   integrated-gmp: $GMP_IP"
        echo "   solver:         $SOLVER_IP"
        exit 1
    fi

    get_ip "$svc" > /dev/null
    local ip=$(get_ip "$svc")
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i "$SSH_KEY" "$REMOTE_USER@$ip"
}

# ---------------------------------------------------------------------------
# deploy / redeploy / start / stop
# ---------------------------------------------------------------------------

cmd_deploy_all() {
    cmd_setup
    cmd_deploy
}

cmd_redeploy() {
    cmd_stop
    cmd_build
    cmd_deploy
}

cmd_start() {
    require_state
    ssh_to coordinator "sudo systemctl start int3nts int3nts-frontend"
    echo " coordinator + frontend started"
    sleep 2
    ssh_to integrated-gmp "sudo systemctl start int3nts"
    echo " integrated-gmp started"
    sleep 2
    ssh_to solver "sudo systemctl start int3nts"
    echo " solver started"
}

cmd_stop() {
    require_state
    for svc in solver integrated-gmp coordinator; do
        echo " Stopping $svc..."
        ssh_to "$svc" "sudo systemctl stop int3nts" 2>/dev/null || true
    done
    ssh_to coordinator "sudo systemctl stop int3nts-frontend" 2>/dev/null || true
    echo " All services stopped"
}

# ---------------------------------------------------------------------------
# kill — Terminate all EC2 instances, release Elastic IPs, delete state
# ---------------------------------------------------------------------------

cmd_kill() {
    echo "=========================================="
    echo " Killing all int3nts resources"
    echo "=========================================="
    echo ""

    # Find and terminate all int3nts-tagged running instances
    local instance_ids
    instance_ids=$(aws_cmd ec2 describe-instances \
        --filters "Name=tag:Name,Values=int3nts-*" "Name=instance-state-name,Values=running,pending" \
        --query 'Reservations[].Instances[].InstanceId' --output text)

    if [ -n "$instance_ids" ]; then
        echo " Terminating instances: $instance_ids"
        aws_cmd ec2 terminate-instances --instance-ids $instance_ids --output text
    else
        echo " No running instances found."
    fi

    # Release all int3nts-tagged Elastic IPs
    local alloc_ids
    alloc_ids=$(aws_cmd ec2 describe-addresses \
        --filters "Name=tag:Name,Values=int3nts-*" \
        --query 'Addresses[].AllocationId' --output text)

    if [ -n "$alloc_ids" ]; then
        for alloc_id in $alloc_ids; do
            echo " Releasing Elastic IP ($alloc_id)..."
            aws_cmd ec2 release-address --allocation-id "$alloc_id" 2>/dev/null || true
        done
    else
        echo " No Elastic IPs to release."
    fi

    # Delete state file
    rm -f "$STATE_FILE"
    echo ""
    echo " All int3nts resources cleaned up."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "${1:-}" in
    deploy)     cmd_deploy_all ;;
    redeploy)   cmd_redeploy ;;
    start)      cmd_start ;;
    stop)       cmd_stop ;;
    kill)       cmd_kill ;;
    status)     cmd_status ;;
    logs)       cmd_logs "${2:-}" ;;
    ssh)        cmd_ssh "${2:-}" ;;
    *)
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Main commands:"
        echo "  deploy                 Provision, install deps, build, deploy, start"
        echo "  redeploy               Stop services, pull latest, rebuild, deploy, start"
        echo "  start                  Start services"
        echo "  stop                   Stop services"
        echo "  kill                   Stop services, terminate instances, release IPs"
        echo ""
        echo "Operations:"
        echo "  status                 Show service status on all instances"
        echo "  logs <service>         Tail logs (coordinator|integrated-gmp|solver)"
        echo "  ssh <service>          SSH to instance (coordinator|integrated-gmp|solver)"
        echo ""
        echo "Use BUILD_BRANCH=<branch> to build from a specific branch (default: main)"
        exit 1
        ;;
esac
