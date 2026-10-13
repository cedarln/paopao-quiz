# 题库配置文件格式规范 (v1.0)

## 文件格式
- 格式：JSON
- 编码：UTF-8
- 扩展名：`.json`

## 顶层结构

```json
{
  "version": "1.0",
  "key": "题库唯一标识",
  "name": "题库名称",
  "icon": "📚",
  "description": "题库描述",
  "category": "分类",
  "questions": []
}
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 否 | 配置文件版本号，当前为 "1.0" |
| `key` | string | **是** | 题库唯一标识，用于识别和去重。建议使用英文小写+连字符，如 `english-vocab-basic` |
| `name` | string | **是** | 题库名称，显示在卡片标题上 |
| `icon` | string | 否 | 图标（emoji），默认 📝 |
| `description` | string | 否 | 题库描述，显示在卡片副标题 |
| `category` | string | 否 | 分类标签，如 `language`、`exam` 等 |
| `questions` | array | **是** | 题目数组 |

## 题目结构

```json
{
  "id": 1,
  "category": "题目分类",
  "question": "题干内容",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "answer": 0,
  "explanation": "答案解析"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 否 | 题目编号，不填则自动生成 |
| `category` | string | 否 | 题目分类，如"词汇-动词" |
| `question` | string | **是** | 题干 |
| `options` | array | **是** | 选项数组，至少2个 |
| `answer` | number | **是** | 正确答案的索引（从0开始） |
| `explanation` | string | 否 | 答案解析 |

## 导入行为

### 新题库（key 不存在）
- 直接添加为新的课程卡片
- 卡片会显示"已导入"标记，可删除

### 同 key 题库已存在
弹窗询问用户：
- **覆盖**：用新题库完全替换现有题库
- **追加**：将新题库的题目追加到现有题库末尾（id 重新编号）

## 示例

### 英语词汇题库
见 `samples/english-vocab-basic.json`

### 日语词汇题库
见 `samples/japanese-vocab-basic.json`

### 完整示例

```json
{
  "version": "1.0",
  "key": "my-custom-quiz",
  "name": "我的自定义题库",
  "icon": "🎯",
  "description": "这是一个示例题库",
  "category": "custom",
  "questions": [
    {
      "id": 1,
      "category": "示例分类",
      "question": "1 + 1 = ?",
      "options": ["1", "2", "3", "4"],
      "answer": 1,
      "explanation": "1加1等于2"
    }
  ]
}
```
