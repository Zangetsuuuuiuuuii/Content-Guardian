## 1.3 Methodology Adopted to Satisfy the Objective

1. **Initialize Content Monitoring System:**
   
   We begin by initializing the Content Guardian extension when the user loads a web page. The system authenticates the user and establishes connection with the backend API for real-time monitoring capabilities.

2. **Determine Content Type for Analysis:**
   
   A lightweight classifier identifies the content type (text, image, or video) on the current web page. This step ensures we apply the appropriate analysis techniques to each content format.

3. **Load Analysis Models:**
   
   Depending on the detected content types:
   
   * **Text:** Load keyword matching system and ML-based classifiers including RoBERTa hate speech detector, sentiment analysis model, and harmful content pattern matchers.
   
   * **Images:** Load NSFW image detection models (ResNet-50), URL pattern matchers, and surrounding text analyzers.
   
   * **Videos:** Load audio transcription components and frame sampling system for periodic visual content analysis.
   
   Models are loaded on demand, keeping memory usage and startup time optimized.

4. **Content Analysis Pipeline:**
   
   We process web content through a multi-stage pipeline:
   
   * **Stage 1:** Fast keyword matching and pattern detection for immediate flagging
   * **Stage 2:** ML model processing for more nuanced content analysis
   * **Stage 3:** Contextual analysis combining signals from surrounding elements
   
   Each stage returns confidence scores that are then combined to form a final determination.

5. **Content Access Control:**
   
   When harmful content is detected:
   
   * The page is immediately blocked with an overlay screen
   * Alert data is sent to the backend for guardian notification
   * Access key system is initiated for supervised access requests
   * Guardian can remotely monitor or terminate the supervision session
   
   All blocking events are logged with timestamps and context details for later review.

6. **Real-time Guardian Notification:**
   
   The system maintains WebSocket connections to provide real-time alerts:
   
   * Guardian receives immediate notification of blocked content
   * Alert includes content type, severity level, and URL information
   * Guardian can generate access keys to enable supervised browsing
   * Supervision mode provides continuous monitoring capabilities
   
   Multiple notification channels ensure guardian awareness regardless of current device status. 