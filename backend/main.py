# backend/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv
load_dotenv()

import os, json, uuid, shutil, asyncio
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import librosa, soundfile as sf
import google.genai as genai
import requests

# ────────────── FastAPI & CORS ──────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ────────────── 경로 & 상수 ──────────────
UPLOAD_DIR = "uploads"
CHART_DIR  = "charts"
SONGS_FILE = "songs.json"
MODELS = [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
]
MODEL_NAME = "gemini-2.0-flash"


os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CHART_DIR, exist_ok=True)

# ────────────── songs.json 로드 ─────────────
if os.path.isfile(SONGS_FILE):
    with open(SONGS_FILE, "r", encoding="utf-8") as f:
        songs_data: Dict[str, Dict[str, Any]] = json.load(f)
else:
    songs_data = {}

def save_songs_data() -> None:
    with open(SONGS_FILE, "w", encoding="utf-8") as f:
        json.dump(songs_data, f, ensure_ascii=False, indent=2)

# ────────────── 더미 차트 ─────────────
def generate_dummy_charts() -> Dict[str, Any]:
    base_chaebo = [
        {"time":0.214,"type":"short","position":1},
        {"time":0.429,"type":"short","position":3},
        {"time":0.643,"type":"short","position":2},
        {"time":0.857,"type":"short","position":4},
    ]
    return {f"{k}key": {"maxscore": {"score": 0, "player": "AAA"}, "chaebo": base_chaebo}
            for k in (4, 5, 6)}

# ────────────── 오디오 분석 ─────────────

async def analyze_audio_thread(path: str, slow_rate: float = 0.5, max_onsets: int = 400) -> Dict[str, Any]:
    """
    기존의 analyze_audio를 별도 스레드에서 실행하도록 감싸는 래퍼입니다.
    """
    return await asyncio.to_thread(analyze_audio, path, slow_rate, max_onsets)

def analyze_audio(
    path: str,
    slow_rate: float = 0.5,
    max_onsets: int = 400
) -> Dict[str, Any]:
    """
    MP3/WAV → BPM + onset 리스트(dict) 반환
    slow_rate: 속도 비율 (1.0 = 원속도, 0.5 = 반속도)
    """
    # 1) 원본 신호 로드
    y, sr = librosa.load(path, sr=22050, mono=True)

    # 2) BPM 측정 (원본)
    tempo = librosa.beat.tempo(y=y, sr=sr)[0]
    bpm = float(np.round(tempo, 2))

    # 3) 속도 변경 (pitch-preserving)
    if slow_rate != 1.0:
        y_proc = librosa.effects.time_stretch(y, rate=slow_rate)
    else:
        y_proc = y

    # 4) onset 검출 (느려진 신호 기준)
    onset_frames = librosa.onset.onset_detect(
        y=y_proc,
        sr=sr,
        units="frames",
        backtrack=True
    )
    onset_times_slow = librosa.frames_to_time(onset_frames, sr=sr)

    # 5) pitch·volume 분석 (느려진 신호 기준)
    pitches, magnitudes = librosa.piptrack(y=y_proc, sr=sr)

    # 6) 결과 조합 & 시간 환산 및 반올림
    output = []
    for idx, frame in enumerate(onset_frames):
        # 느려진 시간 → 원래 시간
        t_slow = onset_times_slow[idx]
        t_orig = round(t_slow * slow_rate, 4)

        # pitch & volume
        mag = magnitudes[:, frame]
        if mag.any():
            i = mag.argmax()
            freq = pitches[i, frame]
            midi = int(librosa.hz_to_midi(freq)) if freq > 0 else None
            amp = float(np.clip(mag[i], 0, 1))

            output.append({
                "time": t_orig,
                "pitch": midi,
                "volume": amp
            })

    # 7) 최대 개수 제한 & 반환
    return {
        "bpm": bpm,
        "onsets": output[:max_onsets]
    }

# ────────────── Gemini 호출 ─────────────
def call_gemini_raw(prompt: str) -> Any:
    print("call_gemini_raw")
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("환경 변수 GOOGLE_API_KEY가 설정돼 있지 않습니다.")

    client = genai.Client(api_key=api_key)
    print("Gemini 클라이언트 생성 완료")
    # resp = client.models.generate_content(
    #     model   = MODEL_NAME,
    #     contents= prompt.strip(),
    #     config  = genai.types.GenerateContentConfig(
    #         max_output_tokens=8000,
    #         temperature     =0.3,
    #     )
    # )
    resp = client.models.generate_content(
        model   = MODEL_NAME,
        contents= prompt.strip()
    )
    print("Gemini 응답 수신 완료", resp)
    text = resp.text.strip()
    if not text:
        raise RuntimeError("Gemini 응답이 비어 있습니다.")

    return text

def call_gemini(prompt: str) -> Any:
    global prompt_cnt
    text = call_gemini_raw(prompt)
    print("Gemini 응답1:", text[:100], text[-100:])  # 디버깅용
    # ```json ... ``` 블록 제거
    if text.startswith("```json"):
        print("Detected JSON block, processing...")
        text = text.replace("```","").replace("json","").strip()
    print("Gemini 응답2:", text[:100],"\n\n", text[-100:])  # 디버깅용

    with open(f"gemini_response_{prompt_cnt}.txt", "w", encoding="utf-8") as f:
        f.write(text)
    
    return json.loads(text)

# ────────────── 온셋 분할 & Chaebo 생성 ─────────────
def chunk_onsets(onsets: List[Dict[str, Any]], size: int = 600) -> List[List[Dict[str, Any]]]:
    """
    Splits a list of onset dicts (each with time, pitch, volume) into chunks,
    rounding each time to 4 decimal places but preserving pitch and volume.
    """
    # 1) Round the time field and preserve pitch & volume
    rounded = []
    for o in onsets:
        if "time" not in o:
            continue
        seg = {
            "time": round(o["time"], 4),
            "pitch": o.get("pitch"),
            "volume": o.get("volume")
        }
        rounded.append(seg)

    # 2) Chunk into fixed-size lists
    return [rounded[i : i + size] for i in range(0, len(rounded), size)]

def get_prompt(key: int, bpm: float, onsets: List[float], extra_prompt: str = "") -> str:
    prompt = """
You are a rhythm-game chart generator.
You will receive a set of onsets (timestamps) and a source BPM.

## Task
Return **ONLY** the JSON array (no wrapper) that constitutes the *chaebo* of a **{key}Key** chart.
Example:
[{{"time":0.123,"type":"short","position":2}}, …]

The chart must be playable, fun, and follow these rules:
---
"""
    prompt+=f"""
### 1. Global Constraints
| Item | Rule |
|------|------|
| **Source BPM** | bpm is beat per minute.<br>Use it to calculate note timings. |
| **Onsets** | *place notes **only** at these times; never invent extra timestamps.* |
"""
    prompt+="""
| **Allowed note shapes** | • `{"time":T,"type":"short","position":P}`<br>• `{"time":T,"type":"long","position":P,"end":E}`<br>• `{"time":T,"type":"change_beat","beat":B}` |
| **Key-mode lanes** | 4K → 1 2 3 4  , 5K → 1 2 3 4 5  ,  6K → 1 2 3 4 5 6 |
| **Long / change_beat** | *For now disallow* – generate **short** notes only. |
| **Output** | A single JSON array, no comments / backticks / extra text. Must start with `[` and end with `]`. |

*Feel free to invent new, fun patterns (as long as they respect all checklist rules and remain playable).*
---
### 2. Musical Mapping Guidelines
* **Pitch⇄Lane** – if pitch is different, use different lanes.
  Example motif `D B C B D B E` → lanes `1 2 3 2 3 2 4`.
* **Accents / strong hits** – use **Simultaneous (Chord)** notes (2–3 lanes at same `time`).
* **Variety** – mix multiple patterns; don’t run any one pattern for > 2 s.
    
### 3. Pattern Library (use creatively)
- **Random**
  - **What it is:** It's not a pattern, but a fallback for when no other patterns fit. Or when you want to add some randomness.
  - No specific examples, just put notes at random positions.

- **Trill**  
  - **What it is:** Rapid alternation between exactly two lanes  
  - **Examples (4-key):**  
    `[{"time":0.1000,"type":"short","position":1},{"time":0.2000,"type":"short","position":3},{"time":0.3000,"type":"short","position":1},{"time":0.4000,"type":"short","position":3}]`  
    `[{"time":1.0000,"type":"short","position":2},{"time":1.1500,"type":"short","position":4},{"time":1.3000,"type":"short","position":2},{"time":1.4500,"type":"short","position":4}]`

- **Jump-trill**
    - **What it is:** Similar to Trill, but with Simultaneous notes
    - **Examples (4-key):**
    `[{"time":0.1000,"type":"short","position":1},{"time":0.1000,"type":"short","position":2},{"time":0.3000,"type":"short","position":3},{"time":0.3000,"type":"short","position":4}]` and repeat...

- **Stair**  
  - **What it is:** Stepwise ascend or descend; each note moves ±1 lane  
  - **Examples (4-key):**  
    `[{"time":0.5000,"type":"short","position":2},{"time":0.6000,"type":"short","position":3},{"time":0.7000,"type":"short","position":4}]`  
    `[{"time":2.0000,"type":"short","position":4},{"time":2.2000,"type":"short","position":3},{"time":2.4000,"type":"short","position":2},{"time":2.6000,"type":"short","position":1}]`

- **Simultaneous (Chord)**  
  - **What it is:** 2–3 lanes hit at the same time for accents or surprises  
  - **Constraints:** Do not exceed 3 lanes at once  
  - **Examples (4-key):**  
    `[{"time":0.8000,"type":"short","position":2},{"time":0.8000,"type":"short","position":4}]`  
    `[{"time":3.0000,"type":"short","position":1},{"time":3.0000,"type":"short","position":2},{"time":3.0000,"type":"short","position":3}]`

- **Rapid-fire**  
  - **What it is:** “Machine-gun” burst in one lane  
  - **Constraints:** Do not use this for long sequences, it is not fun to have more than 5 notes in a row in the same lane.
  - **Examples (4-key):**  
    `[{"time":1.0000,"type":"short","position":3},{"time":1.1000,"type":"short","position":3},{"time":1.2000,"type":"short","position":3}]`  
    `[{"time":4.5000,"type":"short","position":2},{"time":4.5800,"type":"short","position":2},{"time":4.6600,"type":"short","position":2},{"time":4.7400,"type":"short","position":2},{"time":4.8200,"type":"short","position":2}]`

- **Axis**  
  - **What it is:** Central lane repeats (≥50% of notes) with occasional side-lane interjections  
  - **Examples (4-key):**  
    `[{"time":1.5000,"type":"short","position":3},{"time":1.6000,"type":"short","position":2},{"time":1.7000,"type":"short","position":3},{"time":1.8000,"type":"short","position":4},{"time":1.9000,"type":"short","position":3}]`  
    `[{"time":5.0000,"type":"short","position":3},{"time":5.2500,"type":"short","position":3},{"time":5.5000,"type":"short","position":2},{"time":5.7500,"type":"short","position":3},{"time":6.0000,"type":"short","position":4}]`

- **Running-man**
    - **What it is:** Rapid-fire on left-most or right-most lane and stair or trill on the other
    - **Examples (4-key):**
    `[{"time":0.1000,"type":"short","position":1},{"time":0.2000,"type":"short","position":2},{"time":0.3000,"type":"short","position":1},{"time":0.4000,"type":"short","position":3},{"time":0.5000,"type":"short","position":1},{"time":0.6000,"type":"short","position":4},{"time":0.7000,"type":"short","position":1}]`


*(Each micro-example is a **valid JSON array**.)*
---
### 4. Chart-Quality Checklist (run before output)
1. Every note `time` value is **exactly** present in **{onsets}**.  
2. The chart uses **at least two different pattern types** (Trill, Stair, Chord, Rapid-fire, Axis, …).  
3. No single pattern continues **longer than 3 s** without change.  
4. No endless linear loops such as 1→2→3→4→1→… .  
5. Include **at least three chord moments** (2–3 lanes at the same `time`).  
6. Generate **only short notes** – no `long` or `change_beat`.  
7. Final output is **strictly the JSON array** (no wrapper, comments, backticks, or extra fields).  
   It must start with `[` and end with `]`.
8. Don’t repeat the same pattern for too long—if the musical progression (pitch contour or rhythmic spacing) changes, switch to a new pattern.
9. The examples for each pattern are only illustrative; their lengths can be chosen freely. 
   For instance, for Simultaneous you might use: at 1.0 s hit lanes 1, 2, 3; at 1.2 s hit lanes 2, 3, 4; at 1.4 s hit lanes 1, 2, 3.
   These also count as pattern combinations, and you are free to mix and match patterns as you like

"""
    prompt +=f"""
### 5. Input Data
Key : {key}
BPM : {bpm}
Onsets : {json.dumps(onsets, ensure_ascii=False)}

*Note: All timestamps are rounded to exactly 4 decimal places. Output times must match this format.*
"""


    if extra_prompt.strip():  # 추가 프롬프트가 있다면
        prompt += f"\n --- \n\n6.Additional instructions:\n{extra_prompt.strip()}"
    prompt +="""\n
### Final Instructions

Before returning, please verify that all 9 items in the Chart-Quality Checklist are satisfied.  
It is absolutely paramount that each pattern delivers electrifying fun—genuine excitement ignites from a driving groove and daring novelty. Dull, repetitive sequences are utterly intolerable.
If there are 6. Additional instructions Section, they must take priority over any other rule or directive. In the event of a conflict, consider only the additional instructions and ignore the conflicting rules.
"""
    return prompt.strip()


prompt_cnt = 0
async def ask_gemini_for_chaebo(key: int, bpm: float, onsets: List[float], extra_prompt: str = "") -> List[Dict[str, Any]]:
    global prompt_cnt
    prompt_cnt += 1
    prompt = get_prompt(key, bpm, onsets, extra_prompt)
    print("Gemini 요청:", prompt)  # 디버깅용
    with open(f"gemini_prompt_{prompt_cnt}.txt", "w", encoding="utf-8") as f:
        f.write(prompt)
    res = await call_gemini_thread(prompt)

    return res


async def build_chart_with_chunks(key: int, summary: Dict[str, Any], extra_prompt: str = "", chunk_size: int = 300) -> Dict[str, Any]:
    global prompt_cnt
    prompt_cnt = 0
    
    bpm     = summary["bpm"]
    onsets  = summary["onsets"]
    chaebo: List[Dict[str, Any]] = []

    # Gemini 호출을 비동기로 병렬 실행
    tasks = [
        asyncio.create_task(ask_gemini_for_chaebo(key, bpm, seg, extra_prompt))
        for seg in chunk_onsets(onsets, chunk_size)
    ]
    for t in tasks:
        try:
            chaebo_part = await t
            chaebo.extend(chaebo_part)
        except Exception as e:
            print("Gemini 세그먼트 오류:", e)

    # 중복 제거 및 시간 순 정렬
    chaebo = sorted(
        {(n["time"], json.dumps(n)): n for n in chaebo}.values(),
        key=lambda x: x["time"]
    )

    return {
        f"{key}key": {
            "maxscore": {"score": 0, "player": "AAA"},
            "chaebo":   chaebo
        }
    }

def call_gemini_blocking(prompt: str) -> Any:
    """
    기존 call_gemini_raw+call_gemini 과정을 합쳐서
    완전히 블로킹으로 실행하는 동기 함수.
    """
    text = call_gemini_raw(prompt)
    # JSON 블록 처리, 디버깅 파일 쓰기, JSON 파싱까지 그대로 둡니다.
    if text.startswith("```json"):
        text = text.replace("```", "").replace("json", "").strip()
    return json.loads(text)

async def call_gemini_thread(prompt: str) -> Any:
    return await asyncio.to_thread(call_gemini_blocking, prompt)

# ────────────── API: 곡 리스트 ─────────────
@app.get("/api/songs")
async def list_songs():
    return {"songs": list(songs_data.values())}

# ────────────── API: 업로드 & 차트 생성 ─────────────
@app.post("/api/upload/")
async def upload_music(
    file: UploadFile = File(...),
    name: str = Form(None),
    key: int = Form(4),  # 4, 5, 6 중 하나
    use_llm: bool = Form(True),
    extra_prompt: str = Form(""),
    slow_rate: float = Form(1.0)
):
    # 1) 파일 형식 검증
    if not file.filename.lower().endswith((".mp3", ".wav")):
        raise HTTPException(400, "지원되지 않는 오디오 형식입니다.")

    # 2) 저장 경로 결정
    song_id       = str(uuid.uuid4())
    original_name = name.strip() if name else Path(file.filename).stem
    save_path     = os.path.join(UPLOAD_DIR, f"{song_id}.mp3")

    # 3) 파일 저장
    with open(save_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    # 4) 차트 생성
    if use_llm:
        try:
            # slow_rate을 analyze_audio에 전달
            summary    = analyze_audio(save_path, slow_rate=slow_rate)
            # LLM 호출 (비동기)
            chart_part = await build_chart_with_chunks(
                key, summary, extra_prompt
            )
            # build_chart_with_chunks_sync 호출 (블로킹 작업이므로 to_thread로 감싸도, 그냥 호출해도 무방)
            # chart_part = await asyncio.to_thread(
            #     build_chart_with_chunks_sync,
            #     4, summary, extra_prompt
            # )
            chart_json = chart_part
        except Exception as e:
            print("LLM 오류:", e)
            chart_json = generate_dummy_charts()
    else:
        chart_json = generate_dummy_charts()

    # 5) 차트 파일로 저장
    chart_path = os.path.join(CHART_DIR, f"{song_id}.json")
    with open(chart_path, "w", encoding="utf-8") as f:
        json.dump(chart_json, f, ensure_ascii=False, indent=2)

    # 6) 메타 정보 갱신
    songs_data[song_id] = {
        "song_id": song_id,
        "original_name": original_name,
        "has4": "4key" in chart_json,
        "has5": "5key" in chart_json,
        "has6": "6key" in chart_json,
    }
    save_songs_data()

    return {"song_id": song_id}

# ────────────── API: 차트 반환 ─────────────
@app.get("/api/chart/{song_id}")
async def get_chart(song_id: str):
    chart_path = os.path.join(CHART_DIR, f"{song_id}.json")
    if not os.path.isfile(chart_path):
        raise HTTPException(404, "차트 파일을 찾을 수 없습니다.")
    with open(chart_path, "r", encoding="utf-8") as f:
        return json.load(f)

# ────────────── API: 음원 스트리밍 ─────────────
@app.get("/api/audio/{song_id}")
async def get_audio(song_id: str):
    path = os.path.join(UPLOAD_DIR, f"{song_id}.mp3")
    if not os.path.isfile(path):
        raise HTTPException(404, "MP3 not found")
    return FileResponse(path, media_type="audio/mpeg", filename=f"{song_id}.mp3")

# ────────────── API: 차트 재생성 ─────────────
@app.post("/api/regenerate/{song_id}")
async def regenerate_chart(
    song_id: str,
    key: int = Form(...),            # 4, 5, 6 중 하나
    use_llm: bool = Form(True),
    extra_prompt: str = Form(""),
    slow_rate: float = Form(1.0)
):
    # 1) 파일 존재 확인
    audio_path = os.path.join(UPLOAD_DIR, f"{song_id}.mp3")
    chart_path = os.path.join(CHART_DIR,  f"{song_id}.json")
    if not os.path.isfile(audio_path) or not os.path.isfile(chart_path):
        raise HTTPException(404, "해당 파일을 찾을 수 없습니다.")

    # 2) 기존 차트 로드
    with open(chart_path, "r", encoding="utf-8") as f:
        chart_json = json.load(f)

    # 3) LLM 으로 재생성 또는 더미
    if use_llm:
        try:
            summary    = analyze_audio(audio_path, slow_rate=slow_rate)
            # chart_part = await asyncio.to_thread(
            #     build_chart_with_chunks_sync,
            #     key, summary, extra_prompt
            # )
            chart_part = await build_chart_with_chunks(
                key, summary, extra_prompt
            )
        except Exception as e:
            print("LLM 오류:", e)
            chart_part = { f"{key}key": generate_dummy_charts()[f"{key}key"] }
    else:
        chart_part = { f"{key}key": generate_dummy_charts()[f"{key}key"] }

    # 4) 해당 Key 차트만 교체
    chart_json[f"{key}key"] = chart_part[f"{key}key"]

    # 5) 파일 덮어쓰기
    with open(chart_path, "w", encoding="utf-8") as f:
        json.dump(chart_json, f, ensure_ascii=False, indent=2)

    # 6) 메타 정보 업데이트
    songs_data[song_id][f"has{key}"] = True
    save_songs_data()

    return {"status": "ok", "message": f"{key}Key 차트를 재생성했습니다."}
# ────────────── API: 그냥 프롬프트 전달 ─────────────
@app.post("/api/prompt/")
async def prompt_raw_call(
    prompt: str = Form(...),
    use_llm: bool = Form(True),
):
    if not use_llm:
        raise HTTPException(400, "use_llm가 False일 때는 이 API를 사용할 수 없습니다.")

    try:
        response = call_gemini_raw(prompt)
    except Exception as e:
        raise HTTPException(500, f"LLM 호출 오류: {str(e)}")

    return {"response": response}


@app.get("/debug/prompt/{prompt_id}")
async def debug_prompt(prompt_id: int):
    try:
        with open(f"gemini_prompt_{prompt_id}.txt", "r", encoding="utf-8") as f:
            return {"prompt": f.read()}
    except FileNotFoundError:
        return {"error": "No such prompt file found."}
    except Exception as e:
        return {"error": f"Error reading prompt file: {str(e)}"}
    
@app.delete("/api/song/{song_id}")
async def delete_song(song_id: str):
    """
    Deletes both audio and chart files for the given song_id,
    and removes its metadata entry.
    """
    audio_path = os.path.join(UPLOAD_DIR, f"{song_id}.mp3")
    chart_path = os.path.join(CHART_DIR,  f"{song_id}.json")

    # 1) 파일 존재 확인
    if not os.path.isfile(audio_path) and not os.path.isfile(chart_path):
        raise HTTPException(404, "해당 song_id의 파일을 찾을 수 없습니다.")

    # 2) 파일 삭제
    if os.path.isfile(audio_path):
        os.remove(audio_path)
    if os.path.isfile(chart_path):
        os.remove(chart_path)

    # 3) 메타데이터에서 제거
    if song_id in songs_data:
        songs_data.pop(song_id)
        save_songs_data()

    return {"status": "ok", "message": f"Song {song_id} has been deleted."}
