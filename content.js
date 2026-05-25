// Content Guardian Extension - Content Script with API Integration

// API configuration
const API_BASE_URL = 'http://localhost:8000/api';

// Global supervised mode flag
let supervised_mode = false;

// User authentication state
let authState = {
  userId: null,
  token: null,
  isLoggedIn: false,
  emailVerified: false,
  linkedGmail: null
};

// Load auth state from storage
function loadAuthState() {
  chrome.storage.local.get(['contentGuardianAuth', 'contentGuardianSupervision'], function(result) {
    if (result.contentGuardianAuth) {
      authState = result.contentGuardianAuth;
      
      // Automatically enter supervised mode when logged in
      if (authState.isLoggedIn) {
        startLocalSupervisionSession();
      }
      
      if (authState.isLoggedIn && !authState.emailVerified) {
        verifyUserEmail();
      }
    }
    
    // Load supervised mode state
    if (result.contentGuardianSupervision && result.contentGuardianSupervision.active) {
      supervised_mode = true;
      // Add supervised mode indicator if on a content page
      if (document.body) {
        updateSupervisedModeIndicator();
      } else {
        // Wait for body to be ready
        window.addEventListener('DOMContentLoaded', () => {
          updateSupervisedModeIndicator();
        });
      }
    }
  });
}

// Call API with authentication
async function callApi(endpoint, method = 'GET', data = null) {
  if (!authState.isLoggedIn || !authState.token) {
    console.log('Not authenticated for API call');
    return null;
  }

  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.token}`
      }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    
    if (response.status === 401) {
      // Token expired, need to refresh
      await refreshToken();
      return callApi(endpoint, method, data); // Retry with new token
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API call error:', error);
    return null;
  }
}

// Refresh the auth token
async function refreshToken() {
  try {
    const refreshToken = authState.refreshToken;
    if (!refreshToken) {
      setLoggedOut();
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      setLoggedOut();
      return false;
    }

    const data = await response.json();
    
    // Update auth state
    authState.token = data.access_token;
    authState.refreshToken = data.refresh_token;
    
    // Save to storage
    chrome.storage.local.set({ 'contentGuardianAuth': authState });
    
    return true;
  } catch (error) {
    console.error('Token refresh error:', error);
    setLoggedOut();
    return false;
  }
}

// Set user as logged out
function setLoggedOut() {
  authState = {
    userId: null,
    token: null,
    isLoggedIn: false
  };
  chrome.storage.local.set({ 'contentGuardianAuth': authState });
}

// Check supervision mode status
async function checkSupervisionMode() {
  // First check local storage
  return new Promise((resolve) => {
    chrome.storage.local.get(['contentGuardianSupervision'], function(result) {
      if (result.contentGuardianSupervision && result.contentGuardianSupervision.active === true) {
        supervised_mode = true;
        resolve(true);
        return;
      }
      
      // If not in local storage, check API if logged in
      if (!authState.isLoggedIn || !authState.userId) {
        supervised_mode = false;
        resolve(false);
        return;
      }

      // Check with API
      callApi(`/supervision/check/${authState.userId}`)
        .then(response => {
          if (response && response.supervision_active) {
            supervised_mode = true;
            // Update local storage to match API
            chrome.storage.local.set({ 
              'contentGuardianSupervision': {
                active: true,
                sessionId: response.session_id || 'api-sync',
                startedAt: new Date().toISOString()
              }
            });
            resolve(true);
          } else {
            supervised_mode = false;
            resolve(false);
          }
        })
        .catch(error => {
          console.error('Error checking supervision mode:', error);
          supervised_mode = false;
          resolve(false);
        });
    });
  });
}

// Generate an access key via API
async function generateAccessKey(url, blockType) {
  if (!authState.isLoggedIn || !authState.userId) {
    console.log('User not authenticated, using local key generation method');
    // Generate a local key instead of failing
    return {
      key_value: generateLocalKey(6),
      expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour expiry
      key_type: 'local'
    };
  }

  try {
    const data = {
      user_id: authState.userId,
      url: url,
      content_type: blockType
    };

    const response = await callApi('/generate-key', 'POST', data);
    if (response && response.key_value) {
      return response;
    }
  } catch (error) {
    console.error('Error generating access key:', error);
  }

  // Fallback to local key generation if API call fails
  console.log('Falling back to local key generation');
  return {
    key_value: generateLocalKey(6),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    key_type: 'local'
  };
}

// Generate a local key (for offline/unauthenticated mode)
function generateLocalKey(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar looking chars
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Store this key in local storage
  const localKey = {
    key_value: result,
    expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour expiry
    created_at: new Date().toISOString()
  };
  
  chrome.storage.local.set({ 'contentGuardianLocalKey': localKey });
  
  return result;
}

// Validate access key via API
async function validateAccessKey(keyValue, url) {
  // First check if this is a locally generated key
  const localValidation = await validateLocalKey(keyValue);
  if (localValidation.valid) {
    // For local keys, we need to create a supervision session
    await startLocalSupervisionSession();
    return localValidation;
  }

  // If not logged in and the local key validation failed, return invalid
  if (!authState.isLoggedIn || !authState.userId) {
    console.log('User not authenticated, only local keys can be validated');
    return { valid: false, message: "Please sign in first" };
  }

  try {
    const data = {
      key_value: keyValue,
      user_id: authState.userId,
      url: url
    };

    const response = await callApi('/validate-key', 'POST', data);
    if (response && response.valid) {
      // Start supervision session
      await startSupervisionSession(response.key_id);
      return response;
    }
  } catch (error) {
    console.error('Error validating access key:', error);
  }

  return { valid: false, message: "Invalid key" };
}

// Validate a locally generated key
async function validateLocalKey(keyValue) {
  // Get any locally stored keys using a promise wrapper
  return new Promise((resolve) => {
    chrome.storage.local.get(['contentGuardianLocalKey'], function(result) {
      if (result.contentGuardianLocalKey && 
          result.contentGuardianLocalKey.key_value === keyValue &&
          new Date(result.contentGuardianLocalKey.expires_at) > new Date()) {
        // Valid local key
        resolve({ 
          valid: true, 
          key_id: 'local', 
          key_type: 'local',
          message: "Local key validated" 
        });
      } else {
        // Not a valid local key
        resolve({ valid: false });
      }
    });
  });
}

// Start a local supervision session
async function startLocalSupervisionSession() {
  // Create local supervision session
  const supervisionData = {
    active: true,
    sessionId: 'local-' + Date.now(),
    startedAt: new Date().toISOString(),
    isLocal: true
  };
  
  // Store in local storage
  chrome.storage.local.set({ 'contentGuardianSupervision': supervisionData });
  
  // Set global flag
  supervised_mode = true;
  
  // Add the indicator
  updateSupervisedModeIndicator();
  
  return true;
}

// Start supervision session
async function startSupervisionSession(keyId) {
  try {
    const response = await callApi('/supervision/start', 'POST', { key_id: keyId });
    if (response && response.id) {
      // Save supervision session info
      chrome.storage.local.set({ 
        'contentGuardianSupervision': {
          active: true,
          sessionId: response.id,
          startedAt: new Date().toISOString()
        }
      });
      
      // Set global flag
      supervised_mode = true;
      
      // Add the indicator
      updateSupervisedModeIndicator();
      
      return true;
    }
  } catch (error) {
    console.error('Error starting supervision session:', error);
  }
  return false;
}

// End supervision session
async function endSupervisionSession() {
  try {
    chrome.storage.local.get(['contentGuardianSupervision'], async function(result) {
      if (result.contentGuardianSupervision && result.contentGuardianSupervision.active) {
        const sessionId = result.contentGuardianSupervision.sessionId;
        
        // Only call API if it's not a local session
        if (!result.contentGuardianSupervision.isLocal && authState.isLoggedIn) {
          await callApi('/supervision/end', 'POST', { session_id: sessionId });
        }
        
        // Clear supervision info
        chrome.storage.local.set({ 'contentGuardianSupervision': { active: false } });
        
        // Update global flag
        supervised_mode = false;
        
        // Update localStorage status
        localStorage.setItem('contentGuardianStatus', 'blocked');
        
        // Remove the indicator
        const existingIndicator = document.getElementById('supervised-mode-indicator');
        if (existingIndicator) {
          existingIndicator.remove();
        }
        
        // Show user a message before reloading
        const notificationDiv = document.createElement('div');
        notificationDiv.style.position = 'fixed';
        notificationDiv.style.top = '50%';
        notificationDiv.style.left = '50%';
        notificationDiv.style.transform = 'translate(-50%, -50%)';
        notificationDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        notificationDiv.style.color = 'white';
        notificationDiv.style.padding = '20px';
        notificationDiv.style.borderRadius = '10px';
        notificationDiv.style.zIndex = '2147483647';
        notificationDiv.style.textAlign = 'center';
        notificationDiv.innerHTML = '<p style="font-size: 18px; margin: 0;">Supervised Mode Disabled</p>' +
                                    '<p style="margin: 10px 0;">Page will now reload with content blocking active.</p>';
        document.body.appendChild(notificationDiv);
        
        // Reload the page to refresh the content state
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    });
  } catch (error) {
    console.error('Error ending supervision session:', error);
    // Force reload anyway in case of error
    window.location.reload();
  }
}

// Initialize WebSocket connection for real-time communication
let websocket = null;

function initializeWebSocket() {
  if (!authState.isLoggedIn || !authState.userId) return;
  
  // Close existing connection if any
  if (websocket) {
    websocket.close();
  }

  const wsUrl = `ws://localhost:8000/ws/extension/${authState.userId}`;
  websocket = new WebSocket(wsUrl);
  
  websocket.onopen = () => {
    console.log('WebSocket connection established');
  };
  
  websocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWebSocketMessage(message);
  };
  
  websocket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  websocket.onclose = () => {
    console.log('WebSocket connection closed');
    // Attempt to reconnect after delay
    setTimeout(initializeWebSocket, 5000);
  };
}

// Handle incoming WebSocket messages from server
function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'end_supervision':
      endSupervisionSession();
      break;
    case 'force_refresh':
      window.location.reload();
      break;
    case 'display_message':
      showNotification(message.title, message.content);
      break;
    default:
      console.log('Unknown message type:', message.type);
  }
}

// Verify user email through Gmail integration
async function verifyUserEmail() {
  try {
    // Check if user has granted Gmail access permission
    const hasPermission = await checkGmailPermission();
    
    if (!hasPermission) {
      console.log("Gmail permission not granted");
      // We'll request permission when needed
      return;
    }
    
    // Get Gmail account information
    const gmailInfo = await getGmailAccountInfo();
    
    if (!gmailInfo || !gmailInfo.email) {
      console.log("Could not retrieve Gmail account info");
      return;
    }
    
    // Verify this Gmail matches the account linked to the guardian
    const verificationResult = await callApi('/verify-email', 'POST', {
      user_id: authState.userId,
      email: gmailInfo.email
    });
    
    if (verificationResult && verificationResult.verified) {
      authState.emailVerified = true;
      authState.linkedGmail = gmailInfo.email;
      
      // Save updated auth state
      chrome.storage.local.set({ 'contentGuardianAuth': authState });
      
      console.log("Email verification successful");
    } else {
      console.log("Email verification failed - user might be using a different account");
      // We'll show a warning in the UI later
    }
  } catch (error) {
    console.error("Error verifying email:", error);
  }
}

// Check if extension has Gmail API permission
async function checkGmailPermission() {
  return new Promise((resolve) => {
    chrome.permissions.contains({
      permissions: ['identity', 'identity.email'],
      origins: ['https://mail.google.com/']
    }, (result) => {
      resolve(result);
    });
  });
}

// Request Gmail API permission
async function requestGmailPermission() {
  return new Promise((resolve) => {
    chrome.permissions.request({
      permissions: ['identity', 'identity.email'],
      origins: ['https://mail.google.com/']
    }, (granted) => {
      resolve(granted);
    });
  });
}

// Get Gmail account information
async function getGmailAccountInfo() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo((userInfo) => {
      resolve(userInfo);
    });
  });
}

// Register extension installation with backend
async function registerExtension() {
  if (!authState.isLoggedIn || !authState.userId) return;

  try {
    const browserInfo = {
      name: navigator.userAgent,
      version: navigator.appVersion,
      platform: navigator.platform
    };
    
    // Try to get Gmail info
    let email = null;
    if (authState.emailVerified && authState.linkedGmail) {
      email = authState.linkedGmail;
    } else {
      const gmailInfo = await getGmailAccountInfo();
      if (gmailInfo && gmailInfo.email) {
        email = gmailInfo.email;
      }
    }
    
    const installData = {
      user_id: authState.userId,
      browser_info: JSON.stringify(browserInfo),
      version: chrome.runtime.getManifest().version,
      device_email: email // Include email for device verification
    };
    
    await callApi('/extension/status', 'POST', installData);
    console.log('Extension registered successfully');
  } catch (error) {
    console.error('Error registering extension:', error);
  }
}

// Send heartbeat signal to backend
async function sendHeartbeat() {
  if (!authState.isLoggedIn || !authState.userId) return;
  
  try {
    const heartbeatData = {
      user_id: authState.userId,
      url: window.location.href,
      browser_info: navigator.userAgent
    };
    
    await callApi('/extension/heartbeat', 'POST', heartbeatData);
  } catch (error) {
    console.error('Error sending heartbeat:', error);
  }
}

// Schedule periodic heartbeat
function startHeartbeatInterval() {
  // Send initial heartbeat
  sendHeartbeat();
  
  // Schedule heartbeat every 30 seconds
  setInterval(sendHeartbeat, 30000);
}

// Send content alert to backend
async function sendContentAlert(url, blockType, content, emailInfo = null) {
  if (!authState.isLoggedIn || !authState.userId) return;
  
  try {
    // Determine severity based on content type
    let severity = 'medium';
    switch (blockType) {
      case 'violence':
      case 'hate':
        severity = 'high';
        break;
      case 'nsfw':
      case 'illegal':
        severity = 'critical';
        break;
      case 'unprotected':
        severity = 'high';
        break;
      default:
        severity = 'medium';
    }
    
    // Check if email is verified
    const emailVerified = authState.emailVerified === true;
    
    // If unverified, increase severity
    if (!emailVerified && severity !== 'critical') {
      severity = 'high'; // Increase severity for unverified device
    }
    
    const alertData = {
      user_id: authState.userId,
      alert_type: 'content_blocked',
      severity: severity,
      content: content,
      url: url,
      device_email: emailInfo || 'unknown',
      email_verified: emailVerified
    };
    
    await callApi('/alerts', 'POST', alertData);
  } catch (error) {
    console.error('Error sending content alert:', error);
  }
}

// Update existing log function to include email verification
async function logBlockedSite(url, blockType, emailInfo = null) {
  // Create local log entry regardless of authentication
  const logEntry = {
    url: url,
    content_type: blockType,
    timestamp: new Date().toISOString(),
    device_email: emailInfo || 'unknown'
  };
  
  // Store in local storage for offline logging
  chrome.storage.local.get(['contentGuardianLocalLogs'], function(result) {
    const logs = result.contentGuardianLocalLogs || [];
    logs.push(logEntry);
    // Keep only the last 100 logs to avoid storage issues
    if (logs.length > 100) logs.shift();
    chrome.storage.local.set({ 'contentGuardianLocalLogs': logs });
  });

  // If not logged in, just use local logging
  if (!authState.isLoggedIn || !authState.userId) {
    console.log('User not authenticated, using local logging only');
    return null;
  }

  try {
    // Get page content excerpt for context
    const contentExcerpt = document.body.innerText.substring(0, 500) + '...';
    
    // Log to backend
    const logData = {
      user_id: authState.userId,
      url: url,
      content_type: blockType,
      device_email: emailInfo || 'unknown'
    };

    const response = await callApi('/guardian/logs', 'POST', logData);
    
    // Send alert to guardian
    await sendContentAlert(url, blockType, contentExcerpt, emailInfo);
    
    return response;
  } catch (error) {
    console.error('Error logging blocked site:', error);
    return null;
  }
}

// Show content blocker overlay
async function showContentBlocker(blockType) {
  // Check if supervision mode is active
  const isSupervised = await checkSupervisionMode();
  if (isSupervised) {
    console.log('User is in supervision mode, allowing content');
    localStorage.setItem('contentGuardianStatus', 'supervised');
    // Make sure the indicator is showing
    updateSupervisedModeIndicator();
    return; // Don't block if in supervision mode
  }
  
  // Remove any existing overlays
  const existingAlert = document.getElementById('content-guardian-alert');
  if (existingAlert) existingAlert.remove();
  const existingBlocker = document.getElementById('content-guardian-blocker');
  if (existingBlocker) existingBlocker.remove();

  // Store status for popup
  localStorage.setItem('contentGuardianStatus', 'blocked');
  localStorage.setItem('contentGuardianViolationType', blockType);
  
  // Check if email is verified before proceeding
  const needsEmailVerification = authState.isLoggedIn && !authState.emailVerified;
  
  // Log locally and send alert with device email info
  const emailInfo = authState.linkedGmail || "unverified";
  await logBlockedSite(window.location.href, blockType, emailInfo);
  
  // Generate key via API
  const keyResponse = await generateAccessKey(window.location.href, blockType);
  const accessKey = keyResponse ? keyResponse.key_value : null;
  
  if (!accessKey) {
    console.error('Failed to generate access key, using fallback local method');
    return showFallbackContentBlocker(blockType);
  }
  
  // Build overlay
  const blockerDiv = document.createElement('div');
  blockerDiv.id = 'content-guardian-blocker';
  blockerDiv.style.position = 'fixed';
  blockerDiv.style.top = '0';
  blockerDiv.style.left = '0';
  blockerDiv.style.width = '100%';
  blockerDiv.style.height = '100%';
  blockerDiv.style.backgroundColor = 'rgb(0, 0, 0)'; // Completely opaque black background
  blockerDiv.style.zIndex = '10000';
  blockerDiv.style.display = 'flex';
  blockerDiv.style.flexDirection = 'column';
  blockerDiv.style.alignItems = 'center';
  blockerDiv.style.justifyContent = 'center';
  blockerDiv.style.color = 'white';
  blockerDiv.style.fontFamily = 'Arial, sans-serif';
  blockerDiv.style.textAlign = 'center';
  blockerDiv.style.padding = '20px';
  
  // Create an additional backdrop blur layer
  const blurOverlay = document.createElement('div');
  blurOverlay.style.position = 'fixed';
  blurOverlay.style.top = '0';
  blurOverlay.style.left = '0';
  blurOverlay.style.width = '100%';
  blurOverlay.style.height = '100%';
  blurOverlay.style.backdropFilter = 'blur(30px)'; // Heavy blur effect
  blurOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // Additional opacity layer
  blurOverlay.style.zIndex = '9999';
  document.body.appendChild(blurOverlay);

  // Warning icon
  const warningIcon = document.createElement('div');
  warningIcon.innerHTML = '⚠️';
  warningIcon.style.fontSize = '80px';
  warningIcon.style.marginBottom = '20px';
  blockerDiv.appendChild(warningIcon);

  // Title
  const warningTitle = document.createElement('h1');
  warningTitle.innerText = 'Content Blocked';
  warningTitle.style.fontSize = '28px';
  warningTitle.style.margin = '10px 0';
  blockerDiv.appendChild(warningTitle);

  // Message
  const warningMessage = document.createElement('p');
  switch (blockType) {
    case 'hate':
      warningMessage.innerText = 'This page has been blocked because it contains potential hate speech.';
      break;
    case 'nsfw':
      warningMessage.innerText = 'This page has been blocked because it contains potential adult content.';
      break;
    case 'violence':
      warningMessage.innerText = 'This page has been blocked because it contains potential violent content.';
      break;
    case 'illegal':
      warningMessage.innerText = 'This page has been blocked because it may contain illegal content or services.';
      break;
    case 'unprotected':
      warningMessage.innerText = 'This page has been blocked because it is not secure (HTTP instead of HTTPS) or may contain malware.';
      break;
    default:
      warningMessage.innerText = 'This page has been blocked because it contains potentially harmful content.';
  }
  warningMessage.style.fontSize = '18px';
  warningMessage.style.maxWidth = '600px';
  warningMessage.style.margin = '20px 0';
  blockerDiv.appendChild(warningMessage);

  // Login prompt (if not logged in)
  if (!authState.isLoggedIn) {
    const loginMessage = document.createElement('div');
    loginMessage.style.display = 'flex';
    loginMessage.style.flexDirection = 'column';
    loginMessage.style.alignItems = 'center';
    loginMessage.style.margin = '20px 0';
    
    const signInButton = document.createElement('button');
    signInButton.innerText = 'Enter Supervised Mode';
    signInButton.style.padding = '12px 24px';
    signInButton.style.fontSize = '16px';
    signInButton.style.backgroundColor = '#4CAF50';
    signInButton.style.color = 'white';
    signInButton.style.border = 'none';
    signInButton.style.borderRadius = '4px';
    signInButton.style.cursor = 'pointer';
    signInButton.style.marginTop = '10px';
    
    // When sign in button is clicked, enable supervised mode without redirecting
    signInButton.addEventListener('click', async function() {
      // Create supervision session locally (without authentication)
      await startLocalSupervisionSession();
      
      // Remove blocker overlay
      document.body.style.overflow = 'auto';
      blockerDiv.remove();
      
      // Remove blur overlay
      const blurOverlay = document.querySelector('div[style*="backdrop-filter: blur"]');
      if (blurOverlay) blurOverlay.remove();
      
      // Update status
      localStorage.setItem('contentGuardianStatus', 'supervised');
      
      // Reload the page to reset content
      window.location.reload();
    });
    
    loginMessage.innerHTML = '<span style="font-size: 16px; margin-bottom: 10px;">Click below to access this content:</span>';
    loginMessage.appendChild(signInButton);
    blockerDiv.appendChild(loginMessage);
  } else {
    // For all users, show Enter Supervised Mode button
    const supervisedModeButton = document.createElement('button');
    supervisedModeButton.innerText = 'Enter Supervised Mode';
    supervisedModeButton.style.padding = '12px 24px';
    supervisedModeButton.style.fontSize = '16px';
    supervisedModeButton.style.backgroundColor = '#4CAF50';
    supervisedModeButton.style.color = 'white';
    supervisedModeButton.style.border = 'none';
    supervisedModeButton.style.borderRadius = '4px';
    supervisedModeButton.style.cursor = 'pointer';
    supervisedModeButton.style.marginTop = '20px';
    
    supervisedModeButton.addEventListener('click', async function() {
      // Start supervised mode directly without verification
      await startLocalSupervisionSession();
      
      // Remove blocker overlays
      document.body.style.overflow = 'auto';
      blockerDiv.remove();
      
      // Remove blur overlay
      const blurOverlay = document.querySelector('div[style*="backdrop-filter: blur"]');
      if (blurOverlay) blurOverlay.remove();
      
      // Update status
      localStorage.setItem('contentGuardianStatus', 'supervised');
      
      // Reload page to reset content
      window.location.reload();
    });
    
    blockerDiv.appendChild(supervisedModeButton);
  }

  // If email verification needed, show additional message
  if (needsEmailVerification) {
    const verificationWarning = document.createElement('div');
    verificationWarning.style.backgroundColor = '#ffeeee';
    verificationWarning.style.border = '1px solid #ffaaaa';
    verificationWarning.style.borderRadius = '5px';
    verificationWarning.style.padding = '10px';
    verificationWarning.style.marginTop = '20px';
    verificationWarning.style.color = '#cc0000';
    verificationWarning.style.maxWidth = '600px';
    
    verificationWarning.innerHTML = `
      <p><strong>Email verification required</strong></p>
      <p>To ensure this device belongs to you, please verify your Gmail account.</p>
      <button id="verify-email-btn" style="background-color: #cc0000; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">
        Verify Gmail Account
      </button>
    `;
    
    blockerDiv.appendChild(verificationWarning);
    
    // Add verification button handler
    document.getElementById('verify-email-btn').addEventListener('click', async function() {
      const granted = await requestGmailPermission();
      if (granted) {
        await verifyUserEmail();
        // Refresh the blocker to update status
        showContentBlocker(blockType);
      } else {
        alert('Gmail verification permission denied. Guardian will be notified of unverified access.');
      }
    });
  }

  document.body.appendChild(blockerDiv);
  document.body.style.overflow = 'hidden';
}

// Update supervised mode indicator (replaces showSupervisionNotification)
function updateSupervisedModeIndicator() {
  // Remove any existing indicator
  const existingIndicator = document.getElementById('supervised-mode-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  // If supervised mode is active, add the indicator
  if (supervised_mode) {
    const indicator = document.createElement('div');
    indicator.id = 'supervised-mode-indicator';
    indicator.style.position = 'fixed';
    indicator.style.top = '10px';
    indicator.style.right = '10px';
    indicator.style.backgroundColor = 'rgba(255, 153, 0, 0.95)'; // More visible orange
    indicator.style.color = 'white';
    indicator.style.padding = '10px 15px';
    indicator.style.borderRadius = '5px';
    indicator.style.zIndex = '2147483647'; // Highest possible z-index to ensure visibility
    indicator.style.fontWeight = 'bold';
    indicator.style.fontSize = '16px';
    indicator.style.display = 'flex';
    indicator.style.alignItems = 'center';
    indicator.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    
    indicator.innerHTML = `
      <span style="margin-right: 15px;">🛡️ SUPERVISED MODE ON</span>
      <button id="exit-supervised-mode" style="background: #ff3b30; border: none; color: white; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">EXIT SUPERVISED MODE</button>
    `;
    
    document.body.appendChild(indicator);
    
    // Add event listener to exit button
    document.getElementById('exit-supervised-mode').addEventListener('click', () => {
      endSupervisionSession();
    });
    
    // Add a pulsing effect to make it more noticeable
    const pulseAnimation = document.createElement('style');
    pulseAnimation.textContent = `
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 153, 0, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(255, 153, 0, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 153, 0, 0); }
      }
      #supervised-mode-indicator {
        animation: pulse 2s infinite;
      }
      #exit-supervised-mode:hover {
        background: #cc0000 !important;
        transform: scale(1.05);
      }
    `;
    document.head.appendChild(pulseAnimation);
  }
}

// Listen for changes in document state
document.addEventListener("visibilitychange", function() {
  if (!document.hidden && supervised_mode) {
    // Make sure the indicator is visible when tab becomes visible
    updateSupervisedModeIndicator();
  }
});

// Ensure indicator stays on top by checking periodically
setInterval(() => {
  if (supervised_mode) {
    const indicator = document.getElementById('supervised-mode-indicator');
    if (!indicator || !document.body.contains(indicator)) {
      updateSupervisedModeIndicator();
    }
  }
}, 5000);

// Show supervision mode notification (deprecated, replaced by updateSupervisedModeIndicator)
function showSupervisionNotification() {
  updateSupervisedModeIndicator();
}

// Show fallback content blocker for when key generation fails
function showFallbackContentBlocker(blockType) {
  // Generate a local key
  const localKey = generateLocalKey(6);
  
  // Build overlay similar to the main blocker but with local key validation
  const blockerDiv = document.createElement('div');
  blockerDiv.id = 'content-guardian-blocker';
  blockerDiv.style.position = 'fixed';
  blockerDiv.style.top = '0';
  blockerDiv.style.left = '0';
  blockerDiv.style.width = '100%';
  blockerDiv.style.height = '100%';
  blockerDiv.style.backgroundColor = 'rgb(0, 0, 0)'; // Completely opaque black background
  blockerDiv.style.zIndex = '10000';
  blockerDiv.style.display = 'flex';
  blockerDiv.style.flexDirection = 'column';
  blockerDiv.style.alignItems = 'center';
  blockerDiv.style.justifyContent = 'center';
  blockerDiv.style.color = 'white';
  blockerDiv.style.fontFamily = 'Arial, sans-serif';
  blockerDiv.style.textAlign = 'center';
  blockerDiv.style.padding = '20px';
  
  // Create an additional backdrop blur layer
  const blurOverlay = document.createElement('div');
  blurOverlay.style.position = 'fixed';
  blurOverlay.style.top = '0';
  blurOverlay.style.left = '0';
  blurOverlay.style.width = '100%';
  blurOverlay.style.height = '100%';
  blurOverlay.style.backdropFilter = 'blur(30px)'; // Heavy blur effect
  blurOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // Additional opacity layer
  blurOverlay.style.zIndex = '9999';
  document.body.appendChild(blurOverlay);

  // Warning icon
  const warningIcon = document.createElement('div');
  warningIcon.innerHTML = '⚠️';
  warningIcon.style.fontSize = '80px';
  warningIcon.style.marginBottom = '20px';
  blockerDiv.appendChild(warningIcon);

  // Title
  const warningTitle = document.createElement('h1');
  warningTitle.innerText = 'Content Blocked';
  warningTitle.style.fontSize = '28px';
  warningTitle.style.margin = '10px 0';
  blockerDiv.appendChild(warningTitle);

  // Message
  const warningMessage = document.createElement('p');
  switch (blockType) {
    case 'hate':
      warningMessage.innerText = 'This page has been blocked because it contains potential hate speech.';
      break;
    case 'nsfw':
      warningMessage.innerText = 'This page has been blocked because it contains potential adult content.';
      break;
    case 'violence':
      warningMessage.innerText = 'This page has been blocked because it contains potential violent content.';
      break;
    case 'illegal':
      warningMessage.innerText = 'This page has been blocked because it may contain illegal content or services.';
      break;
    case 'unprotected':
      warningMessage.innerText = 'This page has been blocked because it is not secure (HTTP instead of HTTPS) or may contain malware.';
      break;
    default:
      warningMessage.innerText = 'This page has been blocked because it contains potentially harmful content.';
  }
  warningMessage.style.fontSize = '18px';
  warningMessage.style.maxWidth = '600px';
  warningMessage.style.margin = '20px 0';
  blockerDiv.appendChild(warningMessage);

  // Display offline mode notice
  const offlineNotice = document.createElement('p');
  if (!authState.isLoggedIn) {
    offlineNotice.innerHTML = 'Extension running in offline mode. <a href="http://localhost:8000" target="_blank" style="color: #4CAF50;">Sign in</a> for full protection.';
    } else {
    offlineNotice.innerHTML = 'Connection to guardian service unavailable. Using local protection mode.';
  }
  offlineNotice.style.fontSize = '14px';
  offlineNotice.style.color = '#ffcc00';
  offlineNotice.style.marginBottom = '20px';
  blockerDiv.appendChild(offlineNotice);

  // Key input area with generated local key
  const keyContainer = document.createElement('div');
  keyContainer.style.marginTop = '30px';
  keyContainer.style.display = 'flex';
  keyContainer.style.flexDirection = 'column';
  keyContainer.style.alignItems = 'center';

  // Show the generated key for testing/development (remove in production)
  const developerInfo = document.createElement('p');
  developerInfo.innerText = `Temporary key for testing: ${localKey}`;
  developerInfo.style.fontSize = '14px';
  developerInfo.style.color = '#aaa';
  developerInfo.style.marginTop = '10px';
  keyContainer.appendChild(developerInfo);

  const keyLabel = document.createElement('label');
  keyLabel.innerText = 'Enter the temporary access key:';
  keyLabel.style.marginBottom = '10px';
  keyContainer.appendChild(keyLabel);

  const inputRow = document.createElement('div');
  inputRow.style.display = 'flex';
  inputRow.style.alignItems = 'center';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'Enter key';
  keyInput.style.padding = '10px';
  keyInput.style.fontSize = '16px';
  keyInput.style.borderRadius = '4px';
  keyInput.style.border = 'none';
  keyInput.style.marginRight = '10px';
  keyInput.maxLength = localKey.length;
  inputRow.appendChild(keyInput);

  const submitButton = document.createElement('button');
  submitButton.innerText = 'Unlock';
  submitButton.style.padding = '10px 20px';
  submitButton.style.fontSize = '16px';
  submitButton.style.backgroundColor = '#4CAF50';
  submitButton.style.color = 'white';
  submitButton.style.border = 'none';
  submitButton.style.borderRadius = '4px';
  submitButton.style.cursor = 'pointer';
  inputRow.appendChild(submitButton);

  keyContainer.appendChild(inputRow);

  // Error message
  const errorMessage = document.createElement('p');
  errorMessage.style.color = '#ff6b6b';
  errorMessage.style.marginTop = '10px';
  errorMessage.style.height = '20px';
  keyContainer.appendChild(errorMessage);

  blockerDiv.appendChild(keyContainer);

  // Handle key validation
  submitButton.addEventListener('click', async function() {
    const inputKey = keyInput.value.toUpperCase();
    const validation = await validateLocalKey(inputKey);
    
    if (validation.valid) {
      // Remove blocker and show supervision notification
      document.body.removeChild(blockerDiv);
      
      // Also remove the blur overlay
      const blurOverlay = document.querySelector('div[style*="backdrop-filter: blur"]');
      if (blurOverlay) blurOverlay.remove();
      
      showSupervisionNotification();
    } else {
      errorMessage.innerText = 'Invalid key. Please try again.';
    }
  });

  // Add to page
  document.body.appendChild(blockerDiv);
}

// Function to check if the current URL should be whitelisted from analysis
function isWhitelistedUrl() {
    const currentUrl = window.location.href;
    const whitelistedDomains = [
        'localhost:5000',  // Web portal
        'localhost:8000',  // API server
        '127.0.0.1:5000',  // Web portal alternative address
        '127.0.0.1:8000',  // API server alternative address
    ];

    return whitelistedDomains.some(domain => currentUrl.includes(domain));
}

// Analyze page content for harmful keywords
async function analyzePageContent() {
    // Skip analysis for whitelisted URLs (like our own web portal and API)
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Skipping analysis for whitelisted URL');
        return;
    }

    // Check if supervision mode is active
    const isSupervised = await checkSupervisionMode();
    if (isSupervised) {
        console.log('User is in supervision mode, skipping content analysis');
        localStorage.setItem('contentGuardianStatus', 'supervised');
        showSupervisionNotification();
        return;
    }

    const pageText = document.body.innerText.toLowerCase();
    const pageUrl = window.location.href.toLowerCase();
    const hateKeywords = ['hate speech', 'hate', 'racial slur'];
    const violenceKeywords = ['violence', 'kill', 'murder', 'assault'];
    const nsfwKeywords = ['porn', 'xxx', 'adult content', 'nsfw', 'sex', 'naked', 'nude', 'pussy', 'boobs', 'tits', 'ass', 'penis'];
    const illegalKeywords = ['illegal', 'drugs', 'prescription', 'steroids', 'weapons', 'stolen', 'hacking', 'pirated'];
    const unprotectedKeywords = ['malware', 'phishing', 'virus', 'trojan', 'spyware'];
    
    // Check for unprotected sites (HTTP instead of HTTPS)
    if (window.location.protocol === 'http:') {
        showContentBlocker('unprotected');
        return;
    }
    
    for (const keyword of hateKeywords) {
        if (pageText.includes(keyword)) {
            showContentBlocker('hate');
            return;
        }
    }
    
    for (const keyword of violenceKeywords) {
        if (pageText.includes(keyword)) {
            showContentBlocker('violence');
            return;
        }
    }
    
    for (const keyword of nsfwKeywords) {
        if (pageText.includes(keyword) || pageUrl.includes(keyword)) {
            showContentBlocker('nsfw');
            return;
        }
    }
    
    for (const keyword of illegalKeywords) {
        if (pageText.includes(keyword)) {
            showContentBlocker('illegal');
            return;
        }
    }
    
    for (const keyword of unprotectedKeywords) {
        if (pageText.includes(keyword)) {
            showContentBlocker('unprotected');
            return;
        }
    }
    
    localStorage.setItem('contentGuardianStatus', 'safe');
    localStorage.removeItem('contentGuardianViolationType');
}

// Site status for popup.js
function isSiteSafe() {
  const status = localStorage.getItem('contentGuardianStatus');
  return {
    status: status || 'unknown',
    violationType: localStorage.getItem('contentGuardianViolationType') || null
  };
}

// Check if page was previously blocked
async function checkPreviousBlock() {
    // Skip for whitelisted URLs
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Skipping previous block check for whitelisted URL');
        return;
    }
    
    // Check if supervision mode is active
    const isSupervised = await checkSupervisionMode();
    if (isSupervised) {
        console.log('User is in supervision mode, allowing content');
        localStorage.setItem('contentGuardianStatus', 'supervised');
        showSupervisionNotification();
        return;
    }
    
    // Implement previous block check if needed
}

// Display notification to user
function showNotification(title, message) {
  const notification = document.createElement('div');
  notification.className = 'cg-notification';
  notification.innerHTML = `
    <div class="cg-notification-header">
      <span class="cg-notification-title">${title}</span>
      <span class="cg-notification-close">&times;</span>
    </div>
    <div class="cg-notification-content">
      ${message}
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Add CSS styles
  const styles = document.createElement('style');
  styles.textContent = `
    .cg-notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 300px;
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 9999999;
      overflow: hidden;
      animation: cg-slide-in 0.3s ease;
    }
    .cg-notification-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 15px;
      background-color: #4a6cf7;
      color: white;
    }
    .cg-notification-title {
      font-weight: bold;
    }
    .cg-notification-close {
      cursor: pointer;
      font-size: 20px;
    }
    .cg-notification-content {
      padding: 15px;
      color: #333;
      font-size: 14px;
    }
    @keyframes cg-slide-in {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  `;
  document.head.appendChild(styles);
  
  // Handle close button
  const closeBtn = notification.querySelector('.cg-notification-close');
  closeBtn.addEventListener('click', () => {
    notification.remove();
    styles.remove();
  });
  
  // Auto-remove after 8 seconds
  setTimeout(() => {
    notification.remove();
    styles.remove();
  }, 8000);
}

// Initialize the extension
function initialize() {
    // Skip for whitelisted URLs
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Initialization skipped for whitelisted URL');
        return;
    }
    
    // Load authentication state and supervised mode
    loadAuthState();

    // Register extension installation
    registerExtension();
    
    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Start heartbeat interval
    startHeartbeatInterval();
    
    // Display supervised mode indicator if in supervised mode
    checkSupervisionMode().then(isSupervised => {
        if (isSupervised) {
            updateSupervisedModeIndicator();
        }
    });
    
    // Analyze page content
    analyzePageContent();
    
    // Listen for updates to auth state and supervision state
    chrome.storage.onChanged.addListener(function(changes, namespace) {
        if (changes.contentGuardianAuth) {
            authState = changes.contentGuardianAuth.newValue;
            
            // Reconnect WebSocket with new auth
            if (authState.isLoggedIn) {
                initializeWebSocket();
            }
        }
        
        if (changes.contentGuardianSupervision) {
            const newSupervisionState = changes.contentGuardianSupervision.newValue;
            supervised_mode = newSupervisionState && newSupervisionState.active === true;
            
            // Update indicator based on new state
            updateSupervisedModeIndicator();
            
            // If supervision mode was just enabled, reload the page to show content
            if (supervised_mode && document.getElementById('content-guardian-blocker')) {
                window.location.reload();
            }
        }
    });
}

// Run on page load
window.addEventListener('load', () => {
    // Skip for whitelisted URLs
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Load events skipped for whitelisted URL');
        return;
    }
    
    initialize();
    checkPreviousBlock();
    setTimeout(analyzePageContent, 2000);
});

// Function to analyze an image
async function analyzeImage(imageElement) {
    // Get image URL
    const imageUrl = imageElement.src;
    
    // Get any alt text or surrounding text
    const altText = imageElement.alt || '';
    const surroundingText = getSurroundingText(imageElement);
    
    // Convert image to base64 if it's on the same domain
    let imageData = null;
    try {
        // Check if the image is on the same origin
        const url = new URL(imageUrl);
        const isSameOrigin = url.origin === window.location.origin;
        
        // For same-origin images, try to get image data
        if (isSameOrigin) {
            const canvas = document.createElement('canvas');
            canvas.width = imageElement.width || 300;
            canvas.height = imageElement.height || 300;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageElement, 0, 0);
            imageData = canvas.toDataURL('image/jpeg');
        } else {
            // For cross-origin images, just use the URL
            console.log('Cross-origin image, using URL instead of pixel data:', imageUrl);
        }
    } catch (error) {
        console.warn('Could not get image data:', error);
    }
    
    // Send analysis request to background script
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'analyzeContent',
            url: imageUrl,
            text: `${altText} ${surroundingText}`.trim(),
            imageData: imageData
        }, (response) => {
            // Handle case where response might be undefined
            resolve(response || { harmful: false, types: [] });
        });
    });
}

// Function to get text surrounding an element
function getSurroundingText(element) {
    const range = 100; // Characters to collect before and after
    let text = '';
    
    // Get parent's text content
    if (element.parentElement) {
        const parentText = element.parentElement.textContent;
        const elementIndex = Array.from(element.parentElement.children).indexOf(element);
        text = parentText.substring(Math.max(0, elementIndex - range), elementIndex + range);
    }
    
    return text.trim();
}

// Function to log harmful content
function logHarmfulContent(element, analysisResult) {
    const url = window.location.href;
    const content = {
        url: url,
        type: 'image',
        text: element.alt || '',
        imageUrl: element.src || '',
        categories: analysisResult.types || []
    };
    
    // Log to console for debugging
    console.log('Logging harmful content:', content);
    
    // Send to background script for storage/reporting
    chrome.runtime.sendMessage({
        action: 'logHarmfulContent',
        content: content
    });
    
    // If we're authenticated, also try to send to the API
    if (authState.isLoggedIn) {
        sendContentAlert(url, 'image', content);
    }
}

// Function to handle harmful content
function handleHarmfulContent(element, analysisResult) {
    if (!analysisResult) {
        console.warn('Received undefined analysis result');
        return;
    }
    
    if (analysisResult.harmful) {
        // Completely blur the image itself first
        element.style.filter = 'blur(30px)';
        
        // Create warning overlay
        const overlay = document.createElement('div');
        overlay.className = 'content-guardian-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgb(0, 0, 0); /* Completely opaque black background */
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            text-align: center;
            z-index: 10000;
        `;
        
        // Create warning message
        const message = document.createElement('div');
        message.innerHTML = `
            <h3>⚠️ Warning: Potentially Harmful Content</h3>
            <p>Type: ${analysisResult.types ? analysisResult.types.join(', ') : 'Unknown'}</p>
            <button class="show-content-btn">Show Content</button>
        `;
        overlay.appendChild(message);
        
        // Position the overlay
        element.style.position = 'relative';
        element.appendChild(overlay);
        
        // Add show content button functionality
        const showBtn = overlay.querySelector('.show-content-btn');
        showBtn.onclick = () => {
            overlay.remove();
            element.style.filter = 'none'; // Remove blur when showing content
        };
        
        // Log the harmful content
        logHarmfulContent(element, analysisResult);
    }
}

// Function to scan the page for images
async function scanPage() {
    // Skip analysis for whitelisted URLs (like our own web portal and API)
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Skipping image analysis for whitelisted URL');
        return;
    }

    const images = document.getElementsByTagName('img');
    
    for (const img of images) {
        if (img.complete && img.naturalHeight !== 0) {
            try {
                const result = await analyzeImage(img);
                handleHarmfulContent(img, result);
            } catch (error) {
                console.error('Error analyzing image:', error);
            }
        }
    }
}

// Start scanning when the page loads
window.addEventListener('load', () => {
    // Skip for whitelisted URLs
    if (isWhitelistedUrl()) {
        console.log('Content Guardian: Image scanning skipped for whitelisted URL');
        return;
    }
    
    scanPage();
});

// Observe DOM changes for dynamically loaded content
const observer = new MutationObserver((mutations) => {
    // Skip for whitelisted URLs
    if (isWhitelistedUrl()) {
        return;
    }
    
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeName === 'IMG') {
                analyzeImage(node)
                    .then(result => handleHarmfulContent(node, result))
                    .catch(error => console.error('Error analyzing dynamic image:', error));
            }
        }
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
}); 