import asyncio
import aiohttp
from image_analyzer import ImageContentAnalyzer
import os
from PIL import Image
import io

async def download_image(url: str) -> bytes:
    """Download image from URL."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status != 200:
                raise Exception(f"Failed to download image: HTTP {response.status}")
            return await response.read()

async def main():
    # Initialize analyzer
    analyzer = ImageContentAnalyzer()
    print("Initialized Image Content Analyzer")
    print("-" * 50)

    # Test cases with real images
    test_cases = [
        {
            "url": "https://picsum.photos/200/300",  # Random safe image from Lorem Picsum
            "text": "A beautiful landscape photo",
            "description": "Safe image test"
        },
        {
            "url": "https://picsum.photos/200/300",  # Another random image
            "text": "I hate people who don't appreciate nature!!! They should all disappear!",
            "description": "Safe image with harmful text"
        }
    ]

    # Run tests
    for case in test_cases:
        print(f"\nTesting: {case['description']}")
        print(f"URL: {case['url']}")
        print(f"Text: {case['text']}")
        
        try:
            # Download image
            print("Downloading image...")
            image_data = await download_image(case['url'])
            
            # Verify image data
            try:
                Image.open(io.BytesIO(image_data)).verify()
                print("Image verified successfully")
            except Exception as e:
                print(f"Invalid image data: {str(e)}")
                continue
            
            # Analyze content
            print("Analyzing content...")
            result = await analyzer.analyze(
                url=case['url'],
                image_text=case['text'],
                image_data=image_data
            )
            
            # Print results
            print("\nResults:")
            print(f"Harmful: {result['harmful']}")
            print(f"Confidence: {result['confidence']:.2f}")
            print(f"Detected Types: {', '.join(result['types']) if result['types'] else 'None'}")
            print(f"Methods Used: {', '.join(result['methods'])}")
            print("\nDetailed Results:")
            for detail in result['details']:
                print(f"- Method: {detail['method']}")
                print(f"  Harmful: {detail['harmful']}")
                print(f"  Confidence: {detail['confidence']:.2f}")
                if 'type' in detail:
                    print(f"  Type: {detail['type']}")
                
        except Exception as e:
            print(f"Error processing test case: {str(e)}")
        
        print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main()) 