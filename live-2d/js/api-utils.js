// api-utils.js - API相关工具函数模块
const fs = require('fs');
const path = require('path');

// 日志配置（会从全局config更新）
let logConfig = {
    show_console: true,
    show_debug: false,
    show_info: true,
    show_warn: true,
    show_error: true,
    write_to_file: false,
    log_file_path: 'runtime.log'
};

// 更新日志配置
function setLogConfig(config) {
    if (config && config.logging) {
        logConfig = { ...logConfig, ...config.logging };
    }
}

// 终端日志记录函数 - 普通日志
function logToTerminal(level, message) {
    // 🔥 优化：由于console已经被hook拦截自动写入文件，这里只需要调用console即可
    // 不再重复写入文件，避免日志重复（修复每条日志出现两次的问题）
    switch (level) {
        case 'debug':
            console.debug(message);
            break;
        case 'info':
            console.info(message);
            break;
        case 'warn':
            console.warn(message);
            break;
        case 'error':
            console.error(message);
            break;
        default:
            console.log(message);
            break;
    }
}

// 工具日志记录函数 - 专用于工具调用相关日志
function logToolAction(level, message) {
    // 🔥 优化：由于console已经被hook拦截自动写入文件，这里只需要调用console即可
    const prefixedMessage = `[TOOL] ${message}`;
    switch (level) {
        case 'debug':
            console.debug(prefixedMessage);
            break;
        case 'info':
            console.info(prefixedMessage);
            break;
        case 'warn':
            console.warn(prefixedMessage);
            break;
        case 'error':
            console.error(prefixedMessage);
            break;
        default:
            console.log(prefixedMessage);
            break;
    }
}

// 统一的API错误处理工具函数
async function handleAPIError(response) {
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

    logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);

    let errorMessage = "";
    switch (response.status) {
        case 401:
            errorMessage = "API密钥验证失败，请检查你的API密钥";
            break;
        case 403:
            errorMessage = "API访问被禁止，你的账号可能被限制";
            break;
        case 404:
            errorMessage = "API接口未找到，请检查API地址";
            break;
        case 429:
            errorMessage = "请求过于频繁，超出API限制";
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            errorMessage = "服务器错误，AI服务当前不可用";
            break;
        default:
            errorMessage = `API错误: ${response.status} ${response.statusText}`;
    }

    throw new Error(`${errorMessage}\n详细信息: ${errorDetail}`);
}

// 统一的工具列表合并函数
function getMergedToolsList() {
    let allTools = [];

    // 添加本地Function Call工具
    if (global.localToolManager && global.localToolManager.isEnabled) {
        const localTools = global.localToolManager.getToolsForLLM();
        if (localTools && localTools.length > 0) {
            allTools.push(...localTools);
        }
    }

    // 添加MCP工具
    if (global.mcpManager && global.mcpManager.isEnabled) {
        const mcpTools = global.mcpManager.getToolsForLLM();
        if (mcpTools && mcpTools.length > 0) {
            allTools.push(...mcpTools);
        }
    }

    // 添加插件工具
    if (global.pluginManager) {
        const pluginTools = global.pluginManager.getAllTools();
        if (pluginTools && pluginTools.length > 0) {
            allTools.push(...pluginTools);
        }
    }

    return allTools;
}

// 全局console拦截，让所有控制台输出也写入日志文件
function hookConsoleLogging() {
    // 保存原始方法
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    // 将多个参数转换为字符串
    function formatArgs(args) {
        return args.map(arg => {
            if (arg instanceof Error) {
                // 🔥 特殊处理 Error 对象：包含堆栈信息
                let result = String(arg);
                if (arg.stack) {
                    result += '\n' + arg.stack;
                }
                return result;
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }

    // 写入文件的通用函数
    function writeToFile(level, args) {
        if (!logConfig.write_to_file) return;

        try {
            const message = formatArgs(args);
            const formattedMsg = `[${level.toUpperCase()}] ${message}`;
            const logPath = path.join(__dirname, '..', logConfig.log_file_path || 'runtime.log');
            fs.appendFileSync(logPath, formattedMsg + '\n', 'utf8');
        } catch (e) {
            // 这里不能再用console.error，否则会死递归，只能静默
        }
    }

    // 替换console方法
    console.log = function(...args) {
        writeToFile('log', args);
        originalLog.apply(console, args);
    };

    console.info = function(...args) {
        writeToFile('info', args);
        originalInfo.apply(console, args);
    };

    console.warn = function(...args) {
        writeToFile('warn', args);
        originalWarn.apply(console, args);
    };

    console.error = function(...args) {
        writeToFile('error', args);
        originalError.apply(console, args);
    };

    console.debug = function(...args) {
        writeToFile('debug', args);
        originalDebug.apply(console, args);
    };
}

// 立即执行console钩子
hookConsoleLogging();

module.exports = {
    logToTerminal,
    logToolAction,
    handleAPIError,
    getMergedToolsList,
    setLogConfig
};
