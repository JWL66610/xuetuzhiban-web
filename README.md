# 学途智伴 Web 工作台

## 功能介绍

本项目是“学途智伴”智能体的配套 Web 工作台，服务于学校智能体开发平台中已经配置好的模型、工作流和知识库。工作台通过 Node.js 服务端代理调用平台接口，避免在浏览器代码中直接暴露平台 API 密钥。

主要功能：

- 知识答疑、智能出题、学习规划
- 图片题目讲解、图片作业批改
- 普通对话附件上传、资料上传和目标知识库选择
- 会话创建、历史记录、流式回复、停止生成和回答反馈
- Markdown、平台纯文本数学公式和 KaTeX 渲染
- 学习时钟、移动端响应式布局、对话标记与删除
- 左下角 API 配置面板
- 课程网页 WebSDK 嵌入演示页

平台中的模型、工作流、课程知识库和发布配置不包含在本仓库内，需要在学校智能体开发平台中提前完成配置。

## 环境依赖

必需环境：

- Windows 10/11、Ubuntu 22.04+ 或兼容系统
- Node.js 22 LTS 或更高版本
- npm 10+；也可以使用 pnpm 10+

可选环境：

- Python 3.12+：运行独立文档解析服务时使用
- Docker：使用容器部署时使用

项目使用 Node.js 内置 `fetch`、`AbortSignal.timeout` 和 `AbortSignal.any`，不建议使用过旧的 Node.js 版本。

## 工作台运行步骤

### 1. 获取代码并安装依赖

```bash
git clone <你的 GitHub 仓库地址>
cd xuetuzhiban-web
npm install
```

也可以使用 pnpm：

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2. 启动工作台

```bash
npm start
```

开发模式也可以执行：

```bash
npm run dev
```

启动后访问：

- 主工作台：<http://localhost:5173/>
- WebSDK 演示页：<http://localhost:5173/embed-demo.html>
- 健康检查：<http://localhost:5173/health>

如果使用的是包含根目录脚本的完整项目，可以运行项目根目录下的 `启动学途智伴全套服务.bat`，同时启动相关服务。只复制 `xuetuzhiban-web` 目录时，请使用 `npm start`。

## 在浏览器配置 API

工作台启动后，可以直接在页面左下角配置学校平台 API，不必先手动修改 `.env`：

1. 打开 <http://localhost:5173/>。
2. 点击左下角的“API 配置”。
3. 在 API 地址中填写：

   ```text
   https://ai.yznu.edu.cn/api/proxy/api/v1
   ```

4. 填入学校平台发布应用后生成的 API 密钥。
5. 保存配置后重新发送消息测试。

该配置按浏览器客户端标识隔离，API 密钥只保存在本地 Node.js 服务端内存中，不会返回给浏览器，也不会写入 URL。服务重启后会恢复为 `.env` 中的默认配置。当前配置面板适合个人使用和演示；正式多人部署还需要登录、权限控制、限流和审计。

## WebSDK 演示步骤

WebSDK 演示页用于展示学生浏览课程资料时，在当前网页右下角打开“学途智伴”聊天气泡。

### 平台配置

在学校平台的 WebSDK 允许访问列表中加入实际访问页面的完整 Origin：

```text
http://localhost:5173
http://127.0.0.1:5173
https://你的正式域名
```

`localhost` 和 `127.0.0.1` 是不同的 Origin，需要分别配置。生产环境应填写最终使用的 HTTPS 域名和端口，不要只填写路径。

### 演示操作

1. 启动工作台。
2. 打开 <http://localhost:5173/embed-demo.html>。
3. 确认课程资料页右下角出现聊天气泡。
4. 点击气泡，打开平台智能体对话窗口。
5. 输入一个高等数学问题，确认能够正常对话。

WebSDK 只能显示在已经嵌入 SDK 代码并通过平台白名单校验的网页中，不能自动注入任意外部网站。更多说明见 [`WEBSDK_EMBED.md`](WEBSDK_EMBED.md)。

## 部署步骤

### 1. 准备服务端配置

在项目目录复制环境变量模板：

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

Linux/macOS：

```bash
cp .env.example .env
```

编辑 `.env`，聊天功能至少需要：

```dotenv
HIAGENT_API_BASE_URL=https://ai.yznu.edu.cn/api/proxy/api/v1
HIAGENT_API_KEY=平台生成的API密钥
PORT=5173
```

不要把真实 API 密钥、AccessKey 或 SecretKey 提交到 GitHub。

### 2. 配置上传服务

普通附件和“资料上传”依赖学校平台的 Up 服务。需要联系平台管理员或运维人员确认：

- Up 服务地址和端口；
- ECS 或部署机器是否能够访问该地址；
- 是否需要来源 IP 白名单、防火墙放行或校园网环境；
- 使用直接调用还是签名调用；
- 如果使用签名调用，需要的 AccessKey、SecretKey、区域和服务名。

将管理员确认的信息写入 `.env`：

```dotenv
# 支持 http://host:port 或 http://host:port/up
HIAGENT_UP_ENDPOINT=管理员提供的Up地址
HIAGENT_UP_AUTH_MODE=direct
HIAGENT_UP_ACCESS_KEY=
HIAGENT_UP_SECRET_KEY=
HIAGENT_UP_REGION=cn-north-1
HIAGENT_UP_SERVICE=up
HIAGENT_UP_ACCOUNT_ID=
HIAGENT_UP_TIMEOUT_MS=90000
HIAGENT_UP_EXPIRE=3h
HIAGENT_FILE_DOWNLOAD_URL=https://ai.yznu.edu.cn/api/proxy/down
```

如果运维要求使用签名服务，将 `HIAGENT_UP_AUTH_MODE` 改为 `v4` 或 `auto`，并按实际要求补充凭证。上传服务地址必须从实际部署环境可达，不能直接复制已经失效的临时地址。

当前上传约束：

- 支持 PNG、JPG、JPEG、WebP、GIF、BMP、PDF、DOC、DOCX、PPT、PPTX 和 TXT；
- 单个文件最大 20 MB；
- 普通对话最多上传 5 个附件；
- “资料上传”一次只允许 1 个文件，并且必须选择目标知识库；
- 文件上传成功不等于知识库写入完成，后续写入仍由平台工作流处理。

### 3. 在阿里云 ECS 部署

推荐使用阿里云 ECS 运行 Node.js 服务，基本流程如下：

1. 创建或准备一台 ECS，选择 Ubuntu 22.04+ 等常用 Linux 镜像。
2. 在安全组中只开放必要端口，生产环境建议开放 `80` 和 `443`，不要直接暴露 `5173`。
3. 安装 Node.js 22 LTS、npm 和 Git。
4. 拉取本项目并执行 `npm install`。
5. 创建 `.env`，填写平台 API 和上传服务配置。
6. 先执行 `npm start`，访问 `/health` 检查服务状态。
7. 使用 Nginx 或其他反向代理将 HTTPS 域名转发到 `127.0.0.1:5173`。
8. 将正式 HTTPS Origin 加入平台 WebSDK 白名单。
9. 使用进程管理器或 systemd 保证 Node.js 服务在后台运行并自动重启。

反向代理至少需要支持长连接和流式响应，否则聊天流式输出可能被缓冲。生产部署还应配置 HTTPS、登录鉴权、权限控制、限流、日志脱敏和定期备份。

### 4. 使用 Docker 部署

构建镜像：

```bash
docker build -t xuetuzhiban-web .
```

使用 `.env` 启动：

```bash
docker run -d \
  --name xuetuzhiban-web \
  --restart unless-stopped \
  -p 127.0.0.1:5173:5173 \
  --env-file .env \
  xuetuzhiban-web
```

之后仍建议通过 Nginx 配置 HTTPS 反向代理，不要将 Node.js 端口直接暴露到公网。

### 5. 可选文档解析服务

`document-parser-service` 是独立的可选服务，不包含在本目录中，支持 PDF、DOCX、PPTX 和 TXT 正文提取。运行方式：

```bash
cd ../document-parser-service
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux/macOS：

```bash
source .venv/bin/activate
```

安装并启动：

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

扫描型 PDF 暂不包含 OCR；旧版 DOC/PPT 需要先转换为 DOCX/PPTX。详细说明见 `document-parser-service/README.md`。

## 附录

### 项目结构

```text
index.html              主工作台页面
app.js                  页面交互、会话、历史和上传流程
styles.css              工作台样式和响应式布局
server.mjs              Express 静态服务和平台 API 代理
attachments.js          附件校验与上传请求
upload-service.mjs      Up 服务适配和签名逻辑
markdown.js / math.js   Markdown 与数学公式处理
embed-demo.html         WebSDK 课程资料演示页
test/                   自动化测试
.env.example            环境变量模板
Dockerfile              生产镜像配置
```

### 本地验证

```bash
npm test
node --check app.js
node --check server.mjs
node --check upload-service.mjs
```

测试覆盖 Markdown、公式、安全链接、附件校验、上传协议、超时取消、API 配置隔离和 WebSDK 静态配置。配置好真实 Up 服务后，可以运行上传回读检查：

```bash
node scripts/check-upload.mjs --live --local=http://localhost:5173
```

该命令不会读取个人文件，也不会自动写入课程知识库。

### 本地 API 路由

| 路由 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 服务和配置状态 |
| `/api/config` | GET、POST、DELETE | 读取、设置或恢复当前客户端的平台配置 |
| `/api/conversations` | POST | 创建平台会话 |
| `/api/chat` | POST | 流式聊天代理 |
| `/api/upload` | POST | 原始附件上传代理 |
| `/api/history` | POST | 获取会话历史 |
| `/api/stop` | POST | 停止平台生成 |
| `/api/feedback` | POST | 提交回答反馈 |

### 已知限制

- 平台工作流、模型和课程知识库不在本仓库内，需要在学校平台中配置。
- 普通文档读取、知识库写入和不同文件格式的解析效果需要在实际平台环境中验收。
- 上传服务依赖外部 Up 地址；本地代码测试不能证明远端服务始终可达。
- 本仓库不提供真实密钥、公网发布地址或完整演示视频。
- 当前工作台主要面向个人使用和比赛演示；正式多人部署需要登录、权限、限流、审计和 HTTPS。

### GitHub 提交前检查

1. 不提交 `.env`、`.env.local`、`node_modules`、个人文件和生成缓存。
2. 不提交真实 API Key、AccessKey、SecretKey 或平台内部临时地址。
3. 运行 `npm test` 和 Node.js 语法检查。
4. 如果密钥曾出现在聊天、截图、日志或公开仓库中，先在平台后台撤销并重新生成。
