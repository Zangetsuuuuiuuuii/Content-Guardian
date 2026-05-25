from fastapi import FastAPI, UploadFile, Form, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import uvicorn
from image_analyzer import ImageContentAnalyzer
import base64
import io
from typing import Optional
from pydantic import BaseModel
import aiohttp

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the analyzer
analyzer = ImageContentAnalyzer()

class AnalysisRequest(BaseModel):
    url: str
    text: Optional[str] = None
    image_data: Optional[str] = None  # Base64 encoded image data

@app.get("/", response_class=HTMLResponse)
async def root():
    """
    Root endpoint to provide information about the API
    """
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Content Guardian API</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                color: #333;
                background-color: #f8f9fa;
            }
            h1 {
                color: #2c3e50;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
            }
            h2 {
                color: #3498db;
                margin-top: 30px;
            }
            pre {
                background-color: #f0f0f0;
                padding: 15px;
                border-radius: 5px;
                overflow-x: auto;
            }
            code {
                font-family: monospace;
            }
            .endpoint {
                background-color: #e8f4fc;
                padding: 15px;
                border-radius: 5px;
                margin-bottom: 20px;
            }
            .content-blocked {
                text-align: center;
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 5px;
                margin: 20px 0;
            }
            .sign-in-btn {
                display: inline-block;
                background-color: #4CAF50;
                color: white;
                padding: 8px 16px;
                text-decoration: none;
                border-radius: 4px;
                font-weight: bold;
            }
            .sign-in-btn:hover {
                background-color: #45a049;
            }
        </style>
    </head>
    <body>
        <h1>Content Guardian API</h1>
        <p>Welcome to the Content Guardian API for image and text content analysis.</p>
        
        <div class="content-blocked">
            <h2>Content Blocked</h2>
            <p>This page has been blocked because it contains potential hate speech.</p>
            <p>You need to <a href="http://localhost:5000" class="sign-in-btn">sign in</a> to continue.</p>
        </div>
        
        <h2>API Endpoints</h2>
        
        <div class="endpoint">
            <h3>POST /analyze</h3>
            <p>Analyze image and text content for harmful material.</p>
            <h4>Request Body:</h4>
            <pre><code>{
  "url": "https://example.com/image.jpg",
  "text": "Optional text to analyze",
  "image_data": "Optional base64 encoded image data"
}</code></pre>
            <h4>Response:</h4>
            <pre><code>{
  "harmful": true|false,
  "confidence": 0.95,
  "types": ["nsfw", "hate_speech"],
  "methods": ["url_pattern_matching", "ml_model_text", "ml_model_image"],
  "details": [...]
}</code></pre>
        </div>
        
        <h2>How to Use</h2>
        <p>To test the API, send a POST request to <code>/analyze</code> with a JSON body containing the URL, text, and optional image data.</p>
        <p>You can use tools like Postman or curl to test the API:</p>
        <pre><code>curl -X POST http://localhost:8000/analyze \\
-H "Content-Type: application/json" \\
-d '{
  "url": "https://example.com/image.jpg",
  "text": "Text to analyze"
}'</code></pre>

        <h2>Web Interface</h2>
        <p>For the web interface, please visit: <a href="http://localhost:5000">http://localhost:5000</a></p>
    </body>
    </html>
    """
    return html_content

@app.post("/analyze")
async def analyze_content(request: AnalysisRequest):
    """
    Analyze content for harmful material.
    
    Args:
        request: AnalysisRequest containing URL, optional text, and optional image data
        
    Returns:
        Analysis results
    """
    image_data = None
    
    # If image data is provided, decode it
    if request.image_data:
        try:
            image_data = base64.b64decode(request.image_data.split(',')[1])
        except Exception as e:
            return {"error": f"Invalid image data: {str(e)}"}
    
    # If no image data but URL is provided, try to download the image
    elif request.url:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(request.url) as response:
                    if response.status == 200:
                        image_data = await response.read()
        except Exception as e:
            return {"error": f"Failed to download image: {str(e)}"}
    
    # Analyze the content
    try:
        result = await analyzer.analyze(
            url=request.url,
            image_text=request.text,
            image_data=image_data
        )
        return result
    except Exception as e:
        return {"error": f"Analysis failed: {str(e)}"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000) 