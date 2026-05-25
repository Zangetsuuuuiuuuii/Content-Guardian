"""
Content Guardian — Unified FastAPI Backend
==========================================
Single backend server on port 8000 providing:
  - Content analysis (text + image) for the Chrome extension
  - User authentication (JWT) and registration
  - Guardian dashboard API (users, alerts, sessions, access keys)
  - WebSocket real-time events for extension ↔ dashboard sync
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import uvicorn
import os
import sqlite3
import json
import base64
import io
import hashlib
import secrets
import logging
import aiohttp
import asyncio
import ipaddress
import urllib.parse
import socket
from typing import List, Optional, Dict, Set
from datetime import datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

# Import our analyzers
from text_analyzer import TextContentAnalyzer
from image_analyzer import ImageContentAnalyzer

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Database path (project root)
# ---------------------------------------------------------------------------
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content_guardian.db")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def get_db():
    """Get a database connection with row_factory set."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initialise the SQLite database with all required tables."""
    conn = get_db()
    cursor = conn.cursor()

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

    # NEW: Access keys table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS access_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_value TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER,
        description TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
    )
    ''')

    # NEW: Supervision sessions table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS supervision_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guardian_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired')),
        FOREIGN KEY (guardian_id) REFERENCES users(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')

    # Seed test data if tables are empty
    cursor.execute("SELECT COUNT(*) as cnt FROM users")
    if cursor.fetchone()["cnt"] == 0:
        cursor.execute('''
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES
        ('user1@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User One', 'user'),
        ('user2@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User Two', 'user'),
        ('user3@gmail.com',   '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'User Three', 'user'),
        ('guardian1@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Guardian One', 'guardian'),
        ('guardian2@example.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Guardian Two', 'guardian')
        ''')
        cursor.execute('''
        INSERT INTO guardian_user_links (guardian_id, user_id)
        VALUES (4, 1), (4, 2), (5, 3)
        ''')

    conn.commit()
    conn.close()
    logger.info("Database initialized at %s", DB_PATH)


# ---------------------------------------------------------------------------
# WebSocket Connection Manager
# ---------------------------------------------------------------------------
class ConnectionManager:
    """Manages WebSocket connections for real-time event delivery."""

    def __init__(self):
        # Maps user_id -> set of active WebSocket connections
        self.extension_connections: Dict[int, Set[WebSocket]] = {}
        self.guardian_connections: Dict[int, Set[WebSocket]] = {}

    async def connect_extension(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.extension_connections:
            self.extension_connections[user_id] = set()
        self.extension_connections[user_id].add(websocket)
        logger.info("Extension WebSocket connected for user %d", user_id)

    async def connect_guardian(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.guardian_connections:
            self.guardian_connections[user_id] = set()
        self.guardian_connections[user_id].add(websocket)
        logger.info("Guardian WebSocket connected for user %d", user_id)

    def disconnect_extension(self, user_id: int, websocket: WebSocket):
        if user_id in self.extension_connections:
            self.extension_connections[user_id].discard(websocket)
            if not self.extension_connections[user_id]:
                del self.extension_connections[user_id]

    def disconnect_guardian(self, user_id: int, websocket: WebSocket):
        if user_id in self.guardian_connections:
            self.guardian_connections[user_id].discard(websocket)
            if not self.guardian_connections[user_id]:
                del self.guardian_connections[user_id]

    async def send_to_extension(self, user_id: int, message: dict):
        if user_id in self.extension_connections:
            dead = []
            for ws in self.extension_connections[user_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.extension_connections[user_id].discard(ws)

    async def send_to_guardian(self, guardian_id: int, message: dict):
        if guardian_id in self.guardian_connections:
            dead = []
            for ws in self.guardian_connections[guardian_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.guardian_connections[guardian_id].discard(ws)


ws_manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Security / JWT
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("SECRET_KEY", "SUPER_SECRET_REPLACE_ME_IN_PRODUCTION")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Decode JWT and return the authenticated user dict."""
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    conn = get_db()
    user = conn.execute(
        "SELECT id, email, full_name, role FROM users WHERE email = ?", (email,)
    ).fetchone()
    conn.close()

    if user is None:
        raise credentials_exception
    return dict(user)


# ---------------------------------------------------------------------------
# SSRF-safe URL validation (from api.py)
# ---------------------------------------------------------------------------
def is_safe_url(url: str) -> bool:
    """Check that a URL doesn't point to a private/local IP (SSRF protection)."""
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)
        return not (ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------
class TextAnalysisRequest(BaseModel):
    text: str

class ImageAnalysisRequest(BaseModel):
    url: str

class VideoAnalysisRequest(BaseModel):
    url: str

class AnalysisRequest(BaseModel):
    """Unified analysis request (merged from api.py)."""
    url: str
    text: Optional[str] = None
    image_data: Optional[str] = None  # Base64 encoded image data

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

class EndSessionRequest(BaseModel):
    session_id: int

class GenerateKeyRequest(BaseModel):
    description: Optional[str] = None
    expires_in_days: Optional[int] = 30

class RevokeKeyRequest(BaseModel):
    key_id: int

class StartSessionRequest(BaseModel):
    user_id: int


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    logger.info("Content Guardian API starting up")
    yield
    # Shutdown
    logger.info("Content Guardian API shutting down")


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Content Guardian API",
    description="Unified API for content analysis, user management, and real-time supervision",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize ML analyzers
text_analyzer = TextContentAnalyzer()
image_analyzer = ImageContentAnalyzer()


# ===========================================================================
#  HEALTH CHECK
# ===========================================================================
@app.get("/")
def read_root():
    return {"status": "Content Guardian API is running", "version": "2.0.0"}


# ===========================================================================
#  AUTH ENDPOINTS
# ===========================================================================
@app.post("/api/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    conn = get_db()
    user = conn.execute(
        "SELECT id, email, password_hash, full_name, role FROM users WHERE email = ?",
        (form_data.username,),
    ).fetchone()
    conn.close()

    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        data={"sub": user["email"], "role": user["role"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user["id"],
        "role": user["role"],
        "full_name": user["full_name"],
    }


@app.post("/api/register")
async def register_user(request: UserRegistrationRequest):
    if not request.full_name or not request.email or not request.password or not request.role:
        raise HTTPException(status_code=400, detail="Missing required fields")
    if request.role not in ("user", "guardian"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'user' or 'guardian'")

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (request.email,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    password_hash = get_password_hash(request.password)
    cursor = conn.execute(
        "INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
        (request.email, password_hash, request.full_name, request.role),
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()

    logger.info("Registered new %s: %s", request.role, request.email)
    return {"success": True, "user_id": user_id, "message": f"Successfully registered as {request.role}"}


@app.get("/api/users/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    conn = get_db()
    user = conn.execute(
        "SELECT id, email, full_name, role, created_at, verified_email, gmail_account FROM users WHERE id = ?",
        (current_user["id"],),
    ).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(user)


# ===========================================================================
#  CONTENT ANALYSIS ENDPOINTS
# ===========================================================================
@app.post("/analyze/text")
async def analyze_text(request: TextAnalysisRequest):
    try:
        return text_analyzer.analyze(request.text)
    except Exception as e:
        logger.error("Error analyzing text: %s", e)
        raise HTTPException(status_code=500, detail=f"Error analyzing text: {e}")


@app.post("/analyze/image")
async def analyze_image(request: ImageAnalysisRequest):
    try:
        if not request.url or not request.url.startswith(("http://", "https://")):
            return {"harmful": False, "message": "Invalid image URL"}
        return await image_analyzer.analyze(url=request.url)
    except Exception as e:
        logger.error("Error analyzing image: %s", e)
        raise HTTPException(status_code=500, detail=f"Error analyzing image: {e}")


@app.post("/analyze")
async def analyze_content(request: AnalysisRequest):
    """
    Unified content analysis (merged from api.py).
    Accepts URL, optional text, and optional base64-encoded image data.
    """
    image_data = None

    # Decode base64 image data if provided
    if request.image_data:
        try:
            raw = request.image_data
            if "," in raw:
                raw = raw.split(",", 1)[1]
            image_data = base64.b64decode(raw)
        except Exception as e:
            return {"error": f"Invalid image data: {e}"}

    # Otherwise download image from URL
    elif request.url:
        if not is_safe_url(request.url):
            return {"error": "Invalid or blocked URL. Local/Private IPs are not permitted."}
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(request.url) as response:
                    if response.status == 200:
                        image_data = await response.read()
                    else:
                        return {"error": f"Failed to download image. Status: {response.status}"}
        except asyncio.TimeoutError:
            return {"error": "Image download timed out after 5 seconds."}
        except Exception as e:
            return {"error": f"Failed to download image: {e}"}

    # Run analysis
    try:
        return await image_analyzer.analyze(
            url=request.url,
            image_text=request.text,
            image_data=image_data,
        )
    except Exception as e:
        return {"error": f"Analysis failed: {e}"}


@app.post("/analyze/video")
async def analyze_video(request: VideoAnalysisRequest):
    return {"harmful": False, "message": "Video analysis not implemented in this version"}


# ===========================================================================
#  EMAIL VERIFICATION
# ===========================================================================
@app.post("/api/verify-email")
async def verify_email(request: EmailVerificationRequest):
    try:
        conn = get_db()
        user = conn.execute("SELECT email FROM users WHERE id = ?", (request.user_id,)).fetchone()
        if user and user["email"].lower() == request.email.lower():
            conn.execute(
                "UPDATE users SET verified_email = 1, gmail_account = ? WHERE id = ?",
                (request.email, request.user_id),
            )
            conn.commit()
            conn.close()
            return {"verified": True, "message": "Email matches user's registered email"}

        # Check guardian-approved emails
        link = conn.execute(
            "SELECT guardian_id FROM guardian_user_links WHERE user_id = ? AND active = 1",
            (request.user_id,),
        ).fetchone()
        conn.close()

        return {"verified": False, "message": "Email does not match any authorized accounts"}
    except Exception as e:
        logger.error("Error verifying email: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ===========================================================================
#  EXTENSION STATUS
# ===========================================================================
@app.post("/api/extension/status")
async def update_extension_status(request: ExtensionStatusRequest, current_user: dict = Depends(get_current_user)):
    if current_user["id"] != request.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update status for other users")

    conn = get_db()
    now = datetime.now().isoformat()
    record = conn.execute("SELECT id FROM extension_status WHERE user_id = ?", (request.user_id,)).fetchone()

    if record:
        conn.execute('''
            UPDATE extension_status SET installed = 1, last_heartbeat = ?, version = ?,
            device_email = ? WHERE user_id = ?
        ''', (now, request.version, request.device_email or '', request.user_id))
    else:
        conn.execute('''
            INSERT INTO extension_status (user_id, installed, installed_at, version, last_heartbeat, device_email)
            VALUES (?, 1, ?, ?, ?, ?)
        ''', (request.user_id, now, request.version, now, request.device_email or ''))

    conn.commit()
    conn.close()
    return {"status": "updated"}


# ===========================================================================
#  ALERTS
# ===========================================================================
@app.post("/api/alerts")
async def create_alert(request: AlertRequest, current_user: dict = Depends(get_current_user)):
    if current_user["id"] != request.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to create alerts for other users")

    conn = get_db()
    guardian = conn.execute(
        "SELECT guardian_id FROM guardian_user_links WHERE user_id = ? AND active = 1",
        (request.user_id,),
    ).fetchone()

    if not guardian:
        conn.close()
        return {"status": "error", "message": "No guardian found for user"}

    guardian_id = guardian["guardian_id"]
    now = datetime.now().isoformat()

    cursor = conn.execute('''
        INSERT INTO alerts (user_id, guardian_id, alert_type, severity, content, url, created_at, device_email, device_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (request.user_id, guardian_id, request.alert_type, request.severity,
          request.content, request.url, now, request.device_email or '', 1 if request.email_verified else 0))
    alert_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Broadcast alert to guardian via WebSocket
    await ws_manager.send_to_guardian(guardian_id, {
        "type": "new_alert",
        "alert_id": alert_id,
        "alert_type": request.alert_type,
        "severity": request.severity,
        "user_id": request.user_id,
        "content": request.content,
        "url": request.url,
        "created_at": now,
    })

    return {"status": "created", "alert_id": alert_id}


@app.get("/api/guardian/alerts")
async def get_guardian_alerts(current_user: dict = Depends(get_current_user)):
    """Get alerts for the currently authenticated guardian."""
    if current_user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Guardian role required")

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM alerts WHERE guardian_id = ? ORDER BY created_at DESC LIMIT 50",
        (current_user["id"],),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# Keep the old endpoint name for backwards compatibility
@app.get("/api/guardian/logs")
async def get_guardian_logs(current_user: dict = Depends(get_current_user)):
    return await get_guardian_alerts(current_user)


# ===========================================================================
#  GUARDIAN — USER MANAGEMENT
# ===========================================================================
@app.get("/api/guardian/users")
async def get_guardian_users(current_user: dict = Depends(get_current_user)):
    """List users linked to the current guardian."""
    if current_user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Guardian role required")

    conn = get_db()
    rows = conn.execute('''
        SELECT u.id, u.email, u.full_name, u.created_at, u.last_login,
               gl.active as link_active,
               es.installed, es.last_heartbeat, es.version
        FROM guardian_user_links gl
        JOIN users u ON u.id = gl.user_id
        LEFT JOIN extension_status es ON es.user_id = u.id
        WHERE gl.guardian_id = ? AND gl.active = 1
    ''', (current_user["id"],)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ===========================================================================
#  SUPERVISION SESSIONS
# ===========================================================================
@app.get("/api/supervision/active-sessions")
async def get_active_sessions(current_user: dict = Depends(get_current_user)):
    """List active supervision sessions for the current guardian."""
    if current_user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Guardian role required")

    conn = get_db()
    rows = conn.execute('''
        SELECT ss.id, ss.user_id, ss.started_at, ss.status,
               u.full_name as user_name, u.email as user_email
        FROM supervision_sessions ss
        JOIN users u ON u.id = ss.user_id
        WHERE ss.guardian_id = ? AND ss.status = 'active'
        ORDER BY ss.started_at DESC
    ''', (current_user["id"],)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/supervision/start")
async def start_session(request: StartSessionRequest, current_user: dict = Depends(get_current_user)):
    """Start a new supervision session."""
    if current_user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Guardian role required")

    conn = get_db()
    # Verify user is linked to this guardian
    link = conn.execute(
        "SELECT id FROM guardian_user_links WHERE guardian_id = ? AND user_id = ? AND active = 1",
        (current_user["id"], request.user_id),
    ).fetchone()
    if not link:
        conn.close()
        raise HTTPException(status_code=404, detail="User not linked to this guardian")

    now = datetime.now().isoformat()
    cursor = conn.execute(
        "INSERT INTO supervision_sessions (guardian_id, user_id, started_at, status) VALUES (?, ?, ?, 'active')",
        (current_user["id"], request.user_id, now),
    )
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Notify extension
    await ws_manager.send_to_extension(request.user_id, {
        "type": "session_started",
        "session_id": session_id,
        "guardian_id": current_user["id"],
    })

    return {"status": "started", "session_id": session_id}


@app.post("/api/supervision/end")
async def end_session(request: EndSessionRequest, current_user: dict = Depends(get_current_user)):
    """End a supervision session."""
    if current_user["role"] != "guardian":
        raise HTTPException(status_code=403, detail="Guardian role required")

    conn = get_db()
    session = conn.execute(
        "SELECT id, user_id FROM supervision_sessions WHERE id = ? AND guardian_id = ? AND status = 'active'",
        (request.session_id, current_user["id"]),
    ).fetchone()
    if not session:
        conn.close()
        raise HTTPException(status_code=404, detail="Active session not found")

    now = datetime.now().isoformat()
    conn.execute(
        "UPDATE supervision_sessions SET status = 'ended', ended_at = ? WHERE id = ?",
        (now, request.session_id),
    )
    conn.commit()
    conn.close()

    # Notify extension that session ended
    await ws_manager.send_to_extension(session["user_id"], {
        "type": "session_ended",
        "session_id": request.session_id,
    })

    return {"status": "ended", "session_id": request.session_id}


# ===========================================================================
#  ACCESS KEYS
# ===========================================================================
@app.get("/api/access-keys")
async def list_access_keys(current_user: dict = Depends(get_current_user)):
    """List access keys for the current user."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, key_value, created_at, expires_at, revoked, description FROM access_keys WHERE created_by = ? ORDER BY created_at DESC",
        (current_user["id"],),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/access-keys/generate")
async def generate_access_key(request: GenerateKeyRequest, current_user: dict = Depends(get_current_user)):
    """Generate a new access key."""
    key_value = f"cg_{secrets.token_hex(16)}"
    now = datetime.now()
    expires_at = (now + timedelta(days=request.expires_in_days)).isoformat() if request.expires_in_days else None

    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO access_keys (key_value, created_at, expires_at, created_by, description) VALUES (?, ?, ?, ?, ?)",
        (key_value, now.isoformat(), expires_at, current_user["id"], request.description),
    )
    key_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"key_id": key_id, "key_value": key_value, "expires_at": expires_at}


@app.post("/api/access-keys/revoke")
async def revoke_access_key(request: RevokeKeyRequest, current_user: dict = Depends(get_current_user)):
    """Revoke an access key."""
    conn = get_db()
    result = conn.execute(
        "UPDATE access_keys SET revoked = 1 WHERE id = ? AND created_by = ?",
        (request.key_id, current_user["id"]),
    )
    if result.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Key not found or not owned by you")
    conn.commit()
    conn.close()
    return {"status": "revoked", "key_id": request.key_id}


# ===========================================================================
#  WEBSOCKET ENDPOINTS
# ===========================================================================
@app.websocket("/ws/extension/{user_id}")
async def ws_extension(websocket: WebSocket, user_id: int):
    """WebSocket for Chrome extension to receive real-time commands."""
    await ws_manager.connect_extension(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Extension can send heartbeats or status updates
            try:
                msg = json.loads(data)
                if msg.get("type") == "heartbeat":
                    await websocket.send_json({"type": "heartbeat_ack"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect_extension(user_id, websocket)
        logger.info("Extension WebSocket disconnected for user %d", user_id)


@app.websocket("/ws/guardian/{user_id}")
async def ws_guardian(websocket: WebSocket, user_id: int):
    """WebSocket for guardian dashboard to receive real-time alerts."""
    await ws_manager.connect_guardian(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "heartbeat":
                    await websocket.send_json({"type": "heartbeat_ack"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect_guardian(user_id, websocket)
        logger.info("Guardian WebSocket disconnected for user %d", user_id)


# ===========================================================================
#  MAIN
# ===========================================================================
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)