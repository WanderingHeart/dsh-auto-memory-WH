# DSH 插件市场收录

核对日期：2026-11-15。

DSH 内置市场读取用户配置的插件索引源，官方文档说明应用本身不附带索引源。发布 npm 和 GitHub 不等于已进入用户配置的社区目录。

官方文档：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md

## 两种途径

1. 向目标社区索引维护者申请收录。例如 Open Plugin Market：https://github.com/polang233/dsh-plugin-index ，按该仓库的申请入口提交公开仓库、npm包、许可证与功能说明，由维护者审核。
2. 自行提供符合 format=1 的 JSON 索引，在静态 HTTPS 地址公开；用户通过“添加索引源”添加它。它只对添加该来源的用户可见，不代表其他市场自动收录。

## 本插件申请材料

- 名称：dsh-auto-memory-WH
- npm：dsh-auto-memory-wh@1.0.1（发布完成后使用）
- 源码：https://github.com/WanderingHeart/dsh-auto-memory-WH
- 许可：MIT，保留上游来源与第三方声明。
- 简介：DSH 自动持久记忆，项目级保留详情、用户级自动保存简短概括，支持四种类型、可视化管理、合并与原生提醒。
- 已验证：Windows DSH 0.2.2-rc.3；声明兼容范围以包 engines.dsh 为准。

本次只整理申请材料，没有向任何第三方发送申请，也没有声称已被市场收录。
