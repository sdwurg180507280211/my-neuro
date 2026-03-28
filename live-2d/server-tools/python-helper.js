/**
 * Python 环境帮助工具 - 自动检测可用的 Python 环境
 */
const { execSync } = require('child_process');

/**
 * 获取可用的 Python 命令
 * 按优先级尝试：
 * 1. 直接使用 python/python3 命令
 * 2. conda activate base 然后 python
 * 3. conda activate my-neuro 然后 python (兼容旧配置)
 * @returns {Object} { command: string, prefix: string } - command 是完整命令前缀，prefix 是激活环境部分
 */
function getPythonCommand() {
    const isWindows = process.platform === 'win32';

    // 方法1: 尝试直接使用 python/python3
    try {
        const testCmd = isWindows ? 'python --version' : 'python3 --version';
        execSync(testCmd, { stdio: 'ignore' });
        return {
            command: isWindows ? 'python' : 'python3',
            prefix: ''
        };
    } catch (e) {
        // 继续尝试下一个方法
    }

    // 方法2: 尝试 conda base 环境
    try {
        const testCmd = isWindows
            ? 'conda activate base && python --version'
            : 'bash -c "source activate base && python --version"';
        execSync(testCmd, { stdio: 'ignore', shell: isWindows ? 'cmd.exe' : '/bin/bash' });
        return {
            command: 'python',
            prefix: isWindows ? 'call conda activate base && ' : 'source activate base && '
        };
    } catch (e) {
        // 继续尝试下一个方法
    }

    // 方法3: 尝试 conda my-neuro 环境 (兼容旧配置)
    try {
        const testCmd = isWindows
            ? 'conda activate my-neuro && python --version'
            : 'bash -c "source activate my-neuro && python --version"';
        execSync(testCmd, { stdio: 'ignore', shell: isWindows ? 'cmd.exe' : '/bin/bash' });
        return {
            command: 'python',
            prefix: isWindows ? 'call conda activate my-neuro && ' : 'source activate my-neuro && '
        };
    } catch (e) {
        // 所有方法都失败，返回默认值让调用方处理
        console.warn('无法找到可用的 Python 环境，将使用默认 python 命令');
    }

    // 默认返回
    return {
        command: isWindows ? 'python' : 'python3',
        prefix: ''
    };
}

/**
 * 构建完整的 Python 执行命令
 * @param {string} scriptPath - Python 脚本路径
 * @param {string} args - 额外参数
 * @returns {string} 完整的命令字符串
 */
function buildPythonCommand(scriptPath, args = '') {
    const { command, prefix } = getPythonCommand();
    const escapedPath = `"${scriptPath}"`;
    return `${prefix}${command} ${escapedPath}${args ? ' ' + args : ''}`;
}

module.exports = {
    getPythonCommand,
    buildPythonCommand
};
