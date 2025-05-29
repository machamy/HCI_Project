# backend/main.py
from dotenv import load_dotenv
load_dotenv() 
import os
from google import genai
# ───────────── 경로·파일 상수 ─────────────
UPLOAD_DIR = "uploads"
CHART_DIR  = "charts"
SONGS_FILE = "songs.json"
MODEL_NAME = "gemini-2.0-flash"

# ──────────── Gemini 호출 함수 ────────────
def test():
    """
    prompt(텍스트) → Gemini → JSON(dict) 반환
    실패하면 RuntimeError
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("환경 변수 GOOGLE_API_KEY가 설정돼 있지 않습니다...")

    # ① 클라이언트 생성
    client = genai.Client(api_key=api_key)
    while True:
        # ② 모델 호출
        prompt = input()
        resp = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config= genai.types.GenerateContentConfig(
                max_output_tokens= 2048,
                temperature= 0.3,
            )
        )

        # ③ 응답 텍스트 추출
        text = resp.text.strip()
        print(text)

test()