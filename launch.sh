#!/usr/bin/env bash
# Run in Oracle Cloud Shell. Creates Always-Free networking + an Oracle Linux 9
# VM that auto-installs MNB Omni Caller on first boot. Requires ~/.ssh/omni_key.pub.
set -euo pipefail

C=$OCI_TENANCY
AD=$(oci iam availability-domain list --query 'data[0].name' --raw-output)
echo "==> Availability domain: $AD"

echo "==> Creating VCN"
VCN=$(oci network vcn create -c "$C" --cidr-block 10.0.0.0/16 --display-name mnb-vcn \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

echo "==> Internet gateway"
IG=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true \
  --display-name mnb-ig --wait-for-state AVAILABLE --query 'data.id' --raw-output)

RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id "$RT" --force \
  --route-rules '[{"destination":"0.0.0.0/0","networkEntityId":"'"$IG"'"}]' >/dev/null

SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
oci network security-list update --security-list-id "$SL" --force \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' \
  --ingress-security-rules '[
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}
  ]' >/dev/null

echo "==> Subnet"
SUB=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.1.0/24 \
  --display-name mnb-subnet --route-table-id "$RT" --security-list-ids '["'"$SL"'"]' \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

echo "==> Finding Oracle Linux 9 image"
IMG=$(oci compute image list -c "$C" --operating-system "Oracle Linux" \
  --operating-system-version "9" --shape "VM.Standard.E2.1.Micro" \
  --sort-by TIMECREATED --query 'data[0].id' --raw-output)

cat > /tmp/ud.sh <<'UD'
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/mnbresearch/mnb-omni-caller/main/deploy/provision.sh | bash > /var/log/mnb-provision.log 2>&1
UD

echo "==> Launching instance (Always Free VM.Standard.E2.1.Micro)"
INST=$(oci compute instance launch -c "$C" --availability-domain "$AD" \
  --shape "VM.Standard.E2.1.Micro" --subnet-id "$SUB" --image-id "$IMG" \
  --display-name mnb-omni-caller --assign-public-ip true \
  --ssh-authorized-keys-file ~/.ssh/omni_key.pub --user-data-file /tmp/ud.sh \
  --wait-for-state RUNNING --query 'data.id' --raw-output)

sleep 5
IP=$(oci compute instance list-vnics --instance-id "$INST" --query 'data[0]."public-ip"' --raw-output)
echo ""
echo "=================================================="
echo "  VM IS RUNNING.  PUBLIC IP:  $IP"
echo "  App auto-installs over ~3-4 min."
echo "=================================================="
