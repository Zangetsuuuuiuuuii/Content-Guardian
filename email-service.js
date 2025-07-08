const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Load Gmail API credentials
const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'gmail-config.json')));

// Configure OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  credentials.web.client_id,
  credentials.web.client_secret,
  credentials.web.redirect_uris[0]
);

// Store token information
let tokenInfo = null;

/**
 * Get Gmail authorization URL
 * @param {string} redirectUri - OAuth redirect URI (must match one in the Google Cloud Console)
 * @returns {string} Authorization URL
 */
function getAuthUrl(redirectUri) {
  // If redirectUri is provided, use it, otherwise use the first one from credentials
  const actualRedirectUri = redirectUri || credentials.web.redirect_uris[0];
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    redirect_uri: actualRedirectUri
  });
}

/**
 * Get OAuth2 tokens from authorization code
 * @param {string} code - Authorization code
 * @param {string} redirectUri - OAuth redirect URI (must match the one used in getAuthUrl)
 * @returns {Promise<Object>} Token information
 */
async function getTokensFromCode(code, redirectUri) {
  try {
    // If redirectUri is provided, use it, otherwise use the first one from credentials
    const actualRedirectUri = redirectUri || credentials.web.redirect_uris[0];
    
    // Set the redirect URI for the token exchange
    oauth2Client.redirectUri = actualRedirectUri;
    
    const { tokens } = await oauth2Client.getToken(code);
    tokenInfo = tokens;
    oauth2Client.setCredentials(tokens);
    
    // Save tokens to a file for persistence
    fs.writeFileSync(path.join(__dirname, 'token.json'), JSON.stringify(tokens));
    
    return tokens;
  } catch (error) {
    console.error('Error getting tokens:', error);
    throw error;
  }
}

/**
 * Load stored tokens if available
 */
function loadStoredTokens() {
  try {
    const tokenPath = path.join(__dirname, 'token.json');
    if (fs.existsSync(tokenPath)) {
      tokenInfo = JSON.parse(fs.readFileSync(tokenPath));
      oauth2Client.setCredentials(tokenInfo);
      return true;
    }
  } catch (error) {
    console.error('Error loading stored tokens:', error);
  }
  return false;
}

/**
 * Send verification email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.code - Verification code
 * @param {string} options.contentTitle - Content title being verified
 * @param {string} options.senderEmail - The Gmail address of the sender (must match authorized account)
 * @returns {Promise<boolean>} Success status
 */
async function sendVerificationEmail({ to, subject, code, contentTitle, senderEmail }) {
  try {
    // Make sure we have valid tokens
    if (!tokenInfo) {
      if (!loadStoredTokens()) {
        throw new Error('No authentication tokens available. Please authenticate first.');
      }
    }

    // Ensure we have a sender email
    if (!senderEmail) {
      throw new Error('Sender email is required');
    }

    // Create a transporter with OAuth2
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: senderEmail, // Use the provided sender email
        clientId: credentials.web.client_id,
        clientSecret: credentials.web.client_secret,
        refreshToken: tokenInfo.refresh_token,
        accessToken: tokenInfo.access_token,
        expires: tokenInfo.expiry_date
      }
    });

    // HTML content for the email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #20639B; margin-bottom: 5px;">Content Guardian</h1>
          <p style="color: #666;">Verification Code for Supervised Access</p>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p>You have requested supervised access to view blocked content:</p>
          <p style="font-weight: bold;">${contentTitle || 'Restricted Content'}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <p style="margin-bottom: 10px; color: #666;">Your verification code is:</p>
          <div style="font-family: monospace; font-size: 24px; letter-spacing: 5px; background-color: #f0f0f0; padding: 15px; border-radius: 5px; display: inline-block;">
            ${code}
          </div>
        </div>
        
        <div style="color: #666; font-size: 14px; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
          <p>This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
          <p>This is an automated message, please do not reply.</p>
        </div>
      </div>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: `"Content Guardian" <${senderEmail}>`, // Use the provided sender email
      to,
      subject: subject || 'Verification Code for Supervised Access',
      html: htmlContent
    });

    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Handle token expiration
    if (error.message.includes('invalid_grant') && tokenInfo.refresh_token) {
      console.log('Attempting to refresh token...');
      try {
        const { credentials } = await oauth2Client.refreshToken(tokenInfo.refresh_token);
        tokenInfo = credentials;
        // Save updated tokens
        fs.writeFileSync(path.join(__dirname, 'token.json'), JSON.stringify(tokenInfo));
        // Try sending again with new token
        return sendVerificationEmail({ to, subject, code, contentTitle, senderEmail });
      } catch (refreshError) {
        console.error('Error refreshing token:', refreshError);
      }
    }
    
    throw error;
  }
}

module.exports = {
  getAuthUrl,
  getTokensFromCode,
  sendVerificationEmail,
  loadStoredTokens
}; 