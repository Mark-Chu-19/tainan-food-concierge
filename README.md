# 台南美食行程 Agent（Tainan Food Trip Agent）

一個給**來台南玩的外國旅客**的美食聊天機器人，建構在 **[Hermes Agent](https://hermes-agent.nousresearch.com)**（Nous Research）之上，推理大腦用 **Claude**。

黑客松題目：智慧城市 agent。本專案把「又一個美食推薦」升級成**有公共價值的城市工具**。

## 三根支柱

1. **店家分流 / 反排隊（純演算法）** — 不只推評分第一名。同類達標店家組成候選池，用「多樣性 + 反頻率權重 + 時段錯開」把人流分散到全台南優質店家，活絡整條街、降低排隊。用 Hermes 記憶記錄各店最近被推次數做去重輪替。
2. **政府 / 店家活動層** — 用 Google Sheet 當 CMS，政府或店家非技術人員可直接寫入活動/促銷（可選「今日公休」）。agent 讀取後對命中店家加權強推、呼應在地活動。
3. **美食地圖行程** — 對話式問卷後，產出含**食物、飲料、酒**的時間軸行程，附一條串接所有站點的 Google Maps 路線連結。

＋ 加分：**Threads 當紅美食趨勢訊號**（有快取退路）。

## 使用流程

1. `intake` 用預設問題做 onboarding（在哪一區/住哪、拜訪時間、飲食禁忌/素食、是否喝酒、預算…），或讓使用者跳過直接要推薦。
2. `recommend`（含分流）依 profile 過濾與分流出候選店家。
3. `event-boost` 疊上政府活動強推。
4. `itinerary` 排成時間軸 + Google Maps 路線連結。

## 目錄結構

```
├── README.md
├── config/config.yaml            # ~/.hermes/config.yaml 範本（MCP 設定）
├── data/
│   ├── events.sheet-template.csv # 政府/店家活動層欄位範本
│   └── threads-trending.cache.md # Threads 熱門討論快取（退路）
├── skills/                       # 開發完 cp 進 ~/.hermes/skills/ 或用 external_dirs
│   ├── tainan-food-intake/
│   ├── tainan-food-recommend/    # 含分流邏輯 + tainan-foods-reference.md
│   ├── event-boost/
│   ├── tainan-trending-threads/
│   └── tainan-food-itinerary/
└── scripts/setup.sh              # 一鍵安裝 hermes + 連結 skills + 檢查 key
```

## 快速開始

需要：Claude API key、Google Maps API key（啟用 Places / Directions / Geocoding）。

```bash
# 1. 安裝 Hermes
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# 2. 設定 LLM 為 Claude
hermes model            # 選 Claude，填 ANTHROPIC_API_KEY

# 3. 連結本專案的 skills 與 config（見 scripts/setup.sh）
bash scripts/setup.sh

# 4. 開始對話
hermes --tui
#   > /tainan-food-intake  I'm a vegetarian visiting Tainan for 2 days, staying near 中西區
```

詳細規劃見 `plan`（`~/.claude/plans/hermes-agent-snug-hickey.md`）。
