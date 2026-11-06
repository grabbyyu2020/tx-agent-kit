# Skill sources

上游技能源码的普通文件快照（不含嵌套 `.git`，符号链接已展开为普通文件），仅用于本地阅读、对比和按需手动引用。

**这里的技能不会被自动发现或加载。** Amp 只发现 `.agents/skills/` 与 `.claude/skills/` 等技能目录；本目录未接入任何技能目录、插件或配置。例外：pstack 的技能另有一份副本复制到了 `.agents/skills/`，供 Amp（含 orb）在项目级加载，见下文“Amp 项目级安装”。

| 目录 | 上游 | 快照提交 | 下载日期 |
| --- | --- | --- | --- |
| `pstack/` | [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) 的 `plugins/pstack/` 插件目录，外加仓库根的 `LICENSE*`、`NOTICE*.md`、`VERSION` 与 `docs/`（Lauren Tan 原版 pstack 的 Claude Code 移植，MIT，版本 0.9.130；移植所跟随的 cursor/plugins `pstack/` 提交为 `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`，见上游 `tools/upstream.json`） | `main` HEAD `d88063f3355a5ecff0e6dbb890a11bab4b08bc2e` | 2026-11-06 |
| `mattpocock/` | [mattpocock/skills](https://github.com/mattpocock/skills) 整个仓库（MIT） | `main` HEAD `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | 2026-11-04 |

pstack 未采用 [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) 原版：它按 Cursor 编写，在 Claude Code 中要靠代理运行时自行翻译 Cursor 名称。pstack-claude 在安装前就把 Cursor 原语改写成 Claude Code 等价物。

## 使用入口

### pstack

- 总说明：`pstack/README.md`；技能、斜杠命令、各运行时安装与模型配置：`pstack/docs/reference.md`
- 主入口技能：`pstack/skills/poteto-mode/SKILL.md`（按任务选择 `playbooks/*.md`，再调用其他技能）
- 初始化：`pstack/skills/setup-pstack/SKILL.md`；不确定用哪个技能：`pstack/skills/poteto-help/SKILL.md`
- 其他技能：`pstack/skills/<name>/SKILL.md`（68 个 `SKILL.md`，含 `grok/skills/pstack-routing/` 下 1 个）
- 子代理定义：`pstack/agents/*.md`；默认模型：`pstack/models.json`；SessionStart 路由注入：`pstack/hooks/`
- 非 Claude Code 运行时的工具映射：`pstack/skills/poteto-mode/references/*-tools.md`（Codex、Copilot、OpenCode、Pi 等）

兼容性限制：本快照面向 Claude Code（插件清单在 `.claude-plugin/`），另含 Codex、Grok、Muse、Antigravity、OpenCode、Pi、OMP 的适配文件；Cursor 专有的 automations、Bugbot UI 等已被移植方剔除。没有 Amp 映射，在 Amp 中使用时需按 Amp 现有工具人工对应，无对应能力的步骤应跳过并说明。`docs/` 内的链接按上游仓库布局写成 `../plugins/pstack/...`，在本快照中需改读 `pstack/` 下的同名路径。`watch-pr` 等脚本依赖 Bun，PR 相关流程需要 `gh`；`automate-me`、`reflect` 的技能编写指引依赖 Claude Code 的 `plugin-dev` 插件。

#### Amp 项目级安装

- `.agents/skills/<name>/`：`pstack/skills/` 下 67 个技能目录的平铺副本，随仓库提交，因此 orb 中也可用。不装到任何用户级目录，也不装 Claude Code 插件。
- 相对快照只多一处：`.agents/skills/poteto-mode/references/agents/` 补入了 `pstack/agents/` 下的 3 个子代理定义（原本只有 `comment-sicko.md`）。其余文件与快照一致，不要直接改。

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

# pstack：pstack-claude 的 plugins/pstack/ 插件目录 + 根目录许可证、VERSION 与 docs/
git clone --quiet --depth 1 https://github.com/michael-denyer/pstack-claude.git "$tmp/pstack-claude"
git -C "$tmp/pstack-claude" rev-parse HEAD
cat "$tmp/pstack-claude/VERSION"
rm -rf .skill-sources/pstack && mkdir -p .skill-sources/pstack
tar -C "$tmp/pstack-claude/plugins/pstack" -chf - --exclude=./.git . | tar -C .skill-sources/pstack -xf -
for f in LICENSE LICENSE-cursor-team-kit LICENSE-thermos NOTICE.md NOTICE-skills.md VERSION; do cp "$tmp/pstack-claude/$f" .skill-sources/pstack/; done
tar -C "$tmp/pstack-claude" -chf - docs | tar -C .skill-sources/pstack -xf -

# pstack → .agents/skills/：整体替换各技能目录，再补入子代理定义
for d in .skill-sources/pstack/skills/*/; do rm -rf ".agents/skills/$(basename "$d")"; done
tar -C .skill-sources/pstack/skills -cf - . | tar -C .agents/skills -xf -
cp .skill-sources/pstack/agents/*.md .agents/skills/poteto-mode/references/agents/

# Matt Pocock skills：整个仓库
git clone --quiet --depth 1 https://github.com/mattpocock/skills.git "$tmp/matt"
git -C "$tmp/matt" rev-parse HEAD
rm -rf .skill-sources/mattpocock && mkdir -p .skill-sources/mattpocock
tar -C "$tmp/matt" -chf - --exclude=./.git . | tar -C .skill-sources/mattpocock -xf -

rm -rf "$tmp"
find .skill-sources -name .git -o -type l   # 应无输出
```

`tar -h` 会把符号链接（如 `mattpocock/AGENTS.md -> CLAUDE.md`）展开为普通文件。
