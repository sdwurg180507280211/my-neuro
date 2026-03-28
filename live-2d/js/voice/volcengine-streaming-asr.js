// 火山引擎流式语音识别(ASR)模块
const { appState } = require('../core/app-state.js');
const { logToTerminal } = require('../api-utils.js');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const zlib = require('zlib');

// 消息类型
const MessageType = {
    CLIENT_FULL_REQUEST: 0b0001,
    CLIENT_AUDIO_ONLY_REQUEST: 0b0010,
    SERVER_FULL_RESPONSE: 0b1001,
    SERVER_ERROR_RESPONSE: 0b1111
};

// 消息类型标志
const MessageTypeFlags = {
    NO_SEQUENCE: 0b0000,
    POS_SEQUENCE: 0b0001,
    NEG_SEQUENCE: 0b0010,
    NEG_WITH_SEQUENCE: 0b0011
};

// 序列化类型
const SerializationType = {
    NO_SERIALIZATION: 0b0000,
    JSON: 0b0001
};

// 压缩类型
const CompressionType = {
    NO_COMPRESSION: 0b0000,
    GZIP: 0b0001
};

class VolcEngineStreamingASR {
    constructor(config) {
        this.config = config;

        // 火山引擎ASR配置
        const volcConfig = config.cloud?.volc_asr || {};
        this.enabled = volcConfig.enabled || false;
        this.appId = volcConfig.appid || '';
        this.accessKey = volcConfig.accesskey || '';
        this.resourceId = volcConfig.resource_id || 'volc.bigasr.sauc.duration';
        this.language = volcConfig.language || '';

        // 语音打断配置
        this.voiceBargeInEnabled = config.asr?.voice_barge_in || false;

        // 状态标志
        this.isRecording = false;
        this.asrLocked = false;
        this.isConnected = false;
        this.hasInterruptedThisSession = false;

        // 音频参数（与火山要求一致）
        this.SAMPLE_RATE = 16000;
        this.CHANNELS = 1;
        this.CHUNK_MS = 200;  // 火山推荐200ms一包性能最优
        this.CHUNK_SIZE = Math.floor(this.SAMPLE_RATE * this.CHANNELS * 2 * this.CHUNK_MS / 1000);

        // 音频相关
        this.audioContext = null;
        this.mediaStream = null;
        this.ws = null;
        this.scriptNode = null;

        // 回调
        this.onSpeechRecognized = null;
        this.onInterimResult = null;
        this.ttsProcessor = null;

        // 当前临时结果
        this.currentInterimText = '';
        this.sequenceNumber = 0;
        this.lastRecognizedText = '';  // 去重：记录上一次识别的文本
        this.lastRecognizedTime = 0;   // 去重：记录上一次识别时间

        // 重连相关
        this.retryCount = 0;
        this.MAX_RETRIES = 5;
        this.reconnectTimeout = null;
    }

    setTTSProcessor(ttsProcessor) {
        this.ttsProcessor = ttsProcessor;
    }

    setOnSpeechRecognized(callback) {
        this.onSpeechRecognized = callback;
    }

    setOnInterimResult(callback) {
        this.onInterimResult = callback;
    }

    // ========== 火山引擎二进制协议处理 ==========
    // 创建协议头 (4字节)
    createHeader(messageType, messageTypeFlags, serializationMethod, compression) {
        const header = Buffer.alloc(4);

        // Byte 0: Protocol version (4 bits) + Header size (4 bits)
        header[0] = (0b0001 << 4) | 0b0001;  // version 1, header size 4

        // Byte 1: Message type (4 bits) + Message type specific flags (4 bits)
        header[1] = (messageType << 4) | messageTypeFlags;

        // Byte 2: Serialization method (4 bits) + Compression (4 bits)
        header[2] = (serializationMethod << 4) | compression;

        // Byte 3: Reserved
        header[3] = 0x00;

        return header;
    }

    // Gzip 压缩
    gzipCompress(data) {
        return zlib.gzipSync(data);
    }

    // Gzip 解压
    gzipDecompress(data) {
        return zlib.gunzipSync(data);
    }

    // 创建 Full Client Request 帧
    createFullClientRequest(payload, sequenceNumber) {
        const payloadJson = JSON.stringify(payload);
        const payloadBuffer = Buffer.from(payloadJson, 'utf8');
        const compressedPayload = this.gzipCompress(payloadBuffer);

        // Header: message_type=0b0001, flags=0b0001(POS_SEQUENCE), serialization=0b0001(JSON), compression=0b0001(GZIP)
        const header = this.createHeader(
            MessageType.CLIENT_FULL_REQUEST,
            MessageTypeFlags.POS_SEQUENCE,
            SerializationType.JSON,
            CompressionType.GZIP
        );

        // Sequence number (4 bytes, big-endian)
        const seqBuf = Buffer.alloc(4);
        seqBuf.writeUInt32BE(sequenceNumber, 0);

        // Payload size (4 bytes, big-endian)
        const payloadSize = Buffer.alloc(4);
        payloadSize.writeUInt32BE(compressedPayload.length, 0);

        return Buffer.concat([header, seqBuf, payloadSize, compressedPayload]);
    }

    // 创建 Audio Only Request 帧
    createAudioRequest(audioData, sequenceNumber, isLast = false) {
        let flags = MessageTypeFlags.POS_SEQUENCE;
        let seq = sequenceNumber;

        if (isLast) {
            flags = MessageTypeFlags.NEG_WITH_SEQUENCE;
            seq = -sequenceNumber;  // 最后一包设为负值
        }

        // Header: message_type=0b0010, serialization=0b0000(no), compression=0b0001(GZIP)
        const header = this.createHeader(
            MessageType.CLIENT_AUDIO_ONLY_REQUEST,
            flags,
            SerializationType.NO_SERIALIZATION,
            CompressionType.GZIP
        );

        // Sequence number (4 bytes, big-endian)
        const seqBuf = Buffer.alloc(4);
        if (isLast) {
            seqBuf.writeInt32BE(seq, 0);  // 有符号
        } else {
            seqBuf.writeUInt32BE(seq, 0);
        }

        // 压缩音频数据
        const compressedAudio = this.gzipCompress(audioData);

        // Payload size (4 bytes, big-endian)
        const payloadSize = Buffer.alloc(4);
        payloadSize.writeUInt32BE(compressedAudio.length, 0);

        return Buffer.concat([header, seqBuf, payloadSize, compressedAudio]);
    }

    // 解析响应帧
    parseFrame(data) {
        if (data.length < 4) {
            return null;
        }

        const header = data.slice(0, 4);
        let offset = 4;

        // Byte 0: header size
        const headerSize = header[0] & 0x0f;

        // Byte 1: Message type and flags
        const messageType = (header[1] >> 4) & 0x0f;
        const flags = header[1] & 0x0f;

        // Byte 2: Serialization and compression
        const serialization = (header[2] >> 4) & 0x0f;
        const compression = header[2] & 0x0f;

        // Skip header extensions
        offset = headerSize * 4;

        let sequenceNumber = null;
        let isLastPackage = false;
        let event = 0;

        // Parse message_type_specific_flags
        let payload = data.slice(offset);

        if (flags & 0x01) {
            // Has sequence number
            sequenceNumber = payload.readInt32BE(0);
            payload = payload.slice(4);
        }
        if (flags & 0x02) {
            isLastPackage = true;
        }
        if (flags & 0x04) {
            event = payload.readInt32BE(0);
            payload = payload.slice(4);
        }

        let payloadSize = 0;
        let errorCode = 0;
        let payloadMsg = null;

        if (messageType === MessageType.SERVER_FULL_RESPONSE) {
            payloadSize = payload.readUInt32BE(0);
            payload = payload.slice(4);
        } else if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
            errorCode = payload.readInt32BE(0);
            payloadSize = payload.readUInt32BE(4);
            payload = payload.slice(8);
        }

        // Decompress if needed
        if (payload.length > 0 && compression === CompressionType.GZIP) {
            try {
                payload = this.gzipDecompress(payload);
            } catch (e) {
                console.error('解压失败:', e);
            }
        }

        // Parse JSON payload
        if (payload.length > 0 && serialization === SerializationType.JSON) {
            try {
                payloadMsg = JSON.parse(payload.toString('utf8'));
            } catch (e) {
                console.error('解析JSON失败:', e);
            }
        }

        return {
            messageType,
            flags,
            serialization,
            compression,
            sequenceNumber,
            isLastPackage,
            payloadSize,
            payload,
            payloadMsg,
            errorCode,
            code: errorCode,
            event
        };
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }

            const reqId = randomUUID();
            // 使用双向流式优化版 + 二遍识别，既支持实时字幕又输出 definite 分句
            const wsUrl = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

            // 禁用代理，避免 WebSocket 连接被代理干扰
            const originalEnv = {
                http_proxy: process.env.http_proxy,
                https_proxy: process.env.https_proxy,
                HTTP_PROXY: process.env.HTTP_PROXY,
                HTTPS_PROXY: process.env.HTTPS_PROXY,
                all_proxy: process.env.all_proxy,
                ALL_PROXY: process.env.ALL_PROXY,
            };
            delete process.env.http_proxy;
            delete process.env.https_proxy;
            delete process.env.HTTP_PROXY;
            delete process.env.HTTPS_PROXY;
            delete process.env.all_proxy;
            delete process.env.ALL_PROXY;

            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'X-Api-Resource-Id': this.resourceId,
                    'X-Api-Request-Id': reqId,
                    'X-Api-Access-Key': this.accessKey,
                    'X-Api-App-Key': this.appId
                }
            });

            this.ws.onopen = () => {
                logToTerminal('info', '火山引擎ASR WebSocket已连接');
                this.isConnected = true;
                this.retryCount = 0;
                this.sequenceNumber = 1;

                // 发送 Full Client Request
                const requestPayload = {
                    user: {
                        uid: randomUUID()
                    },
                    audio: {
                        format: 'pcm',
                        codec: 'raw',
                        rate: this.SAMPLE_RATE,
                        bits: 16,
                        channel: 1
                    },
                    request: {
                        model_name: 'bigmodel',
                        enable_itn: true,
                        enable_punc: true,
                        enable_ddc: true,
                        show_utterances: true,
                        enable_nonstream: true,  // 开启二遍识别，输出 definite 分句
                        end_window_size: 800,    // VAD 判停时间 800ms
                        result_type: 'single'  // 增量返回，避免重复发送之前的分句
                    }
                };

                // 如果配置了语言，添加语言参数
                if (this.language) {
                    requestPayload.audio.language = this.language;
                }

                const fullRequest = this.createFullClientRequest(requestPayload, this.sequenceNumber);
                this.sequenceNumber++;
                this.ws.send(fullRequest);

                // 恢复环境变量
                Object.entries(originalEnv).forEach(([key, value]) => {
                    if (value !== undefined) {
                        process.env[key] = value;
                    }
                });

                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                // 恢复环境变量
                Object.entries(originalEnv).forEach(([key, value]) => {
                    if (value !== undefined) {
                        process.env[key] = value;
                    }
                });

                this.isConnected = false;

                if (this.isRecording && this.retryCount < this.MAX_RETRIES) {
                    this.retryCount++;
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectWebSocket().catch(console.error);
                    }, 1000);
                }
            };

            this.ws.onerror = (error) => {
                logToTerminal('error', `火山引擎ASR WebSocket错误`);
                reject(error);
            };
        });
    }

    handleMessage(data) {
        try {
            const frame = this.parseFrame(Buffer.from(data));
            if (!frame) return;

            if (frame.messageType === MessageType.SERVER_FULL_RESPONSE) {
                const payloadJson = frame.payloadMsg;
                if (!payloadJson) return;

                const resultText = payloadJson.result?.text || '';
                const utterances = payloadJson.result?.utterances || [];

                // 始终先处理临时结果，显示实时字幕
                if (resultText) {
                    this.currentInterimText = resultText;
                    if (this.onInterimResult && resultText) {
                        this.onInterimResult(resultText);
                    }

                    // 语音打断
                    if (resultText && this.voiceBargeInEnabled) {
                        this.handleVoiceBargeIn();
                    }
                }

                // 查找确定的分句
                const definiteUtterance = utterances.find(u => u.definite === true);

                if (definiteUtterance && definiteUtterance.text) {
                    const finalText = definiteUtterance.text.trim();
                    console.log('🎯 火山ASR识别完成:', finalText);

                    // 去重检查：避免重复识别相同内容
                    const now = Date.now();
                    const isDuplicate = (finalText === this.lastRecognizedText &&
                                       (now - this.lastRecognizedTime) < 3000);

                    if (!isDuplicate && finalText && this.onSpeechRecognized) {
                        this.lastRecognizedText = finalText;
                        this.lastRecognizedTime = now;

                        this.hasInterruptedThisSession = false;
                        this.currentInterimText = '';

                        // 只解锁 asrLocked，保持 isRecording = true（持续录音）
                        this.asrLocked = false;

                        this.onSpeechRecognized(finalText);
                    } else if (isDuplicate) {
                        console.log('🔄 跳过重复识别:', finalText);
                    }
                }
            } else if (frame.messageType === MessageType.SERVER_ERROR_RESPONSE) {
                logToTerminal('error', `火山引擎ASR错误: ${frame.errorCode}`);
                if (frame.payloadMsg) {
                    console.error('错误详情:', frame.payloadMsg);
                }
            }
        } catch (e) {
            console.error('处理火山ASR消息失败:', e);
        }
    }

    handleVoiceBargeIn() {
        if (!this.voiceBargeInEnabled) return;

        if ((appState.isPlayingTTS() || appState.isProcessingUserInput()) &&
            this.ttsProcessor &&
            !this.hasInterruptedThisSession) {

            this.ttsProcessor.interrupt();
            this.hasInterruptedThisSession = true;

            if (this.asrLocked) {
                this.asrLocked = false;
            }
        }
    }

    async startRecording() {
        if (this.isRecording) {
            return;
        }

        try {
            await this.connectWebSocket();

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: this.CHANNELS,
                    sampleRate: this.SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
            const microphone = this.audioContext.createMediaStreamSource(this.mediaStream);

            const bufferSize = 4096;
            this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            microphone.connect(this.scriptNode);
            this.scriptNode.connect(this.audioContext.destination);

            this.audioChunks = [];
            this.scriptNode.onaudioprocess = (e) => {
                if (!this.isRecording || !this.isConnected) return;
                if (this.ws?.readyState !== WebSocket.OPEN) return;

                if (!this.voiceBargeInEnabled && this.asrLocked) return;

                const audioData = e.inputBuffer.getChannelData(0);
                const pcmData = this.float32ToInt16(audioData);

                // 累积到缓冲区
                this.audioChunks.push(pcmData);

                // 检查是否达到200ms（Int16Array每个采样是2字节）
                const totalSamples = this.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const targetSamples = this.SAMPLE_RATE * (this.CHUNK_MS / 1000);  // 200ms的采样点数

                if (totalSamples >= targetSamples) {
                    // 合并并发送
                    const combined = Buffer.concat(this.audioChunks.map(c => Buffer.from(c.buffer)));
                    const audioFrame = this.createAudioRequest(combined, this.sequenceNumber, false);
                    this.ws.send(audioFrame);
                    this.sequenceNumber++;
                    this.audioChunks = [];
                }
            };

            this.isRecording = true;
            this.audioChunks = [];

        } catch (error) {
            logToTerminal('error', `火山引擎ASR启动失败: ${error.message}`);
        }
    }

    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    stopRecording() {
        this.isRecording = false;

        // 发送最后一包
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.audioChunks && this.audioChunks.length > 0) {
            const combined = Buffer.concat(this.audioChunks.map(c => Buffer.from(c.buffer)));
            const audioFrame = this.createAudioRequest(combined, this.sequenceNumber, true);
            this.ws.send(audioFrame);
        }
        this.audioChunks = [];

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.isConnected = false;
    }

    pauseRecording() {
        if (!this.voiceBargeInEnabled) {
            this.asrLocked = true;
        }
    }

    resumeRecording() {
        this.asrLocked = false;
        this.hasInterruptedThisSession = false;
    }

    getVoiceBargeInStatus() {
        return {
            enabled: this.voiceBargeInEnabled,
            isRecording: this.isRecording,
            asrLocked: this.asrLocked,
            isConnected: this.isConnected
        };
    }

    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled;
    }
}

module.exports = { VolcEngineStreamingASR };
