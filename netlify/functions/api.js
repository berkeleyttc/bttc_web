const BTTC_API_URL = process.env.BTTC_API_URL;

const BTTC_API_TOKEN = process.env.BTTC_API_TOKEN;

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
    // Extract the path and query parameters from the request
    let path = event.path.replace('/.netlify/functions/api', '');
    // Ensure path starts with / and doesn't create double slashes
    if (!path || path === '') {
      path = '/';
    } else if (!path.startsWith('/')) {
      path = '/' + path;
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
        'X-API-Key': BTTC_API_TOKEN,
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
    // Don't expose any backend details in error messages
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Service temporarily unavailable',
        code: 'PROXY_ERROR'
      }),
    };
  }
};
