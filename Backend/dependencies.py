import os
from fastapi import Header, HTTPException
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_KEY", "default-secret-key")

def verify_api_key(x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return x_api_key
