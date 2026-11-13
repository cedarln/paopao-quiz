# 🫧 泡泡题库 (Paopao Quiz)

> 一款移动端刷题应用：教师资格证、日语 JLPT、英语词汇与各类测评题库都能导入。纯前端实现，基于 Capacitor 打包为 Android APK，也可以直接在浏览器里用。

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Web-green)
![Version](https://img.shields.io/badge/version-1.8.8-orange)

---

## ✨ 功能

- **刷题**：顺序 / 随机，即时判分与解析，按分类筛选、关键词搜索
- **模拟考试与套卷**：自定义题量时长；带分节预设的套卷按卷面顺序、分节计时
- **错题本 / 收藏夹 / 回收站**：答错自动收集，按间隔重复安排每日复习，连对 3 次标记已掌握；可再练、可恢复
- **题库导入**：JSON 格式，任意科目；支持覆盖或追加
- **在线题库**：应用内直接浏览、加载、更新本仓库 `quizzes/` 下的题库
- **日语 / 英语学习**：JLPT N5 全项、N5 模拟卷、N3/N4N5 词汇，高考与考研英语词汇，听力题支持音频
- **歌词精读**：导入本地歌词 JSON / zip 歌曲包，日语逐句假名、韩语罗马字与中文谐音，配中文翻译、点词解析与语法卡片；精听为盲听模式，先听再逐句揭示
- **个性化**：4 套主题、自定义图片/视频背景、学习统计、月视图学习日历与打卡

## 📥 安装与更新

从 [Releases](https://github.com/cedarln/paopao-quiz/releases/latest) 下载最新的 `paopao-quiz-vX.Y.Z.apk` 安装。App 首页的「检查更新」会读取本仓库的最新 Release，应用内完成下载与安装。

## 📚 在线题库

题库统一放在仓库的 [`quizzes/`](quizzes/) 目录，App 内「导入在线题库」可搜索、加载或更新。

- 新增题库：把符合下方格式的 JSON 上传到 `quizzes/`
- 文件名可用 `展示名~文件名.json`，App 里会显示更友好的名字，例如 `日语N5全项题库~jlpt-n5-full.json`
- 临时下线：把 JSON 移到 `quizzes-draft/`

## 🎵 歌词精读

「歌词精读」的数据完全来自本地导入，仓库与安装包都不包含歌词或歌曲音频。

1. 准备一个 `lyrics-annotated/1` 格式的歌词 JSON，或把它和音频（mp3/m4a/aac/ogg/wav/flac）打成一个 zip
2. 首页「歌词精读」→「导入歌曲包 / JSON」→ 选择文件
3. 阅读器支持时间轴高亮、点词查看词性与释义、语法卡片，以及注音 / 词间空格 / 助词变浅的排版切换

歌词与音频仅保存在本机，不会上传。请只导入你有权使用的文件。

## 📝 题库格式

完整规范见 [`samples/CONFIG_FORMAT.md`](samples/CONFIG_FORMAT.md)。最小示例：

```json
{
  "key": "english-vocab-basic",
  "name": "英语基础词汇",
  "icon": "🇬🇧",
  "description": "英语常用词汇练习",
  "questions": [
    {
      "id": 1,
      "category": "词汇-动词",
      "question": "选择单词 abandon 的正确中文释义：",
      "options": ["放弃，抛弃", "接受，承认", "适应，调整", "钦佩，赞美"],
      "answer": 0,
      "explanation": "abandon vt. 放弃，抛弃。"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 题库唯一标识（英文小写 + 连字符） |
| `name` | string | ✅ | 题库名称 |
| `questions` | array | ✅ | 题目数组 |
| `icon` / `description` | string | ❌ | 图标与简介 |
| `exam` | object | ❌ | 套卷预设：题量、时长、`preserveOrder`、`sections` |
| `audioBase` | string | ❌ | 外部音频地址前缀（`http(s)://`） |
| `audioIds` / `audioRange` / `audioExt` | — | ❌ | 配合 `audioBase` 指定哪些题有音频、扩展名 |

题目字段：`question`、`options`、`answer`（从 0 开始）必填；`explanation`、`category`、`audio`（朗读文本）、`audioUrl`（音频地址）可选。

## 🛠 开发

```bash
node tools/build-www.js          # 生成 www/，并校验版本号与脚本语法
npx cap sync android             # 同步到 Android 工程
cd android && ./gradlew assembleRelease
```

浏览器预览：用任意静态服务器指向仓库根目录，打开 `index.html` 即可。

## 📦 版本

当前版本 **v1.8.8**，完整安装包与历史版本见 [Releases](https://github.com/cedarln/paopao-quiz/releases)。

这里只记录改动较大的版本：

- **v1.8.7** — 错题本升级为间隔重复复习：到期题目排成每日队列，答对延后、答错回炉，连对 3 次标记已掌握；全局文字对比度修复
- **v1.8.6** — 首页整体瘦身重排；学习日历改月视图；角标已读即隐；深色主题可读性修复
- **v1.8.5** — 精听改成盲听：先听再看，逐句揭示，可重听与本句循环
- **v1.8.3** — 韩语歌词支持：罗马字读音与中文谐音
- **v1.8.1** — 歌词精读界面与 zip 歌曲包导入
- **v1.8.0** — 听力音频改为按需下载，安装包更小

## 📄 许可证

MIT License
