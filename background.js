// Content Guardian Extension - Background Script
// This script runs in the background and tracks browsing history

// Initialize browsing history in chrome.storage.local if not present
chrome.storage.local.get(['contentGuardianHistory'], function(result) {
  if (!result.contentGuardianHistory) {
    chrome.storage.local.set({contentGuardianHistory: []});
  }
});

// Initialize supervised mode if not present
chrome.storage.local.get(['contentGuardianSupervision', 'contentGuardianAuth'], function(result) {
  // Auto-enable supervised mode if user is logged in
  const isLoggedIn = result.contentGuardianAuth && result.contentGuardianAuth.isLoggedIn;
  
  // Set up supervised mode
  const supervisionData = {
    active: isLoggedIn ? true : false,
    sessionId: isLoggedIn ? 'auto-' + Date.now() : null,
    startedAt: isLoggedIn ? new Date().toISOString() : null,
    expiryTime: isLoggedIn ? new Date(Date.now() + 3600000 * 24).toISOString() : null, // 24 hours by default
    supervisor: 'Automatic Login',
    isAuto: true
  };
  
  // Only initialize if not already set
  if (!result.contentGuardianSupervision) {
    chrome.storage.local.set({
      contentGuardianSupervision: supervisionData
    });
  }
});

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    const currentTime = new Date().toISOString();
    const historyEntry = {
      url: tab.url,
      title: tab.title || 'Untitled',
      timestamp: currentTime,
      status: 'allowed' // Default status
    };
    
    // Check for blocked keywords (simplified version of the content.js logic)
    const blockedKeywords = {
      hate: ['hate speech', 'hate', 'racial slur'],
      violence: ['violence', 'kill', 'murder', 'assault'],
      nsfw: ['porn', 'xxx', 'adult content', 'nsfw', 'sex', 'naked', 'nude', 'pussy', 'boobs', 'tits', 'ass', 'penis'],
      illegal: ['illegal', 'drugs', 'prescription', 'steroids', 'weapons', 'stolen', 'hacking', 'pirated'],
      unprotected: ['http:', 'not secure', 'malware', 'phishing', 'virus', 'trojan', 'spyware']
    };
    
    // Simple text check (in a real extension this would be more sophisticated)
    if (tab.title) {
      const lowerTitle = tab.title.toLowerCase();
      
      for (const [category, keywords] of Object.entries(blockedKeywords)) {
        for (const keyword of keywords) {
          if (lowerTitle.includes(keyword)) {
            historyEntry.status = 'blocked';
            historyEntry.type = category;
            break;
          }
        }
        if (historyEntry.status === 'blocked') break;
      }
    }
    
    // Check for unprotected sites (HTTP)
    if (!historyEntry.status.includes('blocked') && tab.url.startsWith('http:')) {
      historyEntry.status = 'blocked';
      historyEntry.type = 'unprotected';
    }
    
    // Check if user is in supervision mode
    chrome.storage.local.get(['contentGuardianSupervision'], function(result) {
      const supervisionActive = result.contentGuardianSupervision && 
                              result.contentGuardianSupervision.active === true;
      
      if (supervisionActive && historyEntry.status === 'blocked') {
        historyEntry.status = 'supervised';
        historyEntry.supervision = {
          timestamp: new Date().toISOString(),
          supervisor: result.contentGuardianSupervision.supervisor || 'Unknown',
          supervisionExpiry: result.contentGuardianSupervision.expiryTime || new Date(Date.now() + 3600000).toISOString() // Default 1 hour
        };
      }
      
      // Add to history
      chrome.storage.local.get(['contentGuardianHistory'], function(result) {
        const history = result.contentGuardianHistory || [];
        history.unshift(historyEntry); // Add to beginning
        
        // Keep only last 100 entries
        if (history.length > 100) {
          history.pop();
        }
        
        // Save updated history
        chrome.storage.local.set({contentGuardianHistory: history});
        
        // For demo purposes, simulate different statuses randomly
        if (Math.random() < 0.2 && historyEntry.status === 'allowed') {
          // 20% of otherwise allowed sites get blocked for demo
          const types = ['hate', 'violence', 'nsfw', 'illegal', 'unprotected'];
          const randomType = types[Math.floor(Math.random() * types.length)];
          
          chrome.storage.local.get(['contentGuardianHistory'], function(result) {
            const updatedHistory = result.contentGuardianHistory || [];
            if (updatedHistory.length > 0) {
              updatedHistory[0].status = 'blocked';
              updatedHistory[0].type = randomType;
              chrome.storage.local.set({contentGuardianHistory: updatedHistory});
            }
          });
        } else if (Math.random() < 0.3 && historyEntry.status === 'blocked') {
          // 30% of blocked sites get supervised for demo
          chrome.storage.local.get(['contentGuardianHistory'], function(result) {
            const updatedHistory = result.contentGuardianHistory || [];
            if (updatedHistory.length > 0) {
              updatedHistory[0].status = 'supervised';
              chrome.storage.local.set({contentGuardianHistory: updatedHistory});
            }
          });
        }
      });
    });
  }
});

// Listen for authentication state changes to automatically enable supervised mode
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local' && changes.contentGuardianAuth) {
    const newAuthState = changes.contentGuardianAuth.newValue;
    const oldAuthState = changes.contentGuardianAuth.oldValue || {};
    
    // If user has just logged in, automatically enable supervised mode
    if (newAuthState && newAuthState.isLoggedIn && !oldAuthState.isLoggedIn) {
      const supervisionData = {
        active: true,
        sessionId: 'login-' + Date.now(),
        startedAt: new Date().toISOString(),
        expiryTime: new Date(Date.now() + 3600000 * 24).toISOString(), // 24 hours by default
        supervisor: 'Automatic Login',
        isAuto: true
      };
      
      chrome.storage.local.set({
        contentGuardianSupervision: supervisionData
      });
      
      // Reload all tabs to apply supervised mode
      chrome.tabs.query({}, function(tabs) {
        for (let i = 0; i < tabs.length; i++) {
          if (!tabs[i].url.startsWith('chrome://')) {
            chrome.tabs.reload(tabs[i].id);
          }
        }
      });
    }
  }
});

// Listen for messages from the content script or popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'toggleSupervisionMode') {
    chrome.storage.local.get(['contentGuardianSupervision'], function(result) {
      const currentMode = result.contentGuardianSupervision && result.contentGuardianSupervision.active;
      const newSupervisionData = {
        active: !currentMode,
        sessionId: !currentMode ? 'bg-' + Date.now() : null,
        startedAt: !currentMode ? new Date().toISOString() : null,
        expiryTime: !currentMode ? new Date(Date.now() + 3600000 * 24).toISOString() : null, // 24 hours by default
        supervisor: request.supervisor || 'Manual Toggle'
      };
      
      chrome.storage.local.set({ 'contentGuardianSupervision': newSupervisionData }, function() {
        // Force reload all tabs on toggle to apply new mode
        chrome.tabs.query({}, function(tabs) {
          for (let i = 0; i < tabs.length; i++) {
            if (!tabs[i].url.startsWith('chrome://')) {
              chrome.tabs.reload(tabs[i].id);
            }
          }
        });
        
        sendResponse({ success: true, mode: !currentMode });
      });
    });
    
    return true; // Indicate async response
  }
  
  // Check for login redirect from sign-in page
  if (request.action === 'userLoggedIn') {
    // Enable supervised mode automatically
    const supervisionData = {
      active: true,
      sessionId: 'login-redirect-' + Date.now(),
      startedAt: new Date().toISOString(),
      expiryTime: new Date(Date.now() + 3600000 * 24).toISOString(), // 24 hours by default
      supervisor: 'Sign-in Redirect',
      isAuto: true
    };
    
    chrome.storage.local.set({ 
      'contentGuardianSupervision': supervisionData 
    }, function() {
      sendResponse({ success: true });
      
      // Reload all tabs
      chrome.tabs.query({}, function(tabs) {
        for (let i = 0; i < tabs.length; i++) {
          if (!tabs[i].url.startsWith('chrome://')) {
            chrome.tabs.reload(tabs[i].id);
          }
        }
      });
    });
    
    return true; // Indicate async response
  }
});

// For our demo website, we'll simulate navigation events
function simulateBrowsing() {
  // Demo URLs to simulate browsing
  const demoUrls = [
    { url: 'https://www.example.com/news', title: 'Latest News | Example News' },
    { url: 'https://www.example.com/tech', title: 'Technology Updates | Example Tech' },
    { url: 'https://www.example.com/games', title: 'Popular Games with Violent Content' },
    { url: 'https://www.example.com/forum', title: 'Discussion Forum | Example Community' },
    { url: 'https://www.example.com/sports', title: 'Sports News | Example Sports' },
    { url: 'https://www.example.com/videos', title: 'Videos | Example Media' },
    { url: 'https://www.example.com/nsfw', title: 'Adult Content (18+) | Example Site' },
    { url: 'https://www.example.com/music', title: 'Music | Example Entertainment' },
    { url: 'https://www.example.com/hate', title: 'Hate Speech Forum | Example Site' }
  ];
  
  // When the extension is loaded, simulate some browsing history if it's empty
  chrome.storage.local.get(['contentGuardianHistory'], function(result) {
    const history = result.contentGuardianHistory || [];
    
    if (history.length < 5) {
      // Add some sample history for demo purposes
      const simulatedHistory = [];
      
      // Generate 5-10 random history entries from the past week
      const numEntries = 5 + Math.floor(Math.random() * 5);
      
      for (let i = 0; i < numEntries; i++) {
        const randomUrlIndex = Math.floor(Math.random() * demoUrls.length);
        const demoSite = demoUrls[randomUrlIndex];
        
        // Random time in the past week
        const timestamp = new Date();
        timestamp.setDate(timestamp.getDate() - Math.floor(Math.random() * 7));
        timestamp.setHours(Math.floor(Math.random() * 24));
        timestamp.setMinutes(Math.floor(Math.random() * 60));
        
        // Determine status based on URL content (simplified)
        let status = 'allowed';
        let type = null;
        
        if (demoSite.title.toLowerCase().includes('violent')) {
          status = 'blocked';
          type = 'violence';
        } else if (demoSite.title.toLowerCase().includes('adult')) {
          status = 'blocked';
          type = 'nsfw';
        } else if (demoSite.title.toLowerCase().includes('hate')) {
          status = 'blocked';
          type = 'hate';
        }
        
        // Random chance of supervised for blocked content
        if (status === 'blocked' && Math.random() < 0.4) {
          status = 'supervised';
        }
        
        const historyEntry = {
          url: demoSite.url,
          title: demoSite.title,
          timestamp: timestamp.toISOString(),
          status: status
        };
        
        if (type) {
          historyEntry.type = type;
        }
        
        simulatedHistory.push(historyEntry);
      }
      
      // Sort by timestamp (newest first)
      simulatedHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Save the simulated history
      chrome.storage.local.set({contentGuardianHistory: simulatedHistory});
    }
  });
}

// Run the simulation when the script loads
simulateBrowsing();

// Content analysis API endpoint
const ANALYSIS_API_URL = 'http://127.0.0.1:8000/analyze';

// Function to analyze content
async function analyzeContent(url, text = null, imageData = null) {
    try {
        // Ensure we have valid data to send
        const requestData = {
            url: url || window.location.href,
            text: text || '',
            image_data: imageData || null
        };

        const response = await fetch(ANALYSIS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Content analysis failed:', error);
        // Return a default response that won't trigger warnings
        return { 
            harmful: false,
            types: [],
            confidence: 0,
            error: error.message 
        };
    }
}

// Store harmful content logs
function storeHarmfulContent(content) {
    chrome.storage.local.get(['contentGuardianLogs'], function(result) {
        const logs = result.contentGuardianLogs || [];
        
        // Add timestamp to the log
        content.timestamp = new Date().toISOString();
        
        // Add to beginning of logs
        logs.unshift(content);
        
        // Keep only last 100 entries
        if (logs.length > 100) {
            logs.pop();
        }
        
        // Save updated logs
        chrome.storage.local.set({contentGuardianLogs: logs});
        
        // Also update badge to show number of harmful items
        chrome.action.setBadgeText({text: logs.length.toString()});
        chrome.action.setBadgeBackgroundColor({color: '#cc0000'});
    });
}

// Listen for content analysis requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyzeContent') {
        // Handle content analysis request
        analyzeContent(request.url, request.text, request.imageData)
            .then(result => sendResponse(result))
            .catch(error => {
                console.error('Error in analyzeContent handler:', error);
                sendResponse({ 
                    harmful: false, 
                    types: [], 
                    confidence: 0,
                    error: error.message 
                });
            });
        return true; // Will respond asynchronously
    }
    
    if (request.action === 'logHarmfulContent') {
        // Store the harmful content log
        storeHarmfulContent(request.content);
        sendResponse({success: true});
        return true;
    }
    
    if (request.action === 'getHistory') {
      chrome.storage.local.get(['contentGuardianHistory'], function(result) {
        sendResponse({ history: result.contentGuardianHistory || [] });
      });
      return true; // Required for asynchronous sendResponse
    }
    
    if (request.action === 'getLogs') {
      chrome.storage.local.get(['contentGuardianLogs'], function(result) {
        sendResponse({ logs: result.contentGuardianLogs || [] });
      });
      return true;
    }
}); 