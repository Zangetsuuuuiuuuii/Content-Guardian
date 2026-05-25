// Wait for the DOM content to be loaded
document.addEventListener('DOMContentLoaded', function() {
  // Set up retry button
  document.getElementById('retry-button').addEventListener('click', function() {
    // Hide error actions
    document.getElementById('error-actions').style.display = 'none';
    
    // Show loading
    const statusContainer = document.getElementById('status-container');
    statusContainer.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <div>Checking site safety...</div>
      </div>
    `;
    
    // Try again
    checkCurrentTab();
  });
  
  // Add supervised mode toggle
  document.getElementById('supervised-mode-toggle').addEventListener('click', function() {
    toggleSupervisionMode();
  });
  
  // Initialize check
  checkCurrentTab();
  
  // Check supervised mode status for UI
  checkSupervisionStatus();
});

// Check supervision status for UI
function checkSupervisionStatus() {
  chrome.storage.local.get(['contentGuardianSupervision', 'contentGuardianAuth'], function(result) {
    const isSupervised = result.contentGuardianSupervision && result.contentGuardianSupervision.active === true;
    const isLoggedIn = result.contentGuardianAuth && result.contentGuardianAuth.isLoggedIn === true;
    const isGuardian = result.contentGuardianAuth && result.contentGuardianAuth.isGuardian === true;
    
    // Update supervised mode toggle button based on current status
    const toggleBtn = document.getElementById('supervised-mode-toggle');
    const supervisionStatus = document.getElementById('supervision-status');
    const supervisionSection = document.getElementById('supervision-section');
    
    if (isLoggedIn) {
      supervisionSection.style.display = 'block';
      
      if (isSupervised) {
        toggleBtn.innerText = 'Exit Supervised Mode';
        toggleBtn.className = 'button warning';
        supervisionStatus.innerText = 'Supervised Mode Active';
        supervisionStatus.className = 'status-label active';
      } else {
        toggleBtn.innerText = 'Enter Supervised Mode';
        toggleBtn.className = 'button primary';
        supervisionStatus.innerText = 'Supervised Mode Inactive';
        supervisionStatus.className = 'status-label inactive';
      }
      
      // Only show the button for guardian accounts or override if debugging
      if (isGuardian || localStorage.getItem('cgDebugMode') === 'true') {
        toggleBtn.style.display = 'block';
      } else {
        toggleBtn.style.display = 'none';
      }
    } else {
      // Not logged in
      supervisionSection.style.display = 'none';
    }
  });
}

// Toggle supervision mode
function toggleSupervisionMode() {
  const toggleBtn = document.getElementById('supervised-mode-toggle');
  toggleBtn.disabled = true;
  toggleBtn.innerText = 'Updating...';
  
  // Send message to background script to toggle supervision mode
  chrome.runtime.sendMessage(
    { 
      action: 'toggleSupervisionMode',
      supervisor: 'Extension Popup'
    }, 
    function(response) {
      if (response && response.success) {
        // Update UI based on new mode
        toggleBtn.disabled = false;
        checkSupervisionStatus();
      } else {
        // Handle error
        toggleBtn.disabled = false;
        toggleBtn.innerText = 'Error - Try Again';
        setTimeout(checkSupervisionStatus, 2000);
      }
    }
  );
}

// Main function to check the current tab
function checkCurrentTab() {
  // Get the current active tab
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs.length === 0) {
      showError("Could not detect current tab");
      return;
    }
    
    const currentTab = tabs[0];
    const url = currentTab.url;
    
    // Skip chrome:// pages, settings pages, etc.
    if (!url.startsWith('http')) {
      showSpecialPageMessage();
      return;
    }
    
    // First check if we have the necessary permissions
    checkPermissions(currentTab);
  });
}

// Check for required permissions and handle gracefully if missing
function checkPermissions(tab) {
  // First try to get data from storage directly (doesn't require scripting permission)
  chrome.storage.local.get(
    ['contentGuardianStatus', 'contentGuardianViolationType', 'contentGuardianSupervision'], 
    function(result) {
      if (result.contentGuardianStatus) {
        // We have data in storage, use it
        const status = {
          status: result.contentGuardianStatus,
          violationType: result.contentGuardianViolationType
        };
        
        // If in supervised mode, update status
        if (result.contentGuardianSupervision && result.contentGuardianSupervision.active) {
          status.status = 'supervised';
        }
        
        handleStatusResult(status);
      } else {
        // No data in storage, try script execution if we have permissions
        tryScriptExecution(tab);
      }
    }
  );
}

// Try to execute the script with proper error handling
function tryScriptExecution(tab) {
  try {
    // Check if scripting is available
    if (!chrome.scripting) {
      showError("This extension requires additional permissions");
      showRetryButton();
      return;
    }
    
    chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: getSiteStatus
    }).then(results => {
      if (!results || results.length === 0) {
        showError("Could not check site status");
        showRetryButton();
        return;
      }
      
      const status = results[0].result;
      handleStatusResult(status);
      
    }).catch(error => {
      console.error("Error executing script:", error);
      if (error.message && error.message.includes("permission")) {
        showError("Permission denied. Please refresh the page.");
      } else if (error.message && error.message.includes("cannot access")) {
        showError("Cannot access this page due to browser restrictions");
      } else {
        showError("An error occurred while checking the site status");
      }
      showRetryButton();
    });
  } catch (e) {
    console.error("Error:", e);
    showError("Extension error: " + (e.message || "Unknown error"));
    showRetryButton();
  }
}

// Show the retry button
function showRetryButton() {
  document.getElementById('error-actions').style.display = 'block';
}

// Handle the status result
function handleStatusResult(status) {
  if (status.status === 'blocked') {
    showUnsafeStatus(status.violationType);
  } else if (status.status === 'supervised') {
    showSupervisedStatus(status.violationType);
  } else if (status.status === 'safe') {
    showSafeStatus();
  } else {
    showNotAnalyzedStatus();
  }
}

// Function to get site status from the content page - supports both localStorage (content script) 
// and chrome.storage.local (background) contexts
function getSiteStatus() {
  // Try to use localStorage (works in content scripts)
  try {
    if (typeof localStorage !== 'undefined') {
      const status = localStorage.getItem('contentGuardianStatus');
      const violationType = localStorage.getItem('contentGuardianViolationType');
      
      return {
        status: status || 'unknown',
        violationType: violationType || null
      };
    }
  } catch (e) {
    console.log("localStorage not available, will try chrome.storage");
  }
  
  // Fallback to direct return for content script
  return {
    status: 'unknown',
    violationType: null
  };
}

// Show that the site is safe
function showSafeStatus() {
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status safe">
      <div class="status-icon" style="color: #28a745;">✓</div>
      <div class="status-text">
        <div class="status-title">This site appears to be safe</div>
        <div>No harmful content has been detected on this page.</div>
      </div>
    </div>
  `;
}

// Show that the site is under supervision
function showSupervisedStatus(violationType) {
  let violationText = 'potentially harmful content';
  
  switch(violationType) {
    case 'hate':
      violationText = 'hate speech or discriminatory content';
      break;
    case 'nsfw':
      violationText = 'adult or inappropriate content';
      break;
    case 'violence':
      violationText = 'violent or graphic content';
      break;
    case 'illegal':
      violationText = 'potentially illegal content or services';
      break;
    case 'unprotected':
      violationText = 'an unprotected (HTTP) or potentially malicious site';
      break;
  }
  
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status supervised">
      <div class="status-icon" style="color: #4CAF50;">🛡️</div>
      <div class="status-text">
        <div class="status-title">Supervised Mode Active</div>
        <div>This site contains ${violationText} but is currently being accessed in supervised mode.</div>
      </div>
    </div>
  `;
}

// Show that the site is not safe
function showUnsafeStatus(violationType) {
  let violationText = 'harmful content';
  
  switch(violationType) {
    case 'hate':
      violationText = 'hate speech or discriminatory content';
      break;
    case 'nsfw':
      violationText = 'adult or inappropriate content';
      break;
    case 'violence':
      violationText = 'violent or graphic content';
      break;
    case 'illegal':
      violationText = 'potentially illegal content or services';
      break;
    case 'unprotected':
      violationText = 'an unprotected (HTTP) or potentially malicious site';
      break;
  }
  
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status unsafe">
      <div class="status-icon" style="color: #dc3545;">!</div>
      <div class="status-text">
        <div class="status-title">This site has been blocked</div>
        <div>Content Guardian has detected ${violationText} on this page.</div>
      </div>
    </div>
  `;
}

// Show that the site hasn't been analyzed yet
function showNotAnalyzedStatus() {
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status unknown">
      <div class="status-icon" style="color: #ffc107;">?</div>
      <div class="status-text">
        <div class="status-title">Site not yet analyzed</div>
        <div>Content Guardian hasn't analyzed this page yet.</div>
      </div>
    </div>
  `;
}

// Show a message for special pages
function showSpecialPageMessage() {
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status">
      <div class="status-icon" style="color: #17a2b8;">ℹ️</div>
      <div class="status-text">
        <div class="status-title">Browser Page</div>
        <div>Content Guardian doesn't analyze internal browser pages.</div>
      </div>
    </div>
  `;
}

// Show an error message
function showError(message) {
  const statusContainer = document.getElementById('status-container');
  statusContainer.innerHTML = `
    <div class="safe-status error">
      <div class="status-icon" style="color: #dc3545;">⚠️</div>
      <div class="status-text">
        <div class="status-title">Error checking site</div>
        <div>${message}</div>
      </div>
    </div>
  `;
} 