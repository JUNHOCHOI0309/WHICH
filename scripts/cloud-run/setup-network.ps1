# Creates only WHICH-owned networking resources. No VM, VPC connector, or inbound allow-all rule.
param(
  [string]$Project = 'which-505908',
  [string]$Region = 'asia-southeast1'
)
$ErrorActionPreference = 'Stop'

function Invoke-CloudCommand([string[]]$CommandArgs) {
  & gcloud @CommandArgs "--project=$Project" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Cloud command failed: $($CommandArgs[0..2] -join ' ')" }
}
function Get-CloudItems([string[]]$CommandArgs) {
  $cloudOutput = & gcloud @CommandArgs "--project=$Project" --format=json --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Cloud resource lookup failed; refusing to assume the resource is absent.' }
  return ($cloudOutput | ConvertFrom-Json)
}

Invoke-CloudCommand @('services', 'enable', 'compute.googleapis.com')
$networks = @(Get-CloudItems @('compute', 'networks', 'list', '--filter=name=which-run-vpc'))
if ($networks.Count -eq 0) {
  Invoke-CloudCommand @('compute', 'networks', 'create', 'which-run-vpc', '--subnet-mode=custom', '--bgp-routing-mode=regional')
} elseif ($networks.Count -ne 1 -or $networks[0].autoCreateSubnetworks) {
  throw 'Existing WHICH VPC does not match the expected custom network.'
}
$subnets = @(Get-CloudItems @('compute', 'networks', 'subnets', 'list', "--regions=$Region", '--filter=name=which-run-subnet'))
if ($subnets.Count -eq 0) {
  Invoke-CloudCommand @('compute', 'networks', 'subnets', 'create', 'which-run-subnet', '--network=which-run-vpc', "--region=$Region", '--range=10.88.0.0/26', '--enable-private-ip-google-access')
} elseif ($subnets.Count -ne 1 -or $subnets[0].ipCidrRange -ne '10.88.0.0/26' -or $subnets[0].network -notlike '*/which-run-vpc' -or -not $subnets[0].privateIpGoogleAccess) {
  throw 'Existing WHICH subnet does not match the expected private configuration.'
}
$addresses = @(Get-CloudItems @('compute', 'addresses', 'list', "--filter=name=which-run-egress AND region:$Region"))
if ($addresses.Count -eq 0) {
  Invoke-CloudCommand @('compute', 'addresses', 'create', 'which-run-egress', "--region=$Region", '--network-tier=PREMIUM')
} elseif ($addresses.Count -ne 1 -or $addresses[0].addressType -ne 'EXTERNAL') {
  throw 'Existing WHICH egress address is not an external IPv4 address.'
}
$routers = @(Get-CloudItems @('compute', 'routers', 'list', "--filter=name=which-run-router AND region:$Region"))
if ($routers.Count -eq 0) {
  Invoke-CloudCommand @('compute', 'routers', 'create', 'which-run-router', '--network=which-run-vpc', "--region=$Region")
} elseif ($routers.Count -ne 1 -or $routers[0].network -notlike '*/which-run-vpc') {
  throw 'Existing WHICH router belongs to a different network.'
}
$nats = @(Get-CloudItems @('compute', 'routers', 'nats', 'list', '--router=which-run-router', "--region=$Region") | Where-Object { $_.name -eq 'which-run-nat' })
if ($nats.Count -eq 0) {
  Invoke-CloudCommand @('compute', 'routers', 'nats', 'create', 'which-run-nat', '--router=which-run-router', "--region=$Region", '--nat-custom-subnet-ip-ranges=which-run-subnet', '--nat-external-ip-pool=which-run-egress')
} elseif ($nats.Count -ne 1 -or $nats[0].natIpAllocateOption -ne 'MANUAL_ONLY' -or $nats[0].natIps.Count -ne 1 -or $nats[0].natIps[0] -notlike '*/which-run-egress' -or $nats[0].sourceSubnetworkIpRangesToNat -ne 'LIST_OF_SUBNETWORKS' -or $nats[0].subnetworks.Count -ne 1 -or $nats[0].subnetworks[0].name -notlike '*/which-run-subnet') {
  throw 'Existing WHICH NAT does not match the expected single-IP, single-subnet policy.'
}
Invoke-CloudCommand @('compute', 'addresses', 'describe', 'which-run-egress', "--region=$Region", '--format=value(address)')
