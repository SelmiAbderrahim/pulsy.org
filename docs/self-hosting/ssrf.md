# Outbound target protection

Pulsy validates user-controlled destinations before saving settings and when
opening outbound connections. The egress guard covers HTTP monitors, HTTP
notification destinations, DNS/TCP monitor configuration, TLS probes and
outbound TCP/SMTP sockets. HTTP URLs must use HTTP or HTTPS, contain no embedded
credentials, and use a valid destination port.

## Choose the network policy

The OSS default is `MONITOR_ALLOW_PRIVATE_NETWORKS=true`. This allows monitoring
LAN services, loopback addresses, container service names, RFC1918 networks,
CGNAT and IPv6 unique-local addresses. Treat account access as permission to
reach services visible from the Pulsy server.

Set the following in the root `.env` to restrict connections to public targets:

```ini
MONITOR_ALLOW_PRIVATE_NETWORKS=false
```

Recreate the server through your deployment's Docker Compose workflow after
changing its environment. With private networks denied, internal suffixes such
as `.local`, `.internal`, `.lan` and `.home.arpa`, single-label service names,
private IP literals and names containing private IP addresses are rejected.
DNS answers must all be allowed; a mixed public/private answer is rejected.

`BLOCK_PRIVATE_TARGETS` is a deprecated compatibility alias. Only when the new
setting is unset or empty does `BLOCK_PRIVATE_TARGETS=true` deny private targets.
An explicit `MONITOR_ALLOW_PRIVATE_NETWORKS` takes precedence. Use the new
setting for new deployments; the server prints the selected policy at startup.

## Addresses that remain blocked

Allowing private networks never allows metadata or link-local destinations.
The guard rejects metadata hostnames, IPv4 `169.254.0.0/16`, IPv6 `fe80::/10`,
unspecified addresses, IPv4-mapped IPv6 literals and known metadata addresses
such as `fd00:ec2::254`. Non-canonical IPv4 spellings and unsafe URL forms are
also rejected. The policy is not a way to query instance metadata.

## Connection and redirect checks

HTTP sockets use a validating DNS lookup in both policy modes. The connection
uses the validated address, preserving the hostname for HTTP Host and TLS SNI.
TCP/SMTP sockets similarly resolve and pin their destination. This closes the
gap between validating a hostname and connecting after a DNS answer changes.

Every HTTP redirect destination is checked separately, with at most five
redirect hops. Changing the origin removes credential headers; advanced HTTP
checks also enforce their configured body and redirect rules. Strict mode fails
closed on DNS-resolution failures. In the default private-network mode, a
temporary validation-time resolution failure may defer reachability to the
connection, whose lookup still enforces the always-blocked addresses.

A rejected destination is a failed operation or observation, never a healthy
result. Review its configuration or the intentional deployment policy before
retrying. Network firewall rules remain useful for controlling which services
the Pulsy container can reach.

## Audit existing destinations

Run the read-only audit inside the server container:

```sh
make audit-private-targets
```

The audit evaluates stored HTTP/DNS/TCP monitors, HTTP notification destinations
and network templates against the strict policy even if the running deployment
allows private networks. It reports resource IDs, owner IDs, types and hostnames;
it omits full URLs, paths, queries and headers. It does not change the environment
of the running server, pause monitors or modify stored settings. Review findings
before enabling strict mode.

## Heartbeat URL logging

Heartbeat path tokens authorize receipt submission. The bundled
`docker/web.nginx.conf` excludes every `/api/heartbeat` path from access and
error logging regardless of case, including failed requests. Apply the same
exclusion at external reverse proxies, ingress, CDN and tracing layers. Redact
Authorization headers when using the Bearer alternative.

New and rotated heartbeat tokens are encrypted using `ENCRYPTION_KEY`; preserve
that key during migrations and restores. Only explicit authenticated owner
create, rotate or reveal actions expose tokens. Ordinary polling, history,
exports and public status responses omit credentials. See [Heartbeat
operation](heartbeat.md) for the ingress contract.
