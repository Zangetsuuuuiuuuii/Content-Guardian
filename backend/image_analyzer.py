import logging
from typing import Dict, Any, Optional, Tuple
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, AutoFeatureExtractor, AutoModelForImageClassification
import numpy as np
from PIL import Image
import io
import aiohttp
from skimage import transform

logger = logging.getLogger(__name__)

class ImageContentAnalyzer:
    """
    Advanced image content analyzer for detecting harmful content.
    Uses both URL pattern matching, ML-based text analysis, and image-based NSFW detection.
    """
    
    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize the image analyzer.
        
        Args:
            model_path: Path to the pre-trained model (optional)
        """
        logger.info("Initializing image analyzer with ML capabilities")
        
        # Initialize the text analysis model
        self.text_model_name = "facebook/roberta-hate-speech-dynabench-r4-target"
        self.text_tokenizer = AutoTokenizer.from_pretrained(self.text_model_name)
        self.text_model = AutoModelForSequenceClassification.from_pretrained(self.text_model_name)
        self.text_model.eval()
        
        # Initialize the NSFW detection model
        self.image_model_name = "microsoft/resnet-50"
        self.image_processor = AutoFeatureExtractor.from_pretrained(self.image_model_name)
        self.image_model = AutoModelForImageClassification.from_pretrained(self.image_model_name)
        self.image_model.eval()
        
        # Define harmful content categories
        self.harmful_categories = {
            "nsfw": ["nsfw", "porn", "xxx", "adult", "18+", "sex"],
            "violence": ["violence", "violent", "gore", "blood"],
            "hate": ["hate", "racist", "sexist", "homophobic", "transphobic"]
        }
        
    async def analyze(self, url: str, image_text: Optional[str] = None, image_data: Optional[bytes] = None) -> Dict[str, Any]:
        """
        Analyze an image for harmful content.
        
        Args:
            url: Image URL to analyze
            image_text: Optional text extracted from the image
            image_data: Optional raw image data
            
        Returns:
            Analysis results
        """
        results = []
        
        # First pass: URL pattern matching
        url_analysis = self._analyze_url(url)
        results.append(url_analysis)
        
        # Second pass: Text analysis if available
        if image_text:
            text_analysis = await self._analyze_content(image_text)
            results.append(text_analysis)
            
        # Third pass: Image analysis if available
        if image_data:
            try:
                # Verify and process image data
                image = Image.open(io.BytesIO(image_data))
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                image_analysis = await self._analyze_image(image)
                results.append(image_analysis)
            except Exception as e:
                logger.error(f"Error processing image: {str(e)}")
                results.append({
                    "harmful": False,
                    "confidence": 0.0,
                    "method": "ml_model_image",
                    "error": str(e)
                })
            
        # Combine results
        return self._combine_results(results)
    
    def _analyze_url(self, url: str) -> Dict[str, Any]:
        """
        Analyze URL for harmful content patterns.
        
        Args:
            url: Image URL
            
        Returns:
            Analysis results
        """
        url_lower = url.lower()
        
        # Check each category
        for category, keywords in self.harmful_categories.items():
            if any(kw in url_lower for kw in keywords):
                return {
                    "harmful": True,
                    "type": category,
                    "confidence": 0.85,
                    "method": "url_pattern_matching"
                }
                
        # Default to safe content
        return {
            "harmful": False,
            "confidence": 0.9,
            "method": "url_pattern_matching"
        }
        
    async def _analyze_content(self, text: str) -> Dict[str, Any]:
        """
        Analyze content using ML model.
        
        Args:
            text: Text to analyze
            
        Returns:
            Analysis results
        """
        try:
            # Tokenize and prepare input
            inputs = self.text_tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
            
            # Get model predictions
            with torch.no_grad():
                outputs = self.text_model(**inputs)
                probabilities = torch.softmax(outputs.logits, dim=1)
                
            # Get prediction and confidence
            prediction = torch.argmax(probabilities, dim=1).item()
            confidence = probabilities[0, prediction].item()
            
            # Map prediction to result
            if prediction == 1:  # Assuming 1 is the harmful class
                return {
                    "harmful": True,
                    "type": "hate_speech",
                    "confidence": confidence,
                    "method": "ml_model_text"
                }
            else:
                return {
                    "harmful": False,
                    "confidence": confidence,
                    "method": "ml_model_text"
                }
        except Exception as e:
            logger.error(f"Error analyzing text: {str(e)}")
            return {
                "harmful": False,
                "confidence": 0.0,
                "method": "ml_model_text",
                "error": str(e)
            }
            
    async def _analyze_image(self, image: Image.Image) -> Dict[str, Any]:
        """
        Analyze image for NSFW content.
        
        Args:
            image: PIL Image to analyze
            
        Returns:
            Analysis results
        """
        try:
            # Process image for the model
            inputs = self.image_processor(images=image, return_tensors="pt")
            
            # Get model predictions
            with torch.no_grad():
                outputs = self.image_model(**inputs)
                probabilities = torch.softmax(outputs.logits, dim=1)
                
            # Get prediction and confidence
            prediction = torch.argmax(probabilities, dim=1).item()
            confidence = probabilities[0, prediction].item()
            
            # For demonstration, we'll consider certain ImageNet classes as potentially NSFW
            # This is a simplified approach - in production, you'd want to use a proper NSFW model
            nsfw_classes = [0, 1, 2, 3, 4]  # Example classes that might indicate NSFW content
            is_nsfw = prediction in nsfw_classes
            
            # Additional NSFW image detection using color and skin-tone analysis
            if not is_nsfw:
                is_nsfw, nsfw_confidence = self._detect_nsfw_by_color_analysis(image)
                if is_nsfw:
                    confidence = nsfw_confidence
            
            return {
                "harmful": is_nsfw,
                "type": "nsfw" if is_nsfw else None,
                "confidence": confidence if is_nsfw else 1 - confidence,
                "method": "ml_model_image"
            }
            
        except Exception as e:
            logger.error(f"Error analyzing image: {str(e)}")
            return {
                "harmful": False,
                "confidence": 0.0,
                "method": "ml_model_image",
                "error": str(e)
            }
            
    def _detect_nsfw_by_color_analysis(self, image: Image.Image) -> Tuple[bool, float]:
        """
        Detect NSFW content by analyzing skin tones in the image.
        
        Args:
            image: PIL Image to analyze
            
        Returns:
            Tuple of (is_nsfw, confidence)
        """
        try:
            # Resize for faster processing
            resized_img = image.resize((100, 100))
            img_array = np.array(resized_img)
            
            # Define skin tone range (simplified for demo)
            lower_skin = np.array([0, 30, 60])
            upper_skin = np.array([35, 255, 255])
            
            # Convert to HSV for better skin detection
            if img_array.shape[2] == 3:  # RGB image
                img_hsv = transform.rgb2hsv(img_array)
                
                # Create mask for skin detection (simplified)
                skin_mask = (img_hsv[:,:,0] <= upper_skin[0]/360) & \
                            (img_hsv[:,:,1] >= lower_skin[1]/255) & \
                            (img_hsv[:,:,1] <= upper_skin[1]/255) & \
                            (img_hsv[:,:,2] >= lower_skin[2]/255) & \
                            (img_hsv[:,:,2] <= upper_skin[2]/255)
                
                # Calculate skin percentage
                skin_percentage = np.sum(skin_mask) / (skin_mask.shape[0] * skin_mask.shape[1])
                
                # If more than 30% of the image is skin tones, it might be NSFW
                # This is a simplified approach and should be replaced with a proper model
                if skin_percentage > 0.30:
                    return True, min(0.5 + skin_percentage, 0.98)
            
            return False, 0.0
        except Exception as e:
            logger.error(f"Error in skin tone analysis: {str(e)}")
            return False, 0.0
            
    def _combine_results(self, results: list) -> Dict[str, Any]:
        """
        Combine multiple analysis results into a single result.
        
        Args:
            results: List of analysis results
            
        Returns:
            Combined analysis result
        """
        # If any method detects harmful content, consider it harmful
        harmful_results = [r for r in results if r.get("harmful", False)]
        
        if harmful_results:
            # Get the harmful result with highest confidence
            most_confident = max(harmful_results, key=lambda x: x.get("confidence", 0))
            harmful = True
            confidence = most_confident.get("confidence", 0)
        else:
            # If no harmful content, use highest confidence of safe results
            harmful = False
            confidence = max((r.get("confidence", 0) for r in results), default=0)
        
        # Get all detected types
        types = [r.get("type") for r in results if r.get("type")]
        
        return {
            "harmful": harmful,
            "confidence": confidence,
            "types": types,
            "methods": [r.get("method") for r in results],
            "details": results
        }

# For testing
if __name__ == "__main__":
    import asyncio
    
    async def test_analyzer():
        analyzer = ImageContentAnalyzer()
        
        # Test cases
        test_cases = [
            {
                "url": "https://example.com/normal-image.jpg",
                "text": "This is a normal image",
                "image_data": None
            },
            {
                "url": "https://example.com/nsfw-content-image.jpg",
                "text": "This is a normal image",
                "image_data": None
            },
            {
                "url": "https://example.com/normal-image.jpg",
                "text": "I hate this group of people",
                "image_data": None
            }
        ]
        
        for case in test_cases:
            result = await analyzer.analyze(
                url=case["url"],
                image_text=case["text"],
                image_data=case["image_data"]
            )
            print(f"URL: {case['url']}")
            print(f"Text: {case['text']}")
            print(f"Result: {result}")
            print("-" * 50)
    
    asyncio.run(test_analyzer()) 