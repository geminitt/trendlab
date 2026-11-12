# TrendLab — Hiến chương dự án và tiêu chí nghiệm thu

**Trạng thái:** yêu cầu gốc của chủ dự án; tài liệu này là nguồn tham chiếu cho các vòng phát triển tiếp theo. Chỉ được sửa đổi yêu cầu gốc khi chủ dự án xác nhận rõ ràng. Đọc cùng `/AGENTS.md`.

## 1. Mục tiêu bất biến

Xây dựng công cụ nghiên cứu cá nhân để **phát hiện sớm ứng dụng Education đang tăng trưởng** trong **toàn bộ danh mục Education chính thức của Android và iOS, trên phạm vi toàn cầu**. Không dùng danh sách ứng dụng nổi tiếng chọn trước. Không giới hạn cố định ở Mỹ, một vài storefront hoặc Top Charts. Hệ thống cần phát hiện được ứng dụng mới chưa từng tồn tại trong catalog, trong giới hạn các nguồn có thể xác minh.

Không nhầm công cụ “vẽ treemap được” với “phát hiện xu hướng được”; không nhầm “có 331.338 ID” với “giám sát toàn bộ ứng dụng toàn cầu”.

## 2. Ràng buộc dữ liệu: bắt buộc

- Chỉ sử dụng **dữ liệu quan sát** cho số liệu gốc (và những biến đổi toán học có thể truy xuất). Không đưa estimated downloads/revenue của bên thứ ba vào pipeline nguồn sạch.
- Phân biệt `catalog entry`, `raw store observation`, `derived metric`, `trend inference`. Tên cột và chú thích phải mô tả đúng tầng.
- Android `maxInstalls`: bộ đếm do scraper cung cấp, **chưa chứng minh được chính xác hoặc là downloads theo ngày**. Không gọi observed delta là daily downloads.
- iOS công khai rating count theo storefront; Top Charts là quan sát xếp hạng trong **Top-K** của mỗi quốc gia. Không có lượt tải thật của app đối thủ từ Apple Lookup.
- Không cộng hay so sánh trực tiếp Android maxInstalls với iOS rating count; không cộng iOS rating count của các quốc gia như “global downloads”. Rank có truncation và country coverage.
- Mỗi quan sát phải có `source`, `observed_at`, `storefront`, `metric definition`, `method`, `raw payload/hash` khi có; thiếu dữ liệu là `NULL/N/A`, không phải `0`.
- Tôn trọng giấy phép và điều khoản; không né 403/429/robots/rate-limit. Không đồng nhất giấy phép dataset với quyền tự động truy cập API/website.

## 3. Hệ thống phải làm được — tiêu chí nghiệm thu

| ID | Yêu cầu/kiểm chứng | Trạng thái kiểm chứng hiện tại |
|---|---|---|
| C1 | Tự động phát hiện app Education **mới ngoài catalog** từ các nguồn xác minh, ghi lại nguồn/timestamp, loại trùng; báo độ phủ và thiếu hụt toàn cầu | **CHƯA ĐẠT.** Có nhập AppGoblin thủ công và `sweep` Top-K, chưa có nguồn cung cấp toàn bộ ứng dụng mới với cadence cam kết |
| C2 | Liên tục thu thập app đã biết và tái quan sát đúng hạn; đo số app cập nhật thành công trong 24h; tuyệt đối không coi “due” = “đã cập nhật” | **MỘT PHẦN.** `collect-loop` chạy; 24h freshness SLA chưa chứng minh được |
| C3 | Android và iOS, nhiều quốc gia, nhận diện regional unavailability ≠ globally delisted; nguồn hợp pháp, không assumed unlimited access | **MỘT PHẦN.** Android collector hiện mặc định `us`; iOS quay storefront theo cấu hình |
| C4 | Các chỉ số tăng trưởng + momentum/acceleration/persistence, kiểm soát nhiễu và độ phủ thực tế; walk-forward/backtest thực sự | **CHƯA ĐẠT.** Chỉ có mô hình thử nghiệm; không có minh chứng khả năng dự báo |
| C5 | Treemap thực sự hữu ích với màu/diện tích được định nghĩa rõ; UX chỉn chu như chuẩn Karpathy Jobs; lọc theo thời gian, ứng dụng, nền tảng, storefront, confidence, provenance | **MỘT PHẦN.** Observed Scale có treemap; growth chưa đủ dữ liệu |
| C6 | Chạy unattended trên Ubuntu, một collector, backup + analyze/export, dashboard riêng tư, kiểm tra hỏng và cảnh báo | **MỘT PHẦN.** Người dùng đã chạy systemd, chưa có kiểm chứng SLA/cảnh báo |
| C7 | Hệ thống tự đo và xuất báo cáo: catalog coverage local, discovery source freshness, attempts/success/failure, p50/p95 latency, fraction refreshed within 24h by platform/storefront | **CHƯA ĐẠT ĐẦY ĐỦ.** Hiện chỉ có `coverage` cơ bản |

**Chỉ đánh dấu “ĐẠT” khi có kiểm thử tự động, bằng chứng log/dữ liệu chạy thực tế, và định nghĩa số đo được công bố.**

## 4. Các thuật ngữ không được trộn lẫn

- **Known catalog** = tập ID ứng dụng đã biết trong SQLite (không có mẫu số toàn cầu đã xác minh).
- **Discovered** = app mới được tìm từ một nguồn ở một thời điểm; không đồng nghĩa newly published.
- **Attempted / succeeded** = có request / có snapshot phù hợp. 404 ở `country=us` không chứng minh delisted toàn cầu.
- **Fresh 24h** = last successful observation trong 24h cho platform/storefront được hỏi. Không chỉ là timer hoạt động.
- **Growth** = thay đổi một tín hiệu quan sát với đúng đơn vị; không được đổi tên thành download growth khi chưa có quan sát download.
- **Trend score** = điểm mô hình giả định; chưa có backtest thì phải ghi “provisional”.
- **Market coverage** = tỷ lệ thị trường thật (hiện chưa biết mẫu số). “Catalog coverage” chỉ là tỷ lệ so với local known catalog.

## 5. Thứ tự ưu tiên kỹ thuật

1. **Global Catalog Discovery & source freshness:** tìm nguồn catalog có cập nhật, cơ chế polling/versioning, provenance, import lặp an toàn, phát hiện nguồn đã cũ, thêm chart discovery phụ trợ; không tuyên bố bao phủ mọi app khi nguồn không đủ.
2. **Measured Collection Capacity/Freshness:** throughput thực tế, lỗi theo từng quốc gia, fairness và không starvation, freshness SLA theo từng nền tảng.
3. **Research Analytics & Validation:** thước đo, test synthetic cases, dữ liệu thật theo thời gian, walk-forward, confidence.
4. **High-quality visual research UX:** metric semantics trước CSS; treemap luôn là thành phần chủ đạo của sản phẩm.

## 6. Nguồn đang dùng và giới hạn đã xác nhận

- AppGoblin free catalog: https://github.com/appgoblin-dev/appgoblin-data và https://appgoblin.info/free-app-datasets — CC BY 4.0 và cần attribution khi dùng công khai. **File GitHub `data/live_store_apps.tsv.xz` lần cập nhật gần nhất được API ghi nhận 2025-11-17** (kiểm tra ngày 2026-11-13). Đây là **nguồn catalog cũ**, không được tự nhận là nguồn daily new apps. Trang AppGoblin có thể có phiên bản mới hơn nhưng đường dẫn tải và quyền sử dụng cần xác minh.
- Apple Education charts (country-specific), App Store Lookup; chỉ bao phủ chart top entries + listing.
- Google Play scraper (country-specific, không có public complete category inventory API được chứng minh).
- Cập nhật nguồn, mặt bằng cạnh tranh và tính hợp pháp bằng kiểm tra cụ thể trước khi thay đổi pipeline.

## 7. Quy tắc làm PR

Mọi PR phải nêu rõ: **(a)** yêu cầu C1-C7 nào được cải thiện, **(b)** số đo trước/sau từ dữ liệu thật hoặc “chưa đo”, **(c)** nguồn dữ liệu và loại dữ liệu được dùng, **(d)** giới hạn chưa giải quyết, **(e)** kiểm thử/rollback, **(f)** có thay đổi systemd/SQLite hay không. Không bao giờ im lặng đổi yêu cầu của chủ dự án.

**Đây là bản ghi yêu cầu cố định trong repo, không phải một tuyên bố rằng ChatGPT có khả năng bảo đảm nhớ vĩnh viễn ngoài repo.**
