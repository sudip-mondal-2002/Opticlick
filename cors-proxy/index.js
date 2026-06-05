/* eslint-disable */
/**
 * Opticlick Custom CORS Proxy - Cloudflare Worker
 *
 * Implements a global CORS proxy with support for GET, POST, PUT, DELETE, etc.
 * Staged to run on Cloudflare Workers (Free Tier).
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Support both ?url=https://example.com and /https://example.com formats
    let targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) {
      const pathTarget = url.pathname.slice(1) + url.search;
      if (pathTarget.startsWith('http://') || pathTarget.startsWith('https://')) {
        targetUrlStr = pathTarget;
      }
    }

    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({ error: "Missing target URL. Pass '?url=https://example.com' or append path after the domain." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "*"
          }
        }
      );
    }

    // Handle CORS preflight options request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    try {
      // Re-create the request headers to forward, removing Cloudflare-specific metadata headers
      const headers = new Headers();
      const headersToSkip = [
        'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker',
        'x-forwarded-proto', 'x-real-ip', 'x-forwarded-for'
      ];
      for (const [key, value] of request.headers.entries()) {
        if (!headersToSkip.includes(key.toLowerCase()) && !key.toLowerCase().startsWith('cf-')) {
          headers.set(key, value);
        }
      }

      // Fetch the target URL, following redirects
      const fetchInit = {
        method: request.method,
        headers: headers,
        redirect: 'follow'
      };

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        fetchInit.body = await request.clone().arrayBuffer();
      }

      const response = await fetch(targetUrlStr, fetchInit);

      // Re-create the response and add permissive CORS headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "*");

      // Remove security headers that prevent iframe embedding or cross-origin access
      const headersToRemove = [
        'content-security-policy',
        'content-security-policy-report-only',
        'x-frame-options',
        'x-content-type-options',
        'cross-origin-opener-policy',
        'cross-origin-embedder-policy',
        'cross-origin-resource-policy'
      ];
      for (const h of headersToRemove) {
        responseHeaders.delete(h);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Proxy request failed" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "*"
          }
        }
      );
    }
  }
};
