import os
import ssl
import urllib3
import httpx
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq

load_dotenv()

# Global SSL verification bypass for dev/lab on restricted networks
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

urllib3.disable_warnings()

# Custom httpx clients skipping SSL validation for Groq
custom_async_client = httpx.AsyncClient(verify=False)
custom_sync_client = httpx.Client(verify=False)

# Initialize Gemini for Heavy Synthesis (LangGraph)
gemini_llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash", # Using the corrected model name (left untouched as requested)
    api_key=os.getenv("GOOGLE_API_KEY"),
    client_args={"verify": False}
)

# Initialize Groq for Real-Time Latency (Ambiguity Detection)
groq_llm = ChatGroq(
    model="groq/compound", 
    api_key=os.getenv("GROQ_API_KEY"),
    max_tokens=150,
    temperature=0.2,
    max_retries=1,
    http_client=custom_sync_client,
    http_async_client=custom_async_client
).bind(response_format={"type": "json_object"})

