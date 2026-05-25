// Web History Tracker for Content Guardian
// This simulates what a real browser extension would do

// Global supervised mode flag
window.supervised_mode = false;

class WebHistoryTracker {
  constructor() {
    this.initializeStorage();
    this.setupListeners();
    this.simulateBrowsingIfNeeded();
    
    // Initialize block page iframe handler
    this.setupBlockPage();
    
    // Check if supervised mode is already active from localStorage
    const supervisionActive = localStorage.getItem('contentGuardianSupervision') === 'active';
    const supervisionData = JSON.parse(localStorage.getItem('contentGuardianSupervisionData') || '{}');
    window.supervised_mode = supervisionActive || (supervisionData && supervisionData.active);
    
    // Add supervised mode indicator if needed
    this.updateSupervisedModeIndicator();
  }
  
  // Initialize storage if needed
  initializeStorage() {
    if (!localStorage.getItem('contentGuardianHistory')) {
      localStorage.setItem('contentGuardianHistory', JSON.stringify([]));
    }
  }
  
  // Set up event listeners
  setupListeners() {
    // Listen for clicks on links to track "navigation"
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href && !link.href.startsWith('javascript:')) {
        this.trackPageVisit(link.href, link.textContent || link.innerText || 'Link');
      }
    });
    
    // Track the current page on load
    window.addEventListener('load', () => {
      this.trackPageVisit(window.location.href, document.title);
      
      // Update supervised mode indicator
      this.updateSupervisedModeIndicator();
    });
  }
  
  // Add supervised mode indicator
  updateSupervisedModeIndicator() {
    // Remove any existing indicator
    const existingIndicator = document.getElementById('supervised-mode-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // If supervised mode is active, add the indicator
    if (window.supervised_mode) {
      const indicator = document.createElement('div');
      indicator.id = 'supervised-mode-indicator';
      indicator.style.position = 'fixed';
      indicator.style.top = '10px';
      indicator.style.right = '10px';
      indicator.style.backgroundColor = 'rgba(60, 186, 84, 0.9)';
      indicator.style.color = 'white';
      indicator.style.padding = '8px 15px';
      indicator.style.borderRadius = '5px';
      indicator.style.zIndex = '10000';
      indicator.style.fontWeight = 'bold';
      indicator.style.fontSize = '14px';
      indicator.style.display = 'flex';
      indicator.style.alignItems = 'center';
      indicator.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
      
      indicator.innerHTML = `
        <span style="margin-right: 10px;">🛡️ Supervised Mode</span>
        <button id="exit-supervised-mode" style="background: white; border: none; color: #3cba54; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">Exit</button>
      `;
      
      document.body.appendChild(indicator);
      
      // Add event listener to exit button
      document.getElementById('exit-supervised-mode').addEventListener('click', () => {
        window.supervised_mode = false;
        localStorage.removeItem('contentGuardianSupervision');
        
        // Update supervision data to inactive
        const supervisionData = JSON.parse(localStorage.getItem('contentGuardianSupervisionData') || '{}');
        supervisionData.active = false;
        supervisionData.endTime = new Date().toISOString();
        localStorage.setItem('contentGuardianSupervisionData', JSON.stringify(supervisionData));
        
        // Reload the page to refresh the state
        window.location.reload();
      });
    }
  }
  
  // Track a page visit
  trackPageVisit(url, title) {
    const currentTime = new Date().toISOString();
    const historyEntry = {
      url: url,
      title: title || 'Untitled',
      timestamp: currentTime,
      status: 'allowed' // Default status
    };
    
    // Check if the URL is from localhost or our own domain - always mark as safe
    if (url.includes('localhost') || 
        url.includes('127.0.0.1') || 
        url.includes('web-portal') || 
        url.includes('dashboard') ||
        url.includes('content-guardian')) {
      historyEntry.status = 'allowed';
      historyEntry.type = 'safe';
      
      // Add to history
      const history = JSON.parse(localStorage.getItem('contentGuardianHistory') || '[]');
      history.unshift(historyEntry); // Add to beginning
      
      // Keep only last 100 entries
      if (history.length > 100) {
        history.pop();
      }
      
      // Save updated history
      localStorage.setItem('contentGuardianHistory', JSON.stringify(history));
      
      // Skip further checks for safe URLs
      return;
    }
    
    // Check for blocked keywords (simplified version of the extension logic)
    const blockedKeywords = {
      hate: ['hate speech', 'hate', 'racial slur'],
      violence: ['violence', 'kill', 'murder', 'assault'],
      nsfw: ['porn', 'xxx', 'adult content', 'nsfw', '18+', 'sex', 'naked', 'nude', 'pussy', 'boobs', 'tits', 'ass', 'penis'],
      illegal: ['illegal', 'drugs', 'prescription', 'steroids', 'weapons', 'stolen', 'hacking', 'pirated'],
      unprotected: ['http:', 'not secure', 'malware', 'phishing', 'virus', 'trojan', 'spyware']
    };
    
    // Simple text check
    const lowerTitle = title.toLowerCase();
    const lowerUrl = url.toLowerCase();
    
    // Check for unprotected sites (HTTP instead of HTTPS)
    if (url.startsWith('http:') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      historyEntry.status = 'blocked';
      historyEntry.type = 'unprotected';
    }
    
    for (const [category, keywords] of Object.entries(blockedKeywords)) {
      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword) || lowerUrl.includes(keyword)) {
          historyEntry.status = 'blocked';
          historyEntry.type = category;
          break;
        }
      }
      if (historyEntry.status === 'blocked') break;
    }
    
    // Check if supervised mode is active using the global flag
    const supervisionActive = window.supervised_mode;
    
    // If supervised mode is active, mark blocked content as supervised
    if (supervisionActive && historyEntry.status === 'blocked') {
      historyEntry.status = 'supervised';
      
      // Get supervision data
      const supervisionData = JSON.parse(localStorage.getItem('contentGuardianSupervisionData') || '{}');
      
      // Add supervision details
      historyEntry.supervision = {
        timestamp: new Date().toISOString(),
        supervisor: supervisionData.supervisor || 'Unknown',
        supervisionExpiry: supervisionData.expiryTime
      };
    }
    
    // Add to history
    const history = JSON.parse(localStorage.getItem('contentGuardianHistory') || '[]');
    history.unshift(historyEntry); // Add to beginning
    
    // Keep only last 100 entries
    if (history.length > 100) {
      history.pop();
    }
    
    // Save updated history
    localStorage.setItem('contentGuardianHistory', JSON.stringify(history));
    
    // For demo purposes on the website, simulate more varied history
    this.simulateRandomBlockedStatus(historyEntry);
  }
  
  // Simulate random blocked status for more interesting demo
  simulateRandomBlockedStatus(historyEntry) {
    // Only if not already in our monitoring pages or localhost
    if (window.location.href.includes('dashboard') || 
        historyEntry.url.includes('localhost') || 
        historyEntry.url.includes('127.0.0.1')) {
      return;
    }
    
    if (Math.random() < 0.2 && historyEntry.status === 'allowed') {
      // 20% of otherwise allowed sites get blocked for demo
      const types = ['hate', 'violence', 'nsfw'];
      const randomType = types[Math.floor(Math.random() * types.length)];
      
      const history = JSON.parse(localStorage.getItem('contentGuardianHistory'));
      history[0].status = 'blocked';
      history[0].type = randomType;
      localStorage.setItem('contentGuardianHistory', JSON.stringify(history));
    } else if (Math.random() < 0.3 && historyEntry.status === 'blocked') {
      // 30% of blocked sites get supervised for demo
      const history = JSON.parse(localStorage.getItem('contentGuardianHistory'));
      history[0].status = 'supervised';
      localStorage.setItem('contentGuardianHistory', JSON.stringify(history));
    }
  }
  
  // Set up block page handler
  setupBlockPage() {
    // Check if we're inside an iframe
    if (window.self !== window.top) {
      // We're in an iframe, might be the block page
      if (window.location.pathname.includes('blocked-content.html')) {
        // This is our block page iframe
        console.log('Block page loaded in iframe');
      }
    }
    
    // Add block page creation method
    window.createBlockPageOverlay = (contentType) => {
      // If in supervised mode, don't show block page
      if (window.supervised_mode) {
        console.log('Content would be blocked, but supervised mode is active');
        return null;
      }
      
      // Create overlay for blocked content
      const overlayDiv = document.createElement('div');
      overlayDiv.style.position = 'fixed';
      overlayDiv.style.top = '0';
      overlayDiv.style.left = '0';
      overlayDiv.style.width = '100%';
      overlayDiv.style.height = '100%';
      overlayDiv.style.backgroundColor = 'black';
      overlayDiv.style.color = 'white';
      overlayDiv.style.textAlign = 'center';
      overlayDiv.style.padding = '50px';
      overlayDiv.style.zIndex = '9999';
      overlayDiv.style.display = 'flex';
      overlayDiv.style.flexDirection = 'column';
      overlayDiv.style.alignItems = 'center';
      overlayDiv.style.justifyContent = 'center';
      
      // Add content
      const iconDiv = document.createElement('div');
      iconDiv.textContent = '⚠️';
      iconDiv.style.fontSize = '5rem';
      iconDiv.style.color = '#ffc107';
      iconDiv.style.marginBottom = '1rem';
      
      const titleDiv = document.createElement('h1');
      titleDiv.textContent = 'Content Blocked';
      titleDiv.style.marginBottom = '1rem';
      
      const descDiv = document.createElement('p');
      descDiv.textContent = `This page has been blocked because it contains potential ${contentType || 'harmful'} content.`;
      descDiv.style.fontSize = '1.2rem';
      descDiv.style.marginBottom = '2rem';
      
      // Check if user is logged in
      const isLoggedIn = localStorage.getItem('contentGuardianAuth') !== null;
      
      if (isLoggedIn) {
        // Show supervised mode button instead of verification code
        const supervisedModeBtn = document.createElement('button');
        supervisedModeBtn.textContent = 'Enter Supervised Mode';
        supervisedModeBtn.style.backgroundColor = '#3cba54';
        supervisedModeBtn.style.color = 'white';
        supervisedModeBtn.style.border = 'none';
        supervisedModeBtn.style.padding = '10px 20px';
        supervisedModeBtn.style.borderRadius = '5px';
        supervisedModeBtn.style.cursor = 'pointer';
        supervisedModeBtn.style.marginTop = '20px';
        
        supervisedModeBtn.addEventListener('click', () => {
          // Enable supervised mode
          window.supervised_mode = true;
          localStorage.setItem('contentGuardianSupervision', 'active');
          
          // Create supervision data
          const authData = JSON.parse(localStorage.getItem('contentGuardianAuth') || '{}');
          const userInfo = authData.userInfo || {};
          
          const supervisionData = {
            active: true,
            startTime: new Date().toISOString(),
            expiryTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours by default
            supervisor: userInfo.role === 'guardian' ? userInfo.email : 'System',
            supervisedUser: userInfo.role === 'user' ? userInfo.email : null
          };
          
          localStorage.setItem('contentGuardianSupervisionData', JSON.stringify(supervisionData));
          
          // Remove the overlay
          overlayDiv.remove();
          
          // Update the supervised mode indicator
          this.updateSupervisedModeIndicator();
          
          // Reload the page to show the previously blocked content
          window.location.reload();
        });
        
        // Add supervised mode button
        overlayDiv.appendChild(supervisedModeBtn);
      } else {
        // If not logged in, show sign in message
        const signInText = document.createElement('p');
        signInText.innerHTML = 'You need to <span style="color: #8ff; text-decoration: underline; cursor: pointer;">sign in</span> to continue.';
        signInText.querySelector('span').addEventListener('click', () => {
          window.location.href = 'index.html';
        });
        
        overlayDiv.appendChild(signInText);
      }
      
      // Add all elements to the overlay
      overlayDiv.appendChild(iconDiv);
      overlayDiv.appendChild(titleDiv);
      overlayDiv.appendChild(descDiv);
      
      // Add to document
      document.body.appendChild(overlayDiv);
      
      return overlayDiv;
    };
  }
  
  // Simulate browsing history if needed
  simulateBrowsingIfNeeded() {
    const history = JSON.parse(localStorage.getItem('contentGuardianHistory') || '[]');
    
    if (history.length < 5) {
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
      localStorage.setItem('contentGuardianHistory', JSON.stringify(simulatedHistory));
    }
  }
  
  // Get browsing history
  getHistory() {
    return JSON.parse(localStorage.getItem('contentGuardianHistory') || '[]');
  }
  
  // Clear browsing history
  clearHistory() {
    localStorage.setItem('contentGuardianHistory', JSON.stringify([]));
  }
}

// Create a global instance
window.webHistoryTracker = new WebHistoryTracker(); 