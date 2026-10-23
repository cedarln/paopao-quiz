# quizzes-draft/ —— 暂存区，App 检测不到

「传送门」列的是 GitHub 仓库 **`quizzes/`** 目录（`js/app.js` 里
`PORTAL_API = .../contents/quizzes`）。所以想让某个题库暂时不出现在用户界面里，
唯一对**已安装的旧版本也立刻生效**的办法，就是把它的 JSON 从这个目录移走 ——
改 App 代码只影响升级到新版本之后的用户，旧版照样能看见。

本目录就是这个「移走」的落点。放在这里的文件：

- 照常入库、照常版本管理，随时可以拿回来；
- 不会出现在 App 的在线题库列表里，用户搜不到也导不进来；
- 内置题库不受影响（内置走 `js/data/*.js`，跟这里无关）。

## 用法

```bash
# 收起来（下线，用户立即看不到）
node tools/stage-bank.js hide mbti-16personalities

# 开放（上线）
node tools/stage-bank.js show mbti-16personalities

# 看当前两边各有什么
node tools/stage-bank.js status
```

匹配按文件名里的 key（`展示名~key.json` 的 `~` 后半段），大小写不敏感。

## 注意

- 收起来的题库，已经导入过它的用户本地仍然留着那份数据 —— 这里只是断掉「新增加载」，
  不是远程删除。
- `show` 之前务必跑一遍官方校验：
  `node ~/.qoder-cn/skills/quiz-bank-authoring-portal/scripts/check_quiz_bank.js <文件>`，
  key 与文件名不一致会让用户侧导入直接失败。
- 不要用通配删除。`rm quizzes/*模拟卷*.json` 会连带删掉同前缀的已提交文件。
