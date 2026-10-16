# CLAUDE.md — このリポジトリで作業する AI への指示

## プロジェクト

「Price Watch シンプルshiro_AI」。日本のECサイト（楽天・Yahoo!）の価格を見張る、自分専用の価格監視 PWA。
現在は **第1段階**（Sony・Bose の4機種のみ）。第2段階（商品の自由追加）・第3段階（一般公開）は将来の方針で、まだ作らない。

## 利用者について（最重要）

- 利用者はプログラミング・GitHub の初心者。**説明はすべて日本語**、専門用語には簡単な言い換えを添える。
- 利用者に操作を頼むときは **一度に1ステップだけ**、クリックする場所まで具体的に書き、完了を待つ。
- 画面の文言・エラーメッセージもすべて日本語。

## 設計の約束

1. **シンプル第一**。ビルド工程・フレームワーク・npm パッケージは入れない（素の HTML / CSS / JavaScript と Node.js 標準機能のみ）。
2. 画面は原則「商品」「セール」「設定」の3つ。
3. **実価格とサンプル価格を必ず区別**して表示する（`prices.json` の `mode` と各店舗の `status` を使う）。
4. **スクレイピングをしない**。楽天市場 商品検索API、Yahoo!ショッピング 商品検索API v3、Amazon は既定では無料方式（Keepa の価格推移ページと Amazon へのリンク、値下がりは Keepa の無料メール通知）。有料の Keepa API キーがある場合のみ自動取得。PA-API は廃止、Creators API は売上条件で使えない。手入力方式は利用者が不要と判断したので作らない。
5. **APIキー・パスワードをコードに書かない**。GitHub Secrets（`RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` / `YAHOO_APP_ID` / `KEEPA_API_KEY` / `NTFY_TOPIC`）から環境変数で読む。
6. 無料で運用する。リポジトリは `SHirosukesan/price-watch-ai`。無料で GitHub Pages を使うため、利用者の判断で**公開リポジトリ**にした（2026-10-16）。だからこそ、キー・パスワード・個人情報は絶対にコミットしない。アプリURL：`https://shirosukesan.github.io/price-watch-ai/`
7. AI 価格予測・課金・複雑なポイント計算は入れない。

## 構成

- `index.html` / `style.css` / `app.js` … アプリ本体。目標価格・通知済み記録は `localStorage`（キー `pw.targets` / `pw.notified`）。
- `sw.js` … ネット優先＋オフライン時のみキャッシュ。画面ファイルを変えたら `VERSION` を上げる。
- `data/products.json` … 商品定義。`queries`（検索語）、`mustAll` / `mustAny`（商品名の必須文字、表記ゆれは `normalize()` で吸収）、`minPrice`（付属品除外）。
- `data/sales.json` … セール予定（日本時間 `+09:00`）。
- `data/prices.json` … `scripts/fetch-prices.mjs` が生成。リポジトリ内のものはサンプル。公開版は Actions が毎回作り直す（コミットはしない）。
- `.github/workflows/update-prices.yml` … 30分ごと＋push時＋手動で、価格取得 → Pages へ公開。

## API の要点（2026年10月時点で確認）

- 楽天：`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`。`applicationId` と `accessKey` が必須。登録した Web サイト URL と Referer の一致チェックあり（スクリプトは Pages の URL を Referer に付ける）。同一URLへの短時間の大量アクセスは制限される。
- Yahoo!：`https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch`。`appid` 必須。目安 1秒1回。ブラウザからの直接呼び出しは CORS で失敗する可能性が高いので、取得は Actions 側で行う。
- Keepa：`https://api.keepa.com`、日本は `domain=5`。初回だけ `/search?type=product`（1ページ10トークン）で ASIN を探し、`prices.json` の `stores.amazon.asins` に保存して再利用。価格は `/product?stats=1&update=1`（1 ASIN あたり約1トークン）の `stats.current[0]`（Amazon販売）と `[1]`（他の出品者・新品）。-1 は在庫なし。価格は円の整数。
- 商品画像は Yahoo! → 楽天 → Keepa の順で API が返す画像URLを使う（画像ファイルをリポジトリに保存しない）。
- 出典表示（Rakuten Developers / Yahoo! JAPAN のクレジット）を設定画面から消さない。

## 動作確認の方法

```bash
node scripts/fetch-prices.mjs        # キー無しならサンプル価格を data/prices.json に書く
python3 -m http.server 8000           # → ブラウザで http://localhost:8000
```

アプリ内の「設定 → 動作チェック」でも確認できる。変更後はスマホ幅（約400px）と PC 幅の両方で表示を確認すること。

## 変更時のルール

- 利用者への報告では、実行していない作業・つながっていない機能を「完了」と言わない。

- 1回の変更は小さく。何を変えたかを日本語で利用者に説明する。
- 新しい商品は `data/products.json` に追加するだけで動くように保つ（第2段階への布石）。
- コミットメッセージは日本語で簡潔に。
