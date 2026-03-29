const express = require('express');
const { BrowserWindow } = require('electron');
const { MarketManager } = require('../market/market-manager.js');

/**
 * HTTP API 服务器
 * 提供音乐控制和情绪控制的 HTTP 接口
 */
class HttpServer {
    constructor() {
        this.musicApp = null;
        this.emotionApp = null;
        this.marketApp = null;
        this.marketManager = new MarketManager();
    }

    /**
     * 启动所有 HTTP 服务
     */
    start() {
        this.startMusicServer();
        this.startEmotionServer();
        this.startMarketServer();
    }

    /**
     * 启动音乐控制服务器 (端口 3001)
     */
    startMusicServer() {
        this.musicApp = express();
        this.musicApp.use(express.json());

        // 音乐控制接口
        this.musicApp.post('/control-music', (req, res) => {
            const { action, filename } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            let jsCode = '';
            switch (action) {
                case 'play_random':
                    // 直接返回 playRandomMusic 的结果 (Promise)
                    jsCode = 'global.musicPlayer ? global.musicPlayer.playRandomMusic() : { message: "播放器未初始化", metadata: null }';
                    break;
                case 'stop':
                    jsCode = 'global.musicPlayer ? global.musicPlayer.stop() : null; "音乐已停止"';
                    break;
                case 'play_specific':
                    // 直接返回 playSpecificSong 的结果 (Promise)
                    jsCode = `global.musicPlayer ? global.musicPlayer.playSpecificSong('${filename}') : { message: "播放器未初始化", metadata: null }`;
                    break;
                default:
                    return res.json({ success: false, message: '不支持的操作' });
            }

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        this.musicApp.listen(3001, () => {
            console.log('音乐控制服务启动在端口3001');
        });
    }

    /**
     * 启动情绪控制服务器 (端口 3002)
     */
    startEmotionServer() {
        this.emotionApp = express();
        this.emotionApp.use(express.json());

        // 情绪控制接口
        this.emotionApp.post('/control-motion', (req, res) => {
            const { action, emotion_name, motion_index } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            let jsCode = '';

            if (action === 'trigger_emotion') {
                // 调用情绪映射器播放情绪动作
                jsCode = `
                    if (global.emotionMapper && global.emotionMapper.playConfiguredEmotion) {
                        global.emotionMapper.playConfiguredEmotion('${emotion_name}');
                        "触发情绪: ${emotion_name}";
                    } else {
                        "情绪映射器未初始化";
                    }
                `;
            } else if (action === 'trigger_motion') {
                // 保留原有的索引方式（兼容性）
                jsCode = `
                    if (global.emotionMapper && global.emotionMapper.playMotion) {
                        global.emotionMapper.playMotion(${motion_index});
                        "触发动作索引: ${motion_index}";
                    } else {
                        "情绪映射器未初始化";
                    }
                `;
            } else if (action === 'stop_all_motions') {
                // 停止所有动作
                jsCode = `
                    if (currentModel && currentModel.internalModel && currentModel.internalModel.motionManager) {
                        currentModel.internalModel.motionManager.stopAllMotions();
                        if (global.emotionMapper) {
                            global.emotionMapper.playDefaultMotion();
                        }
                        "已停止所有动作";
                    } else {
                        "模型未初始化";
                    }
                `;
            } else {
                return res.json({ success: false, message: '不支持的操作' });
            }

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        

        // 表情控制接口
        this.emotionApp.post('/control-expression', (req, res) => {
            const { expression_name } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            const jsCode = `
                if (global.expressionMapper && global.expressionMapper.triggerExpression) {
                    global.expressionMapper.triggerExpression('${expression_name}');
                    "触发表情: ${expression_name}";
                } else {
                    "表情映射器未初始化";
                }
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });
        
        // 表情绑定接口
        this.emotionApp.post('/bind-expression', (req, res) => {
            const { expression_name, emotion_name } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            const jsCode = `
                if (global.expressionMapper && global.expressionMapper.bindExpressionToEmotion) {
                    const result = global.expressionMapper.bindExpressionToEmotion('${emotion_name}', '${expression_name}');
                    result ? "绑定成功" : "表情已绑定";
                } else {
                    "表情映射器未初始化";
                }
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        // 配置重新加载接口
        this.emotionApp.post('/reload-config', (req, res) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            // 调用前端的配置重新加载函数
            const jsCode = `
                if (global.reloadConfig) {
                    global.reloadConfig();
                    "配置已重新加载";
                } else {
                    "配置重新加载函数未找到";
                }
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        // ===== 插件管理接口 =====

        this.emotionApp.get('/plugins', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            res.json({ success: true, plugins: pm.getPluginList() });
        });

        this.emotionApp.post('/plugins/reload', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            const { name } = req.body || {};
            if (!name) return res.json({ success: false, message: '缺少 name 参数' });
            pm.reload(name)
                .then(() => res.json({ success: true, message: `插件 ${name} 已重载` }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.post('/plugins/reload-all', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            pm.reloadAll()
                .then(() => res.json({ success: true, message: '所有插件已重载' }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.post('/plugins/sync', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            pm.syncEnabledPlugins()
                .then(() => res.json({ success: true, message: '插件列表已同步' }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.listen(3002, () => {
            console.log('情绪控制服务启动在端口3002');
        });
    }

    /**
     * 启动插件/角色市场服务器 (端口 3003)
     */
    startMarketServer() {
        this.marketApp = express();
        this.marketApp.use(express.json());

        // CORS 配置
        this.marketApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                return res.sendStatus(200);
            }
            next();
        });

        // ===== 插件接口 =====

        // 获取插件列表
        this.marketApp.get('/market/plugins', async (req, res) => {
            try {
                const { q, category } = req.query;
                const plugins = await this.marketManager.searchPlugins(q || '', category || 'all');
                res.json({ success: true, data: plugins });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 获取插件详情
        this.marketApp.get('/market/plugins/:id', async (req, res) => {
            try {
                const plugin = await this.marketManager.getPluginDetail(req.params.id);
                if (!plugin) {
                    return res.json({ success: false, message: '插件不存在' });
                }
                res.json({ success: true, data: plugin });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 安装插件
        this.marketApp.post('/market/plugins/:id/install', async (req, res) => {
            try {
                const result = await this.marketManager.installPlugin(req.params.id);

                // 通知前端刷新插件列表
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow) {
                    mainWindow.webContents.executeJavaScript(`
                        if (global.pluginManager) {
                            global.pluginManager.syncEnabledPlugins().catch(console.error);
                        }
                    `).catch(() => {});
                }

                res.json(result);
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 卸载插件
        this.marketApp.post('/market/plugins/:id/uninstall', async (req, res) => {
            try {
                const result = await this.marketManager.uninstallPlugin(req.params.id);

                // 通知前端刷新插件列表
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow) {
                    mainWindow.webContents.executeJavaScript(`
                        if (global.pluginManager) {
                            global.pluginManager.syncEnabledPlugins().catch(console.error);
                        }
                    `).catch(() => {});
                }

                res.json(result);
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // ===== 角色接口 =====

        // 获取角色列表
        this.marketApp.get('/market/characters', async (req, res) => {
            try {
                const { q, category } = req.query;
                const characters = await this.marketManager.searchCharacters(q || '', category || 'all');
                res.json({ success: true, data: characters });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 获取角色详情
        this.marketApp.get('/market/characters/:id', async (req, res) => {
            try {
                const character = await this.marketManager.getCharacterDetail(req.params.id);
                if (!character) {
                    return res.json({ success: false, message: '角色不存在' });
                }
                res.json({ success: true, data: character });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 安装角色
        this.marketApp.post('/market/characters/:id/install', async (req, res) => {
            try {
                const result = await this.marketManager.installCharacter(req.params.id);
                res.json(result);
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 卸载角色
        this.marketApp.post('/market/characters/:id/uninstall', async (req, res) => {
            try {
                const result = await this.marketManager.uninstallCharacter(req.params.id);
                res.json(result);
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // ===== 分类接口 =====

        // 获取所有分类
        this.marketApp.get('/market/categories', async (req, res) => {
            try {
                const data = await this.marketManager.getMarketData();
                res.json({ success: true, data: data.categories });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        // 获取已安装项目
        this.marketApp.get('/market/installed', async (req, res) => {
            try {
                const installed = this.marketManager.getInstalledItems();
                res.json({ success: true, data: installed });
            } catch (e) {
                res.json({ success: false, message: e.message });
            }
        });

        this.marketApp.listen(3003, () => {
            console.log('插件/角色市场服务启动在端口3003');
        });
    }
}

module.exports = { HttpServer };
