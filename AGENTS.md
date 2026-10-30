# 游戏设计探索仓库

本仓库用于调研、原型实验和提炼可复用的游戏设计方法。

- 通用游戏设计指南、跨方向研究和方法文档放在根 `docs/`，新增资料时更新 `docs/README.md` 索引。
- 每个探索方向放在 `tutorial/<direction>/`。代码、该实验的设计说明与验证记录、测试和资源保留在方向内部，引用根 `docs/` 的通用资料。
- 新增方向时更新根 `README.md` 和 `tutorial/README.md` 的索引。不要为尚未开始的方向创建空目录。
- 共享项目 Skill 放在 `.agents/skills/`，引用对应方向的实现和研究；打击感任务可使用 `impact-combat-feel`。
- 遵循用户请求区分调研与实现，不因读到研究建议就自动修改游戏规则。
- 运行命令以所在方向的 README 为准；从仓库根执行打击感回归使用 `node --test tutorial/impact-combat/tests/combat.test.cjs`。
- 当前工作区可能存在本地旧项目和素材，它们不属于本仓库的探索内容；修改或提交时明确选择相关文件。
