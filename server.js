const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const emailService = require('./email-service');

const app = express();
const port = 8080;

// Add a catch-all route for debugging
app.use((req, res, next) => {
  console.log(`Request received for: ${req.url}`);
  next();
});

// Middleware for JSON parsing
app.use(bodyParser.json());

// Serve static files from the web-portal directory
app.use(express.static(path.join(__dirname, 'web-portal')));

// Serve static files from the web-portal directory under /web-portal path as well
app.use('/web-portal', express.static(path.join(__dirname, 'web-portal')));

// Serve static assets from the js folder
app.use('/js', express.static(path.join(__dirname, 'web-portal/js')));
app.use('/web-portal/js', express.static(path.join(__dirname, 'web-portal/js')));

// Explicit routes for each HTML file
app.get('/guardian-dashboard.html', (req, res) => {
  console.log('Guardian dashboard requested directly');
  res.sendFile(path.join(__dirname, 'web-portal', 'guardian-dashboard.html'));
});

app.get('/web-portal/guardian-dashboard.html', (req, res) => {
  console.log('Guardian dashboard requested with /web-portal prefix');
  res.sendFile(path.join(__dirname, 'web-portal', 'guardian-dashboard.html'));
});

// Special test route
app.get('/test-dashboard', (req, res) => {
  console.log('Test dashboard route accessed');
  res.send(`
    <html>
      <head>
        <title>Guardian Dashboard - Test</title>
      </head>
      <body>
        <h1>Guardian Dashboard Test</h1>
        <p>This is a direct response from the server without reading a file.</p>
      </body>
    </html>
  `);
});

// Redirect root to index.html
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Gmail OAuth routes
app.get('/auth/gmail', (req, res) => {
  // Explicitly set the redirect URI to match what's in the Google Cloud Console
  const credentials = require('./gmail-config.json');
  const redirectUri = credentials.web.redirect_uris[0]; // Use the first redirect URI from the config
  
  // Generate the auth URL with the specific redirect URI
  const authUrl = emailService.getAuthUrl(redirectUri);
  
  console.log(`Redirecting to Google OAuth with redirect URI: ${redirectUri}`);
  res.redirect(authUrl);
});

// We need to create a route that matches the redirect URI in the Google Cloud Console
// This route will receive the OAuth code
app.get('/oauth2callback', async (req, res) => {
  try {
    console.log("OAuth callback received");
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Authorization code is missing');
    }
    
    // Get tokens from the authorization code
    const tokens = await emailService.getTokensFromCode(code);
    console.log("OAuth tokens obtained:", tokens ? "success" : "failed");
    
    // Redirect to our success page
    res.redirect('/auth/success');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`Authorization failed: ${error.message}`);
  }
});

// Success page after authorization
app.get('/auth/success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Gmail Authorization Successful</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
          .message { margin-bottom: 30px; }
          .note { 
            background-color: #fff3cd; 
            color: #856404; 
            padding: 15px; 
            border-radius: 5px; 
            margin: 20px 0;
            text-align: left;
          }
          .btn { 
            background-color: #20639B; 
            color: white; 
            padding: 10px 20px; 
            text-decoration: none; 
            border-radius: 5px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <h1 class="success">Gmail Authorization Successful!</h1>
        <p class="message">You can now send verification emails through the Content Guardian system.</p>
        
        <div class="note">
          <p><strong>Important:</strong> The Gmail account you just authorized will be used to send verification emails. 
          When you request supervised access to blocked content, a verification code will be sent from this email address.</p>
          <p>Make sure to use an email address that you have access to and can receive emails on, as this will be used for the verification process.</p>
        </div>
        
        <a href="/dashboard.html" class="btn">Return to Dashboard</a>
      </body>
    </html>
  `);
});

// Test email endpoint (for debugging)
app.get('/api/test-email', async (req, res) => {
  try {
    console.log("Test email endpoint called");
    const testEmail = req.query.email;
    
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email parameter is required'
      });
    }
    
    console.log(`Testing email sending to: ${testEmail}`);
    
    // Check if Gmail is authorized
    const isAuthorized = emailService.loadStoredTokens();
    console.log(`Gmail authorized: ${isAuthorized}`);
    
    if (!isAuthorized) {
      return res.json({
        success: false,
        message: 'Gmail not authorized yet. Please authorize Gmail first.'
      });
    }
    
    // Generate a test verification code
    const testCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Send a test email
    console.log(`Attempting to send email to ${testEmail} with code ${testCode}`);
    
    // Debug token info
    console.log('Current token info:', tokenInfo ? 'Available' : 'Not available');
    
    const result = await emailService.sendVerificationEmail({
      to: testEmail,
      subject: 'Content Guardian: Test Verification Email',
      code: testCode,
      contentTitle: 'Test Content',
      senderEmail: testEmail // Use the same email as sender and recipient for testing
    });
    
    console.log(`Email sending result: ${result ? 'Success' : 'Failed'}`);
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      code: testCode,
      email: testEmail
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send test email'
    });
  }
});

// API endpoints for the dashboard
app.get('/api/blocked-content', (req, res) => {
  // Demo data for blocked content
  const blockedContent = [
    {
      id: 1,
      url: 'https://example.com/violent-content',
      title: 'Example of Violent Content',
      type: 'Violence',
      blocked_at: new Date(Date.now() - 25 * 60000).toISOString(),
      is_new: true
    },
    {
      id: 2,
      url: 'https://example.com/adult-content',
      title: 'Restricted Adult Content',
      type: 'Adult',
      blocked_at: new Date(Date.now() - 120 * 60000).toISOString(),
      is_new: false
    },
    {
      id: 3,
      url: 'https://example.com/gambling',
      title: 'Online Gambling Site',
      type: 'Gambling',
      blocked_at: new Date(Date.now() - 240 * 60000).toISOString(),
      is_new: false
    }
  ];
  
  res.json(blockedContent);
});

app.get('/api/user-profile', (req, res) => {
  // Demo data for user profile
  res.json({
    full_name: 'Demo User',
    email: 'user@example.com',
    verification_emails: ['alerts@example.com', 'backup@example.com']
  });
});

app.post('/api/request-supervision', async (req, res) => {
  try {
    const { content_id } = req.body;
    
    // Get content information for the email (in a real app, you'd fetch this from a database)
    const contentTitles = {
      1: 'Example of Violent Content',
      2: 'Restricted Adult Content',
      3: 'Online Gambling Site'
    };
    
    // Generate a verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Get user information from auth token (or from request for demo)
    // In a real app, this would come from session data or JWT token
    const userData = req.body.userData || {
      email: 'user@example.com',
      verification_emails: ['alerts@example.com', 'backup@example.com']
    };
    
    // The primary email will be used as the sender (this must be the Gmail account that was authorized)
    const senderEmail = userData.email;
    
    // Recipients for verification codes (including self)
    const verificationEmails = userData.verification_emails || [userData.email];
    
    // Check if Gmail is authorized
    let isAuthorized = false;
    try {
      isAuthorized = emailService.loadStoredTokens();
    } catch (authError) {
      console.error('Error checking Gmail authorization:', authError);
    }
    
    // If Gmail is authorized, send verification emails
    let emailResults = [];
    if (isAuthorized) {
      try {
        for (const email of verificationEmails) {
          const result = await emailService.sendVerificationEmail({
            to: email,
            subject: 'Content Guardian: Verification Code for Supervised Access',
            code: verificationCode,
            contentTitle: contentTitles[content_id] || 'Restricted Content',
            senderEmail: senderEmail
          });
          emailResults.push({ email, success: !!result });
        }
      } catch (emailError) {
        console.error('Error sending verification emails:', emailError);
        emailResults = verificationEmails.map(email => ({ email, success: false }));
      }
    }
    
    res.json({
      success: true,
      code: verificationCode,
      emails: verificationEmails,
      is_gmail_authorized: isAuthorized,
      email_results: emailResults
    });
  } catch (error) {
    console.error('Error processing supervision request:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process supervision request'
    });
  }
});

app.post('/api/save-settings', (req, res) => {
  // Demo response for saving settings
  res.json({
    success: true
  });
});

// Gmail authorization status endpoint
app.get('/api/gmail-status', (req, res) => {
  try {
    const isAuthorized = emailService.loadStoredTokens();
    res.json({
      is_authorized: isAuthorized
    });
  } catch (error) {
    res.status(500).json({
      is_authorized: false,
      error: error.message
    });
  }
});

// Handle 404 errors by serving index.html
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'web-portal', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  console.log(`Web portal available at:`);
  console.log(`- http://localhost:${port}/index.html (Login page)`);
  console.log(`- http://localhost:${port}/register.html (Registration page)`);
  console.log(`- http://localhost:${port}/dashboard.html (Dashboard)`);
  console.log(`Gmail authorization URL: http://localhost:${port}/auth/gmail`);
}); 