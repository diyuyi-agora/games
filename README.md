# Games / 游戏设计探索

用可运行的原型探索游戏设计。调研形成假设，Demo 帮助比较，再把验证过的方法提炼为可复用的项目 Skill。

## 目录组织

```text
.
├── docs/                             通用游戏设计资料与方法
│   ├── README.md                     文档索引
│   └── ACTION_GAME_DESIGN_GUIDE.md    动作游戏设计指南
├── tutorial/                         每个子目录对应一个探索方向
│   ├── README.md                     方向索引与组织约定
│   └── impact-combat/                动作游戏打击感
│       ├── README.md                 问题、玩法与运行方式
│       ├── index.html                H5 Demo
│       ├── combat.js                 武器轨迹、碰撞与镜头模型
│       ├── game.js                   战斗、输入和反馈
│       ├── style.css
│       ├── docs/                     设计、调研、验证与预览图
│       └── tests/                    行为回归
└── .agents/skills/                   从探索中提炼的项目技能
    └── impact-combat-feel/
```

## 当前探索方向

| 方向 | 核心问题 | 入口 |
| --- | --- | --- |
| 动作游戏打击感 | 如何让输入、接触、目标反应与视听反馈形成清晰的力量传递？ | [impact-combat](tutorial/impact-combat/README.md) |

通用设计指南和方法放在根目录 [docs/](docs/README.md)，当前包括[动作游戏设计指南](docs/ACTION_GAME_DESIGN_GUIDE.md)。新方向在 `tutorial/` 下建立独立目录，代码、该实验的方案和验证记录放在方向内部；可复用的操作流程放到仓库级 `.agents/skills/`。

## 体验 Demo

在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 [打击感实验场](http://127.0.0.1:4173/tutorial/impact-combat/)。也可以直接用浏览器打开 `tutorial/impact-combat/index.html`；该 Demo 无需安装运行依赖。

回归检查：

```sh
node --test tutorial/impact-combat/tests/combat.test.cjs
```

## 项目 Skill

当前可用：[`impact-combat-feel`](.agents/skills/impact-combat-feel/SKILL.md)。在支持项目技能的 Codex 会话中使用 `$impact-combat-feel`，按接触、计时、输入和反馈层级诊断与优化战斗。
