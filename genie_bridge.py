"""
Genie-TTS 桥接层 (my-neuro 本地 TTS)

my-neuro 本地 TTS 请求格式: POST {tts.url}  body={"text": "...", "text_language": "zh"}
期望返回: 音频二进制 (wav blob)

Genie server 的 /tts 需要 character_name 且需先预热角色模型。
本桥接层:
  - 启动时后台预热 Genie 内置中文角色「菲比」(feibi)
  - 暴露 POST /  接收 my-neuro 的 {text, text_language}
  - 内部按标点分句逐句合成，再拼接为单段 wav 返回（保持整块契约）
  - 每句带超时保护，偶发空句跳过，避免整次请求卡死/返回 0 字节
端口固定 5001（macOS AirPlay Receiver 默认占用 5000，故改用 5001）。
"""
import os
import re
import io
import wave
import asyncio
import threading
import tempfile
import traceback

# 必须在 import genie_tts 之前设定资源目录，否则其模块加载时会交互式询问是否下载
os.environ.setdefault("GENIE_DATA_DIR", "/Users/edy/ideaProjects/my-neuro/GenieData")

import genie_tts as genie
import struct
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

app = FastAPI()

CHARACTER = "feibi"  # 中文角色：菲比（鸣潮）
_loaded = False
_load_lock = threading.Lock()

# 单句合成超时（秒）。GPT-SoVITS 在 CPU 上每句通常 <15s，留足余量。
PER_SENTENCE_TIMEOUT = 45


def load_character():
    global _loaded
    with _load_lock:
        if _loaded:
            return
        print(f"[bridge] 首次加载 Genie 角色 {CHARACTER}（含下载资源，请稍候）...")
        genie.load_predefined_character(CHARACTER)
        _loaded = True
        print(f"[bridge] 角色 {CHARACTER} 加载完成")


def split_sentences(text: str):
    """按中英文标点分句，保留标点，避免单句过长导致偶发空输出。"""
    parts = re.split(r"(?<=[。！？!?；;，,.])\s*", text)
    return [p.strip() for p in parts if p.strip()]


def synth_sentence(sentence: str) -> bytes:
    """合成单句，返回完整 wav 二进制；失败/空则抛异常由上层处理。"""
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        genie.tts(
            character_name=CHARACTER,
            text=sentence,
            play=False,
            split_sentence=False,
            save_path=tmp,
        )
        if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
            raise RuntimeError(f"empty audio for sentence: {sentence!r}")
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def concat_wav(chunks: list) -> bytes:
    """拼接多段同参数 wav（Genie 固定 32000Hz/mono/16bit）。"""
    if not chunks:
        return b""
    wavs = []
    for c in chunks:
        with wave.open(io.BytesIO(c), "rb") as w:
            wavs.append((w.getparams(), w.readframes(w.getnframes())))
    params, _ = wavs[0]
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setparams(params)
        for _, frames in wavs:
            w.writeframes(frames)
    return out.getvalue()


@app.on_event("startup")
def startup():
    threading.Thread(target=load_character, daemon=True).start()


@app.post("/")
async def tts(request: Request):
    """本地 TTS 流式端点。

    返回帧流（application/octet-stream），每帧格式：
        [4 字节大端长度 N][N 字节 WAV 音频]
    前端按帧切分，每帧是一个完整可播放的句子 WAV，实现边生成边播。
    """
    try:
        data = await request.json()
    except Exception:
        return Response(status_code=400, content=b"bad json")
    text = (data.get("text") or "").strip()
    if not text:
        return Response(status_code=400, content=b"empty text")
    load_character()
    sentences = split_sentences(text) or [text]

    async def frame_generator():
        for s in sentences:
            try:
                wav = await asyncio.wait_for(
                    asyncio.to_thread(synth_sentence, s),
                    timeout=PER_SENTENCE_TIMEOUT,
                )
            except Exception as e:
                traceback.print_exc()
                print(f"[bridge] 跳过失败分句: {s!r} -> {e}")
                continue
            if wav:
                yield struct.pack(">I", len(wav)) + wav

    return StreamingResponse(frame_generator(), media_type="application/octet-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5001)
