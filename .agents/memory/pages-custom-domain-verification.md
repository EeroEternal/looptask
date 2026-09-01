---
name: Pages custom-domain verification
description: How to distinguish an active Cloudflare Pages custom-domain binding from traffic that has actually switched to the current deployment.
---

Treat the Pages API domain status as necessary but not sufficient. During a custom-domain cutover, the API can report `active` while requests still reach an older origin or deployment. Verify the live response separately using headers and deployment-specific asset markers.

**Why:** A domain status check alone briefly suggested the custom hostname was serving the current app, while the live body and asset behavior showed an older route. A later request switched to the current Pages deployment without code changes.

**How to apply:** Check the custom hostname and `*.pages.dev` side by side. Confirm the expected `server`/cache headers, current framework asset paths, and absence of obsolete origin markers before concluding that a deployment or CSS fix is missing.