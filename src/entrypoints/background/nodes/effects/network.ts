import type { AgentAction } from '@/utils/types';

type FetchUrlAction = Extract<AgentAction, { type: 'fetch_url' }>;

/**
 * Validates that a URL is safe for network requests (no SSRF vulnerabilities)
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(protocol)) {
      return false;
    }
    
    // Block localhost and private IPs
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return false;
    }
    
    // Block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
    if (/^(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\./.test(hostname)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes a secure network request requested by the agent toolchain.
 * Matches standard handler signature: (action, ctx)
 */
export async function handleFetchUrl(
  action: Omit<FetchUrlAction, 'type'>,
  ctx?: any
): Promise<string> {
  // Enforces centralized SSRF protection rules
  if (!isSafeUrl(action.url)) {
    return "Error: URL is not safe. Access to private IPs, localhost, or non-HTTP protocols is strictly forbidden.";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const isGet = (action.method ?? 'GET').toUpperCase() === 'GET';
    const requestOptions: RequestInit = {
      method: action.method ?? 'GET',
      headers: action.headers ?? {},
      signal: controller.signal,
      redirect: 'manual', // Prevent SSRF redirection vulnerabilities
    };

    if (!isGet && action.body) {
      requestOptions.body = action.body;
    }

    const response = await fetch(action.url, requestOptions);

    if (!response) {
      return "Network Error: No response received from server.";
    }

    if (response.status >= 300 && response.status < 400) {
      return "Error: Redirects are not allowed for security reasons.";
    }

    const contentType = response.headers?.get('content-type') ?? 'unknown';
    const text = await response.text();
    
    // Accurate byte-level truncation bounds
    const limit = action.maxResponseBytes ?? 50_000;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    
    const truncated = bytes.length > limit 
      ? new TextDecoder().decode(bytes.slice(0, limit))
      : text;
      
    const truncationNotice = bytes.length > limit 
      ? `\n\n[Warning: Response truncated to ${limit} bytes]` 
      : '';

    return `Status: ${response.status}\nContent-Type: ${contentType}\n\n${truncated}${truncationNotice}`;
    
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.cause?.name === 'AbortError') {
      return "Network Error: Request timed out after 10 seconds.";
    }
    return `Network Error: ${error?.message || 'Failed to fetch'}`;
  } finally {
    clearTimeout(timeoutId);
  }
}