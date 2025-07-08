from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import httpx
import os
import sqlite3
import json
from typing import List, Optional
import logging
from datetime import datetime
import hashlib

# Import our analyzers
from text_analyzer import TextContentAnalyzer
from image_analyzer import ImageContentAnalyzer

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Content Guardian API", 
              description="API for analyzing web content for harmful material")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your extension's origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize SQLite
def init_db():
    conn = sqlite3.connect('content_guardian.db')
    cursor = conn.cursor()
    
    # Create tables if they don't exist
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('guardian', 'user')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        verified_email INTEGER NOT NULL DEFAULT 0,
        gmail_account TEXT,
        verification_token TEXT
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS guardian_user_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guardian_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(guardian_id, user_id),
        FOREIGN KEY (guardian_id) REFERENCES users(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS extension_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        installed INTEGER NOT NULL DEFAULT 0,
        installed_at TIMESTAMP,
        uninstalled_at TIMESTAMP,
        version TEXT,
        last_heartbeat TIMESTAMP,
        device_email TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        device_name TEXT,
        device_id TEXT,
        UNIQUE(user_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        guardian_id INTEGER NOT NULL,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        content TEXT,
        url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
        device_email TEXT,
        device_verified INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (guardian_id) REFERENCES users(id)
    )
    ''')
    
    # Add some test data if the tables are empty
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        # Add test users
        cursor.execute('''
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES 
        ('user1@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User One', 'user'),
        ('user2@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User Two', 'user'),
        ('user3@gmail.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User Three', 'user'),
        ('guardian1@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Guardian One', 'guardian'),
        ('guardian2@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Guardian Two', 'guardian')
        ''')
        
        # Add guardian-user links
        cursor.execute('''
        INSERT INTO guardian_user_links (guardian_id, user_id)
        VALUES 
        (4, 1),
        (4, 2),
        (5, 3)
        ''')
    
    conn.commit()
    conn.close()
    logger.info("Database initialized")

# Models for request data
class TextAnalysisRequest(BaseModel):
    text: str

class ImageAnalysisRequest(BaseModel):
    url: str

class VideoAnalysisRequest(BaseModel):
    url: str

class EmailVerificationRequest(BaseModel):
    user_id: int
    email: str

class ExtensionStatusRequest(BaseModel):
    user_id: int
    browser_info: str
    version: str
    device_email: Optional[str] = None

class AlertRequest(BaseModel):
    user_id: int
    alert_type: str
    severity: str
    content: str
    url: str
    device_email: Optional[str] = None
    email_verified: Optional[bool] = False

class UserRegistrationRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: str
    phone_number: Optional[str] = None
    age: Optional[int] = None

# Initialize analyzers
text_analyzer = TextContentAnalyzer()
image_analyzer = ImageContentAnalyzer()

# API endpoints
@app.get("/")
def read_root():
    return {"status": "Content Guardian API is running"}

# User registration endpoint
@app.post("/api/register")
async def register_user(request: UserRegistrationRequest):
    try:
        # Validate data
        if not request.full_name or not request.email or not request.password or not request.role:
            raise HTTPException(status_code=400, detail="Missing required fields")
        
        if request.role not in ['user', 'guardian']:
            raise HTTPException(status_code=400, detail="Invalid role. Must be 'user' or 'guardian'")
        
        # Validate role-specific fields
        if request.role == 'guardian' and not request.phone_number:
            logger.warning("Guardian registering without phone number")
        
        if request.role == 'user' and not request.age:
            logger.warning("User registering without age")
        
        # Connect to database
        conn = sqlite3.connect('content_guardian.db')
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute("SELECT id FROM users WHERE email = ?", (request.email,))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Hash password (simple hash for demo - use proper password hashing in production)
        password_hash = hashlib.sha256(request.password.encode()).hexdigest()
        
        # Insert the new user
        cursor.execute("""
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES (?, ?, ?, ?)
        """, (request.email, password_hash, request.full_name, request.role))
        
        user_id = cursor.lastrowid
        
        # Store additional role-specific information
        if request.role == 'guardian' and request.phone_number:
            # In a real app, you'd store this in a guardian_profiles table
            logger.info(f"Guardian phone: {request.phone_number}")
        
        if request.role == 'user' and request.age:
            # In a real app, you'd store this in a user_profiles table
            logger.info(f"User age: {request.age}")
        
        conn.commit()
        conn.close()
        
        logger.info(f"Successfully registered new {request.role}: {request.email}")
        
        return {
            "success": True,
            "user_id": user_id,
            "message": f"Successfully registered as {request.role}"
        }
    
    except HTTPException as e:
        # Re-raise HTTP exceptions
        raise
    
    except Exception as e:
        logger.error(f"Error during registration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@app.post("/analyze/text")
async def analyze_text(request: TextAnalysisRequest):
    try:
        if not request.text or len(request.text) < 10:
            return {"harmful": False, "message": "Text too short to analyze"}
        
        # Simple keyword-based analysis for demo
        harmful_words = ["hate", "violence", "kill", "porn", "xxx", "nsfw"]
        text_lower = request.text.lower()
        
        for word in harmful_words:
            if word in text_lower:
                return {"harmful": True, "type": word, "message": f"Harmful content detected: {word}"}
        
        return {"harmful": False, "message": "No harmful content detected"}
    except Exception as e:
        logger.error(f"Error analyzing text: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error analyzing text: {str(e)}")

@app.post("/analyze/image")
async def analyze_image(request: ImageAnalysisRequest):
    try:
        if not request.url or not request.url.startswith(("http://", "https://")):
            return {"harmful": False, "message": "Invalid image URL"}
        
        # Mock image analysis for demo
        # In a real app, you would use AI/ML for content analysis
        return {"harmful": False, "message": "No harmful content detected in image"}
    except Exception as e:
        logger.error(f"Error analyzing image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error analyzing image: {str(e)}")

@app.post("/analyze/video")
async def analyze_video(request: VideoAnalysisRequest):
    # Video analysis would be similar to image analysis but with frame extraction
    # This is a simplified mock version
    return {"harmful": False, "message": "Video analysis not implemented in this demo"}

@app.post("/api/verify-email")
async def verify_email(request: EmailVerificationRequest):
    """
    Verify if the provided email matches the user's registered email or is approved by guardian
    """
    try:
        logger.info(f"Verifying email for user_id {request.user_id}: {request.email}")
        
        # Check if the email matches the user's registered email
        user_email = get_user_email(request.user_id)
        if user_email and user_email.lower() == request.email.lower():
            # Direct match with user's registered email
            update_user_verified_email(request.user_id, request.email)
            return {"verified": True, "message": "Email matches user's registered email"}
        
        # Check if email is approved by guardian
        guardian_id = get_guardian_for_user(request.user_id)
        if guardian_id:
            approved_emails = get_approved_emails_for_user(request.user_id, guardian_id)
            if request.email.lower() in [email.lower() for email in approved_emails]:
                update_user_verified_email(request.user_id, request.email)
                return {"verified": True, "message": "Email is approved by guardian"}
        
        # Not verified
        return {"verified": False, "message": "Email does not match any authorized accounts"}
    
    except Exception as e:
        logger.error(f"Error verifying email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error verifying email: {str(e)}")

@app.post("/api/extension/status")
async def update_extension_status(request: ExtensionStatusRequest):
    """
    Update extension installation status and track device email
    """
    try:
        logger.info(f"Updating extension status for user_id {request.user_id}")
        
        # Check if email is verified
        email_verified = False
        if request.device_email:
            email_verified = check_email_verified(request.user_id, request.device_email)
            
        logger.info(f"Extension installed for user {request.user_id} with email {request.device_email} (verified: {email_verified})")
        
        # Send notification to guardian if email is not verified
        if not email_verified and request.device_email:
            guardian_id = get_guardian_for_user(request.user_id)
            if guardian_id:
                send_unverified_device_alert(request.user_id, guardian_id, request.device_email)
        
        # Update the extension status in the database
        conn = sqlite3.connect('content_guardian.db')
        cursor = conn.cursor()
        
        # Check if record exists
        cursor.execute("SELECT id FROM extension_status WHERE user_id = ?", (request.user_id,))
        record = cursor.fetchone()
        
        now = datetime.now().isoformat()
        
        if record:
            # Update existing record
            cursor.execute('''
            UPDATE extension_status SET 
            installed = 1,
            last_heartbeat = ?,
            version = ?,
            device_email = ?,
            email_verified = ?
            WHERE user_id = ?
            ''', (now, request.version, request.device_email or '', 1 if email_verified else 0, request.user_id))
        else:
            # Insert new record
            cursor.execute('''
            INSERT INTO extension_status (
                user_id, installed, installed_at, version, last_heartbeat, 
                device_email, email_verified
            ) VALUES (?, 1, ?, ?, ?, ?, ?)
            ''', (request.user_id, now, request.version, now, request.device_email or '', 1 if email_verified else 0))
        
        conn.commit()
        conn.close()
        
        return {"status": "updated", "email_verified": email_verified}
    
    except Exception as e:
        logger.error(f"Error updating extension status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating extension status: {str(e)}")

@app.post("/api/alerts")
async def create_alert(request: AlertRequest):
    """
    Create an alert that will be forwarded to the guardian
    """
    try:
        logger.info(f"Creating alert for user_id {request.user_id}: {request.alert_type} ({request.severity})")
        
        # Get guardian ID for this user
        guardian_id = get_guardian_for_user(request.user_id)
        if not guardian_id:
            logger.warning(f"No guardian found for user_id {request.user_id}")
            return {"status": "error", "message": "No guardian found for user"}
        
        # Save alert to database
        conn = sqlite3.connect('content_guardian.db')
        cursor = conn.cursor()
        
        now = datetime.now().isoformat()
        
        cursor.execute('''
        INSERT INTO alerts (
            user_id, guardian_id, alert_type, severity, content, url,
            created_at, device_email, device_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            request.user_id, guardian_id, request.alert_type, request.severity,
            request.content, request.url, now, 
            request.device_email or '', 1 if request.email_verified else 0
        ))
        
        alert_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        # In a real app, you would send notifications through WebSocket/push/email here
        
        return {"status": "created", "alert_id": alert_id}
    
    except Exception as e:
        logger.error(f"Error creating alert: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating alert: {str(e)}")

@app.get("/api/guardian/logs")
async def get_guardian_logs():
    """Get all content logs (for demo)"""
    try:
        conn = sqlite3.connect('content_guardian.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
        SELECT * FROM alerts ORDER BY created_at DESC LIMIT 20
        ''')
        
        rows = cursor.fetchall()
        logs = [dict(row) for row in rows]
        conn.close()
        
        return logs
    except Exception as e:
        logger.error(f"Error getting logs: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting logs: {str(e)}")

# Database helper functions
def get_user_email(user_id):
    conn = sqlite3.connect('content_guardian.db')
    cursor = conn.cursor()
    cursor.execute("SELECT email FROM users WHERE id = ?", (user_id,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

def get_guardian_for_user(user_id):
    conn = sqlite3.connect('content_guardian.db')
    cursor = conn.cursor()
    cursor.execute("""
    SELECT guardian_id FROM guardian_user_links 
    WHERE user_id = ? AND active = 1
    """, (user_id,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

def get_approved_emails_for_user(user_id, guardian_id):
    # In a real implementation, this would query database
    # For this demo, we'll use mock data for simplicity
    mock_approved = {
        (1, 4): ["user1@gmail.com", "user1_school@gmail.com"],
        (2, 4): ["user2@gmail.com"],
        (3, 5): ["user3@gmail.com", "family_shared@gmail.com"]
    }
    return mock_approved.get((user_id, guardian_id), [])

def update_user_verified_email(user_id, email):
    conn = sqlite3.connect('content_guardian.db')
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE users SET verified_email = 1, gmail_account = ? 
    WHERE id = ?
    """, (email, user_id))
    conn.commit()
    conn.close()
    logger.info(f"Updated verified email for user {user_id}: {email}")
    return True

def check_email_verified(user_id, email):
    # Get user's registered email
    user_email = get_user_email(user_id)
    if user_email and user_email.lower() == email.lower():
        return True
    
    # Check guardian-approved emails
    guardian_id = get_guardian_for_user(user_id)
    if guardian_id:
        approved_emails = get_approved_emails_for_user(user_id, guardian_id)
        if email.lower() in [approved.lower() for approved in approved_emails]:
            return True
    
    return False

def send_unverified_device_alert(user_id, guardian_id, email):
    """Create an alert for unverified device usage"""
    try:
        conn = sqlite3.connect('content_guardian.db')
        cursor = conn.cursor()
        
        now = datetime.now().isoformat()
        
        cursor.execute('''
        INSERT INTO alerts (
            user_id, guardian_id, alert_type, severity, content, 
            created_at, device_email, device_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ''', (
            user_id, guardian_id, 'unverified_device', 'high',
            f"Unverified device with email {email} detected", 
            now, email
        ))
        
        conn.commit()
        conn.close()
        
        logger.warning(f"ALERT: Unverified device with email {email} for user {user_id}. Notifying guardian {guardian_id}")
        return True
    except Exception as e:
        logger.error(f"Error creating unverified device alert: {str(e)}")
        return False

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()

# Run the app with uvicorn
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True) 