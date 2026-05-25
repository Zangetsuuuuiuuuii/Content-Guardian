import requests
import json

def test_api_root():
    url = "http://localhost:8000/"
    try:
        response = requests.get(url)
        print(f"Status code: {response.status_code}")
        print(f"Response: {response.text[:100]}")  # Show first 100 chars of response
    except Exception as e:
        print(f"Error: {e}")

def test_register_user():
    # Try the /api/register endpoint
    url = "http://localhost:8000/api/register"
    data = {
        "full_name": "Test User",
        "email": "test@example.com",
        "password": "password123",
        "role": "user",
        "age": 25
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, data=json.dumps(data), headers=headers)
        print(f"Status code: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    print("Testing root endpoint...")
    test_api_root()
    print("\nTesting register endpoint...")
    test_register_user() 