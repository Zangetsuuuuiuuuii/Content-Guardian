// This script gets added to content.js
// Logs blocked sites to a text file using localStorage

// Log a blocked site
function logBlockedSite(url, blockType) {
  // Get existing logs
  let blockedSites = localStorage.getItem('contentGuardianBlockedSites');
  blockedSites = blockedSites ? JSON.parse(blockedSites) : [];
  
  // Add new entry
  const now = new Date();
  const timestamp = now.toLocaleString();
  
  blockedSites.push({
    url: url,
    type: blockType,
    timestamp: timestamp
  });
  
  // Keep only the latest 50 entries
  if (blockedSites.length > 50) {
    blockedSites = blockedSites.slice(-50);
  }
  
  // Save back to localStorage
  localStorage.setItem('contentGuardianBlockedSites', JSON.stringify(blockedSites));
} 