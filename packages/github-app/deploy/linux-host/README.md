# Linux host deployment

This template prepares a separate Quorate service on an existing HTTPS host. It
does not install anything or change the website by itself. `HOST=127.0.0.1` binds
the App to loopback; leaving HOST unset retains the Docker listener behavior.
HOST accepts IPv4/IPv6 literals and PORT must be an integer from 1 to 65535.

Before deploying, verify that port 3296 is free, `/usr/bin/node` is Node 22.22 or
newer, and the exact App bundle passes its local smoke checks. Preserve copies of
the active Nginx configuration, current service unit, environment file and release
symlink before changing them. Do not overwrite another service's configuration.

Create a dedicated system user and group named `quorate` with no login shell.
Use root-owned release directories under `/opt/quorate/releases/<release-id>`;
each contains the verified `dist/` bundle and `public/` assets. Link
`/opt/quorate/current` to the selected release. These files must be readable by
the service and must not be writable by it. The bundle is self-contained and
requires no production npm install. Keep a `package.json` containing
`{"private":true,"type":"module"}` alongside dist to declare the ESM runtime.

Create `/etc/quorate` owned by `root:quorate`, mode 0750. Copy
`quorate.env.example` to `/etc/quorate/app.env` and supply the actual GitHub App
ID, webhook secret and provider configuration in a private editor. Save the App
PEM key as `/etc/quorate/private-key.pem`. Both files must be owned by
`root:quorate`, mode 0640. The template deliberately leaves required values
empty: startup fails until credentials are supplied. Never echo, print or commit
credential contents. Configure the GitHub App's webhook URL as
`https://umutkorkmaz.net/quorate/api/webhook` using the same webhook secret.

Select API providers in each repository's trusted base-branch `.quorate.yml`.
The private environment file supplies their credential variables; it does not
select reviewers. Custom endpoint/credential pairs require the server-owned
`QUORATE_APP_PROVIDER_ALLOWLIST` described in the App README.

Create `/var/lib/quorate/state` owned by `quorate:quorate`, mode 0700; systemd
also manages its parent with StateDirectory. The durable review jobs survive
release changes. Back up this private state before upgrades, with the service
stopped for a consistent snapshot. Never mix website files or another App's
state into this directory.

Install `quorate.service` under `/etc/systemd/system/`. Verify the unit with
`systemd-analyze verify /etc/systemd/system/quorate.service`, then reload systemd
and start only this service. Inspect its status and verify that the socket is
bound to `127.0.0.1:3296`. A local GET to `http://127.0.0.1:3296/health` must return
the expected version. A health response confirms process availability only.

Include `nginx-location.conf` inside the existing HTTPS server block for the
apex domain. Its two exact locations map the prefixed public routes to the App's
existing endpoints. Preserve the current certificate and website upstream on
port 3000. Run `nginx -t` before reloading Nginx. Verify the website still responds
normally and `https://umutkorkmaz.net/quorate/health` reports the expected version.
Verify a signed synthetic GitHub `ping` is accepted and a bad signature is
rejected; do not send pull-request events or trigger reviews during deployment.

An installed service and signed ping do not demonstrate real App installation,
provider execution or PR Check Run delivery. Verify those separately after the
operator supplies credentials and explicitly selects a test repository.

For rollback, stop only `quorate`, restore the previous `/opt/quorate/current`
symlink and service/configuration files, validate the unit, run
`systemctl daemon-reload`, then restart it.
Restore the prior Nginx configuration only if its routes changed, validate it
with `nginx -t` and reload. Retain durable state unless a reviewed schema change
requires restoration from the private backup.
