# 插件与角色商店 - 使用说明

## 🎯 功能概述

这是 my-neuro Live2D 的插件与角色商店 MVP 版本，提供：

- 🧩 **插件市场** - 浏览、搜索、安装插件
- 🎭 **角色商店** - 浏览、搜索、安装角色
- ✨ **精选推荐** - 展示优质内容
- 🏷️ **分类筛选** - 按类别浏览
- 🔍 **搜索功能** - 快速找到需要的内容

## 📁 新增文件

```
live-2d/
├── market/                          # 商店相关文件
│   ├── market.html                  # 商店前端页面
│   ├── market.css                   # 商店样式
│   ├── market.js                    # 商店前端逻辑
│   ├── market-data.json             # 商店数据（插件+角色）
│   ├── installed.json               # 已安装项目记录
│   └── README.md                    # 本文档
│
├── js/market/
│   └── market-manager.js            # 市场管理器（后端逻辑）
│
└── 修改的文件：
    ├── main.js                      # 添加打开市场窗口功能
    ├── js/services/http-server.js   # 添加市场API（端口3003）
    ├── app.js                       # 添加商店按钮事件
    ├── index.html                   # 添加商店按钮
    └── css/styles.css               # 添加商店按钮样式
```

## 🚀 快速开始

### 1. 启动应用

```bash
npm start
```

### 2. 打开商店

点击主界面左下角的 **🏪 商店按钮**，或通过 API 打开：

```bash
# 在主进程中调用
ipcRenderer.send('open-market');
```

### 3. 使用商店

- **切换标签** - 在「插件」和「角色」之间切换
- **搜索** - 在搜索框输入关键词查找
- **分类筛选** - 点击分类按钮筛选内容
- **排序** - 使用下拉菜单按下载量、评分等排序
- **安装** - 点击「安装」按钮安装插件或角色
- **详情** - 点击卡片查看详细信息

## 🔧 API 接口

市场服务运行在 **端口 3003**

### 插件接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/market/plugins` | 获取插件列表 |
| GET | `/market/plugins/:id` | 获取插件详情 |
| POST | `/market/plugins/:id/install` | 安装插件 |
| POST | `/market/plugins/:id/uninstall` | 卸载插件 |

### 角色接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/market/characters` | 获取角色列表 |
| GET | `/market/characters/:id` | 获取角色详情 |
| POST | `/market/characters/:id/install` | 安装角色 |
| POST | `/market/characters/:id/uninstall` | 卸载角色 |

### 其他接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/market/categories` | 获取分类列表 |
| GET | `/market/installed` | 获取已安装项目 |

### 查询参数

- `q` - 搜索关键词
- `category` - 分类ID

### 示例

```javascript
// 获取插件列表
fetch('http://localhost:3003/market/plugins?q=&category=all')
  .then(r => r.json())
  .then(data => console.log(data));

// 安装插件
fetch('http://localhost:3003/market/plugins/time-awareness/install', {
  method: 'POST'
});
```

## 📊 数据格式

### 插件数据

```json
{
  "id": "plugin-id",
  "name": "plugin-name",
  "displayName": "显示名称",
  "version": "1.0.0",
  "author": "作者名",
  "description": "简短描述",
  "longDescription": "详细描述",
  "category": "ai-enhancement",
  "price": 0,
  "rating": 4.8,
  "downloads": 1256,
  "tags": ["标签1", "标签2"],
  "repoUrl": "https://github.com/...",
  "isFeatured": true,
  "createdAt": "2024-01-15",
  "updatedAt": "2024-02-20"
}
```

### 角色数据

```json
{
  "id": "character-id",
  "name": "character-name",
  "displayName": "显示名称",
  "version": "1.0.0",
  "author": "作者名",
  "description": "简短描述",
  "longDescription": "详细描述",
  "category": "female",
  "price": 0,
  "rating": 4.9,
  "downloads": 5632,
  "tags": ["标签1", "标签2"],
  "isFeatured": true,
  "createdAt": "2024-01-01",
  "updatedAt": "2024-03-01",
  "modelInfo": {
    "expressions": 7,
    "motions": 10,
    "physics": true
  }
}
```

## 🎨 分类说明

### 插件分类

| ID | 名称 | 图标 |
|----|------|------|
| all | 全部 | 📦 |
| ai-enhancement | AI增强 | 🧠 |
| interaction | 互动 | 💬 |
| gaming | 游戏 | 🎮 |
| ui | 界面 | ✨ |
| content | 内容 | 📚 |

### 角色分类

| ID | 名称 | 图标 |
|----|------|------|
| all | 全部 | 👥 |
| female | 女性 | 👩 |
| male | 男性 | 👨 |
| animal | 兽耳 | 🐾 |
| original | 原创 | 🎨 |

## 🔮 后续规划

### Phase 2: 付费功能
- [ ] 价格设置
- [ ] 微信/支付宝支付集成
- [ ] 订单管理系统
- [ ] 开发者后台（收益查看、提现）

### Phase 3: 生态运营
- [ ] 推荐算法
- [ ] 热门榜单
- [ ] 活动运营
- [ ] 用户社区功能

### Phase 4: 高级功能
- [ ] 插件/角色评论系统
- [ ] 评分系统
- [ ] 内容审核后台
- [ ] 开发者工具包

## 📝 注意事项

1. **服务端口** - 确保端口 3003 未被占用
2. **数据存储** - 市场数据存储在 `market/` 目录
3. **插件安装** - 插件会安装到 `plugins/community/` 目录
4. **角色安装** - 角色会安装到 `2D/` 目录
5. **已安装记录** - 已安装项目记录在 `market/installed.json`

## 🐛 故障排除

### 商店窗口无法打开
- 检查是否有错误日志
- 确认 `market/market.html` 文件存在

### API 请求失败
- 确认应用已启动
- 检查端口 3003 是否被占用
- 查看控制台错误信息

### 安装失败
- 检查目标目录权限
- 确认有足够的磁盘空间
- 查看 `market/downloads/` 目录

## 📄 许可证

与 my-neuro Live2D 项目使用相同的许可证。
