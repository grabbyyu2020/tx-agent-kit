# Skill sources

上游技能源码的普通文件快照（不含嵌套 `.git`，符号链接已展开为普通文件），仅用于本地阅读、对比和按需手动引用。

**这里的技能不会被自动发现或加载。** Amp 只发现 `.agents/skills/` 与 `.claude/skills/` 等技能目录；本目录未接入任何技能目录、插件或配置。

| 目录 | 上游 | 快照提交 | 下载日期 |
| --- | --- | --- | --- |
| `pstack/` | [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) 的 `pstack/` 子目录（原版，作者 Lauren Tan，MIT，版本 0.15.36） | 仓库 `main` HEAD `bb68f2365eceafa0cb2d253112f675acf5f144cc`；最后一次改动 `pstack/` 的提交为 `c742dd61706fbacc1b95f1a20b7b988cf096ce6c` | 2026-11-04 |
| `mattpocock/` | [mattpocock/skills](https://github.com/mattpocock/skills) 整个仓库（MIT） | `main` HEAD `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | 2026-11-04 |

未采用 [backnotprop/pstack](https://github.com/backnotprop/pstack)：它是改写过的跨代理镜像，多个 `SKILL.md` 与原版内容不同。

## 使用入口

### pstack

- 总说明：`pstack/README.md`；入门指南：`pstack/docs/guide/README.md`
- 主入口技能：`pstack/skills/poteto-mode/SKILL.md`（按任务选择 `playbooks/*.md`，再调用其他技能）
- 初始化：`pstack/skills/setup-pstack/SKILL.md`；不确定用哪个技能：`pstack/skills/poteto-help/SKILL.md`
- 其他技能：`pstack/skills/<name>/SKILL.md`（61 个 `SKILL.md`，含 `automations/benny/skills/` 下 3 个）
- 子代理定义：`pstack/agents/*.md`；非 Cursor 环境的名称映射：`pstack/docs/harness/claude-code.md`

兼容性限制：pstack 按 Cursor 编写。技能中的 `Task`、`AskQuestion`、`subagent_type`、`readonly`、`environment: "cloud"`、Cursor 模型 slug、`~/.cursor/rules/pstack-models.mdc`、Bugbot、Cursor Automations（`automations/benny/`）等都是 Cursor 能力，不代表 Amp 已支持。上游只为 Claude Code 提供了映射表（`docs/harness/claude-code.md`），没有 Amp 映射；在 Amp 中使用时需按 Amp 现有工具人工对应，无对应能力的步骤应跳过并说明。`skills/poteto-mode/scripts/` 和 `skills/statechart/scripts/` 依赖 Bun/Node，`statechart` 还需要 Java/TLA+ 工具。

### Matt Pocock skills

- 总说明：`mattpocock/README.md`；术语：`mattpocock/GLOSSARY.md`
- 路由入口：`mattpocock/skills/engineering/ask-matt/SKILL.md`（映射所有可调用技能及其关系）
- 初始化：`mattpocock/skills/engineering/setup-matt-pocock-skills/SKILL.md`
- 技能分组：`skills/engineering/`、`skills/productivity/`（推荐使用）、`skills/misc/`、`skills/in-progress/`（beta）、`skills/deprecated/`；每组有 `README.md`
- 人读文档：`mattpocock/docs/<bucket>/<skill>.md`

兼容性限制：`agents/openai.yaml` 面向 Codex；`.claude-plugin/` 面向 Claude Code；`skills/misc/git-guardrails-claude-code/` 写入 Claude Code hooks，Amp 不适用。`skills/in-progress/chief-of-staff/` 用 `../retro/SKILL.md` 这类相对路径引用技能，假设所有技能被平铺安装在同一目录，在本快照的分组目录中不能直接解析。

### 注意：快照内的指令文件

`mattpocock/AGENTS.md` 与 `mattpocock/CLAUDE.md` 是上游仓库的维护者指令。Amp 在编辑 `.skill-sources/mattpocock/` 下文件时会把它当作该子目录的项目指令加载；它只约束上游仓库本身，不适用于 tx-agent-kit。

## 更新方法

在仓库根目录执行（会整体替换快照，更新后请同步上表中的 SHA 和日期）：

```bash
tmp=$(mktemp -d)

# pstack：只检出 cursor/plugins 的 pstack/ 子目录
git clone --quiet --filter=blob:none --sparse --depth 1 https://github.com/cursor/plugins.git "$tmp/plugins"
git -C "$tmp/plugins" sparse-checkout set pstack
git -C "$tmp/plugins" rev-parse HEAD
gh api "repos/cursor/plugins/commits?path=pstack&per_page=1" --jq '.[0].sha'
rm -rf .skill-sources/pstack && mkdir -p .skill-sources/pstack
tar -C "$tmp/plugins/pstack" -chf - --exclude=./.git . | tar -C .skill-sources/pstack -xf -

# Matt Pocock skills：整个仓库
git clone --quiet --depth 1 https://github.com/mattpocock/skills.git "$tmp/matt"
git -C "$tmp/matt" rev-parse HEAD
rm -rf .skill-sources/mattpocock && mkdir -p .skill-sources/mattpocock
tar -C "$tmp/matt" -chf - --exclude=./.git . | tar -C .skill-sources/mattpocock -xf -

rm -rf "$tmp"
find .skill-sources -name .git -o -type l   # 应无输出
```

`tar -h` 会把符号链接（如 `mattpocock/AGENTS.md -> CLAUDE.md`）展开为普通文件。
