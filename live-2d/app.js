// 导入所需模块
const { ipcRenderer } = require('electron');
const { ModelInteractionController } = require('./js/model/model-interaction.js');
const { configLoader } = require('./js/core/config-loader.js');
const { logToTerminal, setLogConfig } = require('./js/api-utils.js');
const { AppInitializer } = require('./js/app-initializer.js');
const { eventBus } = require('./js/core/event-bus.js');
const { Events } = require('./js/core/events.js');

// 初始化状态管理器（自动通过事件管理状态）
require('./js/core/app-state.js');

// 监听事件，仅用于日志记录
// TTS播放事件日志已注释，避免过多输出
// eventBus.on(Events.TTS_START, () => {
//     logToTerminal('info', '▶️ TTS开始播放');
// });

// eventBus.on(Events.TTS_END, () => {
//     logToTerminal('info', '⏹️ TTS播放结束');
// });

eventBus.on(Events.TTS_INTERRUPTED, () => {
    logToTerminal('info', '⏸️ TTS被中断');
});

// 用户输入开始事件日志已注释，避免与LLM请求日志重复
// eventBus.on(Events.USER_INPUT_START, () => {
//     logToTerminal('info', '🎤 用户输入开始');
// });

// 用户输入结束事件日志已注释，避免过多输出
// eventBus.on(Events.USER_INPUT_END, () => {
//     logToTerminal('info', '✅ 用户输入结束');
// });

eventBus.on(Events.BARRAGE_START, () => {
    logToTerminal('info', '💬 弹幕处理开始');
});

eventBus.on(Events.BARRAGE_END, () => {
    logToTerminal('info', '📝 弹幕处理结束');
});

// 加载配置文件
let config;
try {
    config = configLoader.load();
    console.log('配置文件加载成功');
    console.log('MCP配置:', config.mcp);

    // 应用日志配置
    setLogConfig(config);
    logToTerminal('info', '配置文件加载成功');

    // 检查TTS和ASR配置
    const ttsEnabled = config.tts?.enabled !== false;
    const asrEnabled = config.asr?.enabled !== false;

    console.log(`TTS模块: ${ttsEnabled ? '启用' : '禁用'}`);
    console.log(`ASR模块: ${asrEnabled ? '启用' : '禁用'}`);
    logToTerminal('info', `TTS模块: ${ttsEnabled ? '启用' : '禁用'}`);
    logToTerminal('info', `ASR模块: ${asrEnabled ? '启用' : '禁用'}`);

} catch (error) {
    console.error('配置加载失败:', error);
    logToTerminal('error', `配置加载失败: ${error.message}`);
    alert(`配置文件错误: ${error.message}\n请检查config.json格式是否正确。`);
    throw error;
}

// 添加重新加载配置的全局函数
global.reloadConfig = function() {
    try {
        config = configLoader.load();
        console.log('配置文件已重新加载');
        logToTerminal('info', '配置文件已重新加载');
        return true;
    } catch (error) {
        console.error('重新加载配置文件失败:', error);
        logToTerminal('error', `重新加载配置文件失败: ${error.message}`);
        return false;
    }
}

// 创建模型交互控制器
const modelController = new ModelInteractionController();
global.modelController = modelController; // 添加到全局作用域，供HTTP API访问

// 模块实例（在全局作用域，供其他模块访问）
let voiceChat = null;
let ttsProcessor = null;
let barrageManager = null;

// TTS完成回调 - 弹幕专用
function onBarrageTTSComplete() {
    if (barrageManager) {
        barrageManager.onBarrageTTSComplete();
    }
}

// 增强系统提示词（初始化时使用）
function enhanceSystemPrompt() {
    // 只有启用直播功能时才添加提示词
    if (!config.bilibili || !config.bilibili.enabled) {
        return;
    }

    if (voiceChat && voiceChat.messages && voiceChat.messages.length > 0 && voiceChat.messages[0].role === 'system') {
        const originalPrompt = voiceChat.messages[0].content;

        if (!originalPrompt.includes('你可能会收到直播弹幕')) {
            const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[接收到了直播间的弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[接收到了直播间的弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
            voiceChat.messages[0].content = enhancedPrompt;
            console.log('系统提示已增强，添加了直播弹幕相关说明');
            logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
        }
    }
}

// 主初始化函数
(async function main() {
    try {
        // 创建应用初始化器
        const appInitializer = new AppInitializer(
            config,
            modelController,
            onBarrageTTSComplete,
            enhanceSystemPrompt
        );

        // 执行初始化
        const modules = await appInitializer.initialize();

        // 保存模块引用到全局作用域
        voiceChat = modules.voiceChat;
        ttsProcessor = modules.ttsProcessor;
        barrageManager = modules.barrageManager;

    } catch (error) {
        console.error("加载模型错误:", error);
        console.error("错误详情:", error.message);
        logToTerminal('error', `加载模型错误: ${error.message}`);
        if (error.stack) {
            logToTerminal('error', `错误堆栈: ${error.stack}`);
        }
    }
})();

// 角色列表（与商店数据保持一致）
const characterList = [
    { id: 'feiniu', name: '肥牛', desc: '傲娇系AI桌宠', icon: '🐮', tags: ['官方', '傲娇'] },
    { id: '肥牛', name: '肥牛', desc: '傲娇系AI桌宠', icon: '🐮', tags: ['官方', '傲娇'] },
    { id: 'fuxuan', name: '符玄', desc: '星穹铁道——仙舟太卜司之首', icon: '🔮', tags: ['星穹铁道', '仙舟'] },
    { id: 'kafka', name: '卡芙卡', desc: '星穹铁道——星核猎手成员', icon: '🗡️', tags: ['星穹铁道', '人气王'] },
    { id: 'jingliu', name: '镜流', desc: '星穹铁道——云上五骁之一', icon: '⚔️', tags: ['星穹铁道', '剑首'] },
    { id: 'robin', name: '知更鸟', desc: '星穹铁道——天籁歌者', icon: '🎵', tags: ['星穹铁道', '歌姬'] },
    { id: 'huohuo', name: '藿藿', desc: '星穹铁道——胆小的十王司判官', icon: '👻', tags: ['星穹铁道', '可爱'] },
    { id: 'jian', name: '简', desc: '原创角色——表情丰富的活力少女', icon: '✨', tags: ['原创', '表情丰富'] },
    { id: 'yangyang', name: '秧秧', desc: '原创角色——温柔治愈系少女', icon: '🌸', tags: ['原创', '治愈'] },
    { id: 'nicole', name: 'Nicole', desc: '时尚都市女孩', icon: '💄', tags: ['时尚', '都市'] },
    { id: 'rice', name: 'Rice', desc: '可爱的邻家女孩', icon: '🌾', tags: ['清新', '可爱'] }
];

// 当前选中的角色
let currentCharacter = 'feiniu';

// 渲染角色列表
function renderCharacterList() {
    const list = document.getElementById('character-list');
    if (!list) return;

    list.innerHTML = characterList.map(char => `
        <div class="character-item ${char.id === currentCharacter ? 'active' : ''}" data-id="${char.id}">
            <div class="character-icon">${char.icon}</div>
            <div class="character-info">
                <div class="character-name">${char.name}</div>
                <div class="character-desc">${char.desc}</div>
                <div class="character-tags">
                    ${char.tags.map(tag => `<span class="character-tag">${tag}</span>`).join('')}
                </div>
            </div>
            ${char.id === currentCharacter ? '<span class="character-status">✓ 使用中</span>' : ''}
        </div>
    `).join('');

    // 绑定点击事件
    list.querySelectorAll('.character-item').forEach(item => {
        item.addEventListener('click', () => {
            switchCharacter(item.dataset.id);
        });
    });
}

// 切换角色
async function switchCharacter(characterId) {
    console.log(`切换角色到: ${characterId}`);

    // 通过 IPC 调用主进程的切换角色功能
    try {
        const result = await ipcRenderer.invoke('switch-live2d-model', characterId);
        if (result.success) {
            currentCharacter = characterId;
            renderCharacterList();
            closeCharacterPanel();
        } else {
            alert(`切换失败: ${result.message}`);
        }
    } catch (e) {
        console.error('切换角色时出错:', e);
        alert('切换角色失败，请查看控制台');
    }
}

// 打开/关闭角色面板
function toggleCharacterPanel() {
    const panel = document.getElementById('character-panel');
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        renderCharacterList();
    } else {
        closeCharacterPanel();
    }
}

function closeCharacterPanel() {
    const panel = document.getElementById('character-panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

// 角色选择器按钮事件绑定
document.addEventListener('DOMContentLoaded', () => {
    // 商店按钮
    const marketBtn = document.getElementById('market-btn');
    if (marketBtn) {
        marketBtn.addEventListener('click', () => {
            ipcRenderer.send('open-market');
        });
    }

    // 角色切换按钮
    const charSwitchBtn = document.getElementById('character-switch-btn');
    if (charSwitchBtn) {
        charSwitchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCharacterPanel();
        });
    }

    // 关闭角色面板按钮
    const closePanelBtn = document.getElementById('close-character-panel');
    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', () => {
            closeCharacterPanel();
        });
    }

    // 点击其他地方关闭面板
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('character-panel');
        const switchBtn = document.getElementById('character-switch-btn');
        if (panel && panel.style.display !== 'none') {
            if (!panel.contains(e.target) && !switchBtn.contains(e.target)) {
                closeCharacterPanel();
            }
        }
    });
});


// 商店按钮功能
function initMarketButton() {
    const marketBtnContainer = document.getElementById('market-btn-container');
    const marketBtn = document.getElementById('market-btn');

    // 根据配置显示/隐藏商店按钮
    if (config && config.ui && config.ui.show_market_button === false) {
        if (marketBtnContainer) {
            marketBtnContainer.style.display = 'none';
        }
    } else {
        if (marketBtnContainer) {
            marketBtnContainer.style.display = 'block';
        }
    }

    if (marketBtn) {
        marketBtn.addEventListener('click', () => {
            ipcRenderer.send('open-market');
        });
    }
}

// DOM 可能已经加载完成，直接绑定
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMarketButton);
} else {
    initMarketButton();
}
