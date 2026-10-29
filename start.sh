#!/bin/bash

set -eu

mkdir -p /app/data
chown -R cloudron:cloudron /app/data

exec /usr/local/bin/gosu cloudron:cloudron node /app/code/dist/app.js
