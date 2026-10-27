#!/bin/sh
# Run through `make web-assets-check`; all application execution stays in Docker.
set -eu

image=${PULSY_WEB_TEST_IMAGE:-}
if [ -z "$image" ]; then
	image=$(docker compose -f docker/docker-compose.yml --env-file .env images -q web)
fi
if [ -z "$image" ]; then
	printf '%s\n' 'Build the web image before running web-assets-check.' >&2
	exit 1
fi

fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/pulsy-web-assets.XXXXXXXXXX")
test_name=${fixture_dir##*/}
volume=$test_name
volume_created=0
containers=
cleanup() {
	for container in $containers; do
		docker rm -f "$container" >/dev/null 2>&1 || :
	done
	if [ "$volume_created" = 1 ]; then
		docker volume rm "$volume" >/dev/null 2>&1 || :
	fi
	rm -rf "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Never adopt an existing resource: cleanup only owns this invocation's volume.
if docker volume inspect "$volume" >/dev/null 2>&1; then
	printf 'Refusing existing test volume: %s\n' "$volume" >&2
	exit 1
fi
docker volume create "$volume" >/dev/null
volume_created=1
mkdir -p "$fixture_dir/old/assets" "$fixture_dir/new/assets" "$fixture_dir/collision/assets"
old_asset=pulsy-retained-old-a1b2c3d4.js
new_asset=pulsy-retained-new-e5f6a7b8.js
line=0
while [ "$line" -lt 100 ]; do
	printf '%s\n' '// old immutable asset' >>"$fixture_dir/old/assets/$old_asset"
	printf '%s\n' '// new immutable asset' >>"$fixture_dir/new/assets/$new_asset"
	line=$((line + 1))
done
printf '%s\n' '// replacement must never overwrite the retained hash' >"$fixture_dir/collision/assets/$old_asset"
printf '%s\n' '<html>PULSY_ASSET_TEST_SPA</html>' >"$fixture_dir/old/index.html"
cp "$fixture_dir/old/index.html" "$fixture_dir/new/index.html"

create_snapshot() {
	name=$test_name-$1
	fixture=$2
	command=$3
	docker create --name "$name" --user 101:101 \
		--add-host server:127.0.0.1 \
		--mount "type=volume,source=$volume,target=/var/cache/pulsy" \
		--entrypoint /bin/sh "$image" -ec "$command" >/dev/null
	containers="$containers $name"
	# Fixtures change only the stopped container's image filesystem, never the repo.
	docker cp "$fixture/." "$name:/usr/share/nginx/html/"
}

start_finished_snapshot() {
	docker start -a "$name"
	# docker start attaches to output; inspect also enforces the process result.
	test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
}

# Removing the startup copy, volume write access, or no-clobber semantics must
# fail here. The same built image models successive deployments with disjoint
# asset sets, without requiring extra image builds or repository bind mounts.
create_snapshot first "$fixture_dir/old" '
	test "$(id -u)" = 101
	/docker-entrypoint.d/40-retain-assets.sh
	cmp /usr/share/nginx/html/assets/pulsy-retained-old-a1b2c3d4.js /var/cache/pulsy/assets/pulsy-retained-old-a1b2c3d4.js
'
start_finished_snapshot

start_web_snapshot() {
	create_snapshot "$1" "$2" '
		test "$(id -u)" = 101
		/docker-entrypoint.d/40-retain-assets.sh
		grep -q "^// old immutable asset$" /var/cache/pulsy/assets/pulsy-retained-old-a1b2c3d4.js
		grep -q "^// new immutable asset$" /var/cache/pulsy/assets/pulsy-retained-new-e5f6a7b8.js
		exec nginx -g "daemon off;"
	'
	docker start "$name" >/dev/null
	if ! docker exec "$name" /bin/sh -ec '
		attempt=0
		until wget -q -O /tmp/ready http://127.0.0.1:8080/index.html; do
			attempt=$((attempt + 1))
			test "$attempt" -lt 50
			sleep 0.1
		done
	'; then
		docker logs "$name" >&2
		return 1
	fi
}

check_http() {
	docker exec "$name" /bin/sh -ec '
		for asset in pulsy-retained-old-a1b2c3d4.js pulsy-retained-new-e5f6a7b8.js; do
			wget -S --header "Accept-Encoding: gzip" -O /tmp/asset.gz "http://127.0.0.1:8080/assets/$asset" 2>/tmp/headers
			grep -qi "Cache-Control: public, max-age=31536000, immutable" /tmp/headers
			grep -qi "Content-Encoding: gzip" /tmp/headers
			grep -qi "X-Content-Type-Options: nosniff" /tmp/headers
			grep -qi "X-Frame-Options: SAMEORIGIN" /tmp/headers
			grep -qi "Referrer-Policy: strict-origin-when-cross-origin" /tmp/headers
			grep -qi "Permissions-Policy: camera=(), microphone=(), geolocation=()" /tmp/headers
			grep -qi "Content-Security-Policy: .*script-src '\''self'\'';" /tmp/headers
			if grep -qi "google-analytics\|googletagmanager" /tmp/headers; then
				exit 1
			fi
			gunzip -c /tmp/asset.gz >/tmp/asset
			cmp /tmp/asset "/var/cache/pulsy/assets/$asset"
		done
		if wget -S -O /tmp/missing http://127.0.0.1:8080/assets/pulsy-missing-00000000.js 2>/tmp/headers; then
			printf "%s\n" "A missing hashed asset returned success" >&2
			exit 1
		fi
		grep -q "HTTP/1.1 404" /tmp/headers
		if grep -q PULSY_ASSET_TEST_SPA /tmp/missing; then
			exit 1
		fi
		wget -S -O /tmp/index http://127.0.0.1:8080/a-client-route 2>/tmp/headers
		grep -q PULSY_ASSET_TEST_SPA /tmp/index
		grep -qi "Cache-Control: no-cache" /tmp/headers
		wget -S -O /tmp/openapi http://127.0.0.1:8080/openapi.yaml 2>/tmp/headers
		grep -qi "Cache-Control: no-cache" /tmp/headers
		grep -q "^openapi:" /tmp/openapi
	'
}

start_web_snapshot upgraded "$fixture_dir/new"
check_http
docker stop "$name" >/dev/null
start_web_snapshot rollback "$fixture_dir/old"
check_http
docker stop "$name" >/dev/null

create_snapshot immutable "$fixture_dir/collision" '
	/docker-entrypoint.d/40-retain-assets.sh
	grep -q "^// old immutable asset$" /var/cache/pulsy/assets/pulsy-retained-old-a1b2c3d4.js
	if grep -q "replacement must never overwrite" /var/cache/pulsy/assets/pulsy-retained-old-a1b2c3d4.js; then
		exit 1
	fi
	test -r /var/cache/pulsy/assets/pulsy-retained-new-e5f6a7b8.js
'
start_finished_snapshot
printf '%s\n' 'Web assets survive image swaps and rollback with immutable caching, gzip, and real 404s.'
