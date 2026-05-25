"""
Image Content Analyzer
======================
Multi-pass image analysis using:
  1. URL pattern matching (fast, keyword-based)
  2. Text analysis via RoBERTa hate-speech model
  3. NSFW image detection via Falconsai/nsfw_detector
"""

import logging
from typing import Dict, Any, Optional, Tuple
import torch
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    AutoImageProcessor,
    AutoModelForImageClassification,
)
import numpy as np
from PIL import Image
import io

logger = logging.getLogger(__name__)


class ImageContentAnalyzer:
    """
    Advanced image content analyzer for detecting harmful content.
    Uses URL pattern matching, ML-based text analysis, and a real NSFW image classifier.
    """

    def __init__(self):
        logger.info("Initializing image analyzer with ML capabilities")

        # --- Text analysis model (hate speech) ---
        self.text_model_name = "facebook/roberta-hate-speech-dynabench-r4-target"
        try:
            self.text_tokenizer = AutoTokenizer.from_pretrained(self.text_model_name)
            self.text_model = AutoModelForSequenceClassification.from_pretrained(self.text_model_name)
            self.text_model.eval()
            logger.info("Text model loaded: %s", self.text_model_name)
        except Exception as e:
            logger.error("Failed to load text model: %s", e)
            self.text_tokenizer = None
            self.text_model = None

        # --- NSFW image detection model (real classifier) ---
        self.image_model_name = "Falconsai/nsfw_image_detection"
        try:
            self.image_processor = AutoImageProcessor.from_pretrained(self.image_model_name)
            self.image_model = AutoModelForImageClassification.from_pretrained(self.image_model_name)
            self.image_model.eval()
            # Build label lookup from model config
            self.id2label = self.image_model.config.id2label
            logger.info("NSFW model loaded: %s  |  labels: %s", self.image_model_name, self.id2label)
        except Exception as e:
            logger.error("Failed to load NSFW model: %s", e)
            self.image_processor = None
            self.image_model = None
            self.id2label = {}

        # Harmful URL keywords
        self.harmful_categories = {
            "nsfw": ["nsfw", "porn", "xxx", "adult", "18+", "sex"],
            "violence": ["violence", "violent", "gore", "blood"],
            "hate": ["hate", "racist", "sexist", "homophobic", "transphobic"],
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    async def analyze(
        self,
        url: str,
        image_text: Optional[str] = None,
        image_data: Optional[bytes] = None,
    ) -> Dict[str, Any]:
        """
        Analyse an image (and optional associated text) for harmful content.

        Args:
            url: Image URL (used for URL-pattern check even if image_data is supplied).
            image_text: Optional text extracted from / surrounding the image.
            image_data: Optional raw image bytes (already downloaded or base64-decoded).

        Returns:
            Combined analysis result dict.
        """
        results = []

        # Pass 1: URL pattern matching
        results.append(self._analyze_url(url))

        # Pass 2: Text analysis
        if image_text:
            results.append(await self._analyze_content(image_text))

        # Pass 3: Image classification
        if image_data:
            try:
                image = Image.open(io.BytesIO(image_data))
                if image.mode != "RGB":
                    image = image.convert("RGB")
                results.append(await self._analyze_image(image))
            except Exception as e:
                logger.error("Error processing image bytes: %s", e)
                results.append({
                    "harmful": False,
                    "confidence": 0.0,
                    "method": "ml_model_image",
                    "error": str(e),
                })

        return self._combine_results(results)

    # ------------------------------------------------------------------
    # URL pattern matching
    # ------------------------------------------------------------------
    def _analyze_url(self, url: str) -> Dict[str, Any]:
        url_lower = url.lower()
        for category, keywords in self.harmful_categories.items():
            if any(kw in url_lower for kw in keywords):
                return {
                    "harmful": True,
                    "type": category,
                    "confidence": 0.85,
                    "method": "url_pattern_matching",
                }
        return {"harmful": False, "confidence": 0.9, "method": "url_pattern_matching"}

    # ------------------------------------------------------------------
    # Text analysis (RoBERTa hate-speech)
    # ------------------------------------------------------------------
    async def _analyze_content(self, text: str) -> Dict[str, Any]:
        if self.text_model is None or self.text_tokenizer is None:
            return {"harmful": False, "confidence": 0.0, "method": "ml_model_text", "error": "Model not loaded"}
        try:
            inputs = self.text_tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
            with torch.no_grad():
                outputs = self.text_model(**inputs)
                probs = torch.softmax(outputs.logits, dim=1)

            prediction = torch.argmax(probs, dim=1).item()
            confidence = probs[0, prediction].item()

            if prediction == 1:  # 1 = harmful class for this model
                return {"harmful": True, "type": "hate_speech", "confidence": confidence, "method": "ml_model_text"}
            return {"harmful": False, "confidence": confidence, "method": "ml_model_text"}
        except Exception as e:
            logger.error("Error in text analysis: %s", e)
            return {"harmful": False, "confidence": 0.0, "method": "ml_model_text", "error": str(e)}

    # ------------------------------------------------------------------
    # NSFW image classification (Falconsai/nsfw_image_detection)
    # ------------------------------------------------------------------
    async def _analyze_image(self, image: Image.Image) -> Dict[str, Any]:
        """
        Classify an image as NSFW or normal using the Falconsai model.
        The model outputs two classes: 'nsfw' and 'normal'.
        """
        if self.image_model is None or self.image_processor is None:
            return {"harmful": False, "confidence": 0.0, "method": "ml_model_image", "error": "Model not loaded"}
        try:
            inputs = self.image_processor(images=image, return_tensors="pt")

            with torch.no_grad():
                outputs = self.image_model(**inputs)
                probs = torch.softmax(outputs.logits, dim=1)

            # Find the predicted class and its confidence
            prediction = torch.argmax(probs, dim=1).item()
            confidence = probs[0, prediction].item()
            label = self.id2label.get(prediction, "unknown").lower()

            is_nsfw = label == "nsfw"

            return {
                "harmful": is_nsfw,
                "type": "nsfw" if is_nsfw else None,
                "confidence": confidence,
                "label": label,
                "method": "ml_model_image",
            }
        except Exception as e:
            logger.error("Error in NSFW image analysis: %s", e)
            return {"harmful": False, "confidence": 0.0, "method": "ml_model_image", "error": str(e)}

    # ------------------------------------------------------------------
    # Combine results from all passes
    # ------------------------------------------------------------------
    def _combine_results(self, results: list) -> Dict[str, Any]:
        harmful_results = [r for r in results if r.get("harmful", False)]

        if harmful_results:
            most_confident = max(harmful_results, key=lambda x: x.get("confidence", 0))
            harmful = True
            confidence = most_confident.get("confidence", 0)
        else:
            harmful = False
            confidence = max((r.get("confidence", 0) for r in results), default=0)

        types = [r.get("type") for r in results if r.get("type")]

        return {
            "harmful": harmful,
            "confidence": confidence,
            "types": types,
            "methods": [r.get("method") for r in results],
            "details": results,
        }


# ---------------------------------------------------------------------------
# Stand-alone test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import asyncio

    async def test_analyzer():
        analyzer = ImageContentAnalyzer()
        test_cases = [
            {"url": "https://example.com/normal-image.jpg", "text": "This is a normal image", "image_data": None},
            {"url": "https://example.com/nsfw-content-image.jpg", "text": "This is a normal image", "image_data": None},
            {"url": "https://example.com/normal-image.jpg", "text": "I hate this group of people", "image_data": None},
        ]
        for case in test_cases:
            result = await analyzer.analyze(url=case["url"], image_text=case["text"], image_data=case["image_data"])
            print(f"URL: {case['url']}")
            print(f"Text: {case['text']}")
            print(f"Result: {result}")
            print("-" * 50)

    asyncio.run(test_analyzer())