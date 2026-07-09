#!/usr/bin/env bash
# Launch a stronger Always-Free Ampere A1 VM (ARM) and auto-install the app.
# Reuses the mnb-subnet created earlier. Retries A1 across ADs if capacity is tight.
set -euo pipefail

C=$OCI_TENANCY

echo "==> Reusing existing subnet"
SUB=$(oci network subnet list -c "$C" --display-name mnb-subnet --query 'data[0].id' --raw-output)
if [ -z "$SUB" ] || [ "$SUB" = "null" ]; then
  echo "!! mnb-subnet not found. Run launch.sh first to create networking."; exit 1
fi

echo "==> Finding Oracle Linux 9 (aarch64) image for A1"
IMG=$(oci compute image list -c "$C" --operating-system "Oracle Linux" \
  --operating-system-version "9" --shape "VM.Standard.A1.Flex" \
  --sort-by TIMECREATED --query 'data[0].id' --raw-output)

cat > /tmp/ud.sh <<'UD'
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/mnbresearch/mnb-omni-caller/main/provision.sh | bash > /var/log/mnb-provision.log 2>&1
UD

ADS=$(oci iam availability-domain list --query 'data[].name' --raw-output | tr -d '[],"' )
INST=""
for AD in $ADS; do
  [ -z "$AD" ] && continue
  echo "==> Trying A1 (2 OCPU / 12GB) in $AD"
  if INST=$(oci compute instance launch -c "$C" --availability-domain "$AD" \
      --shape "VM.Standard.A1.Flex" --shape-config '{"ocpus":2,"memoryInGBs":12}' \
      --subnet-id "$SUB" --image-id "$IMG" --display-name mnb-omni-caller-a1 \
      --assign-public-ip true --ssh-authorized-keys-file ~/.ssh/omni_key.pub \
      --user-data-file /tmp/ud.sh --wait-for-state RUNNING \
      --query 'data.id' --raw-output 2>/tmp/a1err); then
    echo "==> Launched in $AD"
    break
  else
    echo "   No capacity in $AD ($(tail -1 /tmp/a1err | cut -c1-80))"
    INST=""
  fi
done

if [ -z "$INST" ]; then
  echo ""
  echo "!! A1 capacity unavailable in all ADs right now. This is common - re-run this"
  echo "   script in a few minutes/hours, or try a different region."
  exit 1
fi

sleep 5
IP=$(oci compute instance list-vnics --instance-id "$INST" --query 'data[0]."public-ip"' --raw-output)
echo ""
echo "=================================================="
echo "  A1 VM IS RUNNING.  PUBLIC IP:  $IP"
echo "  App auto-installs over ~2-3 min (plenty of RAM now)."
echo "=================================================="
