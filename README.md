# TrendLab: Global Education App Trend Discovery Platform

> **Nền tảng nghiên cứu và khám phá xu hướng ứng dụng Giáo dục toàn cầu (Android & iOS).**  
> Lấy cảm hứng trực quan hóa từ [karpathy.ai/jobs](https://karpathy.ai/jobs/).

---

## Project requirements (binding)

Read [AGENTS.md](AGENTS.md) and [docs/REQUIREMENTS_ACCEPTANCE.md](docs/REQUIREMENTS_ACCEPTANCE.md) before changing architecture or declaring a feature complete. Automated supplemental Top-Chart discovery deployment: [docs/DISCOVERY_DEPLOYMENT.md](docs/DISCOVERY_DEPLOYMENT.md). **A chart sweep cannot discover all new Education apps and does not satisfy global catalog coverage.**

## Data-first workflow (new collection pipeline)

The repository is a **research prototype**, not a verified global census. AppGoblin
is a discovery catalog; a row in its dump is **not** a live install measurement.
No source currently guarantees unlimited, real-time access to all Education apps.

1. Download `live_store_apps.tsv.xz` from
   [AppGoblin Free App Datasets](https://appgoblin.info/free-app-datasets)
   or its [public dataset repository](https://github.com/appgoblin-dev/appgoblin-data),
   where available. Check licensing and attribution (CC BY 4.0).
   Do not commit large vendor datasets to the repository.
2. Import locally (Node 22+, `xz` installed for compressed TSV):

   ```bash
   npm ci
   node bin/cli.js import-catalog --file /path/to/live_store_apps.tsv.xz
   node bin/cli.js coverage
   node bin/cli.js collect --android-limit 200 --ios-limit 200 --storefront us
   node bin/cli.js coverage
   npm test
   ```

   An uncompressed `.tsv` also works. Use `--max 1000` for a small dry run.
   The importer uses exact `app_category=education` from the provider's
   `store,store_id,app_name,app_category` columns, skips invalid IDs,
   and upserts without creating duplicates on repeated imports.
   Other provider category strings must be investigated separately.

3. The collector now persists `collection_state` per app and storefront.
   Re-running `collect` takes **due** apps, prioritizing unseen apps;
   success is due again after a default 24 hours, failures use backoff.
   Commands run a finite batch and exit. Run them again with an external
   task scheduler for periodic collection, within the sources' access terms.
   `coverage` reports **local** catalog counts, snapshots, recent collection,
   and the last ten collection audit jobs; it does NOT calculate the global
   denominator.

4. `node bin/cli.js sweep` performs supplemental chart discovery
   across configured storefronts/countries. Top-K charts do not establish
   full market coverage. `seed --curated` is a manually selected demo
   and is **never automatically inserted** by `collect` or `pipeline`.

5. Once multiple **real** snapshots have accumulated:

   ```bash
   node bin/cli.js analyze
   node bin/cli.js export
   node bin/cli.js serve
   ```

   The UI is a research aid only. Android install-counter semantics have
   not been verified as daily downloads. iOS rating counts are storefront-
   specific and must not be pooled into a fictional global download metric.

**Remaining limits:** Scraper availability/rate limits must be validated on
your machine. Apple Lookup is not unlimited; conservative pacing is configured.
The dataset's completeness/refresh cadence is not guaranteed by TrendLab.
The `backtest` command currently reports model-overlap diagnostics **only**;
it is not a predictive walk-forward backtest. The scoring formulas are
provisional, pending real historical validation.

---

## 1. Giới thiệu dự án

**TrendLab** là một công cụ nghiên cứu cá nhân chuyên sâu nhằm:
- Khám phá và theo dõi biến động động lượng của các ứng dụng thuộc danh mục **Education** chính thức trên **Google Play Store** và **Apple App Store** ở phạm vi **toàn cầu**.
- Ưu tiên dữ liệu quan sát trực tiếp (`observed_install_counter`, `userRatingCount`, `rating_velocity`, `ranking momentum`), tuyệt đối **không** dùng số liệu ước tính giả lập (*estimated downloads*).
- Tách biệt hai chế độ phát hiện xu hướng:
  - **Mode A (Emerging Breakouts):** Khám phá "ngọc thô" — các ứng dụng mới bùng nổ động lượng trước khi trở nên quá phổ biến.
  - **Mode B (Sustained Growth):** Nhận diện các ứng dụng duy trì tốc độ tích lũy người dùng bền bỉ qua thời gian.
- Trực quan hóa mật độ cao bằng **Squarified Treemap tương tác** kết hợp bảng xếp hạng động và ngăn truy nguyên xuất xứ dữ liệu (Provenance Drawer).

Tài liệu đặc tả chi tiết:
- 📄 [PROJECT_SPECIFICATION.md](./PROJECT_SPECIFICATION.md) — Đặc tả kiến trúc kỹ thuật (Single Source of Truth).
- 📄 [DATA_FEASIBILITY_REPORT.md](./DATA_FEASIBILITY_REPORT.md) — Báo cáo kiểm chứng thực nghiệm khả thi nguồn dữ liệu (Phase 0).

---

## 2. Cấu trúc mã nguồn bản prototype

Dự án được tổ chức theo chuẩn kiến trúc module chuyên nghiệp, không chia theo folder phase:

```
trendlab/
├── PROJECT_SPECIFICATION.md    # Đặc tả kiến trúc & toán học xu hướng
├── DATA_FEASIBILITY_REPORT.md  # Báo cáo thực nghiệm khả thi (Phase 0)
├── README.md                   # Hướng dẫn vận hành hệ thống
├── package.json                # Dependencies & CLI scripts
├── config/
│   └── default.json            # Cấu hình Storefronts, Rate limits & Tham số mô hình
├── src/
│   ├── storage/                # Tầng lưu trữ cơ sở dữ liệu
│   │   ├── db.js               # Kết nối SQLite (node:sqlite) WAL mode
│   │   ├── schema.sql          # DDL chuẩn hóa (Canonical, Snapshots, Metrics, Scores)
│   │   └── repository.js       # Data Access Layer & Audit logging
│   ├── catalog/                # Tầng danh mục & Khám phá
│   │   ├── seed_importer.js    # Curated demo seed (tùy chọn)
│   │   ├── bulk_importer.js    # Nhập dữ liệu Education từ TSV/XZ local
│   │   └── store_sweeper.js    # Quét bảng xếp hạng Apple RSS v2 & Google Play
│   ├── collector/              # Tầng thu thập & kiểm soát nhịp
│   │   ├── android_collector.js# Thu thập maxInstalls, ratings, score có pacing & jitter
│   │   ├── ios_collector.js    # Thu thập batch iTunes Lookup API (50-100 IDs)
│   │   └── scheduler.js        # Điều phối chu kỳ thu thập tự động
│   ├── analytics/              # Tầng phân tích toán học & mô hình xu hướng
│   │   ├── derived_metrics.js  # Tính delta installs, rating velocity, Theil-Sen slope
│   │   └── trend_models.js     # Mô hình Model A (Volume), Model B (Compounder), Model C (Breakout)
│   ├── validation/             # Tầng kiểm nghiệm & đánh giá
│   │   └── backtesting.js      # Walk-forward validation harness & độ phân kỳ mô hình
│   └── export/                 # Tầng xuất dữ liệu phục vụ Dashboard
│       └── build_site_data.js  # Biên dịch cơ sở dữ liệu thành artifact data.json tĩnh
├── web/                        # Giao diện trực quan hóa phong cách Karpathy jobs
│   ├── index.html              # Trang chủ dashboard tương tác
│   ├── css/style.css           # Giao diện Dark theme tối giản, mật độ thông tin cao
│   ├── js/treemap.js           # Thuật toán Squarified Treemap thuần tối ưu hiệu năng
│   ├── js/app.js               # Logic điều khiển, bộ lọc thời gian & Inspection Drawer
│   └── data/data.json          # Artifact dữ liệu xuất bản
├── bin/
│   └── cli.js                  # Điểm nhập lệnh CLI điều khiển toàn hệ thống
└── data/
    └── trendlab.sqlite         # Cơ sở dữ liệu SQLite lưu trữ chuỗi thời gian
```

---

## 3. Hướng dẫn cài đặt & Vận hành

### Yêu cầu môi trường
- Node.js $\ge$ v22 (Khuyến nghị Node.js v24 có sẵn `node:sqlite`).

### Cài đặt dependencies
```bash
npm install
```

### Các lệnh CLI chính (`bin/cli.js`)

| Lệnh | Ý nghĩa chức năng |
| :--- | :--- |
| `node bin/cli.js seed --curated` | Tùy chọn demo bằng danh sách thủ công, không tính market coverage. |
| `node bin/cli.js import-catalog --file PATH` | Import danh mục Education AppGoblin từ TSV/XZ tải về máy. |
| `node bin/cli.js coverage` | Kiểm tra số app trong catalog, số app có snapshot và tiến độ. |
| `node bin/cli.js sweep` | Bổ sung app từ Top Charts theo từng nước (không phải toàn thị trường). |
| `node bin/cli.js collect` | Chạy worker thu thập dữ liệu Android và iOS. |
| `node bin/cli.js analyze` | Tính toán chỉ số dẫn xuất và chấm điểm xu hướng các mô hình. |
| `node bin/cli.js backtest` | Chỉ chẩn đoán độ trùng lặp Top-K; chưa đo hiệu năng dự báo. |
| `node bin/cli.js export` | Biên dịch dữ liệu ra file tĩnh `web/data/data.json`. |
| **`node bin/cli.js pipeline`** | **Chạy một chu kỳ thu thập các app đến hạn trong catalog rồi phân tích/xuất bản.** |
| **`node bin/cli.js serve`** | **Khởi chạy dashboard server tại `http://localhost:8080/`.** |

---

## 4. Giao diện Nghiên cứu Dashboard

Khi truy cập `http://localhost:8080/`, giao diện cung cấp:
1. **Interactive Education Treemap:**
   - **Diện tích ô:** Thể hiện **Quy mô quan sát được** ($\log_{10}$ của lượt cài đặt / đánh giá + 1) — *tuyệt đối không nhận vơ là thị phần*.
   - **Dải màu:** Đổi linh hoạt giữa **Mode A: Emerging Breakouts**, **Mode B: Sustained Growth**, **Model A: Volume Delta** và **Rating Velocity**.
2. **Bộ lọc thời gian thực:** Chuyển đổi nhanh giữa các cửa sổ 7 ngày, 14 ngày, 30 ngày, 90 ngày và All Time.
3. **Bộ lọc nền tảng:** Xem riêng Android, riêng iOS hoặc toàn bộ hệ sinh thái.
4. **Bảng xếp hạng động (Leaderboard):** Tự động sắp xếp ứng dụng theo điểm xu hướng của mô hình được chọn.
5. **Ngăn truy nguyên dữ liệu (Inspection Drawer):** Nhấp vào bất kỳ ô nào trên treemap để mở:
   - Biểu đồ chuỗi thời gian lịch sử các lần quan sát.
   - Nguồn dữ liệu (`source_name`), phương thức thu thập (`fetch_method`), mã băm SHA-256 của snapshot gốc.
   - Liên kết trực tiếp đến trang chính thức trên Google Play hoặc App Store.

---
*Phát triển bởi Senior Software Architect, Data Engineer & Research Engineer.*
