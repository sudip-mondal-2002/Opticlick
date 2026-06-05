# Opticlick CORS Proxy

A simple, fast, and secure self-hosted CORS proxy built for Cloudflare Workers. It intercepts requests, bypasses browser CORS restrictions, strips frame-limiting headers, and fully supports POST, PUT, and other HTTP methods required by the Opticlick Sandbox environment.

This worker runs on the **Cloudflare Workers Free Tier** (which provides 100,000 requests per day at zero cost).

## Manual Deployment Instructions

Because GitHub Actions running for Pull Requests from fork repositories do not have access to repository secrets, this worker must be deployed manually once.

### Prerequisites

1. Install Node.js if you haven't already.
2. Sign up for a free account at [Cloudflare](https://dash.cloudflare.com/).

### Deployment Steps

1. Open a terminal in the `cors-proxy` directory:
   ```bash
   cd cors-proxy
   ```

2. Run the deployment command using Wrangler (Cloudflare's developer CLI):
   ```bash
   npx wrangler deploy
   ```

3. If this is your first time deploying with Wrangler, it will prompt you to log in to your Cloudflare account via the browser. Authorize the login.

4. Once the deployment completes, Wrangler will print the URL of your new worker, which will look like:
   ```text
   https://opticlick-cors-proxy.<your-subdomain>.workers.dev
   ```

5. Copy this URL and enter it in the **CORS Proxy Settings** panel inside your Opticlick Sandbox UI to route all network traffic through your self-hosted proxy.
