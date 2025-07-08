import os
import requests
import shutil
from pathlib import Path

def download_file(url: str, destination: str):
    """Download a file from URL to destination."""
    response = requests.get(url, stream=True)
    response.raise_for_status()
    
    with open(destination, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

def main():
    # Create models directory
    model_dir = Path("nsfw_model")
    model_dir.mkdir(exist_ok=True)
    
    # Download NSFW model files
    model_files = {
        "deploy.prototxt": "https://raw.githubusercontent.com/yahoo/open_nsfw/master/nsfw_model/deploy.prototxt",
        "resnet_50_1by2_nsfw.caffemodel": "https://github.com/yahoo/open_nsfw/raw/master/nsfw_model/resnet_50_1by2_nsfw.caffemodel"
    }
    
    for filename, url in model_files.items():
        destination = model_dir / filename
        print(f"Downloading {filename}...")
        download_file(url, destination)
        print(f"Downloaded {filename} to {destination}")

if __name__ == "__main__":
    main() 