#!/usr/bin/env bash
set -euo pipefail

if (($# == 0)); then
  echo "usage: $0 <benchmark-command> [args...]" >&2
  exit 2
fi

for pool in 2 3 4 5; do
  for cache in -16384 -32768; do
    for mmap in 0 134217728; do
      for statements in 100 256 512; do
        printf '\nPOOL=%s CACHE_SIZE=%s MMAP_SIZE=%s STATEMENTS=%s TEMP_STORE=2\n' \
          "$pool" "$cache" "$mmap" "$statements"
        /usr/bin/time -f 'elapsed=%e rss_kb=%M' env \
          HIREMEOPS_DB_MAX_CONNECTIONS="$pool" \
          HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY="$statements" \
          HIREMEOPS_DB_CACHE_SIZE="$cache" \
          HIREMEOPS_DB_MMAP_SIZE="$mmap" \
          HIREMEOPS_DB_TEMP_STORE=2 \
          "$@"
      done
    done
  done
done
