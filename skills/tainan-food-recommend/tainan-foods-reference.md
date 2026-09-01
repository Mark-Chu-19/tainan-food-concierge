# 台南經典美食參考資料（Tainan Food Reference）

給 agent 的在地知識底稿：Google Places / open data 資料不足或離線時，用這份確保推薦有在地深度。
外國旅客導向 → 每項附**英文名**方便現場點餐。分類：`food`（食物）、`drink`（飲料/甜點）、`alcohol`（酒）。
Dietary tag：`veg-ok`（有素食選項）、`has-pork`、`has-beef`、`halal-friendly`（清真友善，較少）。

> 這是「品類 + 代表店家」的種子清單，不是唯一名單。分流時應把「同品類的達標店家」都納入候選池，避免只推名店。

---

## 招牌小吃（signature food）

- **牛肉湯 Beef soup** — `food` `has-beef`
  溫體牛涮湯，台南代表。**多店分布**：保安路、鹽行、六甲頂一帶都有名店 → 分流重點品類。清晨/深夜營業者多。
- **擔仔麵 Danzai noodles (shrimp broth noodles)** — `food` `has-pork`
  小碗蝦湯肉燥麵，台南發源。
- **蝦捲 / 蝦仁飯 Shrimp rolls / shrimp rice** — `food`
  安平、國華街一帶經典。
- **鹹粥 Savory rice porridge (fish/pork)** — `food` `has-pork`
  虱目魚/土魠魚粥，早餐首選。
- **碗粿 Wa gui (steamed rice cake)** — `food` `has-pork`
- **肉燥飯 Braised pork rice** — `food` `has-pork`
- **虱目魚料理 Milkfish dishes** — `food`
  魚肚、魚皮湯，台南特產。
- **牛肉/羊肉爐** — `food` `has-beef`

## 素食友善（vegetarian-friendly）

- **蔬食/素食自助 Vegetarian buffet & Buddhist veg** — `food` `veg-ok`
  台南素食店密度高，多為自助秤重。
- **碗粿（素）/ 米糕（部分）** — `food` `veg-ok`（需確認肉燥）
- **豆花 Douhua (tofu pudding)** — `drink` `veg-ok`
  可當甜點/飲品，常見。

## 飲料 / 甜點（drink & dessert）

- **豆花 Douhua** — `drink` `veg-ok`
- **冰品 / 芒果冰 Shaved ice / mango ice** — `drink` `veg-ok`
  夏季必吃。
- **青草茶 / 冬瓜茶 Herbal tea / winter melon tea** — `drink` `veg-ok`
  傳統老店飲品。
- **手搖茶 Bubble tea** — `drink` `veg-ok`
- **咖啡 Specialty coffee** — `drink`
  正興街、神農街一帶多獨立咖啡館。

## 酒（alcohol）

- **精釀啤酒吧 Craft beer bar** — `alcohol`
  神農街、海安路一帶有台灣精釀。
- **清酒 / 調酒 Cocktail bar** — `alcohol`
  海安路、中西區夜生活區。
- **在地啤酒 Local beer with 熱炒 (stir-fry)** — `alcohol` `food`
  台式熱炒配啤酒，適合晚餐轉場。

---

## 各區特色（by district，供分流地理排序）

- **中西區 West Central** — 國華街、正興街、神農街、海安路：小吃密集 + 咖啡 + 酒吧，最適合半日美食路線。
- **安平區 Anping** — 蝦捲、蝦餅、老街小吃 + 海景。
- **北區 North** — 鴨母寮市場、公園路一帶早餐小吃。
- **東區 East** — 大學城，平價與新式餐飲。
- **鹽行 / 永康一帶** — 牛肉湯名店群（分流分散人流用）。

## 用餐時段模型（供 itinerary 排時間軸）

- 早餐 06:00–09:00：牛肉湯、鹹粥、碗粿
- 午餐 11:30–13:30：擔仔麵、肉燥飯、虱目魚
- 下午茶 14:30–16:30：豆花、冰品、咖啡（drink）
- 晚餐 18:00–20:00：蝦捲、熱炒、素食自助
- 宵夜/酒 20:30–23:00：精釀酒吧、調酒（alcohol）

## 各類別粗略營業時間與常見公休（近似值，非精確；有真實資料時以真實為準）

> 給 agent 判斷「現在／某時段開了沒」的底稿。台南小吃常**賣完就收**、且多有固定公休日；不確定時要誠實說「大約」，別報死時間。

| 類別 | 大致營業 | 常見公休 / 備註 |
|------|----------|-----------------|
| 牛肉湯 Beef soup | 早市店 05:00–13:00；也有下午/深夜店 | 多數名店賣完提早收；部分週一或不定休 |
| 鹹粥 / 虱目魚 | 06:00–13:00（早午為主） | 賣完收；不定休 |
| 擔仔麵 / 肉燥飯 | 11:00–20:00 | 老店常週一休 |
| 碗粿 / 米糕 | 07:00–18:00 | 賣完收 |
| 蝦捲 / 安平小吃 | 10:00–20:00（假日人多） | — |
| 素食自助 Veg buffet | 午 11:00–14:00、晚 17:00–20:00 兩段 | 部分初一十五特別忙 |
| 豆花 / 冰品 Dessert | 11:00–22:00（夏季更晚） | — |
| 咖啡 Coffee | 11:00–19:00（獨立店較晚開） | 常週一/週二休 |
| 精釀 / 酒吧 Bar | 18:00–凌晨 | 平日較早收，週末最晚 |

**判斷規則**：深夜（約 00:00–05:00）多數小吃休息，只剩少數酒吧/宵夜；清晨主推牛肉湯/鹹粥；若當下時段全類別皆休，就老實說並給「最快會開」的選項或改天建議。
