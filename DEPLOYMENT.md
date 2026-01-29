# CRTMonitor 服务器部署指南

本文档将指导你如何将 CRTMonitor 部署到 Linux 服务器（Ubuntu/CentOS/Debian）。

## 1. 环境准备

无论使用哪种非 Docker 部署方式，都需要先安装 Node.js 环境。

**推荐使用 nvm 安装 Node.js (版本需 >= 20.12.0)**

```bash
# 1. 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 2. 重新加载 shell 配置
source ~/.bashrc  # 或 source ~/.zshrc

# 3. 安装 Node.js 20
nvm install 20
nvm use 20
```

---

## 2. 获取代码与安装依赖

```bash
# 1. 克隆代码
git clone https://github.com/wxory/CRTMonitor.git
cd CRTMonitor

# 2. 安装依赖
npm install

# 3. 编译代码
npm run build
```

---

## 3. 部署方式选择

### 方式一：使用 PM2 部署 (✅ 推荐)

PM2 是一个守护进程管理器，能确保你的程序在崩溃后自动重启，并支持开机自启。

```bash
# 1. 全局安装 PM2
npm install -g pm2

# 2. 启动监控
# --name 命名进程，方便管理
pm2 start dist/index.js --name "crt-monitor"

# 3. 查看运行状态
pm2 status
pm2 logs crt-monitor

# 4. (可选) 设置开机自启
pm2 startup
pm2 save
```

**常用 PM2 命令：**
- 停止：`pm2 stop crt-monitor`
- 重启：`pm2 restart crt-monitor`
- 删除：`pm2 delete crt-monitor`

---

### 方式二：使用 Screen 部署 (简便)

项目内置了 `run.sh` 脚本，使用 Linux 的 `screen` 工具在后台运行。

```bash
# 1. 赋予执行权限
chmod +x run.sh

# 2. 启动
./run.sh

# 3. 查看后台会话
screen -ls

# 4. 进入(恢复)会话查看日志
screen -r CRTM

# 5. 退出会话（不停止程序）
# 按键盘: Ctrl + A，然后按 D
```

---

### 方式三：使用 Docker 部署 (容器化)

如果你习惯使用 Docker，可以创建一个 `Dockerfile` 进行部署。

**1. 创建 Dockerfile**

在项目根目录新建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./

# 安装依赖
RUN npm install

# 复制源码
COPY . .

# 编译 TypeScript
RUN npm run build

# 启动命令
CMD ["node", "dist/index.js"]
```

**2. 构建镜像**

```bash
docker build -t crt-monitor .
```

**3. 运行容器**

建议挂载 `config.yml` 以便随时修改配置：

```bash
# 假设你的 config.yml 在当前目录
docker run -d \
  --name crt-monitor \
  -v $(pwd)/config.yml:/app/config.yml \
  --restart unless-stopped \
  crt-monitor
```

**4. 查看日志**

```bash
docker logs -f crt-monitor
```

---

## 4. 常见问题

**Q: 如何修改配置？**
A: 修改服务器上的 `config.yml` 文件。
- 如果使用 PM2：修改后执行 `pm2 restart crt-monitor`。
- 如果使用 Docker：修改宿主机挂载的文件后执行 `docker restart crt-monitor`。

**Q: 遇到 `API rate limit` 错误？**
A: 这是 12306 的访问频率限制。请在 `config.yml` 中调大 `delay` (单次请求间隔) 或 `interval` (轮询间隔)。
