"""
Pre-download ML models used by Content Guardian.
Run this once before starting the backend to avoid first-request latency.
"""

def main():
    print("Downloading Content Guardian ML models...")
    print("=" * 50)

    # 1. NSFW image detection model
    print("\n[1/3] Downloading Falconsai/nsfw_image_detection...")
    from transformers import AutoImageProcessor, AutoModelForImageClassification
    AutoImageProcessor.from_pretrained("Falconsai/nsfw_image_detection")
    AutoModelForImageClassification.from_pretrained("Falconsai/nsfw_image_detection")
    print("  ✓ NSFW image detection model ready")

    # 2. Hate speech text model
    print("\n[2/3] Downloading facebook/roberta-hate-speech-dynabench-r4-target...")
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    AutoTokenizer.from_pretrained("facebook/roberta-hate-speech-dynabench-r4-target")
    AutoModelForSequenceClassification.from_pretrained("facebook/roberta-hate-speech-dynabench-r4-target")
    print("  ✓ Hate speech text model ready")

    # 3. Toxic-bert for text analyzer
    print("\n[3/3] Downloading unitary/toxic-bert...")
    from transformers import pipeline
    pipeline("text-classification", model="unitary/toxic-bert", top_k=None)
    print("  ✓ Toxic-bert model ready")

    print("\n" + "=" * 50)
    print("All models downloaded successfully!")
    print("You can now start the backend with: python app.py")


if __name__ == "__main__":
    main()