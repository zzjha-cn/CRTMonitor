# CRTMonitor 使用说明文档

## 1. 简介
CRTMonitor 是一个基于 Node.js 的命令行工具，用于监控中国铁路 12306 余票信息。它支持多任务并发监控、智能跨站查询，并通过飞书、Telegram、邮件等多种渠道实时推送告警。

## 2. 安装与环境

### 前置要求
- **Node.js**: 版本 >= 18.0.0
- **npm** 或 **yarn**

### 安装步骤
1. 克隆或下载本项目代码。
2. 在项目根目录下安装依赖：
   ```bash
   npm install
   ```

## 3. 配置指南

程序运行时会默认加载根目录下的 `config.yml` 文件。首次运行可参考 `config.example.yml`。

### 核心配置结构

```yaml
# 全局设置
interval: 1    # 轮询间隔（分钟），建议不低于 1 分钟
delay: 5       # 每次 API 请求之间的延迟（秒），防止被封 IP
logs: false    # 是否保存日志文件

# 监控任务列表 (支持多个)
watch:
  - date: "20240209"      # 乘车日期 (YYYYMMDD)
    from: "北京"          # 出发地
    to: "上海"            # 目的地

    # 席别过滤 (可选，不填则监控所有)
    seatCategory:
      - "二等座"
      - "硬卧"

    # 车次过滤 (可选)
    trains:
      - code: "G1"        # 仅监控 G1 次列车

# 通知配置 (支持多渠道同时发送)
notifications:
  # 1. 飞书 (推荐)
  - type: "lark"
    webhook: "https://open.feishu.cn/open-apis/bot/v2/hook/..."
    secret: "YOUR_SECRET" # (可选) 签名校验密钥

  # 2. Telegram
  - type: "telegram"
    botToken: "YOUR_BOT_TOKEN"
    chatId: "YOUR_CHAT_ID"

  # 3. 邮件
  - type: "smtp"
    host: "smtp.qq.com"
    user: "xxx@qq.com"
    pass: "授权码"
    to: "receive@example.com"
```

## 4. 运行说明

### 启动监控
在终端执行：
```bash
npm start
```
程序启动后将：
1. 校验配置文件。
2. 发送一条“启动成功”的测试消息。
3. 开始循环监控。

### 常用命令
- `npm run build`: 编译 TypeScript 代码。
- `npm run dev`: 开发模式运行（支持热重载）。

## 5. 功能特性详解

### 5.1 智能消息推送
系统会自动将同一轮查询到的多张余票信息合并为一条消息发送，避免消息轰炸。消息内容采用 **Markdown** 格式：
- **列表展示**：清晰列出每一趟有票的车次。
- **购票链接**：点击链接可直达 12306 购票页面（部分移动端支持）。

### 5.2 冗余/跨站查询
如果直达无票，系统会自动尝试：
- **向前多买**：查询终点站之后的站点。
- **向后少买**：查询起点站之前的站点。
这些扩展查询的结果也会一并包含在通知中，助你“买长乘短”或“买短乘长”。

### 5.3 命令行交互 (CLI)
如果你不想手动编辑 `config.yml`，可以直接运行：
```bash
npx ts-node src/cli.ts
```
按照提示输入日期和站点，CLI 会自动帮你生成配置文件。
