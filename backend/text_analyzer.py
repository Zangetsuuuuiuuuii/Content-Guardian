import logging

logger = logging.getLogger(__name__)

class TextContentAnalyzer:
    """
    Basic text analyzer that uses keyword matching to detect harmful content.
    """
    
    def __init__(self):
        logger.info("Initializing simplified text analyzer")
        
        # Hate speech keywords (simplified)
        self.hate_keywords = [
            "hate", "death to", "kill all", 
            "should die", "exterminate", "subhuman",
            "racial slur", "ethnic cleansing"
        ]
        
        # Violence keywords
        self.violence_keywords = [
            "murder", "attack", "kill", "shooting", 
            "stab", "assault", "violent", "brutally",
            "massacre", "slaughter"
        ]
        
        # Adult content keywords
        self.adult_keywords = [
            "porn", "xxx", "nsfw", "adult content",
            "sexually explicit", "obscene", "pornographic"
        ]
    
    def analyze(self, text):
        """
        Analyze text for harmful content using keyword matching.
        
        Args:
            text (str): Text to analyze
            
        Returns:
            dict: Analysis results
        """
        if not text or len(text) < 10:
            return {
                "harmful": False,
                "confidence": 1.0,
                "method": "text_too_short"
            }
            
        text_lower = text.lower()
        
        # Check for hate speech
        for keyword in self.hate_keywords:
            if keyword in text_lower:
                return {
                    "harmful": True,
                    "type": "hate",
                    "confidence": 0.8,
                    "method": "keyword_matching"
                }
        
        # Check for violence 
        for keyword in self.violence_keywords:
            if keyword in text_lower:
                return {
                    "harmful": True,
                    "type": "violence",
                    "confidence": 0.7,
                    "method": "keyword_matching"
                }
        
        # Check for adult content
        for keyword in self.adult_keywords:
            if keyword in text_lower:
                return {
                    "harmful": True,
                    "type": "nsfw",
                    "confidence": 0.75,
                    "method": "keyword_matching"
                }
        
        # No harmful content detected
        return {
            "harmful": False,
            "confidence": 0.6,
            "method": "keyword_matching"
        }


# Usage example:
if __name__ == "__main__":
    analyzer = TextContentAnalyzer()
    test_texts = [
        "This is a normal sentence about cats and dogs.",
        "I hate all people from that country, they should die.",
        "The violent attack resulted in multiple casualties.",
        "Check out this adult content website for explicit material."
    ]
    
    for text in test_texts:
        result = analyzer.analyze(text)
        print(f"Text: '{text[:30]}...'")
        print(f"Result: {result}")
        print("-" * 50) 