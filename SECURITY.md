# Security policy

## Supported versions

Only the latest release receives fixes (0.x: no long-term support).

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability"), or write to the maintainer (address on the GitHub profile). Include the version, the
platform, the steps to reproduce and the impact. You can expect an acknowledgement within a few days.

## Scope and security model

AI MediaLab is a **single-user local application**: the NestJS server and the inference engine listen on `127.0.0.1` only. The
server runs in "local trust" mode (no login): it accepts only requests whose socket is the loopback interface, with a local `Host`
and a local or absent `Origin`; it refuses to start on a non-loopback `HOST`. The engine requires a per-launch secret
(`X-Engine-Token`). Do not expose either port on a network and do not enable local trust on a server.

In scope: bypassing these checks (remote or cross-site access to the local API), path traversal in file endpoints, unsafe
handling of downloaded models or archives, secrets written to logs. Out of scope: the content produced by models, and the
licences or safety of third-party models you choose to download.
