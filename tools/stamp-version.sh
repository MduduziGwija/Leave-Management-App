#!/usr/bin/env bash
# Adds ?v=<version> to every script, stylesheet and module import in a copy of the site,
# so browsers load the new files after each deploy instead of cached old ones.
#   bash tools/stamp-version.sh _site abc1234
set -euo pipefail
site="$1"
v="$2"
# index.html: <script src="..."> and <link href="..."> for our own files.
sed -i -E "s#(src|href)=\"((js|css|vendor)/[^\"?]+\.(js|css))\"#\1=\"\2?v=${v}\"#g" "$site/index.html"
# Module imports: from './x.js' / from '../x.js'. Every import of a file must use the same
# URL, otherwise the browser would load it twice.
find "$site/js" -name '*.js' -print0 | xargs -0 sed -i -E "s#(from '\.{1,2}/[^'?]+\.js)'#\1?v=${v}'#g"
echo "Stamped version ${v}:"
grep -c "?v=${v}" "$site/index.html" "$site"/js/*.js "$site"/js/*/*.js
