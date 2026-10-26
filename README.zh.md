# dsh-plugin-subagent-clean

DeepSeek Harness（DSH）的子代理清理插件：**删除子代理之后，父会话里那条历史记录也一起消失**。

包名仍是 `dsh-plugin-subagent-delete`，可以直接顶掉上游同款安装。

基于 [heiheiha798/dsh-plugin-subagent-delete](https://github.com/heiheiha798/dsh-plugin-subagent-delete)（MIT）改进。

## 和上游的区别

| 能力 | 上游 0.2.3 | 本版 0.3.0 |
|---|---|---|
| 删除子代理会话 | ✅ | ✅ |
| 父会话下拉里的历史行 | ❌ 一直留着 | ✅ 当场退休 |
| 网页端清理入口 | ❌ 只能靠模型调工具 | ✅ 会话头部「子代理」按钮 |
| 一次清理 N 个子代理 | — | ✅ 只重写一次日志 |
| 写入时的并发保护 | — | ✅ 写前后各校验一次 |
| 需要改 DSH 核心 | — | ❌ 不需要 |

上游 README 里写着这个限制：

> 父会话的 `subagent/catalog` 事实是只追加的持久历史，所以被删除的子代理可能仍会作为**历史条目**出现在父会话头部的子代理目录下拉框中……要移除该事实需要重写已提交的会话日志，DSH 并不支持。

本版把「不支持」做成了支持。

## 原理：不删事件的「退休」

会话日志有两条硬约束：

1. 事件 `seq` 必须从 0 连续，不能有洞；
2. 压缩事件（`compaction/summary`）会引用更早的 `seq` 区间。

所以**删掉一行**会留洞，**重新编号**会让引用错位——两条路都会把日志写坏。

本版的做法是**原位替换**：把那条 `subagent/catalog` 事件改写成一条加载器不认识、但声明可忽略的事件。

```jsonc
// 改写前
{"type":"subagent/catalog","seq":263,"time":1730000000000,"data":{"childId":"…"}}

// 改写后（seq 与原值一致，只换类型）
{"type":"subagent-delete/retired","seq":263,"time":1730000000000,"ignorable":true,
 "data":{"childId":"…","retiredAt":1730000005000}}
```

- `seq`、`time` 原样保留 → 连续性不受影响，压缩引用照样对得上
- `ignorable: true` 是事件信封上的顶级字段 → 加载器把它当「看不懂但可以忽略」的记录原样保留
- 目录投影只在 `type === "subagent/catalog"` 时生成行 → 换成别的类型，那一行就不再出现

其余事件**逐字节不动**。

## 安装

```sh
dsh plugin --profile web add github:huajiao1998/dsh-plugin-subagent-clean
# 固定版本
dsh plugin --profile web add github:huajiao1998/dsh-plugin-subagent-clean#v0.3.0
# 本地目录
dsh plugin --profile web add /path/to/dsh-plugin-subagent-clean
```

装完重启 profile，重新打开一个会话。

## 使用

### 网页端

会话头部多一个 **「子代理」** 按钮，点开是本会话的子代理列表：

- 单行 **「删」** → 删这一个，顺手退休它那一行
- **「一键清理」** → 全删，日志只重写一次
- 删完自动刷新会话列表

### 模型工具

和上游一致：

```jsonc
list_subagents({})                       // 全部后代
list_subagents({ activity: "running" })  // 仅运行中
list_subagents({ mode: "one-shot" })     // 仅一次性
list_subagents({ include_absent: true }) // 连持久化已删的也列出来

delete_subagent({ subagent_id: "<id>" })
delete_subagent({ subagent_id: "<id>", recursive: true })
release_subagent({ subagent_id: "<id>" })   // 只停，不删
```

归属校验、Team 花名册 dismiss、递归删除、`already_absent` 语义都与上游相同。

## HTTP 路由（web profile）

```
GET  /dsh-plugin-subagent-delete/list?parentSessionId=<id>[&activity=…][&mode=…]
POST /dsh-plugin-subagent-delete/delete   {"parentSessionId":"<id>","subagentId":"<id>","recursive":false}
POST /dsh-plugin-subagent-delete/release  {"parentSessionId":"<id>","subagentId":"<id>","recursive":false}
POST /dsh-plugin-subagent-delete/cleanup  {"sessionId":"<id>"}       // 新增：清空该会话全部子代理
POST /dsh-plugin-subagent-delete/scrub    {"parentSessionId":"<id>"} // 新增：只扫已消失子代理的残留行
```

`cleanup` 先批量删会话、最后统一重写一次日志；`scrub` 只处理「会话文件已经不在、登记行还在」的情况。

## 一些实现细节

- **活会话可以直接重写**：`seq` 没变，宿主内存里的计数依旧成立。实测重写后宿主继续往同一路径追加，事件数与 `seq` 都正常。
- **并发保护**：写临时文件 → 再 stat 一次 → 一致才 rename；不一致就放弃并排队，绝不吞事件。
- **排队兜底**：当场重写失败（文件正在被写、解码失败）时记录到 `~/.dsh/plugin-subagent-delete-pending.json`，下次宿主启动补做。
- **内存**：重写会把整份日志解压进内存，约等于未压缩体积（几 MB 很轻松；上百 MB 的会话要注意）。

## 兼容性

在 DSH `0.2.1-rc.2`、Node 22 上实测；不修改任何 DSH 包，只依赖公开的 `ctx.tools` / `ctx.webServer` / `ctx.slots` 接口。

`ignorable: true` 的放行规则来自 `dsh-session-format-v3-to-v4/lib/index.js`（未知类型 + `ignorable` 才被保留）。

## License

MIT，见 [LICENSE](./LICENSE)。原始版权归 heiheiha798 所有，本仓库的改动同样以 MIT 发布。
