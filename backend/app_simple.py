from fastapi import FastAPI, HTTPException, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import uvicorn
import os
import json
import logging
from datetime import datetime, timedelta
import hashlib
import secrets

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Content Guardian Simple API", 
              description="Simplified API for handling web content analysis")

# Add CORS middleware to allow cross-origin requests (important for frontend connection)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend's origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OAuth2 password bearer for token authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token")

# Models for request data
class UserRegistrationRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: str
    phone_number: str = None
    age: int = None

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str

# Simple in-memory storage for demo
users_db = []
tokens_db = {}  # Store active tokens

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
        
        # Check if email already exists
        if any(user['email'] == request.email for user in users_db):
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Hash password
        password_hash = hashlib.sha256(request.password.encode()).hexdigest()
        
        # Create user record
        user_id = len(users_db) + 1
        user_data = {
            'id': user_id,
            'email': request.email,
            'password_hash': password_hash,
            'full_name': request.full_name,
            'role': request.role,
            'created_at': datetime.now().isoformat()
        }
        
        # Add role-specific data
        if request.role == 'guardian' and request.phone_number:
            user_data['phone_number'] = request.phone_number
        
        if request.role == 'user' and request.age:
            user_data['age'] = request.age
        
        # Store user
        users_db.append(user_data)
        
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

# Login endpoint
@app.post("/api/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = None
    
    # Find user by email (username in OAuth2 form)
    for u in users_db:
        if u['email'] == form_data.username:
            user = u
            break
    
    # Verify password
    if not user or hashlib.sha256(form_data.password.encode()).hexdigest() != user['password_hash']:
        logger.warning(f"Failed login attempt for {form_data.username}")
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Generate tokens
    access_token = secrets.token_hex(32)
    refresh_token = secrets.token_hex(32)
    
    # Store token info
    tokens_db[access_token] = {
        "user_id": user['id'],
        "expires": datetime.now() + timedelta(minutes=30)
    }
    
    logger.info(f"User logged in: {form_data.username}")
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }

# Get current user info
@app.get("/api/users/me")
async def get_current_user(token: str = Depends(oauth2_scheme)):
    if token not in tokens_db or tokens_db[token]["expires"] < datetime.now():
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = tokens_db[token]["user_id"]
    user = next((u for u in users_db if u['id'] == user_id), None)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Return user info without sensitive data
    return {
        "id": user['id'],
        "email": user['email'],
        "full_name": user['full_name'],
        "role": user['role']
    }

# Analyze text endpoint
@app.post("/analyze")
async def analyze_content(request: dict):
    """
    Analyze content for harmful material
    """
    try:
        content_type = request.get('type', 'text')
        content = request.get('content', '')
        
        logger.info(f"Analyzing {content_type} content")
        
        # Simple analysis for demo
        harmful_words = ["porn", "sex", "explicit", "hate", "violence", "kill", "xxx", "nsfw"]
        
        if content_type == 'text' and content:
            content_lower = content.lower()
            for word in harmful_words:
                if word in content_lower:
                    return {"harmful": True, "type": word, "confidence": 0.95}
        
        # If no harmful content found
        return {"harmful": False, "confidence": 0.9}
    
    except Exception as e:
        logger.error(f"Error analyzing content: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error analyzing content: {str(e)}")

# Run the app
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app_simple:app", host="0.0.0.0", port=port, reload=True) 