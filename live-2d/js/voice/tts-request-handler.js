// tts-request-handler.js - TTS请求处理器
// 职责：文本翻译、TTS API调用、文本分段

const { logToTerminal } = require('../api-utils.js');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');

class TTSRequestHandler {
    constructor(config, ttsUrl) {
        this.config = config;
        this.language = config.tts?.language || "zh";

        // 统一网关模式配置
        const gatewayConfig = config.api_gateway || {};
        if (gatewayConfig.use_gateway) {
            this.ttsUrl = `${gatewayConfig.base_url}/tts/synthesize`;
            this.apiKey = gatewayConfig.api_key || "";
            this.useGateway = true;
        } else {
            this.ttsUrl = ttsUrl;
            this.apiKey = null;
            this.useGateway = false;
        }

        // 阿里云TTS配置
        const aliyunTts = config.cloud?.aliyun_tts || {};
        this.aliyunTtsEnabled = aliyunTts.enabled || false;
        this.aliyunApiKey = aliyunTts.api_key || "";
        this.aliyunModel = aliyunTts.model || "cosyvoice-v3-flash";
        this.aliyunVoice = aliyunTts.voice || "";
        this.aliyunSampleRate = aliyunTts.sample_rate || 48000;
        this.aliyunVolume = aliyunTts.volume ?? 50;
        this.aliyunRate = aliyunTts.rate ?? 1;
        this.aliyunPitch = aliyunTts.pitch ?? 1;

        // 火山引擎豆包TTS配置
        const volcTts = config.cloud?.volc_tts || {};
        this.volcTtsEnabled = volcTts.enabled || false;
        this.volcAppId = volcTts.appid || "";
        this.volcAccessKey = volcTts.accesskey || "";
        this.volcSecretKey = volcTts.secretkey || "";
        this.volcVoice = volcTts.voice || "";
        this.volcResourceId = volcTts.resource_id || "seed-tts-2.0";
        this.volcSampleRate = volcTts.sample_rate || 24000;

        console.log('🔊 火山TTS配置:', {
            enabled: this.volcTtsEnabled,
            appid: this.volcAppId,
            accesskey: this.volcAccessKey ? this.volcAccessKey.substring(0, 10) + '...' : '未配置',
            resource_id: this.volcResourceId,
            voice: this.volcVoice
        });

        // 云服务商配置（SiliconFlow等，保留兼容）
        this.cloudTtsEnabled = config.cloud?.tts?.enabled || false;
        this.cloudTtsUrl = config.cloud?.tts?.url || "";
        this.cloudApiKey = config.cloud?.api_key || "";
        this.cloudTtsModel = config.cloud?.tts?.model || "";
        this.cloudTtsVoice = config.cloud?.tts?.voice || "";
        this.cloudTtsFormat = config.cloud?.tts?.response_format || "mp3";
        this.cloudTtsSpeed = config.cloud?.tts?.speed || 1.0;

        // 翻译配置
        this.translationEnabled = config.translation?.enabled || false;
        this.translationApiKey = config.translation?.api_key || "";
        this.translationApiUrl = config.translation?.api_url || "";
        this.translationModel = config.translation?.model || "";
        this.translationSystemPrompt = config.translation?.system_prompt || "";

        // 标点符号
        this.punctuations = [',', '。', '，', '？', '!', '！', '；', ';', '：', ':'];
        this.pendingSegment = '';

        // 请求管理
        this.activeRequests = new Set();
        this.requestIdCounter = 0;
    }

    // 翻译文本
    async translateText(text) {
        if (!this.translationEnabled || !text.trim()) return text;

        try {
            const response = await fetch(`${this.translationApiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.translationApiKey}`
                },
                body: JSON.stringify({
                    model: this.translationModel,
                    messages: [
                        { role: 'system', content: this.translationSystemPrompt },
                        { role: 'user', content: text }
                    ],
                    stream: false
                }),
            });

            if (!response.ok) throw new Error(`翻译API错误: ${response.status}`);

            const data = await response.json();
            return data.choices[0].message.content.trim();
        } catch (error) {
            console.error('翻译失败:', error);
            return text;
        }
    }

    // 将文本转换为语音
    async convertTextToSpeech(text) {
        const requestId = ++this.requestIdCounter;
        const controller = new AbortController();
        const requestInfo = { id: requestId, controller };
        this.activeRequests.add(requestInfo);

        try {
            // 清理文本
            const textForTTS = text
                .replace(/<[^>]+>/g, '')
                .replace(/（.*?）|\(.*?\)/g, '')
                .replace(/\*.*?\*/g, '');

            // 清理后无实际文字内容则跳过（纯标点、空白等）
            const hasContent = textForTTS.replace(/[,，。？?!！；;：:、…—\-\s]/g, '').trim();
            if (!hasContent) return null;

            // 插件 onTTSText 钩子（仅影响TTS音频，字幕保持原文）
            const finalTextForTTS = global.pluginManager
                ? await global.pluginManager.runTTSTextHooks(textForTTS)
                : await this.translateText(textForTTS);

            // 调用TTS API
            if (this.volcTtsEnabled) {
                console.log('🎤 使用火山引擎豆包TTS');
                // 火山引擎豆包TTS（WebSocket二进制双向流式）
                const audioBuffer = await this.volcTtsSynthesize(finalTextForTTS, controller.signal);
                if (!audioBuffer) return null;
                // 火山返回原始PCM，需要包装成WAV容器
                const wavBuffer = this.pcmToWav(audioBuffer, this.volcSampleRate, 1);
                return new Blob([wavBuffer], { type: 'audio/wav' });
            } else if (this.aliyunTtsEnabled) {
                // 阿里云TTS（WebSocket模式）
                const audioBuffer = await this.aliyunSynthesize(finalTextForTTS, controller.signal);
                if (!audioBuffer) return null;
                return new Blob([audioBuffer], { type: 'audio/wav' });
            } else if (this.cloudTtsEnabled) {
                // 云服务商模式（SiliconFlow等）
                const response = await fetch(this.cloudTtsUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.cloudApiKey}`
                    },
                    body: JSON.stringify({
                        model: this.cloudTtsModel,
                        voice: this.cloudTtsVoice,
                        input: finalTextForTTS,
                        response_format: this.cloudTtsFormat,
                        speed: this.cloudTtsSpeed
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    await this.handleTTSError(response, '云端TTS');
                }
                return await response.blob();
            } else {
                // 本地模式或统一网关模式
                const headers = { 'Content-Type': 'application/json' };

                // 如果使用统一网关，添加 X-API-Key
                if (this.useGateway && this.apiKey) {
                    headers['X-API-Key'] = this.apiKey;
                }

                const response = await fetch(this.ttsUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        text: finalTextForTTS,
                        text_language: this.language
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    await this.handleTTSError(response, this.useGateway ? '云端肥牛网关TTS' : '本地TTS');
                }
                return await response.blob();
            }
        } catch (error) {
            if (error.name === 'AbortError') return null;
            console.error('TTS转换错误:', error);
            return null;
        } finally {
            this.activeRequests.delete(requestInfo);
        }
    }

    // 流式文本分段
    segmentStreamingText(text, queue) {
        this.pendingSegment += text;

        let processedSegment = '';
        for (let i = 0; i < this.pendingSegment.length; i++) {
            const char = this.pendingSegment[i];
            processedSegment += char;

            if (this.punctuations.includes(char) && processedSegment.trim()) {
                queue.push(processedSegment);
                processedSegment = '';
            }
        }

        this.pendingSegment = processedSegment;
    }

    // 完成流式分段
    finalizeSegmentation(queue) {
        if (this.pendingSegment.trim()) {
            queue.push(this.pendingSegment);
            this.pendingSegment = '';
        }
    }

    // 完整文本分段
    segmentFullText(text, queue) {
        let currentSegment = '';
        for (let char of text) {
            currentSegment += char;
            if (this.punctuations.includes(char) && currentSegment.trim()) {
                queue.push(currentSegment);
                currentSegment = '';
            }
        }

        if (currentSegment.trim()) {
            queue.push(currentSegment);
        }
    }

    // 阿里云TTS WebSocket合成
    aliyunSynthesize(text, abortSignal) {
        return new Promise((resolve, reject) => {
            const taskId = randomUUID();
            const audioChunks = [];
            let settled = false;

            const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
                headers: { 'Authorization': `bearer ${this.aliyunApiKey}` }
            });

            // 支持 AbortController 取消
            const onAbort = () => {
                if (!settled) {
                    settled = true;
                    ws.close();
                    resolve(null);
                }
            };
            if (abortSignal) {
                if (abortSignal.aborted) { resolve(null); return; }
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            const cleanup = () => {
                if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
            };

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
                    payload: {
                        task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer',
                        model: this.aliyunModel,
                        parameters: {
                            text_type: 'PlainText',
                            voice: this.aliyunVoice,
                            format: 'wav',
                            sample_rate: this.aliyunSampleRate,
                            volume: this.aliyunVolume,
                            rate: this.aliyunRate,
                            pitch: this.aliyunPitch
                        },
                        input: {}
                    }
                }));
            });

            ws.on('message', (data, isBinary) => {
                if (settled) return;

                if (isBinary) {
                    audioChunks.push(data);
                    return;
                }

                const msg = JSON.parse(data.toString());
                const event = msg?.header?.event;

                if (event === 'task-started') {
                    ws.send(JSON.stringify({
                        header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
                        payload: { input: { text } }
                    }));
                    ws.send(JSON.stringify({
                        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                        payload: { input: {} }
                    }));
                } else if (event === 'task-finished') {
                    settled = true;
                    cleanup();
                    ws.close();
                    resolve(Buffer.concat(audioChunks));
                } else if (event === 'task-failed') {
                    settled = true;
                    cleanup();
                    ws.close();
                    const errMsg = `阿里云TTS失败: ${JSON.stringify(msg)}`;
                    logToTerminal('error', errMsg);
                    reject(new Error(errMsg));
                }
            });

            ws.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    logToTerminal('error', `阿里云TTS WebSocket错误: ${err.message}`);
                    reject(err);
                }
            });
        });
    }

    // 创建火山TTS二进制帧
    volcCreateFrame(messageType, flags, eventNumber, payloadJson, sessionId = '') {
        const buffer = [];
        buffer.push(0x11);
        buffer.push((messageType << 4) | flags);
        buffer.push(0x10);
        buffer.push(0x00);

        if ((flags & 0b0100) !== 0 && eventNumber !== null) {
            const eventBuf = Buffer.alloc(4);
            eventBuf.writeInt32BE(eventNumber, 0);
            buffer.push(...eventBuf);
        }

        if ((flags & 0b0100) !== 0 && sessionId && eventNumber !== 1 && eventNumber !== 2 && eventNumber !== 50 && eventNumber !== 51) {
            const sessionIdBuf = Buffer.from(sessionId, 'utf8');
            const sizeBuf = Buffer.alloc(4);
            sizeBuf.writeUInt32BE(sessionIdBuf.length, 0);
            buffer.push(...sizeBuf);
            if (sessionIdBuf.length > 0) {
                buffer.push(...sessionIdBuf);
            }
        }

        const payloadBuf = payloadJson ? Buffer.from(JSON.stringify(payloadJson), 'utf8') : Buffer.alloc(0);
        const payloadSizeBuf = Buffer.alloc(4);
        payloadSizeBuf.writeUInt32BE(payloadBuf.length, 0);
        buffer.push(...payloadSizeBuf);
        if (payloadBuf.length > 0) {
            buffer.push(...payloadBuf);
        }

        return Buffer.from(buffer);
    }

    // 解析火山TTS二进制帧
    volcParseFrame(buffer) {
        const header = buffer.readUInt32BE(0);
        const messageType = (header >> 20) & 0xF;
        const flags = (header >> 16) & 0xF;
        const hasEvent = (flags & 0b0100) !== 0;

        let offset = 4;
        let eventNumber = null;
        let sessionId = null;

        if (hasEvent) {
            eventNumber = buffer.readUInt32BE(offset);
            offset += 4;

            // 读取 Session ID（如果有）
            if (eventNumber !== 1 && eventNumber !== 2 &&
                eventNumber !== 50 && eventNumber !== 51) {
                const sessionIdLen = buffer.readUInt32BE(offset);
                offset += 4;
                if (sessionIdLen > 0) {
                    sessionId = buffer.toString('utf8', offset, offset + sessionIdLen);
                    offset += sessionIdLen;
                }
            }
        }

        // 读取 payload 长度和内容
        const payloadLen = buffer.readUInt32BE(offset);
        offset += 4;
        let payload = null;
        if (payloadLen > 0) {
            payload = buffer.slice(offset, offset + payloadLen);
        }

        return { messageType, flags, eventNumber, sessionId, payload };
    }

    // 火山引擎豆包TTS WebSocket二进制双向流式合成
    async volcTtsSynthesize(text, abortSignal) {
        // 检查是否已取消
        if (abortSignal && abortSignal.aborted) {
            return null;
        }

        // 每次新建连接，避免状态污染（简单可靠）
        let ws = null;
        let settled = false;
        const audioChunks = [];
        const sessionId = randomUUID();

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

        try {
            return await new Promise((resolve, reject) => {
                const connectId = randomUUID().replace(/-/g, '').substring(0, 16);
                const wsUrl = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
                const headers = {
                    'X-Api-App-Key': this.volcAppId,
                    'X-Api-Access-Key': this.volcAccessKey,
                    'X-Api-Resource-Id': this.volcResourceId,
                    'X-Api-Connect-Id': connectId
                };

                ws = new WebSocket(wsUrl, { headers });

                // Abort 处理
                const onAbort = () => {
                    if (!settled) {
                        settled = true;
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                        resolve(null);
                    }
                };

                if (abortSignal) {
                    abortSignal.addEventListener('abort', onAbort, { once: true });
                }

                const cleanup = () => {
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                };

                ws.on('open', () => {
                    if (settled) return;
                    logToTerminal('info', '火山TTS WebSocket已连接');

                    // 1. 发送 StartConnection
                    const startConnPayload = {};
                    const startConnFrame = this.volcCreateFrame(0b0001, 0b0100, 1, startConnPayload);
                    ws.send(startConnFrame);
                });

                ws.on('message', (data) => {
                    if (settled) return;

                    try {
                        const frame = this.volcParseFrame(Buffer.from(data));

                        if (frame.eventNumber === 50) {
                            // ConnectionStarted - 发送 StartSession
                            const startSessionPayload = {
                                user: { uid: randomUUID() },
                                namespace: 'BidirectionalTTS',
                                event: 100,
                                req_params: {
                                    speaker: this.volcVoice,
                                    audio_params: {
                                        format: 'pcm',
                                        sample_rate: this.volcSampleRate
                                    }
                                }
                            };
                            const startSessionFrame = this.volcCreateFrame(0b0001, 0b0100, 100, startSessionPayload, sessionId);
                            ws.send(startSessionFrame);
                        }
                        else if (frame.eventNumber === 150) {
                            // SessionStarted - 发送文本
                            logToTerminal('info', '火山TTS: 会话已开始，发送请求文本');
                            const taskPayload = {
                                user: { uid: randomUUID() },
                                namespace: 'BidirectionalTTS',
                                event: 200,
                                req_params: {
                                    text: text,
                                    speaker: this.volcVoice,
                                    audio_params: {
                                        format: 'pcm',
                                        sample_rate: this.volcSampleRate
                                    }
                                }
                            };
                            const taskFrame = this.volcCreateFrame(0b0001, 0b0100, 200, taskPayload, sessionId);
                            ws.send(taskFrame);

                            // 发送 FinishSession
                            const finishSessionPayload = {
                                user: { uid: randomUUID() },
                                namespace: 'BidirectionalTTS',
                                event: 102
                            };
                            const finishSessionFrame = this.volcCreateFrame(0b0001, 0b0100, 102, finishSessionPayload, sessionId);
                            ws.send(finishSessionFrame);
                        }
                        else if (frame.eventNumber === 152) {
                            // SessionFinished - 完成
                            logToTerminal('info', '火山TTS: 会话结束');
                            settled = true;
                            cleanup();
                            ws.close();
                            resolve(Buffer.concat(audioChunks));
                        }
                        else if (frame.eventNumber === 151 || frame.eventNumber === 153) {
                            // SessionCanceled or Failed
                            let errMsg = '火山TTS会话失败';
                            try {
                                const errJson = JSON.parse(frame.payload.toString('utf8'));
                                errMsg = `火山TTS失败: ${JSON.stringify(errJson)}`;
                            } catch(e) {}
                            logToTerminal('error', errMsg);
                            settled = true;
                            cleanup();
                            ws.close();
                            reject(new Error(errMsg));
                        }
                        else if (frame.messageType === 0b1011) {
                            // Audio-only - PCM 数据
                            audioChunks.push(frame.payload);
                        }
                        else if (frame.messageType === 0b1111) {
                            // Error
                            let errMsg = '火山TTS错误';
                            try {
                                const errJson = JSON.parse(frame.payload.toString('utf8'));
                                errMsg = `火山TTS失败: ${JSON.stringify(errJson, null, 2)}`;
                            } catch(e) {
                                errMsg = `火山TTS错误: ${frame.payload ? frame.payload.toString('utf8') : ''}`;
                            }
                            logToTerminal('error', errMsg);
                            settled = true;
                            cleanup();
                            ws.close();
                            reject(new Error(errMsg));
                        }
                    } catch (e) {
                        logToTerminal('error', `火山TTS处理错误: ${e.message}`);
                    }
                });

                ws.on('error', (err) => {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        logToTerminal('error', `火山TTS WebSocket错误: ${err.message}`);
                        reject(err);
                    }
                });

                ws.on('close', (code) => {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        if (audioChunks.length > 0) {
                            resolve(Buffer.concat(audioChunks));
                        } else {
                            reject(new Error(`火山TTS连接提前关闭，code: ${code}`));
                        }
                    }
                });
            });
        } finally {
            // 确保连接关闭
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            // 恢复环境变量
            Object.entries(originalEnv).forEach(([key, value]) => {
                if (value !== undefined) {
                    process.env[key] = value;
                }
            });
        }
    }

    // PCM原始数据转换为WAV容器
    pcmToWav(pcmBuffer, sampleRate, channels) {
        const bytesPerSample = 2; // 16-bit PCM
        const byteRate = sampleRate * channels * bytesPerSample;
        const bufferSize = 44 + pcmBuffer.length;
        const wavBuffer = Buffer.alloc(bufferSize);

        // RIFF identifier
        wavBuffer.write('RIFF', 0, 'ascii');
        // file length
        wavBuffer.writeUInt32LE(bufferSize - 8, 4);
        // RIFF type
        wavBuffer.write('WAVE', 8, 'ascii');
        // format chunk identifier
        wavBuffer.write('fmt ', 12, 'ascii');
        // format chunk length
        wavBuffer.writeUInt32LE(16, 16);
        // sample format (raw)
        wavBuffer.writeUInt16LE(1, 20);
        // channel count
        wavBuffer.writeUInt16LE(channels, 22);
        // sample rate
        wavBuffer.writeUInt32LE(sampleRate, 24);
        // byte rate
        wavBuffer.writeUInt32LE(byteRate, 28);
        // block align
        wavBuffer.writeUInt16LE(channels * bytesPerSample, 32);
        // bits per sample
        wavBuffer.writeUInt16LE(bytesPerSample * 8, 34);
        // data chunk identifier
        wavBuffer.write('data', 36, 'ascii');
        // data length
        wavBuffer.writeUInt32LE(pcmBuffer.length, 40);

        // copy PCM data
        pcmBuffer.copy(wavBuffer, 44);

        return wavBuffer;
    }

    // 中止所有请求
    abortAllRequests() {
        this.activeRequests.forEach(req => req.controller.abort());
        this.activeRequests.clear();
    }

    // 重置状态
    reset() {
        this.pendingSegment = '';
        this.abortAllRequests();
    }

    // 获取待处理片段
    getPendingSegment() {
        return this.pendingSegment;
    }

    // 统一的TTS错误处理
    async handleTTSError(response, serviceName) {
        let errorDetail = "";
        try {
            const errorBody = await response.text();
            try {
                const errorJson = JSON.parse(errorBody);
                errorDetail = JSON.stringify(errorJson, null, 2);
            } catch (e) {
                errorDetail = errorBody;
            }
        } catch (e) {
            errorDetail = "无法读取错误详情";
        }

        let errorMessage = "";
        switch (response.status) {
            case 401:
                errorMessage = `【${serviceName}】API密钥验证失败，请检查你的API密钥是否正确`;
                break;
            case 403:
                errorMessage = `【${serviceName}】API访问被禁止，你的账号可能被限制或额度已用完`;
                break;
            case 429:
                errorMessage = `【${serviceName}】请求过于频繁，超出API限制或额度已用完`;
                break;
            case 500:
            case 502:
            case 503:
            case 504:
                errorMessage = `【${serviceName}】服务器错误，AI服务当前不可用`;
                break;
            default:
                errorMessage = `【${serviceName}】API错误: ${response.status} ${response.statusText}`;
        }

        const fullError = `${errorMessage}\n详细信息: ${errorDetail}`;
        logToTerminal('error', fullError);
        throw new Error(errorMessage);
    }
}

module.exports = { TTSRequestHandler };
