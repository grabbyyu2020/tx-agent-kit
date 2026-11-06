# Skill sources

上游技能源码的普通文件快照（不含嵌套 `.git`，符号链接已展开为普通文件）。

**这里的文件不会被自动发现或加载。** 生效的是由 `scripts/agents/sync-pstack.mjs` 从本快照生成的 `.claude/skills/` 与 `.claude/agents/`。Claude Code 与 Amp 都从 `.claude/skills/` 加载技能。

| 目录 | 上游 | 快照提交 | 下载日期 |
| --- | --- | --- | --- |
| `pstack/` | [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) 的 `plugins/pstack/` 插件目录，外加仓库根的 `LICENSE*`、`NOTICE*.md`、`VERSION` 与 `docs/`（Lauren Tan 原版 pstack 的 Claude Code 移植，MIT，版本 0.9.130；移植所跟随的 cursor/plugins `pstack/` 提交为 `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`，见上游 `tools/upstream.json`） | `main` HEAD `d88063f3355a5ecff0e6dbb890a11bab4b08bc2e` | 2026-11-06 |

pstack 未采用 [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) 原版：它按 Cursor 编写，在 Claude Code 中要靠代理运行时自行翻译 Cursor 名称。pstack-claude 在安装前就把 Cursor 原语改写成 Claude Code 等价物。

## 使用入口

- 总说明：`pstack/README.md`；技能、斜杠命令、各运行时安装与模型配置：`pstack/docs/reference.md`
- 主入口技能：`pstack/skills/poteto-mode/SKILL.md`（按任务选择 `playbooks/*.md`，再调用其他技能）
- 初始化：`pstack/skills/setup-pstack/SKILL.md`；不确定用哪个技能：`pstack/skills/poteto-help/SKILL.md`
- 子代理定义：`pstack/agents/*.md`；默认模型：`pstack/models.json`

兼容性限制：本快照面向 Claude Code 插件安装，另含 Codex、Grok、Muse、Antigravity、OpenCode、Pi、OMP 的适配文件。没有 Amp 映射，在 Amp 中使用时需按 Amp 现有工具人工对应，无对应能力的步骤应跳过并说明。`watch-pr` 等脚本依赖 Bun，PR 相关流程需要 `gh`；`automate-me`、`reflect` 的技能编写指引依赖 Claude Code 的 `plugin-dev` 插件。

## 项目级安装（不走插件）

`pnpm pstack:sync`（即 `node scripts/agents/sync-pstack.mjs`）把 `pstack/skills/*` 复制到 `.claude/skills/`，把 `pstack/agents/*.md` 复制到 `.claude/agents/`，并改写插件安装才成立的写法：

- 子代理 `pstack:poteto-agent` 等改为不带命名空间的名字，项目级子代理只注册裸名。
- `<plugin>/skills/` 改为 `.claude/skills/`。
- `poteto-agent` 不再去插件缓存里找 `poteto-mode/SKILL.md`，改读 `.claude/skills/poteto-mode/SKILL.md`。
- “under/from the installed plugin” 的脚本与 playbook 路径改为 `.claude/skills/...`。
- 各 Models 小节里“改 `plugins/pstack/models.json` 再跑 `tools/generate.mjs`”的说明改为“由 `pnpm pstack:sync` 从上游复制”。
- 删掉 `how`、`why` 里 Cursor 专有的 `readonly` 子代理参数，Claude Code 的 `Agent` 工具不接受它。

非 Claude Code 运行时的工具映射文件保持原样。替换表没覆盖到的 `pstack:`、`installed plugin`、`readonly: true|false` 写法会让脚本直接失败，需要先扩充替换表。插件自带的 SessionStart 路由钩子不安装，路由规则写在 `AGENTS.md`。

不要直接改 `.claude/skills/` 下的 pstack 文件。`pnpm lint` 会运行 `sync-pstack.mjs --check`，安装副本与快照不一致即报错。项目自有技能（`project-constraints`，以及 `/create-verification-skill` 生成的 `verify`）登记在脚本的 `projectSkills` 中，同步时不受影响。`--check` 跳过 `node_modules`，因为 `watch-pr`、`statechart` 的脚本会就地 `bun install`。

## 更新方法

在仓库根目录执行（会整体替换快照，更新后请同步上表中的 SHA 和日期）：

```bash
tmp=$(mktemp -d)
git clone --quiet --depth 1 https://github.com/michael-denyer/pstack-claude.git "$tmp/pstack-claude"
git -C "$tmp/pstack-claude" rev-parse HEAD
cat "$tmp/pstack-claude/VERSION"
rm -rf .skill-sources/pstack && mkdir -p .skill-sources/pstack
tar -C "$tmp/pstack-claude/plugins/pstack" -chf - --exclude=./.git . | tar -C .skill-sources/pstack -xf -
for f in LICENSE LICENSE-cursor-team-kit LICENSE-thermos NOTICE.md NOTICE-skills.md VERSION; do cp "$tmp/pstack-claude/$f" .skill-sources/pstack/; done
tar -C "$tmp/pstack-claude" -chf - docs | tar -C .skill-sources/pstack -xf -
rm -rf "$tmp"
find .skill-sources -name .git -o -type l   # 应无输出

pnpm pstack:sync
node .claude/skills/poteto-mode/scripts/check-playbooks.mjs   # 项目 playbook 的锚点仍然有效
```
