#!/usr/bin/env python3
"""Focused, read-only Chromium diagnosis of the live PWA offline reload path."""
import argparse
import json
from playwright.sync_api import sync_playwright


SNAPSHOT_JS = """async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  const names = await caches.keys();
  const cacheInfo = await Promise.all(names.map(async (name) => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const paths = keys.map((request) => new URL(request.url).pathname);
    return {
      name,
      entries: keys.length,
      hasIndex: paths.includes('/index.html'),
      hasRoot: paths.includes('/'),
      pages: paths.filter((path) => ['/index.html', '/serum', '/campaign', '/privacy.html', '/404.html'].includes(path))
    };
  }));
  const controller = navigator.serviceWorker.controller;
  const indexResponse = await caches.match(new URL('/index.html', location.origin).href);
  const rootResponse = await caches.match(new URL('/', location.origin).href);
  return {
    href: location.href,
    online: navigator.onLine,
    controller: controller ? {scriptURL: controller.scriptURL, state: controller.state} : null,
    registrations: regs.map((registration) => ({
      scope: registration.scope,
      active: registration.active ? {scriptURL: registration.active.scriptURL, state: registration.active.state} : null,
      waiting: registration.waiting ? {scriptURL: registration.waiting.scriptURL, state: registration.waiting.state} : null,
      installing: registration.installing ? {scriptURL: registration.installing.scriptURL, state: registration.installing.state} : null
    })),
    cacheNames: names,
    caches: cacheInfo,
    cachedIndex: indexResponse ? {status: indexResponse.status, type: indexResponse.type, redirected: indexResponse.redirected} : null,
    cachedRoot: rootResponse ? {status: rootResponse.status, type: rootResponse.type, redirected: rootResponse.redirected} : null
  };
}"""


def snapshot(page):
    try:
        return page.evaluate(SNAPSHOT_JS)
    except Exception as error:  # A failed navigation may leave Chromium's error document active.
        return {"snapshotError": str(error), "pageUrl": page.url}


def run(base: str) -> int:
    request_failures = []
    console_errors = []
    result = {"base": base}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar")
        page = context.new_page()
        page.on("requestfailed", lambda request: request_failures.append({
            "url": request.url,
            "failure": str(request.failure),
            "resourceType": request.resource_type,
        }))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        page.goto(base.rstrip("/") + "/index.html", wait_until="load")
        page.wait_for_selector("#products [data-add-current]")
        page.wait_for_timeout(4000)
        if not page.evaluate("!!navigator.serviceWorker.controller"):
            page.reload(wait_until="load")
            page.wait_for_function("!!navigator.serviceWorker.controller", timeout=12000)

        result["beforeOffline"] = snapshot(page)
        result["requestFailuresBeforeOffline"] = request_failures[-20:]
        context.set_offline(True)
        try:
            response = page.reload(wait_until="load", timeout=15000)
            page.wait_for_timeout(300)
            result["reload"] = {
                "ok": True,
                "status": response.status if response else None,
                "pageUrl": page.url,
                "productHeroCount": page.locator(".product-hero").count(),
            }
        except Exception as error:
            result["reload"] = {"ok": False, "error": str(error), "pageUrl": page.url}
        result["afterReload"] = snapshot(page)
        result["requestFailures"] = request_failures[-30:]
        result["consoleErrors"] = console_errors[-20:]
        context.set_offline(False)
        browser.close()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("reload", {}).get("ok") and result["reload"].get("productHeroCount") == 1 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://raawaa-store.pages.dev")
    args = parser.parse_args()
    raise SystemExit(run(args.base))
