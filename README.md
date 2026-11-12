# TrendLab: Global Education App Trend Discovery Platform

> **Nền tảng nghiên cứu và khám phá xu hướng ứng dụng Giáo dục toàn cầu (Android & iOS).**  
> Lấy cảm hứng trực quan hóa từ [karpathy.ai/jobs](https://karpathy.ai/jobs/).

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

## 2. Cấu trúc dự án chuẩn Production

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
│   │   ├── seed_importer.js    # Khởi tạo hạt giống & luồng tải AppGoblin TSV
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
| `node bin/cli.js seed` | Khởi tạo danh mục hạt giống giáo dục toàn cầu. |
| `node bin/cli.js sweep` | Quét bảng xếp hạng Top Free Education để khám phá app mới. |
| `node bin/cli.js collect` | Chạy worker thu thập dữ liệu Android và iOS. |
| `node bin/cli.js analyze` | Tính toán chỉ số dẫn xuất và chấm điểm xu hướng các mô hình. |
| `node bin/cli.js backtest` | Chạy kiểm nghiệm mô hình và phân tích độ trùng lặp Top K. |
| `node bin/cli.js export` | Biên dịch dữ liệu ra file tĩnh `web/data/data.json`. |
| **`node bin/cli.js pipeline`** | **Chạy toàn bộ quy trình từ thu thập đến xuất bản dashboard.** |
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
