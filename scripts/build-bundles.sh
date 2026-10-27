#!/usr/bin/env bash
# يبني حزمتي التسليم من المصدر الحالي. التشغيل: bash scripts/build-bundles.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/rawaa-site-deploy.zip dist/rawaa-project-review.zip

# 1) حزمة الموقع فقط — جاهزة للنشر على أي استضافة ثابتة
rm -rf /tmp/bundle-site && mkdir -p /tmp/bundle-site
cp -R index.html privacy.html robots.txt sitemap.xml css js assets /tmp/bundle-site/
rm -rf /tmp/bundle-site/assets/img/design-raw /tmp/bundle-site/assets/brand /tmp/bundle-site/assets/img/design
touch /tmp/bundle-site/.nojekyll
(cd /tmp/bundle-site && zip -qrX /home/user/dist/rawaa-site-deploy.zip .)

# 2) حزمة المراجعة الكاملة — المصدر + الوثائق + الأصول الأصلية + سكربتات البناء
rm -rf /tmp/bundle-full && mkdir -p /tmp/bundle-full
cp -R index.html privacy.html robots.txt sitemap.xml README.md .gitignore .nojekyll css js assets docs scripts .github /tmp/bundle-full/
(cd /tmp/bundle-full && zip -qrX /home/user/dist/rawaa-project-review.zip .)

echo "── الناتج ──"
ls -lh dist/*.zip
unzip -l dist/rawaa-site-deploy.zip | tail -2
unzip -l dist/rawaa-project-review.zip | tail -2
