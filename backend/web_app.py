import logging
import random
import string
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime
import os
from functools import wraps

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, 
    static_folder='../web-portal',
    template_folder='../web-portal'
)

# Configuration
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key-here')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///content_guardian.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
CORS(app)
db = SQLAlchemy(app)

# Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    is_guardian = db.Column(db.Boolean, default=False)
    linked_users = db.relationship('UserLink', foreign_keys='UserLink.guardian_id', backref='guardian_link', lazy=True)
    supervised_by = db.relationship('UserLink', foreign_keys='UserLink.user_id', backref='user_link', lazy=True)

class UserLink(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    guardian_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class AccessKey(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key_value = db.Column(db.String(20), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    url = db.Column(db.String(500), nullable=True)
    content_type = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    user = db.relationship('User', backref='access_keys')

class SupervisionSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    key_id = db.Column(db.Integer, db.ForeignKey('access_key.id'), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    user = db.relationship('User', backref='sessions')
    access_key = db.relationship('AccessKey', backref='sessions')

class ContentAlert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    content_type = db.Column(db.String(50), nullable=False)
    severity = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    details = db.Column(db.Text, nullable=True)
    user = db.relationship('User', backref='alerts')

# Generate a secure random access key
def generate_random_key(length=8):
    # Use a mix of uppercase letters and numbers for better readability
    chars = string.ascii_uppercase + string.digits
    # Ensure we don't have similar looking characters
    chars = chars.replace('0', '').replace('O', '').replace('1', '').replace('I', '')
    # Generate the key
    key = ''.join(random.choice(chars) for _ in range(length))
    # Insert hyphens for better readability (e.g., XXXX-XXXX)
    if length >= 8:
        key = f"{key[:4]}-{key[4:]}"
    return key

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
        try:
            token = token.split(' ')[1]  # Remove 'Bearer ' prefix
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = User.query.get(data['user_id'])
        except Exception as e:
            logger.error(f"Token validation error: {str(e)}")
            return jsonify({'message': 'Token is invalid!'}), 401
        return f(current_user, *args, **kwargs)
    return decorated

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register')
def register_page():
    return render_template('register.html')

@app.route('/guardian-dashboard.html')
def guardian_dashboard():
    return render_template('guardian-dashboard.html')

@app.route('/user-dashboard.html')
def user_dashboard():
    return render_template('user-dashboard.html')

@app.route('/demo-sites')
def demo_sites():
    return render_template('demo-sites.html')

# API Routes
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': 'Email already registered'}), 400
    
    hashed_password = generate_password_hash(data['password'])
    new_user = User(
        email=data['email'],
        password=hashed_password,
        is_guardian=data.get('is_guardian', False)
    )
    
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({'message': 'User registered successfully'}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data['email']).first()
    
    if not user or not check_password_hash(user.password, data['password']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = jwt.encode({
        'user_id': user.id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1)
    }, app.config['SECRET_KEY'])
    
    return jsonify({
        'token': token,
        'user_id': user.id,
        'is_guardian': user.is_guardian
    })

@app.route('/api/generate-key', methods=['POST'])
@token_required
def generate_key(current_user):
    data = request.get_json()
    url = data.get('url', '')
    content_type = data.get('content_type', 'unknown')
    
    # Find the user to generate key for
    target_user_id = data.get('user_id', current_user.id)
    
    # Check if current user is a guardian for the target user
    if target_user_id != current_user.id and not current_user.is_guardian:
        link = UserLink.query.filter_by(guardian_id=current_user.id, user_id=target_user_id).first()
        if not link:
            return jsonify({'message': 'Not authorized to generate key for this user'}), 403
    
    # Generate a unique random key
    key_value = generate_random_key()
    while AccessKey.query.filter_by(key_value=key_value).first():
        key_value = generate_random_key()
    
    # Create new access key
    new_key = AccessKey(
        key_value=key_value,
        user_id=target_user_id,
        url=url,
        content_type=content_type,
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    )
    
    db.session.add(new_key)
    
    # Also create a content alert for the guardian
    if current_user.is_guardian:
        alert = ContentAlert(
            user_id=target_user_id,
            url=url,
            content_type=content_type,
            severity="medium",
            details=f"Access key generated for {url}"
        )
        db.session.add(alert)
    
    db.session.commit()
    
    return jsonify({
        'key_value': key_value,
        'url': url,
        'content_type': content_type,
        'expires_at': new_key.expires_at.isoformat()
    })

@app.route('/api/validate-key', methods=['POST'])
@token_required
def validate_key(current_user):
    data = request.get_json()
    key = AccessKey.query.filter_by(key_value=data['key_value']).first()
    
    if not key:
        return jsonify({'valid': False, 'message': 'Key not found'}), 404
    
    if key.used:
        return jsonify({'valid': False, 'message': 'Key already used'}), 400
    
    if key.expires_at < datetime.datetime.utcnow():
        return jsonify({'valid': False, 'message': 'Key expired'}), 400
    
    # If the key is for a specific URL, validate it
    if key.url and data.get('url') and key.url != data.get('url'):
        return jsonify({'valid': False, 'message': 'Key not valid for this URL'}), 400
    
    # Mark key as used
    key.used = True
    db.session.commit()
    
    return jsonify({
        'valid': True, 
        'key_id': key.id,
        'content_type': key.content_type,
        'message': 'Key validated successfully'
    })

@app.route('/api/supervision/start', methods=['POST'])
@token_required
def start_supervision(current_user):
    data = request.get_json()
    key_id = data.get('key_id')
    
    if not key_id:
        return jsonify({'message': 'Key ID is required'}), 400
    
    # Check if the key exists and belongs to the user
    key = AccessKey.query.get(key_id)
    if not key or key.user_id != current_user.id:
        return jsonify({'message': 'Invalid key'}), 404
    
    # Create new supervision session
    new_session = SupervisionSession(
        user_id=current_user.id,
        key_id=key_id
    )
    
    db.session.add(new_session)
    db.session.commit()
    
    return jsonify({
        'id': new_session.id,
        'started_at': new_session.started_at.isoformat()
    })

@app.route('/api/supervision/end', methods=['POST'])
@token_required
def end_supervision(current_user):
    data = request.get_json()
    session = SupervisionSession.query.get(data['session_id'])
    
    if session and session.user_id == current_user.id:
        session.ended_at = datetime.datetime.utcnow()
        db.session.commit()
        return jsonify({'message': 'Supervision session ended'})
    
    return jsonify({'message': 'Invalid session'}), 400

@app.route('/api/supervision/check/<int:user_id>')
@token_required
def check_supervision(current_user, user_id):
    # Allow guardians to check supervision status of their users
    if current_user.id != user_id and not current_user.is_guardian:
        return jsonify({'message': 'Not authorized'}), 403
        
    active_session = SupervisionSession.query.filter_by(
        user_id=user_id,
        ended_at=None
    ).first()
    
    return jsonify({
        'supervision_active': bool(active_session),
        'session_id': active_session.id if active_session else None,
        'started_at': active_session.started_at.isoformat() if active_session else None
    })

@app.route('/api/extension/status', methods=['POST'])
@token_required
def extension_status(current_user):
    data = request.get_json()
    # Store extension status (e.g., in a database or log)
    logger.info(f"Extension status update for user {current_user.id}: {data}")
    return jsonify({'message': 'Extension status updated'})

@app.route('/api/extension/heartbeat', methods=['POST'])
@token_required
def extension_heartbeat(current_user):
    data = request.get_json()
    # Update last seen timestamp (e.g., in a database)
    logger.info(f"Heartbeat received from user {current_user.id}: {data}")
    return jsonify({'message': 'Heartbeat received'})

@app.route('/api/alerts', methods=['POST'])
@token_required
def create_alert(current_user):
    data = request.get_json()
    
    # Create alert
    new_alert = ContentAlert(
        user_id=current_user.id,
        url=data.get('url', ''),
        content_type=data.get('alert_type', 'unknown'),
        severity=data.get('severity', 'medium'),
        details=str(data.get('content', ''))
    )
    
    db.session.add(new_alert)
    db.session.commit()
    
    # Find guardians for this user and notify them
    guardian_links = UserLink.query.filter_by(user_id=current_user.id).all()
    guardian_ids = [link.guardian_id for link in guardian_links]
    
    # In a real system, you would send notifications to guardians here
    
    return jsonify({
        'id': new_alert.id,
        'message': 'Alert created',
        'notified_guardians': len(guardian_ids)
    })

@app.route('/api/guardian/logs', methods=['POST'])
@token_required
def create_log(current_user):
    data = request.get_json()
    # Store log information
    logger.info(f"Log entry from user {current_user.id}: {data}")
    return jsonify({'message': 'Log created'})

@app.route('/api/guardian/alerts', methods=['GET'])
@token_required
def get_alerts(current_user):
    # If user is a guardian, get alerts for all supervised users
    if current_user.is_guardian:
        # Get all users supervised by this guardian
        supervised_user_ids = [link.user_id for link in UserLink.query.filter_by(guardian_id=current_user.id).all()]
        alerts = ContentAlert.query.filter(ContentAlert.user_id.in_(supervised_user_ids)).order_by(ContentAlert.created_at.desc()).limit(50).all()
    else:
        # Regular users only see their own alerts
        alerts = ContentAlert.query.filter_by(user_id=current_user.id).order_by(ContentAlert.created_at.desc()).limit(50).all()
    
    return jsonify({
        'alerts': [{
            'id': alert.id,
            'url': alert.url,
            'content_type': alert.content_type,
            'severity': alert.severity,
            'created_at': alert.created_at.isoformat(),
            'details': alert.details
        } for alert in alerts]
    })

@app.route('/api/guardian/keys', methods=['GET'])
@token_required
def get_keys(current_user):
    if not current_user.is_guardian:
        return jsonify({'message': 'Not authorized'}), 403
    
    # Get all users supervised by this guardian
    supervised_user_ids = [link.user_id for link in UserLink.query.filter_by(guardian_id=current_user.id).all()]
    
    # Get active keys for these users
    active_keys = AccessKey.query.filter(
        AccessKey.user_id.in_(supervised_user_ids),
        AccessKey.expires_at > datetime.datetime.utcnow(),
        AccessKey.used == False
    ).order_by(AccessKey.created_at.desc()).all()
    
    return jsonify({
        'keys': [{
            'id': key.id,
            'key_value': key.key_value,
            'user_id': key.user_id,
            'user_email': User.query.get(key.user_id).email if User.query.get(key.user_id) else 'Unknown',
            'url': key.url,
            'content_type': key.content_type,
            'created_at': key.created_at.isoformat(),
            'expires_at': key.expires_at.isoformat()
        } for key in active_keys]
    })

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000) 