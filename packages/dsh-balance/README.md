# dsh-balance

在 DSH 里直接看到 DeepSeek 账户余额，不用离开对话去开网页。

- **输入框胶囊**：对话输入框右侧的小胶囊，显示当前余额
- **设置页**：设置 → 插件里的一个独立分区，展示余额明细

## 它解决什么问题

余额查询要调用 `https://api.deepseek.com/user/balance`，而那个接口**需要 API Key**。浏览器里绝不能放 Key，所以这个插件拆成两半：

| half | file | 职责 |
|---|---|---|
| host | `index.js` | 唯一出网的一侧：读取 Key、请求余额、缓存、脱敏后返回 |
| client | `lib/client.js` | 只负责显示，永远接触不到 Key |

Key 从 DSH 已有的凭据库读取（`$DSH_HOME/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`），**不新增存储位置**，轮换 Key 不需要重启。

## 行为约定

- `GET /api/balance` 返回缓存快照（stale-while-revalidate）
- `GET /api/balance?force=1` 跳过缓存强制刷新
- 成功结果缓存 **5 分钟**；失败结果只缓存 **30 秒**，避免把状态好的 Key 或网络抖动放大成长时间报错
- 并发请求共享同一次上游调用（in-flight 去重）
- 请求超时 **15 秒**
- 任何响应都不会回显 Key

## 接口

```http
GET /api/balance
→ 200 {"ok":true,"at":<ms>,"snapshot":{...},"history":[...]}
→ 200 {"ok":false,"at":<ms>,"error":"no DEEPSEEK_API_KEY in the harness credential store","history":[]}
```

没有 Key 时返回 `ok:false` 并说明原因，面板显示明确提示，而不是转圈或静默失败。

## 安装

```bash
cd ~/.dsh/profiles/<profile>
npm install --save "dsh-balance@link:/absolute/path/to/packages/dsh-balance"
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-balance
      name: 'dsh-balance'
```

然后**完整重启 DSH**（desktop profile 是启动时加载，不是热重载）。

确保凭据库里有 `DEEPSEEK_API_KEY`，或设置环境变量 `DEEPSEEK_API_KEY`。

## 开发

```bash
npm install
npm run build   # 重新生成 lib/client.js
npm test        # 离线主机测试：15 项
```

测试全程离线：不发真实请求、不读真实 Key，只验证路由注册、鉴权拦截、无 Key 时的降级、方法限制和资源释放。

## License

MIT
