# GEO Publisher Monitor

开发者专用的 macOS Apple Silicon 巡检应用。它通过本机已安装的 GEO Publisher CLI 串行检查百家号、头条号、知乎、企鹅号、搜狐号和网易号，不包含在客户版安装包中。

## 本地开发

```bash
npm install
npm run verify
npm run dev
```

需要先安装并打开 GEO Publisher 0.2.0 或更高版本，并使用专用测试账号登录六个平台。

## 安全边界

- 自动实发默认关闭。
- 结果不明确时禁止重发。
- 密钥使用 macOS 钥匙串加密。
- 报告不保存 Cookie、平台密码或 API Key。
- 首版不构建 Windows、Intel 或 Linux 安装包。

## 发布

版本标签触发 macOS 签名、公证和 COS 上传：

```bash
node scripts/set-version.mjs 0.1.1
git tag v0.1.1
git push origin main --tags
```

安装包存放在不可变版本目录，自动更新只读取：

```text
geo-publisher-monitor/releases/channels/stable/mac-arm64/latest-mac.yml
```
