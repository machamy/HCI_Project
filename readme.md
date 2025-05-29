## HCI 프로젝트 AnyRythm
사용자가 노래를 업로드하면, 그에 맞춰서 LLM이 채보를 작성해주는 프로그램
A program where users can upload a song, and an LLM generates a rhythm chart to match the music.

## 실행법 How to Run
### 0. Prerequisites
- Python 3.10+
- Node.js 
### 1. 세팅
backend 폴더에 .env 파일을 만들고 gemini APi를 입력한다.<br>
Create a .env file in the backend folder and add your Gemini API key:<br>
```
GOOGLE_API_KEY= "API Key"
```

### 2.Run the backend:<br>
```
cd backend
.venv\Scripts\activate
uvicorn main:app --reload
```

### 3.Run the frontend:<br>
```
cd frontend
npm run dev
```

