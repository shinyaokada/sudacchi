# Sudacchi - AI搭載バーチャルペット on Slack

Slack上で暮らすAI搭載バーチャルペット「スダッチ」。たまごっちのように世話をしないと弱ってしまう、手のかかるやつです。

## 機能一覧

### ペットの世話

- **ごはん**: 食べ物の絵文字（🍚🍕🍰など）をメッセージで送ると食事になる
- **遊び**: しりとり、クイズ、じゃんけんなどの遊びに誘える
- **なでる**: 褒めたり、愛情表現をすると喜ぶ
- **睡眠 / 起床**: 睡眠状態を管理

### リアクション機能

スダッチの最新投稿に絵文字リアクションを付けるとインタラクションが発生します。

| 絵文字カテゴリ | アクション | 効果 |
|---|---|---|
| Food & Drink (🍕🍺🍎) | ごはん | 空腹回復、気分アップ |
| Animals & Nature (🐶🌸🌲) | なでる | 空腹微減、気分アップ |
| Activities (⚽🎮🎆) | 遊び | 空腹減少、体力減少、気分アップ |
| Travel & Places (✈️🏠⛰️) | イベント | 各ステータスがランダムに変動（平均プラス） |
| その他 | 会話 | ステータス変動なし、返答のみ |

- ユーザー単位で2秒のクールダウンあり

### ステータス管理

- **空腹（hunger）**: 0-100。時間経過で減少（5/時間）
- **気分（mood）**: 0-100。時間経過で減少（3/時間）
- **体力（energy）**: 0-100。時間経過で減少（2/時間）、睡眠中は回復（18/時間）

### 成長段階

| 段階 | 特徴 |
|---|---|
| たまご（egg） | 擬音のみ（「きゅ？」「ぴゃ！」） |
| 赤ちゃん（baby） | 片言、甘えん坊 |
| こども（child） | おしゃべり、いたずら好き |
| おとな（adult） | ツッコミ上手、冗談好き |
| ベテラン（veteran） | 落ち着き、たまに深いことを言う |

### 死亡条件

以下のいずれかを満たすとスダッチは死んでしまいます。

- 空腹が0のまま12時間経過
- 空腹と気分が両方0のまま6時間経過
- 全ステータスが20以下のまま24時間経過

### ユーザーとの関係

- ユーザーごとに親密度（bond: 0-100）を管理
- 世話をするほど親密度が上がり、スダッチの態度が変わる

### 自動行動（Slackモード）

- 10分ごとにステータス減衰・死亡チェック
- 30分ごとに状態に応じた自律発言（空腹時のおねだり、放置時のSOSなど）
- 9:00 起床 / 12:00 昼の挨拶 / 23:00 就寝

### AI応答

- Claude API（Anthropic）による自然な会話
- 成長段階・ステータス・親密度に応じて口調や態度が変化
- 常にため口、一人称「ぼく」
- すだち（柑橘）が大好物

---

## セットアップ

### 前提条件

- Node.js v22以上
- npm
- Anthropic APIキー（[console.anthropic.com](https://console.anthropic.com/)で取得）

### インストール

```bash
git clone https://github.com/shinyaokada/sudacchi.git
cd sudacchi
npm install
```

### 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して必要な値を設定します。

```env
# Claude API（必須）
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# アプリ設定
DATABASE_PATH=./data/sudacchi.db
NODE_ENV=development
TZ=Asia/Tokyo
MODE=cli   # "cli" または "slack"

# Slack（Slackモード時のみ必須）
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SUDACCHI_CHANNEL_ID=C...
```

---

## CLIモードで実行する

APIキーさえあればすぐに試せます。

```bash
# .env の MODE=cli を確認してから
npm run dev:cli
```

### CLIコマンド

| コマンド | 説明 |
|---|---|
| （テキスト入力） | スダッチに話しかける |
| （食べ物絵文字） | ごはんをあげる（例: `🍕`） |
| `<r>:shortcode:` | リアクションの疑似入力（例: `<r>:pizza:`） |
| `/status` | 現在のステータスを表示 |
| `/tick [分]` | 指定分数の時間経過をシミュレート（デフォルト10分） |
| `/reset` | 新しいスダッチを孵化させる |
| `/quit` | 終了 |

---

## Slackモードで実行する

### 1. Slack Appの作成

1. [api.slack.com/apps](https://api.slack.com/apps) にアクセス
2. **Create New App** → **From scratch** を選択
3. App名（例: `sudacchi`）とワークスペースを選んで作成

### 2. Bot Userの作成

1. 左メニュー **App Home** を開く
2. **App Display Name** の **Edit** をクリック
3. Display Name と Default Username を入力して **Save**

### 3. Socket Modeの有効化

1. 左メニュー **Socket Mode** を開く
2. **Enable Socket Mode** をONにする
3. App-Level Tokenを生成:
   - Token Name: 任意（例: `socket-token`）
   - Scope: `connections:write`
4. 生成された `xapp-` で始まるトークンを `.env` の `SLACK_APP_TOKEN` に設定

### 4. Bot Token Scopesの設定

1. 左メニュー **OAuth & Permissions** を開く
2. **Bot Token Scopes** に以下を追加:
   - `chat:write` - メッセージの投稿
   - `channels:history` - チャンネルのメッセージ読み取り
   - `reactions:read` - リアクションの読み取り

### 5. Event Subscriptionsの設定

1. 左メニュー **Event Subscriptions** を開く
2. **Enable Events** をONにする
3. **Subscribe to bot events** に以下を追加:
   - `message.channels` - チャンネルへのメッセージ
   - `reaction_added` - リアクションの追加

### 6. ワークスペースにインストール

1. 左メニュー **Install App** を開く
2. **Install to Workspace** をクリックして権限を許可
3. 表示された `xoxb-` で始まるBot Tokenを `.env` の `SLACK_BOT_TOKEN` に設定

### 7. Signing Secretの取得

1. 左メニュー **Basic Information** を開く
2. **App Credentials** セクションの **Signing Secret** を `.env` の `SLACK_SIGNING_SECRET` に設定

### 8. チャンネルの設定

1. Slackでスダッチ用のチャンネルを作成（例: `#sudacchi`）
2. チャンネルにbotを招待: `/invite @sudacchi`
3. チャンネルIDを取得:
   - チャンネル名を右クリック → 「リンクをコピー」
   - URLの末尾 `C` で始まる文字列がチャンネルID
4. `.env` の `SUDACCHI_CHANNEL_ID` に設定

### 9. 起動

```bash
# .env の MODE=slack を確認してから
npm run dev
```

`⚡ Sudacchi is running in Slack mode!` と表示されれば起動成功です。

---

## 開発用コマンド

```bash
npm run dev         # Slackモードで起動（MODE=slack時）
npm run dev:cli     # CLIモードで起動
npm run build       # TypeScriptビルド
npm run lint        # Lintチェック
npm run lint:fix    # Lint自動修正
npm test            # テスト実行
npm run db:generate # DBマイグレーション生成
npm run db:migrate  # DBマイグレーション実行
```

## 技術スタック

- **言語**: TypeScript
- **ランタイム**: Node.js v22+
- **AI**: Claude API（@anthropic-ai/sdk）
- **Slack**: @slack/bolt（Socket Mode）
- **DB**: SQLite（better-sqlite3 + drizzle-orm）
- **スケジューラ**: node-cron
- **テスト**: vitest
- **Lint / Format**: Biome
