import { isSafeUrl } from '../../../../utils/security';

// Explicitly defining the interface prevents the 'never' type error 
// if the central AgentAction union isn't fully compiled yet.
export interface FetchUrlAction {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  maxResponseBytes?: number;
}

export async function handleFetchUrl(action: FetchUrlAction): Promise<string> {
  if (!isSafeUrl(action.url)) {
    return "Error: URL is not safe. Access to private IPs, localhost, or non-HTTP protocols is strictly forbidden.";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const isGet = (action.method ?? 'GET').toUpperCase() === 'GET';
    const requestOptions: RequestInit = {
      method: action.method ?? 'GET',
      headers: action.headers,
      signal: controller.signal,
      redirect: 'manual', // Prevent SSRF via 302 redirects
    };

    // Don't attach a body to GET requests
    if (!isGet && action.body) {
      requestOptions.body = action.body;
    }

    const response = await fetch(action.url, requestOptions);

    // Defensive check: Ensure mock environments or failed fetches don't return undefined response objects
    if (!response) {
      return "Network Error: Received an invalid or empty response from the server.";
    }

    // Reject redirects explicitly
    if (response.status >= 300 && response.status < 400) {
      return "Error: Redirects are not allowed for security reasons.";
    }

    const contentType = response.headers.get('content-type') ?? 'unknown';
    const text = await response.text();
    
    // Truncate by bytes, not JS characters
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
    if (error.name === 'AbortError' || error.cause?.name === 'AbortError') {
      return "Network Error: Request timed out after 10 seconds.";
    }
    return `Network Error: ${error.message || 'Failed to fetch'}`;
  } finally {
    clearTimeout(timeoutId);
  }
}
