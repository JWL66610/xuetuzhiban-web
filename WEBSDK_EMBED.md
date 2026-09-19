# 学途智伴 WebSDK 嵌入说明

本项目新增 `embed-demo.html`，用于演示在课程资料网页中嵌入学校智能体平台的聊天气泡。主学习工作台仍使用现有的服务端 API 代理，不会因为启用演示页而改变。

## 官方接入代码

将以下代码放在目标网页的 `body` 内。`appKey` 是平台公开的应用标识，不是服务端 API 密钥。

```html
<script src="https://ai.yznu.edu.cn/resources/product/llm/public/sdk/embedLite.js"></script>
<script>
  new HiagentWebSDK.WebLiteClient({
    appKey: "平台提供的应用标识",
    baseUrl: "https://ai.yznu.edu.cn",
    variables: {},
    onLoad({ chatInstance }) {
      window.xuetuzhibanChat = chatInstance;
    }
  });
</script>
```

项目演示页中的初始化代码位于 `embed-demo.js`，使用本项目的 WebSDK 应用标识和学校平台地址。

## 平台后台配置

在 WebSDK 应用的允许访问域名列表中加入实际页面的完整 Origin：

- 本地：`http://localhost:5173`
- 本地备用地址：`http://127.0.0.1:5173`
- 云服务器：最终使用的 `https://域名`

`localhost` 和 `127.0.0.1` 是两个不同的 Origin，使用哪个地址访问就配置哪个。部署到 ECS 后，域名、协议和端口变化时也要重新检查白名单。

## 本地测试

1. 启动 Web 服务：`npm start`
2. 打开 `http://localhost:5173/embed-demo.html`
3. 检查页面右下角是否出现平台聊天气泡。
4. 点击气泡，确认能打开学途智伴对话窗口。

若提示“当前域名无访问权限”，优先检查平台 WebSDK 白名单。若气泡没有出现，检查浏览器网络请求是否能访问 `embedLite.js` 和平台的 WebSDK 配置接口。

## 上下文变量

当前版本传入 `variables: {}`，不依赖尚未配置的工作流变量。平台工作流配置好变量名称后，再按平台要求传入课程名称、页面标题或其他上下文，并可通过 `onLoad` 返回的 `chatInstance.updateVariables()` 更新。

## 限制

普通网页嵌入只对已经加入 SDK 代码的页面生效，不能让气泡自动出现在任意未接入代码的外部网站。若将来需要覆盖任意网站，需要另行开发浏览器扩展。

平台 SDK 默认窗口宽度为 420 像素，演示页已增加移动端覆盖样式，避免窄屏裁剪。SDK 的对话内容和平台权限仍由学校智能体平台控制。
