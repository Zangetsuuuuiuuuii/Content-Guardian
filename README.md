# Content Guardian - Image & Text Content Analysis System

## Overview

Content Guardian is an advanced content filtering system designed to detect and filter harmful content from images and text. The system uses machine learning models to analyze content in real-time, flagging potentially inappropriate material such as NSFW imagery and hate speech.

## Technologies Used

- **Python**: Core language for the backend and analysis components
- **PyTorch**: Deep learning framework for ML model inference
- **Transformers**: HuggingFace transformers for text and image analysis
- **FastAPI/Flask**: Web frameworks for the backend API
- **Scikit-image**: Image processing for skin-tone analysis
- **PIL/Pillow**: Image manipulation
- **NumPy**: Numerical computing for array operations
- **Browser Extension (JavaScript)**: Chrome/Edge extension for real-time content filtering
- **WebSockets**: Real-time communication between extension and backend
- **PostgreSQL/SQLite**: Database options for storing analysis results and user data

## Key Features

### Image Analysis
- NSFW content detection using pre-trained models
- Skin-tone analysis for additional NSFW detection
- Multi-layered analysis approach for increased accuracy
- Support for various image formats

### Text Analysis
- Hate speech detection using RoBERTa-based models
- Real-time text content scanning
- High confidence scoring for detected harmful content

### URL Analysis
- Pattern matching for potentially harmful URLs
- Keyword-based domain filtering

### System Design
- Asynchronous processing for improved performance
- Comprehensive error handling and logging
- Modular architecture for easy extension
- Combined analysis results with confidence scoring

## Setup and Execution

### Prerequisites
- Python 3.9+
- PyTorch
-Transformers
- NSFW detection models (downloaded via the provided script)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/content-guardian.git
cd content-guardian
```

2. Create a virtual environment:
```bash
python -m venv venv
# On Windows
venv\Scripts\activate
# On macOS/Linux
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
pip install -r backend/requirements.txt
```

4. Download the ML models:
```bash
python backend/download_models.py
```

5. Start the backend server:
```bash
cd backend
python app.py
# For FastAPI version
# uvicorn web_app:app --reload
```

6. Install the browser extension:
   - Open Chrome/Edge and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extension directory

## Usage

1. The system can be used through the API endpoints or browser extension
2. For API usage, send requests to the appropriate endpoints:
   - `/analyze` - Analyze content (image or text)
   - `/check` - Check URL for harmful patterns
3. For browser extension usage, simply browse the web normally, and the extension will analyze content in real-time

## Limitations

- **Accuracy**: While the models used are state-of-the-art, content analysis is not 100% accurate and may result in false positives or negatives
- **Performance**: Deep learning model inference can be resource-intensive, especially for large images
- **Language Support**: Text analysis primarily works best with English text
- **Context Understanding**: The system may not fully understand context or nuance in content
- **Narrow Scope**: Current implementation focuses on NSFW imagery and hate speech but may miss other harmful content types
- **Model Size**: Pre-trained models require significant disk space and memory
- **Simplified NSFW Detection**: The current implementation uses a simplified approach for demonstration purposes, not a specialized NSFW model

## Future Upgrades

1. **Advanced NSFW Model**: Implement a dedicated, fine-tuned NSFW detection model
2. **Multi-Language Support**: Extend text analysis to support multiple languages
3. **Video Analysis**: Add capabilities for analyzing video content frame-by-frame
4. **Content Context Analysis**: Improve understanding of context to reduce false positives
5. **Performance Optimization**: Optimize model inference for faster processing
6. **Enhanced UI**: Develop a more user-friendly interface for visualizing analysis results
7. **API Expansion**: Expand API functionality for broader use cases
8. **Mobile Support**: Create mobile versions of the content guardian
9. **Edge Deployment**: Enable model deployment on edge devices for privacy-focused analysis
10. **Customizable Filtering**: Allow users to customize filtering thresholds and categories

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 