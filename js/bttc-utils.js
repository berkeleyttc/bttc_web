// BTTC Shared Utilities
// Common functions used across Vue.js applications

const getSupportContact = () => {
  return typeof ENV !== 'undefined' 
    ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
    : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
};

const getErrorMessage = (error, context = 'operation') => {
  const errorMessage = error?.message || String(error || '');
  const errorName = error?.name || '';
  const supportContact = getSupportContact();
  
  // Network errors
  if (
    error instanceof TypeError ||
    errorName === 'TypeError' ||
    errorMessage.includes('Failed to fetch') ||
    errorMessage.includes('NetworkError') ||
    errorMessage.includes('Network request failed') ||
    errorMessage.includes('ERR_INTERNET_DISCONNECTED') ||
    errorMessage.includes('ERR_CONNECTION_REFUSED') ||
    errorMessage.includes('ERR_CONNECTION_TIMED_OUT') ||
    errorMessage.includes('ERR_TIMED_OUT') ||
    errorMessage.includes('Load failed')
  ) {
    return `Unable to connect to the server. The service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
  }
  
  // HTTP errors
  if (error && error.response) {
    const status = error.response.status;
    
    if (status === 0) {
      return `Connection error: The server is unreachable. Please try again later or ${supportContact}.`;
    }
    if (status >= 500) {
      return `Server error: The service is experiencing technical difficulties. Please try again in a few moments or ${supportContact}.`;
    }
    if (status === 404) {
      return `Service not found. Please ${supportContact}.`;
    }
    if (status === 503) {
      return `Service unavailable: The service is temporarily down for maintenance. Please try again later or ${supportContact}.`;
    }
  }
  
  // Generic errors
  if (error && error.message) {
    return `An error occurred during ${context}: ${error.message}. Please try again or ${supportContact}.`;
  }
  
  return `An unexpected error occurred during ${context}. Please try again or ${supportContact}.`;
};

const getFetchOptions = (options = {}) => {
  const apiKey = typeof ENV !== 'undefined' ? ENV.API_KEY : '';
  
  if (apiKey) {
    const existingHeaders = options.headers || {};
    const headers = {
      ...(existingHeaders instanceof Headers 
        ? Object.fromEntries(existingHeaders.entries()) 
        : existingHeaders),
      'X-API-Key': apiKey
    };
    
    return {
      ...options,
      headers: headers
    };
  }
  
  return options;
};

const handleApiResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = 'Server error';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      errorMessage = response.statusText || `HTTP ${response.status}`;
    }
    
    const error = new Error(errorMessage);
    error.response = response;
    throw error;
  }
  
  try {
    return await response.json();
  } catch (jsonError) {
    throw new Error('Invalid response from server. Please try again.');
  }
};

const validatePhone = (phone) => {
  const digitsOnly = phone.replace(/\D/g, '');
  const cleaned = digitsOnly.replace(/^1/, '');
  const requiredLength = typeof ENV !== 'undefined' ? ENV.PHONE_NUMBER_LENGTH : 10;
  
  if (!cleaned) {
    return { valid: false, message: 'Please enter a phone number.' };
  }
  
  if (cleaned.length < requiredLength) {
    return { valid: false, message: `Phone number must be at least ${requiredLength} digits.` };
  }
  
  if (cleaned.length > requiredLength) {
    return { valid: false, message: `Phone number must be exactly ${requiredLength} digits.` };
  }
  
  const areaCode = cleaned.substring(0, 3);
  if (areaCode[0] === '0' || areaCode[0] === '1') {
    return { valid: false, message: 'Invalid area code. Area codes cannot start with 0 or 1.' };
  }
  
  const exchangeCode = cleaned.substring(3, 6);
  if (exchangeCode[0] === '0' || exchangeCode[0] === '1') {
    return { valid: false, message: 'Invalid phone number format.' };
  }
  
  return { valid: true, phone: cleaned };
};

const validateEmail = (email) => {
  if (!email || !email.trim()) {
    return { valid: false, message: 'Please enter an email address.' };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }
  
  return { valid: true };
};

const validateToken = (token) => {
  if (!token || !token.trim()) {
    return { valid: false, message: 'Please enter your 6-digit PIN.' };
  }
  
  const cleaned = token.trim().replace(/\D/g, '');
  if (cleaned.length !== 6) {
    return { valid: false, message: 'PIN must be exactly 6 digits.' };
  }
  
  return { valid: true, token: cleaned };
};

const formatPhoneNumber = (phoneString) => {
  // Remove all non-numeric characters
  const cleaned = phoneString.replace(/\D/g, '').slice(0, 10);
  
  // Format as xxx-xxx-xxxx
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 6) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  } else {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
};

