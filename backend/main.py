from fastapi import FastAPI

app = FastAPI(title="Micro CRM API")

@app.get("/health")
async def health():
    return {"status": "ok"}
