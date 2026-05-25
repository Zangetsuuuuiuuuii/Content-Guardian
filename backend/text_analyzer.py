import logging
import re
from typing import Dict, Any

logger = logging.getLogger(__name__)

class TextContentAnalyzer:
    """
    Advanced text analyzer using a robust hybrid approach:
    1. Fast regex-based keyword matching for immediate filtering.
    2. Machine Learning fallback using Hugging Face transformers (toxic-bert) for nuanced contextual understanding.
    """
    
    def __init__(self, use_ml=True):
        logger.info("Initializing advanced hybrid text analyzer")
        
        self.use_ml = use_ml
        self.classifier = None
        
        if self.use_ml:
            try:
                from transformers import pipeline
                logger.info("Loading NLP model (unitary/toxic-bert) for robust text analysis... This might take a moment on first run.")
                # We use top_k=None to get scores for all labels (toxic, severe_toxic, obscene, threat, insult, identity_hate)
                self.classifier = pipeline("text-classification", model="unitary/toxic-bert", top_k=None)
                logger.info("NLP model loaded successfully")
            except ImportError:
                logger.warning("transformers package not found. Falling back to regex filtering only.")
                self.use_ml = False
            except Exception as e:
                logger.error(f"Failed to load NLP model: {e}. Falling back to regex filtering.")
                self.use_ml = False
        
        # Regex patterns for fast blocking. Word boundaries (\b) prevent substring false positives
        # (e.g., "skillet" won't trigger "kill", "assassin" won't trigger "ass")
        self.hate_pattern = re.compile(r'\b(death to|kill all|exterminate|subhuman|racial slur|ethnic cleansing)\b', re.IGNORECASE)
        self.violence_pattern = re.compile(r'\b(murder|massacre|slaughter|brutally|behead)\b', re.IGNORECASE)
        self.adult_pattern = re.compile(r'\b(porn|xxx|nsfw|sexually explicit|pornographic)\b', re.IGNORECASE)

    def analyze(self, text: str) -> Dict[str, Any]:
        """
        Analyze text for harmful content using the hybrid approach.
        """
        if not text or len(text.strip()) < 3:
            return {
                "harmful": False,
                "confidence": 1.0,
                "method": "text_too_short"
            }
            
        # 1. Fast Regex Check (High precision, catches obvious violations instantly safely)
        if self.hate_pattern.search(text):
            return {"harmful": True, "type": "hate", "confidence": 0.95, "method": "regex_matching"}
        if self.violence_pattern.search(text):
            return {"harmful": True, "type": "violence", "confidence": 0.95, "method": "regex_matching"}
        if self.adult_pattern.search(text):
            return {"harmful": True, "type": "nsfw", "confidence": 0.95, "method": "regex_matching"}

        # 2. Advanced NLP Analysis for Contextual Nuance
        if self.use_ml and self.classifier:
            try:
                # Truncate text to model's max length to prevent token overflow
                safe_text = text[:512]
                results = self.classifier(safe_text)
                
                # Handle pipeline output formats safely
                if isinstance(results, list) and isinstance(results[0], list):
                    results = results[0]
                elif isinstance(results, dict):
                    results = [results]
                    
                # Convert into a score dictionary
                scores = {item['label']: item['score'] for item in results}
                
                # Determine presence of harmful content based on confidence thresholds
                if scores.get('identity_hate', 0) > 0.5:
                    return {"harmful": True, "type": "hate", "confidence": round(scores['identity_hate'], 2), "method": "machine_learning"}
                if scores.get('threat', 0) > 0.5:
                    return {"harmful": True, "type": "violence", "confidence": round(scores['threat'], 2), "method": "machine_learning"}
                if scores.get('obscene', 0) > 0.6: # Obscene generally maps to NSFW / severe profanity
                    return {"harmful": True, "type": "nsfw", "confidence": round(scores['obscene'], 2), "method": "machine_learning"}
                if scores.get('toxic', 0) > 0.7 or scores.get('severe_toxic', 0) > 0.5:
                    return {"harmful": True, "type": "toxic", "confidence": round(max(scores.get('toxic', 0), scores.get('severe_toxic', 0)), 2), "method": "machine_learning"}

            except Exception as e:
                logger.error(f"ML analysis failed: {e}")

        # No harmful content detected
        return {
            "harmful": False,
            "confidence": 0.8,
            "method": "hybrid_analysis"
        }

# Usage example:
if __name__ == "__main__":
    analyzer = TextContentAnalyzer(use_ml=False)
    test_texts = [
        "This is a normal sentence about cats and dogs.",
        "I hate all people from that country, they should die.",
        "The violent attack resulted in multiple casualties.",
        "Check out this xxx adult content site.",
        "To Kill a Mockingbird is a classic book.", # Used to be false positive!
        "You are absolutely repulsive and I hope terrible things happen to you." # Nuanced toxicity
    ]
    
    for text in test_texts:
        result = analyzer.analyze(text)
        print(f"Text: '{text[:50]}...'")
        print(f"Result: {result}")
        print("-" * 50) 