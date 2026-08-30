// Toggle this flag to switch between dev and production API
// Set to true for PR reviews, false for production
const USE_DEV_API = false;

// Get API URL and API Key based on flag
const BTTC_API_URL = USE_DEV_API 
  ? process.env.BTTC_API_DEV_URL 
  : process.env.BTTC_API_URL;
const BTTC_API_KEY = USE_DEV_API
  ? process.env.BTTC_DEV_API_KEY
  : process.env.BTTC_API_KEY;

// Validate API URL is set
if (!BTTC_API_URL) {
  const missingEnvVar = USE_DEV_API ? 'BTTC_API_DEV_URL' : 'BTTC_API_URL';
  throw new Error(`Missing required environment variable: ${missingEnvVar}`);
}

// Validate API Key is set
if (!BTTC_API_KEY) {
  const missingEnvVar = USE_DEV_API ? 'BTTC_DEV_API_KEY' : 'BTTC_API_KEY';
  throw new Error(`Missing required environment variable: ${missingEnvVar}`);
}

// Log which API is being used (only in non-production for debugging)
if (USE_DEV_API) {
  console.log('🔧 Using DEV API:', BTTC_API_URL);
} else {
  console.log('🚀 Using PRODUCTION API');
}


// ---------------------------------------------------------------------------
// The path allowlist.  Ticket 13 Q2.
//
// There was NO allowlist here before: the handler stripped the function prefix with a
// bare String.replace and forwarded whatever was left, so every endpoint on bttc_api --
// including the bulk user export and import -- was reachable from the public internet
// behind nothing but a key this proxy attaches for you.
//
// What this closes: /users/export, /users/import, /users/bulk-update and /refresh/all.
// What it deliberately does NOT close: PUT and DELETE /player/{id}. Ticket 13 Q2b put the
// three-request bypass -- db/search?role=director -> PUT a known PIN -> login -- and kept
// it, because dropping PUT removes the only route that can ever change a PIN for the nine
// operators and every member. Recorded as F15. The login, the role check and the operator
// token are ATTRIBUTION, NOT ACCESS CONTROL, and this list does not change that.
//
// Every entry below was MEASURED off the four live apps, not remembered. Missing one
// breaks that app with a 404 from this file that looks nothing like an API problem --
// admin/events.js was nearly missed because it builds URLs with `${getApiUrl()}` rather
// than the `${apiUrl}` the other three use.
//
// `:seg` matches exactly one path segment.
// ---------------------------------------------------------------------------
const ALLOWED_ROUTES = [
  // --- registration/, roster/, signup/, admin/ : measured, in use today ---------
  ['GET',    '/rr/roster'],                 // roster/roster.js, admin/admin.js
  ['GET',    '/rr/search'],                 // registration/registration.js
  ['GET',    '/rr/registration-audit'],     // admin/audit.js
  ['POST',   '/rr/capacity'],               // registration/registration.js
  ['POST',   '/rr/register'],               // registration/registration.js
  ['POST',   '/rr/unregister'],             // registration/registration.js
  ['POST',   '/rr/registration/confirm'],   // admin/admin.js
  ['GET',    '/rr/waitlist'],               // ships today; keep it reachable
  ['POST',   '/rr/waitlist/promote'],       // unreachable in prod, zero callers, kept
  ['GET',    '/player/search'],             // signup/signup.js
  ['POST',   '/player/signup'],             // signup/signup.js
  ['POST',   '/events/all'],                // admin/events.js
  ['POST',   '/events/open'],               // admin/events.js
  ['POST',   '/events/close'],              // admin/events.js
  ['POST',   '/events/update'],             // ticket 30: max_capacity, edited inline

  // --- the member surface, incl. the bypass ticket 13 Q2b kept on purpose --------
  ['GET',    '/player/db/search'],
  ['PUT',    '/player/:id'],
  ['DELETE', '/player/:id'],

  // --- League Manager (ticket 12). Built this session: --------------------------
  ['POST',   '/rr/login'],                  // must be reachable UNAUTHENTICATED
  ['GET',    '/rr/session'],
  ['POST',   '/rr/draw'],
  ['POST',   '/rr/groups/:n/scores'],
  ['POST',   '/rr/results'],
  ['POST',   '/rr/roster/update'],
  // --- reserved slots. Listed now so the day one lands it is not ALSO a proxy bug:
  ['GET',    '/rr/lock'],
  ['POST',   '/rr/lock'],
  ['POST',   '/rr/lock/takeover'],
  ['POST',   '/rr/lock/release'],
  ['POST',   '/rr/publish'],
  ['GET',    '/rr/members'],
  ['POST',   '/rr/member'],
  ['POST',   '/rr/roster/add'],
  ['POST',   '/rr/roster/remove'],
  ['POST',   '/rr/roster/promote'],
  // --- ticket 33. A NINTH slot, added rather than found in the reserved list. It is a
  // read: it renders the results page publish would commit and pushes nothing. Its
  // near-neighbour GET /rr/publish/status stays OFF this list -- ticket 26 removed that
  // one from the surface, and api-allowlist.test.js asserts both facts side by side.
  ['GET',    '/rr/publish/preview'],
];

// NOT on the list, and that is the point:
//   /users/export, /users/import, /users/bulk-update, /users/bulk-update/file, /refresh/all

/**
 * Normalise BEFORE matching, and reject traversal outright.
 *
 * The old handler used a bare `String.replace`, so `/player/db/search/../../users/export`
 * would have been forwarded verbatim. An allowlist that matches on an un-normalised path is
 * not an allowlist. Returns null when the path is unacceptable at all.
 */
function normalisePath(raw) {
  let path = String(raw || '').replace('/.netlify/functions/api', '');
  if (path.indexOf('%') !== -1) {
    try { path = decodeURIComponent(path); } catch (e) { return null; }
  }
  if (path.indexOf('\\') !== -1 || path.indexOf('\0') !== -1) return null;
  if (!path || path === '') return '/';
  if (!path.startsWith('/')) path = '/' + path;

  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;      // never resolve upward; refuse
    out.push(segment);
  }
  return '/' + out.join('/');
}

function isAllowed(method, path) {
  const parts = path.split('/').filter(Boolean);
  return ALLOWED_ROUTES.some(([allowedMethod, pattern]) => {
    if (allowedMethod !== method) return false;
    const want = pattern.split('/').filter(Boolean);
    if (want.length !== parts.length) return false;
    return want.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
  });
}

// Exported for leaguemanager/test/api-allowlist.test.js. A list this consequential --
// getting it wrong takes down every app on the site -- should not be untestable.
if (typeof module !== 'undefined' && module.exports) {
  module.exports.ALLOWED_ROUTES = ALLOWED_ROUTES;
  module.exports.normalisePath = normalisePath;
  module.exports.isAllowed = isAllowed;
}

exports.handler = async (event, context) => {
  
  // Enable CORS for all origins
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // Remove any server information that might leak the backend
    'Server': 'Netlify',
    'X-Powered-By': 'Netlify Functions',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Normalise first, then check the allowlist. Anything not on it never reaches
    // bttc_api at all -- it 404s here, with no hint that the backend exists.
    const path = normalisePath(event.path);
    if (path === null || !isAllowed(event.httpMethod, path)) {
      console.warn('[api] refused', event.httpMethod, event.path);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ detail: 'Not found', code: 'NOT_FOUND' }),
      };
    }
    
    const queryString = event.queryStringParameters 
      ? '?' + new URLSearchParams(event.queryStringParameters).toString()
      : '';
    
    // Construct the target URL using the hidden endpoint
    const targetUrl = `${BTTC_API_URL}${path}${queryString}`;
    
    // Prepare request options
    const requestOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'BTTC-Web-Client',
        'Origin': BTTC_API_URL, // Required by the API for origin validation
        'Referer': `${BTTC_API_URL}/`,
        // Always include the hidden API token using the correct header name
        'X-API-Key': BTTC_API_KEY,
        // Forward any additional authorization headers if present (for user auth)
        ...(event.headers['x-user-auth'] && { 'X-User-Auth': event.headers['x-user-auth'] }),
        ...(event.headers['content-type'] && { 'Content-Type': event.headers['content-type'] }),
        ...(event.headers['accept'] && { 'Accept': event.headers['accept'] }),
      },
    };

    // Add body for POST/PUT requests
    if (event.body && (event.httpMethod === 'POST' || event.httpMethod === 'PUT')) {
      requestOptions.body = event.body;
    }

    // Make the request to the hidden API
    const response = await fetch(targetUrl, requestOptions);
    
    // Get the response data
    const responseData = await response.text();
    
    // Forward the response with sanitized headers (remove any that might leak backend info)
    const sanitizedHeaders = {
      ...headers,
      'Content-Type': response.headers.get('content-type') || 'application/json',
    };

    // Remove any headers that might expose backend information
    const headersToRemove = ['server', 'x-powered-by', 'x-backend', 'x-api-server'];
    headersToRemove.forEach(header => {
      delete sanitizedHeaders[header];
    });
    
    return {
      statusCode: response.status,
      headers: sanitizedHeaders,
      body: responseData,
    };
    
  } catch (error) {
    console.error('API proxy error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      targetUrl: targetUrl
    });
    // Don't expose any backend details in error messages
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Service temporarily unavailable',
        code: 'PROXY_ERROR',
        message: error.message
      }),
    };
  }
};
